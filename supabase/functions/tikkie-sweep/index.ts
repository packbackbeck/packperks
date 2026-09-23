// ----------------------------------------------------------------------
// tikkie-sweep — ask Tikkie what happened to the links we think are open.
//
// A link's real state lives at ABN AMRO: CREATED, REDEEMED (with the moment
// it was collected) or EXPIRED. tikkie-webhook hears about a redemption
// within seconds once the subscription is registered; this function is the
// safety net and the backfill for everything minted before that.
//
// Two callers (migration 060):
//   scheduled — pg_cron every 15 minutes, header x-sweep-secret matching
//               app_config 'tikkie_sweep_cron'.secret.
//   admin     — the dashboard's "Check open links" button, with the
//               dashboard account's JWT. Optional org_id narrows it to one
//               venue; claim_ids checks exactly those.
//
// It only ever writes what Tikkie itself reports, onto claims we issued.
// verify_jwt is false: the cron caller has no JWT, and the admin path
// checks the JWT itself.
// ----------------------------------------------------------------------
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const supabase = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

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

function campaignBase(): string {
  if (/^https?:\/\//i.test(CAMPAIGN_RAW)) {
    return CAMPAIGN_RAW.replace(/\/+$/, "").replace(/\/cashbacks$/i, "");
  }
  return CAMPAIGN_RAW ? `${BASE}/cashback-campaigns/${CAMPAIGN_RAW}` : BASE;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sweep-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "content-type": "application/json" } });

// One run stays well inside the function's own time budget; the next cron
// tick (or another button press) picks up where it left off.
const MAX_MS = 25_000;
const LOOKUP_TIMEOUT_MS = 8_000;
const DEFAULT_LIMIT = 60;
const MAX_LIMIT = 200;
const OPEN_STATES = ["created", "minting"];

type Row = { id: string; org_id: string | null; tikkie_cashback_id: string };

function tikkieHeaders() {
  return { "API-Key": API_KEY, "X-App-Token": APP_TOKEN, "Accept": "application/json" };
}

/* The caller. Either the cron secret, or a dashboard account's own JWT. */
async function authorize(req: Request, body: Record<string, unknown>): Promise<{ ok: true; actor: string } | { ok: false; resp: Response }> {
  const secret = req.headers.get("x-sweep-secret");
  if (secret) {
    const { data } = await supabase.from("app_config").select("value").eq("key", "tikkie_sweep_cron").maybeSingle();
    const want = (data?.value as { secret?: string } | null)?.secret || "";
    if (!want || secret !== want) return { ok: false, resp: json({ error: "forbidden" }, 403) };
    return { ok: true, actor: "cron" };
  }
  const auth = req.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return { ok: false, resp: json({ error: "unauthorized" }, 401) };
  const { data: user } = await supabase.auth.getUser(token);
  const uid = user?.user?.id;
  if (!uid) return { ok: false, resp: json({ error: "unauthorized" }, 401) };
  const { data: profile } = await supabase.from("admin_profiles")
    .select("email, status").eq("id", uid).maybeSingle();
  if (!profile || profile.status !== "active") return { ok: false, resp: json({ error: "forbidden" }, 403) };
  void body;
  return { ok: true, actor: profile.email || uid };
}

async function lookup(cashbackId: string) {
  const resp = await fetch(`${campaignBase()}/cashbacks/${cashbackId}`, {
    headers: tikkieHeaders(),
    signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
  });
  if (!resp.ok) {
    const raw = await resp.text().catch(() => "");
    return { error: `HTTP ${resp.status} ${raw.slice(0, 160)}`.trim() };
  }
  const cb = await resp.json() as { status?: string; redeemedDateTime?: string; expiryDateTime?: string };
  const status = String(cb.status || "").toLowerCase();
  if (!status) return { error: "no_status" };
  return { status, redeemedAt: cb.redeemedDateTime ?? null, expiresAt: cb.expiryDateTime ?? null };
}

