# PackPerks — Per-Problem Breakdown (all 45 audit items)

For each item: **what it is**, **why it exists** (the feature/design choice that
caused it), **solution options**, the **recommended** one (★), and **trade-offs**.
Grounded in the current code (serverless SPA + Supabase `anon` key + a few Edge
Functions). MVP assumption: IBANs are still stored and cashback is paid manually.

---

## CRITICAL — data exposure & integrity

### 1. Permissive Supabase RLS exposes customer PII
- **What:** The `anon` (public) key has broad `SELECT/INSERT/UPDATE` on customer
  tables (`users`, `cup_balances`, `activity_history`, `cup_scans`, etc.), so
  anyone with the public key can potentially read/modify email, display name,
  device data, balances and history.
- **Why it exists:** There is no backend. Customers are anonymous (no login) and
  the browser writes their rows directly, so the tables were opened with
  `using (true) / with check (true)` to make onboarding work with zero friction.
- **Solutions:**
  - **A ★** Adopt **Supabase Anonymous Sign-in** so every visitor gets a real
    `auth.uid()` with no UX change; replace blanket grants with owner-scoped
    policies (`auth_user_id = auth.uid()`).
  - **B** Move all customer writes behind Edge Functions (service_role); anon
    gets zero table grants.
  - **C** Keep anon writes but scope them with a device-id `WITH CHECK`.
- **Recommendation:** A — smallest UX change and the only option that makes
  per-row ownership genuinely enforceable.
- **Trade-offs:** A creates an `auth.users` row per visitor (add cleanup for
  abandoned ones). B is more functions + latency. C is not real security
  (device_id is client-supplied) — stopgap only.

### 2. `claims` can be inserted/updated anonymously
- **What:** Anon can `INSERT`/`UPDATE` `claims`, so a third party could forge
  refund claims or alter payout/status fields.
- **Why it exists:** The cashback claim is created client-side (no server), so
  the browser was given claim-write permission.
- **Solutions:**
  - **A ★** A `create-claim` Edge Function becomes the **only** writer; the
    client never sets `status`/`amount`/`payout`. `verify-receipt` already runs
    as service_role and sets status server-side.
  - **B** Keep anon insert but a DB trigger forces `status='pending'` and locks
    server-owned columns.
- **Recommendation:** A — one function + small client refactor; removes the whole
  class of tampering.
- **Trade-offs:** A adds a function and a latency hop. B still lets anon spam-
  insert rows and trigger logic is more fragile than a function boundary.

### 3. IBAN stored in three places
- **What:** IBAN lives in `users.iban`, `customer_identities.iban`, and
  `claims.iban` — larger breach blast-radius and harder deletion.
- **Why it exists:** Per-store profiles + multi-org identity + per-claim payout
  each captured the IBAN where they needed it, so it got duplicated.
- **Solutions:**
  - **A ★** One restricted `payout_details` table (one row per identity); IBAN
    removed from the other three; claims keep only a `payout_id` + `iban_last4`.
  - **B** Keep a single column on `customer_identities` only.
- **Recommendation:** A — shrinks exposure from "3 broadly-readable tables + the
  browser" to "one table only Edge Functions can read" and centralises deletion.
- **Trade-offs:** A needs a migration + backfill and touches every IBAN read/
  write path. B is cheaper but still sits on a broadly-readable table.

### 4. IBAN cached in browser `localStorage`
- **What:** Audit says `packperks_user_profile` holds the IBAN on-device
  (unencrypted, persistent, XSS-exposed).
- **Why it exists:** Convenience — auto-fill the IBAN on repeat claims.
- **Solutions:**
  - **A ★** **Confirm it's already gone.** Current code only persists
    `packperks_device_id`; the profile/IBAN is in React state, not
    `localStorage`. If any path still caches it, remove it and add a "Clear my
    data" reset (also covers item 34).
- **Recommendation:** A — verify and close; if present anywhere, delete it.
- **Trade-offs:** None (losing auto-fill is acceptable for financial data).

### 5. No access restriction for admins viewing IBAN
- **What:** Unclear which admins can see IBANs; should be payout-admins only.
- **Why it exists:** Prototype assumption "every admin = PackPerks staff", so no
  role separation was built.
