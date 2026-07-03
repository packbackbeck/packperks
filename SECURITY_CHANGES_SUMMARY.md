# PackPerks — Security & Privacy Changes Summary

Master status document for the PackPerks security & privacy work. Order:
**1) EU/UAE requirements → 2) problems found → 3) changes made → 4) compliance
documents → 5) what's still left.** Companion documents live in `docs/`; the
deep remediation plan is in `SECURITY_PRIVACY_REMEDIATION.md` and the full
per-problem analysis in `SECURITY_PER_PROBLEM_SOLUTIONS.md`.

_Scope assumes the MVP stores IBANs and pays cashback manually (no Tikkie yet).
Data lives in Supabase Postgres (`eu-west-1`); receipt images are processed by
the Anthropic API in the US for AI verification._

---

## 1. Requirements — EU (GDPR) & UAE (PDPL)

**EU — GDPR (primary; data is stored in the EU / Supabase eu-west-1):**
- **Lawful basis** for every purpose (Art. 6) → `docs/LAWFUL_BASIS.md`.
- **Transparency / notice** at collection (Art. 12–14): a real privacy policy +
  just-in-time notices where email/IBAN/receipts are collected.
- **Data-subject rights** (Art. 15–22): access, rectification, erasure, export/
  portability, objection, restriction.
- **Security of processing** (Art. 32): least-privilege access (RLS), encryption
  in transit, restricted PII, audit logging.
- **Storage limitation / minimisation** (Art. 5): defined retention + deletion.
- **Processors & transfers** (Art. 28, 44–49): signed DPAs; EU→US transfer
  (Anthropic) needs SCC/DPF + no-training/no-retention.
- **ROPA** (Art. 30) and a **DPIA** for high-risk processing (Art. 35).
- **Breach notification** within 72h (Art. 33–34).
- **Consent** for non-essential cookies/analytics (ePrivacy + GDPR).

**UAE — PDPL (if serving UAE users):**
- **Cross-border transfer basis** + notice (data in EU, receipts to US).
- **Data-subject rights** (access/correction/deletion) + a route to exercise.
- **DIFC / ADGM** free-zone check per operating entity/partner (may add rules).
- Clear **privacy notice** covering EU storage + US AI processing.
→ `docs/UAE_CROSS_BORDER.md`.

---

## 2. Problems found (the 45-item audit)

Full detail in `SECURITY_PER_PROBLEM_SOLUTIONS.md`. Root cause: a **serverless
SPA where anonymous customers write directly to Postgres with the public anon
key**, which forced permissive RLS and scattered PII. The criticals:

- **1** permissive anon RLS exposes PII · **2** anon can write `claims` · **3**
  IBAN in 3 tables · **4** IBAN in localStorage · **5** no role gate on admin
  IBAN view · **6** manual payout unmapped.
- **High:** DPAs (7), Anthropic US transfer (8), UAE transfer (9), stale privacy
  policy (10), no in-app notice (11), lawful basis (12), DSAR (13), retention
  (14–16), analytics consent (17–18), device/behavioural profiling (19–21),
  ROPA (22), DPIA (23), breach runbook (24), controller role (25), partner
  access (26).
- **Medium / lower (27–45):** admin-log retention (27), audit-log PII (28),
  signed-URL hygiene (29), platform IP logs (30), email relay (31), `app_config`
  exposure (32), duplicate-identity scrub (33), localStorage reset (34), payout
  retention (35), AI-derived data (36), fraud purpose-limitation (37), UAE
  wording (38), DIFC/ADGM (39), privacy owner (40), internal handling (41),
  payout-export deletion (42), payout timing explainer (43), IBAN-refusal
  fallback (44), lottery/profiling risk (45).

---

## 3. Changes made

### A. Implemented in the app (client — built & verified in the browser)

