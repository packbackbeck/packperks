# PackPerks — Data Protection Impact Assessment (DPIA-Lite)

**Privacy owner:** [FILL: privacy owner name] · **Contact:** info@packback.network · **Last updated:** 2026-07-03

**Status:** Draft for MVP adoption
**Last updated:** (to be dated on adoption)
**Owner:** PackPerks Privacy Owner
**Scope:** PackPerks reusable-cup loyalty/cashback MVP (EU/Netherlands primary market; UAE users also served)
**Controller:** PackPerks (sole controller)

This is a lightweight DPIA appropriate to an MVP. It is not a full Article 35 DPIA, but it identifies the higher-risk processing activities in PackPerks, rates them before and after mitigation, and records the residual position and sign-off. It must be revisited before any behavioural targeting, personalised offers, or prize-draw/lottery mechanic is introduced (see Section 5).

---

## 1. Processing description & data flows

### 1.1 What PackPerks does

PackPerks lets a customer collect returned reusable-cup credit at participating stores and receive cashback. A customer can start collecting **anonymously** — no login is required. An optional email sign-in preserves the account across devices. Approved reward claims are paid out via a **self-service Tikkie link** (ABN AMRO Cashback API) that the customer opens to collect their money — **PackPerks never collects a bank account number (IBAN).**

### 1.2 Actors and roles

- **PackPerks** — sole **controller** for all personal data described here.
- **Partner stores** — receive **only aggregate statistics** through the admin-only dashboard. Partners never receive user-level histories, emails, payout data, receipt images, or behavioural profiles. Partners are **not** controllers or joint controllers of user-level data.
- **Processors / sub-processors:**
  - **Supabase** (Postgres, Auth, Storage, Edge Functions) — hosted in the **EU region (eu-west-1)**.
  - **Anthropic (Claude API)** — **United States** — performs AI receipt verification. PackPerks uses the standard Anthropic API: inputs are **not** used for training and are **not** retained beyond the request (zero-retention default).
  - **ABN AMRO / Tikkie (Cashback API)** — **EU (Netherlands)** — creates the self-service cashback payout link. Receives the payout amount + campaign reference only; no bank account number is sent by PackPerks.
  - **Brevo (Sendinblue SAS)** — **EU (France)** — transactional email: OTP / magic-link sign-in mail and the "cashback ready" notification (Supabase Auth custom SMTP).
  - **Vercel** — hosts the static React/Vite SPA (frontend delivery).

### 1.3 System architecture

- **Frontend:** React/Vite single-page app on **Vercel**. No traditional application backend.
- **Data platform:** **Supabase** (Postgres + Auth + Storage + Edge Functions), **EU (eu-west-1)**. Row-Level Security (RLS) and Edge Functions perform all privileged server-side logic.
- **Anonymous linkage:** a random `device_id` stored in `localStorage` links an anonymous user to their balance. It is an **essential** identifier, **not** used for analytics.
- **Optional account:** Supabase Auth magic-link / email OTP. Signing in saves the account across devices, delivers the "cashback ready" notification, and lets the user change their email.
- **AI verification:** receipt photos are sent to the **Anthropic API (US)** for automated verdicts on cup returns / reward eligibility.

### 1.4 Personal data inventory

| Category | Data | Essential? |
|---|---|---|
| Identity / contact | Optional email; random display name; Tikkie payout reference (no bank account number) | Email/display name essential to account features; payout reference essential to link a claim to its Tikkie collection |
| Device / technical | `device_id` (localStorage); coarse device label (e.g. "iPhone / iOS 17") | Essential; **not** used for stats/behaviour |
| Loyalty / transaction | Per-store cup balances, activity history, cup scans, BYO-cup requests, reward claims (amount, date, status), AI verdict + AI-extracted receipt fields (datetime, receipt id, total, decision reason) | Essential to service |
| Images | Receipt photos, cup-scan photos (private Supabase Storage, signed URLs) | Essential to verification |
| Behavioural analytics | `client_events` (screen views, button taps, reward changes, shares, funnel events) | **Non-essential** — only with "Accept all" consent |
| Admin / security | Audit logs (before/after state, admin IP + user agent), admin login history | Essential to security/accountability |

No Google Analytics, no Meta Pixel, no advertising trackers, no marketing processing.

### 1.5 Data flows

1. **Cup collection (anonymous):** browser → Supabase (RLS-scoped to `device_id` / auth user). Balances and activity persist in Postgres; images in private Storage (signed URLs only).
2. **Receipt/cup verification:** browser uploads image → Supabase Storage → Edge Function forwards image to **Anthropic (US)** → verdict + extracted fields returned and stored against the claim/scan. Image later deleted per retention schedule.
3. **Account save/restore:** email OTP / magic link via **Supabase-managed email**. Auth session links `device_id` balance to the user account.
4. **Cashback payout (Tikkie):** on approval, an Edge Function calls the ABN AMRO / Tikkie Cashback API (campaign secrets server-side only) to create a payout link, stored against the claim. The customer opens the link and enters their bank details **directly into Tikkie** — PackPerks never receives or stores a bank account number. Only the non-identifying Tikkie payout reference (amount, date, status) is retained for accounting.
5. **Analytics (consented only):** if the user selects "Accept all", `client_events` are written to Postgres.
6. **Partner reporting:** aggregate figures computed server-side and surfaced only in the admin-only dashboard.

