// ──────────────────────────────────────────────────────────────────────────
// PackPerks — restore-by-email Edge Function
//
// User flow:
//   1. Customer lost their cups (cleared cookies, new phone, etc.)
//   2. They open the SignInSheet → switch to "I lost my cups — restore by
//      email" mode.
//   3. The UI calls Supabase Auth signInWithOtp to email them a 6-digit
//      code.
//   4. They type the code → UI calls supabase.auth.verifyOtp → an auth
//      session is created with the email they own.
//   5. UI calls THIS edge function with the current device_id in the
//      body. The function (running as service-role so it can read both
//      sides) does the conservative merge described below.
//
// Merge logic (the actually-tricky part):
//   • Resolve `restored_user`  — the users row tied to the authed email
//     (lookup by auth_user_id → email).
//   • Resolve `device_user`    — the users row tied to body.device_id.
//
//   Cases:
//     A. Same row already       → noop.
//     B. Only device row exists → link it: set auth_user_id + email so
//        future logins from any device with this email find it.
//     C. Only restored row exists → repoint its device_id to the new
//        device. Nothing to merge.
//     D. Both exist + different → MERGE:
//        - SUM cup_balances (never deduct, never lose cups).
//        - Re-point activity_history / claims / cup_scans / cups
//          (shared_by_user_id, activated_by_user_id) FKs from
//          device_user.id → restored_user.id.
//        - Soft-mark the device row as merged (set merged_into) and
//          clear its device_id so it can't accidentally be hit again.
//        - Update restored_user.device_id to the new device so
//          subsequent anonymous reads from this browser land on it.
//
// Required secrets (auto-injected):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
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

async function rateLimit(key: string, windowSecs: number, maxCalls: number): Promise<boolean> {
  const { data: count, error } = await supabase.rpc("check_rate_limit", {
    p_key: key, p_window_seconds: windowSecs, p_max_calls: maxCalls,
  });
  if (error) { console.error("rate_limit check failed:", error.message); return true; }
  return (count as number) <= maxCalls;
}

interface UserRow {
  id: string;
  auth_user_id: string | null;
  device_id: string | null;
  email: string | null;
  org_id: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  // 1. Validate caller's auth session — they must have just verified an
  //    OTP for the email they're restoring from. The verify-otp call on
  //    the client side gave us this JWT.
  const auth = req.headers.get("Authorization") || "";
  const jwt = auth.replace(/^Bearer\s+/i, "");
  if (!jwt) return jsonResponse({ error: "missing_token" }, 401);

  const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
  if (userErr || !userData?.user) {
    return jsonResponse({ error: "invalid_token", detail: userErr?.message }, 401);
  }
  const authUser = userData.user;
  const authEmail = (authUser.email || "").toLowerCase();
  if (!authEmail) return jsonResponse({ error: "no_email_on_token" }, 400);

  // 3 restore attempts per auth user per 15 minutes.
  if (!await rateLimit(`restore:auth:${authUser.id}`, 900, 3))
    return jsonResponse({ error: "rate_limited", detail: "Too many restore attempts. Wait 15 minutes and try again." }, 429);

  // 2. Parse body for the current device id (the LOCAL one — i.e. the
  //    fresh device the user is restoring INTO).
  let deviceId: string | undefined;
  try {
    const body = await req.json();
    deviceId = typeof body?.device_id === "string" ? body.device_id : undefined;
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }
  if (!deviceId) return jsonResponse({ error: "missing_device_id" }, 400);

  // 3. Find the restored side. Prefer auth_user_id, fall back to email
  //    (in case the magic-link flow created the auth.user but never
  //    linked it to a PackPerks row, which can happen if the user
  //    bounced before opening the link).
  const { data: byAuth } = await supabase
    .from("users")
    .select("id, auth_user_id, device_id, email, org_id")
    .eq("auth_user_id", authUser.id)
    .maybeSingle();

  let restoredUser: UserRow | null = (byAuth as UserRow | null) || null;

  if (!restoredUser) {
    const { data: byEmail } = await supabase
      .from("users")
      .select("id, auth_user_id, device_id, email, org_id")
      .eq("email", authEmail)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    restoredUser = (byEmail as UserRow | null) || null;
  }

  // 4. Find the device side (the row the current browser is using).
  const { data: byDevice } = await supabase
    .from("users")
    .select("id, auth_user_id, device_id, email, org_id")
    .eq("device_id", deviceId)
    .maybeSingle();
  const deviceUser: UserRow | null = (byDevice as UserRow | null) || null;