- **Solutions:**
  - **A ★** Add a `payout_admin` capability; only that role can call a
    `reveal-iban` Edge Function; everyone else sees the existing `PiiMask`.
  - **B** Never show a full IBAN in-app; expose only via the payout export.
- **Recommendation:** A — masking already exists (`PiiMask`/`AdminReceiptCheck`);
  add the role gate + one audited reveal path.
- **Trade-offs:** A needs a role field and a gated function. B makes manual
  reconciliation slightly harder.

### 6. Manual payout flow is outside the mapped system
- **What:** IBAN + payout intent are recorded, but the actual bank transfer
  happens out of band — where IBANs are exported, who sees them, and when files
  are deleted is undocumented.
- **Why it exists:** MVP pays cashback by hand; the export/payment step was never
  formalised.
- **Solutions:**
  - **A ★** Write the payout SOP + an `export-payouts` Edge Function
    (payout_admin only) that logs each export to a `payout_exports` table; files
    are time-boxed and deleted after payment confirmation.
  - **B** Keep manual export but add a written policy + a shared secure folder
    with access limited to payout admins.
- **Recommendation:** A — makes the flow auditable and enforceable.
- **Trade-offs:** A is a bit of process + one table/function. B relies on
  discipline and is weaker for audits.

---

## HIGH — legal basis, transfers & transparency

### 7. No verified DPA with Supabase, Vercel, Anthropic, email relay
- **What:** No signed/verified data-processing terms with the sub-processors.
- **Why it exists:** Providers were adopted for speed; contracts weren't papered.
- **Solutions:** **A ★** Accept/sign each provider's DPA, record region + sub-
  processors, and list them in the ROPA. **B** Replace any provider that won't
  offer an acceptable DPA.
- **Recommendation:** A — paperwork only, no code.
- **Trade-offs:** A is admin time. B is a migration you almost certainly don't
  need.

### 8. Receipt images sent to Anthropic in the US
- **What:** Receipt photos (merchant, items, totals, possibly incidental PII) go
  to Anthropic US for AI verification.
- **Why it exists:** AI receipt verification is a core feature and runs on the
  Anthropic API.
- **Solutions:**
  - **A ★** Document the transfer: DPA + SCC/DPF, confirm **no-training +
    zero-retention** (the API default), state it in the privacy notice.
  - **B** Route inference through an EU endpoint/region to remove the US transfer
    entirely.
  - **C** Do lighter checks locally (OCR) and only send flagged cases.
- **Recommendation:** A now; consider B later if EU-only becomes a requirement.
- **Trade-offs:** A is documentation. B is more infra/cost. C reduces AI quality.

### 9. UAE users → data in EU + receipts to US
- **What:** For UAE PDPL you need a documented cross-border basis + user notice;
  DIFC/ADGM free-zones may add rules.
- **Why it exists:** Single EU Supabase region + US AI, regardless of user
  location.
- **Solutions:** **A ★** Document the transfer basis + UAE notice; decide DIFC/
  ADGM applicability with the operating entity. **B** Stand up UAE-region storage
  (large change) if required.
- **Recommendation:** A — enough for launch; only do B if a UAE regulator/partner
  demands local storage.
- **Trade-offs:** A is docs. B is significant infra + data-residency work.

### 10. Privacy policy may not match the real system
- **What:** Policy is an external link that may not describe IBAN storage, AI
  verification, Anthropic/Supabase/Vercel, email relay, analytics, retention,
  rights, or manual payouts.
- **Why it exists:** Placeholder legal copy shipped ahead of the built system.
- **Solutions:** **A ★** Rewrite the policy to match actual flows and host it at
  the linked URL.
- **Recommendation:** A.
- **Trade-offs:** Writing time; must be kept in sync as flows change.

### 11. No in-app privacy notice at collection
- **What:** No just-in-time notice when users enter email, IBAN, or a receipt.
- **Why it exists:** UX focused on speed; consent/notice UI wasn't added.
- **Solutions:** **A ★** Short contextual notice at each capture point (what,
  why, who receives it, transfer, retention, deletion), linking to the full
  policy. **B** One consolidated notice on first run.
- **Recommendation:** A — GDPR expects notice *at the point of collection*.
- **Trade-offs:** A is a little extra UI. B is weaker (users forget by the time
  they enter an IBAN).

