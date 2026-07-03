# PackPerks Privacy Policy

**Privacy owner:** [FILL: privacy owner name] · **Contact:** support@packback.network · **Last updated:** 2026-07-03

**Last updated: (to be dated on adoption)**
**Owner: PackPerks Privacy Owner**

This policy explains, in plain language, what personal data PackPerks collects when you use our reusable-cup loyalty and cashback service, why we collect it, who we share it with, and the choices and rights you have. We have tried to be specific about how *our* app actually works rather than filling this with generic legal boilerplate.

If anything here is unclear, please contact us at **support@packback.network** and we will help.

---

## Who we are and who is responsible for your data

PackPerks provides a reusable-cup loyalty scheme. When you return or reuse a cup at a participating store, you build up a balance that can be paid out to you as cashback.

For the purposes of the EU General Data Protection Regulation (GDPR), **PackPerks is the sole data controller** for the personal data described in this policy. That means we decide what data is collected and how it is used.

Our partner stores are **not** given access to your personal data. Partners only ever see **aggregate statistics** through an admin-only dashboard (for example, how many cups were returned this month). Partners never see individual user histories, email addresses, IBANs, receipt images, or behavioural profiles.

- **Controller:** PackPerks
- **Privacy contact / DSAR:** support@packback.network
- **Owner:** PackPerks Privacy Owner

---

## What data we collect and why

You can use PackPerks **anonymously** — you don't need to create an account or log in just to collect cups. Some features (like saving your account across devices or receiving a cashback payout) need a little more information.

Here is what we collect and why.

