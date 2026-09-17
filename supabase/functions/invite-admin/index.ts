// ──────────────────────────────────────────────────────────────────────────
// PackPerks — invite-admin Edge Function (v3 — roles and organisations)
//
// A master invites a new person by EITHER:
//
//   email — Supabase sends the invitation email (default). When the
//           recipient clicks the magic link, bootstrap-admin consumes
//           the invitation row, gives them the role and organisations,
//           and marks it accepted.
//
//   link  — The function records the invitation row + token but skips
//           the email send. The client builds a URL like
//           `<origin>/admin?invite=<token>` and the inviting master
//           shares it manually (Slack, WhatsApp, etc.).
//
// `single_use` controls whether the invitation is consumed on first
// sign-in (default true) or remains valid for any number of teammates
// until the 14-day expiry passes.
//
// Body: {
//   email?:       string            // required when method='email'
//   access_role?: string            // an admin_roles key (migration 048)
//   org_ids?:     uuid[]            // the organisations they will see
//   all_orgs?:    boolean           // every organisation, now and later
//   role?:        'admin'|'manager'|'checker'|'vendor'   // older clients
//   org_id?:      uuid                                   // older clients
//   method?:      'email' | 'link'  // default 'email'
//   single_use?:  boolean           // default true (link mode only)
// }
// A master role always sees every organisation. Any other role needs
// `all_orgs` or at least one organisation.
// Returns: 200 { invitation } | 4xx { error, detail }
// ──────────────────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LEGACY_ROLES: Record<string, string> = {
  admin: "master", manager: "manager", checker: "viewer", vendor: "vendor",
};
const ALLOWED_METHODS = new Set(["email", "link"]);

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