| # | Change | Where |
|---|--------|-------|
| 17,18 | **Cookie consent banner** (Reject / Essential only / Accept all), PackPerks-styled; **Reject → blocked page** (cups already earned are kept); consent stored in `packperks_cookie_consent`. | `CookieConsent.jsx/.css`, `ConsentGate.jsx`, `lib/consent.js`, `main.jsx` |
| 17,18 | **Behavioural analytics gated** — `client_events` are persisted ONLY with "Accept all". Essential-only/rejected users are never tracked. | `utils/analytics.js` |
| 10,11,12,8 | **In-app Privacy & cookie policy** viewer (renders the policy; admin-editable text) + **just-in-time notices** at email, IBAN and receipt collection (incl. the US AI-transfer + no-training + deletion note). | `PrivacyPolicyView.jsx/.css`, `UserPage.jsx`, `ReceiptPage.jsx` |
| 10 | Privacy policy text **editable in Admin → Settings → Legal** (`settings.privacyPolicyText`), falls back to the bundled default. | `admin/settings/AdminSettings.jsx`, `App.jsx` |
| 1,21 | **Email masking** (first+last letter) with tap-to-reveal; IBAN already masked (dots + last-4). | `UserPage.jsx` |
| 13,19,21,34 | **Data & privacy control** on the account page: view policy, manage cookie choices, export my data (DSAR), delete saved IBAN, reset this device, delete my account. | `UserPage.jsx/.css` |
| 43 | **Payout + retention explainer at IBAN entry** — states cashback arrives in 1–2 business days and the IBAN is kept only until payout is confirmed, then deleted (last-4 retained). | `ClaimPanel.jsx/.css` |
| 44 | **"What is IBAN?" explainer** in the reward sheet (what an IBAN is, that cashback needs one) with a **"Donate my cups"** CTA (turtle icon) so a customer without an IBAN can donate instead of taking cashback. Wired to the existing donate flow. | `RewardDetailSheet.jsx/.css`, `App.jsx` |

### B. Deployed to Supabase (project `ozvcpbthnauitaphosfb`, eu-west-1)

Applied/deployed against the live project and column-verified against the real
schema, **except migration 029**, which is intentionally held (see §5).

| # | Change | Status | File |
|---|--------|--------|------|
| 3,6,16,35 | `payout_details` table (IBAN in one restricted place, RLS on = service-role only), `claims.payout_id/iban_last4`, `confirm_payout_and_purge_iban()` (deletes the raw IBAN after payout, keeps amount/date/last-4). | Applied (migration `028`) | `supabase/migrations/028_payout_details_and_retention.sql` |
| 14,15,16,27 | **Retention jobs** (pg_cron): receipts 90d, scans 90d, analytics 14mo, admin logs 12mo. Cron `packperks-data-retention` runs 03:15 daily. | Applied + cron live | same 028 migration |
| 2 | **`create-claim`** — the only claim writer; server-forces `status='pending'` + amount. | Deployed (`verify_jwt=false`) | `supabase/functions/create-claim/index.ts` |
| 3,5,6 | **`payout`** — customer `save` IBAN; top-admin `export`/`reveal`/`confirm` (IBANs only for `admin_profiles.role='owner'`; reveals audited to `admin_action_log`). | Deployed (`verify_jwt=true`) | `supabase/functions/payout/index.ts` |
| 13 | **`delete-account`** — erases the person's data across all their stores + images; anonymises retained financial records. | Deployed (`verify_jwt=false`) | `supabase/functions/delete-account/index.ts` |
| 33 | **`admin-merge-users` + `merge-by-email`** — absorbed accounts become linkage-only tombstones: email / IBAN / `device_id` / parsed device / `display_name` all nulled. | Deployed | `supabase/functions/admin-merge-users/index.ts`, `supabase/functions/merge-by-email/index.ts` |
| 8,BYO | **`verify-receipt`** — BYO/per-venue-aware (real venue name in the prompt; BYO leniency), standard Anthropic API (no training / zero retention). | Deployed (`verify_jwt=false`) | `supabase/functions/verify-receipt/index.ts` |
| BYO | **`byo-mint`** — per-store daily cap from `app_config` `byo:cap:<org>`. | Deployed (`verify_jwt=false`) | `supabase/functions/byo-mint/index.ts` |
| 1,2 | **RLS lockdown** — anonymous-auth + owner-scoped policies, staff-gated admin writes, drop anon receipt SELECT. | **HELD — not applied** (would break the live app; needs client anonymous sign-in first — see §5) | `supabase/migrations/029_privacy_rls_lockdown.sql` |

