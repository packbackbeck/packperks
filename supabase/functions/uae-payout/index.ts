// ──────────────────────────────────────────────────────────────────────
// PackPerks — uae-payout Edge Function (multi-region, UAE / AED)
//
// The UAE counterpart to tikkie-cashback. It is deliberately PROVIDER-AGNOSTIC:
// the concrete UAE payout provider is selected at runtime by the
// UAE_PAYOUT_PROVIDER secret and slotted into the `PROVIDERS` map below, so we
// can pick one later without touching the app or the claims workflow.
//
// It supports the two payout shapes every candidate UAE provider offers, so any
// of them fits:
//   • "link"  — create a hosted collect link the customer opens to get paid
//               (like Tikkie). Stored on the claim as the generic payout link.
//   • "proxy" — push an instant payment to the customer's mobile / email / QR
//               identifier (an instant-payment rail). No link; status only.
//
// Actions (POST JSON { action, ... }) — mirrors tikkie-cashback so the admin
// claims workflow can call either behind the payments.js router:
//   • create  { claim_id }              — approved AE claim → create a payout.
//   • status  { claim_id | payout_id }  — sync a payout's status onto the claim.
//   • balance {}                        — remaining float, for the admin dash.
//
// Auth: admin (row in admin_profiles), owner/admin for create (spends money).
// Secrets (set per chosen provider): UAE_PAYOUT_PROVIDER, plus that provider's
// API key/secret/base URL. Until those exist the function returns
// "uae_provider_not_configured" and NOTHING is spent.
//
// Claim columns reused as GENERIC payout fields (no migration): tikkie_url =
// collect link, tikkie_cashback_id = provider payout id, tikkie_status =
// created|paid|redeemed|expired|failed, tikkie_expires_at, tikkie_redeemed_at,
// payout_status. (Renaming these to payout_* is a later cleanup.)
// ──────────────────────────────────────────────────────────────────────
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const PROVIDER_KEY = (Deno.env.get("UAE_PAYOUT_PROVIDER") ?? "").trim().toLowerCase();
const API_KEY = (Deno.env.get("UAE_PAYOUT_API_KEY") ?? "").trim();
const API_SECRET = (Deno.env.get("UAE_PAYOUT_API_SECRET") ?? "").trim();
let BASE = (Deno.env.get("UAE_PAYOUT_BASE_URL") ?? "").replace(/\/+$/, "");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "content-type": "application/json" } });

// ── Provider adapter contract ───────────────────────────────────────────
// Every UAE provider implements this. `createPayout` returns either a collect
// `url` (link model) or just a `payoutId` (proxy model). Add the real HTTP
// calls where marked when a provider + secrets are chosen.
interface PayoutResult { payoutId: string; url?: string; status: string; expiresAt?: string | null; }
interface PayoutProvider {
  configured: () => boolean;
  createPayout: (opts: { amountFils: number; reference: string; recipient?: Recipient }) => Promise<PayoutResult>;
  getStatus: (payoutId: string) => Promise<{ status: string; paidAt?: string | null; expiresAt?: string | null }>;
  getBalance: () => Promise<{ remainingFils: number | null; raw?: unknown }>;
}
interface Recipient { email?: string | null; phone?: string | null; }

const NOT_CONFIGURED = () => { throw new Error("uae_provider_not_configured"); };

// Three generic slots — the concrete UAE providers plug in here 1:1. Left as
// stubs on purpose: the architecture is complete, only the vendor calls +
// secrets are pending the provider decision. Do NOT name vendors in-app.
function makeStubProvider(model: "link" | "proxy"): PayoutProvider {
  return {
    configured: () => !!(API_KEY && BASE),
    // deno-lint-ignore no-unused-vars
    async createPayout({ amountFils, reference, recipient }) {
      if (!API_KEY || !BASE) NOT_CONFIGURED();
      // TODO(provider): POST to `${BASE}/...` with API_KEY/API_SECRET.
      //   link  → returns a hosted collect URL → { payoutId, url, status:'created' }
      //   proxy → pushes to recipient.email/phone → { payoutId, status:'pending' }
      throw new Error("uae_provider_not_implemented");
    },
    async getStatus(_payoutId) {
      if (!API_KEY || !BASE) NOT_CONFIGURED();
      throw new Error("uae_provider_not_implemented");
    },
    async getBalance() {
      if (!API_KEY || !BASE) return { remainingFils: null };
      throw new Error("uae_provider_not_implemented");
    },
    _model: model,
  } as PayoutProvider;
}

// Slot map. The three candidate UAE providers (link-based and instant-proxy)
// each map to one of these keys via UAE_PAYOUT_PROVIDER; the label/model differ,
// the contract is identical.
const PROVIDERS: Record<string, PayoutProvider> = {
  provider_link_a: makeStubProvider("link"),
  provider_link_b: makeStubProvider("link"),
  provider_proxy_a: makeStubProvider("proxy"),
};

function resolveProvider(): PayoutProvider | null {
  return PROVIDERS[PROVIDER_KEY] || null;
}

async function callerAuthId(req: Request): Promise<string | null> {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const { data: { user } } = await supabase.auth.getUser(auth.replace("Bearer ", ""));
  return user?.id ?? null;
}
async function adminRow(authId: string | null): Promise<{ role: string } | null> {
  if (!authId) return null;
  const { data } = await supabase.from("admin_profiles").select("role, status").eq("id", authId).maybeSingle();
  if (!data || (data.status && data.status !== "active")) return null;
  return { role: data.role || "member" };
}

