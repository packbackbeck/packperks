// ──────────────────────────────────────────────────────────────────────────
// PackPerks: staff-app Edge Function (v3)
//
// Everything the PackPerks Staff web app (/staff) does, plus the dashboard's
// Staff app page. Migrations 050 and 053 have the tables.
//
// Body: { action, ...fields }
//
// Without a login:
//   signup_request  { email, org_id?, name? }          emails a 6-digit code
//                   An email on no staff list gets `not_on_list` with the
//                   venues that run the app; asked again with org_id, it is
//                   a request to join that venue.
//   signup_verify   { email, code, password, name? }   creates or links the login
//   reset_request   { email }                          emails a code (always "ok")
//   reset_verify    { email, code, password }          sets a new password
//   preview         { org_id }                         venue, colours, limits
//
// Signed in, not yet staff:
//   join            { org_id }           asks to join a venue with this login
//
// Signed in as staff (Authorization: Bearer <jwt>):
//   me                                   profile, venue, colours and limits
//   mint            { cups, package_type }  a cup batch and its QR link
//   list            { before?, day_start? }  this person's codes, newest first
//   status          { id }               one code, for the live QR screen
//   cancel          { id }               revokes an unclaimed code
//   update_profile  { name?, avatar_url? }
//   email_request   { new_email }        emails a code to the new address
//   email_verify    { code }             switches the login to that address
//
// Signed in to the dashboard, for one venue (the Staff app tab):
//   admin_state     { org_id, before? }  switch, staff with totals, requests, log
//   admin_approve   { org_id, id }       view access is enough
//   admin_decline   { org_id, id }       view access is enough
//   admin_toggle    { org_id, enabled }  edit access
//   admin_invite    { org_id, emails[] } edit access
//   admin_status    { org_id, id, status }  edit access (active | blocked)
//   admin_remove    { org_id, id }       edit access
//   admin_resend    { org_id, id }       edit access
//
// Requests wait for approval, except PackBack's own addresses
// (TRUSTED_DOMAIN), which are active at once.
//
// A staff QR code is a normal cup batch (`cups` rows sharing a batch_id,
// source admin_batch), so the customer app claims it through claim-cups
// exactly like a printed receipt. It expires after CODE_TTL_MIN minutes.
// ──────────────────────────────────────────────────────────────────────────
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY") ?? "";
const BREVO_SENDER_EMAIL = Deno.env.get("BREVO_SENDER_EMAIL") ?? "noreply@packback.network";
const BREVO_SENDER_NAME = Deno.env.get("BREVO_SENDER_NAME") ?? "PackPerks";
const APP_BASE = (Deno.env.get("APP_BASE_URL") || "https://perks.packback.network").trim().replace(/\/+$/, "");

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ── Limits ──────────────────────────────────────────────────────────────
const MAX_CUPS = 5;                  // cups in one code
const PACKAGES = ["cup"];            // package types staff can pick
const CODE_TTL_MIN = 15;             // a code on screen works this long
const MINTS_PER_HOUR = 60;           // per staff member
const CUPS_PER_DAY = 400;            // per staff member, rolling 24 hours
const EMAIL_CODE_TTL_MIN = 10;
const EMAIL_CODE_ATTEMPTS = 5;
const PASSWORD_MIN = 8;
const TRUSTED_DOMAIN = "packback.network"; // joins without approval

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAFF_COLS = "id, org_id, email, name, avatar_url, auth_user_id, status, created_at, activated_at, requested_at, approved_at, last_seen_at";
const ORG_COLS = "id, name, slug, logo_url, brand_color, country, staff_app_enabled, deleted_at";

type Json = Record<string, unknown>;
type Staff = {
  id: string; org_id: string; email: string; name: string | null; avatar_url: string | null;
  auth_user_id: string | null; status: string; created_at: string; activated_at: string | null;
  requested_at: string | null; approved_at: string | null; last_seen_at: string | null;
};
type Org = {
  id: string; name: string; slug: string; logo_url: string | null; brand_color: string | null;
  country: string | null; staff_app_enabled: boolean; deleted_at: string | null;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "content-type": "application/json" },
  });
}
const fail = (error: string, status: number, detail?: string, extra?: Json) =>
  json({ error, ...(detail ? { detail } : {}), ...(extra || {}) }, status);