/* TEMPORARY probe (cron-secret only): does the Cashback API accept a
 * DELETE on a cashback? Asked with a random id that cannot exist, so it
 * can never cancel anyone's real link. Removed once answered. */
async function cancelProbe() {
  const fake = crypto.randomUUID();
  const urls = [`${campaignBase()}/cashbacks/${fake}`, `${BASE}/cashbacks/${fake}`];
  const out: Record<string, unknown>[] = [];
  for (const url of urls) {
    for (const method of ["DELETE", "GET"]) {
      try {
        const r = await fetch(url, { method, headers: tikkieHeaders(), signal: AbortSignal.timeout(8000) });
        out.push({ url: url.replace(fake, "<fake>"), method, status: r.status, body: (await r.text()).slice(0, 200) });
      } catch (e) {
        out.push({ url: url.replace(fake, "<fake>"), method, error: String(e).slice(0, 120) });
      }
    }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* an empty body is a plain sweep */ }

  const who = await authorize(req, body);
  if (!who.ok) return who.resp;
  if (!API_KEY || !APP_TOKEN) return json({ error: "tikkie_not_configured" }, 503);

  if (body.action === "cancel_probe" && who.actor === "cron") {
    return json({ probe: await cancelProbe() });
  }

  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(body.limit) || DEFAULT_LIMIT));
  const orgId = typeof body.org_id === "string" ? body.org_id : null;
  const claimIds = Array.isArray(body.claim_ids) ? body.claim_ids.map(String).slice(0, MAX_LIMIT) : null;

  let q = supabase.from("claims")
    .select("id, org_id, tikkie_cashback_id")
    .not("tikkie_cashback_id", "is", null);
  if (claimIds && claimIds.length) {
    q = q.in("id", claimIds);
  } else {
    // Still open as far as we know. A finished link never changes again.
    q = q.or(`tikkie_status.is.null,tikkie_status.in.(${OPEN_STATES.join(",")})`)
      .order("tikkie_checked_at", { ascending: true, nullsFirst: true })
      .limit(limit);
    if (orgId) q = q.eq("org_id", orgId);
  }
  const { data, error } = await q;
  if (error) return json({ error: "db_error", detail: error.message }, 500);
  const rows = (data || []) as Row[];

  const started = Date.now();
  const out = { checked: 0, redeemed: 0, expired: 0, still_open: 0, failed: 0, remaining: 0 };

  for (const row of rows) {
    if (Date.now() - started > MAX_MS) { out.remaining = rows.length - out.checked - out.failed; break; }
    const now = new Date().toISOString();
    let res: Awaited<ReturnType<typeof lookup>>;
    try {
      res = await lookup(row.tikkie_cashback_id);
    } catch (e) {
      res = { error: String(e).slice(0, 160) };
    }
    if ("error" in res) {
      out.failed += 1;
      // Stamp it anyway so one unreachable link can't block the queue.
      await supabase.from("claims").update({ tikkie_checked_at: now }).eq("id", row.id);
      console.error(`[tikkie-sweep] ${row.tikkie_cashback_id}: ${res.error}`);
      continue;
    }
    await supabase.from("claims").update({
      tikkie_status: res.status,
      tikkie_redeemed_at: res.redeemedAt,
      tikkie_expires_at: res.expiresAt,
      tikkie_checked_at: now,
    }).eq("id", row.id);
    out.checked += 1;
    if (res.status === "redeemed") out.redeemed += 1;
    else if (res.status === "expired") out.expired += 1;
    else out.still_open += 1;
  }

  // What the dashboard shows as "last checked".
  await supabase.from("app_config").upsert({
    key: "tikkie_sweep_state",
    value: { at: new Date().toISOString(), by: who.actor, ...out },
    updated_at: new Date().toISOString(),
  }, { onConflict: "key" });

  return json({ status: "ok", ...out });
});
