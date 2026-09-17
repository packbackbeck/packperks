// ──────────────────────────────────────────────────────────────────────────
// PackPerks: staff-app Edge Function (v1)
//
// Everything the PackPerks Staff web app (/staff) does, plus the one master
// action that invites staff from the dashboard. Migration 050 has the tables.
//
// Body: { action, ...fields }
//
// Without a login:
//   signup_request  { email }                          emails a 6-digit code
//   signup_verify   { email, code, password, name? }   creates or links the login
//   reset_request   { email }                          emails a code (always "ok")
//   reset_verify    { email, code, password }          sets a new password
//
// Signed in as staff (Authorization: Bearer <jwt>):
//   me                                   profile, venue and limits
//   mint            { cups, package_type }  a cup batch and its QR link
//   list            { before?, day_start? }  this person's codes, newest first
//   status          { id }               one code, for the live QR screen
//   cancel          { id }               revokes an unclaimed code
//   update_profile  { name?, avatar_url? }
//   email_request   { new_email }        emails a code to the new address
//   email_verify    { code }             switches the login to that address
//
// Signed in as a master:
//   admin_invite    { org_id, emails[] } adds staff and emails them
//
// A staff QR code is a normal cup batch (`cups` rows sharing a batch_id,
// source admin_batch), so the customer app claims it through claim-cups
// exactly like a printed receipt. It expires after CODE_TTL_MIN minutes.
// ──────────────────────────────────────────────────────────────────────────
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
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
const MAX_CUPS = 20;                 // cups in one code
const PACKAGES = ["cup"];            // package types staff can pick
const CODE_TTL_MIN = 15;             // a code on screen works this long
const MINTS_PER_HOUR = 60;           // per staff member
const CUPS_PER_DAY = 400;            // per staff member, rolling 24 hours
const EMAIL_CODE_TTL_MIN = 10;
const EMAIL_CODE_ATTEMPTS = 5;
const PASSWORD_MIN = 8;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAFF_COLS = "id, org_id, email, name, avatar_url, auth_user_id, status, created_at, activated_at";
const ORG_COLS = "id, name, slug, logo_url, brand_color, country, staff_app_enabled, deleted_at";

