// ──────────────────────────────────────────────────────────────────────
// PackPerks — delete-account Edge Function (audit item 13, right to erasure)
//
// STATUS: DEPLOYED + hardened (A.7). Called by the customer "Delete my account"
// action (Data control). Verifies ownership, then erases the person's data
// across every store they belong to (via their shared identity), plus their
// receipt/scan images and payout details. Financial records that must be
// retained for accounting are anonymised (user_id kept, PII stripped) rather
// than hard-deleted — see docs/RETENTION_SCHEDULE.md.
//
// A.7: erasing a whole CROSS-STORE identity now requires the email-verified
// session (JWT) — a device_id alone can only delete its own single row; the
// erased claims' personal Tikkie links are voided; and the erasure is written
// to admin_action_log. (When wired: the client should catch a 403
// verification_required and prompt the user to verify their email first.)
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

  let body: { user_id?: string; device_id?: string };
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const { user_id, device_id } = body;
  if (!user_id || !UUID.test(user_id)) return json({ error: "bad_user_id" }, 400);

  const { data: u } = await supabase.from("users")
    .select("id, identity_id, auth_user_id, device_id").eq("id", user_id).maybeSingle();
  if (!u) return json({ error: "user_not_found" }, 404);

  // Ownership (JWT or device_id).
  let owns = false;
  let ownsViaJwt = false;
  const auth = req.headers.get("Authorization");
  if (auth?.startsWith("Bearer ")) {
    const { data: { user } } = await supabase.auth.getUser(auth.replace("Bearer ", ""));
    if (user && u.auth_user_id === user.id) { owns = true; ownsViaJwt = true; }
  }
  if (!owns && device_id && u.device_id === device_id) owns = true;
  if (!owns) return json({ error: "forbidden" }, 403);

  // Resolve every user row for this person (all stores in their identity).
  let userIds = [user_id];
  if (u.identity_id) {
    const { data: rows } = await supabase.from("users").select("id").eq("identity_id", u.identity_id);
    if (rows?.length) userIds = rows.map((r) => r.id);
  }

  // A.7: erasing a whole CROSS-STORE identity is high-impact and irreversible,
  // so require the email-verified session. A device_id alone (which a
  // borrowed/second-hand phone still carries) may only delete its own single
  // row; wiping every store needs the verified JWT.
  if (userIds.length > 1 && !ownsViaJwt) {
    return json({ error: "verification_required", detail: "Verify your email to delete your account across all your stores." }, 403);
  }

  // Delete receipt + scan images for these users' claims/scans.
  const { data: claimPaths } = await supabase.from("claims")
    .select("receipt_photo_path").in("user_id", userIds).not("receipt_photo_path", "is", null);
  const receiptPaths = (claimPaths ?? []).map((c) => c.receipt_photo_path).filter(Boolean) as string[];
  if (receiptPaths.length) await supabase.storage.from("receipts").remove(receiptPaths);

  // Anonymise claims (keep the financial ledger; strip PII). A.7: also void the
  // personal Tikkie payout link so an erased account's cashback can't be
  // collected from a leaked link.
  await supabase.from("claims").update({
    receipt_photo_path: null, ai_verdict: null,
    tikkie_url: null,
  }).in("user_id", userIds);

  // Hard-delete behavioural + loyalty data.
  await supabase.from("activity_history").delete().in("user_id", userIds);
  await supabase.from("cup_scans").delete().in("user_id", userIds);
  await supabase.from("byo_cup_requests").delete().in("user_id", userIds);
  await supabase.from("cup_balances").delete().in("user_id", userIds);
  await supabase.from("client_events").delete().in("user_id", userIds);

  // Payout details + identity, then the user rows themselves.
  if (u.identity_id) {
    await supabase.from("payout_details").delete().eq("identity_id", u.identity_id);
  }
  // Strip PII on the user rows but keep them referenced by any retained claim.
  await supabase.from("users").update({
    email: null, display_name: "Deleted user", device_id: null,
    device: null, auth_user_id: null,
  }).in("id", userIds);
  if (u.identity_id) {
    await supabase.from("customer_identities").update({
      email: null, display_name: "Deleted user", auth_user_id: null,
    }).eq("id", u.identity_id);
  }

  // A.7: leave a trail for this irreversible erasure. The console line always
  // lands in the edge logs; the admin_action_log insert is best-effort so a
  // schema mismatch can never block a GDPR erasure.
  console.log(`[delete-account] erased identity=${u.identity_id ?? "-"} users=${userIds.length} via=${ownsViaJwt ? "jwt" : "device"}`);
  try {
    await supabase.from("admin_action_log").insert({
      actor_id: null,
      action: "account.self_delete",
      target_type: "identity",
      target_id: u.identity_id ?? user_id,
      metadata: { user_ids: userIds, cross_identity: userIds.length > 1, via: ownsViaJwt ? "jwt" : "device" },
    });
  } catch (_e) { /* audit is best-effort; never block the erasure */ }

  return json({ status: "deleted", users: userIds.length });
});
