// packpulse-link — the PackPerks side of a PackPulse connection.
//
// A PackPulse organisation shows one PackPerks venue's Dashboard, System
// health and Reports & alerts, read-only, in an iframe. The whole design is
// in docs/packpulse/INTEGRATION.md; the tables and the master-only SQL
// functions are migration 057.
//
// Who calls what
//   PackPulse's SERVER (never a browser: the secret must stay server-side)
//     claim       { code, packpulse: { org_id, org_name, app_origin?,
//                   requested_by?: { email?, name? } } }
//                 Uses a one-time connection code a master made. Returns the
//                 link secret (once) and a confirmation code; the connection
//                 then waits for a master to approve it in Master Settings.
//     status      {}                                 x-packpulse-secret
//     embed       { page, theme?, parent_origin?, viewer?: { email?, name? } }
//                 An embed URL for one page view. Its ticket works once, for
//                 2 minutes.                         x-packpulse-secret
//     disconnect  {}                                 x-packpulse-secret
//   The EMBED PAGE (/packpulse-embed) in the viewer's browser
//     redeem      { ticket }
//                 Turns the ticket into a one-time token for auth.verifyOtp:
//                 a session of the connection's own login, which can read
//                 only the packpulse_* views of its venue.
//
// Masters create codes, approve, pause, choose pages and disconnect in the
// dashboard through SQL functions (packpulse_admin_*), not here.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const APP_ORIGIN = "https://perks.packback.network";
const EMBED_PAGES = ["overview", "stats", "reports"];
const ALL_PAGES = [...EMBED_PAGES, "preview"];
const TICKET_TTL_MS = 2 * 60 * 1000;
// The connection's own login. Not a real mailbox, never on
// @packback.network (that domain signs in to the dashboard and the staff app).
const LOGIN_DOMAIN = "packpulse.packperks.invalid";
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-packpulse-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Json = Record<string, unknown>;
type Link = {
  id: string; org_id: string; status: string; pages: Record<string, boolean> | null;
  confirm_code: string | null; packpulse_org_id: string | null; packpulse_org_name: string | null;
  packpulse_origin: string | null; auth_user_id: string | null; approved_at: string | null;
  ended_at: string | null; ended_by: string | null; code_expires_at: string | null;
};
const LINK_COLS = "id, org_id, status, pages, confirm_code, packpulse_org_id, packpulse_org_name, packpulse_origin, auth_user_id, approved_at, ended_at, ended_by, code_expires_at";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });
}
function fail(error: string, status: number, extra: Json = {}) {
  return json({ error, ...extra }, status);
}

function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
}