type Json = Record<string, unknown>;
type Staff = {
  id: string; org_id: string; email: string; name: string | null; avatar_url: string | null;
  auth_user_id: string | null; status: string; created_at: string; activated_at: string | null;
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
const fail = (error: string, status: number, detail?: string) => json({ error, ...(detail ? { detail } : {}) }, status);

function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
}
function bearer(req: Request): string {
  return (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
}
const normEmail = (v: unknown) => String(v ?? "").trim().toLowerCase();

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

async function sendCode(purpose: string, email: string, staffId: string, venue: string): Promise<boolean> {
  const code = sixDigits();
  await supabase.from("staff_email_codes").delete().eq("purpose", purpose).eq("staff_id", staffId);
  const { data: row, error } = await supabase.from("staff_email_codes").insert({
    purpose,
    email,
    staff_id: staffId,
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

/* Checks a code and uses it up. Returns an error code, or null when valid. */
async function useCode(purpose: string, staffId: string, email: string | null, code: string): Promise<string | null> {
  if (!/^\d{6}$/.test(code)) return "code_invalid";
  let q = supabase.from("staff_email_codes")
    .select("id, email, code_hash, attempts, expires_at")
    .eq("purpose", purpose).eq("staff_id", staffId);
  if (email) q = q.eq("email", email);
  const { data: row } = await q.order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!row) return "code_invalid";
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await supabase.from("staff_email_codes").delete().eq("id", row.id);
    return "code_expired";
  }
  if (row.attempts >= EMAIL_CODE_ATTEMPTS) {
    await supabase.from("staff_email_codes").delete().eq("id", row.id);
    return "too_many_attempts";
  }
  const hash = await sha256Hex(`${purpose}:${row.email}:${code}`);
  if (!sameHex(hash, row.code_hash)) {
    await supabase.from("staff_email_codes").update({ attempts: row.attempts + 1 }).eq("id", row.id);
    return row.attempts + 1 >= EMAIL_CODE_ATTEMPTS ? "too_many_attempts" : "code_invalid";
  }
  await supabase.from("staff_email_codes").delete().eq("id", row.id);
  return null;
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

function profileOut(staff: Staff, org: Org) {
  return {
    profile: {
      id: staff.id,
      email: staff.email,
      name: staff.name,
      avatar_url: staff.avatar_url,
      since: staff.activated_at || staff.created_at,
    },
    venue: { id: org.id, name: org.name, slug: org.slug, logo_url: org.logo_url, brand_color: org.brand_color, country: org.country },
    limits: { max_cups: MAX_CUPS, packages: PACKAGES, code_minutes: CODE_TTL_MIN },
  };
}

/* The signed-in staff member, or an error response. */
async function authStaff(req: Request): Promise<{ userId: string; staff: Staff; org: Org } | Response> {
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
    if (invited && !invited.auth_user_id && invited.status !== "blocked") {
      const now = new Date().toISOString();
      const { data } = await supabase.from("staff_members")
        .update({ auth_user_id: user.id, status: "active", activated_at: invited.activated_at || now, updated_at: now })
        .eq("id", invited.id).is("auth_user_id", null)
        .select(STAFF_COLS).maybeSingle();
      staff = (data as Staff) || null;
    }
  }
  if (!staff) return fail("not_staff", 403);
  if (staff.status === "blocked") return fail("blocked", 403);
  const org = await orgById(staff.org_id);
  if (!appOn(org)) return fail("app_off", 403);
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
  if (!await rateLimit(`staff-code:signup:${email}`, 900, 3)) return fail("rate_limited", 429);
  const staff = await staffByEmail(email);
  if (!staff) return fail("not_on_list", 404);
  if (staff.status === "blocked") return fail("blocked", 403);
  if (staff.auth_user_id && staff.status === "active") return fail("already_signed_up", 409);
  const org = await orgById(staff.org_id);
  if (!appOn(org)) return fail("app_off", 403);
  if (!await sendCode("signup", email, staff.id, org!.name)) return fail("email_failed", 502);
  return json({ ok: true, venue: org!.name });
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
  if (!staff) return fail("not_on_list", 404);
  if (staff.status === "blocked") return fail("blocked", 403);
  if (staff.auth_user_id && staff.status === "active") return fail("already_signed_up", 409);
  const org = await orgById(staff.org_id);
  if (!appOn(org)) return fail("app_off", 403);
  const codeErr = await useCode("signup", staff.id, email, code);
  if (codeErr) return fail(codeErr, 400);

  // Someone who already has a PackPerks login (a customer, or a dashboard
  // account) keeps it: the new password is set on that login.
  const { data: existingId } = await supabase.rpc("staff_auth_user_id", { p_email: email });
  let authId = existingId as string | null;
  if (authId) {
    const { data: taken } = await supabase.from("staff_members").select("id").eq("auth_user_id", authId).maybeSingle();
    if (taken && taken.id !== staff.id) return fail("email_taken", 409);
    const { error } = await supabase.auth.admin.updateUserById(authId, { password, email_confirm: true });
    if (error) return fail("auth_failed", 500, error.message);
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: name ? { name } : {},
    });
    if (error || !data?.user) return fail("auth_failed", 500, error?.message);
    authId = data.user.id;
  }
  const now = new Date().toISOString();
  const { error: upErr } = await supabase.from("staff_members").update({
    auth_user_id: authId,
    status: "active",
    activated_at: staff.activated_at || now,
    name: name || staff.name,
    updated_at: now,
  }).eq("id", staff.id);
  if (upErr) return fail("db_error", 500, upErr.message);
  return json({ ok: true, existing_login: !!existingId });
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
    if (appOn(org) && !await sendCode("reset", email, staff.id, org!.name)) return fail("email_failed", 502);
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
  const codeErr = await useCode("reset", staff.id, email, code);
  if (codeErr) return fail(codeErr, 400);
  const { error } = await supabase.auth.admin.updateUserById(staff.auth_user_id, { password });
  if (error) return fail("auth_failed", 500, error.message);
  return json({ ok: true });
}

