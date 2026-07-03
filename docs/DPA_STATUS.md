# PackPerks — Sub-Processor & DPA Status / Action List

**Privacy owner:** [FILL: privacy owner name] · **Contact:** support@packback.network · **Last updated:** 2026-07-03

**Last updated:** (to be dated on adoption)
**Owner:** PackPerks Privacy Owner

---

## 1. Purpose

This document is the authoritative register of PackPerks' sub-processors and the current status of the Data Processing Agreement (DPA) and international-transfer safeguards for each. PackPerks is the **sole controller** for all personal data processed in the reusable-cup loyalty/cashback service. Every entity listed below is a **processor** acting on PackPerks' documented instructions; none is granted user-level access for its own purposes.

The service is operated from the EU (Netherlands) and also serves users in the UAE. All primary data is stored in the Supabase EU region (`eu-west-1`). The only routine transfer outside the EU is receipt-image processing by Anthropic in the United States (see §2, Anthropic).

**Status of this register at adoption:** every sub-processor below is marked **ACTION: obtain/verify signed DPA**. No DPA should be treated as in place until the signed copy is filed and the transfer mechanism is confirmed in writing.

---

## 2. Sub-Processor Register

| # | Sub-processor | Service to PackPerks | Personal data shared | Region / hosting | DPA status | Transfer mechanism | No-training / no-retention confirmation | Action | Owner | Due |
|---|---------------|----------------------|----------------------|------------------|------------|--------------------|------------------------------------------|--------|-------|-----|
| 1 | **Supabase (EU)** | Core data platform: Postgres database, Auth, Storage (private buckets, signed URLs), Edge Functions | Effectively all service data: optional email, random display name, IBAN (restricted payout table), `device_id`, coarse device label, per-store cup balances, activity history, cup scans, BYO cup requests, reward claims (amount/date/status/last-4), AI verdicts + AI-extracted receipt fields, receipt & cup-scan images, `client_events` analytics, admin audit & login logs | EU — `eu-west-1` | **To sign** | Intra-EU — no transfer safeguard required (data stays in EU region); SCCs only if any onward US support access exists | To confirm in writing: no use of PackPerks data for Supabase's own purposes or model training; retention limited to PackPerks-configured lifecycle | ACTION: obtain/verify signed DPA; confirm EU-region processing and sub-processor list; confirm any support-tier access is EU or SCC-covered | PackPerks Privacy Owner | (to be dated on adoption) |
| 2 | **Vercel** | Static hosting / CDN for the React/Vite SPA and edge delivery | No first-party application personal data is stored on Vercel (all data lives in Supabase). Processes request metadata incidental to serving the SPA: IP address, user agent, request logs. No analytics/tracking pixels are served. | US-headquartered; global edge/CDN | **To sign** | SCCs and/or EU-US Data Privacy Framework (DPF) certification — to be verified for the account's edge/log processing | To confirm in writing: request/edge logs not used for training or advertising; retention limited to Vercel's standard log window | ACTION: obtain/verify signed DPA (Vercel DPA); confirm SCC/DPF coverage for edge log processing; confirm no analytics/ads features enabled | PackPerks Privacy Owner | (to be dated on adoption) |
| 3 | **Anthropic (US)** | AI receipt verification — receipt photos sent to the Claude API for verdict + field extraction | Receipt photos (images) and the extracted fields returned (datetime, receipt id, total, decision reason). No email, IBAN, `device_id`, balances or behavioural data are sent. | United States | **To sign** | SCCs and/or EU-US Data Privacy Framework (DPF) — required as this is the one routine EU→US transfer | **Standard Anthropic API default:** inputs are **not used for model training** and are **not retained beyond the request** (zero-retention default). This default must be **confirmed in writing** in the signed DPA / commercial terms. | ACTION: obtain/verify signed Anthropic DPA; confirm in writing the standard-API no-training + zero-retention default and that no data-retention/logging add-on is enabled; confirm SCC/DPF transfer mechanism | PackPerks Privacy Owner | (to be dated on adoption) |
| 4 | **Supabase email (OTP / magic-link infrastructure)** | Delivery of email one-time passcodes and magic-link sign-in emails for optional account save/restore | Recipient email address; OTP / magic-link token; delivery metadata | Supabase-managed email infrastructure (verify region and any underlying email sub-processor) | **To sign** | Covered under the Supabase DPA (§1); verify whether an underlying email delivery sub-processor sits outside the EU and, if so, that SCC/DPF applies | To confirm in writing: email content and addresses not used for training or marketing; retention limited to delivery/deliverability needs | ACTION: obtain/verify signed DPA coverage for email delivery; identify and confirm any underlying email sub-processor and its region/transfer mechanism | PackPerks Privacy Owner | (to be dated on adoption) |

