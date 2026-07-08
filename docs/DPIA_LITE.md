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

PackPerks lets a customer collect returned reusable-cup credit at participating stores and receive cashback. A customer can start collecting **anonymously** — no login is required. An optional email sign-in preserves the account across devices and enables cashback payout via IBAN. Reward claims are paid out **manually** by a PackPerks admin.

### 1.2 Actors and roles

- **PackPerks** — sole **controller** for all personal data described here.
- **Partner stores** — receive **only aggregate statistics** through the admin-only dashboard. Partners never receive user-level histories, emails, IBANs, receipt images, or behavioural profiles. Partners are **not** controllers or joint controllers of user-level data.
- **Processors / sub-processors:**
  - **Supabase** (Postgres, Auth, Storage, Edge Functions) — hosted in the **EU region (eu-west-1)**. Also provides the managed email infrastructure that sends OTP / magic-link emails.
  - **Anthropic (Claude API)** — **United States** — performs AI receipt verification. PackPerks uses the standard Anthropic API: inputs are **not** used for training and are **not** retained beyond the request (zero-retention default).
  - **Vercel** — hosts the static React/Vite SPA (frontend delivery).

### 1.3 System architecture

- **Frontend:** React/Vite single-page app on **Vercel**. No traditional application backend.
- **Data platform:** **Supabase** (Postgres + Auth + Storage + Edge Functions), **EU (eu-west-1)**. Row-Level Security (RLS) and Edge Functions perform all privileged server-side logic.
- **Anonymous linkage:** a random `device_id` stored in `localStorage` links an anonymous user to their balance. It is an **essential** identifier, **not** used for analytics.
- **Optional account:** Supabase Auth magic-link / email OTP. Signing in saves the account across devices and lets the user add/see their IBAN and change their email.
- **AI verification:** receipt photos are sent to the **Anthropic API (US)** for automated verdicts on cup returns / reward eligibility.

### 1.4 Personal data inventory

| Category | Data | Essential? |
|---|---|---|
| Identity / contact | Optional email; random display name; **IBAN** (cashback payout) | Email/display name essential to account features; IBAN essential to payout |
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
4. **Cashback payout:** IBAN held in **one restricted payout table** reachable only by Edge Functions. **Top admin only** exports IBANs via a **logged export**; raw IBAN is **deleted after payout confirmation**; the claim record (amount, date, status, IBAN last-4) is retained for accounting.
5. **Analytics (consented only):** if the user selects "Accept all", `client_events` are written to Postgres.
6. **Partner reporting:** aggregate figures computed server-side and surfaced only in the admin-only dashboard.

### 1.6 Lawful bases (GDPR Art. 6)

| Processing | Basis |
|---|---|
| Cup tracking & reward claims | Contract (Art. 6(1)(b)) |
| IBAN payout | Contract (Art. 6(1)(b)) |
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

- **Anonymous-by-default** is the strongest data-minimising choice: most users never provide identity data at all. Only users who want cashback provide an email and IBAN.
- **IBAN** is genuinely necessary — cashback cannot be paid without a payout instrument. Proportionality is preserved by consolidating IBAN into one restricted table, masking it everywhere except the top-admin export, and **deleting the raw IBAN on payout confirmation** while keeping only last-4 for accounting.
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
| R1 | **Financial data / IBAN** — unauthorised access, over-retention, or leak of IBANs enabling fraud or distress | High / High | Low / Medium | **P0** |
| R2 | **Receipt images** — images can reveal location, time, spending, and incidental personal data; broad or long exposure | Medium / High | Low / Medium | **P0** |
| R3 | **AI verification with US transfer** — third-country transfer of images/extracted data; provider access; adequacy/DPF gap | Medium / High | Low / Medium | **P0** |
| R4 | **Behavioural profiling** — `client_events` builds a behavioural profile without a lawful basis or beyond user expectation | Medium / Medium | Low / Low | **P1** |
| R5 | **Pseudonymous device tracking** — `device_id` re-identifies or is repurposed for analytics/tracking | Medium / Medium | Low / Low | **P1** |
| R6 | **Anonymous-by-default accounts** — a mis-scoped RLS policy or shared `device_id` exposes one user's balance/history to another | High / Medium | Low / Medium | **P0** |
| R7 | **Admin over-access** — admins view user-level data (IBANs, receipts, histories) beyond need; weak audit | Medium / High | Low / Medium | **P1** |
| R8 | **Retention drift** — images/events kept past their period through missing/failed jobs | Medium / Medium | Low / Low | **P1** |

