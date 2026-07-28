// ──────────────────────────────────────────────────────────────────────────
// PackPerks — bootstrap-admin Edge Function
//
// Called once per user, right after Supabase Auth confirms their email
// (or completes Google OAuth). Responsibilities:
//
//   1. If a row already exists in admin_profiles for this auth user,
//      we're done — return it.
//   2. Otherwise, decide what role to grant:
//        a. If a pending admin_invitations row matches their email,
//           consume it for the ROLE (org is ignored — admins are global).
//        b. Else if NO admin exists yet at all, this user becomes the
//           founding 'owner'.
//        c. Else if their email is on a trusted internal domain
//           (TRUSTED_ADMIN_DOMAINS, e.g. @packback.network), grant 'admin'
//           so staff can self-register with working access — no invite
//           needed.
//        d. Else reject with 403 registration_locked — admin sign-up is
//           locked to @packback.network + invited teammates.
//   3. Insert the profile with org_id = NULL (global: every admin sees
//      and controls all orgs), write a `user.signup` audit log entry,
//      record the first login in `admin_login_history`, and return.
//
// Admins are intentionally NOT tied to an org. org_id is left NULL so the
// org-admin RLS policies ("... OR ap.org_id IS NULL") grant access to all
// orgs' data.
//
// All writes use the service role since admin_profiles has RLS enabled.
// The caller authenticates with their JWT (verify_jwt = true on this fn)
// so the function can trust auth.users(<id>) corresponds to them.
// ──────────────────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Email domains whose users may self-register straight into a working
// 'admin' role (no invitation required). Compared case-insensitively
// against the part after the "@". Keep this list short and trusted —
// every address on these domains gets full admin access on first login.
const TRUSTED_ADMIN_DOMAINS = ["packback.network"];

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

// True when the email's domain is one we trust for self-service admin
// registration. Defensive about malformed addresses (no "@", trailing
// dots, mixed case, surrounding whitespace).
function isTrustedAdminEmail(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const domain = email.slice(at + 1).trim().toLowerCase().replace(/\.$/, "");
  return TRUSTED_ADMIN_DOMAINS.includes(domain);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  // The function gateway has already validated the JWT; we now read the
  // user from the Authorization header to be sure we're acting on the
  // right person (the body's user_id field could be spoofed otherwise).
  const auth = req.headers.get("Authorization") || "";
  const jwt = auth.replace(/^Bearer\s+/i, "");
  if (!jwt) return jsonResponse({ error: "missing_token" }, 401);

  const { data: { user }, error: userErr } = await supabase.auth.getUser(jwt);
  if (userErr || !user) return jsonResponse({ error: "invalid_token", detail: userErr?.message }, 401);

  const userId = user.id;
  const email = user.email || "";
  const provider = (user.app_metadata?.provider as string) || "email";

  // ── 1. Already bootstrapped? Return existing profile.
  const { data: existing, error: existingErr } = await supabase
    .from("admin_profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (existingErr) return jsonResponse({ error: "db_error", detail: existingErr.message }, 500);
  if (existing) {
    // Record this login + bump last_login_at (best effort).
    await supabase.from("admin_login_history").insert({
      admin_id: userId,
      ip: req.headers.get("x-forwarded-for") || null,
      user_agent: req.headers.get("user-agent") || null,
      provider,
    });
    await supabase.from("admin_profiles")
      .update({ last_login_at: new Date().toISOString() })
      .eq("id", userId);
    return jsonResponse({ profile: existing, justCreated: false });
  }

  // ── 2. Decide the role: invitation → founder → trusted domain → checker.
  //    org_id stays NULL in every case — admins are global.
  let role: "owner" | "admin" | "manager" | "checker" = "checker";
  let invitedBy: string | null = null;
  let consumedInvitationId: string | null = null;

  const { data: invitation } = await supabase
    .from("admin_invitations")
    .select("id, org_id, role, invited_by")
    .eq("email", email)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .order("invited_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (invitation) {
    // Honour the invited role; org scoping is ignored (admins are global).
    role = invitation.role as typeof role;
    invitedBy = invitation.invited_by;
    consumedInvitationId = invitation.id;
  } else {
    // No invitation. If there are no admins at all yet, this user is the
    // founding owner. Otherwise, only trusted-domain staff (@packback.network)
    // may self-register, as 'admin'. Everyone else is turned away: admin
    // registration is locked to the internal team + invited teammates.
    const { count } = await supabase
      .from("admin_profiles")
      .select("id", { count: "exact", head: true });
    if ((count ?? 0) === 0) role = "owner";
    else if (isTrustedAdminEmail(email)) role = "admin";
    else
      return jsonResponse(
        {
          error: "registration_locked",
          detail: "Admin access is limited to @packback.network email addresses or invited teammates. Ask a PackPerks admin to invite you.",
        },
        403,
      );
  }

  // ── 3. Insert the profile (org_id = NULL → global admin).
  const { data: profile, error: insertErr } = await supabase
    .from("admin_profiles")
    .insert({
      id: userId,
      org_id: null,
      email,
      display_name: (user.user_metadata?.full_name as string) || null,
      avatar_url: (user.user_metadata?.avatar_url as string) || null,
      role,
      status: "active",
      invited_by: invitedBy,
      last_login_at: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (insertErr)
    return jsonResponse({ error: "profile_insert_failed", detail: insertErr.message }, 500);

  // ── 4. Mark invitation accepted (if any) and write audit log.
  if (consumedInvitationId) {
    await supabase
      .from("admin_invitations")
      .update({ status: "accepted", accepted_at: new Date().toISOString() })
      .eq("id", consumedInvitationId);
  }

  await supabase.from("admin_action_log").insert({
    actor_id: userId,
    actor_email: email,
    org_id: null,
    action: "admin.signup",
    target_type: "admin_profile",
    target_id: userId,
    after_state: { role, provider, invited: !!invitation },
    ip: req.headers.get("x-forwarded-for") || null,
    user_agent: req.headers.get("user-agent") || null,
  });

  await supabase.from("admin_login_history").insert({
    admin_id: userId,
    ip: req.headers.get("x-forwarded-for") || null,
    user_agent: req.headers.get("user-agent") || null,
    provider,
  });

  return jsonResponse({ profile, justCreated: true });
});
