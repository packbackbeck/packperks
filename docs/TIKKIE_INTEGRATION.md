# Tikkie Cashback integration (Phase 2)

PackPerks pays cashback via the **Tikkie Cashback API** (ABN AMRO). On admin
approval a cashback is minted; the customer opens the returned `tikkie.me` link
to collect. Redemption flows back via a webhook.

Project: `ozvcpbthnauitaphosfb` · Base API: `https://api.abnamro.com/v1/tikkie/cashback`

## Moving parts

| Piece | Where | Role |
|---|---|---|
| `tikkie-cashback` edge fn | `supabase/functions/tikkie-cashback` | Sole holder of Tikkie secrets. Actions: `create`, `status`, `campaign`, `subscribe`, `unsubscribe`. Admin-auth (owner-only for subscribe). |
| `tikkie-webhook` edge fn | `supabase/functions/tikkie-webhook` | Public. Tikkie POSTs redemption events here; we re-fetch authoritative status and sync the claim. |
| Admin approve | `src/admin/lib/adminApi.js` → `updateClaimStatus` | On approve of a cashback/direct_refund, invokes `tikkie-cashback { create }` → stores the **real** `tikkie_url` / `tikkie_cashback_id` / `tikkie_status` / `tikkie_expires_at`, sets `payout_status='sent'`. Idempotent. |
| Status refresh | `refreshTikkieStatus(claimId)` + Tikkie-status modal | Pulls live CREATED/REDEEMED/EXPIRED into the claim. |
| Retry mint | `mintTikkieLink(claimId)` | Re-mint if the first attempt failed (e.g. campaign out of funds). |

## Claims columns

`tikkie_url`, `tikkie_status` (created|redeemed|expired), `tikkie_cashback_id`,
`tikkie_expires_at`, `tikkie_redeemed_at`, `payout_status`.

## Secrets (set in Supabase → Edge Functions)

`TIKKIE_API_KEY`, `TIKKIE_APP_TOKEN`, `TIKKIE_API_BASE_URL`, `TIKKIE_API_CAMPAIGN_URL`
(a bare `campaignId` **or** a full campaign URL — the function handles both).

## One-time: register the redemption webhook

Owner-only, via the edge function (registers our webhook URL with Tikkie):

```bash
curl -s -X POST "https://ozvcpbthnauitaphosfb.supabase.co/functions/v1/tikkie-cashback" \
  -H "Authorization: Bearer $ADMIN_JWT" -H "Content-Type: application/json" \
  -d '{"action":"subscribe","url":"https://ozvcpbthnauitaphosfb.supabase.co/functions/v1/tikkie-webhook"}'
```

`$ADMIN_JWT` = the logged-in owner's Supabase access token.

## Testing the Tikkie request

### A. Directly against the Tikkie API (uses your real secret values)

Set your values first:

```bash
export TIKKIE_API_KEY=...        # API-Key header
export TIKKIE_APP_TOKEN=...      # X-App-Token header
export TIKKIE_BASE=https://api.abnamro.com/v1/tikkie/cashback
export CAMPAIGN_ID=...           # the campaignId (from TIKKIE_API_CAMPAIGN_URL)
```

**1) GET campaign — READ-ONLY, safe, spends nothing.** Best first check:

```bash
curl -s "$TIKKIE_BASE/cashback-campaigns/$CAMPAIGN_ID" \
  -H "API-Key: $TIKKIE_API_KEY" -H "X-App-Token: $TIKKIE_APP_TOKEN" \
  -H "Accept: application/json" | jq
# → { campaignName, status: ACTIVE, remainingAmountInCents, ... }
```

**2) POST create cashback — ⚠️ SPENDS REAL CAMPAIGN FUNDS.** Use a tiny amount:

```bash
curl -s -X POST "$TIKKIE_BASE/cashback-campaigns/$CAMPAIGN_ID/cashbacks" \
  -H "API-Key: $TIKKIE_API_KEY" -H "X-App-Token: $TIKKIE_APP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"amountInCents":50,"referenceId":"packperks-test-1"}' | jq
# → 201 { cashbackId, url: https://tikkie.me/..., status: CREATED, expiryDateTime }
```

**3) GET one cashback's status:**

```bash
curl -s "$TIKKIE_BASE/cashback-campaigns/$CAMPAIGN_ID/cashbacks/<cashbackId>" \
  -H "API-Key: $TIKKIE_API_KEY" -H "X-App-Token: $TIKKIE_APP_TOKEN" | jq
```

### B. End-to-end through our edge function (no secrets on your side)

The `campaign` action is read-only — a safe full-stack connectivity test:

```bash
curl -s -X POST "https://ozvcpbthnauitaphosfb.supabase.co/functions/v1/tikkie-cashback" \
  -H "Authorization: Bearer $ADMIN_JWT" -H "Content-Type: application/json" \
  -d '{"action":"campaign"}' | jq
```

Without a valid admin token this returns `{"error":"forbidden"}` (auth gate).

## Still pending (needs more secrets)

Customer **notification delivery** (email + web-push) is captured on each claim
(`notify_email` / `notify_push`) and the email template exists
(`src/emails/tikkieReadyEmail.js`), but nothing sends yet. Email delivery would
go through **Brevo** — either the same SMTP relay already wired to Supabase Auth
(`smtp-relay.brevo.com`, via a Deno SMTP client in a sender edge function) or a
Brevo **transactional API key**. Web-push additionally needs a VAPID keypair +
a `push_subscriptions` table.