  // ── Case A: same row → already linked, nothing to do ─────────────────
  if (restoredUser && deviceUser && restoredUser.id === deviceUser.id) {
    return jsonResponse({ status: "already_linked", user_id: restoredUser.id });
  }

  // ── Case C: only restored row exists → repoint its device_id ─────────
  // (Should be the most common case for "I lost my cups": the user has
  // history on file but this new browser doesn't have a device row yet.)
  if (restoredUser && !deviceUser) {
    const { error } = await supabase
      .from("users")
      .update({
        device_id: deviceId,
        auth_user_id: authUser.id,
        email: restoredUser.email || authEmail,
        updated_at: new Date().toISOString(),
      })
      .eq("id", restoredUser.id);
    if (error) return jsonResponse({ error: "update_failed", detail: error.message }, 500);
    return jsonResponse({ status: "repointed", user_id: restoredUser.id });
  }

  // ── Case B: only device row exists → link it ─────────────────────────
  // The user typed an email we've never seen before. We turn the
  // current anonymous row into the authenticated one. Future restores
  // (different device, same email) will then land in Case C.
  if (!restoredUser && deviceUser) {
    const { error } = await supabase
      .from("users")
      .update({
        auth_user_id: authUser.id,
        email: authEmail,
        updated_at: new Date().toISOString(),
      })
      .eq("id", deviceUser.id);
    if (error) return jsonResponse({ error: "update_failed", detail: error.message }, 500);
    return jsonResponse({ status: "linked", user_id: deviceUser.id });
  }

  // ── Case D: both exist → CONSERVATIVE MERGE ──────────────────────────
  // We keep `restoredUser` (the email-side, longer history) as the
  // surviving row and absorb `deviceUser` (the current anonymous row)
  // into it. Cups are summed; nothing is ever subtracted.
  if (restoredUser && deviceUser) {
    const survivorId = restoredUser.id;
    const absorbedId = deviceUser.id;

    // A.12 — cross-org guard. If the restored (email) row and the current
    // device row live in DIFFERENT orgs, we must NOT merge: that would move
    // cups/claims across a tenant boundary. Instead, just make sure the
    // restored row is linked to this auth identity and leave the device row
    // (a different org's anonymous account) untouched.
    if ((restoredUser.org_id ?? null) !== (deviceUser.org_id ?? null)) {
      const { error } = await supabase
        .from("users")
        .update({
          auth_user_id: authUser.id,
          email: restoredUser.email || authEmail,
          updated_at: new Date().toISOString(),
        })
        .eq("id", survivorId);
      if (error) return jsonResponse({ error: "update_failed", detail: error.message }, 500);
      return jsonResponse({
        status: "restored_no_merge_cross_org",
        user_id: survivorId,
        device_user_id: absorbedId,
      });
    }

    // Same org → atomic merge (A.10): the RPC sums balances, repoints FKs,
    // deletes the absorbed balance and tombstones the absorbed row inside one
    // transaction, so a mid-way failure can't double-count or orphan claims.
    const { data: mergeRes, error: mergeErr } = await supabase.rpc("merge_user_rows", {
      p_survivor: survivorId,
      p_absorbed: [absorbedId],
      p_enforce_same_org: true,
    });
    if (mergeErr) return jsonResponse({ error: "merge_failed", detail: mergeErr.message }, 500);
    const mergedBalance  = (mergeRes as { merged_balance?: number })?.merged_balance ?? 0;
    const mergedLifetime = (mergeRes as { merged_lifetime?: number })?.merged_lifetime ?? 0;

    // Repoint the survivor's device_id to the current browser so ordinary
    // getOrCreateUser('device') reads resolve straight to it next time.
    const { error: survErr } = await supabase
      .from("users")
      .update({
        device_id: deviceId,
        auth_user_id: authUser.id,
        email: restoredUser.email || authEmail,
        updated_at: new Date().toISOString(),
      })
      .eq("id", survivorId);
    if (survErr) return jsonResponse({ error: "survivor_update_failed", detail: survErr.message }, 500);

    return jsonResponse({
      status: "merged",
      user_id: survivorId,
      absorbed_user_id: absorbedId,
      merged_balance: mergedBalance,
      merged_lifetime: mergedLifetime,
    });
  }

  // ── Neither side exists → nothing to restore ─────────────────────────
  // The authed email has no prior PackPerks footprint. We don't create
  // anything here — the user's next ordinary getOrCreateUser call
  // (from the client) will mint a row in the normal way, and they'll
  // be linked through the standard SIGNED_IN flow.
  return jsonResponse({ status: "no_prior_history" });
});
