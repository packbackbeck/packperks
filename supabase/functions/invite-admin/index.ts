// ──────────────────────────────────────────────────────────────────────────
// PackPerks — invite-admin Edge Function (v2 — email + link modes)
//
// Owner / Admin invites a new teammate by EITHER:
//
//   email — Supabase sends the invitation email (default). When the
//           recipient clicks the magic link, bootstrap-admin consumes
//           the invitation row, assigns the role, and marks accepted.
//
//   link  — The function records the invitation row + token but skips
//           the email send. The client builds a URL like
//           `<origin>/admin?invite=<token>` and the inviting admin
//           shares it manually (Slack, WhatsApp, etc.). Same token,
//           same bootstrap flow.
//
// `single_use` controls whether the invitation is consumed on first
// sign-in (default true) or remains valid for any number of teammates
// until the 14-day expiry passes.
//
// Body: {
//   email?:      string                   // required when method='email'
//   role:        'admin'|'manager'|'checker'
//   method?:     'email' | 'link'         // default 'email'
//   single_use?: boolean                  // default true (only meaningful for link mode)
// }
// Returns: 200 { invitation } | 4xx { error }
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_ROLES = new Set(["admin", "manager", "checker"]);
const ALLOWED_METHODS = new Set(["email", "link"]);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "content-type": "application/json" },
  });
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

  const { data: caller } = await supabase
    .from("admin_profiles")
    .select("id, role, org_id, email, display_name, status")
    .eq("id", user.id)
    .maybeSingle();
  if (!caller || caller.status !== "active")
    return jsonResponse({ error: "not_an_admin" }, 403);
  if (caller.role !== "owner" && caller.role !== "admin")
    return jsonResponse({ error: "insufficient_role" }, 403);

  let body: { email?: string; role?: string; method?: string; single_use?: boolean };
  try { body = await req.json(); } catch { return jsonResponse({ error: "invalid_json" }, 400); }
  const role = String(body?.role || "");
  const methodRaw = String(body?.method || "email").toLowerCase();
  if (!ALLOWED_METHODS.has(methodRaw))
    return jsonResponse({ error: "invalid_method", detail: `method must be 'email' or 'link'` }, 400);
  const method = methodRaw as "email" | "link";
  const singleUse = body?.single_use === undefined ? true : !!body.single_use;
  if (!ALLOWED_ROLES.has(role))
    return jsonResponse({ error: "invalid_role", detail: `role must be one of: ${[...ALLOWED_ROLES].join(", ")}` }, 400);

  const rawEmail = String(body?.email || "").trim().toLowerCase();
  if (method === "email" && !EMAIL_RE.test(rawEmail))
    return jsonResponse({ error: "invalid_email" }, 400);
  if (method === "link" && rawEmail && !EMAIL_RE.test(rawEmail))
    return jsonResponse({ error: "invalid_email" }, 400);
  const email = method === "link" && !rawEmail
    ? `link-invite+${makeToken().slice(0, 8)}@invites.local`
    : rawEmail;

  if (method === "email") {
    const { data: existing } = await supabase
      .from("admin_profiles")
      .select("id")
      .eq("email", email)
      .eq("org_id", caller.org_id)
      .maybeSingle();
    if (existing)
      return jsonResponse({ error: "already_member", detail: `${email} is already on the team.` }, 409);
  }

  let invitationId: string;
  const token = makeToken();
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

  if (method === "email") {
    const { data: pending } = await supabase
      .from("admin_invitations")
      .select("id")
      .eq("email", email)
      .eq("org_id", caller.org_id)
      .eq("status", "pending")
      .maybeSingle();
    if (pending) {
      invitationId = pending.id;
      await supabase.from("admin_invitations").update({
        role,
        invited_by: caller.id,
        invited_at: now,
        expires_at: expires,
        token,
        method,
        single_use: singleUse,
      }).eq("id", invitationId);
    } else {
      const { data: inserted, error: insErr } = await supabase
        .from("admin_invitations")
        .insert({
          org_id: caller.org_id,
          email,
          role,
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
  } else {
    const { data: inserted, error: insErr } = await supabase
      .from("admin_invitations")
      .insert({
        org_id: caller.org_id,
        email,
        role,
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
        org_id: caller.org_id,
        role,
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
    org_id: caller.org_id,
    action: "team.invite",
    target_type: "admin_invitation",
    target_id: invitationId,
    after_state: { email, role, method, single_use: singleUse },
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
