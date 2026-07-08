// ----------------------------------------------------------------------
// PackPerks - tikkie-webhook Edge Function (Phase 2)
//
// Public endpoint that Tikkie POSTs to when a cashback is redeemed. The
// notification body only says "something happened" ({ cashbackId, campaignId,
// subscriptionId, notificationType }); it carries no trusted status. So we
// RE-FETCH the authoritative status from the Tikkie API and write that onto
// the matching claim. A spoofed call therefore can only set a claim to
// whatever Tikkie itself reports (which is real), and only for cashbackIds we
// actually issued.
//
// Register the webhook URL once via tikkie-cashback { action: "subscribe" }.
//
// verify_jwt MUST be false - Tikkie does not send a Supabase JWT.
//
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   TIKKIE_API_KEY, TIKKIE_APP_TOKEN, TIKKIE_API_BASE_URL.
// ----------------------------------------------------------------------
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

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });

function tikkieHeaders() {
  return {
    "API-Key": API_KEY,
    "X-App-Token": APP_TOKEN,
    "Accept": "application/json",
  };
}

interface Notification {
  subscriptionId?: string;
  notificationType?: string;
  campaignId?: string;
  cashbackId?: string;
}
interface TikkieCashback {
  status?: "CREATED" | "REDEEMED" | "EXPIRED";
  redeemedDateTime?: string;
  expiryDateTime?: string;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let n: Notification;
  try { n = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  // Always ACK Tikkie (200) so it does not retry indefinitely, even when we
  // have nothing to do.
  if (!n?.cashbackId || !n?.campaignId) return json({ status: "ignored" });

  // Only act on cashbacks we actually issued.
  const { data: claim } = await supabase
    .from("claims")
    .select("id, tikkie_cashback_id")
    .eq("tikkie_cashback_id", n.cashbackId)
    .maybeSingle();
  if (!claim) return json({ status: "unknown_cashback" });

  // Re-fetch the authoritative status from Tikkie (the webhook body is not trusted).
  if (!API_KEY || !APP_TOKEN) return json({ status: "not_configured" });
  let resp: Response;
  try {
    resp = await fetch(
      `${BASE}/cashback-campaigns/${n.campaignId}/cashbacks/${n.cashbackId}`,
      { headers: tikkieHeaders() },
    );
  } catch (e) {
    console.error("tikkie status re-fetch failed:", e);
    return json({ status: "refetch_failed" });
  }
  if (!resp.ok) {
    console.error("tikkie status re-fetch non-2xx:", resp.status, await resp.text());
    return json({ status: "refetch_non_2xx" });
  }
  const cb = await resp.json() as TikkieCashback;
  const tikkie_status = String(cb.status || "").toLowerCase();
  if (!tikkie_status) return json({ status: "no_status" });

  const { error } = await supabase.from("claims").update({
    tikkie_status,
    tikkie_redeemed_at: cb.redeemedDateTime ?? null,
    tikkie_expires_at: cb.expiryDateTime ?? null,
  }).eq("tikkie_cashback_id", n.cashbackId);
  if (error) {
    console.error("claim update failed:", error.message);
    return json({ status: "update_failed" });
  }

  return json({ status: "ok", tikkie_status });
});