### C. Reviews, confirmations & decisions

- **25** PackPerks = sole controller; partners get aggregate stats only.
- **26** Partner data is admin-dashboard-only (fine as-is).
- **20** Device label is an essential signal, kept, not used for stats.
- **4** IBAN is not in localStorage in the current build (confirmed) — closed.
- **29 Signed-URL hygiene:** the `receipts` and `cup-scans` buckets are **private
  with no anon SELECT** — only `service_role` (the AI function) and authenticated
  admins can read; customers upload only. The operational rule (short-lived URLs,
  never pasted into chat/logs) is in `docs/INTERNAL_DATA_HANDLING.md`. Follow-up:
  narrow `receipts: authed select` to admins-only once anonymous sign-in lands.
- **32 `app_config` review:** it holds only published customer-facing config
  (rewards + group mode/copy) — **no secrets, IBANs, emails or partner terms**.
  Publish-only rule recorded. Safe as public-read.
- **34 Reset device:** shipped in the Data & privacy control ("Reset this device").
- **35 Payout retention:** keep amount/date/`iban_last4`, purge the raw IBAN on
  payout confirmation (migration 028).
- **36 AI-derived data:** `ai_verdict` + extracted receipt fields are covered by
  DSAR export and deletion; they die with the claim, while the claim record
  itself (amount/date/last-4/status) is retained as proof — `docs/RETENTION_SCHEDULE.md`.
- **37 Fraud purpose-limitation:** fraud/rate-limit signals are used only for
  fraud & security, firewalled from marketing — `docs/LAWFUL_BASIS.md`. Policy
  text only; **no feature is disabled.**
- **45 Lottery/profiling:** no "Lucky Cup"/targeting features exist; revisit the
  DPIA before adding any — `docs/DPIA_LITE.md`.

**Note on receipt AI vs. manual review (item 29 context):** the `verify-receipt`
AI **classifies**; the admin verifies by hand. For BYO venues it rejects only a
photo that isn't a receipt at all — every real receipt goes to the admin queue.
For the original non-BYO deposit flow it can additionally auto-complete a very
high-confidence receipt (≥0.92) and auto-reject a clear fail, with everything
ambiguous sent to manual review. If non-BYO should also be admin-decides-only,
that is a one-line change to `decideStatus`.

---

## 4. Compliance documents (`docs/`)

Each document below needs a small number of **inputs** filled in before adoption
— every blank the PackPerks team must supply is marked with the exact token
`[FILL: …]`, so they are greppable and countable. Totals are the count of
`[FILL:]` tokens per file.

