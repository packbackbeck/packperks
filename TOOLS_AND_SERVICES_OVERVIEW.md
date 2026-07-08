# Tools & Services Overview

> **What this is:** a plain-English list of every outside service PackPerks relies on — what it does, where it runs, and what personal data (if any) it touches. It is written for a non-technical reader and supports our privacy and compliance work (processor agreements, the privacy policy, and data-transfer records).

---

## A few words first (so the table makes sense)

- **Processor** — an outside company that handles our users' data *on our behalf* (for example, the company that stores our database). Under GDPR we should have a signed **DPA** (Data Processing Agreement) with each one.
- **Where it is hosted matters.** Data kept inside the EU is simplest. Sending personal data outside the EU needs an extra legal safeguard (Standard Contractual Clauses, or the EU–US Data Privacy Framework).
- **"Loads in the visitor's browser"** — when someone opens the app, their browser fetches some files directly from another company's servers. Even a font or a map tile does this, and doing so **shares the visitor's IP address** with that company. That is why fonts and maps appear on a privacy list even though they feel harmless.
- **IP address** counts as personal data under GDPR.

---

## At a glance

| Service | What it does for us | Where it is hosted | Personal data it touches | Leaves the EU? |
|---|---|---|---|---|
| **Supabase** | Our database, login, file storage and server functions — the "engine room" | EU (Ireland region) | Almost everything: email, IBAN, device id, balances, receipts, activity | No (stays in EU) |
| **Anthropic (Claude AI)** | Reads receipt photos to verify purchases | USA | Receipt photos and the details read from them | Yes |
| **Brevo** (email, via Supabase SMTP) | Sends the login / verification / admin-invite emails | **EU (France)** | Email address only | **No (stays in EU)** |
| **Tikkie** (payments & payouts — planned) | Will pay out cashback and handle payments | Netherlands (ABN AMRO) | Name, IBAN / phone, payout amount | No (stays in EU) |
| **Web host / CDN** | Serves the website itself to visitors | Global CDN (US-based provider) | Technical logs only (IP, browser) — no stored profiles | Yes (logs) |
| **Map tiles** (CARTO + OpenStreetMap) | The imagery on the store-finder map | CARTO / OSM (US/EU) | Visitor's IP address, only when the map is opened | Yes |
| **Reward / product images** | Product photos shown for each reward | Various partner servers | Visitor's IP address when images load | Yes |
| **App font (DM Sans)** | The app's typeface | **Our own servers (self-hosted)** | None sent to any third party | **No — resolved** (see below) |
| **First-party analytics** | Our own in-app usage stats | Inside Supabase (EU) | Device id and in-app actions (consent-gated) | No |

> *Brevo (formerly Sendinblue) is an EU (France) company and sends from EU infrastructure, so login-email data does not leave the EU — see the "Email" note below.

> **Good news up front:** PackPerks uses **no third-party advertising or tracking pixels** — no Google Analytics, no Meta/Facebook pixel, no Mixpanel, no Hotjar, and similar. Usage analytics are our own, stay in our EU database, and are only collected if the visitor accepts analytics cookies.

---

## The core services (in detail)

### 1. Supabase — the engine room (EU)
Supabase is where nearly all our data lives and where most of the app's logic runs. It gives us four things in one:
- **Database** — customer profiles, cup balances, claims, activity history.
- **Login / Auth** — the optional email sign-in that lets people restore their cups on a new phone.
- **File storage** — receipt photos and cup-scan photos, kept in **private** folders (not public).
- **Server functions** — small secure programs that do sensitive jobs (create a claim, handle payouts, verify a receipt) so secrets never sit in the visitor's browser.

**Where:** the European Union (Supabase's Ireland / `eu-west-1` region). Data stays in the EU.
**Personal data:** the most sensitive we hold — email, IBAN, device id, balances, receipts.
**Action:** sign/confirm the Supabase DPA and its EU-region + sub-processor list.

### 2. Anthropic (Claude AI) — receipt verification (USA)
When a customer submits a receipt for cashback, the **photo is sent to Anthropic's Claude AI** in the United States, which reads it and tells us whether it is a genuine receipt for the right item.

**Where:** United States.
**Personal data:** the receipt image and the details read from it (date, total, items).
**Important:** on Anthropic's standard API, inputs are **not used to train their models** and are **not kept after the request**. This is the one routine transfer of data outside the EU, so it needs a signed DPA plus a transfer safeguard (SCCs / Data Privacy Framework).

### 3. Brevo — sending emails (via Supabase SMTP)
The account-linking / login emails (one-time code + magic link), the admin
invite and password-reset emails all go out through **Brevo** (formerly
Sendinblue), connected to **Supabase Auth as our custom SMTP provider**
(`smtp-relay.brevo.com`).

**Where:** Brevo is an **EU (France)** company and sends from EU infrastructure, so login-email data **stays in the EU** — no transfer outside the EU for these emails.
**Personal data:** the email address only (plus the email content, which is a login code / link).
**Action:** sign the Brevo DPA, authenticate our sending domain (SPF + DKIM), and confirm the From address matches our domain.

### 4. Tikkie — payments and payouts (planned, Netherlands)
Cashback payouts will be handled through **Tikkie** (by ABN AMRO). Instead of paying each customer by hand, Tikkie lets us pay out to a customer's account and manage payments through a regulated Dutch bank.

**Where:** the Netherlands (ABN AMRO is an EU bank), so payment data **stays in the EU**.
**Personal data:** the customer's name, IBAN or phone number, and the payout amount.
**Note:** this is a **planned** integration; today cashback is still paid manually by bank transfer. As a regulated bank, ABN AMRO/Tikkie comes with strong, built-in data protection — but we still record it as a processor and reference it in the privacy policy.
**Action:** complete the Tikkie onboarding/agreement and describe the payout flow in the privacy policy.

### 5. Web host / CDN — serving the site
The PackPerks app is a "static" website (built once, then served to everyone) delivered through a global content-delivery network so it loads fast worldwide.

**Where:** a US-based hosting/CDN provider with edge servers globally *(current records list this as Vercel — please confirm the exact provider)*.
**Personal data:** no stored customer profiles — just standard technical request logs (IP address, browser type) needed to serve pages.
**Action:** confirm the provider, sign its DPA, and check log retention + region.

---

## Things the visitor's browser loads

These are not "databases" — they are files the browser fetches from other companies while the app runs. Each one **shares the visitor's IP address** with that company, which is why they belong on a privacy review.

### App font (DM Sans) — now self-hosted (resolved)
Previously the app loaded its typeface from **Google Fonts**, which sent every visitor's IP address to Google in the US on each visit — a known GDPR sensitivity. **This is now fixed:** the font is **self-hosted** (served from our own servers), so nothing is sent to Google. See the section below for exactly how, and why it is still fast and secure.

### Map tiles — CARTO + OpenStreetMap
The store-finder **map** draws its imagery ("tiles") from CARTO, using OpenStreetMap data. This happens **only when a customer opens the map view**, and it shares their IP with those services at that moment.
> Options: keep it (and disclose it in the privacy policy) or, for a stricter setup, switch to an EU-hosted map-tile provider.

### Reward and product images
Each reward shows a product photo. Some are hosted on **partners' own image servers** (for example, a café or brand's website), so the browser loads them from there and shares the visitor's IP with those hosts when the images appear.
> Optional tidy-up: re-host reward images in our own Supabase storage so all images come from one place.

