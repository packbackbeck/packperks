# Record of Processing Activities (Article 30 GDPR)

**Privacy owner:** [FILL: privacy owner name] · **Contact:** info@packback.network · **Last updated:** 2026-07-03

**Controller:** PackPerks (sole controller for all activities below)
**Owner:** PackPerks Privacy Owner
**Last updated:** (to be dated on adoption)

---

## About this record

This is the Article 30(1) record of processing activities for PackPerks, a reusable-cup
loyalty and cashback service. The service is a React/Vite single-page application hosted on
Vercel, backed by Supabase (Postgres, Auth, Storage and Edge Functions) provisioned in the EU
region (`eu-west-1`). There is no separate traditional backend.

PackPerks is established in the Netherlands and operates under the GDPR. Some users are located
in the UAE; where personal data of UAE users is processed, PackPerks applies the same standard
of protection described here, and cross-border handling of that data is covered under the same
technical and organisational measures.

PackPerks is the **sole controller** for every activity. Commercial partners (the cafés and
venues whose cups are tracked) are **not** controllers or joint controllers: they receive only
aggregate statistics through the admin-only dashboard and never receive user-level histories,
emails, IBANs, receipt images, or behavioural profiles.

**Common recipients / sub-processors across activities** (detailed per activity below):

- **Supabase** — hosting of Postgres database, Auth, Storage and Edge Functions; EU region
  (`eu-west-1`). Processor.
- **Vercel** — hosting/serving of the static SPA frontend. Processor (serves application code
  and assets; application personal data resides in Supabase).
- **Anthropic (Claude API)** — AI receipt verification only; processing in the **United States**.
  Processor. Standard Anthropic API: inputs are not used for model training and are not retained
  beyond the request (zero-retention default).
- **Supabase-managed email infrastructure** — delivery of OTP / magic-link authentication emails.
  Processor.

No Google Analytics, Meta Pixel, or advertising/marketing trackers are used anywhere in the
service.

**Baseline technical and organisational security measures** (apply to all activities unless
a stronger measure is noted): TLS in transit; encryption at rest for the Postgres database and
Storage buckets; Supabase Row Level Security (RLS) scoping every table to the owning
device/account; private Storage buckets served only via short-lived signed URLs; restricted
Edge-Function-only access to the payout table; least-privilege admin roles with a distinguished
top-admin role for IBAN visibility; audit logging of admin actions; separation of the anonymous
`device_id` from any behavioural analytics.

---

## Activity 1 — Onboarding and cup collection

- **Purpose:** Allow a customer to start collecting cup credits immediately, anonymously and
  without login; maintain per-store cup balances and the customer's activity history; link an
  anonymous customer to their balance across sessions on the same device.
- **Lawful basis (Art. 6):** Contract — providing the cup-tracking / loyalty service the user
  is asking to use. The essential `device_id` and coarse device label are strictly necessary to
  operate the service.
- **Data-subject categories:** Customers.
- **Personal-data categories:**
  - `device_id` — random identifier stored in browser `localStorage`, essential, used only to
    link the anonymous user to their balance; **not** used for analytics or behavioural profiling.
  - Coarse device label (e.g. "iPhone / iOS 17") — essential context, **not** used for
    statistics or behaviour.
  - Random display name.
  - Per-store cup balances, activity history, cup scans, cup-scan photos.
- **Recipients / sub-processors:** Supabase (database + Storage, EU); Vercel (frontend serving).
  No partner receives this data at user level.
- **International transfers:** None for this activity — data resides in Supabase `eu-west-1`.
- **Retention:**
  - Balances, activity history and scans: kept while the account/device is active; deleted after
    24 months of inactivity; deleted on account deletion.
  - Cup-scan images: deleted 90 days after the scan.
  - `localStorage` keys (including `device_id`): device-local; user-clearable at any time via the
    in-app "Data control" section ("reset device").
  - "Reject" on the cookie banner blocks further app use but **never** deletes cups or claims
    already earned.
- **Security measures:** Baseline measures; RLS scoping all balance/scan rows to the owning
  `device_id`/account; private Storage bucket for cup-scan photos with signed-URL access only;
  strict separation of the essential `device_id` from the analytics pipeline.

---