### Identity and contact details
- **Email address** — *optional*. You only give us an email if you choose to sign in, which lets us save your account and balance across devices and lets you manage your details. We send you a magic link or one-time code (OTP) to that address.
- **Display name** — a randomly generated name so you have an identity in the app without using your real name.
- **IBAN** — *optional*, and only needed if you want to receive a cashback payout. See [How cashback and payout work](#how-cashback-and-payout-work) for exactly how we protect and delete it.

### Device and technical data
- **device_id** — a random identifier stored in your browser's local storage. This is what links an anonymous user to their cup balance so your progress isn't lost between visits. It is **essential** to running the app and is **not** used for analytics.
- **Coarse device label** — a rough label such as "iPhone / iOS 17", used to help you recognise your own sessions and for basic support. This is **essential** and is **not** used for statistics or behavioural profiling.

### Loyalty and transaction data
- Per-store cup balances and activity history
- Cup scans and "bring your own cup" (BYO) requests
- Reward claims — the amount, date and status of each claim
- The AI verdict on your receipt plus the fields our AI extracted from it (for example: receipt date/time, receipt ID, total, and the reason for the decision)

### Images
- **Receipt photos** and **cup-scan photos**, stored in **private** Supabase Storage and only accessible through short-lived signed URLs.

### Behavioural analytics (only if you agree)
- A `client_events` record of how the app is used — screen views, button taps, reward changes, shares and funnel events. This is **non-essential** and is only collected if you choose **"Accept all"** in our cookie banner.
- We do **not** use Google Analytics, the Meta Pixel, or any advertising trackers.

### Admin and security data
- Audit logs (a before/after record of admin actions, including the admin's IP address and user agent) and admin login history. These exist to keep the system secure and accountable and are never used to profile customers.
- **Platform-level infrastructure logs.** Separately from the analytics above, our hosting processor's infrastructure (the database and API-gateway logs run by Supabase) may record **IP addresses** and basic request metadata at the platform level. These logs are held by our processor under its data-processing agreement, are used only to operate and secure the platform, and are not part of the `client_events` analytics (which store no IPs).

---

## AI receipt verification and the transfer to Anthropic (US)

When you submit a receipt, we use AI to check it automatically (for example, to confirm the purchase and guard against fraud).

To do this, your **receipt photo is sent to the Anthropic API (Claude), which is operated in the United States.** We use the **standard Anthropic API**, which means:

- Your receipt inputs are **not used to train** any AI model.
- Your inputs are **not retained beyond the request** (zero-retention by default) — Anthropic processes the image to return a verdict and does not keep it.

Because this involves a transfer of personal data to the US, we rely on appropriate safeguards: a **Data Processing Agreement** with Anthropic together with the **EU-US Data Privacy Framework (DPF) and/or Standard Contractual Clauses (SCCs)**. *(Putting these safeguards fully in place is a tracked action item for PackPerks.)*

The AI's decision and the fields it extracts (date/time, receipt ID, total, decision reason) are stored with your claim so we can explain outcomes and support you. This AI-derived receipt data is your personal data too: it is included in a data access request (DSAR) and is deleted or anonymised together with your claim when you exercise your deletion rights.

---

## Sub-processors

We use a small number of trusted providers to run the service. Each acts as a processor on our behalf:

| Sub-processor | Role | Location |
| --- | --- | --- |
| **Supabase** | Database (Postgres), authentication, file storage, edge functions | EU (eu-west-1) |
| **Vercel** | Hosting for the web app (frontend) | Global CDN; app data stays in Supabase EU |
| **Anthropic** | AI receipt verification (Claude) | United States |
| **Supabase (email)** | Sending magic-link / OTP sign-in emails | Supabase-managed email infrastructure |

---

## International transfers

**Where your data lives.** Your account and loyalty data — balances, claims, receipt and cup images, analytics, IBANs — are stored in the **EU (Supabase, eu-west-1)**.

**The one exception is AI receipt verification.** As described above, receipt photos are sent to **Anthropic in the United States** for processing, under the zero-retention standard API and protected by a DPA plus the EU-US DPF and/or SCCs.

### A note for users in the UAE

PackPerks is also intended for use by customers in the United Arab Emirates. If you use PackPerks from the UAE, please be aware that your data is stored and processed in the **European Union**, and that receipt images are processed by our AI provider in the **United States**, as described above. By using the service you understand that your personal data will be handled outside the UAE under this policy. We apply the same protections and give you the same rights described here regardless of where you are located.

---

## UAE users (PDPL)

If you use PackPerks in the **United Arab Emirates**, this section explains how the UAE Personal Data Protection Law (Federal Decree-Law No. 45 of 2021, the **PDPL**) applies to you. PackPerks does not store data inside the UAE, so using the app always moves your data across borders:

- **Your data is stored in the EU.** Your account, cup balances, reward claims, and any receipt or cup-scan photos are stored securely with our data provider **Supabase in the EU (region `eu-west-1`)**.
- **Receipt checks happen in the US.** When you submit a receipt, the photo and the details read from it are sent to **Anthropic (the Claude AI service) in the United States** to check your reward automatically. Anthropic does **not** use your receipt to train its AI and does **not** keep it after the check.

**On what basis we transfer your data.** These cross-border transfers are lawful because they are **necessary to provide the service you asked for** — the app simply cannot run without them — and, where needed, because you **consent** to them by choosing to use PackPerks after being told where your data goes. We back this with written data-processing agreements with our providers.

**Your rights.** You have the right to **access**, **correct**, and **delete** your personal data, and to object to or restrict certain processing. You can do most of this yourself in the in-app **Data control** section (edit your email or IBAN, reset your device, or delete your account). For anything else, or to make a formal request, email **support@packback.network** and we will help. You may also complain to the **UAE Data Office**.

For the full detail of how we handle UAE cross-border transfers, including the free-zone (DIFC / ADGM) position, see [`UAE_CROSS_BORDER.md`](UAE_CROSS_BORDER.md).

---

## Cookies and local storage

We keep this simple. We use **local storage** and cookies in two categories:

- **Essential** — required for the app to work at all. This includes your `device_id` (which keeps your cup balance attached to you) and your coarse device label. Without these, we can't run the service.
- **Behavioural analytics** — the non-essential `client_events` described above. These are **only** used if you choose "Accept all".

On your first visit you'll see a **cookie banner** with three choices:

- **Reject** — you decline analytics *and* choose not to use the app. Choosing Reject blocks use of the app, but it **never deletes cups or claims you've already earned**.
- **Essential only** — you can use the app with only the essential storage; no behavioural analytics are collected.
- **Accept all** — you use the app *and* allow behavioural analytics.

You can clear local-storage keys yourself at any time from the in-app **Data control** section.

---

## Lawful bases for processing

Under GDPR Article 6, we rely on the following lawful bases for each purpose:

| Purpose | Lawful basis |
| --- | --- |
| Cup tracking and reward claims | Performance of a contract |
| IBAN and cashback payout | Performance of a contract |
| AI receipt verification, fraud prevention and rate-limiting | Legitimate interests |
| Behavioural analytics (`client_events`) | Consent ("Accept all") |
| Saving/restoring your account by email | Contract / consent |
| Admin and security logs | Legitimate interests / legal obligation |
| Marketing | Consent — *note: we currently send no marketing* |

---

## How long we keep your data (retention)

We keep data only as long as we need it:

- **Receipt images** — deleted **90 days** after the related claim is resolved.
- **Cup-scan images** — deleted **90 days** after the scan.
- **Reward claims** — kept for **7 years** to meet Netherlands accounting rules, but only as amount, date, status and the **last 4 digits** of the IBAN. The raw IBAN is deleted on payout confirmation (see below).
- **Behavioural analytics (`client_events`)** — kept for **14 months**, then deleted or anonymised.
- **Admin audit and login logs** — **12 months** (kept longer only where there is an active investigation).
- **Activity history, balances and scans** — kept while your account is active; deleted after **24 months of inactivity**, and deleted when you delete your account.
- **Local storage keys** — stored on your own device and clearable by you at any time via Data control.

---

## How we handle your IBAN

Your IBAN gets special protection because it's sensitive financial data:

- It is stored in **one dedicated, restricted payout table** that can only be reached by our secure Edge Functions.
- **Only the top admin** can view a full IBAN. Everywhere else in the system it is **masked**.
- Once the top admin has exported an IBAN and confirmed that claim's payout, the **raw IBAN is deleted**.
- We keep only the **last 4 digits** alongside the claim record (amount, date, status) — and only because Netherlands accounting law requires us to keep the claim record for 7 years.

Partners never see your IBAN.

---

## How cashback and payout work

Cashback is paid out **manually**. Here's the flow:

1. You earn a balance by returning/reusing cups, and you make a reward claim.
2. If you want to be paid, you add your **IBAN** in the app.
3. When a payout is due, the **top admin** exports the IBAN through a **logged export** and makes the payment.
4. Once the payment is **confirmed**, your **raw IBAN is deleted**. The claim record (amount, date, status, last-4) is retained for accounting.

No other admin and no partner can see your full IBAN at any point in this process.

---

## Your rights and how to exercise them

Under GDPR you have the right to access, rectify, erase, restrict and port your data, and to object to certain processing. Where we rely on consent (analytics), you can withdraw it at any time.

We make most of this self-service. In the app, open the **Data control** section to:

- **Edit or delete specific data**
- **Reset your device** (clear the local `device_id` and related keys)
- **Delete your account** entirely

You can also make a **Data Subject Access Request (DSAR)** or exercise any other right by emailing **support@packback.network**. We'll respond within the timeframes required by law.

Note: deleting your account or resetting your device removes your data as described above, but we may retain the minimal claim records (amount, date, status, last-4) where the law requires us to.

If you believe we've mishandled your data, you have the right to complain to your supervisory authority — in the Netherlands, the *Autoriteit Persoonsgegevens*.

---

## Children

PackPerks is not directed at children and is intended for adults who make purchases and receive cashback. We do not knowingly collect personal data from children. If you believe a child has provided us with personal data, please contact **support@packback.network** and we will delete it.

---

## Changes to this policy

We may update this policy as the service evolves or as legal requirements change. When we make a material change, we will update the "Last updated" date above and, where appropriate, notify you in the app. The current version is always available in the app.

---

**Owner: PackPerks Privacy Owner** · **Contact: support@packback.network**
**Last updated: (to be dated on adoption)**
