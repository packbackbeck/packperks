# Email for PackPulse — what PackPerks uses, and how to copy it

PackPerks sends everything through **Brevo** (formerly Sendinblue, EU/France
— which is why it was chosen: data stays in the EU). Full PackPerks detail is
in `EMAIL_SETUP.md`; this file is the port to PackPulse.

---

## What we use today

Two separate channels, and it matters that they are separate.

| | Channel | Who sends | Used for |
|---|---|---|---|
| **1** | Brevo **SMTP relay** (`smtp-relay.brevo.com`) | Supabase Auth, no app code | sign-in codes, magic links, password resets, admin invites |
| **2** | Brevo **transactional API** (`api.brevo.com/v3/smtp/email`) | our own edge functions | cashback ready, weekly digest, reports, support replies, claim confirmations |

**These use different keys.** Brevo issues an SMTP key and an API key
separately, and they are not interchangeable. Most setup confusion comes from
mixing them up.

Which one PackPulse needs depends on what you want to send:

- Only product emails (digests, alerts, reports) → **channel 2 only**.
- Login by email / magic link / password reset → you also need **channel 1**,
  and only if PackPulse uses Supabase Auth. If it has its own login, its
  framework sends those itself and just needs SMTP credentials.

Start with channel 2. It is the useful half and doesn't touch authentication.

---

## Before anything: one decision

**Where does PackPulse run server-side code?**

This is the only real blocker, and I could not check it myself — PackPulse is
behind its password gate. What I do know is that `/api/*` answered **401**
rather than 404, which suggests routes exist behind auth (a Next.js app would
behave that way). Confirm it before following the steps.

It matters because **the Brevo API key must never reach the browser.** Anyone
with it can send mail as your domain. So:

- **Has a server** (Next.js route handler, Vercel function, Express, Supabase
  edge function) → follow this document as written.
- **Purely static front-end** → you cannot send mail directly. Add one small
  serverless function (a single file on Vercel) and call it from the page. If
  PackPulse already talks to Supabase, an edge function there is the shortest
  path, because that is exactly the pattern PackPerks uses.

A Vercel env var marked `NEXT_PUBLIC_*` is **public**. Never put the key in one.

---

## Inputs you need

Gather these first; the rest is 20 minutes of wiring.

### From Brevo

| Value | Where to get it | Notes |
|---|---|---|
| **API key** | Brevo → *SMTP & API* → *API Keys* → Generate | **Not** the SMTP key. Make a **new one named `packpulse`** rather than reusing the PackPerks key, so it can be revoked without taking PackPerks down. |
| **Sender address** | Brevo → *Senders, Domains & Dedicated IPs* | Must be an authenticated sender or domain, or mail goes to spam. |
| **SMTP key + host/port** | Brevo → *SMTP & API* → *SMTP* | Only if you need channel 1 (auth email). |

### Decide yourselves

| Value | PackPerks uses | Suggestion for PackPulse |
|---|---|---|
| From address | `info@packback.network` | `no-reply@packback.network` or `pulse@packback.network` |
| From name | `PackPerks` | `PackPulse` |
| Reply-to | not set | a monitored inbox — replies to `no-reply` vanish silently |

### Environment variables to set

Server-side only, in Vercel → Project → Settings → Environment Variables (or
Supabase → Edge Functions → Secrets if you go that route):

```
BREVO_API_KEY=xkeysib-...
BREVO_SENDER_EMAIL=no-reply@packback.network
BREVO_SENDER_NAME=PackPulse
```

Set them for **all three** Vercel environments (Production, Preview,
Development) or preview deploys silently stop sending.

---

## Domain authentication — do this first

If you skip this, everything "works" and lands in spam.

Since `packback.network` is already authenticated in Brevo for PackPerks, a
sender on the same domain inherits it and there is nothing to do. **If
PackPulse sends from a different domain**, add it in Brevo → *Domains* and
publish the DNS records it gives you:

- **SPF** — TXT record authorising Brevo to send for the domain
- **DKIM** — TXT record with the signing key
- **DMARC** — optional but wanted by Gmail and Outlook for bulk senders

DNS takes up to 24h. Brevo shows a green tick per record when it sees them.
Do not schedule the first real send until all three are ticked.

---

## The send helper

This is PackPerks' own helper (`supabase/functions/send-digest/index.ts`),
generalised. It is plain `fetch`, so it runs unchanged in a Next.js route
handler, a Vercel function, an Express route or a Deno edge function.

```js
const BREVO_API_KEY      = process.env.BREVO_API_KEY ?? '';
const BREVO_SENDER_NAME  = process.env.BREVO_SENDER_NAME ?? 'PackPulse';
const BREVO_SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL ?? 'no-reply@packback.network';

/**
 * Send one transactional email. Never throws — email is best-effort and must
 * not break the action that triggered it.
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function sendEmail({ to, subject, html, text, tag }) {
  if (!BREVO_API_KEY) return { ok: false, error: 'brevo_not_configured' };

  const recipients = (Array.isArray(to) ? to : [to])
    .filter(Boolean)
    .map((email) => ({ email }));
  if (!recipients.length) return { ok: false, error: 'no_recipient' };

  try {
    const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': BREVO_API_KEY,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { name: BREVO_SENDER_NAME, email: BREVO_SENDER_EMAIL },
        to: recipients,
        subject,
        htmlContent: html,
        // Always send a text part. HTML-only mail scores as spam.
        textContent: text || html.replace(/<[^>]+>/g, ' '),
        tags: tag ? [tag] : undefined,
      }),
    });
    return resp.ok ? { ok: true } : { ok: false, error: `brevo_${resp.status}` };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}
```

