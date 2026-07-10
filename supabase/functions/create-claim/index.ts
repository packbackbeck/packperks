// ──────────────────────────────────────────────────────────────────────
// PackPerks — create-claim Edge Function (audit item 2)
//
// STATUS: DEPLOYED + hardened (A.5 dedupe). This is the server-authoritative
// claim writer meant to REPLACE the client's direct `insert into claims`.
// Verified (A.6) to mirror the current claim flow — same ownership check, same
// cups=balance — but the payout amount is computed server-side from live config,
// never trusted from the browser (fixes the client-controlled payout amount).
//
// NOT yet wired from the client: the browser still inserts `claims` directly.
// Switching the client to call this + dropping the anon claims-write RLS is the
// staged A.1/A.6 step. When that lands, add a server-side cups DEBIT here and a
// matching RESTORE on reject (so a rejected claim returns the cups).
//
// Why: today the anonymous browser inserts `claims` directly, so a third party
// could forge claims or set payout fields. This function becomes the ONLY
// writer of claims: it verifies the caller owns the user row, forces
// status='pending', and server-sets the amount from the live config. The
// client passes only { user_id, org_id, reward_id, type, receipt_photo_path }.
//
// Latency cost: one extra Supabase Edge round-trip on claim submit — typically
// ~120–250 ms warm (Deno edge is already warm on an active project), ~1 s on a
// rare cold start. It runs once per claim (not per cup), so the user impact is
// a single brief spinner; nothing else in the app gets slower.
//
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ──────────────────────────────────────────────────────────────────────
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: {
    user_id?: string; org_id?: string; reward_id?: string;
    type?: string; receipt_photo_path?: string; device_id?: string;
  };
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const { user_id, org_id, reward_id, type, receipt_photo_path, device_id } = body;
  if (!user_id || !UUID.test(user_id)) return json({ error: "bad_user_id" }, 400);
  if (!org_id || !UUID.test(org_id)) return json({ error: "bad_org_id" }, 400);
  if (type !== "cashback" && type !== "direct_refund") return json({ error: "bad_type" }, 400);

  // Ownership: the user row must belong to the caller (JWT auth OR device_id).
  const { data: u } = await supabase.from("users")
    .select("id, org_id, auth_user_id, device_id, merged_into").eq("id", user_id).maybeSingle();
  if (!u || u.merged_into) return json({ error: "user_not_found" }, 404);
  if (u.org_id !== org_id) return json({ error: "org_mismatch" }, 400);

  let owns = false;
  const auth = req.headers.get("Authorization");
  if (auth?.startsWith("Bearer ")) {
    const { data: { user } } = await supabase.auth.getUser(auth.replace("Bearer ", ""));
    if (user && u.auth_user_id === user.id) owns = true;
  }
  if (!owns && device_id && u.device_id === device_id) owns = true;
  if (!owns) return json({ error: "forbidden" }, 403);

  // Server-owned fields: look up the payout amount from the live config; the
  // client never gets to set it. cups/rate resolution mirrors the app.
  const { data: cfg } = await supabase.from("app_config")
    .select("value").eq("key", `published:${org_id}`).maybeSingle();
  const settings = (cfg?.value as { settings?: Record<string, number> } | null)?.settings ?? {};
  const rate = type === "direct_refund"
    ? (settings.refundRatePerCup ?? 1.0)
    : (settings.cashbackRatePerCup ?? 1.25);
  const { data: bal } = await supabase.from("cup_balances")
    .select("balance").eq("user_id", user_id).maybeSingle();
  const cups = bal?.balance ?? 0;
  if (cups <= 0) return json({ error: "no_cups" }, 400);

  // A.5: one open claim at a time. Without this a user could submit N pending
  // claims off the same balance — each for the full amount — and if more than
  // one is approved the same cups pay out repeatedly. They must let the current
  // claim resolve (approved or rejected) before starting another.
  const { data: openClaim } = await supabase.from("claims")
    .select("id").eq("user_id", user_id).eq("status", "pending").limit(1).maybeSingle();
  if (openClaim) return json({ error: "claim_in_progress", claim_id: openClaim.id }, 409);

  const { data: claim, error } = await supabase.from("claims").insert({
    user_id, org_id, reward_id: reward_id ?? null, type,
    cups_redeemed: cups,
    payout_amount: Number((cups * rate).toFixed(2)),
    status: "pending",                          // ← server-forced
    receipt_photo_path: receipt_photo_path ?? null,
  }).select("id").single();
  if (error) return json({ error: "insert_failed", detail: error.message }, 500);

  return json({ claim_id: claim.id, status: "pending" });
});
