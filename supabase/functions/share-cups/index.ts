// ──────────────────────────────────────────────────────────────────────────
// PackPerks — share-cups Edge Function (v3 — H-3 CORS + H-4 ownership)
//
// Body: { user_id: uuid, count: number, device_id: uuid }
// Returns: { cup_ids, newBalance, count, batch_id, expires_at }
// ──────────────────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Allowed origins for CORS. PackPerks runs on multiple domains (the Vercel URL,
// perks.packback.app, perks.packback.network), so set ALLOWED_ORIGINS to a
// comma-separated list in the Edge Function secrets, e.g.
//   "https://perks.packback.network,https://perks.packback.app"
// (legacy single ALLOWED_ORIGIN still honoured). Unset → wildcard for local dev.
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? Deno.env.get("ALLOWED_ORIGIN") ?? "")
  .split(",").map((s) => s.trim()).filter(Boolean);

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHARE_EXPIRY_HOURS = 24;

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const allow  = ALLOWED_ORIGINS.length
    ? (ALLOWED_ORIGINS.includes(origin) ? origin : null)
    : "*";
  const h: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (allow) h["Access-Control-Allow-Origin"] = allow;
  return h;
}

/** Verify the caller owns `userId`.
 *  Email users:    JWT → auth_user_id join in users table.
 *  Anonymous users: device_id match in users table (proof-of-possession). */
async function ownsUser(req: Request, userId: string, deviceId: string | null): Promise<boolean> {
  const authHeader = req.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const jwt = authHeader.replace("Bearer ", "");
    const { data: { user }, error } = await supabase.auth.getUser(jwt);
    if (!error && user) {
      const { data } = await supabase
        .from("users").select("id")
        .eq("auth_user_id", user.id).eq("id", userId)
        .maybeSingle();
      // If this JWT belongs to a real auth user but isn't linked to the
      // claimed users row, fall through to the device check rather than
      // hard-denying — an anonymous row may still be owned via device_id.
      if (data !== null) return true;
    }
  }
  if (!deviceId || !UUID_RE.test(deviceId)) return false;
  const { data } = await supabase
    .from("users").select("id")
    .eq("id", userId).eq("device_id", deviceId)
    .maybeSingle();
  return data !== null;
}

Deno.serve(async (req) => {
  const CORS = corsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...CORS, "content-type": "application/json" },
    });

  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: { user_id?: string; count?: number; device_id?: string };
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const userId   = body?.user_id ?? null;
  const deviceId = body?.device_id ?? null;
  const count    = parseInt(String(body?.count), 10) || 0;

  if (!userId || !UUID_RE.test(userId))
    return json({ error: "missing_or_invalid_user_id" }, 400);
  if (count < 1 || count > 10)
    return json({ error: "invalid_count", detail: "count must be 1..10" }, 400);

  if (!await ownsUser(req, userId, deviceId))
    return json({ error: "forbidden" }, 403);

  const { data: balanceRow, error: balErr } = await supabase
    .from("cup_balances")
    .select("balance, lifetime_cups")
    .eq("user_id", userId)
    .maybeSingle();

  if (balErr) return json({ error: "db_error", detail: balErr.message }, 500);
  if (!balanceRow) return json({ error: "user_not_found" }, 404);
  if ((balanceRow.balance || 0) < count) {
    return json(
      { error: "insufficient_balance", balance: balanceRow.balance, requested: count },
      409,
    );
  }

  const expiresAt = new Date(Date.now() + SHARE_EXPIRY_HOURS * 3_600_000).toISOString();
  const batchId   = crypto.randomUUID();
  const rows      = Array.from({ length: count }, () => ({
    id: crypto.randomUUID(),
    batch_id: batchId,
    source: "user_share",
    status: "available",
    shared_by_user_id: userId,
    expires_at: expiresAt,
  }));

  const { data: inserted, error: insErr } = await supabase
    .from("cups").insert(rows).select("id");
  if (insErr) return json({ error: "db_error", detail: insErr.message }, 500);

  // A.9: ATOMIC guarded decrement. The old code computed newBalance from the
  // earlier read and wrote that absolute value, so two concurrent shares of N
  // both passed `balance >= N` and wrote the same number — debiting once but
  // minting cups twice. spend_cup_balance does `balance = balance - count WHERE
  // balance >= count` in a single statement (returns -1 if insufficient).
  const { data: spentBalance, error: spendErr } = await supabase
    .rpc("spend_cup_balance", { p_user_id: userId, p_amount: count });
  if (spendErr || spentBalance == null || spentBalance < 0) {
    // Insufficient (another share beat this one) — roll back the cups we made.
    const ids = (inserted || []).map((r: { id: string }) => r.id);
    if (ids.length > 0) await supabase.from("cups").delete().in("id", ids);
    return json(
      { error: "balance_race", detail: "Another share request beat this one." },
      409,
    );
  }
  const newBalance = spentBalance;

  await supabase.from("activity_history").insert({
    user_id: userId,
    type: "cups_shared",
    label: `Shared ${count} cup${count !== 1 ? "s" : ""} via QR code`,
  });

  return json({
    cup_ids: (inserted || []).map((r: { id: string }) => r.id),
    count,
    newBalance,
    batch_id: batchId,
    expires_at: expiresAt,
  });
});
