# PackPerks Cookie & Local-Storage Policy

**Privacy owner:** [FILL: privacy owner name] · **Contact:** support@packback.network · **Last updated:** 2026-07-03

**Last updated:** (to be dated on adoption)
**Owner:** PackPerks Privacy Owner

---

## 1. Scope and purpose

This policy explains how the PackPerks web app stores and reads information on
your device. PackPerks is a reusable-cup loyalty and cashback service. The app
is a React single-page application served over the web; you use it in a normal
browser, so almost all of the storage described here lives **inside your
browser on your own device**, not in classic HTTP cookies set by a server.

We are transparent about this because EU rules (the ePrivacy Directive as
implemented in the Netherlands, alongside the GDPR) treat reading from or
writing to your device as something you must be told about, and, where the
storage is not strictly necessary, something you must consent to. The same
transparency is offered to users in the United Arab Emirates.

PackPerks is the **controller** for the data described here. Our venue partners
never receive any of this device-level data; they see only aggregate statistics
through the admin dashboard.

### A note on terminology

For legibility we use "cookie" loosely to mean any of the storage mechanisms a
browser exposes. In practice PackPerks relies almost entirely on the browser's
**`localStorage`**, not on traditional cookies, because the app has no
conventional backend that sets cookies. The classification below (Essential vs
Non-essential) is what actually matters legally, regardless of the exact
storage mechanism.

---

## 2. The short version

- We use a small number of **essential** storage keys so the app can work at
  all — chiefly to remember which anonymous balance is yours and to remember
  your cookie choice.
- We use **one non-essential** analytics store (`client_events`) only if you
  choose **"Accept all"**.
- We do **not** use any third-party advertising or cross-site tracking
  cookies. There is **no Google Analytics, no Meta/Facebook Pixel, and no ad
  network** anywhere in the app.

---

## 3. What we store, and why

### 3.1 Essential — always present

These are strictly necessary to deliver the service you asked for. You cannot
use PackPerks without them, and under EU rules they do **not** require consent.
They are never used for analytics or behavioural profiling.

| Key | Type / lifetime | What it does | Why it is essential |
| --- | --- | --- | --- |
| `packperks_device_id` | `localStorage`, persistent random ID | A random identifier generated on first visit. It links this browser to your cup balances, activity history and reward claims **when you are anonymous** (no login). Without it we could not show you the cups you have already collected. | It is the only thing that makes anonymous, no-login cup collection possible. It is not shared, not linked to advertising, and not used to measure behaviour. |
| `packperks_cookie_consent` | `localStorage`, persistent | Records your banner choice (Reject / Essential only / Accept all) so we do not ask you again on every visit, and so we know whether analytics is permitted. | Storing your consent choice is itself an essential function — it is what lets us honour "Essential only" and stop setting analytics. |

### 3.2 Essential — UX state (present after you use certain features)

These remember where you are in the app so it behaves sensibly. They hold no
identity or contact data — just small flags and, in one case, a reference to
your most recent claim so the confirmation screen can be shown. All are written
through the app's persisted-state helper, which automatically prefixes keys
with `packperks_`.

| Key | Type / lifetime | What it does |
| --- | --- | --- |
| `packperks_hiw_seen` | `localStorage`, boolean flag | Remembers that you have already seen the "how it works" / onboarding explainer, so it is not shown on every visit. |
| `packperks_claimed` | `localStorage`, boolean flag | A transient UI flag that tracks whether you have just made a reward claim, so the interface shows the correct state. |
| `packperks_last_claim_id` | `localStorage`, short reference | Remembers the reference of your most recent claim so the app can display the right confirmation / status screen. |
| `packperks_user_profile` | `localStorage`, small JSON | Holds a local copy of your display name and, where you have entered it, the value used to prefill the payout (IBAN) field on this device, so you do not re-enter it each time. The authoritative, protected copy lives server-side; this is a device convenience copy. |

We treat these as **essential UX**: they carry no behavioural analytics and
exist only to make the core loyalty features usable, so they are set regardless
of your analytics choice. You can remove them at any time via **Data control**
(see section 6).

### 3.3 Essential — only when you are signed in

Signing in is optional. If you choose email sign-in (a magic link / one-time
code) so your account follows you across devices and you can manage your IBAN
and email, the authentication library stores a session so you stay signed in.

| Key | Type / lifetime | What it does | Why it is essential |
| --- | --- | --- | --- |
| Supabase auth / session token (stored under an `sb-…-auth-token` key in `localStorage`) | Persists for the session, refreshed automatically, cleared on sign-out | Keeps you signed in after email verification so you can view and edit your saved account (email, IBAN) without re-authenticating on every action. | It is strictly necessary to provide the signed-in account you explicitly requested. It is only present once you sign in. |

