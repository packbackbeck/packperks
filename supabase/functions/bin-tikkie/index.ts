// ──────────────────────────────────────────────────────────────────────
// bin-tikkie — Tikkie-only mode (smart-bin cashback).
//
// The customer scans the QR the smart bin printed (/​<slug>/?batch=<uuid>).
// For an org whose published config has settings.mode === 'tikkie_only',
// the app renders a minimal redirect page that calls THIS function:
//
//   1. resolve the batch → its cups + org
//   2. server-side authority: the org must really be tikkie_only
//   3. atomically activate the batch's available cups (the replay guard —
//      row state, same model as claim-cups)
//   4. payout = cups × the org's per-cup refund rate (server config, never client)
//   5. one claims row per batch (unique index on batch_id = idempotency)
//   6. mint the Tikkie cashback (same lock + API contract as tikkie-cashback)
//   7. return the Tikkie URL — re-scans return the SAME link forever
//
// A second entry point handles the OFFLINE case: when the bin can't reach
// us it prints one of its reserved "backup" cup ids instead of a batch.
// Those are permanently valid and mint a NEW link every scan — see
// redeemBackupCups().
//
// Anonymous endpoint that spends real money, so the guards matter:
//   • batch UUIDs are unguessable and single-use
//   • per-IP rate limiting keeps UUID brute-force expensive
//   • amount derives from server data only, clamped by RATE/TOTAL caps
//   • the org-mode check stops this endpoint draining batches that belong
//     to normal deposit/BYO orgs
//   • double-mint impossible: unique(batch_id) + the 'minting' row lock
// ──────────────────────────────────────────────────────────────────────
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

// Same defensive secret handling as tikkie-cashback (trim; force /cashback).
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

// Hard money ceilings — an anon endpoint must not trust config blindly either.
const MAX_RATE_EUR = 5;     // per cup
const MAX_TOTAL_EUR = 25;   // per receipt/session
const DEFAULT_RATE_EUR = 0.10;

// Backup cups mint a fresh link on EVERY scan by design, which makes them
// the one QR in the system that keeps paying. These bound the damage if a
// printed backup receipt is rescanned, or circulated.
const BACKUP_COOLDOWN_S = 120;   // per cup, between mints
const BACKUP_DAILY_CAP  = 20;    // mints per org per rolling 24h

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

