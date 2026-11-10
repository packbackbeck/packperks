// ----------------------------------------------------------------------
// auto-cashout — Deferred Refund's automatic cashout (migration 071).
//
// A customer picks a tier on the wallet's slider (action `set`, below):
// every week, every month or every 3 months. Each hour
// pg_cron calls this function, and for every schedule that is due it:
//
//   1. moves the schedule's next date on FIRST, conditionally, so two runs
//      can never pay the same schedule twice;
//   2. sweeps the wallet into one payout row — the same atomic sweep as
//      bin-tikkie's `redeem` (Collect), so a Collect at the same moment
//      can't take the same credits;
//   3. adds the venue's bonus for that tier (published settings, never the
//      request; capped at MAX_BONUS_PCT) and mints ONE Tikkie link;
//   4. emails the link to the wallet's address.
//
// An empty wallet just waits for its next date. A failed mint puts the
// money back (as Collect does), writes the same system_events failure row,
// and tries again in an hour.
//
// Callers:
//   scheduled — pg_cron, header x-cron-secret matching
//               app_config 'auto_cashout_cron'.secret.
//   dry run   — the same secret with { dry_run: true, user_ids?: [...],
//               tier? }: what each wallet would be paid now. Reads only.
//   the wallet — { action: 'get' | 'set' | 'verify', org_id, device_id,
//               tier?, code? }: the customer's own schedule. Like every
//               bin-tikkie wallet call, holding the device that owns the
//               wallet IS the identity. A tier is saved only for a verified
//               email (migration 072): a Google login with that address, or
//               a 6-digit code `set` sends and `verify` checks. These live
//               here rather than in bin-tikkie so the payout path's
//               function didn't have to change for this feature.
//
// verify_jwt is false: the cron caller has no JWT; the secret is the gate,
// and the wallet calls only ever touch the calling device's own schedule.
// ----------------------------------------------------------------------
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

// The Tikkie contract, as bin-tikkie and tikkie-sweep read it.
const API_KEY = (Deno.env.get("TIKKIE_API_KEY") ?? "").trim();
const APP_TOKEN = (Deno.env.get("TIKKIE_APP_TOKEN") ?? "").trim();
let BASE = (
  Deno.env.get("TIKKIE_API_BASE_URL") ||
  Deno.env.get("TIKKIE_API_URL") ||
  "https://api.abnamro.com/v1/tikkie/cashback"
).replace(/\/+$/, "");
if (!/\/cashback$/i.test(BASE)) BASE = `${BASE}/cashback`;
const CAMPAIGN_RAW = (
  Deno.env.get("TIKKIE_API_CAMPAIGN_URL") ||
  Deno.env.get("TIKKIE_CAMPAIGN_ID") ||
  Deno.env.get("TIKKIE_API_CAMPAIGN_ID") ||
  ""
).trim();

const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY") ?? "";
const BREVO_SENDER_EMAIL = Deno.env.get("BREVO_SENDER_EMAIL") || "no-reply@packback.network";
const BREVO_SENDER_NAME = Deno.env.get("BREVO_SENDER_NAME") || "PackPerks";
const APP_ORIGIN = "https://perks.packback.network";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "content-type": "application/json" } });

// One run stays well inside the function's time budget; whatever is left
// is still due at the next tick.
const MAX_MS = 40_000;
const BATCH = 60;
const RETRY_MS = 60 * 60 * 1000;

/* The tiers and their default bonus: src/lib/autoCashout.js holds the same
 * numbers for the app and the dashboard. Keep the two in step. */
const TIERS: Record<string, { label: string; every: string; days?: number; months?: number; bonus: number }> = {
  week: { label: "1 week", every: "every week", days: 7, bonus: 5 },
  month: { label: "1 month", every: "every month", months: 1, bonus: 10 },
  quarter: { label: "3 months", every: "every 3 months", months: 3, bonus: 15 },
};
const MAX_BONUS_PCT = 50;

// A credit is a scanned receipt or the change a part-donation left behind
// (bin-tikkie WALLET_CREDIT).
const WALLET_CREDIT = "batch_id.not.is.null,type.eq.wallet_change";