## Activity 2 — Reward claim and cashback payout

- **Purpose:** Let a customer claim a reward against their cup balance and receive a manual
  cashback payout to their bank account; keep the accounting record of paid claims.
- **Lawful basis (Art. 6):**
  - Reward claim: Contract.
  - IBAN payout: Contract.
  - Retention of the claim record for 7 years: Legal obligation (Netherlands accounting/tax
    retention).
- **Data-subject categories:** Customers.
- **Personal-data categories:**
  - IBAN (bank account for payout).
  - Reward claims: amount, date, status.
  - Derived accounting record: amount, date, status, and IBAN **last-4** only.
- **Recipients / sub-processors:** Supabase (database, EU). The **top admin** exports IBANs to
  execute the manual payment (logged export). Partners never receive IBANs or claim-level data.
- **International transfers:** None — data resides in Supabase `eu-west-1`. IBAN handling and
  export are performed by the top admin.
- **Retention:**
  - Raw IBAN: consolidated into one restricted payout table; **deleted** after the admin exports
    and confirms that claim's payout.
  - Claim record: kept **7 years** (NL accounting) as amount / date / status plus IBAN last-4.
- **Security measures (data-minimisation by design):**
  - IBAN consolidated into a **single restricted payout table** reachable only by Edge Functions;
    application/UI code cannot read it directly.
  - Full IBAN viewable **only by the top admin**; masked everywhere else in the system.
  - IBAN export is a **logged export** action; raw IBAN is deleted on payment confirmation, leaving
    only the last-4 in the retained accounting record.
  - Baseline measures (encryption at rest/in transit, RLS, least-privilege admin roles).

---

## Activity 3 — AI receipt verification

- **Purpose:** Verify a customer-submitted receipt photo to decide whether a claim is legitimate
  (anti-fraud eligibility check), and extract the structured fields needed to evaluate the claim.
- **Lawful basis (Art. 6):** Legitimate interests — verifying claims and preventing fraudulent or
  duplicate reward claims. This is a service-integrity check, not automated decision-making with
  legal or similarly significant effects; a customer may contact PackPerks to have a declined
  claim reviewed manually.
- **Data-subject categories:** Customers.
- **Personal-data categories:**
  - Receipt photos (may contain purchase details and, depending on the receipt, other printed
    information).
  - AI verdict and AI-extracted receipt fields: datetime, receipt ID, total, decision reason.
- **Recipients / sub-processors:**
  - **Anthropic (Claude API)** — receipt photo is sent to Anthropic for verification.
  - Supabase (storage of the receipt image and the resulting verdict/extracted fields, EU).
- **International transfers:**
  - **Yes** — receipt photos are sent to the **Anthropic API in the United States**.
  - PackPerks uses the standard Anthropic API: inputs are **not used for training** and are **not
    retained beyond the request** (zero-retention default).
  - Safeguards: an Anthropic Data Processing Agreement and a transfer mechanism (EU–US Data
    Privacy Framework and/or Standard Contractual Clauses) are an **outstanding action** to be
    put in place / confirmed before or at adoption.
- **Retention:**
  - Receipt images: deleted **90 days after the claim is resolved**.
  - AI verdict and extracted fields: retained with the associated claim record (see Activity 2
    accounting retention where relevant to the resolved claim).
  - Anthropic does not retain the request input beyond processing (zero-retention).
- **Security measures:** Receipt images stored in a **private Supabase Storage bucket**, accessed
  only via short-lived signed URLs; RLS scoping; transmission to Anthropic over TLS; baseline
  measures.

---

## Activity 4 — Email authentication (account save / restore)

- **Purpose:** Let a customer optionally sign in with email (magic-link / OTP) to save their
  account across devices, view and add their IBAN, and change their email address.
- **Lawful basis (Art. 6):** Contract / consent — the user chooses to create a persistent account;
  authentication is necessary to provide that account-linking feature.
- **Data-subject categories:** Customers.
- **Personal-data categories:**
  - Email address.
  - Authentication events (OTP / magic-link issuance and sign-in) as handled by Supabase Auth.
