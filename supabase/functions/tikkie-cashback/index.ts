// ──────────────────────────────────────────────────────────────────────
// PackPerks — tikkie-cashback Edge Function (Phase 2)
//
// The ONLY holder of the Tikkie Cashback API secrets. Admin-invoked from the
// claims workflow. On approve, mints a REAL cashback (a tikkie.me link the
// customer opens to get paid), replacing the Phase-1 placeholder link.
//
// Actions (POST JSON { action, ... }):
//   • create   { claim_id }   — approved claim → POST a cashback, store the
//                               real url/id/status/expiry on the claim. Idempotent.
//   • status   { claim_id | cashback_id } — GET a cashback, sync its status
//                               (CREATED|REDEEMED|EXPIRED) onto the claim.
//   • campaign {}             — GET campaign details (funds remaining) for the
//                               admin dashboard.
//   • subscribe   { url }     — (owner) register the redemption webhook URL.
//   • unsubscribe {}          — (owner) remove the redemption subscription.
//
// Auth: caller must be an admin (row in admin_profiles). subscribe/unsubscribe
// are owner-only. Tikkie itself authenticates with API-Key + X-App-Token headers.
//
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   TIKKIE_API_KEY, TIKKIE_APP_TOKEN,
//   TIKKIE_API_BASE_URL (e.g. https://api.abnamro.com/v1/tikkie/cashback),
//   TIKKIE_API_CAMPAIGN_URL (a campaignId, or a full campaign URL).
// ──────────────────────────────────────────────────────────────────────
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

// .trim() is defensive: a secret pasted into the Supabase dashboard with a
// trailing newline/space would otherwise be sent verbatim in the header and
// rejected as "API Key is invalid for the requested resource".
const API_KEY = (Deno.env.get("TIKKIE_API_KEY") ?? "").trim();
const APP_TOKEN = (Deno.env.get("TIKKIE_APP_TOKEN") ?? "").trim();
let BASE = (
  Deno.env.get("TIKKIE_API_BASE_URL") ||
  Deno.env.get("TIKKIE_API_URL") ||
  "https://api.abnamro.com/v1/tikkie/cashback"
).replace(/\/+$/, "");
// The Cashback API ALWAYS lives under .../tikkie/cashback. A base set to just
// .../tikkie (a common mistake) makes every call hit a resource the API key
// isn't entitled to → 401 ERR_2005_002. Append the missing segment defensively.
if (!/\/cashback$/i.test(BASE)) BASE = `${BASE}/cashback`;
const CAMPAIGN_RAW = (
  Deno.env.get("TIKKIE_API_CAMPAIGN_URL") ||
  Deno.env.get("TIKKIE_CAMPAIGN_ID") ||
  Deno.env.get("TIKKIE_API_CAMPAIGN_ID") ||
  ""
).trim();

// Brevo transactional email (the "your cashback is ready" message). Sent on
// approve when the customer opted into email. Sending is best-effort — a Brevo
// hiccup never blocks the payout.
const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY") ?? "";
const BREVO_SENDER_EMAIL = Deno.env.get("BREVO_SENDER_EMAIL") || "no-reply@packback.network";
const BREVO_SENDER_NAME = Deno.env.get("BREVO_SENDER_NAME") || "PackPerks";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "content-type": "application/json" } });

// Resolve the campaign resource base URL + id from whatever the secret holds:
// either a bare campaignId ("cashback-campaign-123") or a full campaign URL.
function resolveCampaign(): { campaignBase: string; campaignId: string } {
  const raw = CAMPAIGN_RAW;
  if (/^https?:\/\//i.test(raw)) {
    const cleaned = raw.replace(/\/+$/, "").replace(/\/cashbacks$/i, "");
    return { campaignBase: cleaned, campaignId: cleaned.split("/").pop() || "" };
  }
  if (raw) {
    return { campaignBase: `${BASE}/cashback-campaigns/${raw}`, campaignId: raw };
  }
  // Last resort: BASE may already point at the campaign resource.
  return { campaignBase: BASE, campaignId: BASE.split("/").pop() || "" };
}

