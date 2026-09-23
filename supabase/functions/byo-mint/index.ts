// ──────────────────────────────────────────────────────────────────────────
// PackPerks — byo-mint Edge Function (Phase 3 "Bring Your Own cup")
//
// The stationary counter QR for a BYO store points at /<slug>/?byo=1. When a
// customer scans it the client calls this function to add ONE cup.
//
// Trust + soft cap: the venue's Static QR code limit says how many cups one
// person gets auto-credited per rolling window (2 a day unless set). A scan
// past it does NOT credit — it creates a pending `byo_cup_requests` row for
// an admin to approve (which credits it) or deny, and the client shows a
// respectful "held for review" message with no numbers in it.
//
// Body: { user_id, device_id, org_id }   (JWT optional — anonymous allowed)
// Returns:
//   { status: "credited", cups, preBalance, newBalance }
//   { status: "pending_review", preBalance, newBalance }
//
// Static QR code: a Bring Your Own venue (group mode 'byo') has it unless it
// was switched off; any other venue only once Settings → Static QR code is
// on (published settings `featureStaticQr`). Deferred Tikkie venues credit
// their money wallet through bin-tikkie (action static_qr), never here.
// ──────────────────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ALLOWED_ORIGIN   = Deno.env.get("ALLOWED_ORIGIN") ?? null;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_CAP = 2;                      // auto-credited cups per window (per store, when unset)
const DEFAULT_WINDOW_MINUTES = 24 * 60;     // two cups a day
const MAX_WINDOW_MINUTES = 90 * 24 * 60;    // a quarter is as long as a limit may run

/* The venue's Static QR code limit: how many cups one person gets from the
 * counter code, and the rolling window it resets over (Static QR code page →
 * app_config `byo:cap:<orgId>`). The window is minutes; `windowHours` and
 * `dailyCap` are the older names for the same two numbers, and a row
 * written before minutes existed only carries them. */
async function staticLimit(orgId: string): Promise<{ cap: number; minutes: number; windowMs: number }> {
  const { data } = await supabase
    .from("app_config").select("value").eq("key", `byo:cap:${orgId}`).maybeSingle();
  const v = (data?.value ?? {}) as { cap?: number; dailyCap?: number; windowHours?: number; windowMinutes?: number };
  const rawCap = Number(v.cap ?? v.dailyCap);
  const cap = Number.isFinite(rawCap) && rawCap > 0 ? Math.floor(rawCap) : DEFAULT_CAP;
  const rawMinutes = Number.isFinite(Number(v.windowMinutes))
    ? Number(v.windowMinutes)
    : Number(v.windowHours) * 60;
  const minutes = Number.isFinite(rawMinutes) && rawMinutes >= 1 && rawMinutes <= MAX_WINDOW_MINUTES
    ? Math.floor(rawMinutes)
    : DEFAULT_WINDOW_MINUTES;
  return { cap, minutes, windowMs: minutes * 60 * 1000 };
}

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

  let body: { user_id?: string; device_id?: string; org_id?: string; location_id?: string };
  try { body = await req.json(); }
  catch { return json({ error: "invalid_json" }, 400); }

  const userId   = body?.user_id ?? null;
  const deviceId = body?.device_id ?? null;
  const orgId    = body?.org_id ?? null;
  const rawLocationId = body?.location_id ?? null;
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

  // ── Static QR guard ──────────────────────────────────────────────────
  const { data: org } = await supabase
    .from("organizations").select("id, group_id").eq("id", orgId).maybeSingle();
  if (!org) return json({ error: "org_not_found" }, 404);
  const { data: orgCfg } = await supabase
    .from("app_config").select("value").eq("key", `published:${orgId}`).maybeSingle();
  const orgSettings = (orgCfg?.value as { settings?: Record<string, unknown> } | null)?.settings || {};
  if (orgSettings.mode === "tikkie_only") return json({ error: "wrong_mode" }, 400);
  let isByo = false;
  if (org.group_id) {
    const { data: cfg } = await supabase
      .from("app_config").select("value").eq("key", `published:group:${org.group_id}`).maybeSingle();
    isByo = (cfg?.value as { settings?: { mode?: string } } | null)?.settings?.mode === "byo";
  }
  const flag = orgSettings.featureStaticQr;
  const enabled = flag === undefined || flag === null ? isByo : flag === true;
  if (!enabled) return json({ error: isByo ? "static_qr_off" : "not_byo" }, 400);

  // ── Optional per-location tag ────────────────────────────────────────
  // The counter QR may carry ?loc=<location_id>. Accept it only if that
  // location belongs to THIS org — an invalid/foreign id is ignored, never
  // fails the scan. Cups themselves stay org-wide (cross-location redeemable);
  // this just records WHERE the scan happened for analytics.
  let locationId: string | null = null;
  if (rawLocationId && UUID_RE.test(rawLocationId)) {
    const { data: loc } = await supabase
      .from("locations").select("id").eq("id", rawLocationId).eq("org_id", orgId).maybeSingle();
    if (loc) locationId = loc.id;
  }

  // ── Per-store auto-credit limit (Static QR code page). Org-scoped, so
  // each store enforces its own cap over its own window.
  const { cap, minutes, windowMs } = await staticLimit(orgId);

  const sinceIso = new Date(Date.now() - windowMs).toISOString();

  // ── Count auto-credited BYO cups inside the window ───────────────────
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
  if (autoCount >= cap) {
    // Collapse rapid re-scans into one pending request per user/org/window.
    const { data: existing } = await supabase
      .from("byo_cup_requests")
      .select("id").eq("user_id", userId).eq("org_id", orgId).eq("status", "pending")
      .gte("created_at", sinceIso).maybeSingle();
    if (!existing) {
      await supabase.from("byo_cup_requests").insert({
        org_id: orgId, user_id: userId, identity_id: userRow.identity_id || null,
        cups: 1, status: "pending", location_id: locationId,
        device_id: userRow.device_id || deviceId || null,
        note: `Auto-credit cap reached (${cap} per rolling ${minutes}m)`,
      });
    }
    return json({ status: "pending_review", preBalance, newBalance: preBalance });
  }

  // ── Under the cap → auto-credit +1 (A.9: ATOMIC increment) ───────────
  // Previously this wrote preBalance+1 (a stale absolute), so two concurrent
  // scans both wrote the same value and a cup was lost. The RPC does
  // `balance = balance + 1` inside one statement, so concurrent scans each
  // apply. Multi-redeem up to the per-store limit is unchanged; the cap is
  // a soft cap (a scan past it still holds for review), so a rare
  // double-scan crediting one extra is acceptable.
  const { data: newBalance, error: incErr } = await supabase
    .rpc("increment_cup_balance", { p_user_id: userId, p_org_id: orgId, p_delta: 1 });
  if (incErr) return json({ error: "balance_update_failed", detail: incErr.message }, 500);

  await supabase.from("cup_scans").insert({
    user_id: userId, org_id: orgId, location_id: locationId,
    scan_type: "byo", source: "byo_qr",
    status: "success", cups_awarded: 1, scanned_at: new Date().toISOString(),
  });
  await supabase.from("activity_history").insert({
    user_id: userId, type: "cup_added", label: isByo ? "Cup added (bring your own)" : "Cup added (counter QR)",
  });

  // How many are left is deliberately not returned: the app tells a
  // customer only that they reached the limit, never the numbers behind it.
  return json({ status: "credited", cups: 1, preBalance, newBalance });
});