---

## 4. Mitigations

**M1 — RLS lockdown (R6, R1, R2, R7).** Every user-facing table has Row-Level Security enabled and **default-deny**. Policies scope rows to the owning auth user or the owning `device_id`. No table is readable with the anon key beyond the owner's own rows. Storage buckets are **private**; access is via short-lived **signed URLs** only.

**M2 — Anonymous-auth owner-scoped policies (R6).** Anonymous users are constrained to their own `device_id`-scoped rows. On email sign-in, the anonymous balance is merged into the authenticated user's records under controlled logic, with no path for one device to read another's data.

**M3 — IBAN consolidation + top-admin-only + delete-on-payout (R1).** IBANs live in **one restricted payout table** reachable **only via Edge Functions** (never the client). IBAN is **masked everywhere** in the app and admin UI except a single **top-admin-only** view used to make payment. Export is **logged**. On payout confirmation the **raw IBAN is deleted**; only amount, date, status, and IBAN last-4 are retained for the 7-year NL accounting requirement.

**M4 — Consent-gated analytics (R4).** The cookie banner on first visit offers **Reject / Essential only / Accept all**. `client_events` are written **only** after "Accept all". Essential cookies are required to use the app. "Reject" blocks app use but **never deletes cups/claims already earned**. No third-party analytics or ad SDKs are loaded under any option.

**M5 — Device-tracking containment (R5).** `device_id` and the coarse device label are used **only** as essential identifiers for balance linkage and basic fraud/rate-limiting. They are **excluded** from `client_events` and from all behavioural processing. Users can reset the device / clear localStorage keys via **Data control**.

**M6 — Retention jobs (R2, R8).** Scheduled jobs enforce: receipt images deleted **90 days** after the claim is resolved; cup-scan images deleted **90 days** after the scan; `client_events` deleted/anonymised at **14 months**; admin audit + login logs kept **12 months** (longer only for an active investigation); activity/balances/scans deleted after **24 months inactivity** or on account deletion; reward claims kept **7 years** as amount/date/status + IBAN last-4. Job success is monitored so retention does not silently drift.

**M7 — DSAR / Data-control (all).** An in-app **"Data control"** section lets users edit/delete specific data, reset the device, and delete their account. A **manual DSAR email** channel handles access/erasure/portability requests that fall outside the self-service tooling, owned by the PackPerks Privacy Owner.

**M8 — DPAs & transfer safeguards (R3).** Data Processing Agreements with **Supabase** and **Anthropic**. For the US transfer to Anthropic, rely on **EU-US DPF** (if certified) or **SCCs**, backed by a transfer risk assessment. Core data stays in **EU (eu-west-1)**.

**M9 — No-training AI (R3).** Receipt verification uses the **standard Anthropic API** with the zero-retention default: inputs are **not** used for training and **not** retained beyond the request. Only the minimum image + necessary fields are sent.

**M10 — Admin least-privilege & audit (R7).** Full IBAN view restricted to the **top admin**; other admins see masked values and aggregate/partner data only. All admin actions are captured in audit logs (before/after state, admin IP, user agent) and admin login history is recorded.

---

## 5. Residual risk & sign-off

After the Section 4 mitigations are implemented, all identified risks reduce to **Low likelihood** with impact no higher than **Medium** (R1, R2, R3, R6, R7) or **Low** (R4, R5, R8). The highest residual concerns are the IBAN payout table and the US AI transfer; both are contained by strict access control, delete-on-payout, and DPA/DPF/SCC coverage.

**Conditions for acceptance:**

- **P0 items must be complete before or at MVP launch:** RLS default-deny lockdown and owner-scoped anonymous policies (M1, M2, M6-scoping); IBAN consolidation + top-admin-only + delete-on-payout (M3); Anthropic DPA + DPF/SCC + transfer risk assessment (M8, M9); private Storage with signed URLs (M1).
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