function addInterval(from: Date, tier: string): Date {
  const t = TIERS[tier];
  const d = new Date(from.getTime());
  if (t?.days) d.setUTCDate(d.getUTCDate() + t.days);
  else d.setUTCMonth(d.getUTCMonth() + (t?.months ?? 1));
  return d;
}

/* The venue's bonus for a tier, from its published settings. */
function bonusPct(settings: Record<string, unknown>, tier: string): number {
  if (settings.autoCashoutBonus !== true) return 0;
  const set = (settings.autoCashoutBonusPct ?? {}) as Record<string, unknown>;
  const raw = Number(set[tier] ?? TIERS[tier]?.bonus ?? 0);
  return Number.isFinite(raw) ? Math.min(MAX_BONUS_PCT, Math.max(0, Math.round(raw * 100) / 100)) : 0;
}

const euros = (n: number) => `€${n.toFixed(2)}`;
const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c] as string));

type Venue = { settings: Record<string, unknown>; name: string; slug: string | null };
const venues = new Map<string, Venue | null>();
async function venue(orgId: string): Promise<Venue | null> {
  if (venues.has(orgId)) return venues.get(orgId)!;
  const [{ data: cfg }, { data: org }] = await Promise.all([
    supabase.from("app_config").select("value").eq("key", `published:${orgId}`).maybeSingle(),
    supabase.from("organizations").select("name, slug, deleted_at").eq("id", orgId).maybeSingle(),
  ]);
  const settings = ((cfg?.value as { settings?: Record<string, unknown> } | null)?.settings) || {};
  const v = org && !org.deleted_at ? { settings, name: org.name || "PackPerks", slug: org.slug || null } : null;
  venues.set(orgId, v);
  return v;
}

/* Is this venue paying automatic cashouts right now? */
const venueOn = (v: Venue | null) => !!v && v.settings.mode === "tikkie_only" && v.settings.autoCashout === true;

async function walletBalance(userId: string): Promise<number> {
  const { data } = await supabase.from("claims").select("payout_amount")
    .eq("user_id", userId).or(WALLET_CREDIT).is("payout_claim_id", null).is("tikkie_url", null);
  return Math.round((data || []).reduce((t, r) => t + Number(r.payout_amount || 0), 0) * 100) / 100;
}