### 12. Lawful basis not documented per purpose
- **What:** No mapping of each processing purpose → legal basis.
- **Why it exists:** Never written down.
- **Solutions:** **A ★** One-page table (cup balance = contract/legit interest;
  IBAN payout = contract; receipt verification = legit interest/fraud;
  analytics = legit interest; marketing = consent; etc.).
- **Recommendation:** A.
- **Trade-offs:** None beyond the hour to write it.

### 13. No data-subject request (DSAR) process
- **What:** No route for access/correction/deletion/export/objection.
- **Why it exists:** Not built yet.
- **Solutions:** **A ★** Manual DSAR runbook: owner, request email, identity
  check, 30-day SLA, and the exact tables/buckets to export/delete. **B** Later,
  a self-service "download/delete my data" button.
- **Recommendation:** A now, B later.
- **Trade-offs:** A is manual labour per request. B is dev work but scales.

### 14. No retention/deletion schedule
- **What:** Receipts, scan images, claims, IBANs, profiles, activity, analytics,
  admin logs appear to be kept indefinitely.
- **Why it exists:** No lifecycle was ever defined; storage is cheap.
- **Solutions:** **A ★** Define a schedule + automate with `pg_cron`/scheduled
  Edge Functions. **B** Manual quarterly purges.
- **Recommendation:** A — automation is the only reliable option.
- **Trade-offs:** A needs jobs + care not to delete required financial proof
  (keep a masked ledger). B is unreliable and doesn't scale.

### 15. Receipt & cup-scan images kept indefinitely
- **What:** Even in private buckets, images shouldn't live forever.
- **Why it exists:** No deletion job after claim review.
- **Solutions:** **A ★** Auto-delete images ~90 days after the claim is resolved
  (keeps a support window). **B** Delete immediately on claim completion.
- **Recommendation:** A — balances support/disputes with minimisation.
- **Trade-offs:** A keeps images for the window. B risks losing evidence for
  late disputes/chargebacks.

### 16. Claims with IBAN kept indefinitely
- **What:** IBAN-bearing claim rows never expire.
- **Why it exists:** Same "no lifecycle" gap; also fear of losing accounting
  proof.
- **Solutions:** **A ★** Keep the financial record (amount, date, `iban_last4`)
  for the accounting/legal window; **mask/delete the full IBAN** after payout +
  support period. **B** Retain full claims for the whole accounting period.
- **Recommendation:** A — you rarely need the *full* IBAN for accounting proof.
- **Trade-offs:** A needs a masking job. B keeps a large sensitive dataset.

### 17. `client_events` analytics without a consent decision
- **What:** Behavioural telemetry is stored, but it's not decided whether it's
  essential (legitimate interest) or non-essential (needs consent).
- **Why it exists:** Product analytics were added without a privacy call (good
  news: no Google/Meta pixels).
- **Solutions:** **A ★** Classify as **essential product telemetry** under
  legitimate interest; write the LIA; add a notice + opt-out. **B** Treat as
  non-essential and gate behind a consent banner.
- **Recommendation:** A — provided it stays non-marketing (see item 37).
- **Trade-offs:** A commits you to keeping it non-marketing. B hurts data
  completeness and adds friction.

### 18. No cookie/localStorage notice
- **What:** The app uses `packperks_device_id`, onboarding/claimed flags, and
  Supabase auth/session storage with no disclosure.
- **Why it exists:** Treated as "technical storage", never surfaced.
- **Solutions:** **A ★** A short storage/telemetry disclosure (most keys are
  strictly necessary; disclose the rest). Consent only if analytics is deemed
  non-essential.
- **Recommendation:** A.
- **Trade-offs:** Minor UI; if item 17 goes the consent route, this becomes a
  banner.

### 19. Device ID = persistent pseudonymous tracking
- **What:** The random device UUID recognises a returning browser — pseudonymous
  personal data, not anonymous.
- **Why it exists:** It's how anonymous users keep their balance without login.
- **Solutions:** **A ★** Treat device_id as personal/pseudonymous: cover it in
  the notice, retention, and deletion logic; allow reset.
- **Recommendation:** A.
- **Trade-offs:** None beyond doc + a reset button.