function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
}
function bearer(req: Request): string {
  return (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
}
const normEmail = (v: unknown) => String(v ?? "").trim().toLowerCase();
const trusted = (email: string) => email.endsWith(`@${TRUSTED_DOMAIN}`);

async function rateLimit(key: string, windowSecs: number, maxCalls: number): Promise<boolean> {
  const { data: count, error } = await supabase.rpc("check_rate_limit", {
    p_key: key, p_window_seconds: windowSecs, p_max_calls: maxCalls,
  });
  if (error) { console.error("[staff-app] rate limit check failed:", error.message); return true; }
  return (count as number) <= maxCalls;
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function sixDigits(): string {
  const n = new Uint32Array(1);
  crypto.getRandomValues(n);
  return String(n[0] % 1_000_000).padStart(6, "0");
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

// ── Email ───────────────────────────────────────────────────────────────
function emailShell(inner: string): string {
  return `<!doctype html><html><body style="margin:0;background:#F4EBDC;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1D1D1D">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:460px;background:#FFFFFF;border-radius:22px;border:1px solid #ECE5D8">
<tr><td style="padding:28px 28px 8px"><p style="margin:0;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#5333A5">PackPerks Staff</p></td></tr>
<tr><td style="padding:8px 28px 28px;font-size:15px;line-height:1.6">${inner}</td></tr>
</table>
<p style="margin:16px 0 0;font-size:12px;color:#8A8177">PackPerks by PackBack</p>
</td></tr></table></body></html>`;
}

async function sendEmail(to: string, subject: string, html: string, text: string): Promise<boolean> {
  if (!BREVO_API_KEY) { console.error("[staff-app] BREVO_API_KEY missing"); return false; }
  try {
    const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": BREVO_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({
        sender: { email: BREVO_SENDER_EMAIL, name: BREVO_SENDER_NAME },
        to: [{ email: to }],
        subject,
        htmlContent: html,
        textContent: text,
      }),
    });
    if (!resp.ok) console.error(`[staff-app] brevo ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    return resp.ok;
  } catch (e) {
    console.error("[staff-app] email failed:", String(e));
    return false;
  }
}

const CODE_COPY: Record<string, { lead: string; subject: string }> = {
  signup: { lead: "Here is your code to finish creating your staff account", subject: "is your PackPerks Staff sign-up code" },
  reset: { lead: "Here is your code to set a new password", subject: "is your PackPerks Staff password code" },
  email_change: { lead: "Here is your code to use this email address for PackPerks Staff", subject: "is your PackPerks Staff email code" },
};

/* Who a code belongs to: an existing staff row, or (a request to join)
 * the venue and name the person asked with. */
type CodeOwner = { staffId: string | null; orgId?: string | null; name?: string | null };

async function sendCode(purpose: string, email: string, owner: CodeOwner, venue: string): Promise<boolean> {
  const code = sixDigits();
  let clear = supabase.from("staff_email_codes").delete().eq("purpose", purpose);
  clear = owner.staffId ? clear.eq("staff_id", owner.staffId) : clear.eq("email", email).is("staff_id", null);
  await clear;
  const { data: row, error } = await supabase.from("staff_email_codes").insert({
    purpose,
    email,
    staff_id: owner.staffId,
    org_id: owner.orgId ?? null,
    name: owner.name ?? null,
    code_hash: await sha256Hex(`${purpose}:${email}:${code}`),
    expires_at: new Date(Date.now() + EMAIL_CODE_TTL_MIN * 60_000).toISOString(),
  }).select("id").single();
  if (error) { console.error("[staff-app] code insert failed:", error.message); return false; }
  const copy = CODE_COPY[purpose];
  const html = emailShell(
    `<p style="margin:0 0 12px">${copy.lead}${venue ? ` at <b>${esc(venue)}</b>` : ""}:</p>` +
    `<p style="margin:0 0 16px;font-size:34px;font-weight:800;letter-spacing:.22em;color:#1D1D1D">${code}</p>` +
    `<p style="margin:0;color:#6C6259">It works for ${EMAIL_CODE_TTL_MIN} minutes. If you did not ask for it, you can ignore this email.</p>`,
  );
  const text = `${copy.lead}${venue ? ` at ${venue}` : ""}: ${code}\n\nIt works for ${EMAIL_CODE_TTL_MIN} minutes. If you did not ask for it, you can ignore this email.`;
  const sent = await sendEmail(email, `${code} ${copy.subject}`, html, text);
  if (!sent) await supabase.from("staff_email_codes").delete().eq("id", row.id);
  return sent;
}

type CodeRowOut = { email: string; org_id: string | null; name: string | null };

/* Checks a code and uses it up. Returns an error code, or the code's row. */
async function useCode(
  purpose: string, staffId: string | null, email: string | null, code: string,
): Promise<{ error: string } | { row: CodeRowOut }> {
  if (!/^\d{6}$/.test(code)) return { error: "code_invalid" };
  let q = supabase.from("staff_email_codes")
    .select("id, email, org_id, name, code_hash, attempts, expires_at")
    .eq("purpose", purpose);
  q = staffId ? q.eq("staff_id", staffId) : q.is("staff_id", null);
  if (email) q = q.eq("email", email);
  const { data: row } = await q.order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!row) return { error: "code_invalid" };
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await supabase.from("staff_email_codes").delete().eq("id", row.id);
    return { error: "code_expired" };
  }
  if (row.attempts >= EMAIL_CODE_ATTEMPTS) {
    await supabase.from("staff_email_codes").delete().eq("id", row.id);
    return { error: "too_many_attempts" };
  }
  const hash = await sha256Hex(`${purpose}:${row.email}:${code}`);
  if (!sameHex(hash, row.code_hash)) {
    await supabase.from("staff_email_codes").update({ attempts: row.attempts + 1 }).eq("id", row.id);
    return { error: row.attempts + 1 >= EMAIL_CODE_ATTEMPTS ? "too_many_attempts" : "code_invalid" };
  }
  await supabase.from("staff_email_codes").delete().eq("id", row.id);
  return { row: { email: row.email, org_id: row.org_id, name: row.name } };
}

// ── Lookups ─────────────────────────────────────────────────────────────
async function staffByEmail(email: string): Promise<Staff | null> {
  const { data } = await supabase.from("staff_members").select(STAFF_COLS).eq("email", email).maybeSingle();
  return (data as Staff) || null;
}
async function orgById(id: string): Promise<Org | null> {
  const { data } = await supabase.from("organizations").select(ORG_COLS).eq("id", id).maybeSingle();
  return (data as Org) || null;
}
const appOn = (org: Org | null) => !!org && !org.deleted_at && org.staff_app_enabled;

/* Venues that run the app, for someone asking to join one. */
async function openVenues() {
  const { data } = await supabase.from("organizations")
    .select("id, name, logo_url")
    .eq("staff_app_enabled", true).is("deleted_at", null)
    .order("name");
  return (data || []) as { id: string; name: string; logo_url: string | null }[];
}

/* The venue's customer-app colours (App design), so the staff app matches. */
const COLOUR_KEYS = ["primary", "accent", "accentDeep", "background", "surface", "text", "textMuted", "success"];
async function designFor(orgId: string) {
  const { data } = await supabase.from("app_config").select("value").eq("key", `published:${orgId}`).maybeSingle();
  const raw = (data?.value as Json | undefined)?.settings as Json | undefined;
  const colours = ((raw?.design as Json | undefined)?.colors || {}) as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const k of COLOUR_KEYS) {
    const v = colours[k];
    if (typeof v === "string" && /^#[0-9a-f]{3,8}$/i.test(v.trim())) out[k] = v.trim();
  }
  return { colors: out };
}

const venueOut = (org: Org) => ({
  id: org.id, name: org.name, slug: org.slug, logo_url: org.logo_url, brand_color: org.brand_color, country: org.country,
});
const LIMITS = { max_cups: MAX_CUPS, packages: PACKAGES, code_minutes: CODE_TTL_MIN };

function profileOut(staff: Staff, org: Org, design?: unknown) {
  return {
    profile: {
      id: staff.id,
      email: staff.email,
      name: staff.name,
      avatar_url: staff.avatar_url,
      since: staff.activated_at || staff.created_at,
    },
    venue: venueOut(org),
    ...(design ? { design } : {}),
    limits: LIMITS,
  };
}

type Ctx = { userId: string; staff: Staff; org: Org };

/* The signed-in staff member, or an error response. */
async function authStaff(req: Request): Promise<Ctx | Response> {
  const jwt = bearer(req);
  if (!jwt) return fail("missing_token", 401);
  const { data: { user }, error } = await supabase.auth.getUser(jwt);
  if (error || !user) return fail("invalid_token", 401);

  let staff: Staff | null = null;
  {
    const { data } = await supabase.from("staff_members").select(STAFF_COLS).eq("auth_user_id", user.id).maybeSingle();
    staff = (data as Staff) || null;
  }
  // An invited address that already had a confirmed login (for example a
  // customer or dashboard account) is linked on its first sign-in.
  if (!staff && user.email && user.email_confirmed_at) {
    const invited = await staffByEmail(normEmail(user.email));
    if (invited && !invited.auth_user_id && invited.status === "invited") {
      const now = new Date().toISOString();
      const { data } = await supabase.from("staff_members")
        .update({ auth_user_id: user.id, status: "active", activated_at: invited.activated_at || now, updated_at: now })
        .eq("id", invited.id).is("auth_user_id", null)
        .select(STAFF_COLS).maybeSingle();
      staff = (data as Staff) || null;
    }
  }
  if (!staff) {
    // A confirmed login can ask to join a venue from the app.
    const email = normEmail(user.email);
    return fail("not_staff", 403, undefined, {
      venues: user.email_confirmed_at ? await openVenues() : [],
      trusted: trusted(email),
      email,
    });
  }
  if (staff.status === "blocked") return fail("blocked", 403);
  const org = await orgById(staff.org_id);
  if (!appOn(org)) return fail("app_off", 403);
  if (staff.status === "requested") {
    return fail("pending_approval", 403, undefined, {
      venue: venueOut(org!), design: await designFor(org!.id), email: staff.email, requested_at: staff.requested_at,
    });
  }
  return { userId: user.id, staff, org: org! };
}

// ── Codes ───────────────────────────────────────────────────────────────
type CodeRow = { batch_id: string; cups: number; package_type: string; created_at: string; expires_at: string; cancelled_at: string | null };

async function describe(rows: CodeRow[], org: Org) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.batch_id);
  const { data: cups } = await supabase.from("cups")
    .select("batch_id, status, activated_at, revoked_at")
    .in("batch_id", ids);
  const byBatch = new Map<string, { claimed: number; claimedAt: string | null }>();
  for (const c of cups || []) {
    const b = byBatch.get(c.batch_id) || { claimed: 0, claimedAt: null };
    if (c.status === "activated") {
      b.claimed += 1;
      if (c.activated_at && (!b.claimedAt || c.activated_at > b.claimedAt)) b.claimedAt = c.activated_at;
    }
    byBatch.set(c.batch_id, b);
  }
  const now = Date.now();
  return rows.map((r) => {
    const b = byBatch.get(r.batch_id) || { claimed: 0, claimedAt: null };
    let status = "waiting";
    if (b.claimed >= r.cups) status = "claimed";
    else if (b.claimed > 0) status = "partly_claimed";
    else if (r.cancelled_at) status = "cancelled";
    else if (new Date(r.expires_at).getTime() <= now) status = "expired";
    return {
      id: r.batch_id,
      cups: r.cups,
      package_type: r.package_type,
      created_at: r.created_at,
      expires_at: r.expires_at,
      cancelled_at: r.cancelled_at,
      claimed_cups: b.claimed,
      claimed_at: b.claimedAt,
      status,
      url: status === "waiting" ? `${APP_BASE}/${org.slug}/?batch=${r.batch_id}` : null,
    };
  });
}

async function logEvent(org: Org, userId: string, status: string, count: number, detail: Json) {
  try {
    await supabase.from("system_events").insert({
      org_id: org.id, event_type: "qr_generation", status, count, detail, actor_id: userId,
    });
  } catch (e) {
    console.error("[staff-app] system_events insert failed:", String(e));
  }
}

// ── Handlers ────────────────────────────────────────────────────────────
async function signupRequest(req: Request, body: Json) {
  const email = normEmail(body.email);
  if (!EMAIL_RE.test(email)) return fail("invalid_email", 400);
  if (!await rateLimit(`staff-code:ip:${clientIp(req)}`, 3600, 20)) return fail("rate_limited", 429);
  const staff = await staffByEmail(email);

  // Not on a list: offer the venues that run the app, then take a request.
  if (!staff) {
    const venues = await openVenues();
    const orgId = String(body.org_id || "");
    if (!orgId) return fail("not_on_list", 404, undefined, { venues, trusted: trusted(email) });
    const venue = venues.find((v) => v.id === orgId);
    if (!venue) return fail("app_off", 403);
    const name = String(body.name ?? "").trim().slice(0, 60) || null;
    if (!await rateLimit(`staff-code:signup:${email}`, 900, 3)) return fail("rate_limited", 429);
    if (!await sendCode("signup", email, { staffId: null, orgId, name }, venue.name)) return fail("email_failed", 502);
    return json({ ok: true, venue: venue.name, request: !trusted(email) });
  }

  if (staff.status === "blocked") return fail("blocked", 403);
  if (staff.status === "requested") return fail("pending_approval", 409);
  if (staff.auth_user_id && staff.status === "active") return fail("already_signed_up", 409);
  const org = await orgById(staff.org_id);
  if (!appOn(org)) return fail("app_off", 403);
  if (!await rateLimit(`staff-code:signup:${email}`, 900, 3)) return fail("rate_limited", 429);
  if (!await sendCode("signup", email, { staffId: staff.id }, org!.name)) return fail("email_failed", 502);
  return json({ ok: true, venue: org!.name, request: false });
}

/* The login for an email: an existing one (a customer or dashboard account
 * keeps it, with the new password) or a new one. */
async function loginFor(email: string, password: string, name: string, staffId: string | null) {
  const { data: existingId } = await supabase.rpc("staff_auth_user_id", { p_email: email });
  let authId = existingId as string | null;
  if (authId) {
    const { data: taken } = await supabase.from("staff_members").select("id").eq("auth_user_id", authId).maybeSingle();
    if (taken && taken.id !== staffId) return { error: fail("email_taken", 409) };
    const { error } = await supabase.auth.admin.updateUserById(authId, { password, email_confirm: true });
    if (error) return { error: fail("auth_failed", 500, error.message) };
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: name ? { name } : {},
    });
    if (error || !data?.user) return { error: fail("auth_failed", 500, error?.message) };
    authId = data.user.id;
  }
  return { authId: authId!, existing: !!existingId };
}

/* A new staff row for someone who asked to join: active straight away for
 * PackBack addresses, otherwise waiting for approval. */
async function addMember(org: Org, email: string, authId: string, name: string | null) {
  const now = new Date().toISOString();
  const active = trusted(email);
  const { data, error } = await supabase.from("staff_members").insert({
    org_id: org.id,
    email,
    name,
    auth_user_id: authId,
    status: active ? "active" : "requested",
    requested_at: now,
    activated_at: active ? now : null,
    approved_at: active ? now : null,
  }).select(STAFF_COLS).single();
  if (error) return { error: fail(error.code === "23505" ? "email_taken" : "db_error", error.code === "23505" ? 409 : 500, error.message) };
  await supabase.from("admin_action_log").insert({
    actor_id: null,
    actor_email: email,
    org_id: org.id,
    action: active ? "staff.joined" : "staff.request",
    target_type: "staff_member",
    target_id: (data as Staff).id,
    after_state: { email, name, status: (data as Staff).status },
  });
  return { staff: data as Staff };
}

async function signupVerify(req: Request, body: Json) {
  const email = normEmail(body.email);
  const code = String(body.code ?? "").trim();
  const password = String(body.password ?? "");
  const name = String(body.name ?? "").trim().slice(0, 60);
  if (!EMAIL_RE.test(email)) return fail("invalid_email", 400);
  if (password.length < PASSWORD_MIN || password.length > 72) return fail("weak_password", 400);
  if (!await rateLimit(`staff-verify:ip:${clientIp(req)}`, 3600, 40)) return fail("rate_limited", 429);
  const staff = await staffByEmail(email);

  // A request to join: the code carries the venue.
  if (!staff) {
    const used = await useCode("signup", null, email, code);
    if ("error" in used) return fail(used.error, 400);
    const org = used.row.org_id ? await orgById(used.row.org_id) : null;
    if (!appOn(org)) return fail("app_off", 403);
    const login = await loginFor(email, password, name, null);
    if ("error" in login) return login.error;
    const added = await addMember(org!, email, login.authId, name || used.row.name || null);
    if ("error" in added) return added.error;
    return json({ ok: true, existing_login: login.existing, pending: added.staff.status === "requested" });
  }

  if (staff.status === "blocked") return fail("blocked", 403);
  if (staff.status === "requested") return fail("pending_approval", 409);
  if (staff.auth_user_id && staff.status === "active") return fail("already_signed_up", 409);
  const org = await orgById(staff.org_id);
  if (!appOn(org)) return fail("app_off", 403);
  const used = await useCode("signup", staff.id, email, code);
  if ("error" in used) return fail(used.error, 400);

  const login = await loginFor(email, password, name, staff.id);
  if ("error" in login) return login.error;
  const now = new Date().toISOString();
  const { error: upErr } = await supabase.from("staff_members").update({
    auth_user_id: login.authId,
    status: "active",
    activated_at: staff.activated_at || now,
    name: name || staff.name,
    updated_at: now,
  }).eq("id", staff.id);
  if (upErr) return fail("db_error", 500, upErr.message);
  return json({ ok: true, existing_login: login.existing, pending: false });
}

/* A signed-in login that is not staff anywhere asks to join a venue. */
async function join(req: Request, body: Json) {
  const jwt = bearer(req);
  if (!jwt) return fail("missing_token", 401);
  const { data: { user }, error } = await supabase.auth.getUser(jwt);
  if (error || !user) return fail("invalid_token", 401);
  const email = normEmail(user.email);
  if (!email || !user.email_confirmed_at) return fail("not_staff", 403);
  if (!await rateLimit(`staff-join:${user.id}`, 3600, 10)) return fail("rate_limited", 429);
  const { data: mine } = await supabase.from("staff_members").select("id").eq("auth_user_id", user.id).maybeSingle();
  if (mine || await staffByEmail(email)) return fail("already_signed_up", 409);
  const org = await orgById(String(body.org_id || ""));
  if (!appOn(org)) return fail("app_off", 403);
  const name = String(user.user_metadata?.name || user.user_metadata?.full_name || "").trim().slice(0, 60) || null;
  const added = await addMember(org!, email, user.id, name);
  if ("error" in added) return added.error;
  return json({ ok: true, pending: added.staff.status === "requested" });
}

async function resetRequest(req: Request, body: Json) {
  const email = normEmail(body.email);
  if (!EMAIL_RE.test(email)) return fail("invalid_email", 400);
  if (!await rateLimit(`staff-code:ip:${clientIp(req)}`, 3600, 20)) return fail("rate_limited", 429);
  if (!await rateLimit(`staff-code:reset:${email}`, 900, 3)) return fail("rate_limited", 429);
  const staff = await staffByEmail(email);
  // The answer is the same whether or not the address has an account.
  if (staff && staff.auth_user_id && staff.status === "active") {
    const org = await orgById(staff.org_id);
    if (appOn(org) && !await sendCode("reset", email, { staffId: staff.id }, org!.name)) return fail("email_failed", 502);
  }
  return json({ ok: true });
}

async function resetVerify(req: Request, body: Json) {
  const email = normEmail(body.email);
  const code = String(body.code ?? "").trim();
  const password = String(body.password ?? "");
  if (!EMAIL_RE.test(email)) return fail("invalid_email", 400);
  if (password.length < PASSWORD_MIN || password.length > 72) return fail("weak_password", 400);
  if (!await rateLimit(`staff-verify:ip:${clientIp(req)}`, 3600, 40)) return fail("rate_limited", 429);
  const staff = await staffByEmail(email);
  if (!staff || !staff.auth_user_id || staff.status !== "active") return fail("code_invalid", 400);
  const used = await useCode("reset", staff.id, email, code);
  if ("error" in used) return fail(used.error, 400);
  const { error } = await supabase.auth.admin.updateUserById(staff.auth_user_id, { password });
  if (error) return fail("auth_failed", 500, error.message);
  return json({ ok: true });
}

async function mint(ctx: Ctx, body: Json) {
  const { staff, org, userId } = ctx;
  const cups = Number(body.cups);
  const packageType = String(body.package_type || "cup");
  if (!Number.isInteger(cups) || cups < 1 || cups > MAX_CUPS) return fail("invalid_cups", 400);
  if (!PACKAGES.includes(packageType)) return fail("invalid_package", 400);
  if (!await rateLimit(`staff-mint:${staff.id}`, 3600, MINTS_PER_HOUR)) return fail("rate_limited", 429);

  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { data: recent } = await supabase.from("staff_qr_codes")
    .select("cups").eq("staff_id", staff.id).gte("created_at", since).is("cancelled_at", null);
  const used = (recent || []).reduce((t: number, r: { cups: number }) => t + r.cups, 0);
  if (used + cups > CUPS_PER_DAY) return fail("daily_limit", 429, `${CUPS_PER_DAY - used} cups left today`);

  const batchId = crypto.randomUUID();
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + CODE_TTL_MIN * 60_000).toISOString();
  const { error: cupErr } = await supabase.from("cups").insert(
    Array.from({ length: cups }, () => ({
      id: crypto.randomUUID(),
      batch_id: batchId,
      source: "admin_batch",
      status: "available",
      org_id: org.id,
      expires_at: expiresAt,
    })),
  );
  if (cupErr) {
    await logEvent(org, userId, "failure", cups, { via: "staff_app", staff_id: staff.id, error: cupErr.message });
    return fail("mint_failed", 500, cupErr.message);
  }
  const row: CodeRow = {
    batch_id: batchId, cups, package_type: packageType,
    created_at: createdAt.toISOString(), expires_at: expiresAt, cancelled_at: null,
  };
  const { error: codeErr } = await supabase.from("staff_qr_codes").insert({ ...row, org_id: org.id, staff_id: staff.id });
  if (codeErr) {
    await supabase.from("cups").delete().eq("batch_id", batchId).eq("status", "available");
    await logEvent(org, userId, "failure", cups, { via: "staff_app", staff_id: staff.id, error: codeErr.message });
    return fail("mint_failed", 500, codeErr.message);
  }
  await logEvent(org, userId, "success", cups, { batch_id: batchId, via: "staff_app", staff_id: staff.id, package_type: packageType });
  await supabase.from("staff_members").update({ last_seen_at: createdAt.toISOString() }).eq("id", staff.id);
  const [code] = await describe([row], org);
  return json({ code });
}

async function list(ctx: Ctx, body: Json) {
  let q = supabase.from("staff_qr_codes")
    .select("batch_id, cups, package_type, created_at, expires_at, cancelled_at")
    .eq("staff_id", ctx.staff.id)
    .order("created_at", { ascending: false })
    .limit(30);
  if (body.before && !Number.isNaN(Date.parse(String(body.before)))) q = q.lt("created_at", String(body.before));
  const { data, error } = await q;
  if (error) return fail("db_error", 500, error.message);
  const codes = await describe((data || []) as CodeRow[], ctx.org);

  // "Today" starts at the phone's midnight (day_start), within the last
  // 36 hours; otherwise at midnight UTC.
  let dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
  const asked = Date.parse(String(body.day_start || ""));
  if (Number.isFinite(asked) && asked <= Date.now() && asked >= Date.now() - 36 * 3600_000) dayStart = new Date(asked);
  const { data: today } = await supabase.from("staff_qr_codes")
    .select("batch_id, cups, cancelled_at").eq("staff_id", ctx.staff.id).gte("created_at", dayStart.toISOString());
  const live = (today || []).filter((r: { cancelled_at: string | null }) => !r.cancelled_at);
  return json({
    codes,
    has_more: (data || []).length === 30,
    today: { codes: live.length, cups: live.reduce((t: number, r: { cups: number }) => t + r.cups, 0) },
  });
}

async function oneCode(ctx: Ctx, id: string) {
  if (!UUID_RE.test(id)) return null;
  const { data } = await supabase.from("staff_qr_codes")
    .select("batch_id, cups, package_type, created_at, expires_at, cancelled_at")
    .eq("batch_id", id).eq("staff_id", ctx.staff.id).maybeSingle();
  if (!data) return null;
  const [code] = await describe([data as CodeRow], ctx.org);
  return code;
}

async function cancel(ctx: Ctx, body: Json) {
  const code = await oneCode(ctx, String(body.id || ""));
  if (!code) return fail("not_found", 404);
  if (code.status !== "waiting") return json({ code });
  const now = new Date().toISOString();
  await supabase.from("cups")
    .update({ revoked_at: now, revoked_reason: "Cancelled in the staff app" })
    .eq("batch_id", code.id).eq("status", "available");
  await supabase.from("staff_qr_codes").update({ cancelled_at: now }).eq("batch_id", code.id);
  return json({ code: await oneCode(ctx, code.id) });
}

async function updateProfile(ctx: Ctx, body: Json) {
  const patch: Json = { updated_at: new Date().toISOString() };
  if ("name" in body) {
    const name = String(body.name ?? "").trim().slice(0, 60);
    patch.name = name || null;
  }
  if ("avatar_url" in body) {
    const url = body.avatar_url == null ? null : String(body.avatar_url);
    const prefix = `${SUPABASE_URL}/storage/v1/object/public/staff-avatars/${ctx.userId}/`;
    if (url && !url.startsWith(prefix)) return fail("invalid_avatar", 400);
    patch.avatar_url = url;
  }
  const { data, error } = await supabase.from("staff_members")
    .update(patch).eq("id", ctx.staff.id).select(STAFF_COLS).single();
  if (error) return fail("db_error", 500, error.message);
  return json(profileOut(data as Staff, ctx.org, await designFor(ctx.org.id)));
}

async function emailRequest(req: Request, ctx: Ctx, body: Json) {
  const next = normEmail(body.new_email);
  if (!EMAIL_RE.test(next)) return fail("invalid_email", 400);
  if (next === ctx.staff.email) return fail("same_email", 400);
  if (!await rateLimit(`staff-code:email:${ctx.staff.id}`, 900, 3)) return fail("rate_limited", 429);
  if (await staffByEmail(next)) return fail("email_taken", 409);
  const { data: owner } = await supabase.rpc("staff_auth_user_id", { p_email: next });
  if (owner && owner !== ctx.userId) return fail("email_taken", 409);
  if (!await sendCode("email_change", next, { staffId: ctx.staff.id }, ctx.org.name)) return fail("email_failed", 502);
  return json({ ok: true });
}

async function emailVerify(ctx: Ctx, body: Json) {
  const code = String(body.code ?? "").trim();
  const { data: pending } = await supabase.from("staff_email_codes")
    .select("email").eq("purpose", "email_change").eq("staff_id", ctx.staff.id)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!pending) return fail("code_invalid", 400);
  const next = pending.email as string;
  const used = await useCode("email_change", ctx.staff.id, next, code);
  if ("error" in used) return fail(used.error, 400);
  if (await staffByEmail(next)) return fail("email_taken", 409);
  const { data: owner } = await supabase.rpc("staff_auth_user_id", { p_email: next });
  if (owner && owner !== ctx.userId) return fail("email_taken", 409);
  const { error } = await supabase.auth.admin.updateUserById(ctx.userId, { email: next, email_confirm: true });
  if (error) return fail("auth_failed", 500, error.message);
  const { data, error: upErr } = await supabase.from("staff_members")
    .update({ email: next, updated_at: new Date().toISOString() })
    .eq("id", ctx.staff.id).select(STAFF_COLS).single();
  if (upErr) return fail("db_error", 500, upErr.message);
  return json(profileOut(data as Staff, ctx.org, await designFor(ctx.org.id)));
}

// ── Dashboard: the Staff app page ───────────────────────────────────────
type AdminCtx = { userId: string; email: string; level: string; access: "view" | "edit"; org: Org; req: Request };

const LEGACY_LEVEL: Record<string, string> = { owner: "master", admin: "master", manager: "manager", checker: "manager", vendor: "vendor" };

/* A dashboard account that can see this venue's Staff app page, and whether
 * it can change it (the `staffapp` tab of its role). */
async function adminCtx(req: Request, body: Json): Promise<AdminCtx | Response> {
  const jwt = bearer(req);
  if (!jwt) return fail("missing_token", 401);
  const { data: { user }, error } = await supabase.auth.getUser(jwt);
  if (error || !user) return fail("invalid_token", 401);
  const { data: p } = await supabase.from("admin_profiles")
    .select("id, email, role, status, access_role, org_id, org_ids, all_orgs")
    .eq("id", user.id).eq("status", "active").maybeSingle();
  if (!p) return fail("insufficient_role", 403);

  let level = LEGACY_LEVEL[p.role as string] || "vendor";
  let tabs: Record<string, string> = {};
  if (p.access_role) {
    const { data: role } = await supabase.from("admin_roles").select("level, tabs").eq("key", p.access_role).maybeSingle();
    if (role) { level = role.level; tabs = (role.tabs || {}) as Record<string, string>; }
  }

  const orgId = String(body.org_id || "");
  if (!UUID_RE.test(orgId)) return fail("invalid_org", 400);
  const org = await orgById(orgId);
  if (!org || org.deleted_at) return fail("invalid_org", 400);
  const sees = level === "master" || p.all_orgs ||
    (!p.access_role && !p.org_id && ["manager", "checker"].includes(p.role)) ||
    (p.org_ids || []).includes(orgId) || p.org_id === orgId;
  if (!sees) return fail("insufficient_role", 403);

  let access: string;
  if (level === "master") access = "edit";
  else if (tabs.staffapp) access = tabs.staffapp;
  else if (level === "manager") access = p.role === "checker" || tabs.settings === "view" ? "view" : "edit";
  else access = "view";
  if (access !== "view" && access !== "edit") return fail("insufficient_role", 403);
  return { userId: user.id, email: normEmail(user.email), level, access: access as "view" | "edit", org, req };
}

async function adminLog(ctx: AdminCtx, action: string, targetId: string | null, before: unknown, after: unknown) {
  const ip = clientIp(ctx.req);
  const { error } = await supabase.from("admin_action_log").insert({
    actor_id: ctx.userId,
    actor_email: ctx.email,
    org_id: ctx.org.id,
    action,
    target_type: targetId ? "staff_member" : "organization",
    target_id: targetId || ctx.org.id,
    before_state: before ?? null,
    after_state: after ?? null,
    ip: ip === "unknown" ? null : ip,
    user_agent: ctx.req.headers.get("user-agent") || null,
  });
  if (error) console.error("[staff-app] admin log failed:", error.message);
}

const staffOut = (s: Staff) => ({
  id: s.id, email: s.email, name: s.name, avatar_url: s.avatar_url, status: s.status,
  created_at: s.created_at, requested_at: s.requested_at, activated_at: s.activated_at,
  approved_at: s.approved_at, last_seen_at: s.last_seen_at, signed_up: s.status === "active" || s.status === "blocked",
});

async function adminState(ctx: AdminCtx, body: Json) {
  const { org } = ctx;
  const { data: members } = await supabase.from("staff_members").select(STAFF_COLS)
    .eq("org_id", org.id).order("created_at", { ascending: false });
  const staff = (members || []) as Staff[];

  // Totals per person: every code they made that was not cancelled.
  const month = Date.now() - 30 * 86400_000;
  const totals = new Map<string, { codes: number; cups: number; codes30: number; cups30: number; last: string | null }>();
  const { data: made } = await supabase.from("staff_qr_codes")
    .select("staff_id, cups, created_at").eq("org_id", org.id).is("cancelled_at", null).limit(20000);
  for (const r of made || []) {
    if (!r.staff_id) continue;
    const t = totals.get(r.staff_id) || { codes: 0, cups: 0, codes30: 0, cups30: 0, last: null };
    t.codes += 1; t.cups += r.cups;
    if (Date.parse(r.created_at) >= month) { t.codes30 += 1; t.cups30 += r.cups; }
    if (!t.last || r.created_at > t.last) t.last = r.created_at;
    totals.set(r.staff_id, t);
  }

  // The log: codes made at this venue, newest first, with who made them.
  let q = supabase.from("staff_qr_codes")
    .select("batch_id, staff_id, cups, package_type, created_at, expires_at, cancelled_at")
    .eq("org_id", org.id).order("created_at", { ascending: false }).limit(100);
  if (body.before && !Number.isNaN(Date.parse(String(body.before)))) q = q.lt("created_at", String(body.before));
  const { data: rows } = await q;
  const codes = await describe((rows || []) as CodeRow[], org);
  const who = new Map(staff.map((s) => [s.id, s]));
  const log = codes.map((c, i) => {
    const s = who.get((rows as { staff_id: string | null }[])[i].staff_id || "");
    return { ...c, url: undefined, staff: s ? { id: s.id, name: s.name, email: s.email, avatar_url: s.avatar_url } : null };
  });

  return json({
    org: { id: org.id, name: org.name, slug: org.slug, logo_url: org.logo_url, enabled: !!org.staff_app_enabled },
    can_edit: ctx.access === "edit",
    staff: staff.map((s) => ({
      ...staffOut(s),
      totals: totals.get(s.id) || { codes: 0, cups: 0, codes30: 0, cups30: 0, last: null },
    })),
    log,
    has_more: (rows || []).length === 100,
    limits: LIMITS,
  });
}

async function memberOf(ctx: AdminCtx, id: unknown): Promise<Staff | null> {
  if (!UUID_RE.test(String(id || ""))) return null;
  const { data } = await supabase.from("staff_members").select(STAFF_COLS)
    .eq("id", String(id)).eq("org_id", ctx.org.id).maybeSingle();
  return (data as Staff) || null;
}

function inviteEmail(org: Org, email: string) {
  const link = `${APP_BASE}/staff`;
  const html = emailShell(
    `<p style="margin:0 0 12px;font-size:20px;font-weight:800">You can now make cup QR codes for ${esc(org.name)}</p>` +
    `<p style="margin:0 0 20px;color:#3F3A34">PackPerks Staff turns returned cups into a QR code your customers scan to collect them. Create your account with this email address: <b>${esc(email)}</b></p>` +
    `<p style="margin:0 0 20px"><a href="${link}" style="display:inline-block;background:#5333A5;color:#FFFFFF;text-decoration:none;font-weight:700;padding:13px 22px;border-radius:14px">Open PackPerks Staff</a></p>` +
    `<p style="margin:0;color:#6C6259;font-size:13px">Choose Create account, enter your email and we send you a code. Tip: add the page to your home screen.</p>`,
  );
  const text = `You can now make cup QR codes for ${org.name} with PackPerks Staff.\n\nOpen ${link}, choose Create account and use this email address: ${email}`;
  return sendEmail(email, `Your PackPerks Staff access for ${org.name}`, html, text);
}

function approvedEmail(org: Org, email: string) {
  const link = `${APP_BASE}/staff`;
  const html = emailShell(
    `<p style="margin:0 0 12px;font-size:20px;font-weight:800">You're in at ${esc(org.name)}</p>` +
    `<p style="margin:0 0 20px;color:#3F3A34">Your staff account was approved. Sign in with <b>${esc(email)}</b> and the password you chose to start making cup QR codes.</p>` +
    `<p style="margin:0"><a href="${link}" style="display:inline-block;background:#5333A5;color:#FFFFFF;text-decoration:none;font-weight:700;padding:13px 22px;border-radius:14px">Open PackPerks Staff</a></p>`,
  );
  const text = `Your PackPerks Staff account for ${org.name} was approved. Sign in at ${link} with ${email} and the password you chose.`;
  return sendEmail(email, `You're approved for PackPerks Staff at ${org.name}`, html, text);
}

