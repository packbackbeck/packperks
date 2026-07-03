// ──────────────────────────────────────────────────────────────────────
// PackPerks — payout Edge Function (audit items 3, 5, 6)
//
// ⚠️ DEPLOY-PENDING — authored offline. The ONLY code path that touches the
// restricted `payout_details.iban`. Actions:
//   • save    (customer)   — upsert the caller's own IBAN into payout_details
//                            (replaces the browser writing users.iban).
//   • export  (top admin)  — return IBANs for pending claims + log the export
//                            to payout_exports. TOP ADMIN ONLY.
//   • reveal  (top admin)  — return one claim's IBAN for support. Audited.
//   • confirm (top admin)  — mark a claim paid + purge its raw IBAN (keeps the
//                            record) via confirm_payout_and_purge_iban().
//
// "Top admin" = admin_profiles.is_owner (add this boolean). Only they see IBANs.
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
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "content-type": "application/json" } });
const last4 = (iban: string) => iban.replace(/\s/g, "").slice(-4);

async function callerAuthId(req: Request): Promise<string | null> {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const { data: { user } } = await supabase.auth.getUser(auth.replace("Bearer ", ""));
  return user?.id ?? null;
}
async function isTopAdmin(authId: string | null): Promise<boolean> {
  if (!authId) return false;
  // admin_profiles.id === auth.users.id; the top admin has role 'owner'.
  const { data } = await supabase.from("admin_profiles")
    .select("role").eq("id", authId).maybeSingle();
  return data?.role === "owner";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: { action?: string; identity_id?: string; iban?: string; claim_id?: string };
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const authId = await callerAuthId(req);

  // ── save (customer): store the caller's own IBAN, scoped to their identity ──
  if (body.action === "save") {
    if (!authId) return json({ error: "sign_in_required" }, 401); // IBAN needs a registered (email) account
    const { data: u } = await supabase.from("users")
      .select("identity_id").eq("auth_user_id", authId).not("identity_id", "is", null).limit(1).maybeSingle();
    const identityId = u?.identity_id;
    if (!identityId) return json({ error: "no_identity" }, 400);
    const iban = String(body.iban || "").trim().toUpperCase();
    if (iban.length < 15) return json({ error: "bad_iban" }, 400);
    const { error } = await supabase.from("payout_details").upsert(
      { identity_id: identityId, iban, iban_last4: last4(iban), updated_at: new Date().toISOString() },
      { onConflict: "identity_id" },
    );
    if (error) return json({ error: "save_failed", detail: error.message }, 500);
    return json({ status: "saved", iban_last4: last4(iban) });
  }

  // ── everything below is TOP-ADMIN only ──
  if (!(await isTopAdmin(authId))) return json({ error: "forbidden" }, 403);

  if (body.action === "export") {
    // Pending cashback claims joined to their payout IBAN.
    const { data } = await supabase.from("claims")
      .select("id, payout_amount, created_at, user_id, users(identity_id)")
      .eq("type", "cashback").eq("status", "pending");
    const rows = [];
    for (const c of data ?? []) {
      const identityId = (c as { users?: { identity_id?: string } }).users?.identity_id;
      const { data: pd } = await supabase.from("payout_details")
        .select("iban").eq("identity_id", identityId).maybeSingle();
      rows.push({ claim_id: c.id, amount: c.payout_amount, iban: pd?.iban ?? null });
    }
    await supabase.from("payout_exports").insert({
      exported_by: authId, claim_count: rows.length, exported_at: new Date().toISOString(),
    });
    return json({ rows, count: rows.length });
  }

  if (body.action === "reveal" && body.claim_id) {
    const { data: c } = await supabase.from("claims")
      .select("user_id, users(identity_id)").eq("id", body.claim_id).maybeSingle();
    const identityId = (c as { users?: { identity_id?: string } } | null)?.users?.identity_id;
    const { data: pd } = await supabase.from("payout_details")
      .select("iban").eq("identity_id", identityId).maybeSingle();
    await supabase.from("admin_action_log").insert({
      actor_id: authId, action: "iban_revealed", target_id: body.claim_id, target_type: "claim",
    });
    return json({ iban: pd?.iban ?? null });
  }

  if (body.action === "confirm" && body.claim_id) {
    // Mark paid + purge the raw IBAN (keeps amount/date/last4). See migration 028.
    const { error } = await supabase.rpc("confirm_payout_and_purge_iban", { p_claim_id: body.claim_id });
    if (error) return json({ error: "confirm_failed", detail: error.message }, 500);
    return json({ status: "confirmed" });
  }

  return json({ error: "unknown_action" }, 400);
});