### 20. Parsed device fingerprint / user-agent stored
- **What:** A device description (e.g. iPhone/iOS version) is stored; combined
  with device_id + behaviour + venue + time it aids identifiability.
- **Why it exists:** Admin "what device is this customer on" visibility.
- **Solutions:** **A ★** Keep only a coarse device label (not full UA), include
  it in retention/deletion. **B** Drop it entirely if it isn't used.
- **Recommendation:** A (or B if unused).
- **Trade-offs:** A slightly reduces admin insight. B loses the signal.

### 21. Behavioural history tied to user ID
- **What:** Balances + activity + scans + BYO requests + claims + analytics form
  a behavioural profile per user.
- **Why it exists:** It's the natural byproduct of a loyalty app.
- **Solutions:** **A ★** Acknowledge the profile in the notice, retention,
  access-control and deletion logic (deleting a user cascades all of it).
- **Recommendation:** A.
- **Trade-offs:** Deletion logic must be thorough (cascade + images).

### 22. No formal ROPA
- **What:** The data-flow map isn't a formal Record of Processing Activities.
- **Why it exists:** Startup speed; never formalised.
- **Solutions:** **A ★** Turn the existing data-flow doc into a ROPA (purposes,
  categories, recipients, transfers, retention, security, owner).
- **Recommendation:** A.
- **Trade-offs:** A few hours; must be maintained.

### 23. No DPIA / DPIA-lite
- **What:** No risk assessment despite financial data + receipt images + AI +
  behavioural profiling + cross-border transfers.
- **Why it exists:** Not done yet.
- **Solutions:** **A ★** DPIA-lite covering those high-risk factors before wider
  launch. **B** Full DPIA if scaling to large volumes.
- **Recommendation:** A now; B at scale.
- **Trade-offs:** Time; but it de-risks launch and surfaces gaps early.

### 24. No breach-notification runbook
- **What:** No documented 72-hour GDPR / UAE incident process.
- **Why it exists:** Not written.
- **Solutions:** **A ★** One-page runbook: detect → triage → contain → decide →
  notify authority/users → log evidence, with an owner.
- **Recommendation:** A.
- **Trade-offs:** None beyond writing + a periodic drill.

### 25. Controller/processor roles with partners unresolved
- **What:** Unclear if PackPerks is sole/joint/independent controller or
  processor per partner brand.
- **Why it exists:** Partner model is new; roles never decided.
- **Solutions:** **A ★** PackPerks = **controller** for the customer
  relationship; partners receive aggregate stats only, under a data-sharing
  addendum. **B** Joint-controller arrangement with a shared responsibility doc.
- **Recommendation:** A — simplest and matches the current data model.
- **Trade-offs:** A limits what partners get. B is more contract overhead.

### 26. Partner access model unclear
- **What:** Unconfirmed what cafés/brands can see; they must not get user-level
  histories, emails, IBANs, receipts, or profiles without a basis.
- **Why it exists:** Admin was built as single-tenant PackPerks staff; partner
  scoping isn't enforced yet.
- **Solutions:** **A ★** Enforce org-scoped RLS for partner admins (aggregate
  only) when they land (Phase 7). **B** Keep partners out of the admin entirely;
  send them periodic aggregate reports.
- **Recommendation:** A long-term; B is a fine interim.
- **Trade-offs:** A is real RLS work. B is manual reporting.

---

## MEDIUM — logs, storage, docs & edge cases

### 27. Admin audit/login logs kept indefinitely
- **What:** Admin IP, UA, before/after states, login history retained forever.
- **Why it exists:** Security logging with no retention cap.
- **Solutions:** **A ★** Retain ~12 months (longer only for an open
  investigation), then purge.
- **Recommendation:** A.
- **Trade-offs:** Slightly shorter forensic window.

### 28. Admin action logs may contain PII in before/after state
- **What:** Before/after snapshots can duplicate email/IBAN/claim/receipt data.
- **Why it exists:** Generic audit logging stores whole row states.
- **Solutions:** **A ★** Redact/mask sensitive fields in audit diffs (store keys
  changed, not raw IBAN/email). **B** Encrypt the audit payloads.