async function rateLimit(key: string, windowSecs: number, maxCalls: number): Promise<boolean> {
  const { data: count, error } = await supabase.rpc("check_rate_limit", {
    p_key: key, p_window_seconds: windowSecs, p_max_calls: maxCalls,
  });
  if (error) { console.error("[packpulse-link] rate limit check failed:", error.message); return true; }
  return (count as number) <= maxCalls;
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomToken(bytes: number): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function confirmCode(): string {
  const b = crypto.getRandomValues(new Uint8Array(4));
  return [...b].map((x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join("");
}

/* "ppk-ce42z yr6u2…" → the 20 characters the hash was made from. */
function normCode(input: unknown): string {
  let s = String(input || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (s.length === 23 && s.startsWith("PPK")) s = s.slice(3);
  return s.length === 20 && [...s].every((c) => CODE_ALPHABET.includes(c)) ? s : "";
}

/* An https origin, or plain http on this machine for development. */
function cleanOrigin(input: unknown): string | null {
  const s = String(input || "").trim().replace(/\/+$/, "");
  if (!s) return null;
  if (/^https:\/\/[a-z0-9.-]+(:\d{1,5})?$/i.test(s)) return s.toLowerCase();
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/i.test(s)) return s.toLowerCase();
  return null;
}

const text = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

async function logEvent(linkId: string, action: string, actor: string | null, detail: Json | null = null) {
  await supabase.from("packpulse_link_events").insert({ link_id: linkId, action, actor, detail });
}

/* What PackPulse may know about the venue: enough to label and draw it. */
async function venue(orgId: string) {
  const { data: org } = await supabase.from("organizations")
    .select("id, name, slug, country, brand_color, logo_url, partner_brand_name, group_id, deleted_at")
    .eq("id", orgId).maybeSingle();
  if (!org) return null;
  const keys = [`published:${org.id}`];
  if (org.group_id) keys.push(`published:group:${org.group_id}`);
  const { data: cfg } = await supabase.from("app_config").select("key, value").in("key", keys);
  const own = (cfg || []).find((r) => r.key === `published:${org.id}`)?.value as Json | undefined;
  const grp = (cfg || []).find((r) => r.key !== `published:${org.id}`)?.value as Json | undefined;
  const ownMode = (own?.settings as Json | undefined)?.mode;
  const grpMode = (grp?.settings as Json | undefined)?.mode;
  const mode = ownMode === "tikkie_only" ? "tikkie_only" : org.group_id ? (grpMode === "deposit" ? "standard" : "byo") : "standard";
  return {
    org_id: org.id,
    name: org.name,
    brand_name: org.partner_brand_name || null,
    slug: org.slug,
    country: org.country,
    brand_color: org.brand_color,
    logo_url: org.logo_url,
    mode,
    mode_label: mode === "tikkie_only" ? "Deferred Tikkie" : mode === "byo" ? "Bring Your Own" : "Deposit Rewards",
    app_url: `${APP_ORIGIN}/${org.slug}/`,
    archived: !!org.deleted_at,
  };
}

function effectivePages(link: Link): Record<string, boolean> {
  const on = link.status === "active";
  return Object.fromEntries(ALL_PAGES.map((p) => [p, on && link.pages?.[p] === true]));
}

async function linkBySecret(req: Request): Promise<Link | null> {
  const secret = (req.headers.get("x-packpulse-secret") || "").trim();
  if (!/^ppl_[A-Za-z0-9_-]{40,60}$/.test(secret)) return null;
  const { data } = await supabase.from("packpulse_links").select(LINK_COLS)
    .eq("secret_hash", await sha256Hex(secret)).maybeSingle();
  return (data as Link) || null;
}

async function deleteLogin(uid: string | null) {
  if (!uid) return;
  const { error } = await supabase.auth.admin.deleteUser(uid);
  if (error) console.error("[packpulse-link] could not delete the connection login:", error.message);
}

// ── claim ─────────────────────────────────────────────────────────────────
async function claim(req: Request, body: Json) {
  if (!await rateLimit(`packpulse-claim:${clientIp(req)}`, 3600, 20)) return fail("rate_limited", 429);
  const raw = normCode(body.code);
  if (!raw) return fail("invalid_code", 400);

  const pp = (body.packpulse || {}) as Json;
  const ppOrgId = text(pp.org_id, 100);
  const ppOrgName = text(pp.org_name, 120);
  if (!ppOrgId || !ppOrgName) return fail("missing_packpulse_org", 400);
  const by = (pp.requested_by || {}) as Json;
  const byEmail = text(by.email, 200).toLowerCase() || null;
  const byName = text(by.name, 120) || null;
  const origin = cleanOrigin(pp.app_origin);

  const { data: found } = await supabase.from("packpulse_links").select(LINK_COLS)
    .eq("code_hash", await sha256Hex(raw)).maybeSingle();
  const link = found as Link | null;
  if (!link || link.status !== "awaiting") return fail("invalid_code", 404);
  if (!link.code_expires_at || Date.parse(link.code_expires_at) < Date.now()) return fail("code_expired", 410);

  const { data: live } = await supabase.from("packpulse_links").select("id, status")
    .eq("org_id", link.org_id).eq("packpulse_org_id", ppOrgId)
    .in("status", ["pending", "active", "paused"]).limit(1);
  if (live && live.length) return fail("already_connected", 409, { status: live[0].status });

  const secret = `ppl_${randomToken(32)}`;
  const confirm = confirmCode();
  // Burns the code: only the request that flips it from `awaiting` wins.
  const { data: updated, error } = await supabase.from("packpulse_links").update({
    status: "pending",
    code_hash: null,
    secret_hash: await sha256Hex(secret),
    confirm_code: confirm,
    packpulse_org_id: ppOrgId,
    packpulse_org_name: ppOrgName,
    packpulse_origin: origin,
    requested_by_email: byEmail,
    requested_by_name: byName,
    requested_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", link.id).eq("status", "awaiting").select("id");
  if (error) return fail("db_error", 500, { detail: error.message });
  if (!updated || !updated.length) return fail("invalid_code", 404);

  await logEvent(link.id, "claimed", byEmail || byName || "packpulse", { packpulse_org: ppOrgName, origin });
  return json({
    link_id: link.id,
    secret,
    status: "pending",
    confirm_code: confirm,
    packperks: await venue(link.org_id),
  });
}

// ── status ────────────────────────────────────────────────────────────────
async function status(req: Request) {
  const link = await linkBySecret(req);
  if (!link) return fail("unknown_link", 401);
  const v = await venue(link.org_id);
  const pages = effectivePages(link);
  return json({
    link_id: link.id,
    status: link.status,
    confirm_code: link.status === "pending" ? link.confirm_code : null,
    pages,
    packperks: v,
    packpulse: { org_id: link.packpulse_org_id, org_name: link.packpulse_org_name },
    preview_url: pages.preview && v ? v.app_url : null,
    approved_at: link.approved_at,
    ended_at: link.ended_at,
    ended_by: link.ended_by,
  });
}

// ── embed ─────────────────────────────────────────────────────────────────
async function embed(req: Request, body: Json) {
  const link = await linkBySecret(req);
  if (!link) return fail("unknown_link", 401);
  if (link.status !== "active") return fail("not_active", 403, { status: link.status });
  const page = String(body.page || "");
  if (!EMBED_PAGES.includes(page)) return fail("bad_page", 400, { pages: EMBED_PAGES });
  if (link.pages?.[page] !== true) return fail("page_off", 403);
  if (!await rateLimit(`packpulse-embed:${link.id}`, 3600, 600)) return fail("rate_limited", 429);

  const viewerIn = (body.viewer || {}) as Json;
  const viewer = text(viewerIn.email, 200).toLowerCase() || text(viewerIn.name, 120) || null;
  const parentOrigin = cleanOrigin(body.parent_origin) || link.packpulse_origin;
  const theme = body.theme === "dark" ? "dark" : "light";

  const ticket = randomToken(32);
  const expires = new Date(Date.now() + TICKET_TTL_MS).toISOString();
  const { error } = await supabase.from("packpulse_tickets").insert({
    ticket_hash: await sha256Hex(ticket), link_id: link.id, page, parent_origin: parentOrigin, viewer, expires_at: expires,
  });
  if (error) return fail("db_error", 500, { detail: error.message });
  await supabase.from("packpulse_links").update({ last_used_at: new Date().toISOString() }).eq("id", link.id);
  await logEvent(link.id, "view", viewer || "packpulse", { page });
  // Old tickets are worthless; keep the table small.
  await supabase.from("packpulse_tickets").delete().lt("expires_at", new Date(Date.now() - 86_400_000).toISOString());

  const q = new URLSearchParams({ t: ticket, p: page, theme });
  if (parentOrigin) q.set("o", parentOrigin);
  return json({ url: `${APP_ORIGIN}/packpulse-embed#${q}`, expires_at: expires });
}

// ── redeem (the embed page) ──────────────────────────────────────────────
async function redeem(req: Request, body: Json) {
  const ticket = String(body.ticket || "");
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(ticket)) return fail("invalid_ticket", 400);
  if (!await rateLimit(`packpulse-redeem:${clientIp(req)}`, 3600, 240)) return fail("rate_limited", 429);

  const hash = await sha256Hex(ticket);
  const { data: used } = await supabase.from("packpulse_tickets")
    .update({ used_at: new Date().toISOString() })
    .eq("ticket_hash", hash).is("used_at", null).gt("expires_at", new Date().toISOString())
    .select("link_id, page, parent_origin");
  const t = used && used[0];
  if (!t) return fail("ticket_expired", 410);

  const { data: found } = await supabase.from("packpulse_links").select(LINK_COLS).eq("id", t.link_id).maybeSingle();
  const link = found as Link | null;
  if (!link || link.status !== "active") return fail("not_active", 403, { status: link?.status || null });
  if (link.pages?.[t.page] !== true) return fail("page_off", 403);

  const email = `link-${link.id}@${LOGIN_DOMAIN}`;
  let uid = link.auth_user_id;
  if (!uid) {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      email_confirm: true,
      app_metadata: { packpulse_link: link.id },
      user_metadata: { name: `PackPulse · ${link.packpulse_org_name || "connection"}` },
    });
    if (error || !data?.user) return fail("login_failed", 500, { detail: error?.message });
    uid = data.user.id;
    const { data: set } = await supabase.from("packpulse_links").update({ auth_user_id: uid })
      .eq("id", link.id).is("auth_user_id", null).select("id");
    if (!set || !set.length) {
      // Another view created it a moment earlier: use that one.
      await deleteLogin(uid);
      const { data: again } = await supabase.from("packpulse_links").select("auth_user_id").eq("id", link.id).maybeSingle();
      uid = again?.auth_user_id || null;
      if (!uid) return fail("login_failed", 500);
    }
  }

  const { data: made, error: linkErr } = await supabase.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = made?.properties?.hashed_token;
  if (linkErr || !tokenHash || made?.user?.id !== uid) return fail("login_failed", 500, { detail: linkErr?.message });

  const v = await venue(link.org_id);
  const pages = effectivePages(link);
  return json({
    token_hash: tokenHash,
    page: t.page,
    pages,
    link_id: link.id,
    org_id: link.org_id,
    parent_origin: t.parent_origin,
    packpulse_org_name: link.packpulse_org_name,
    preview_url: pages.preview && v ? v.app_url : null,
  });
}

// ── disconnect (PackPulse ends it) ───────────────────────────────────────
async function disconnect(req: Request) {
  const link = await linkBySecret(req);
  if (!link) return fail("unknown_link", 401);
  if (!["pending", "active", "paused"].includes(link.status)) return json({ ok: true, status: link.status });
  const { error } = await supabase.from("packpulse_links").update({
    status: "revoked", auth_user_id: null, ended_by: "packpulse",
    ended_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq("id", link.id);
  if (error) return fail("db_error", 500, { detail: error.message });
  await deleteLogin(link.auth_user_id);
  await supabase.from("packpulse_tickets").delete().eq("link_id", link.id);
  await logEvent(link.id, "disconnected", "packpulse");
  return json({ ok: true, status: "revoked" });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return fail("method_not_allowed", 405);
  let body: Json = {};
  try { body = await req.json(); } catch { /* empty body is fine for status */ }
  try {
    switch (body.action) {
      case "claim": return await claim(req, body);
      case "status": return await status(req);
      case "embed": return await embed(req, body);
      case "redeem": return await redeem(req, body);
      case "disconnect": return await disconnect(req);
      default: return fail("unknown_action", 400);
    }
  } catch (e) {
    console.error("[packpulse-link]", e);
    return fail("server_error", 500);
  }
});
