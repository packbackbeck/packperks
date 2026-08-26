// ──────────────────────────────────────────────────────────────────────
// bin-mint-batch — the smart bin's only call into PackPerks.
//
// The bin runs a session per customer, counts the cups they deposit, then
// calls this endpoint ONCE at the end of the session with exactly two
// values: how many cups, and its own session id (UUID v4). We mint a batch
// of cup tokens and return a URL:
//
//     https://perks.packback.network/<orgSlug>/?batch=<uuid>
//
// The bin renders that URL as a QR code itself and prints it. We don't
// send back an image — just the string to encode.
//
// Scanning that QR is what redeems the batch. For a Redirect Refund
// (tikkie_only) org it goes straight to a Tikkie link via bin-tikkie; for
// a deposit org it lands in the app via claim-cups. The bin doesn't need
// to know which — the org's mode decides, server-side.
//
// Auth: the bin's device secret in the `X-Bin-Key` header, checked against
// smartbin_keys. That row is ALSO what maps a bin to an org, so pointing a
// bin at a different org is a one-row change and needs no bin update.
//
// Money-safety notes (this endpoint creates spendable value):
//   • session_id makes retries idempotent — a lost response can no longer
//     mint a second batch for the same physical cups (bin_sessions table).
//   • per-key rate limit caps how fast a leaked key could mint.
//   • the printed amount is computed with the SAME caps bin-tikkie applies
//     at payout, so a receipt can never promise more than it pays.
//   • every mint writes a system_events row for the audit trail.
// ──────────────────────────────────────────────────────────────────────
import { createClient } from "jsr:@supabase/supabase-js@2";

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

// Which domain the printed QR points a native phone camera at. All three
// PackPerks domains serve the same app, but new print runs should carry the
// canonical one. Override per environment with APP_BASE_URL.
const RAW_BASE = (Deno.env.get("APP_BASE_URL") || "https://perks.packback.network").trim();
const PROD_URL = RAW_BASE.endsWith("/") ? RAW_BASE : `${RAW_BASE}/`;

// Mirrors bin-tikkie's ceilings so the printed figure matches the payout.
const MAX_RATE_EUR = 5;
const MAX_TOTAL_EUR = 25;
const DEFAULT_RATE_EUR = 0.10;

const MAX_CUPS_PER_SESSION = 50;
// The bin's session id. Required, and required to be a UUID v4: a session
// id is the only thing standing between a retried request and a second
// payout for the same cups, so a blank or reused-looking value must fail
// loudly at integration time rather than quietly cost money later.
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RL_WINDOW_MS = 60 * 60 * 1000;
const RL_MAX = 120; // per bin key per hour — far above a busy real bin

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-bin-key, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

/* Per-key rate limit. Fails OPEN: a database hiccup must never stop a
 * customer standing at the bin from getting their receipt. */
async function rateLimited(machineId: string): Promise<boolean> {
  try {
    const key = `bin-mint:${machineId}`;
    const now = Date.now();
    const { data } = await admin.from("rate_limits")
      .select("count, window_start").eq("key", key).maybeSingle();
    if (!data || now - new Date(data.window_start).getTime() > RL_WINDOW_MS) {
      await admin.from("rate_limits")
        .upsert({ key, count: 1, window_start: new Date().toISOString() });
      return false;
    }
    if ((data.count ?? 0) >= RL_MAX) return true;
    await admin.from("rate_limits").update({ count: (data.count ?? 0) + 1 }).eq("key", key);
    return false;
  } catch {
    return false;
  }
}

/* What this many cups is worth at the org's live published rate, clamped by
 * the same caps bin-tikkie enforces when it actually mints the Tikkie link.
 * Returned so the bin can print the amount on the receipt. */