// Confirm the claim's org is a UAE (AED) org, so we never pay AED to an EUR org.
async function orgIsUAE(orgId: string | null): Promise<boolean> {
  if (!orgId) return false;
  const { data } = await supabase.from("organizations").select("country").eq("id", orgId).maybeSingle();
  const c = String(data?.country ?? "").toUpperCase();
  return c === "AE" || c === "ARE";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: { action?: string; claim_id?: string; payout_id?: string };
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const admin = await adminRow(await callerAuthId(req));
  if (!admin) return json({ error: "forbidden" }, 403);

  const provider = resolveProvider();
  const providerReady = !!provider && provider.configured();

  // ── create ──────────────────────────────────────────────────────────
  if (body.action === "create") {
    if (admin.role !== "owner" && admin.role !== "admin") return json({ error: "insufficient_role" }, 403);
    if (!body.claim_id) return json({ error: "missing_claim_id" }, 400);

    const { data: claim } = await supabase.from("claims")
      .select("id, org_id, type, status, payout_amount, tikkie_cashback_id, tikkie_url, tikkie_status, notify_email, user_id")
      .eq("id", body.claim_id).maybeSingle();
    if (!claim) return json({ error: "claim_not_found" }, 404);
    if (claim.tikkie_cashback_id) return json({ status: "exists", payoutId: claim.tikkie_cashback_id, url: claim.tikkie_url, tikkie_status: claim.tikkie_status });
    if (claim.status !== "completed") return json({ error: "claim_not_approved", detail: `status=${claim.status}` }, 409);
    if (claim.type !== "cashback" && claim.type !== "direct_refund") return json({ error: "bad_claim_type" }, 400);
    if (!(await orgIsUAE(claim.org_id))) return json({ error: "not_a_uae_org" }, 400);

    const amountFils = Math.round(Number(claim.payout_amount) * 100); // AED subunit = fils (÷100)
    if (!Number.isFinite(amountFils) || amountFils <= 0) return json({ error: "bad_amount" }, 400);

    if (!providerReady) {
      // The seam is complete but no provider is credentialed yet. Surface it
      // honestly; the approval still stands and is retryable once configured.
      await supabase.from("claims").update({
        payout_status: "failed",
        tikkie_last_error: "uae_provider_not_configured",
        tikkie_last_error_at: new Date().toISOString(),
      }).eq("id", claim.id);
      return json({ error: "uae_provider_not_configured", detail: "Set UAE_PAYOUT_PROVIDER + provider secrets." }, 503);
    }

    // Recipient for the proxy model (instant push). Email is what we already
    // hold; a phone/QR identifier would be collected in a later, provider-
    // specific step (privacy-reviewed) — see the data-protection plan.
    let recipient: Recipient | undefined;
    if (claim.user_id) {
      const { data: u } = await supabase.from("users").select("email").eq("id", claim.user_id).maybeSingle();
      recipient = { email: u?.email ?? null };
    }

    try {
      const r = await provider!.createPayout({ amountFils, reference: claim.id, recipient });
      await supabase.from("claims").update({
        tikkie_url: r.url ?? null,
        tikkie_cashback_id: r.payoutId,
        tikkie_status: String(r.status || "created").toLowerCase(),
        tikkie_expires_at: r.expiresAt ?? null,
        tikkie_last_error: null, tikkie_last_error_at: null,
        payout_status: "sent",
        notified_at: new Date().toISOString(),
      }).eq("id", claim.id);
      return json({ status: "created", payoutId: r.payoutId, url: r.url ?? null, tikkie_status: r.status });
    } catch (e) {
      await supabase.from("claims").update({
        payout_status: "failed", tikkie_last_error: String(e).slice(0, 500), tikkie_last_error_at: new Date().toISOString(),
      }).eq("id", claim.id);
      return json({ error: "uae_payout_failed", detail: String(e) }, 502);
    }
  }

  // ── status ──────────────────────────────────────────────────────────
  if (body.action === "status") {
    if (!providerReady) return json({ error: "uae_provider_not_configured" }, 503);
    let payoutId = body.payout_id;
    if (!payoutId && body.claim_id) {
      const { data } = await supabase.from("claims").select("tikkie_cashback_id").eq("id", body.claim_id).maybeSingle();
      payoutId = data?.tikkie_cashback_id || undefined;
    }
    if (!payoutId) return json({ error: "no_payout_id" }, 400);
    try {
      const s = await provider!.getStatus(payoutId);
      await supabase.from("claims").update({
        tikkie_status: String(s.status || "").toLowerCase(),
        tikkie_redeemed_at: s.paidAt ?? null,
        tikkie_expires_at: s.expiresAt ?? null,
      }).eq("tikkie_cashback_id", payoutId);
      return json({ status: "synced", payoutId, tikkie_status: s.status });
    } catch (e) {
      return json({ error: "uae_status_failed", detail: String(e) }, 502);
    }
  }

  // ── balance ─────────────────────────────────────────────────────────
  if (body.action === "balance") {
    if (!providerReady) return json({ status: "not_configured", remainingFils: null });
    try { return json({ status: "ok", ...(await provider!.getBalance()) }); }
    catch (e) { return json({ error: "uae_balance_failed", detail: String(e) }, 502); }
  }

  return json({ error: "unknown_action" }, 400);
});