async function adminApprove(ctx: AdminCtx, body: Json) {
  const s = await memberOf(ctx, body.id);
  if (!s) return fail("not_found", 404);
  if (s.status !== "requested") return fail("not_requested", 409);
  const now = new Date().toISOString();
  const { data, error } = await supabase.from("staff_members")
    .update({ status: "active", approved_by: ctx.userId, approved_at: now, activated_at: s.activated_at || now, updated_at: now })
    .eq("id", s.id).eq("status", "requested").select(STAFF_COLS).single();
  if (error) return fail("db_error", 500, error.message);
  const emailed = await approvedEmail(ctx.org, s.email);
  await adminLog(ctx, "staff.approve", s.id, { status: s.status }, { email: s.email, status: "active", emailed });
  return json({ member: staffOut(data as Staff), emailed });
}

async function adminDecline(ctx: AdminCtx, body: Json) {
  const s = await memberOf(ctx, body.id);
  if (!s) return fail("not_found", 404);
  if (s.status !== "requested") return fail("not_requested", 409);
  // The login stays (it may also be a customer or dashboard account); only
  // the request goes, so the person can ask again.
  const { error } = await supabase.from("staff_members").delete().eq("id", s.id).eq("status", "requested");
  if (error) return fail("db_error", 500, error.message);
  await adminLog(ctx, "staff.decline", s.id, { email: s.email, status: s.status }, null);
  return json({ ok: true });
}