Three deliberate choices, each learned the hard way in PackPerks:

- **Missing key is not a crash.** No `BREVO_API_KEY` returns
  `brevo_not_configured` and everything else carries on. Local development and
  preview deploys work without secrets.
- **It never throws.** In PackPerks the cashback email is best-effort because
  the payout link is also shown in the app — a Brevo outage must never block a
  payout. Apply the same rule: send after the real work has succeeded, and
  report the failure rather than surfacing it to the user.
- **`tags`** give you per-feature filtering in Brevo's logs. Worth it the first
  time someone asks whether a digest actually went out.

### Calling it

```js
const result = await sendEmail({
  to: ['ops@packback.network'],
  subject: 'PackPulse weekly digest',
  html: renderDigest(data),
  tag: 'weekly-digest',
});
if (!result.ok) console.error('digest email failed:', result.error);
```

---

## Writing the HTML

Email clients are not browsers. Gmail and Outlook strip `<style>` blocks, flex
and grid. PackPerks' rules, visible in `supabase/functions/send-digest`:

- **Tables for layout, inline styles for everything.** No stylesheet.
- **Max width ~600–680px**, centred.
- **No web fonts.** Name one, then fall back to system sans.
- **Buttons** = a padded `<a>` inside a rounded table cell, so it still reads as
  a button where `border-radius` is dropped.
- **Escape every interpolated value.** A venue name with an `&` breaks the
  markup otherwise.
- **Always include the text part** (the helper above does it for you).

`supabase/functions/send-digest/index.ts` has a working `renderEmail()` that
already obeys all of this — the fastest start is to copy it and change the
content.

---

## Prove it works

Build a test endpoint before building any feature. PackPerks has
`send-test-email`, and its safety rule is worth copying exactly:

> **The recipient must be an existing admin of the workspace.**

Without that check, an authenticated endpoint that mails arbitrary HTML to an
arbitrary address is an open spam relay wearing your domain's reputation.

The PackPerks version validates: template key present, subject non-empty, HTML
non-empty, recipient matches an email regex, and recipient is a known admin.

---

## If you also want a digest config screen

PackPerks lets admins configure this in the dashboard rather than in code
(Reports & alerts → Scheduled digests). If PackPulse wants the same, these are
the fields, and the reasons they exist:

| Field | Type | Why |
|---|---|---|
| **Enabled** | toggle | Turn it off without losing the configuration. |
| **Email title** | text | Becomes the subject. |
| **Intro line** | text | One sentence under the heading. |
| **Frequency** | select — weekly / monthly | |
| **Send on** | select — day of week | Only shown when weekly. |
| **Scope** | select — this org / whole group | Which data the numbers cover. |
| **Recipients** | email list, add/remove | Several people, not one field. Include an "add me" shortcut — it is the common case. |
| **Metrics** | searchable multi-select | Pick from a catalogue. PackPerks defaults to 4. |
| **Send test** | button | Mails the current config to the signed-in admin only. |

Two things PackPerks got wrong first and fixed:

- **Show a live preview of the email** beside the form. Choosing eleven metrics
  should visibly become a wall of numbers *before* anyone receives it.
- **Store the config as data** (PackPerks uses an `app_config` row), not as
  code, so changing a recipient is not a deploy.

### Scheduling

PackPerks runs it from Postgres with `pg_cron`, calling the edge function over
HTTP:

```sql
select cron.schedule(
  'weekly-digest-send',
  '0 8 * * *',                     -- daily; the function decides who is due today
  $$ select net.http_post(
       url     := 'https://<project>.supabase.co/functions/v1/send-digest',
       headers := '{"Authorization": "Bearer <service-role-key>"}'::jsonb
     ); $$
);
```

The cron fires **daily** and the function works out whose schedule matches
today. That is deliberate: one job handles weekly and monthly and any future
cadence, instead of a cron entry per configuration.

If PackPulse has no Postgres, **Vercel Cron** does the same job — a
`vercel.json` entry pointing at an API route, with the route checking a shared
secret so it cannot be triggered by anyone who finds the URL.

---

## Watch out for

- **Free tier is 300 emails/day.** A digest to a handful of people is fine; a
  customer-facing send is not. Check the plan before launch.
- **Supabase Auth custom SMTP defaults to 30 emails/hour.** Only relevant for
  channel 1, and it will bite during a demo. Raise it in
  Authentication → Rate Limits.
- **Two keys, two purposes.** An SMTP key in `BREVO_API_KEY` fails with a 401
  that reads like a permissions problem.
- **Unauthenticated sender domain = spam**, with no error anywhere. If test
  mail vanishes, check the domain ticks first.
- **Don't reuse the PackPerks API key.** A separate key per product means you
  can rotate or revoke one without an outage in the other, and Brevo's logs
  tell you which product sent what.
