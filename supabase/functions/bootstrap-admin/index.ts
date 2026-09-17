// ──────────────────────────────────────────────────────────────────────────
// PackPerks — bootstrap-admin Edge Function
//
// Called once per user, right after Supabase Auth confirms their email
// (or completes Google OAuth). Responsibilities:
//
//   1. If a row already exists in admin_profiles for this auth user,
//      we're done — return it. An account from before migration 048 gets
//      its role (owner/admin → master, vendor → vendor, else manager).
//      A removed account comes back only through a new invitation.
//   2. Otherwise, decide the role and organisations:
//        a. If a pending admin_invitations row matches their email and was
//           created by an active master, consume it: its role, its
//           organisations.
//        b. Else if NO admin exists yet at all, this user becomes the
//           founding owner, a master.
//        c. Else if their email is on a trusted internal domain
//           (TRUSTED_ADMIN_DOMAINS, e.g. @packback.network), make them a
//           manager of every organisation, so staff can self-register with
//           working access. A master can change that in Master Settings.
//        d. Else reject with 403 registration_locked — admin sign-up is
//           locked to @packback.network + invited people.
//   3. Insert the profile, write an `admin.signup` audit log entry,
//      record the first login in `admin_login_history`, and return.
//
// The old `role` and `org_id` columns are derived from access_role,
// org_ids and all_orgs by a trigger (migration 048).
//
// All writes use the service role since admin_profiles has RLS enabled.
// The caller authenticates with their JWT (verify_jwt = true on this fn)
// so the function can trust auth.users(<id>) corresponds to them.
// ──────────────────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Email domains whose users may self-register as managers (no invitation
// required). Compared case-insensitively against the part after the "@".
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

type Access = { access_role: string; org_ids: string[]; all_orgs: boolean };

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

// The role an account or invitation from before migration 048 maps to.
function legacyAccess(role: string, orgId: string | null): Access {
  if (role === "owner" || role === "admin") return { access_role: "master", org_ids: [], all_orgs: true };
  if (role === "vendor") return { access_role: "vendor", org_ids: orgId ? [orgId] : [], all_orgs: false };
  return { access_role: "manager", org_ids: orgId ? [orgId] : [], all_orgs: !orgId };
}

// Whether an account may hand out access: an active master.
async function isActiveMaster(adminId: string | null): Promise<boolean> {
  if (!adminId) return false;
  const { data } = await supabase
    .from("admin_profiles")
    .select("role, status, access_role")
    .eq("id", adminId)
    .maybeSingle();
  if (!data || data.status !== "active") return false;
  if (data.access_role) {
    const { data: role } = await supabase
      .from("admin_roles")
      .select("level")
      .eq("key", data.access_role)
      .maybeSingle();
    return role?.level === "master";
  }
  return data.role === "owner" || data.role === "admin";
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
  const email = (user.email || "").toLowerCase();
  const provider = (user.app_metadata?.provider as string) || "email";
  const loginRow = {
    admin_id: userId,
    ip: req.headers.get("x-forwarded-for") || null,
    user_agent: req.headers.get("user-agent") || null,
    provider,
  };

  // A pending invitation for this address, created by an active master.
  // invite-admin is its only writer; this makes a row planted any other way
  // worthless. (Until migration 043 any signed-in customer could insert one.)
  async function findInvitation() {
    const { data: found } = await supabase
      .from("admin_invitations")
      .select("id, org_id, role, invited_by, access_role, org_ids, all_orgs")
      .eq("email", email)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .order("invited_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!found) return null;
    if (!await isActiveMaster(found.invited_by)) {
      console.warn(`[bootstrap-admin] ignored invitation ${found.id}: not created by an active master`);
      return null;
    }
    return found;
  }

  function accessFromInvitation(inv: NonNullable<Awaited<ReturnType<typeof findInvitation>>>): Access {
    if (inv.access_role) {
      return {
        access_role: inv.access_role,
        org_ids: Array.isArray(inv.org_ids) ? inv.org_ids : [],
        all_orgs: !!inv.all_orgs,
      };
    }
    return legacyAccess(inv.role, inv.org_id ?? null);
  }

  async function markAccepted(invitationId: string) {
    await supabase
      .from("admin_invitations")
      .update({ status: "accepted", accepted_at: new Date().toISOString() })
      .eq("id", invitationId);
  }

  // ── 1. Already bootstrapped? Return existing profile.
  const { data: existing, error: existingErr } = await supabase
    .from("admin_profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (existingErr) return jsonResponse({ error: "db_error", detail: existingErr.message }, 500);
  if (existing) {
    let profile = existing;
    const patch: Record<string, unknown> = { last_login_at: new Date().toISOString() };
    if (existing.status === "deleted") {
      // A removed person comes back only with a new invitation.
      const invitation = await findInvitation();
      if (invitation) {
        Object.assign(patch, accessFromInvitation(invitation), {
          status: "active",
          invited_by: invitation.invited_by,
        });
        await markAccepted(invitation.id);
      }
    } else if (!existing.access_role) {
      // Created before migration 048 (or by an older build of this function).
      Object.assign(patch, legacyAccess(existing.role, existing.org_id ?? null));
    }
    const { data: updated } = await supabase.from("admin_profiles")
      .update(patch)
      .eq("id", userId)
      .select("*")
      .maybeSingle();
    if (updated) profile = updated;
    await supabase.from("admin_login_history").insert(loginRow);
    return jsonResponse({ profile, justCreated: false });
  }

  // ── 2. Decide the role: invitation → founder → trusted domain → refuse.
  let access: Access;
  let founding = false;
  let invitedBy: string | null = null;
  const invitation = await findInvitation();

  if (invitation) {
    access = accessFromInvitation(invitation);
    invitedBy = invitation.invited_by;
  } else {
    const { count } = await supabase
      .from("admin_profiles")
      .select("id", { count: "exact", head: true });
    if ((count ?? 0) === 0) {
      founding = true;
      access = { access_role: "master", org_ids: [], all_orgs: true };
    } else if (isTrustedAdminEmail(email)) {
      access = { access_role: "manager", org_ids: [], all_orgs: true };
    } else {
      return jsonResponse(
        {
          error: "registration_locked",
          detail: "Dashboard access is limited to @packback.network email addresses and invited people. Ask a PackPerks master to invite you.",
        },
        403,
      );
    }
  }

  // ── 3. Insert the profile. The trigger derives role and org_id.
  const { data: profile, error: insertErr } = await supabase
    .from("admin_profiles")
    .insert({
      id: userId,
      email,
      display_name: (user.user_metadata?.full_name as string) || null,
      avatar_url: (user.user_metadata?.avatar_url as string) || null,
      role: founding ? "owner" : "checker",
      ...access,
      status: "active",
      invited_by: invitedBy,
      last_login_at: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (insertErr)
    return jsonResponse({ error: "profile_insert_failed", detail: insertErr.message }, 500);

  // ── 4. Mark invitation accepted (if any) and write audit log.
  if (invitation) await markAccepted(invitation.id);

  await supabase.from("admin_action_log").insert({
    actor_id: userId,
    actor_email: email,
    org_id: null,
    action: "admin.signup",
    target_type: "admin_profile",
    target_id: userId,
    after_state: { role: profile.role, provider, invited: !!invitation, ...access },
    ip: req.headers.get("x-forwarded-for") || null,
    user_agent: req.headers.get("user-agent") || null,
  });

  await supabase.from("admin_login_history").insert(loginRow);

  return jsonResponse({ profile, justCreated: true });
});