function makeToken() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a).map(b => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const auth = req.headers.get("Authorization") || "";
  const jwt = auth.replace(/^Bearer\s+/i, "");
  if (!jwt) return jsonResponse({ error: "missing_token" }, 401);
  const { data: { user }, error: userErr } = await supabase.auth.getUser(jwt);
  if (userErr || !user) return jsonResponse({ error: "invalid_token" }, 401);

  // H-5: read the caller through a client scoped to their own JWT, so row
  // level security is a second layer on top of the token check above.
  const callerSupabase = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });

  const { data: caller } = await callerSupabase
    .from("admin_profiles")
    .select("id, role, email, display_name, status")
    .eq("id", user.id)
    .maybeSingle();
  if (!caller || caller.status !== "active")
    return jsonResponse({ error: "not_an_admin" }, 403);
  // Only masters add people. is_master() also covers accounts that still
  // carry the old owner/admin role.
  const { data: isMaster } = await callerSupabase.rpc("is_master");
  if (isMaster !== true)
    return jsonResponse({ error: "insufficient_role", detail: "Only a master can add people." }, 403);

  // 10 invitations per master per hour.
  if (!await rateLimit(`invite-admin:admin:${caller.id}`, 3600, 10))
    return jsonResponse({ error: "rate_limited", detail: "Too many invitations sent this hour. Try again later." }, 429);

  let body: {
    email?: string; access_role?: string; org_ids?: unknown; all_orgs?: boolean;
    role?: string; org_id?: string; method?: string; single_use?: boolean;
  };
  try { body = await req.json(); } catch { return jsonResponse({ error: "invalid_json" }, 400); }

  const methodRaw = String(body?.method || "email").toLowerCase();
  if (!ALLOWED_METHODS.has(methodRaw))
    return jsonResponse({ error: "invalid_method", detail: "method must be 'email' or 'link'" }, 400);
  const method = methodRaw as "email" | "link";
  const singleUse = body?.single_use === undefined ? true : !!body.single_use;

  // The role: an admin_roles key, or an old role name mapped onto one.
  const roleKey = body?.access_role
    ? String(body.access_role)
    : LEGACY_ROLES[String(body?.role || "")] || "";
  const { data: accessRole } = roleKey
    ? await supabase.from("admin_roles").select("key, level").eq("key", roleKey).maybeSingle()
    : { data: null };
  if (!accessRole)
    return jsonResponse({ error: "invalid_role", detail: "Pick a role that exists in Master Settings." }, 400);
  const isMasterRole = accessRole.level === "master";

  // The organisations.
  const requested = Array.isArray(body?.org_ids)
    ? body.org_ids
    : (body?.org_id ? [body.org_id] : []);
  const orgIds = [...new Set(requested.map(String))];
  if (orgIds.some(id => !UUID_RE.test(id)))
    return jsonResponse({ error: "invalid_org", detail: "One of those organisations does not exist." }, 400);
  if (orgIds.length) {
    const { data: live } = await supabase
      .from("organizations")
      .select("id")
      .in("id", orgIds)
      .is("deleted_at", null);
    if ((live || []).length !== orgIds.length)
      return jsonResponse({ error: "invalid_org", detail: "One of those organisations does not exist." }, 400);
  }
  // Old clients sent staff invitations with no org: those saw everything.
  const legacyGlobal = !body?.access_role && !body?.org_id && body?.role !== "vendor";
  const allOrgs = isMasterRole || body?.all_orgs === true || legacyGlobal;
  if (!allOrgs && orgIds.length === 0)
    return jsonResponse({ error: "org_required", detail: "Pick at least one organisation, or they will see nothing." }, 400);

  const rawEmail = String(body?.email || "").trim().toLowerCase();
  if (method === "email" && !EMAIL_RE.test(rawEmail))
    return jsonResponse({ error: "invalid_email", detail: "That email address doesn't look right." }, 400);
  if (method === "link" && rawEmail && !EMAIL_RE.test(rawEmail))
    return jsonResponse({ error: "invalid_email", detail: "That email address doesn't look right." }, 400);
  const email = method === "link" && !rawEmail
    ? `link-invite+${makeToken().slice(0, 8)}@invites.local`
    : rawEmail;

  if (method === "email") {
    const { data: existing } = await supabase
      .from("admin_profiles")
      .select("id, status")
      .eq("email", email)
      .maybeSingle();
    if (existing && existing.status !== "deleted")
      return jsonResponse({ error: "already_member", detail: `${email} already has dashboard access. Change their role in People.` }, 409);
  }

  const access = {
    access_role: accessRole.key,
    org_ids: allOrgs ? [] : orgIds,
    all_orgs: allOrgs,
  };
  let invitationId: string;
  const token = makeToken();
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  // `role` and `org_id` are derived from the fields above by a trigger; the
  // insert still has to name a valid old role for the column's check.
  const legacyRole = isMasterRole ? "admin" : accessRole.level === "vendor" ? "vendor" : "manager";

  const { data: pending } = method === "email"
    ? await supabase
      .from("admin_invitations")
      .select("id")
      .eq("email", email)
      .eq("status", "pending")
      .order("invited_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    : { data: null };

  if (pending) {
    invitationId = pending.id;
    // No `role` here: the trigger derives it from access_role, and an old
    // role name alongside an unchanged access_role would be read as a
    // request to switch roles the old way.
    const { error: updErr } = await supabase.from("admin_invitations").update({
      ...access,
      invited_by: caller.id,
      invited_at: now,
      expires_at: expires,
      token,
      method,
      single_use: singleUse,
    }).eq("id", invitationId);
    if (updErr) return jsonResponse({ error: "db_error", detail: updErr.message }, 500);
  } else {
    const { data: inserted, error: insErr } = await supabase
      .from("admin_invitations")
      .insert({
        email,
        role: legacyRole,
        ...access,
        token,
        invited_by: caller.id,
        invited_at: now,
        expires_at: expires,
        status: "pending",
        method,
        single_use: singleUse,
      })
      .select("id")
      .single();
    if (insErr) return jsonResponse({ error: "db_error", detail: insErr.message }, 500);
    invitationId = inserted.id;
  }

  if (method === "email") {
    const { error: inviteErr } = await supabase.auth.admin.inviteUserByEmail(email, {
      data: {
        access_role: accessRole.key,
        invited_by: caller.display_name || caller.email,
        invitation_id: invitationId,
      },
      redirectTo: `${new URL(req.url).origin.replace(/\.supabase\.co.*$/, "")}/admin`,
    });
    if (inviteErr) {
      console.error("inviteUserByEmail failed:", inviteErr);
      return jsonResponse({
        error: "email_send_failed",
        detail: inviteErr.message,
        invitation_id: invitationId,
      }, 502);
    }
  }

  await supabase.from("admin_action_log").insert({
    actor_id: caller.id,
    actor_email: caller.email,
    org_id: null,
    action: "team.invite",
    target_type: "admin_invitation",
    target_id: invitationId,
    after_state: { email, method, single_use: singleUse, ...access },
    ip: req.headers.get("x-forwarded-for") || null,
    user_agent: req.headers.get("user-agent") || null,
  });

  const { data: invitation } = await supabase
    .from("admin_invitations")
    .select("*")
    .eq("id", invitationId)
    .maybeSingle();

  return jsonResponse({ invitation });
});