async function mint(ctx: { userId: string; staff: Staff; org: Org }, body: Json) {
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

async function list(ctx: { staff: Staff; org: Org }, body: Json) {
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

async function oneCode(ctx: { staff: Staff; org: Org }, id: string) {
  if (!UUID_RE.test(id)) return null;
  const { data } = await supabase.from("staff_qr_codes")
    .select("batch_id, cups, package_type, created_at, expires_at, cancelled_at")
    .eq("batch_id", id).eq("staff_id", ctx.staff.id).maybeSingle();
  if (!data) return null;
  const [code] = await describe([data as CodeRow], ctx.org);
  return code;
}

async function cancel(ctx: { userId: string; staff: Staff; org: Org }, body: Json) {
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

async function updateProfile(ctx: { userId: string; staff: Staff; org: Org }, body: Json) {
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
  return json(profileOut(data as Staff, ctx.org));
}

async function emailRequest(req: Request, ctx: { userId: string; staff: Staff; org: Org }, body: Json) {
  const next = normEmail(body.new_email);
  if (!EMAIL_RE.test(next)) return fail("invalid_email", 400);
  if (next === ctx.staff.email) return fail("same_email", 400);
  if (!await rateLimit(`staff-code:email:${ctx.staff.id}`, 900, 3)) return fail("rate_limited", 429);
  if (await staffByEmail(next)) return fail("email_taken", 409);
  const { data: owner } = await supabase.rpc("staff_auth_user_id", { p_email: next });
  if (owner && owner !== ctx.userId) return fail("email_taken", 409);
  if (!await sendCode("email_change", next, ctx.staff.id, ctx.org.name)) return fail("email_failed", 502);
  return json({ ok: true });
}

async function emailVerify(ctx: { userId: string; staff: Staff; org: Org }, body: Json) {
  const code = String(body.code ?? "").trim();
  const { data: pending } = await supabase.from("staff_email_codes")
    .select("email").eq("purpose", "email_change").eq("staff_id", ctx.staff.id)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!pending) return fail("code_invalid", 400);
  const next = pending.email as string;
  const codeErr = await useCode("email_change", ctx.staff.id, next, code);
  if (codeErr) return fail(codeErr, 400);
  if (await staffByEmail(next)) return fail("email_taken", 409);
  const { data: owner } = await supabase.rpc("staff_auth_user_id", { p_email: next });
  if (owner && owner !== ctx.userId) return fail("email_taken", 409);
  const { error } = await supabase.auth.admin.updateUserById(ctx.userId, { email: next, email_confirm: true });
  if (error) return fail("auth_failed", 500, error.message);
  const { data, error: upErr } = await supabase.from("staff_members")
    .update({ email: next, updated_at: new Date().toISOString() })
    .eq("id", ctx.staff.id).select(STAFF_COLS).single();
  if (upErr) return fail("db_error", 500, upErr.message);
  return json(profileOut(data as Staff, ctx.org));
}

async function adminInvite(req: Request, body: Json) {
  const jwt = bearer(req);
  if (!jwt) return fail("missing_token", 401);
  const { data: { user }, error } = await supabase.auth.getUser(jwt);
  if (error || !user) return fail("invalid_token", 401);
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: isMaster } = await caller.rpc("is_master");
  if (isMaster !== true) return fail("insufficient_role", 403);
  if (!await rateLimit(`staff-invite:${user.id}`, 3600, 60)) return fail("rate_limited", 429);

  const orgId = String(body.org_id || "");
  if (!UUID_RE.test(orgId)) return fail("invalid_org", 400);
  const org = await orgById(orgId);
  if (!org || org.deleted_at) return fail("invalid_org", 400);
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
    if (!existing) {
      const { error: insErr } = await supabase.from("staff_members").insert({ org_id: org.id, email, invited_by: user.id });
      if (insErr) { results.push({ email, result: "failed" }); continue; }
    }
    const link = `${APP_BASE}/staff`;
    const html = emailShell(
      `<p style="margin:0 0 12px;font-size:20px;font-weight:800">You can now make cup QR codes for ${esc(org.name)}</p>` +
      `<p style="margin:0 0 20px;color:#3F3A34">PackPerks Staff turns returned cups into a QR code your customers scan to collect them. Create your account with this email address: <b>${esc(email)}</b></p>` +
      `<p style="margin:0 0 20px"><a href="${link}" style="display:inline-block;background:#5333A5;color:#FFFFFF;text-decoration:none;font-weight:700;padding:13px 22px;border-radius:14px">Open PackPerks Staff</a></p>` +
      `<p style="margin:0;color:#6C6259;font-size:13px">Choose Create account, enter your email and we send you a code. Tip: add the page to your home screen.</p>`,
    );
    const text = `You can now make cup QR codes for ${org.name} with PackPerks Staff.\n\nOpen ${link}, choose Create account and use this email address: ${email}`;
    const sent = await sendEmail(email, `Your PackPerks Staff access for ${org.name}`, html, text);
    results.push({ email, result: existing ? (sent ? "reminded" : "email_failed") : (sent ? "invited" : "added_email_failed") });
  }

  await supabase.from("admin_action_log").insert({
    actor_id: user.id,
    actor_email: user.email,
    org_id: org.id,
    action: "staff.invite",
    target_type: "organization",
    target_id: org.id,
    after_state: { results },
    ip: clientIp(req) === "unknown" ? null : clientIp(req),
    user_agent: req.headers.get("user-agent") || null,
  });
  return json({ results });
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
      case "admin_invite": return await adminInvite(req, body);
    }

    const ctx = await authStaff(req);
    if (ctx instanceof Response) return ctx;
    switch (action) {
      case "me": {
        await supabase.from("staff_members").update({ last_seen_at: new Date().toISOString() }).eq("id", ctx.staff.id);
        return json(profileOut(ctx.staff, ctx.org));
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
