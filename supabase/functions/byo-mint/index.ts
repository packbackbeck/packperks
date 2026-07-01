// ──────────────────────────────────────────────────────────────────────────
// PackPerks — byo-mint Edge Function (Phase 3 "Bring Your Own cup")
//
// The stationary counter QR for a BYO store points at /<slug>/?byo=1. When a
// customer scans it the client calls this function to add ONE cup.
//
// Trust + soft cap (decision 3A/A4): up to 2 cups are auto-credited per user
// per ROLLING 24h. The 3rd+ scan in that window does NOT credit — it creates
// a pending `byo_cup_requests` row for an admin to approve (which credits it)
// or deny, and the client shows a respectful "held for review" message.
//
// Body: { user_id, device_id, org_id }   (JWT optional — anonymous allowed)
// Returns:
//   { status: "credited", cups, preBalance, newBalance, autoRemaining }
//   { status: "pending_review", preBalance, newBalance }
//
// BYO-only: refuses any org that isn't in a group whose mode is 'byo', so the
// deposit orgs (which use claim-cups / batches) can never be minted here.
// ──────────────────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ALLOWED_ORIGIN   = Deno.env.get("ALLOWED_ORIGIN") ?? null;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_DAILY_CAP = 2;               // auto-credited cups per rolling 24h (per store, when unset)
const WINDOW_MS = 24 * 60 * 60 * 1000;

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const allow  = ALLOWED_ORIGIN ? (origin === ALLOWED_ORIGIN ? origin : null) : "*";
  const h: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (allow) h["Access-Control-Allow-Origin"] = allow;
  return h;
}

Deno.serve(async (req) => {
  const CORS = corsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });

  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: { user_id?: string; device_id?: string; org_id?: string };
  try { body = await req.json(); }
  catch { return json({ error: "invalid_json" }, 400); }

  const userId   = body?.user_id ?? null;
  const deviceId = body?.device_id ?? null;
  const orgId    = body?.org_id ?? null;
  if (!userId || !UUID_RE.test(userId)) return json({ error: "missing_or_invalid_user_id" }, 400);
  if (!orgId  || !UUID_RE.test(orgId))  return json({ error: "missing_or_invalid_org_id" }, 400);

  // ── Resolve the user row + verify org membership ─────────────────────
  const { data: userRow, error: userErr } = await supabase
    .from("users")
    .select("id, org_id, device_id, auth_user_id, identity_id, merged_into")
    .eq("id", userId).maybeSingle();
  if (userErr) return json({ error: "db_error", detail: userErr.message }, 500);
  if (!userRow || userRow.merged_into) return json({ error: "user_not_found" }, 404);
  if (userRow.org_id !== orgId) return json({ error: "org_mismatch" }, 400);

  // ── Ownership: JWT auth match OR device_id proof-of-possession ───────
  let owns = false;
  const authHeader = req.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const jwt = authHeader.replace("Bearer ", "");
    const { data: { user }, error } = await supabase.auth.getUser(jwt);
    if (!error && user && userRow.auth_user_id === user.id) owns = true;
  }
  if (!owns && deviceId && userRow.device_id === deviceId) owns = true;
  if (!owns) return json({ error: "forbidden" }, 403);

  // ── BYO-only guard: org must be in a group whose mode is 'byo' ───────
  const { data: org } = await supabase
    .from("organizations").select("id, group_id").eq("id", orgId).maybeSingle();
  if (!org?.group_id) return json({ error: "not_grouped" }, 400);
  const { data: cfg } = await supabase
    .from("app_config").select("value").eq("key", `published:group:${org.group_id}`).maybeSingle();
  if ((cfg?.value as { settings?: { mode?: string } } | null)?.settings?.mode !== "byo") {
    return json({ error: "not_byo" }, 400);
  }

  // ── Per-store daily auto-credit cap (admin-set on the BYO requests page).
  // Stored in its own app_config row `byo:cap:<orgId>`; falls back to the
  // default. This is org-scoped, so each store enforces its own limit.
  const { data: capCfg } = await supabase
    .from("app_config").select("value").eq("key", `byo:cap:${orgId}`).maybeSingle();
  const capVal = Number((capCfg?.value as { dailyCap?: number } | null)?.dailyCap);
  const dailyCap = Number.isFinite(capVal) && capVal > 0 ? Math.floor(capVal) : DEFAULT_DAILY_CAP;

  const sinceIso = new Date(Date.now() - WINDOW_MS).toISOString();

  // ── Count auto-credited BYO cups in the rolling 24h window ───────────
  const { count } = await supabase
    .from("cup_scans")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId).eq("scan_type", "byo").eq("source", "byo_qr")
    .gte("scanned_at", sinceIso);
  const autoCount = count || 0;

  const { data: balRow } = await supabase
    .from("cup_balances").select("balance, lifetime_cups").eq("user_id", userId).maybeSingle();
  const preBalance = balRow?.balance || 0;

  // ── Over the soft cap → hold for review, do NOT credit ───────────────
  if (autoCount >= dailyCap) {
    // Collapse rapid re-scans into one pending request per user/org/window.
    const { data: existing } = await supabase
      .from("byo_cup_requests")
      .select("id").eq("user_id", userId).eq("org_id", orgId).eq("status", "pending")
      .gte("created_at", sinceIso).maybeSingle();
    if (!existing) {
      await supabase.from("byo_cup_requests").insert({
        org_id: orgId, user_id: userId, identity_id: userRow.identity_id || null,
        cups: 1, status: "pending",
        device_id: userRow.device_id || deviceId || null,
        note: "Auto-credit cap reached (rolling 24h)",
      });
    }
    return json({ status: "pending_review", preBalance, newBalance: preBalance });
  }

  // ── Under the cap → auto-credit +1 ───────────────────────────────────
  const newBalance  = preBalance + 1;
  const newLifetime = (balRow?.lifetime_cups || 0) + 1;
  if (balRow) {
    const { error: balErr } = await supabase
      .from("cup_balances")
      .update({ balance: newBalance, lifetime_cups: newLifetime, updated_at: new Date().toISOString() })
      .eq("user_id", userId);
    if (balErr) return json({ error: "balance_update_failed", detail: balErr.message }, 500);
  } else {
    await supabase.from("cup_balances").insert({
      user_id: userId, org_id: orgId, balance: newBalance, lifetime_cups: newLifetime,
    });
  }

  await supabase.from("cup_scans").insert({
    user_id: userId, org_id: orgId, scan_type: "byo", source: "byo_qr",
    status: "success", cups_awarded: 1, scanned_at: new Date().toISOString(),
  });
  await supabase.from("activity_history").insert({
    user_id: userId, type: "cup_added", label: "Cup added (bring your own)",
  });

  return json({
    status: "credited", cups: 1, preBalance, newBalance,
    autoRemaining: Math.max(0, dailyCap - (autoCount + 1)),
  });
});