async function adminToggle(ctx: AdminCtx, body: Json) {
  const enabled = body.enabled === true;
  const { error } = await supabase.from("organizations").update({ staff_app_enabled: enabled }).eq("id", ctx.org.id);
  if (error) return fail("db_error", 500, error.message);
  await adminLog(ctx, enabled ? "staff.app_on" : "staff.app_off", null,
    { staff_app_enabled: ctx.org.staff_app_enabled }, { staff_app_enabled: enabled });
  return json({ enabled });
}

async function adminInvite(ctx: AdminCtx, body: Json) {
  const { org } = ctx;
  if (!await rateLimit(`staff-invite:${ctx.userId}`, 3600, 60)) return fail("rate_limited", 429);
  if (!org.staff_app_enabled) return fail("app_off", 409);

  const emails = [...new Set((Array.isArray(body.emails) ? body.emails : []).map(normEmail).filter(Boolean))];
  if (!emails.length) return fail("no_emails", 400);
  if (emails.length > 20) return fail("too_many", 400);

  const results: { email: string; result: string }[] = [];
  for (const email of emails) {
    if (!EMAIL_RE.test(email)) { results.push({ email, result: "invalid_email" }); continue; }
    const existing = await staffByEmail(email);
    if (existing && existing.org_id !== org.id) { results.push({ email, result: "other_venue" }); continue; }
    if (existing?.status === "active") { results.push({ email, result: "already_active" }); continue; }
    if (existing?.status === "blocked") { results.push({ email, result: "blocked" }); continue; }
    // Adding someone who already asked approves them.
    if (existing?.status === "requested") {
      const now = new Date().toISOString();
      await supabase.from("staff_members")
        .update({ status: "active", approved_by: ctx.userId, approved_at: now, activated_at: now, updated_at: now })
        .eq("id", existing.id);
      const sent = await approvedEmail(org, email);
      results.push({ email, result: sent ? "approved" : "approved_email_failed" });
      continue;
    }
    if (!existing) {
      const { error: insErr } = await supabase.from("staff_members").insert({ org_id: org.id, email, invited_by: ctx.userId });
      if (insErr) { results.push({ email, result: "failed" }); continue; }
    }
    const sent = await inviteEmail(org, email);
    results.push({ email, result: existing ? (sent ? "reminded" : "email_failed") : (sent ? "invited" : "added_email_failed") });
  }
  await adminLog(ctx, "staff.invite", null, null, { results });
  return json({ results });
}

