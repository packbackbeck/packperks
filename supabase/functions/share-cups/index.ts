// ──────────────────────────────────────────────────────────────────────────
// PackPerks — share-cups Edge Function (v2 — P-46 expiry)
//
// User taps "Share cup" in the app, picks how many → this function:
//   1. Verifies the user has at least `count` cups in their balance.
//   2. Atomically decrements the balance by `count` and mints `count`
//      fresh rows in `cups` (status='available', source='user_share',
//      shared_by_user_id = sender, expires_at = now + 24h).
//   3. Returns the new cup UUIDs + expires_at so the client can show
//      a countdown to the sender.
//
// P-46: 24h expiry on shared cups protects against "I shared this
// 3 months ago and now a stranger scanned it" scenarios. The window
// is server-set, not client-set, so users can't extend it.
//
// Body: { user_id: uuid, count: number }
// Returns: { cup_ids: [uuid, ...], newBalance, count, batch_id, expires_at }
// ──────────────────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Shared cups expire 24h after creation. Long enough for everyone
// who'd realistically claim a friend's share, short enough to limit
// the blast radius of a misplaced QR.
const SHARE_EXPIRY_HOURS = 24;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "content-type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  let body: { user_id?: string; count?: number };
  try { body = await req.json(); } catch { return jsonResponse({ error: "invalid_json" }, 400); }

  const userId = body?.user_id;
  const count = parseInt(String(body?.count), 10) || 0;

  if (!userId || !UUID_RE.test(userId))
    return jsonResponse({ error: "missing_or_invalid_user_id" }, 400);
  if (count < 1 || count > 10)
    return jsonResponse({ error: "invalid_count", detail: "count must be 1..10" }, 400);

  const { data: balanceRow, error: balErr } = await supabase
    .from("cup_balances")
    .select("balance, lifetime_cups")
    .eq("user_id", userId)
    .maybeSingle();

  if (balErr) return jsonResponse({ error: "db_error", detail: balErr.message }, 500);
  if (!balanceRow) return jsonResponse({ error: "user_not_found" }, 404);
  if ((balanceRow.balance || 0) < count) {
    return jsonResponse(
      { error: "insufficient_balance", balance: balanceRow.balance, requested: count },
      409,
    );
  }

  const expiresAt = new Date(Date.now() + SHARE_EXPIRY_HOURS * 3_600_000).toISOString();
  const batchId = crypto.randomUUID();
  const rows = Array.from({ length: count }, () => ({
    id: crypto.randomUUID(),
    batch_id: batchId,
    source: "user_share",
    status: "available",
    shared_by_user_id: userId,
    expires_at: expiresAt,
  }));

  const { data: inserted, error: insErr } = await supabase
    .from("cups")
    .insert(rows)
    .select("id");

  if (insErr) return jsonResponse({ error: "db_error", detail: insErr.message }, 500);

  const newBalance = (balanceRow.balance || 0) - count;
  const { data: updated, error: updErr } = await supabase
    .from("cup_balances")
    .update({ balance: newBalance, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .gte("balance", count)
    .select("balance");

  if (updErr || !updated?.length) {
    const ids = (inserted || []).map((r: { id: string }) => r.id);
    if (ids.length > 0) await supabase.from("cups").delete().in("id", ids);
    return jsonResponse(
      { error: "balance_race", detail: "Another share request beat this one." },
      409,
    );
  }

  await supabase
    .from("activity_history")
    .insert({
      user_id: userId,
      type: "cups_shared",
      label: `Shared ${count} cup${count !== 1 ? "s" : ""} via QR code`,
    });

  return jsonResponse({
    cup_ids: (inserted || []).map((r: { id: string }) => r.id),
    count,
    newBalance,
    batch_id: batchId,
    expires_at: expiresAt,
  });
});