async function previewAmount(orgId: string, cups: number): Promise<number | null> {
  try {
    const { data } = await admin.from("app_config")
      .select("value").eq("key", `published:${orgId}`).maybeSingle();
    const s = (data?.value as { settings?: Record<string, unknown> } | null)?.settings || {};
    const raw = Number(s.refundRatePerCup ?? s.cashbackRatePerCup);
    const rate = Math.min(MAX_RATE_EUR, Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RATE_EUR);
    const cfgMax = Number(s.tikkieMaxPerReceipt);
    const maxTotal = Math.min(MAX_TOTAL_EUR, Number.isFinite(cfgMax) && cfgMax > 0 ? cfgMax : MAX_TOTAL_EUR);
    return Math.min(maxTotal, Math.round(cups * rate * 100) / 100);
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const binKey = req.headers.get("x-bin-key") ?? "";
  if (!binKey) return json({ error: "missing_bin_key" }, 401);

  const { data: keyRow, error: keyErr } = await admin
    .from("smartbin_keys")
    .select("org_id, active, machine_id, label")
    .eq("bin_key", binKey)
    .maybeSingle();
  if (keyErr) return json({ error: "db_error", detail: keyErr.message }, 500);
  if (!keyRow || keyRow.active === false) return json({ error: "invalid_bin_key" }, 401);

  const machineId = keyRow.machine_id || "unknown";
  if (await rateLimited(machineId)) return json({ error: "rate_limited" }, 429);

  // Body: exactly { cups, session_id }. (`count` is still tolerated as an
  // alias for `cups` so a half-updated bin isn't bricked mid-rollout.)
  let cups = NaN;
  let sessionId = "";
  try {
    const b = await req.json();
    const raw = b?.cups ?? b?.count;
    if (raw != null && String(raw).trim() !== "") cups = parseInt(String(raw), 10);
    if (b?.session_id != null) sessionId = String(b.session_id).trim();
  } catch { /* falls through to the validation below */ }

  if (!Number.isFinite(cups) || cups < 1 || cups > MAX_CUPS_PER_SESSION) {
    return json({ error: "invalid_cups", detail: `cups must be a whole number 1..${MAX_CUPS_PER_SESSION}` }, 400);
  }
  if (!sessionId) {
    return json({ error: "missing_session_id", detail: "session_id (UUID v4) is required" }, 400);
  }
  if (!UUID_V4_RE.test(sessionId)) {
    return json({ error: "invalid_session_id", detail: "session_id must be a UUID v4, e.g. e2a93d7c-7207-4d81-b0dc-d3c1da8c1c14" }, 400);
  }

  const { data: org } = await admin
    .from("organizations").select("slug, name").eq("id", keyRow.org_id).maybeSingle();
  const slug = org?.slug ?? "";
  const buildUrl = (batchId: string) => `${PROD_URL}${slug ? slug + "/" : ""}?batch=${batchId}`;

  // ── Idempotency: has this session already been minted? ──
  const { data: prior } = await admin
    .from("bin_sessions")
    .select("batch_id, cups, amount_eur")
    .eq("machine_id", machineId).eq("session_id", sessionId)
    .maybeSingle();
  if (prior) {
    return json({
      batch_id: prior.batch_id,
      url: buildUrl(prior.batch_id),
      cups: prior.cups,
      count: prior.cups,          // legacy alias
      amount_eur: prior.amount_eur,
      currency: "EUR",
      slug,
      reused: true,
    });
  }

  // ── Mint the batch ──
  const batchId = crypto.randomUUID();
  const rows = Array.from({ length: cups }, () => ({
    id: crypto.randomUUID(),
    batch_id: batchId,
    source: "admin_batch",   // same shape claim-cups / bin-tikkie already accept
    status: "available",
    org_id: keyRow.org_id,
  }));
  const { data: inserted, error: insErr } = await admin.from("cups").insert(rows).select("id");
  if (insErr) return json({ error: "mint_failed", detail: insErr.message }, 500);

  const minted = inserted?.length ?? cups;
  const amount = await previewAmount(keyRow.org_id, minted);

  // Record the session AFTER the mint. If this insert loses a race with a
  // concurrent retry, the batch still stands — we just return ours; the
  // unique constraint is what guarantees only one row per session.
  await admin.from("bin_sessions").insert({
    machine_id: machineId,
    session_id: sessionId,
    org_id: keyRow.org_id,
    batch_id: batchId,
    cups: minted,
    amount_eur: amount,
  }).select("id").maybeSingle();

  // Audit trail — this endpoint creates spendable value, so every call is
  // visible in System Health rather than only in the function logs.
  admin.from("system_events").insert({
    org_id: keyRow.org_id,
    event_type: "bin_mint",
    status: "ok",
    count: minted,
    detail: { machine_id: machineId, batch_id: batchId, amount_eur: amount, session_id: sessionId },
  }).then(() => {}, () => {}); // best-effort; never blocks the receipt

  console.log(`[bin-mint-batch] ${machineId} → org=${keyRow.org_id} cups=${minted} batch=${batchId}`);

  return json({
    batch_id: batchId,
    url: buildUrl(batchId),
    cups: minted,
    count: minted,               // legacy alias
    amount_eur: amount,
    currency: "EUR",
    slug,
    reused: false,
    cup_ids: (inserted ?? []).map((r) => r.id),
  });
});