- **Recommendation:** A — don't duplicate secrets into logs.
- **Trade-offs:** A slightly reduces audit detail. B adds key-management.

### 29. Signed-URL handling needs review
- **What:** Private receipt/scan images are served via signed URLs; expiry,
  who mints them, and whether URLs leak (logs/Slack/screenshots) is unverified.
- **Why it exists:** Standard Supabase private-bucket access via signed URLs.
- **Solutions:** **A ★** Short expiry (minutes), mint server-side only, never log
  full URLs, and internal rule against pasting them in Slack/Notion.
- **Recommendation:** A.
- **Trade-offs:** Short expiry means admins re-open occasionally.

### 30. Supabase platform logs may capture IPs
- **What:** `client_events` stores no IPs, but Supabase infra logs might.
- **Why it exists:** Provider-level logging outside your schema.
- **Solutions:** **A ★** Confirm Supabase log retention/region/access and list it
  in the policy + ROPA.
- **Recommendation:** A.
- **Trade-offs:** Documentation only.

### 31. Email OTP/magic-link relay transfer — RESOLVED (Brevo EU SMTP)
- **What:** Email addresses pass through the outbound email relay for OTP /
  magic-link / invite / reset messages.
- **Status:** **DONE** — connected **Brevo** (Sendinblue SAS, EU/France) as
  Supabase Auth's custom SMTP provider (`smtp-relay.brevo.com`), so the relay
  sub-processor and region are now known and EU-resident (no US transfer for
  login emails).
- **Remaining:** sign the Brevo DPA, authenticate the sending domain (SPF +
  DKIM), and confirm the From address is on our domain. Tracked in
  `docs/DPA_STATUS.md` §6 and `docs/ROPA.md` Activity 4.

### 32. `app_config` is publicly readable
- **What:** Public read is fine today (no PII), but it must never hold secrets,
  internal contacts, private partner terms, or hidden admin config.
- **Why it exists:** The customer app reads published rewards/settings from it
  with the anon key.
- **Solutions:** **A ★** Audit its contents; split anything sensitive into an
  admin-only table/key; add a review rule.
- **Recommendation:** A.
- **Trade-offs:** Minor refactor if sensitive keys are found.

### 33. No minimisation plan for duplicate identities
- **What:** Merge scrubs some absorbed PII, but duplicate rows/old identities/
  tombstones may retain email/IBAN/device unnecessarily.
- **Why it exists:** Account-merge added later; cleanup is partial.
- **Solutions:** **A ★** On merge/tombstone, null out email/IBAN/device on the
  absorbed rows and keep only linkage. **B** Periodic job to scrub stale
  tombstones.
- **Recommendation:** A (with B as a sweep).
- **Trade-offs:** Must ensure merges are truly final before scrubbing.

### 34. No clear deletion logic for localStorage
- **What:** Users can't easily clear device_id / cached data.
- **Why it exists:** No self-service reset was built.
- **Solutions:** **A ★** A visible "Reset this device / clear my data" action
  that wipes device_id + any cached state; expire anything sensitive.
- **Recommendation:** A.
- **Trade-offs:** Resetting loses the local balance link (expected).

### 35. Payout records need accounting/legal retention logic
- **What:** Need to separate what must be kept for financial proof from what can
  be deleted/masked — especially IBAN.
- **Why it exists:** No retention split between "accounting proof" and "raw PII".
- **Solutions:** **A ★** Keep amount + date + `iban_last4` as the ledger; delete
  the full IBAN after payout + accounting window.
- **Recommendation:** A.
- **Trade-offs:** Requires the payout table split (item 3).

### 36. AI verdicts & extracted receipt data are derived personal data
- **What:** The AI extracts datetime, receipt ID, total, reasons — derived
  personal data that must be in access/deletion/retention scope.
- **Why it exists:** Byproduct of AI verification, stored on the claim.
- **Solutions:** **A ★** Include `ai_verdict`/extracted fields in DSAR export +
  deletion + retention (they die with the claim).
- **Recommendation:** A.
- **Trade-offs:** None beyond covering it in the same jobs.

### 37. Fraud/rate-limit data needs purpose limitation
- **What:** Rate-limit/fraud signals are valid, but must not be reused for
  marketing/profiling without a separate basis.
