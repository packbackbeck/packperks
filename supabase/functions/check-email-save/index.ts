// ──────────────────────────────────────────────────────────────────────────
// PackPerks — check-email-save Edge Function
//
// Called by the customer-side "save your email" form. Anonymous: no JWT.
//
// Behaviour:
//   1. Resolve the calling device's `users` row via body.device_id.
//   2. Count OTHER users in the SAME org with the same email (case-insens.,
//      excluding `merged_into != null` rows).
//   3a. If 0 → save the email onto the device user (no verification needed)
//       and return { status: "saved" }.
//   3b. If ≥1 → DO NOT save. Return { status: "merge_required", other_count }
//       so the client can switch to the OTP-verify-and-merge flow.
//
// The "no other accounts" path keeps the existing frictionless save UX; the
// "merge_required" path prevents new same-email duplicates from being
// created (which is how Samuel ended up on 4 accounts).
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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "content-type": "application/json" },
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  let email = "";
  let deviceId = "";
  let orgId = "";
  try {
    const body = await req.json();
    email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    deviceId = typeof body?.device_id === "string" ? body.device_id : "";
    orgId = typeof body?.org_id === "string" ? body.org_id : "";
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }
  if (!EMAIL_RE.test(email)) return jsonResponse({ error: "invalid_email" }, 400);
  if (!deviceId) return jsonResponse({ error: "missing_device_id" }, 400);

  // ── Resolve the device user ───────────────────────────────────────────
  // A device can have ONE users row PER ORG (multi-venue groups), so a bare
  // `.eq(device_id).maybeSingle()` explodes with "multiple (or no) rows
  // returned". Scope by org when the client sends it; otherwise take the most
  // recent non-merged row for this device.
  let q = supabase
    .from("users")
    .select("id, org_id, email, merged_into, updated_at")
    .eq("device_id", deviceId)
    .is("merged_into", null);
  if (orgId) q = q.eq("org_id", orgId);
  const { data: deviceRows, error: devErr } = await q
    .order("updated_at", { ascending: false })
    .limit(1);
  if (devErr) return jsonResponse({ error: "db_error", detail: devErr.message }, 500);
  const deviceUser = deviceRows?.[0];
  if (!deviceUser) return jsonResponse({ error: "device_user_not_found" }, 404);

  // ── Count OTHER same-email accounts in the same org ──────────────────
  // (case-insensitive; ignore tombstoned `merged_into` rows; exclude self)
  const { data: others, error: othersErr } = await supabase
    .from("users")
    .select("id")
    .eq("org_id", deviceUser.org_id)
    .ilike("email", email)
    .is("merged_into", null)
    .neq("id", deviceUser.id);
  if (othersErr) return jsonResponse({ error: "db_error", detail: othersErr.message }, 500);

  if ((others?.length ?? 0) > 0) {
    return jsonResponse({
      status: "merge_required",
      other_count: others!.length,
    });
  }

  // ── No conflicts → save the email on the device user ─────────────────
  const { error: saveErr } = await supabase
    .from("users")
    .update({ email, updated_at: new Date().toISOString() })
    .eq("id", deviceUser.id);
  if (saveErr) return jsonResponse({ error: "save_failed", detail: saveErr.message }, 500);

  return jsonResponse({ status: "saved" });
});