function resolveCampaign(): { campaignBase: string } {
  const raw = CAMPAIGN_RAW;
  if (/^https?:\/\//i.test(raw)) {
    return { campaignBase: raw.replace(/\/+$/, "").replace(/\/cashbacks$/i, "") };
  }
  if (raw) return { campaignBase: `${BASE}/cashback-campaigns/${raw}` };
  return { campaignBase: BASE };
}
function tikkieHeaders() {
  return {
    "API-Key": API_KEY,
    "X-App-Token": APP_TOKEN,
    "Content-Type": "application/json",
    "Accept": "application/json",
  };
}
function sanitizeRef(s: unknown): string | undefined {
  if (s == null) return undefined;
  const cleaned = String(s).replace(/[^a-zA-Z0-9!&'()+\-./:?_`, ]/g, "").slice(0, 255).trim();
  return cleaned.length ? cleaned : undefined;
}
async function readTikkieError(resp: Response): Promise<{ code?: string; message?: string; raw: string }> {
  const raw = await resp.text().catch(() => "");
  try {
    const j = JSON.parse(raw);
    const e = j?.errors?.[0] ?? j;
    return { code: e?.code, message: e?.message, raw };
  } catch {
    return { raw };
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Per-IP rate limit — this endpoint spends real money, so brute-forcing
// batch UUIDs must stay expensive. 30/hour is far above any legitimate use
// (one person scans a handful of receipts) while capping abuse. Uses the
// shared rate_limits table; fails OPEN on db errors so a hiccup never
// blocks a genuine payout.
const RL_WINDOW_MS = 60 * 60 * 1000;
const RL_MAX = 30;
async function rateLimited(req: Request): Promise<boolean> {
  try {
    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
    const key = `bin-tikkie:${ip}`;
    const now = Date.now();
    const { data } = await supabase.from("rate_limits")
      .select("count, window_start").eq("key", key).maybeSingle();
    if (!data || now - new Date(data.window_start).getTime() > RL_WINDOW_MS) {
      await supabase.from("rate_limits")
        .upsert({ key, count: 1, window_start: new Date().toISOString() });
      return false;
    }
    if ((data.count ?? 0) >= RL_MAX) return true;
    await supabase.from("rate_limits").update({ count: (data.count ?? 0) + 1 }).eq("key", key);
    return false;
  } catch {
    return false;
  }
}

interface ClaimRow {
  id: string;
  cups_redeemed: number | null;
  payout_amount: number | null;
  tikkie_url: string | null;
  tikkie_cashback_id: string | null;
  tikkie_status: string | null;
}

const CLAIM_COLS = "id, cups_redeemed, payout_amount, tikkie_url, tikkie_cashback_id, tikkie_status";

function claimReply(claim: ClaimRow, status: string, liveStatus?: string | null) {
  return json({
    status,
    url: claim.tikkie_url,
    cups: claim.cups_redeemed,
    amount: claim.payout_amount,
    tikkie_status: liveStatus ?? claim.tikkie_status,
  });
}

/* Ask Tikkie what actually happened to this cashback.
 *
 * Our stored tikkie_status only moves when the redemption webhook fires,
 * and that subscription has never been registered — so every link in the
 * database still reads "created" even after someone has collected it.
 * On a RE-SCAN (and only then, so we don't add a call to the happy path)
 * we ask Tikkie directly, which is the only way to honestly tell a
 * customer "this receipt has already been used". Best-effort: if the
 * lookup fails we fall back to the stored value. */
async function liveTikkieStatus(cashbackId: string | null): Promise<string | null> {
  if (!cashbackId) return null;
  try {
    const { campaignBase } = resolveCampaign();
    const resp = await fetch(`${campaignBase}/cashbacks/${cashbackId}`, { headers: tikkieHeaders() });
    if (!resp.ok) return null;
    const cb = await resp.json() as { status?: string; redeemedDateTime?: string; expiryDateTime?: string };
    const st = String(cb.status || "").toLowerCase() || null;
    if (st) {
      // Keep our copy in sync while we're here — free backfill for the
      // dashboard's payout log.
      await supabase.from("claims").update({
        tikkie_status: st,
        tikkie_redeemed_at: cb.redeemedDateTime ?? null,
        tikkie_expires_at: cb.expiryDateTime ?? null,
      }).eq("tikkie_cashback_id", cashbackId);
    }
    return st;
  } catch {
    return null;
  }
}

/* Every backup-cup scan means the bin could not reach us — that is an
 * incident, not a routine payout, so it always raises an alert. Subject
 * and body are admin-authored (Backup Cups page); {{...}} placeholders are
 * filled in here. Best-effort: a mail failure must never block the
 * customer's payout. */
async function alertBackupUsed(orgId: string, ctx: Record<string, string>) {
  try {
    const { data } = await supabase.from("app_config")
      .select("value").eq("key", `backup_alerts:${orgId}`).maybeSingle();
    const cfg = (data?.value ?? {}) as {
      enabled?: boolean; recipients?: string[]; subject?: string; body?: string;
    };
    if (cfg.enabled === false) return;
    const to = (cfg.recipients ?? []).filter((e) => typeof e === "string" && e.includes("@"));
    if (!to.length || !BREVO_API_KEY) return;

    const fill = (t: string) =>
      Object.entries(ctx).reduce((acc, [k, v]) => acc.replaceAll(`{{${k}}}`, v), t);
    const subject = fill(cfg.subject || "Backup cup used at {{org}}");
    const body = fill(cfg.body ||
      "A backup cup was scanned, which means the smart bin could not reach PackPerks.\n\n" +
      "Cup: {{cup_label}}\nCups in scan: {{cups}}\nPaid out: €{{amount}}\nWhen: {{when}}\n\n" +
      "Check the bin's connection.");

    await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": BREVO_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({
        sender: { email: BREVO_SENDER_EMAIL, name: BREVO_SENDER_NAME },
        to: to.map((email) => ({ email })),
        subject,
        textContent: body,
        htmlContent: `<pre style="font:14px/1.6 -apple-system,sans-serif;white-space:pre-wrap">${
          body.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c] as string))
        }</pre>`,
      }),
    });
  } catch (e) {
    console.error(`[bin-tikkie] backup alert failed: ${String(e)}`);
  }
}

async function claimForBatch(batchId: string): Promise<ClaimRow | null> {
  const { data } = await supabase.from("claims").select(CLAIM_COLS).eq("batch_id", batchId).maybeSingle();
  return (data as ClaimRow | null) ?? null;
}

