# PackPerks email — Brevo setup

Two kinds of email leave PackPerks. Both go out through **Brevo** (EU/France).

## 1. Auth emails — Supabase Auth → Brevo **SMTP**

Sign-in code / magic link, signup confirm, admin invite, password reset. These
are sent by Supabase Auth using the custom SMTP you configured
(`smtp-relay.brevo.com`). No app code sends these — Supabase does.

**Verification is mandatory.** Every customer email — the first time it's added
and any time it changes — must be confirmed with the 6-digit code we email
(`src/components/SignInSheet.jsx` → `verifyOtp`). There is no unverified
direct-save path (enforced in `src/App.jsx`, always-on; the admin toggle is
locked on).

**Beautiful templates** (paste the `<!doctype html>` body into Supabase →
Authentication → Emails → each template's "Message body (HTML)"):

| Supabase template | File | Shows |
|---|---|---|
| Magic Link | `supabase/email-templates/magic-link.html` | **6-digit `{{ .Token }}` code** + sign-in link |
| Confirm signup | `supabase/email-templates/confirm-signup.html` | `{{ .Token }}` code + link |
| Reset Password | `supabase/email-templates/reset-password.html` | reset link |
| Invite user | `supabase/email-templates/invite.html` | accept-invite link |

**Also required in the dashboard:**
- **Redirect URLs** (Authentication → URL Configuration): add every app origin
  (`http://localhost:5173`, the production customer domain, and the `/admin`
  origin) or the magic/invite links error.
- **Rate limit** (Authentication → Rate Limits): custom-SMTP default is only
  **30/hour** — raise it before launch. Brevo free tier = 300 emails/day.
- **Sender authentication in Brevo**: authenticate the sending domain (SPF +
  DKIM) and verify the From address, or mail lands in spam.

## 2. Transactional email — Brevo **API** (in code)

The **"your cashback is ready"** email is a custom message, not an auth email,
so Supabase's SMTP doesn't send it. It's wired in the `tikkie-cashback` edge
function: on admin approve, after the real Tikkie link is minted, if the
customer opted into email (`notify_email`) we send a PackPerks-branded message
via the Brevo **transactional API** (`https://api.brevo.com/v3/smtp/email`).
Sending is best-effort — the link is also on the in-app "Collect via Tikkie"
card, so a Brevo hiccup never blocks the payout. The response includes
`emailSent` / `emailError`.

**Secrets to add** (Supabase → Edge Functions → Secrets):
- `BREVO_API_KEY` — a Brevo **API key** (Brevo → *SMTP & API → API Keys*). This
  is **different** from the SMTP key used for auth email.
- `BREVO_SENDER_EMAIL` — the From address (default `no-reply@packback.network`;
  must be an authenticated Brevo sender/domain).
- `BREVO_SENDER_NAME` — optional (default `PackPerks`).

Without `BREVO_API_KEY` the send is skipped gracefully (`emailError:
"brevo_not_configured"`) — everything else still works.

## Still deferred
Web-push (VAPID + `push_subscriptions`) for `notify_push` — not built yet.