async function adminStatus(ctx: AdminCtx, body: Json) {
  const s = await memberOf(ctx, body.id);
  if (!s) return fail("not_found", 404);
  const want = String(body.status || "");
  if (want !== "active" && want !== "blocked") return fail("invalid_status", 400);
  if (s.status === "requested") return fail("not_approved", 409);
  // Unpausing someone who never signed up puts them back on the invite list.
  const status = want === "blocked" ? "blocked" : s.auth_user_id ? "active" : "invited";
  const { data, error } = await supabase.from("staff_members")
    .update({ status, updated_at: new Date().toISOString() }).eq("id", s.id).select(STAFF_COLS).single();
  if (error) return fail("db_error", 500, error.message);
  await adminLog(ctx, want === "blocked" ? "staff.block" : "staff.unblock", s.id, { status: s.status }, { email: s.email, status });
  return json({ member: staffOut(data as Staff) });
}

async function adminRemove(ctx: AdminCtx, body: Json) {
  const s = await memberOf(ctx, body.id);
  if (!s) return fail("not_found", 404);
  const { error } = await supabase.from("staff_members").delete().eq("id", s.id);
  if (error) return fail("db_error", 500, error.message);
  await adminLog(ctx, "staff.remove", s.id, { email: s.email, status: s.status }, null);
  return json({ ok: true });
}

