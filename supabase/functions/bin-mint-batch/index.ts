// ──────────────────────────────────────────────────────────────────────
// bin-mint-batch — the smart bin's only call into PackPerks.
//
// PRINT-FIRST flow. The bin runs a session per customer, counts the cups,
// and does two things in parallel at session end:
//
//   1. Prints the QR immediately, built from its OWN session UUID:
//        https://perks.packback.network/<orgSlug>/?batch=<session-uuid>
//   2. Calls this endpoint with { cups, session_id, cup_uuids } to
//      VALIDATE that session.
//
// The batch id in our database IS the session id — that is what makes the
// pre-printed QR resolvable. The bin never needs our response to print;
// scanning stays "pending" until this call lands. When it lands late (the
// bin was offline), any customer who scanned in the meantime is resolved
// here: their link is emailed and their account attached. cup_uuids are
// still stored verbatim as the cups' primary keys.
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

// For the "your refund link is ready" email when a session arrives AFTER
// the customer already scanned the receipt (print-first flow, bin offline).
const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY") ?? "";
const BREVO_SENDER_EMAIL = Deno.env.get("BREVO_SENDER_EMAIL") || "no-reply@packback.network";
const BREVO_SENDER_NAME = Deno.env.get("BREVO_SENDER_NAME") || "PackPerks";
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

/* The org's published settings — the mode (which decides whether cup ids
 * are required) and the payout rate come from the same row, so read it once. */
async function orgSettings(orgId: string): Promise<Record<string, unknown>> {
  try {
    const { data } = await admin.from("app_config")
      .select("value").eq("key", `published:${orgId}`).maybeSingle();
    return (data?.value as { settings?: Record<string, unknown> } | null)?.settings || {};
  } catch {
    return {};
  }
}

/* What this many cups is worth at the org's live published rate, clamped by
 * the same caps bin-tikkie enforces when it actually mints the Tikkie link.
 * Returned so the bin can print the amount on the receipt. */
