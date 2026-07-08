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

const API_KEY = Deno.env.get("TIKKIE_API_KEY") ?? "";
const APP_TOKEN = Deno.env.get("TIKKIE_APP_TOKEN") ?? "";
const BASE = (
  Deno.env.get("TIKKIE_API_BASE_URL") ||
  Deno.env.get("TIKKIE_API_URL") ||
  "https://api.abnamro.com/v1/tikkie/cashback"
).replace(/\/+$/, "");
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
<body style="margin:0;padding:0;background:#F4EBDC;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4EBDC;padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:460px;background:#FFFFFF;border-radius:22px;overflow:hidden;box-shadow:0 8px 30px rgba(60,42,20,0.10);">
        <tr><td style="background:#1A1512;padding:22px 28px;">
          <span style="font-family:${font};font-size:19px;font-weight:800;color:#FFFFFF;letter-spacing:-0.01em;">Pack<span style="color:#E8B34A;">Perks</span></span>
        </td></tr>
        <tr><td style="padding:30px 28px 8px;">
          <p style="margin:0 0 6px;font-family:${font};font-size:15px;color:#6B6154;">${hi}</p>
          <h1 style="margin:0 0 10px;font-family:${font};font-size:23px;line-height:1.25;font-weight:800;color:#1A1512;">Your ${amount} cashback is ready 🎉</h1>
          <p style="margin:0 0 22px;font-family:${font};font-size:15px;line-height:1.55;color:#5A5348;">${rewardLine} Tap below to collect it securely through <strong>Tikkie</strong>.</p>
        </td></tr>
        <tr><td align="center" style="padding:0 28px;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="border-radius:14px;background:#E24400;">
              <a href="${esc(opts.url)}" target="_blank" style="display:inline-block;padding:15px 34px;font-family:${font};font-size:16px;font-weight:800;color:#FFFFFF;text-decoration:none;border-radius:14px;">Collect ${amount} via Tikkie</a>
            </td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:18px 28px 4px;">
          <p style="margin:0;font-family:${font};font-size:12.5px;line-height:1.5;color:#9A9186;text-align:center;">The link opens in the Tikkie app. It's unique to you — please don't share it. Collect it soon, as cashback links expire.</p>
        </td></tr>
        <tr><td style="padding:22px 28px 26px;">
          <div style="border-top:1px solid #EFE7D8;padding-top:16px;">
            <p style="margin:0;font-family:${font};font-size:12px;line-height:1.55;color:#B4AC9E;">You're receiving this because you asked us to email you about this cashback. Questions? Just reply or reach us at <a href="mailto:info@packback.network" style="color:#9A9186;">info@packback.network</a>.</p>
          </div>
        </td></tr>
      </table>
      <p style="margin:16px 0 0;font-family:${font};font-size:11px;color:#B4AC9E;">PackPerks · Bring your cup, earn cashback</p>
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

    let resp: Response;
    try {
      resp = await fetch(`${campaignBase}/cashbacks`, {
        method: "POST", headers: tikkieHeaders(), body: JSON.stringify(payload),
      });
    } catch (e) {
      return json({ error: "tikkie_unreachable", detail: String(e) }, 502);
    }
    if (!resp.ok) {
      const err = await readTikkieError(resp);
      return json({ error: "tikkie_create_failed", httpStatus: resp.status, code: err.code, message: err.message, detail: err.raw }, 502);
    }
    const cb = await resp.json() as TikkieCashback;

    const update = {
      tikkie_url: cb.url,
      tikkie_cashback_id: cb.cashbackId,
      tikkie_status: String(cb.status || "CREATED").toLowerCase(),
      tikkie_expires_at: cb.expiryDateTime ?? null,
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
            `The link is unique to you — please don't share it, and collect it soon as cashback links expire.\n\nPackPerks`;
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

    let resp: Response;
    try {
      resp = await fetch(`${campaignBase}/cashbacks/${cashbackId}`, { headers: tikkieHeaders() });
    } catch (e) {
      return json({ error: "tikkie_unreachable", detail: String(e) }, 502);
    }
    if (!resp.ok) {
      const err = await readTikkieError(resp);
      return json({ error: "tikkie_status_failed", httpStatus: resp.status, code: err.code, detail: err.raw }, 502);
    }
    const cb = await resp.json() as TikkieCashback;
    const tikkie_status = String(cb.status || "").toLowerCase();
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
