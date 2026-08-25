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
//   4. payout = cups × the org's per-cup rate (server config, never client)
//   5. one claims row per batch (unique index on batch_id = idempotency)
//   6. mint the Tikkie cashback (same lock + API contract as tikkie-cashback)
//   7. return the Tikkie URL — re-scans return the SAME link forever
//
// Anonymous endpoint that spends real money, so the guards matter:
//   • batch UUIDs are unguessable and single-use
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

interface ClaimRow {
  id: string;
  cups_redeemed: number | null;
  payout_amount: number | null;
  tikkie_url: string | null;
  tikkie_cashback_id: string | null;
  tikkie_status: string | null;
}

const CLAIM_COLS = "id, cups_redeemed, payout_amount, tikkie_url, tikkie_cashback_id, tikkie_status";

function claimReply(claim: ClaimRow, status: string) {
  return json({
    status,
    url: claim.tikkie_url,
    cups: claim.cups_redeemed,
    amount: claim.payout_amount,
    tikkie_status: claim.tikkie_status,
  });
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: { batch_id?: string } = {};
  try { body = await req.json(); } catch { /* fall through to validation */ }
  const batchId = String(body.batch_id || "").trim().toLowerCase();
  if (!UUID_RE.test(batchId)) return json({ error: "invalid_batch" }, 400);

  // Fast path: the batch was already converted — hand back the same link.
  const existing = await claimForBatch(batchId);
  if (existing) {
    if (existing.tikkie_url) return claimReply(existing, "exists");
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

  const amount = Math.min(MAX_TOTAL_EUR, Math.round(count * rate * 100) / 100);

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