async function adminResend(ctx: AdminCtx, body: Json) {
  const s = await memberOf(ctx, body.id);
  if (!s) return fail("not_found", 404);
  if (s.status !== "invited") return fail("not_invited", 409);
  if (!ctx.org.staff_app_enabled) return fail("app_off", 409);
  if (!await rateLimit(`staff-invite:${ctx.userId}`, 3600, 60)) return fail("rate_limited", 429);
  const sent = await inviteEmail(ctx.org, s.email);
  if (!sent) return fail("email_failed", 502);
  await adminLog(ctx, "staff.invite", s.id, null, { results: [{ email: s.email, result: "reminded" }] });
  return json({ ok: true });
}

const ADMIN: Record<string, { edit: boolean; run: (ctx: AdminCtx, body: Json) => Promise<Response> }> = {
  admin_state: { edit: false, run: adminState },
  admin_approve: { edit: false, run: adminApprove },
  admin_decline: { edit: false, run: adminDecline },
  admin_toggle: { edit: true, run: adminToggle },
  admin_invite: { edit: true, run: adminInvite },
  admin_status: { edit: true, run: adminStatus },
  admin_remove: { edit: true, run: adminRemove },
  admin_resend: { edit: true, run: adminResend },
};

async function preview(body: Json) {
  const org = await orgById(String(body.org_id || ""));
  if (!org || org.deleted_at) return fail("invalid_org", 404);
  return json({ venue: venueOut(org), design: await designFor(org.id), limits: LIMITS, enabled: !!org.staff_app_enabled });
}