- **Recipients / sub-processors:**
  - Supabase Auth (identity management, EU).
  - **Email relay** — customer email addresses (OTP / magic-link, verification, account) are sent
    through **Brevo** (formerly Sendinblue), connected to Supabase Auth as the custom SMTP provider
    (`smtp-relay.brevo.com`). Provider: **Brevo / Sendinblue SAS**; region: **EU (France)**; DPA
    status: sign Brevo's DPA in the Brevo account (verify). Because Brevo is EU-hosted, OTP /
    magic-link relay stays within the EU — the "bring your own EU SMTP provider" recommendation is
    satisfied; the remaining step is confirming the signed DPA + domain authentication (SPF/DKIM).
- **International transfers:** None specific to this activity beyond the email-delivery
  infrastructure managed by Supabase; core identity data resides in Supabase `eu-west-1`. The
  region and any onward transfer of the email relay are [FILL: email relay region] (see recipient
  line above).
- **Retention:** Email and linked account data kept while the account is active; deleted after
  24 months of inactivity; deleted on account deletion (via in-app "Data control" → delete account,
  or manual DSAR). A user can change their email from the in-app "Data control" section.
- **Security measures:** Passwordless authentication (magic-link / OTP) — no customer passwords
  stored; Supabase Auth token handling; RLS scoping account data to the authenticated user;
  baseline measures.

---

## Activity 5 — Behavioural analytics

- **Purpose:** Understand product usage to improve the app — screen views, button taps, reward
  changes, shares, and funnel events.
- **Lawful basis (Art. 6):** Consent — collected **only** where the user selects **"Accept all"**
  on the cookie banner. This processing is **non-essential**.
- **Data-subject categories:** Customers.
- **Personal-data categories:** `client_events` table — screen views, button taps, reward changes,
  shares, funnel/journey events, associated with the user's identifiers for the app's own analytics.
  No Google Analytics, Meta Pixel, or advertising trackers.
- **Recipients / sub-processors:** Supabase (database, EU). **Not** shared with partners at user
  level; partners see only aggregate figures (see Activity 8).
- **International transfers:** None — data resides in Supabase `eu-west-1`.
- **Retention:** `client_events`: **14 months**, then deleted or anonymised.
- **Consent controls / security measures:**
  - Cookie banner on first visit offers **Reject / Essential only / Accept all**. Behavioural
    analytics are collected only under "Accept all"; "Essential only" and "Reject" suppress the
    analytics pipeline.
  - The essential `device_id` and coarse device label are explicitly **excluded** from behavioural
    analytics.
  - Baseline measures (RLS, encryption at rest/in transit).

---

## Activity 6 — Fraud prevention and rate-limiting

- **Purpose:** Protect the service and the reward budget against abuse — detecting duplicate or
  fraudulent claims and rate-limiting requests (e.g. repeated scans / submissions).
- **Lawful basis (Art. 6):** Legitimate interests — protecting PackPerks and honest customers from
  fraud and abuse of the cashback mechanism.
- **Data-subject categories:** Customers.
- **Personal-data categories:**
  - `device_id` and coarse device label (used to correlate activity for integrity checks).
  - Cup scans and BYO ("bring your own") cup requests.
  - Reward claims (amount, date, status) and the AI verdict / extracted receipt fields
    (datetime, receipt ID, total, decision reason) used to detect duplicate receipts.
- **Recipients / sub-processors:** Supabase (database + Edge Functions, EU). Overlaps with the
  AI verification recipient (Anthropic) where receipt content is checked (see Activity 3).
- **International transfers:** None for the rate-limiting/fraud logic itself (Supabase EU); receipt
  content transfer to Anthropic is covered under Activity 3.
- **Retention:** Governed by the retention of the underlying records — receipt images 90 days after
  claim resolution; claim records 7 years (accounting); activity/scan data while active with
  24-month inactivity deletion.
- **Security measures:** Enforcement in **Edge Functions** (server-side, not bypassable from the
  client); RLS; baseline measures; the `device_id` is used for integrity/fraud correlation but not
  fed into behavioural analytics.

---

## Activity 7 — Admin operations and audit logging

- **Purpose:** Operate and administer the service — reviewing and resolving claims, executing
  payouts, and maintaining a security/audit trail of administrative actions and admin sign-ins.