- **Why it exists:** Anti-abuse controls collect behavioural signals.
- **Solutions:** **A ★** Written purpose limitation: fraud data is used only for
  fraud/security; firewall it from any marketing use.
- **Recommendation:** A.
- **Trade-offs:** None; it's a policy constraint.

### 38. No UAE-specific privacy wording
- **What:** UAE users need clear notice re EU storage, US AI transfer, rights,
  and deletion/correction routes.
- **Why it exists:** Only GDPR-style wording exists.
- **Solutions:** **A ★** Add a UAE section/notice to the policy + in-app notice.
- **Recommendation:** A.
- **Trade-offs:** Writing time.

### 39. No decision on DIFC/ADGM applicability
- **What:** If a Dubai partner/entity is in DIFC or ADGM, mainland PDPL alone may
  be insufficient.
- **Why it exists:** Free-zone status never checked.
- **Solutions:** **A ★** Confirm each partner/entity's jurisdiction; if DIFC/ADGM,
  apply that free-zone's rules.
- **Recommendation:** A — a quick check now avoids a later surprise.
- **Trade-offs:** May add free-zone-specific obligations.

### 40. No documented internal privacy owner
- **What:** No single person owns privacy/security requests, breaches, retention,
  processor checks, partner questions.
- **Why it exists:** Small team, no formal role.
- **Solutions:** **A ★** Name one owner (no formal DPO needed at this size).
- **Recommendation:** A.
- **Trade-offs:** None.

### 41. No policy for Slack/screenshots/exports/support messages
- **What:** Staff could leak IBANs/receipts/claims via Slack, email, screenshots,
  Notion, spreadsheets.
- **Why it exists:** No internal handling rules.
- **Solutions:** **A ★** One-page internal rule: no PII in Slack/screenshots;
  exports only via the sanctioned tool; use masked values.
- **Recommendation:** A.
- **Trade-offs:** None beyond enforcement.

### 42. No payout-export deletion policy
- **What:** If IBANs are exported for payout, the export must be logged, secured,
  payout-admin-only, and deleted after payment.
- **Why it exists:** Manual payout, no export lifecycle.
- **Solutions:** **A ★** `export-payouts` logs to `payout_exports`; files
  time-boxed and deleted after payment confirmation (pairs with items 5/6).
- **Recommendation:** A.
- **Trade-offs:** A little process + a log table.

### 43. No user-facing "when will I get paid?" explanation
- **What:** Cashback timing is a trust issue; the flow doesn't explain why the
  IBAN is needed, when payout happens, or how long details are kept.
- **Why it exists:** UX never connected payout timing to the data ask.
- **Solutions:** **A ★** A short explainer at IBAN entry + a status line ("paid
  within N business days; IBAN kept only until payout + accounting window").
- **Recommendation:** A — improves trust *and* transparency at once.
- **Trade-offs:** Minor copy/UI.

---

## LOW / MEDIUM — future-proofing

### 44. No fallback if a user wants cashback but refuses IBAN
- **What:** The flow may force IBAN collection, i.e. unnecessary financial-data
  capture for users who won't share it.
- **Why it exists:** Cashback is the only redemption path.
- **Solutions:** **A ★** Add a **non-cash reward / "skip cashback"** option so
  IBAN is optional (data minimisation). **B** Voucher/credit alternative.
- **Recommendation:** A — reduces collected financial data and boosts conversion.
- **Trade-offs:** Product work to design the non-cash reward.

### 45. Reward/lottery mechanics could add profiling risk later
- **What:** Features like "Lucky Cup" or targeted re-engagement would add
  transparency/fairness/DPIA obligations.
- **Why it exists:** Roadmap ideas, not yet built.
- **Solutions:** **A ★** Do **not** add behavioural targeting until P0/P1 privacy
  work is done; when added, update the DPIA + notice and review fairness.
- **Recommendation:** A.
- **Trade-offs:** Delays those features until the base is compliant.

---

_Deploy note: every RLS/schema/Edge-Function fix above is a Supabase migration or
function deploy — apply against a branch DB, smoke-test the customer + admin
flows, then promote. See SECURITY_PRIVACY_REMEDIATION.md for the ranked plan,
the exact first RLS SQL, the IBAN-consolidation schema, and the launch checklist._