### 1.6 Lawful bases (GDPR Art. 6)

| Processing | Basis |
|---|---|
| Cup tracking & reward claims | Contract (Art. 6(1)(b)) |
| Cashback payout (Tikkie link) | Contract (Art. 6(1)(b)) |
| Receipt AI verification & fraud / rate-limiting | Legitimate interests (Art. 6(1)(f)) |
| Behavioural analytics | Consent (Art. 6(1)(a)) |
| Email save / restore | Contract / consent |
| Admin & security logs | Legitimate interests / legal obligation (Art. 6(1)(f)/(c)) |
| Marketing (none currently) | Would require consent |

### 1.7 International transfers

- **Supabase:** EU (eu-west-1) — no third-country transfer for core data at rest.
- **Anthropic (US):** third-country transfer of receipt images + extracted fields. **Action (P0):** execute Anthropic DPA and put an EU-US DPF certification or SCCs in place, plus a transfer risk assessment, before or at MVP launch.
- **UAE users:** their personal data is processed in the EU (Supabase eu-west-1) and, for verification, briefly in the US (Anthropic). UAE users are informed of this via the privacy notice; PDPL-facing notice/consent alignment is tracked as a follow-up but does not change the EU data-processing posture.

---

## 2. Necessity & proportionality

- **Anonymous-by-default** is the strongest data-minimising choice: most users never provide identity data at all. Only users who want cashback provide an email.
- **No payout instrument is collected.** The Tikkie link model means the customer supplies their bank details directly to Tikkie, so PackPerks holds **no IBAN at all** — eliminating the highest-sensitivity data category the legacy manual-transfer flow required, rather than merely minimising it.
- **Receipt/cup images** are necessary to verify a claim and deter fraud; they are deleted 90 days after the claim/scan is resolved, so they are not held longer than the dispute/fraud window requires.
- **AI verification** processes only the submitted image and returns a structured verdict; the provider does not train on or retain the input. This is proportionate versus manual human review of every receipt.
- **`device_id` and coarse device label** are essential for linking a session to its balance and for basic fraud/rate-limiting; they are explicitly **excluded** from analytics, so no behavioural profile is built from them.
- **Behavioural analytics** are **not** necessary to deliver the service, so they are strictly **consent-gated** ("Accept all"), can be declined, and are anonymised/deleted at 14 months.
- **Partner data-sharing** is minimised to aggregates only — partners get no user-level data.

Conclusion: the processing is necessary for the loyalty/cashback purpose and proportionate, with non-essential processing separated out and gated behind consent.

---

## 3. Risk assessment (before / after mitigation)

Ratings use Likelihood (L) and Impact (I) on a Low / Medium / High scale. "Before" = inherent risk; "After" = residual after the Section 4 mitigations are implemented.

| # | Risk | Before (L / I) | After (L / I) | Priority |
|---|---|---|---|---|
| R1 | **Financial data** — the legacy IBAN/bank-transfer flow risked leak of bank account numbers. **Eliminated by design:** the Tikkie link model means PackPerks collects **no IBAN**, so only a non-identifying payout reference remains | Low / Low | Low / Low | **P2** |
| R2 | **Receipt images** — images can reveal location, time, spending, and incidental personal data; broad or long exposure | Medium / High | Low / Medium | **P0** |
| R3 | **AI verification with US transfer** — third-country transfer of images/extracted data; provider access; adequacy/DPF gap | Medium / High | Low / Medium | **P0** |
| R4 | **Behavioural profiling** — `client_events` builds a behavioural profile without a lawful basis or beyond user expectation | Medium / Medium | Low / Low | **P1** |
| R5 | **Pseudonymous device tracking** — `device_id` re-identifies or is repurposed for analytics/tracking | Medium / Medium | Low / Low | **P1** |
| R6 | **Anonymous-by-default accounts** — a mis-scoped RLS policy or shared `device_id` exposes one user's balance/history to another | High / Medium | Low / Medium | **P0** |
| R7 | **Admin over-access** — admins view user-level data (receipts, histories, emails) beyond need; weak audit | Medium / High | Low / Medium | **P1** |
| R8 | **Retention drift** — images/events kept past their period through missing/failed jobs | Medium / Medium | Low / Low | **P1** |

---

## 4. Mitigations

**M1 — RLS lockdown (R6, R1, R2, R7).** Every user-facing table has Row-Level Security enabled and **default-deny**. Policies scope rows to the owning auth user or the owning `device_id`. No table is readable with the anon key beyond the owner's own rows. Storage buckets are **private**; access is via short-lived **signed URLs** only.

**M2 — Anonymous-auth owner-scoped policies (R6).** Anonymous users are constrained to their own `device_id`-scoped rows. On email sign-in, the anonymous balance is merged into the authenticated user's records under controlled logic, with no path for one device to read another's data.