function tikkieHeaders() {
  return { "API-Key": API_KEY, "X-App-Token": APP_TOKEN, "Content-Type": "application/json", "Accept": "application/json" };
}
function campaignBase(): string {
  if (/^https?:\/\//i.test(CAMPAIGN_RAW)) return CAMPAIGN_RAW.replace(/\/+$/, "").replace(/\/cashbacks$/i, "");
  return CAMPAIGN_RAW ? `${BASE}/cashback-campaigns/${CAMPAIGN_RAW}` : BASE;
}

/* Mint one cashback for a payout row: bin-tikkie mintForClaim's contract,
 * including the 'minting' lock it shares with tikkie-cashback. */
async function mint(claimId: string, amount: number): Promise<{ url: string } | { error: string }> {
  const amountInCents = Math.round(amount * 100);
  if (!Number.isFinite(amountInCents) || amountInCents <= 0) return { error: "bad_amount" };
  const { data: grabbed } = await supabase.from("claims")
    .update({ tikkie_status: "minting" })
    .eq("id", claimId).is("tikkie_cashback_id", null)
    .or("tikkie_status.is.null,tikkie_status.neq.minting")
    .select("id").maybeSingle();
  if (!grabbed) return { error: "mint_locked" };

  const fail = async (msg: string) => {
    await supabase.from("claims").update({
      tikkie_status: null,
      tikkie_last_error: msg.slice(0, 500),
      tikkie_last_error_at: new Date().toISOString(),
    }).eq("id", claimId);
    return { error: msg };
  };
  let resp: Response;
  try {
    resp = await fetch(`${campaignBase()}/cashbacks`, {
      method: "POST",
      headers: tikkieHeaders(),
      body: JSON.stringify({ amountInCents, referenceId: claimId }),
    });
  } catch (e) {
    return fail(`tikkie_unreachable: ${String(e)}`);
  }
  if (!resp.ok) {
    const raw = await resp.text().catch(() => "");
    return fail(`HTTP ${resp.status} ${raw}`.trim());
  }
  const cb = await resp.json() as { cashbackId: string; url: string; status?: string; expiryDateTime?: string };
  const { error } = await supabase.from("claims").update({
    tikkie_url: cb.url,
    tikkie_cashback_id: cb.cashbackId,
    tikkie_status: String(cb.status || "CREATED").toLowerCase(),
    tikkie_expires_at: cb.expiryDateTime ?? null,
    tikkie_last_error: null,
    tikkie_last_error_at: null,
    payout_status: "sent",
    notified_at: new Date().toISOString(),
  }).eq("id", claimId);
  if (error) return { error: `claim_update_failed: ${error.message}` };
  return { url: cb.url };
}

/* The email that carries the link. Automatic cashout exists so the
 * customer doesn't have to open the app and ask, so here — unlike every
 * other payout — the link IS in the email. It is the same link the app's
 * activity list offers. */
async function sendLinkEmail(to: string, v: Venue, tier: string, o: {
  url: string; deposit: number; bonus: number; pct: number; total: number;
}): Promise<boolean> {
  if (!BREVO_API_KEY) return false;
  const t = TIERS[tier];
  const app = v.slug ? `${APP_ORIGIN}/${v.slug}/` : APP_ORIGIN;
  const months = Number(v.settings.payoutExpiryMonths ?? 3);
  const deadline = months > 0 ? `Collect it within ${months} month${months === 1 ? "" : "s"}.` : "";
  const subject = o.bonus > 0
    ? `Your ${euros(o.total)} is ready, including a ${euros(o.bonus)} bonus`
    : `Your ${euros(o.total)} deposit is ready to collect`;
  const bonusLine = o.bonus > 0
    ? `${euros(o.deposit)} deposit + ${euros(o.bonus)} bonus (${o.pct}% for cashing out ${t.every})`
    : `Your deposit from ${v.name}`;
  const text = [
    `Your deposit is ready: ${euros(o.total)}`,
    bonusLine,
    "",
    `Collect it with Tikkie: ${o.url}`,
    "Tikkie asks for your IBAN and name, and the money is in your account within minutes.",
    deadline,
    "",
    `You chose automatic cashout ${t.every} at ${v.name}. Change it or stop it in the app: ${app}`,
  ].filter((l, i, a) => l || a[i - 1]).join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#F6F1E8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1F1B16">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F1E8;padding:28px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#ffffff;border-radius:18px;padding:28px 24px">
<tr><td style="font-size:12px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:#8A8175">${esc(v.name)} · Automatic cashout</td></tr>
<tr><td style="padding-top:10px;font-size:22px;font-weight:800">Your deposit is ready</td></tr>
<tr><td style="padding-top:14px;font-size:44px;font-weight:800;letter-spacing:-.02em">${euros(o.total)}</td></tr>
<tr><td style="padding-top:4px;font-size:14px;color:#5C554B">${esc(bonusLine)}</td></tr>
<tr><td style="padding-top:22px"><a href="${esc(o.url)}" style="display:block;text-align:center;background:#47478A;color:#ffffff;text-decoration:none;font-weight:800;font-size:16px;padding:15px 18px;border-radius:14px">Collect with Tikkie</a></td></tr>
<tr><td style="padding-top:14px;font-size:13px;line-height:1.55;color:#5C554B">Tikkie asks for your IBAN and name, and the money is in your account within minutes. ${esc(deadline)}</td></tr>
<tr><td style="padding-top:20px;border-top:1px solid #F0EAE0;font-size:12px;line-height:1.55;color:#8A8175">You chose automatic cashout ${esc(t.every)}. <a href="${esc(app)}" style="color:#47478A;font-weight:700">Change it or stop it in the app</a>.</td></tr>
</table></td></tr></table></body></html>`;
  try {
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": BREVO_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({
        sender: { email: BREVO_SENDER_EMAIL, name: BREVO_SENDER_NAME },
        to: [{ email: to }],
        subject,
        textContent: text,
        htmlContent: html,
      }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

type Schedule = { user_id: string; org_id: string; tier: string; next_at: string; verified_email?: string | null };
type Outcome = { user_id: string; result: string; amount?: number; bonus?: number; emailed?: boolean; error?: string };

/* One due schedule, start to finish. */
async function runOne(s: Schedule, now: Date): Promise<Outcome> {
  // 1. Claim it by moving the date on — only if nobody else already did.
  const prev = new Date(s.next_at);
  let next = addInterval(prev, s.tier);
  if (next <= now) next = addInterval(now, s.tier);
  const { data: claimed } = await supabase.from("auto_cashouts")
    .update({ next_at: next.toISOString(), last_run_at: now.toISOString(), updated_at: now.toISOString() })
    .eq("user_id", s.user_id).eq("next_at", s.next_at)
    .select("user_id").maybeSingle();
  if (!claimed) return { user_id: s.user_id, result: "taken" };

  const note = (patch: Record<string, unknown>) =>
    supabase.from("auto_cashouts").update({ ...patch, updated_at: new Date().toISOString() }).eq("user_id", s.user_id);

  const v = await venue(s.org_id);
  if (!venueOn(v)) {
    await note({ last_error: "venue_off" });
    return { user_id: s.user_id, result: "venue_off" };
  }
  const { data: user } = await supabase.from("users")
    .select("id, email, org_id, merged_into").eq("id", s.user_id).maybeSingle();
  if (!user || user.merged_into || user.org_id !== s.org_id || !user.email) {
    // Nobody left to send it to: the schedule goes, the money stays in the wallet.
    await supabase.from("auto_cashouts").delete().eq("user_id", s.user_id);
    return { user_id: s.user_id, result: "dropped" };
  }
  // Only to the address that was proven. A changed email waits until the
  // new one is confirmed in the app; the money stays in the wallet.
  if (!s.verified_email || user.email.toLowerCase() !== s.verified_email.toLowerCase()) {
    await note({ last_error: "email_unverified" });
    return { user_id: s.user_id, result: "unverified" };
  }

  // 2. The payout row, then the atomic sweep (bin-tikkie redeemAction).
  const { data: payout, error: insErr } = await supabase.from("claims").insert({
    user_id: user.id,
    org_id: s.org_id,
    type: "cashback",
    status: "completed",
    payout_status: "queued",
    cups_redeemed: 0,
    payout_amount: 0,
    batch_id: null,
    notify_email: false,
    notify_push: false,
    auto_cashout_tier: s.tier,
  }).select("id").maybeSingle();
  if (insErr || !payout) {
    await note({ next_at: new Date(now.getTime() + RETRY_MS).toISOString(), last_error: `insert: ${insErr?.message}` });
    return { user_id: s.user_id, result: "error", error: insErr?.message };
  }
  const { data: swept, error: sweepErr } = await supabase.from("claims")
    .update({ payout_claim_id: payout.id })
    .eq("user_id", user.id).or(WALLET_CREDIT)
    .is("payout_claim_id", null).is("tikkie_url", null)
    .select("payout_amount, cups_redeemed");
  if (sweepErr || !swept?.length) {
    await supabase.from("claims").delete().eq("id", payout.id);
    if (sweepErr) {
      await note({ next_at: new Date(now.getTime() + RETRY_MS).toISOString(), last_error: `sweep: ${sweepErr.message}` });
      return { user_id: s.user_id, result: "error", error: sweepErr.message };
    }
    await note({ last_error: null });
    return { user_id: s.user_id, result: "empty" };
  }

  // 3. Deposit + the venue's bonus for this tier.
  const deposit = Math.round(swept.reduce((t, r) => t + Number(r.payout_amount || 0), 0) * 100) / 100;
  const cups = swept.reduce((t, r) => t + Number(r.cups_redeemed || 0), 0);
  const pct = bonusPct(v!.settings, s.tier);
  const bonus = Math.round(deposit * pct) / 100;
  const total = Math.round((deposit + bonus) * 100) / 100;
  await supabase.from("claims").update({
    payout_amount: total, cups_redeemed: cups, bonus_pct: pct || null, bonus_amount: bonus || null,
  }).eq("id", payout.id);

  const minted = await mint(payout.id, total);
  if ("error" in minted) {
    await supabase.from("system_events").insert({
      org_id: s.org_id, event_type: "tikkie_payout_link", status: "failure", count: 1,
      detail: { error: minted.error.slice(0, 300), amount: total, cups, auto_cashout: s.tier },
    });
    // Put the money back and try again in an hour.
    await supabase.from("claims").update({ payout_claim_id: null }).eq("payout_claim_id", payout.id);
    await supabase.from("claims").delete().eq("id", payout.id);
    await note({ next_at: new Date(now.getTime() + RETRY_MS).toISOString(), last_error: minted.error.slice(0, 300) });
    return { user_id: s.user_id, result: "mint_failed", amount: total, error: minted.error };
  }

  // 4. The email. The link is also in the app's activity, so a failed
  // send loses nothing; it is noted on the schedule.
  const emailed = await sendLinkEmail(user.email, v!, s.tier, { url: minted.url, deposit, bonus, pct, total });
  await note({ last_claim_id: payout.id, last_error: emailed ? null : "email_failed" });
  return { user_id: s.user_id, result: "paid", amount: total, bonus, emailed };
}

/* What a wallet would get right now — no writes, no Tikkie, no email. */
async function dryRun(userIds: string[] | null, tierOverride: string | null) {
  let rows: Schedule[] = [];
  if (userIds?.length) {
    const { data: users } = await supabase.from("users").select("id, org_id").in("id", userIds.slice(0, 50));
    const { data: sched } = await supabase.from("auto_cashouts").select("user_id, org_id, tier, next_at, verified_email").in("user_id", userIds.slice(0, 50));
    const byUser = new Map((sched || []).map((r) => [r.user_id, r as Schedule]));
    rows = (users || []).map((u) => byUser.get(u.id) || { user_id: u.id, org_id: u.org_id, tier: tierOverride || "week", next_at: new Date().toISOString() });
  } else {
    const { data } = await supabase.from("auto_cashouts").select("user_id, org_id, tier, next_at, verified_email")
      .lte("next_at", new Date().toISOString()).order("next_at").limit(BATCH);
    rows = (data || []) as Schedule[];
  }
  const out = [];
  for (const r of rows) {
    const tier = tierOverride || r.tier;
    const v = await venue(r.org_id);
    const { data: u } = await supabase.from("users").select("email, merged_into").eq("id", r.user_id).maybeSingle();
    const deposit = await walletBalance(r.user_id);
    const pct = v ? bonusPct(v.settings, tier) : 0;
    const bonus = Math.round(deposit * pct) / 100;
    out.push({
      user_id: r.user_id, tier, next_at: r.next_at, venue_on: venueOn(v),
      has_email: !!u?.email, merged: !!u?.merged_into,
      deposit, bonus_pct: pct, bonus, total: Math.round((deposit + bonus) * 100) / 100,
      verified: !!u?.email && !!r.verified_email && u.email.toLowerCase() === r.verified_email.toLowerCase(),
      would_pay: venueOn(v) && !!u?.email && !u?.merged_into && deposit > 0
        && !!r.verified_email && u.email.toLowerCase() === r.verified_email.toLowerCase(),
      next_after: addInterval(new Date(), tier).toISOString(),
    });
  }
  return out;
}

/* ── The wallet's own calls ─────────────────────────────────────────────
 * get — the schedule this device's wallet has, or null.
 * set — tier week | month | quarter, or off (the slider's zero). A tier
 *       needs the venue to have the feature on and the wallet to have a
 *       PROVEN email, because that is where the link goes; otherwise it
 *       emails a code and answers verify_required. The tier already set
 *       keeps its date; a different one starts its clock from now.
 * verify — the code; a right one saves the tier it was sent for.
 * Nothing here moves money; the run above does, from the published
 * settings. The schedule table has no client policies (migration 071), so
 * this is the only way a customer reaches it, and only for their wallet. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Per IP, in the shared rate_limits table like bin-tikkie's buckets. The
// slider is roomy (a campus shares one address); it fails open on errors.
const RL_WINDOW_MS = 60 * 60 * 1000;
const RL_MAX = 240;
// Sending a code emails someone, so it gets bin-tikkie's tightest bucket.
const RL_MAX_CODE = 10;
async function rateLimited(req: Request, bucket = "auto-cashout", max = RL_MAX): Promise<boolean> {
  try {
    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
    const key = `${bucket}:${ip}`;
    const now = Date.now();
    const { data } = await supabase.from("rate_limits").select("count, window_start").eq("key", key).maybeSingle();
    if (!data || now - new Date(data.window_start).getTime() > RL_WINDOW_MS) {
      await supabase.from("rate_limits").upsert({ key, count: 1, window_start: new Date().toISOString() });
      return false;
    }
    if ((data.count ?? 0) >= max) return true;
    await supabase.from("rate_limits").update({ count: (data.count ?? 0) + 1 }).eq("key", key);
    return false;
  } catch {
    return false;
  }
}

/* ── Proving the email ─────────────────────────────────────────────────
 * The link goes to the wallet's email, so a tier needs that address proven
 * (migration 072): a Google login with it, or a 6-digit code sent to it.
 * Codes: 10 minutes, 5 tries, one new code a minute, hashed at rest. */
const CODE_TTL_MS = 10 * 60 * 1000;
const CODE_MAX_ATTEMPTS = 5;
const CODE_RESEND_MS = 60 * 1000;

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function maskEmail(e: string): string {
  const [u, d] = e.split("@");
  return `${u.slice(0, 1)}${"•".repeat(Math.max(1, Math.min(4, u.length - 1)))}@${d}`;
}

/* A Google login proves the address Google confirmed. */
async function provenByGoogle(authUserId: string | null, email: string): Promise<boolean> {
  if (!authUserId) return false;
  try {
    const { data } = await supabase.auth.admin.getUserById(authUserId);
    const u = data?.user;
    return !!u?.email_confirmed_at && String(u.email || "").toLowerCase() === email.toLowerCase();
  } catch {
    return false;
  }
}

async function sendCode(req: Request, userId: string, email: string, tier: string, v: Venue): Promise<{ sent: boolean; error?: string }> {
  const { data: prev } = await supabase.from("auto_cashout_codes")
    .select("email, sent_at").eq("user_id", userId).maybeSingle();
  // A code that went to this address less than a minute ago still stands.
  if (prev && prev.email === email && Date.now() - new Date(prev.sent_at).getTime() < CODE_RESEND_MS) {
    await supabase.from("auto_cashout_codes").update({ tier }).eq("user_id", userId);
    return { sent: true };
  }
  if (await rateLimited(req, "auto-cashout-code", RL_MAX_CODE)) return { sent: false, error: "rate_limited" };
  if (!BREVO_API_KEY) return { sent: false, error: "code_send_failed" };

  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
  const now = new Date();
  const { error } = await supabase.from("auto_cashout_codes").upsert({
    user_id: userId, email, tier,
    code_hash: await sha256Hex(code), attempts: 0,
    sent_at: now.toISOString(), expires_at: new Date(now.getTime() + CODE_TTL_MS).toISOString(),
  }, { onConflict: "user_id" });
  if (error) return { sent: false, error: "db_error" };

  const t = TIERS[tier];
  const text = `${code} is your code to confirm this email for automatic cashout at ${v.name}.\n\n` +
    `Once it's confirmed we send your deposit to this address ${t.every} as a Tikkie link. The code works for 10 minutes.\n\n` +
    "Didn't ask for this? You can ignore this email.";
  const html = `<!doctype html><html><body style="margin:0;background:#F6F1E8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1F1B16">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F1E8;padding:28px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#ffffff;border-radius:18px;padding:28px 24px">
<tr><td style="font-size:12px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:#8A8175">${esc(v.name)} · Automatic cashout</td></tr>
<tr><td style="padding-top:10px;font-size:20px;font-weight:800">Confirm your email</td></tr>
<tr><td style="padding-top:16px;font-size:38px;font-weight:800;letter-spacing:.18em">${code}</td></tr>
<tr><td style="padding-top:14px;font-size:13px;line-height:1.55;color:#5C554B">Once it's confirmed we send your deposit to this address ${esc(t.every)} as a Tikkie link. The code works for 10 minutes.</td></tr>
<tr><td style="padding-top:20px;border-top:1px solid #F0EAE0;font-size:12px;color:#8A8175">Didn't ask for this? You can ignore this email.</td></tr>
</table></td></tr></table></body></html>`;
  try {
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": BREVO_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({
        sender: { email: BREVO_SENDER_EMAIL, name: BREVO_SENDER_NAME },
        to: [{ email }],
        subject: `${code} is your code for automatic cashout`,
        textContent: text,
        htmlContent: html,
      }),
    });
    if (!r.ok) return { sent: false, error: "code_send_failed" };
  } catch {
    return { sent: false, error: "code_send_failed" };
  }
  return { sent: true };
}