// Mint the Tikkie cashback for a claim that doesn't have one yet. Shares the
// contract (and the 'minting' row lock) with tikkie-cashback's create action.
async function mintForClaim(claim: ClaimRow): Promise<Response> {
  const amountInCents = Math.round(Number(claim.payout_amount) * 100);
  if (!Number.isFinite(amountInCents) || amountInCents <= 0) {
    return json({ error: "bad_amount" }, 500);
  }
  const { campaignBase } = resolveCampaign();

  // Atomically grab the mint (loser sees 'minting' and polls back later).
  const { data: grabbed, error: grabErr } = await supabase.from("claims")
    .update({ tikkie_status: "minting" })
    .eq("id", claim.id)
    .is("tikkie_cashback_id", null)
    .or("tikkie_status.is.null,tikkie_status.neq.minting")
    .select("id").maybeSingle();
  if (grabErr) return json({ error: "db_error", detail: grabErr.message }, 500);
  if (!grabbed) {
    const { data: c } = await supabase.from("claims").select(CLAIM_COLS).eq("id", claim.id).maybeSingle();
    const row = (c as ClaimRow | null) ?? claim;
    if (row.tikkie_url) return claimReply(row, "exists");
    return json({ status: "in_progress" }, 202);
  }

  const recordError = async (msg: string) => {
    console.error(`[bin-tikkie] mint FAILED → claim=${claim.id}: ${msg}`);
    await supabase.from("claims").update({
      tikkie_status: null, // clear the lock so a re-scan can retry the mint
      tikkie_last_error: msg.slice(0, 500),
      tikkie_last_error_at: new Date().toISOString(),
    }).eq("id", claim.id);
  };

  console.log(`[bin-tikkie] create → claim=${claim.id} amount=${amountInCents}c`);
  let resp: Response;
  try {
    resp = await fetch(`${campaignBase}/cashbacks`, {
      method: "POST",
      headers: tikkieHeaders(),
      body: JSON.stringify({ amountInCents, referenceId: sanitizeRef(claim.id) }),
    });
  } catch (e) {
    await recordError(`tikkie_unreachable: ${String(e)}`);
    return json({ error: "tikkie_unreachable" }, 502);
  }
  if (!resp.ok) {
    const err = await readTikkieError(resp);
    await recordError(`HTTP ${resp.status} ${err.code || ""} ${err.message || err.raw || ""}`.trim());
    return json({ error: "tikkie_create_failed", httpStatus: resp.status, code: err.code }, 502);
  }
  const cb = await resp.json() as { cashbackId: string; url: string; status?: string; expiryDateTime?: string };
  console.log(`[bin-tikkie] create OK → claim=${claim.id} cashbackId=${cb.cashbackId}`);

  const { error: uErr } = await supabase.from("claims").update({
    tikkie_url: cb.url,
    tikkie_cashback_id: cb.cashbackId,
    tikkie_status: String(cb.status || "CREATED").toLowerCase(),
    tikkie_expires_at: cb.expiryDateTime ?? null,
    tikkie_last_error: null,
    tikkie_last_error_at: null,
    payout_status: "sent",
    notified_at: new Date().toISOString(),
  }).eq("id", claim.id);
  if (uErr) return json({ error: "claim_update_failed", detail: uErr.message }, 500);

  return json({
    status: "created",
    url: cb.url,
    cups: claim.cups_redeemed,
    amount: claim.payout_amount,
    tikkie_status: String(cb.status || "CREATED").toLowerCase(),
  });
}

/* ── Backup cups ───────────────────────────────────────────────────────
 * The offline path. When the bin can't reach us it still prints a
 * receipt, carrying one or more of its RESERVED cup ids instead of a
 * freshly-minted batch. Those ids are permanently valid and mint a NEW
 * cashback every time, because the same ten ids are handed to many
 * different customers over the life of the bin.
 *
 * The customer must never be able to tell — the response shape is
 * identical to a normal batch. What differs is entirely on our side:
 * a cooldown per cup, a daily ceiling per org, a row in the use log, and
 * an alert every single time, because a backup scan means the bin was
 * offline and somebody needs to know. */