**M3 — No IBAN collected: Tikkie self-service payout (R1).** PackPerks holds **no bank account number**. On approval an Edge Function creates a Tikkie payout link (ABN AMRO Cashback API) using campaign secrets held server-side only; the customer opens the link and enters their bank details **directly into Tikkie**. Only a non-identifying Tikkie payout reference (amount, date, status) is retained for the 7-year NL accounting requirement. This removes the entire IBAN data category the legacy manual-transfer flow required.

**M4 — Consent-gated analytics (R4).** The cookie banner on first visit offers **Reject / Essential only / Accept all**. `client_events` are written **only** after "Accept all". Essential cookies are required to use the app. "Reject" blocks app use but **never deletes cups/claims already earned**. No third-party analytics or ad SDKs are loaded under any option.

**M5 — Device-tracking containment (R5).** `device_id` and the coarse device label are used **only** as essential identifiers for balance linkage and basic fraud/rate-limiting. They are **excluded** from `client_events` and from all behavioural processing. Users can reset the device / clear localStorage keys via **Data control**.

**M6 — Retention jobs (R2, R8).** Scheduled jobs enforce: receipt images deleted **90 days** after the claim is resolved; cup-scan images deleted **90 days** after the scan; `client_events` deleted/anonymised at **14 months**; admin audit + login logs kept **12 months** (longer only for an active investigation); activity/balances/scans deleted after **24 months inactivity** or on account deletion; reward claims kept **7 years** as amount/date/status + Tikkie payout reference. Job success is monitored so retention does not silently drift.

**M7 — DSAR / Data-control (all).** An in-app **"Data control"** section lets users edit/delete specific data, reset the device, and delete their account. A **manual DSAR email** channel handles access/erasure/portability requests that fall outside the self-service tooling, owned by the PackPerks Privacy Owner.

**M8 — DPAs & transfer safeguards (R3).** Data Processing Agreements with **Supabase** and **Anthropic**. For the US transfer to Anthropic, rely on **EU-US DPF** (if certified) or **SCCs**, backed by a transfer risk assessment. Core data stays in **EU (eu-west-1)**.

**M9 — No-training AI (R3).** Receipt verification uses the **standard Anthropic API** with the zero-retention default: inputs are **not** used for training and **not** retained beyond the request. Only the minimum image + necessary fields are sent.

**M10 — Admin least-privilege & audit (R7).** Admin capabilities are gated by role (owner / admin / manager); approving a claim and issuing its Tikkie payout link are role-restricted actions. All admin actions are captured in audit logs (before/after state, admin IP, user agent) and admin login history is recorded. (No IBAN view exists — the payout model holds no bank account number.)

---

## 5. Residual risk & sign-off

After the Section 4 mitigations are implemented, all identified risks reduce to **Low likelihood** with impact no higher than **Medium** (R2, R3, R6, R7) or **Low** (R1, R4, R5, R8). The former top concern — the IBAN payout table — is **eliminated** rather than mitigated: the Tikkie model means no bank account number is collected at all. The highest residual concern is now the US AI transfer, contained by DPA/DPF/SCC coverage and the zero-retention default.

**Conditions for acceptance:**

- **P0 items must be complete before or at MVP launch:** RLS default-deny lockdown and owner-scoped anonymous policies (M1, M2, M6-scoping); Anthropic DPA + DPF/SCC + transfer risk assessment (M8, M9); private Storage with signed URLs (M1). *(The former IBAN P0, M3, is satisfied by design — no bank account number is collected.)*
- **P1 items must be complete shortly after launch:** consent-gated analytics enforced end-to-end (M4), device-tracking containment (M5), retention jobs live and monitored (M6), admin least-privilege + audit (M10), and DSAR/Data-control fully wired (M7).

**Conclusion:** the residual risk is **acceptable for the MVP** once the **P0** controls are in place and the **P1** controls follow on the stated timeline.

**Mandatory re-assessment trigger:** introducing **behavioural targeting / personalised offers**, or any **prize-draw / lottery** mechanic, materially changes the profiling and expectation profile. This DPIA-Lite **must be updated to a fuller DPIA** before such features ship.

---

**Prepared by:** PackPerks Privacy Owner
**Owner:** PackPerks Privacy Owner
**Last updated:** (to be dated on adoption)
**Review:** on any change to the data inventory, sub-processors, transfers, or the retention schedule; and mandatorily before behavioural targeting or lottery features.

---

## 6. Future features — profiling & lotteries

PackPerks currently runs **no lottery, no "Lucky Cup", and no behavioural-targeting or re-engagement feature**. There is no prize-draw mechanic and no profiling of customers to drive offers.

If any such feature is added later, **this DPIA and the privacy notice must be updated, and a fairness/transparency review completed, before the feature launches.** A lottery or targeting mechanic materially changes the profiling and expectation profile (see the mandatory re-assessment trigger in Section 5) and cannot ship under this DPIA-Lite as it stands.