---

## How we fixed the Google Fonts issue (self-hosted font)

**The problem.** Loading a font from `fonts.googleapis.com` means every visitor's browser contacts Google and hands over its IP address. Under GDPR that is a data transfer to the US that we do not control, and European courts have ruled websites should host fonts themselves instead.

**The fix (already applied).** We now serve the font from our own website:

1. **Downloaded the font files.** We took the exact DM Sans files the app uses (the modern, compressed `.woff2` format) and saved them inside the project at `public/fonts/`. Only four small files are needed (about 78 KB in total) because DM Sans is a "variable" font — one file covers the regular, medium and bold weights.
2. **Pointed the app at the local files.** In our stylesheet we declared the font with `@font-face` rules that load `/fonts/dm-sans-*.woff2` from our own origin, and **removed** the old `@import` line that pulled from Google.
3. **Kept it fast.** We added a small `preload` hint in the page so the main font starts downloading immediately, and used `font-display: swap` so text is visible instantly (in a fallback font) and swaps to DM Sans the moment it is ready — no blank text, no layout jump.
4. **Kept it secure.** The files are served from our own HTTPS domain, so there is no third-party connection and no IP shared with Google. The font is only static data (no code), so there is nothing executable to trust.

**Why this is better, in one line:** the app looks identical, loads just as fast (often faster, since it is one origin and preloaded), and **no visitor data ever reaches Google**.

> Verified: with this change, opening the app makes **zero requests** to Google's font servers, and DM Sans still renders throughout.

---

## Analytics and tracking

- **What we collect:** our own in-app usage events (for example "opened the app", "scanned a cup"), stored in **our EU Supabase database**.
- **What we do NOT use:** any third-party tracker or ad pixel (no Google Analytics, Meta pixel, Mixpanel, Segment, Hotjar, and similar).
- **Consent:** these analytics are only recorded if the visitor chooses **"Accept all"** on the cookie banner. Declining keeps their cups but records no analytics.
- A **device id** (a random code in the browser) is used to remember a returning phone without a login. It is treated as personal data, disclosed to the user, and can be reset by them.

---

## Payments

- **Today:** cashback is paid **manually by bank transfer** to the IBAN the customer provides. There is no payment processor connected yet.
- **Planned:** payouts (and payments) will run through **Tikkie / ABN AMRO** in the Netherlands (see section 4 above) — keeping payment data inside the EU.
- The IBAN is stored in a single restricted place and **deleted once the payout is confirmed** (only the last four digits are kept as a record).

---

## Where data lives and what crosses the border

| Stays in the EU | Goes outside the EU (needs a safeguard) |
|---|---|
| The whole database, files and app logic (Supabase, EU region) | Receipt photos → Anthropic (US) for AI checks |
| Payments and payouts (Tikkie / ABN AMRO, Netherlands) | Website delivery logs → hosting/CDN (US-based) |
| Our own analytics | Login emails → Brevo (EU, France) |
| The app font (self-hosted) | Visitor IPs → map tiles and partner image servers |

---

## Compliance checklist (short version)

1. **Sign/confirm DPAs** with Supabase, the web host, Anthropic, Brevo, and Tikkie/ABN AMRO — tracked in `docs/DPA_STATUS.md`.
2. **Authenticate our Brevo sending domain** (SPF + DKIM) and confirm the From address is on our domain — Brevo is already EU-hosted, so login-email data stays in Europe.
3. **Confirm** the exact web-hosting provider and its region and log retention.
4. **Confirm in writing** Anthropic's no-training + no-retention terms and its EU→US transfer safeguard.
5. **Disclose** the map tiles and partner image loads in the privacy policy (`docs/PRIVACY_POLICY.md`). The font is already self-hosted, so it no longer needs a Google disclosure.
6. Keep the **cookie banner** as the gate for analytics (already in place).

> For the full legal detail behind this overview, see `docs/DPA_STATUS.md` (processor list), `docs/ROPA.md` (record of what we process), `docs/UAE_CROSS_BORDER.md` (UAE), and `docs/PRIVACY_POLICY.md` (the customer-facing notice).