// ── Router ──────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return fail("method_not_allowed", 405);
  let body: Json;
  try { body = await req.json(); } catch { return fail("invalid_json", 400); }
  const action = String(body?.action || "");

  try {
    switch (action) {
      case "signup_request": return await signupRequest(req, body);
      case "signup_verify": return await signupVerify(req, body);
      case "reset_request": return await resetRequest(req, body);
      case "reset_verify": return await resetVerify(req, body);
      case "preview": return await preview(body);
      case "join": return await join(req, body);
    }

    const admin = ADMIN[action];
    if (admin) {
      const actx = await adminCtx(req, body);
      if (actx instanceof Response) return actx;
      if (admin.edit && actx.access !== "edit") return fail("insufficient_role", 403);
      return await admin.run(actx, body);
    }

    const ctx = await authStaff(req);
    if (ctx instanceof Response) return ctx;
    switch (action) {
      case "me": {
        await supabase.from("staff_members").update({ last_seen_at: new Date().toISOString() }).eq("id", ctx.staff.id);
        return json(profileOut(ctx.staff, ctx.org, await designFor(ctx.org.id)));
      }
      case "mint": return await mint(ctx, body);
      case "list": return await list(ctx, body);
      case "status": {
        const code = await oneCode(ctx, String(body.id || ""));
        return code ? json({ code }) : fail("not_found", 404);
      }
      case "cancel": return await cancel(ctx, body);
      case "update_profile": return await updateProfile(ctx, body);
      case "email_request": return await emailRequest(req, ctx, body);
      case "email_verify": return await emailVerify(ctx, body);
      default: return fail("unknown_action", 400);
    }
  } catch (e) {
    console.error(`[staff-app] ${action} failed:`, String(e));
    return fail("server_error", 500);
  }
});