- **Lawful basis (Art. 6):** Legitimate interests (securing and administering the service) and
  legal obligation (maintaining records adequate to demonstrate accountability and support
  investigation of security incidents).
- **Data-subject categories:** Admins (and, as data subjects of the underlying records being
  administered, Customers).
- **Personal-data categories:**
  - Admin login history.
  - Audit logs: before/after state of changed records, admin **IP address** and **user agent**.
  - IBAN export events (logged, tied to the top admin) — see Activity 2.
- **Recipients / sub-processors:** Supabase (database, EU). No partner or external recipient.
- **International transfers:** None — data resides in Supabase `eu-west-1`.
- **Retention:** Admin audit logs and login history: **12 months** (retained longer only for the
  duration of an active investigation).
- **Security measures:** Least-privilege admin roles with a distinguished **top-admin** role for
  full-IBAN visibility and payout export; all admin mutations recorded with before/after state,
  IP and user agent; IBAN export gated to the top admin and logged; baseline measures.

---

## Activity 8 — Partner aggregate reporting

- **Purpose:** Provide commercial partners (cafés / venues) with **aggregate** performance
  statistics through the admin-only dashboard.
- **Lawful basis (Art. 6):** Legitimate interests — PackPerks and its partners have a legitimate
  interest in aggregate performance reporting; because only aggregate, non-identifying figures are
  disclosed, this does not disclose personal data to partners.
- **Data-subject categories:** Customers (as the source population; only aggregates are disclosed).
- **Personal-data categories disclosed to partners:** **None at user level.** Partners receive only
  aggregate statistics (e.g. total cups, total claims, totals over a period). Partners **never**
  receive user-level histories, emails, IBANs, receipt images, or behavioural profiles.
- **Recipients / sub-processors:** Commercial **partners** receive aggregate output via the
  admin-only dashboard. Supabase (underlying data, EU).
- **International transfers:** None — underlying data resides in Supabase `eu-west-1`; only
  aggregates are surfaced.
- **Retention:** Aggregates are derived on demand from underlying records; the underlying records
  follow their own activity-specific retention (Activities 1–2, 5). No separate partner-held
  personal-data store is created by PackPerks.
- **Security measures:** Aggregation performed server-side; the dashboard is **admin-only**; the
  design ensures partners cannot pivot from an aggregate to an individual; baseline measures.

---

## Activity 9 — Platform infrastructure logs (Supabase)

- **Purpose:** Operate, secure and troubleshoot the hosting platform. Separately from `client_events`
  analytics and from the application-level admin audit logs (Activity 7), Supabase infrastructure
  logs (the **API gateway** and **Postgres logs**) may record IP addresses and request metadata at
  the **platform level**. This is processor-side operational logging, not something PackPerks
  configures per request.
- **Lawful basis (Art. 6):** Legitimate interests — operating and securing the hosting platform.
- **Data-subject categories:** Customers and admins (whoever makes a request that hits the platform).
- **Personal-data categories:** IP address and request metadata (e.g. timestamp, path, status) as
  captured in Supabase's API-gateway and Postgres logs. Note: unlike `client_events`, which store
  **no IPs**, these platform logs may contain IP addresses.
- **Recipients / sub-processors:** **Supabase** — processor, under its DPA; region `eu-west-1`.
- **International transfers:** None beyond Supabase's EU-region processing (`eu-west-1`); any onward
  support access is covered by the Supabase DPA (see `DPA_STATUS.md`).
- **Retention:** [FILL: Supabase infra-log retention period — confirm with Supabase].
- **Access:** [FILL: who can access Supabase infra logs].
- **Security measures:** Held within the Supabase platform under its DPA and access controls;
  separated from the application analytics pipeline (which stores no IPs); baseline measures.

---

## Data-subject rights

Customers can exercise their rights through the in-app **"Data control"** section (edit or delete
specific data, reset device, delete account) and via a **manual DSAR email** to PackPerks. Requests
are actioned by the PackPerks Privacy Owner.

## Review

This record is maintained by the **PackPerks Privacy Owner** and reviewed on adoption and whenever
processing changes materially (new sub-processor, new data category, change of transfer mechanism,
or change of retention period). Outstanding action at adoption: confirm the Anthropic DPA and the
EU–US DPF / SCC transfer mechanism for Activity 3.