These session tokens are set by our authentication and data platform
(Supabase), which we use as a processor in the EU region. They are not
advertising cookies and are not shared with partners.

### 3.4 Non-essential — analytics (consent required)

| Store | Type / lifetime | What it does | Legal basis |
| --- | --- | --- | --- |
| `client_events` behavioural analytics | Events written from the app and stored server-side; **only** created if you choose "Accept all". Retained for 14 months, then deleted or anonymised. | Records product-usage events — screen/page views, button taps, changes to reward progress, shares, and funnel steps — so we can understand how the app is used and improve it. | **Consent** (GDPR Art. 6(1)(a)). Collected only after you select "Accept all". |

We do not use this data to build advertising profiles, and we never sell it or
expose it to venue partners. Partners only ever see aggregate figures.

---

## 4. What we do **not** use

- **No third-party advertising cookies.**
- **No cross-site trackers, no Meta/Facebook Pixel, no Google Analytics, no
  Google Ads or DoubleClick tags.**
- **No fingerprinting for advertising.** The only device identifier is
  `packperks_device_id`, which exists solely to attach an anonymous cup balance
  to your browser — an essential function, not an analytics one.
- **No sale of any of the above to anyone.**

---

## 5. The consent banner: your three options

On your first visit you will see a banner with three clear choices. Your choice
is saved in `packperks_cookie_consent` so you are not asked again on every
visit.

### 5.1 "Accept all"

- **Essential** storage (sections 3.1–3.3) is set.
- **`client_events` behavioural analytics** (section 3.4) is enabled.
- This is the only option under which we record product-usage analytics.

### 5.2 "Essential only"

- **Essential** storage (sections 3.1–3.3) is set.
- **No behavioural analytics.** `client_events` is not collected.
- The app works fully — you can collect cups, submit receipts, request BYO
  (bring-your-own) cups, and claim cashback exactly as normal.

### 5.3 "Reject"

- **Reject blocks use of the app.** Because the essential keys in section 3.1
  are what make anonymous cup collection and consent-recording possible, the
  app cannot function without them; choosing Reject means you decline the
  storage the app needs to run, so the app will not proceed.
- **Reject never deletes cups or claims you have already earned.** Any balances,
  activity history and reward claims already attached to your account or device
  remain intact and are waiting for you if you later choose "Essential only" or
  "Accept all". Rejecting is not the same as deleting your account or your
  progress.

> If you want to stop using PackPerks **and** remove your data, use the
> in-app **Data control** section to delete specific data or your whole
> account (section 6) — Reject alone does not do this.

---

## 6. Changing your mind later

Your consent is not a one-time, irreversible decision.

- **Change your analytics choice at any time** in the app's **Data control**
  section. You can move from "Essential only" to "Accept all" (turning
  behavioural analytics on) or from "Accept all" back to "Essential only"
  (turning it off). Turning analytics off stops any further `client_events`
  collection; previously collected analytics ages out under our 14-month
  retention period.
- **Reset your device / clear local storage.** From **Data control** you can
  reset the device, which clears the `packperks_*` keys held in this browser
  (including `packperks_device_id`). Doing so detaches this browser from its
  anonymous balance, so only do this if you understand you may need to sign in
  to recover a saved account.
- **Clear via your browser.** You can also delete this site's storage through
  your browser's own settings ("clear site data" / "cookies and site data").
  This removes the essential keys too, so the app will treat you as a first-time
  visitor and show the banner again.
- **Delete specific data or your account.** **Data control** also lets you edit
  or delete specific data and delete your account outright. For anything not
  self-serviceable, you may send a data-subject request by email (see the
  Privacy Notice for the current address).

---

## 7. Where this storage lives and who can read it

- **On your device.** Everything in section 3.1–3.3 (the `packperks_*` keys and
  the Supabase session token) is stored in your browser's `localStorage`. It is
  readable only by the PackPerks web app on the same site and by you.
- **Server-side (analytics).** `client_events` (section 3.4) is stored in our
  EU-region data platform (Supabase, `eu-west-1`) and is accessible only to
  PackPerks. Venue partners never see it; they receive aggregate statistics
  only.

Nothing described in this policy sends your browsing to an advertising network,
and none of it is used to track you across other websites.

---

## 8. Related documents

This Cookie & Local-Storage Policy should be read together with the PackPerks
**Privacy Notice**, which describes the full personal-data inventory, lawful
bases, retention periods, international transfers (including receipt-image AI
verification processed via the Anthropic API in the United States under
zero-retention terms), and your rights in more detail.

---

*Questions about this policy, or a request to change or delete what we store on
your device, can be raised through the in-app Data control section or by
contacting the PackPerks Privacy Owner.*