function previewAmount(s: Record<string, unknown>, cups: number): number {
  const raw = Number(s.refundRatePerCup ?? s.cashbackRatePerCup);
  const rate = Math.min(MAX_RATE_EUR, Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RATE_EUR);
  const cfgMax = Number(s.tikkieMaxPerReceipt);
  const maxTotal = Math.min(MAX_TOTAL_EUR, Number.isFinite(cfgMax) && cfgMax > 0 ? cfgMax : MAX_TOTAL_EUR);
  return Math.min(maxTotal, Math.round(cups * rate * 100) / 100);
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

  // Body: { cups, session_id, cup_uuids }. (`count` is still tolerated as an
  // alias for `cups` so a half-updated bin isn't bricked mid-rollout.)
  let cups = NaN;
  let sessionId = "";
  let cupUuids: string[] | null = null;
  try {
    const b = await req.json();
    const raw = b?.cups ?? b?.count;
    if (raw != null && String(raw).trim() !== "") cups = parseInt(String(raw), 10);
    if (b?.session_id != null) sessionId = String(b.session_id).trim();
    if (b?.cup_uuids != null) {
      if (!Array.isArray(b.cup_uuids)) return json({ error: "invalid_cup_uuids", detail: "cup_uuids must be an array of UUID v4 strings" }, 400);
      cupUuids = b.cup_uuids.map((u: unknown) => String(u).trim().toLowerCase());
    }
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

  const settings = await orgSettings(keyRow.org_id);
  const isTikkieOnly = settings.mode === "tikkie_only";

  /* Cup ids.
   *
   * A Redirect Refund bin mints a UUID v4 per physical cup and we store it
   * verbatim as the cup's primary key, so the bin and PackPerks name the
   * same cup the same way — which is what makes a bin-side record
   * reconcilable against ours. Other bins have no such id and we generate
   * our own, as before. */
  if (isTikkieOnly && !cupUuids) {
    return json({ error: "missing_cup_uuids", detail: "cup_uuids (one UUID v4 per cup) is required for this bin" }, 400);
  }
  if (cupUuids) {
    if (cupUuids.length !== cups) {
      return json({ error: "cup_uuids_mismatch", detail: `cup_uuids has ${cupUuids.length} entries but cups is ${cups}` }, 400);
    }
    const bad = cupUuids.find((u) => !UUID_V4_RE.test(u));
    if (bad) return json({ error: "invalid_cup_uuids", detail: `not a UUID v4: ${bad}` }, 400);
    if (new Set(cupUuids).size !== cupUuids.length) {
      return json({ error: "duplicate_cup_uuids", detail: "cup_uuids contains the same id more than once" }, 400);
    }
  }

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

  /* Bin-supplied ids are a SECOND idempotency key. If the bin retried with
   * a fresh session_id but the same cup ids (a plausible firmware bug), a
   * blind insert would either violate the primary key or, worse, mint a
   * parallel batch for cups that already exist. Look first: if these exact
   * ids are already one batch of ours, hand that batch back instead. */
  if (cupUuids) {
    const { data: existing } = await admin
      .from("cups").select("id, batch_id").in("id", cupUuids);
    if (existing && existing.length > 0) {
      const batches = [...new Set(existing.map((r) => r.batch_id))];
      if (batches.length === 1 && existing.length === cupUuids.length) {
        const priorBatch = batches[0] as string;
        const { data: ps } = await admin
          .from("bin_sessions").select("cups, amount_eur").eq("batch_id", priorBatch).maybeSingle();
        return json({
          batch_id: priorBatch,
          url: buildUrl(priorBatch),
          cups: ps?.cups ?? existing.length,
          count: ps?.cups ?? existing.length,
          amount_eur: ps?.amount_eur ?? previewAmount(settings, existing.length),
          currency: "EUR",
          slug,
          reused: true,
        });
      }
      return json({
        error: "cup_uuids_conflict",
        detail: `${existing.length} of the supplied cup ids already exist under a different batch`,
      }, 409);
    }
  }

  // ── Mint the batch — the batch id IS the session id (print-first) ──
  const batchId = sessionId;
  const rows = Array.from({ length: cups }, (_v, i) => ({
    id: cupUuids ? cupUuids[i] : crypto.randomUUID(),
    batch_id: batchId,
    source: "admin_batch",   // same shape claim-cups / bin-tikkie already accept
    status: "available",
    org_id: keyRow.org_id,
  }));
  const { data: inserted, error: insErr } = await admin.from("cups").insert(rows).select("id");
  if (insErr) return json({ error: "mint_failed", detail: insErr.message }, 500);

  const minted = inserted?.length ?? cups;
  const amount = previewAmount(settings, minted);

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

  /* Print-first resolution: did a customer scan this receipt BEFORE this
   * call arrived? If so their scan sat "pending". The batch now exists, so
   * their next open pays out — and if they left an email, tell them. */
  try {
    const { data: pending } = await admin
      .from("pending_batches")
      .select("batch_id, email, user_id, resolved_at")
      .eq("batch_id", batchId)
      .maybeSingle();
    if (pending && !pending.resolved_at) {
      await admin.from("pending_batches").update({
        resolved_at: new Date().toISOString(),
        org_id: keyRow.org_id,
      }).eq("batch_id", batchId);

      if (pending.email && BREVO_API_KEY) {
        const link = buildUrl(batchId);
        await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: { "api-key": BREVO_API_KEY, "content-type": "application/json" },
          body: JSON.stringify({
            sender: { email: BREVO_SENDER_EMAIL, name: BREVO_SENDER_NAME },
            to: [{ email: pending.email }],
            subject: "Your refund is ready to collect",
            textContent:
              `Good news — your cup return has been confirmed.\n\n` +
              `Open your receipt link to collect your refund via Tikkie:\n${link}\n\n` +
              `${amount != null ? `Amount: €${amount.toFixed(2)}\n\n` : ""}` +
              `PackPerks`,
            htmlContent:
              `<div style="font:15px/1.6 -apple-system,sans-serif;color:#1F1B16">` +
              `<p>Good news — your cup return has been confirmed.</p>` +
              `<p><a href="${link}" style="display:inline-block;padding:12px 22px;background:#1A8737;color:#fff;border-radius:999px;text-decoration:none;font-weight:700">Collect your refund</a></p>` +
              `${amount != null ? `<p>Amount: <strong>€${amount.toFixed(2)}</strong></p>` : ""}` +
              `<p style="color:#6C6259">PackPerks</p></div>`,
          }),
        }).catch((e) => console.error(`[bin-mint-batch] ready email failed: ${String(e)}`));
        await admin.from("pending_batches").update({
          notified_at: new Date().toISOString(),
        }).eq("batch_id", batchId);
      }
    }
  } catch (e) {
    console.error(`[bin-mint-batch] pending resolution failed: ${String(e)}`);
  }

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