/* Save (or keep) the schedule for a proven address. */
async function saveSchedule(userId: string, orgId: string, tier: string, email: string) {
  const { data: existing } = await supabase.from("auto_cashouts")
    .select("tier, next_at, started_at").eq("user_id", userId).maybeSingle();
  const now = new Date();
  if (existing?.tier === tier) {
    await supabase.from("auto_cashouts").update({ verified_email: email, last_error: null, updated_at: now.toISOString() }).eq("user_id", userId);
    return { error: null, row: { ...existing, verified: true } };
  }
  const row = {
    user_id: userId, org_id: orgId, tier,
    started_at: now.toISOString(),
    next_at: addInterval(now, tier).toISOString(),
    verified_email: email,
    last_error: null,
    updated_at: now.toISOString(),
  };
  const { error } = await supabase.from("auto_cashouts").upsert(row, { onConflict: "user_id" });
  return { error, row: { tier, next_at: row.next_at, started_at: row.started_at, verified: true } };
}

async function walletCall(req: Request, body: Record<string, unknown>): Promise<Response> {
  const orgId = String(body.org_id || "").trim();
  const deviceId = String(body.device_id || "").trim().slice(0, 64);
  if (!UUID_RE.test(orgId)) return json({ error: "not_found" }, 404);
  if (!deviceId) return json({ error: "missing_device" }, 400);

  const v = await venue(orgId);
  if (!v || v.settings.mode !== "tikkie_only") return json({ error: "not_found" }, 404);

  const { data: profile } = await supabase
    .from("users").select("id, email, auth_user_id")
    .eq("org_id", orgId).eq("device_id", deviceId)
    .is("merged_into", null)
    .maybeSingle();
  const email = String(profile?.email || "").trim().toLowerCase();
  const current = async () => {
    if (!profile) return null;
    const { data } = await supabase.from("auto_cashouts")
      .select("tier, next_at, started_at, verified_email").eq("user_id", profile.id).maybeSingle();
    if (!data) return null;
    const { verified_email, ...rest } = data;
    return { ...rest, verified: !!email && String(verified_email || "").toLowerCase() === email };
  };

  if (body.action === "get") return json({ auto_cashout: await current() });

  if (!profile) return json({ error: body.action === "set" && body.tier === "off" ? "no_profile" : "email_required" }, 409);

  if (body.action === "verify") {
    const code = String(body.code || "").trim();
    if (!/^[0-9]{6}$/.test(code)) return json({ error: "invalid_code" }, 400);
    const { data: pending } = await supabase.from("auto_cashout_codes")
      .select("email, tier, code_hash, attempts, expires_at").eq("user_id", profile.id).maybeSingle();
    if (!pending || pending.email !== email) return json({ error: "invalid_code" }, 401);
    if (new Date(pending.expires_at).getTime() < Date.now()) return json({ error: "code_expired" }, 401);
    if ((pending.attempts ?? 0) >= CODE_MAX_ATTEMPTS) return json({ error: "too_many_attempts" }, 429);
    if (pending.code_hash !== await sha256Hex(code)) {
      await supabase.from("auto_cashout_codes").update({ attempts: (pending.attempts ?? 0) + 1 }).eq("user_id", profile.id);
      return json({ error: "invalid_code" }, 401);
    }
    await supabase.from("auto_cashout_codes").delete().eq("user_id", profile.id);
    if (v.settings.autoCashout !== true) return json({ error: "auto_cashout_off" }, 403);
    const { error, row } = await saveSchedule(profile.id, orgId, pending.tier, email);
    if (error) return json({ error: "db_error" }, 500);
    return json({ status: "on", auto_cashout: row });
  }

  // action: set
  const tier = String(body.tier || "off");
  if (tier !== "off" && !TIERS[tier]) return json({ error: "invalid_tier" }, 400);
  if (tier === "off") {
    await supabase.from("auto_cashouts").delete().eq("user_id", profile.id);
    await supabase.from("auto_cashout_codes").delete().eq("user_id", profile.id);
    return json({ status: "off", auto_cashout: null });
  }
  if (v.settings.autoCashout !== true) return json({ error: "auto_cashout_off" }, 403);
  if (!email) return json({ error: "email_required" }, 409);

  // Already proven: the schedule's own address, or a Google login with it.
  const { data: sched } = await supabase.from("auto_cashouts")
    .select("verified_email").eq("user_id", profile.id).maybeSingle();
  const proven = String(sched?.verified_email || "").toLowerCase() === email
    || await provenByGoogle(profile.auth_user_id, email);
  if (!proven) {
    const sent = await sendCode(req, profile.id, email, tier, v);
    if (!sent.sent) return json({ error: sent.error || "code_send_failed" }, sent.error === "rate_limited" ? 429 : 502);
    return json({ status: "verify_required", email: maskEmail(email) });
  }
  const { error, row } = await saveSchedule(profile.id, orgId, tier, email);
  if (error) {
    console.error(`[auto-cashout] save failed: ${error.message}`);
    return json({ error: "db_error" }, 500);
  }
  return json({ status: "on", auto_cashout: row });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // A warm worker keeps module state between calls: a venue that switched
  // the feature off since the last call must be read again.
  venues.clear();

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* scheduled calls carry a tiny body */ }

  // The wallet: its own schedule, nothing else.
  if (body.action === "get" || body.action === "set" || body.action === "verify") {
    if (await rateLimited(req)) return json({ error: "rate_limited" }, 429);
    return walletCall(req, body);
  }

  const secret = req.headers.get("x-cron-secret") || "";
  const { data: cfg } = await supabase.from("app_config").select("value").eq("key", "auto_cashout_cron").maybeSingle();
  const want = (cfg?.value as { secret?: string } | null)?.secret || "";
  if (!want || secret !== want) return json({ error: "forbidden" }, 403);

  if (body.dry_run === true) {
    const ids = Array.isArray(body.user_ids) ? body.user_ids.map(String) : null;
    const tier = typeof body.tier === "string" && TIERS[body.tier] ? body.tier : null;
    return json({ dry_run: true, wallets: await dryRun(ids, tier) });
  }

  const started = Date.now();
  const now = new Date();
  const { data: due, error } = await supabase.from("auto_cashouts")
    .select("user_id, org_id, tier, next_at, verified_email")
    .lte("next_at", now.toISOString())
    .order("next_at")
    .limit(BATCH);
  if (error) return json({ error: "db_error", detail: error.message }, 500);

  const results: Outcome[] = [];
  for (const s of (due || []) as Schedule[]) {
    if (Date.now() - started > MAX_MS) break;
    try {
      results.push(await runOne(s, now));
    } catch (e) {
      results.push({ user_id: s.user_id, result: "error", error: String(e) });
    }
  }
  const paid = results.filter((r) => r.result === "paid");
  if (paid.length || results.some((r) => r.result === "mint_failed" || r.result === "error")) {
    console.log(`[auto-cashout] due=${due?.length ?? 0} paid=${paid.length} ` +
      `total=${paid.reduce((t, r) => t + (r.amount || 0), 0).toFixed(2)} ` +
      `failed=${results.filter((r) => r.result === "mint_failed" || r.result === "error").length}`);
  }
  return json({ due: due?.length ?? 0, results });
});