| Document | What it is | Why we need it | Inputs to fill |
|---|---|---|---|
| `PRIVACY_POLICY.md` | The customer-facing privacy policy (rendered in-app), incl. the UAE section. | GDPR Art. 12–14 transparency + UAE PDPL notice. | **3** |
| `COOKIE_POLICY.md` | Storage/cookie & telemetry disclosure. | ePrivacy + consent for non-essential analytics. | **2** |
| `LAWFUL_BASIS.md` | Purpose → legal-basis map, incl. the fraud purpose-limitation statement. | GDPR Art. 6 (a basis for every purpose). | **2** |
| `RETENTION_SCHEDULE.md` | Retention & deletion schedule, incl. AI-derived data and payout-export deletion. | GDPR Art. 5 storage limitation. | **4** |
| `ROPA.md` | Record of Processing Activities, incl. Supabase platform IP logs and the email relay. | GDPR Art. 30. | **8** |
| `DPIA_LITE.md` | Risk assessment for financial data + receipts + AI + profiling, incl. the no-lottery note. | GDPR Art. 35. | **2** |
| `BREACH_RUNBOOK.md` | 72-hour breach detect→notify runbook. | GDPR Art. 33–34. | **2** (+ per-incident form blanks) |
| `DPA_STATUS.md` | Processor/DPA tracker (Supabase, Vercel, Anthropic, email relay). | GDPR Art. 28 processor terms. | **5** |
| `UAE_CROSS_BORDER.md` | UAE cross-border transfer basis + the DIFC/ADGM free-zone applicability check. | UAE PDPL + free-zone laws. | **5** |
| `INTERNAL_DATA_HANDLING.md` | Internal staff rule: no PII in Slack/screenshots/sheets; exports only via the sanctioned tool; short-lived signed URLs. | GDPR Art. 32 organisational measure. | **4** |

**Total: 37 `[FILL:]` inputs** to complete across the ten documents. The single
most common one is the privacy owner's name + contact (item 40), which repeats
across the set. `BREACH_RUNBOOK.md` additionally contains per-incident form
blanks to complete when an incident actually occurs.

Non-document companions (analysis, no fill-ins): `SECURITY_PRIVACY_REMEDIATION.md`
(ranked remediation plan) and `SECURITY_PER_PROBLEM_SOLUTIONS.md` (per-problem
breakdown of all 45 items).

---

## 5. What's still left to do

### The sequence that finishes the criticals (items 1–3)
The owner-scoped RLS lockdown (migration 029) is written but **must not be
applied yet** — the live customer app is anonymous and still relies on the
permissive policies. Order of operations:

1. **Adopt Supabase Anonymous Sign-in in the client** so every visitor has an
   `auth.uid()` stored on `users.auth_user_id`. Prerequisite for owner-scoped RLS.
2. **Switch the client to call the deployed Edge Functions** — route claim
   creation through `create-claim` and IBAN saves through `payout` (remove the
   direct `claims` insert and `users.iban` write). The functions are live but
   **dormant** until the client calls them, so no customer behaviour has changed.
3. **THEN apply migration 029 (RLS lockdown)** on a branch DB, smoke-test the
   customer + admin flows, and promote. Its `is_staff_admin()` helper must first
   be adapted to the real schema (`admin_profiles.id = auth.uid()` + `role`, not
   `auth_user_id`/`is_owner`). This is the step that actually closes items 1 & 2.

### Supabase advisor follow-ups (informational)
- `payout_details` / `payout_exports` show "RLS enabled, no policy" — **intended**
  (service-role-only; the Edge Functions use the service key).
- Pre-existing `SECURITY DEFINER` / `search_path` / permissive-policy warnings on
  older objects fold into the 029 lockdown work.

### Paperwork / process
- **Fill the 37 `[FILL:]` inputs** across the `docs/` set — starting with naming a
  **privacy owner** (item 40), the most-repeated input.
- Sign/verify **DPAs** (Supabase, Vercel, Anthropic, email relay) — `docs/DPA_STATUS.md`.
- Confirm **Anthropic no-training + zero-retention** + DPF/SCC in writing (item 8).
- Adopt + date the privacy policy, ROPA, DPIA, breach runbook, retention
  schedule, lawful-basis, cookie policy, UAE notice, internal handling rule.
- Decide **DIFC/ADGM** applicability per operating entity/partner (item 39).
- Confirm the **email relay** sub-processor + region (item 31) and **Supabase
  platform-log** retention/region (item 30) — both marked `[FILL:]` in the docs.

### Product follow-up
- **Item 44** is partially addressed: customers without an IBAN can now **donate**
  instead. A full non-cash *reward* alternative (voucher/credit) is still product
  work if a non-donation option is wanted.