function tikkieHeaders() {
  return {
    "API-Key": API_KEY,
    "X-App-Token": APP_TOKEN,
    "Content-Type": "application/json",
    "Accept": "application/json",
  };
}

// Tikkie referenceId/locationId/locationAddress must match a restricted pattern.
// Strip anything outside it, cap at 255, drop if empty.
function sanitizeRef(s: unknown): string | undefined {
  if (s == null) return undefined;
  const cleaned = String(s).replace(/[^a-zA-Z0-9!&'()+\-./:?_`, ]/g, "").slice(0, 255).trim();
  return cleaned.length ? cleaned : undefined;
}

async function callerAuthId(req: Request): Promise<string | null> {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const { data: { user } } = await supabase.auth.getUser(auth.replace("Bearer ", ""));
  return user?.id ?? null;
}
async function adminRow(authId: string | null): Promise<{ role: string; status: string } | null> {
  if (!authId) return null;
  const { data } = await supabase.from("admin_profiles")
    .select("role, status").eq("id", authId).maybeSingle();
  if (!data) return null;
  if (data.status && data.status !== "active") return null;
  return { role: data.role || "member", status: data.status || "active" };
}

// Per-org Tikkie location metadata (optional; admin-configured in app_config).
async function locationFor(orgId: string | null): Promise<{ locationId?: string; locationAddress?: string }> {
  if (!orgId) return {};
  try {
    const { data } = await supabase.from("app_config")
      .select("value").eq("key", `published:${orgId}`).maybeSingle();
    const s = (data?.value as { settings?: Record<string, unknown> } | null)?.settings || {};
    return {
      locationId: sanitizeRef(s.tikkieLocationId),
      locationAddress: sanitizeRef(s.tikkieLocationAddress),
    };
  } catch {
    return {};
  }
}

interface TikkieCashback {
  cashbackId: string;
  url: string;
  amountInCents: number;
  status: "CREATED" | "REDEEMED" | "EXPIRED";
  createdDateTime?: string;
  expiryDateTime?: string;
  redeemedDateTime?: string;
}

async function readTikkieError(resp: Response): Promise<{ code?: string; message?: string; raw: string }> {
  const raw = await resp.text();
  try {
    const j = JSON.parse(raw);
    const first = Array.isArray(j?.errors) ? j.errors[0] : null;
    return { code: first?.code, message: first?.message, raw };
  } catch {
    return { raw };
  }
}

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

/* PackPerks-branded "your cashback is ready" email. Table-based + inline styles
 * so Gmail/Outlook render it faithfully; cream canvas, DM-Sans-first stack, a
 * bulletproof orange CTA. Mirrors the in-app design language. */
function tikkieReadyEmailHtml(opts: { name?: string; amount: number; url: string; reward?: string; orgName?: string }): string {
  const amount = `€${(opts.amount || 0).toFixed(2)}`;
  const hi = opts.name ? `Hi ${esc(opts.name)},` : "Hi there,";
  const rewardLine = opts.reward
    ? `Your <strong>${esc(opts.reward)}</strong> cashback is approved and ready to collect.`
    : `Your cashback is approved and ready to collect.`;
  const font = "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:#F4EBDC;font-family:${font};-webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4EBDC;padding:34px 14px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:464px;background:#FFFFFF;border-radius:26px;overflow:hidden;box-shadow:0 14px 40px rgba(70,48,20,0.12);">
        <tr><td align="center" style="padding:38px 36px 0;">
          <div style="font-size:25px;font-weight:800;letter-spacing:-0.01em;color:#EBA80C;">PackPerks</div>
          <div style="font-size:10.5px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:#C4B49A;margin-top:7px;">Reusable-cup rewards</div>
        </td></tr>
        <tr><td align="center" style="padding:26px 40px 0;">
          <p style="margin:0 0 6px;font-size:15px;color:#6B6154;">${hi}</p>
          <h1 style="margin:0 0 10px;font-size:23px;line-height:1.3;font-weight:800;color:#241E16;">Your ${amount} cashback is ready 🎉</h1>
          <p style="margin:0;font-size:15px;line-height:1.55;color:#6B6154;">${rewardLine} Tap below to collect it securely through <strong style="color:#3A342C;">Tikkie</strong>.</p>
        </td></tr>
        <tr><td align="center" style="padding:26px 36px 4px;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="border-radius:14px;background:#E24400;box-shadow:0 6px 16px rgba(226,68,0,0.28);">
              <a href="${esc(opts.url)}" target="_blank" style="display:inline-block;padding:16px 36px;font-size:16px;font-weight:800;color:#FFFFFF;text-decoration:none;border-radius:14px;">Collect ${amount} via Tikkie</a>
            </td>
          </tr></table>
        </td></tr>
        <tr><td align="center" style="padding:18px 40px 0;">
          <p style="margin:0;font-size:12.5px;line-height:1.55;color:#9A9186;">The link opens in the Tikkie app and is unique to you, so please don&rsquo;t share it. Collect it soon, as cashback links expire.</p>
        </td></tr>
        <tr><td style="padding:28px 40px 34px;">
          <div style="border-top:1px solid #F1EADD;padding-top:18px;">
            <p style="margin:0;font-size:12px;line-height:1.55;color:#B4AC9E;text-align:center;">You&rsquo;re receiving this because you asked us to email you about this cashback.<br />Questions? <a href="mailto:info@packback.network" style="color:#9A9186;">info@packback.network</a></p>
          </div>
        </td></tr>
      </table>
      <p style="margin:18px 0 0;font-size:11px;color:#BBB09E;">PackPerks &middot; Bring your cup, earn cashback</p>
    </td></tr>
  </table>
</body></html>`;
}

// Best-effort Brevo transactional send. Never throws — email is a courtesy on
// top of the in-app "Collect via Tikkie" card, so a send failure must not break
// the payout. Returns a small status object for the response.
async function sendBrevoEmail(to: string, subject: string, html: string, text: string): Promise<{ ok: boolean; error?: string }> {
  if (!BREVO_API_KEY) return { ok: false, error: "brevo_not_configured" };
  try {
    const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": BREVO_API_KEY, "content-type": "application/json", "accept": "application/json" },
      body: JSON.stringify({
        sender: { name: BREVO_SENDER_NAME, email: BREVO_SENDER_EMAIL },
        to: [{ email: to }],
        subject,
        htmlContent: html,
        textContent: text,
        tags: ["tikkie-cashback"],
      }),
    });
    if (!resp.ok) return { ok: false, error: `brevo_${resp.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  if (!API_KEY || !APP_TOKEN) return json({ error: "tikkie_not_configured" }, 503);

  let body: { action?: string; claim_id?: string; cashback_id?: string; url?: string };
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const authId = await callerAuthId(req);
  const admin = await adminRow(authId);
  if (!admin) return json({ error: "forbidden" }, 403);

  const { campaignBase, campaignId } = resolveCampaign();

  // ── create: mint a real cashback for an approved claim ──────────────────
  if (body.action === "create") {
    if (!body.claim_id) return json({ error: "missing_claim_id" }, 400);
    // A.7: minting spends REAL money — restrict to owner/admin (managers excluded).
    if (admin.role !== "owner" && admin.role !== "admin") {
      return json({ error: "insufficient_role", detail: `role=${admin.role}` }, 403);
    }
    const { data: claim, error: cErr } = await supabase.from("claims")
      .select("id, org_id, type, status, payout_amount, tikkie_cashback_id, tikkie_url, tikkie_status, notify_email, user_id, reward_id")
      .eq("id", body.claim_id).maybeSingle();
    if (cErr) return json({ error: "db_error", detail: cErr.message }, 500);
    if (!claim) return json({ error: "claim_not_found" }, 404);

    // Idempotent — never double-mint. Return the existing cashback.
    if (claim.tikkie_cashback_id) {
      return json({
        status: "exists",
        cashbackId: claim.tikkie_cashback_id,
        url: claim.tikkie_url,
        tikkie_status: claim.tikkie_status,
      });
    }

    // A.4: only mint for an APPROVED claim of a payable type. The admin approve
    // flow sets status='completed' before calling this, and pays out both
    // 'cashback' and 'direct_refund' via Tikkie. Anything else must not spend.
    if (claim.status !== "completed") {
      return json({ error: "claim_not_approved", detail: `status=${claim.status}` }, 409);
    }
    if (claim.type !== "cashback" && claim.type !== "direct_refund") {
      return json({ error: "bad_claim_type", detail: `type=${claim.type}` }, 400);
    }

    const amountInCents = Math.round(Number(claim.payout_amount) * 100);
    if (!Number.isFinite(amountInCents) || amountInCents <= 0) {
      return json({ error: "bad_amount", detail: `payout_amount=${claim.payout_amount}` }, 400);
    }

    const loc = await locationFor(claim.org_id);
    const payload: Record<string, unknown> = {
      amountInCents,
      referenceId: sanitizeRef(claim.id),
      ...(loc.locationId ? { locationId: loc.locationId } : {}),
      ...(loc.locationAddress ? { locationAddress: loc.locationAddress } : {}),
    };

    // Every Tikkie call is logged (action, claim, amount, HTTP status) so the
    // Supabase edge-function logs tell the full story of each payout attempt.
    console.log(`[tikkie] create → claim=${claim.id} amount=${amountInCents}c url=${campaignBase}/cashbacks`);
    const recordError = async (msg: string) => {
      console.error(`[tikkie] create FAILED → claim=${claim.id}: ${msg}`);
      await supabase.from("claims").update({
        // A.3: clear the 'minting' lock so the admin's "retry" can re-grab it.
        // (Only reached on a pre-payment failure — after a successful POST we
        // never reset, so a paid cashback can never be minted twice.)
        tikkie_status: null,
        tikkie_last_error: msg.slice(0, 500),
        tikkie_last_error_at: new Date().toISOString(),
      }).eq("id", claim.id);
    };

    // A.3: atomically CLAIM this mint before spending. Two concurrent create
    // calls (double-click approve, retry, bulk-approve) would both read
    // tikkie_cashback_id=null and both POST — paying the customer twice. This
    // single UPDATE flips tikkie_status → 'minting'; Postgres serialises it on
    // the row, so only ONE call flips it and proceeds to POST. The loser matches
    // zero rows and returns the current state instead of paying again. A normal
    // one-off mint (tikkie_status null) always wins, so the happy path is
    // untouched; the sentinel is cleared on any pre-payment failure (recordError).
    const { data: grabbed, error: grabErr } = await supabase.from("claims")
      .update({ tikkie_status: "minting" })
      .eq("id", claim.id)
      .is("tikkie_cashback_id", null)
      .or("tikkie_status.is.null,tikkie_status.neq.minting")
      .select("id").maybeSingle();
    if (grabErr) return json({ error: "db_error", detail: grabErr.message }, 500);
    if (!grabbed) {
      const { data: cur } = await supabase.from("claims")
        .select("tikkie_cashback_id, tikkie_url, tikkie_status")
        .eq("id", claim.id).maybeSingle();
      return json({
        status: "in_progress",
        cashbackId: cur?.tikkie_cashback_id ?? null,
        url: cur?.tikkie_url ?? null,
        tikkie_status: cur?.tikkie_status ?? "minting",
      });
    }

    let resp: Response;
    try {
      resp = await fetch(`${campaignBase}/cashbacks`, {
        method: "POST", headers: tikkieHeaders(), body: JSON.stringify(payload),
      });
    } catch (e) {
      await recordError(`tikkie_unreachable: ${String(e)}`);
      return json({ error: "tikkie_unreachable", detail: String(e) }, 502);
    }
    if (!resp.ok) {
      const err = await readTikkieError(resp);
      // Self-diagnose with the SAME secrets: does a READ (GET campaign) work?
      //   • read OK  + create fails → key/base are valid; create-specific entitlement.
      //   • read ALSO fails         → the API key or base URL itself is wrong.
      let selfTest = "skipped";
      try {
        const c = await fetch(campaignBase, { headers: tikkieHeaders() });
        selfTest = `GETcampaign=HTTP${c.status}`;
        if (!c.ok) selfTest += `(${(await readTikkieError(c)).code || "?"})`;
      } catch (_e) {
        selfTest = "GETcampaign=unreachable";
      }
      const cfg = `base=${BASE} | createURL=${campaignBase}/cashbacks | keyLen=${API_KEY.length} tokenLen=${APP_TOKEN.length} tokenUuid=${/^[0-9a-fA-F-]{36}$/.test(APP_TOKEN)}`;
      await recordError(`HTTP ${resp.status} ${err.code || ""} ${err.message || err.raw || ""} || ${selfTest} || ${cfg}`.trim());
      return json({ error: "tikkie_create_failed", httpStatus: resp.status, code: err.code, message: err.message, detail: err.raw, selfTest, cfg }, 502);
    }
    const cb = await resp.json() as TikkieCashback;
    console.log(`[tikkie] create OK → claim=${claim.id} cashbackId=${cb.cashbackId} status=${cb.status}`);

    const update = {
      tikkie_url: cb.url,
      tikkie_cashback_id: cb.cashbackId,
      tikkie_status: String(cb.status || "CREATED").toLowerCase(),
      tikkie_expires_at: cb.expiryDateTime ?? null,
      tikkie_last_error: null, // clear any earlier failed attempt
      tikkie_last_error_at: null,
      payout_status: "sent",
      notified_at: new Date().toISOString(),
    };
    const { error: uErr } = await supabase.from("claims").update(update).eq("id", claim.id);
    if (uErr) return json({ error: "claim_update_failed", detail: uErr.message, cashback: cb }, 500);

    // Notify the customer by email (best-effort) when they opted in. The link is
    // also on their in-app "Collect via Tikkie" card, so this never blocks.
    let emailSent = false;
    let emailError: string | undefined;
    try {
      if (claim.notify_email && claim.user_id) {
        const { data: u } = await supabase.from("users")
          .select("email, display_name").eq("id", claim.user_id).maybeSingle();
        if (u?.email) {
          const amount = Number(claim.payout_amount) || 0;
          const html = tikkieReadyEmailHtml({ name: u.display_name, amount, url: cb.url });
          const text =
            `${u.display_name ? `Hi ${u.display_name},` : "Hi there,"}\n\n` +
            `Your €${amount.toFixed(2)} cashback is approved and ready to collect via Tikkie:\n${cb.url}\n\n` +
            `The link is unique to you, so please don't share it, and collect it soon as cashback links expire.\n\nPackPerks`;
          const r = await sendBrevoEmail(u.email, `Your €${amount.toFixed(2)} cashback is ready`, html, text);
          emailSent = r.ok;
          emailError = r.error;
        }
      }
    } catch (e) {
      emailError = String(e);
    }

    return json({ status: "created", cashbackId: cb.cashbackId, url: cb.url, tikkie_status: update.tikkie_status, expiryDateTime: cb.expiryDateTime, emailSent, emailError });
  }

  // ── status: sync one cashback's live status onto the claim ──────────────
  if (body.action === "status") {
    let cashbackId = body.cashback_id;
    let claimId = body.claim_id;
    if (!cashbackId && claimId) {
      const { data } = await supabase.from("claims")
        .select("tikkie_cashback_id").eq("id", claimId).maybeSingle();
      cashbackId = data?.tikkie_cashback_id || undefined;
    }
    if (!cashbackId) return json({ error: "no_cashback_id" }, 400);

    console.log(`[tikkie] status → cashbackId=${cashbackId}`);
    let resp: Response;
    try {
      resp = await fetch(`${campaignBase}/cashbacks/${cashbackId}`, { headers: tikkieHeaders() });
    } catch (e) {
      console.error(`[tikkie] status unreachable → ${String(e)}`);
      return json({ error: "tikkie_unreachable", detail: String(e) }, 502);
    }
    if (!resp.ok) {
      const err = await readTikkieError(resp);
      console.error(`[tikkie] status FAILED → HTTP ${resp.status} ${err.code || ""} ${err.raw || ""}`);
      return json({ error: "tikkie_status_failed", httpStatus: resp.status, code: err.code, detail: err.raw }, 502);
    }
    const cb = await resp.json() as TikkieCashback;
    const tikkie_status = String(cb.status || "").toLowerCase();
    console.log(`[tikkie] status OK → cashbackId=${cashbackId} status=${tikkie_status}`);
    const { error: uErr } = await supabase.from("claims").update({
      tikkie_status,
      tikkie_redeemed_at: cb.redeemedDateTime ?? null,
      tikkie_expires_at: cb.expiryDateTime ?? null,
    }).eq("tikkie_cashback_id", cashbackId);
    if (uErr) return json({ error: "claim_update_failed", detail: uErr.message }, 500);

    return json({ status: "synced", cashbackId, tikkie_status, redeemedDateTime: cb.redeemedDateTime, expiryDateTime: cb.expiryDateTime });
  }

  // ── campaign: funds + status for the admin dashboard ────────────────────
  if (body.action === "campaign") {
    let resp: Response;
    try {
      resp = await fetch(campaignBase, { headers: tikkieHeaders() });
    } catch (e) {
      return json({ error: "tikkie_unreachable", detail: String(e) }, 502);
    }
    if (!resp.ok) {
      const err = await readTikkieError(resp);
      return json({ error: "tikkie_campaign_failed", httpStatus: resp.status, code: err.code, detail: err.raw }, 502);
    }
    return json({ status: "ok", campaign: await resp.json(), campaignId });
  }

  // ── subscribe / unsubscribe: redemption webhook (owner-only) ────────────
  if (body.action === "subscribe" || body.action === "unsubscribe") {
    if (admin.role !== "owner") return json({ error: "owner_only" }, 403);

    if (body.action === "subscribe") {
      if (!body.url) return json({ error: "missing_url" }, 400);
      let resp: Response;
      try {
        resp = await fetch(`${BASE}/cashback-subscriptions`, {
          method: "POST", headers: tikkieHeaders(), body: JSON.stringify({ url: body.url }),
        });
      } catch (e) {
        return json({ error: "tikkie_unreachable", detail: String(e) }, 502);
      }
      if (!resp.ok) {
        const err = await readTikkieError(resp);
        return json({ error: "tikkie_subscribe_failed", httpStatus: resp.status, code: err.code, detail: err.raw }, 502);
      }
      const sub = await resp.json() as { subscriptionId?: string };
      await supabase.from("app_config").upsert(
        { key: "tikkie:subscription", value: { subscriptionId: sub.subscriptionId, url: body.url, updated_at: new Date().toISOString() } },
        { onConflict: "key" },
      );
      return json({ status: "subscribed", subscriptionId: sub.subscriptionId });
    }

    // unsubscribe
    let resp: Response;
    try {
      resp = await fetch(`${BASE}/cashback-subscriptions`, { method: "DELETE", headers: tikkieHeaders() });
    } catch (e) {
      return json({ error: "tikkie_unreachable", detail: String(e) }, 502);
    }
    if (!resp.ok && resp.status !== 204) {
      const err = await readTikkieError(resp);
      return json({ error: "tikkie_unsubscribe_failed", httpStatus: resp.status, code: err.code, detail: err.raw }, 502);
    }
    await supabase.from("app_config").delete().eq("key", "tikkie:subscription");
    return json({ status: "unsubscribed" });
  }

  return json({ error: "unknown_action" }, 400);
});