---

## 3. Data-minimisation notes that constrain what each sub-processor sees

These controller-side decisions limit the personal data any sub-processor can access and should be reflected when reviewing each DPA:

- **IBAN isolation.** IBANs are consolidated into a single restricted payout table reachable only by Edge Functions. IBANs are masked everywhere else, only the top admin can view a full IBAN, and the raw IBAN is **deleted** once the admin has exported and confirmed that claim's payout. Only the last-4 is retained on the claim record for accounting (7 years, NL). Sub-processors never receive full IBANs except transiently within the Supabase-hosted payout flow.
- **Partners are not sub-processors.** Store/venue partners receive **only aggregate statistics** via the admin-only dashboard — never user-level histories, emails, IBANs, receipts or behavioural profiles. No partner-facing DPA is required because no personal data is disclosed to partners.
- **Anthropic scope.** Only receipt images and their extracted fields leave the EU; identity, payout and behavioural data are never sent to the US.
- **Behavioural analytics** (`client_events`) are non-essential and collected only under "Accept all" consent. No Google Analytics, Meta Pixel or advertising sub-processors are used.

---

## 4. Action summary

| Priority | Action | Owner | Due |
|----------|--------|-------|-----|
| 1 | Obtain/verify signed **Supabase DPA**; confirm EU-region (`eu-west-1`) processing, current sub-processor list, and SCC coverage for any non-EU support access | PackPerks Privacy Owner | (to be dated on adoption) |
| 2 | Obtain/verify signed **Anthropic DPA**; confirm in writing the standard-API **no-training + zero-retention** default and SCC/EU-US DPF transfer mechanism; confirm no data-retention/logging add-on is enabled | PackPerks Privacy Owner | (to be dated on adoption) |
| 3 | Obtain/verify signed **Vercel DPA**; confirm SCC/EU-US DPF coverage for edge/log processing and that no analytics/ads features are enabled | PackPerks Privacy Owner | (to be dated on adoption) |
| 4 | Verify **Supabase email** delivery is covered by the Supabase DPA; identify any underlying email sub-processor, its region, and its transfer mechanism | PackPerks Privacy Owner | (to be dated on adoption) |
| 5 | Maintain a filed copy of each signed DPA and record the confirmed transfer mechanism and no-training/no-retention wording against each entry above; re-verify on renewal or on any sub-processor change | PackPerks Privacy Owner | (to be dated on adoption) |

---

## 5. Review

This register is reviewed on adoption, on any change of sub-processor, on DPA renewal, and at least annually. All updates are recorded by the PackPerks Privacy Owner, who owns the "Last updated" date above.

---

## 6. Email relay sub-processor (OTP / magic-link)

Customer email addresses (for OTP / magic-link sign-in) are sent through the **email sender used by Supabase Auth**. This is a distinct relay step to pin down, because it determines which provider and region actually handle the outbound email:

- **Provider:** [FILL: Supabase default email sub-processor or your custom SMTP provider]
- **Region:** [FILL: email relay region]
- **DPA status:** [FILL: email relay DPA status]

**Recommendation.** Bring your own **EU SMTP provider with a signed DPA** so the region where OTP / magic-link emails are relayed is certain and contractually covered, rather than relying on the default Supabase-managed sender whose underlying email sub-processor and region should be verified (see register row 4). This pairs with the matching recipient line in `ROPA.md` (Activity 4).