async function redeemBackupCups(cupIds: string[]): Promise<Response> {
  const { data: cupsRows } = await supabase
    .from("backup_cups").select("id, org_id, label, active").in("id", cupIds);
  if (!cupsRows || cupsRows.length !== cupIds.length) return json({ error: "batch_not_found" }, 404);
  if (cupsRows.some((c) => c.active === false)) return json({ error: "batch_revoked" }, 409);

  const orgIds = [...new Set(cupsRows.map((c) => c.org_id))];
  if (orgIds.length !== 1) return json({ error: "batch_not_found" }, 404);
  const orgId = orgIds[0] as string;

  const { data: cfgRow } = await supabase.from("app_config")
    .select("value").eq("key", `published:${orgId}`).maybeSingle();
  const settings = (cfgRow?.value as { settings?: Record<string, unknown> } | null)?.settings || {};
  if (settings.mode !== "tikkie_only") return json({ error: "wrong_mode" }, 409);

  const nowMs = Date.now();

  // Cooldown: the same reserved cup paying out twice in quick succession
  // is a re-scan of one receipt, not two customers.
  const { data: recent } = await supabase
    .from("backup_cup_uses")
    .select("used_at")
    .in("backup_cup_id", cupIds)
    .order("used_at", { ascending: false })
    .limit(1);
  const lastUse = recent?.[0]?.used_at ? new Date(recent[0].used_at).getTime() : 0;
  if (lastUse && nowMs - lastUse < BACKUP_COOLDOWN_S * 1000) {
    return json({ error: "backup_cooldown" }, 429);
  }

  // Daily ceiling per org — the backstop if a backup receipt gets shared.
  const dayAgo = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();
  const { count: usesToday } = await supabase
    .from("backup_cup_uses")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId).gte("used_at", dayAgo);
  if ((usesToday ?? 0) >= BACKUP_DAILY_CAP) {
    return json({ error: "backup_daily_cap" }, 429);
  }

  const rawRate = Number(settings.refundRatePerCup ?? settings.cashbackRatePerCup);
  const rate = Math.min(MAX_RATE_EUR, Number.isFinite(rawRate) && rawRate > 0 ? rawRate : DEFAULT_RATE_EUR);
  const cfgMax = Number(settings.tikkieMaxPerReceipt);
  const maxTotal = Math.min(MAX_TOTAL_EUR, Number.isFinite(cfgMax) && cfgMax > 0 ? cfgMax : MAX_TOTAL_EUR);
  const count = cupIds.length;
  const amount = Math.min(maxTotal, Math.round(count * rate * 100) / 100);

  // A synthetic batch id per scan. Backup cups deliberately do NOT dedupe
  // on the cup ids — a fresh id here is what gives every scan its own
  // claim row, its own Tikkie link, and its own line in the payout log.
  const syntheticBatch = crypto.randomUUID();
  const { data: inserted, error: insErr } = await supabase.from("claims")
    .insert({
      user_id: null,
      org_id: orgId,
      type: "cashback",
      status: "completed",
      payout_status: "queued",
      cups_redeemed: count,
      payout_amount: amount,
      batch_id: syntheticBatch,
      notify_email: false,
      notify_push: false,
    })
    .select(CLAIM_COLS).maybeSingle();
  if (insErr || !inserted) return json({ error: "claim_insert_failed", detail: insErr?.message }, 500);

  const claim = inserted as ClaimRow;
  const minted = await mintForClaim(claim);

  // Log + alert regardless of how the mint went: the bin being offline is
  // the thing worth knowing, and a failed mint is even more worth knowing.
  const usedAt = new Date().toISOString();
  await supabase.from("backup_cup_uses").insert(
    cupsRows.map((c) => ({
      backup_cup_id: c.id,
      org_id: orgId,
      claim_id: claim.id,
      amount_eur: amount,
      cups_in_scan: count,
      used_at: usedAt,
    })),
  );
  supabase.from("system_events").insert({
    org_id: orgId,
    event_type: "backup_cup_used",
    status: "warn",
    count,
    detail: { cups: cupsRows.map((c) => c.label), amount_eur: amount, claim_id: claim.id },
  }).then(() => {}, () => {});

  const { data: orgRow } = await supabase
    .from("organizations").select("name").eq("id", orgId).maybeSingle();
  await alertBackupUsed(orgId, {
    org: orgRow?.name || "this venue",
    cup_label: cupsRows.map((c) => c.label).join(", "),
    cups: String(count),
    amount: amount.toFixed(2),
    when: new Date(usedAt).toUTCString(),
  });

  return minted;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: { batch_id?: string; cup_ids?: unknown } = {};
  try { body = await req.json(); } catch { /* fall through to validation */ }
  if (await rateLimited(req)) return json({ error: "rate_limited" }, 429);

  // The offline receipt carries cup ids rather than a batch.
  if (Array.isArray(body.cup_ids) && body.cup_ids.length) {
    const ids = [...new Set(body.cup_ids.map((u) => String(u).trim().toLowerCase()))];
    if (ids.length > 50 || ids.some((u) => !UUID_RE.test(u))) {
      return json({ error: "invalid_batch" }, 400);
    }
    return redeemBackupCups(ids);
  }

  const batchId = String(body.batch_id || "").trim().toLowerCase();
  if (!UUID_RE.test(batchId)) return json({ error: "invalid_batch" }, 400);

  // Fast path: the batch was already converted — hand back the same link.
  const existing = await claimForBatch(batchId);
  if (existing) {
    if (existing.tikkie_url) {
      const live = await liveTikkieStatus(existing.tikkie_cashback_id);
      return claimReply(existing, "exists", live);
    }
    if (existing.tikkie_status === "minting") return json({ status: "in_progress" }, 202);
    return mintForClaim(existing); // earlier mint failed — resume it
  }

  // Resolve the batch → cups + owning org.
  const { data: cups, error: cupsErr } = await supabase.from("cups")
    .select("id, org_id, status, revoked_at, expires_at")
    .eq("batch_id", batchId);
  if (cupsErr) return json({ error: "db_error", detail: cupsErr.message }, 500);
  if (!cups || cups.length === 0) return json({ error: "batch_not_found" }, 404);
  const orgId = cups[0].org_id as string | null;
  if (!orgId) return json({ error: "batch_not_found" }, 404);

  // Server-side authority: only tikkie_only orgs pay out through this
  // endpoint. Batches of normal orgs keep flowing through claim-cups.
  const { data: cfgRow } = await supabase.from("app_config")
    .select("value").eq("key", `published:${orgId}`).maybeSingle();
  const settings = (cfgRow?.value as { settings?: Record<string, unknown> } | null)?.settings || {};
  if (settings.mode !== "tikkie_only") return json({ error: "wrong_mode" }, 409);

  // Tikkie-only orgs settle on a SINGLE rate: the refund rate. (There is no
  // reward to redeem, so a separate cashback rate would be a second number
  // nobody sets. cashbackRatePerCup is read only as a fallback for orgs
  // created before the rates were merged.)
  const rawRate = Number(settings.refundRatePerCup ?? settings.cashbackRatePerCup);
  const rate = Math.min(
    MAX_RATE_EUR,
    Number.isFinite(rawRate) && rawRate > 0 ? rawRate : DEFAULT_RATE_EUR,
  );

  // The replay guard: atomically flip this batch's available cups to
  // activated. A second scan matches zero rows and lands in the claim
  // lookup above (or the not-claimable error below).
  const nowIso = new Date().toISOString();
  const { data: activated, error: actErr } = await supabase.from("cups")
    .update({ status: "activated", activated_at: nowIso })
    .eq("batch_id", batchId)
    .eq("status", "available")
    .is("revoked_at", null)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .select("id");
  if (actErr) return json({ error: "db_error", detail: actErr.message }, 500);

  const count = activated?.length ?? 0;
  if (count === 0) {
    // Nothing to activate and no claim row → revoked, expired, or consumed
    // through another flow. Distinguish the common cases for the UI.
    const race = await claimForBatch(batchId);
    if (race) {
      if (race.tikkie_url) return claimReply(race, "exists");
      return json({ status: "in_progress" }, 202);
    }
    if (cups.some((c) => c.revoked_at)) return json({ error: "batch_revoked" }, 409);
    if (cups.some((c) => c.expires_at && c.expires_at <= nowIso)) return json({ error: "batch_expired" }, 409);
    return json({ error: "already_claimed" }, 409);
  }

  // Per-receipt ceiling: the admin's settings.tikkieMaxPerReceipt if set,
  // never above the hard server cap.
  const cfgMax = Number(settings.tikkieMaxPerReceipt);
  const maxTotal = Math.min(MAX_TOTAL_EUR, Number.isFinite(cfgMax) && cfgMax > 0 ? cfgMax : MAX_TOTAL_EUR);
  const amount = Math.min(maxTotal, Math.round(count * rate * 100) / 100);

  // One claim per batch — the unique index arbitrates concurrent scans.
  const { data: inserted, error: insErr } = await supabase.from("claims")
    .insert({
      user_id: null,          // anonymous: no account in tikkie-only mode
      org_id: orgId,
      type: "cashback",
      status: "completed",    // the bin already verified the deposit
      payout_status: "queued",
      cups_redeemed: count,
      payout_amount: amount,
      batch_id: batchId,
      notify_email: false,
      notify_push: false,
    })
    .select(CLAIM_COLS).maybeSingle();
  if (insErr) {
    // Unique-violation race: the concurrent scan inserted first — reuse it.
    const race = await claimForBatch(batchId);
    if (race) {
      if (race.tikkie_url) return claimReply(race, "exists");
      if (race.tikkie_status === "minting") return json({ status: "in_progress" }, 202);
      return mintForClaim(race);
    }
    return json({ error: "claim_insert_failed", detail: insErr.message }, 500);
  }

  return mintForClaim(inserted as ClaimRow);
});
