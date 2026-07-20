# PackPerks — Dual-Region (EU + UAE) Data-Protection Plan

**Date:** 20 July 2026
**Trigger:** PackPerks is now one multi-regional app (NL/EU + UAE in a single BYO programme), so it must satisfy **both GDPR (EU) and the UAE PDPL** (and DIFC/ADGM if a pilot sits in a free zone).
**Status:** plan only — no code changes here. Source: the UAE requirements memo + the current codebase.

> Working document, not legal advice. Confirm the UAE operating entity + jurisdiction (mainland PDPL vs DIFC vs ADGM) with counsel before a paid UAE launch.

---

## 1. What PackPerks already has (the GDPR baseline)

The app is already built GDPR-first, which is most of the UAE work:

- **Granular consent** (`src/lib/consent.js`): technical / analytical / marketing, versioned (`CONSENT_POLICY_VERSION`), withdrawable; analytics (`client_events`) is consent-gated; marketing is a separate opt-in mirrored to `users.marketing_consent`.
- **Policy docs**: `PRIVACY_POLICY.md`, `COOKIE_POLICY.md`, `RETENTION_SCHEDULE.md`, `DPA_STATUS.md`.
- **DSAR route**: `info@packback.network` with an in-app mailto flow (UserPage), self-service delete of earned cups.
- **Just-in-time note** before receipt upload ("processed by an AI provider in the US, not used to train models, deleted after review").
- **AI is a pre-screen only** — a human makes the final claim decision (satisfies both GDPR Art. 22 and UAE PDPL automated-decision rules).
- **Payout minimisation**: Tikkie's model means the customer enters their **own IBAN** in Tikkie; PackPerks stores **no bank details**. (A dormant IBAN-collection model exists but is not wired.)
- **Security**: Supabase RLS, server-side payout edge functions, private receipt/scan buckets + short signed URLs, admin roles.
- **Hosting**: Supabase `eu-west-1` (EU). AI receipt check: Anthropic (US). Email: Brevo.

**Implication:** ~80% of the UAE PDPL "must-haves" are already met by the GDPR build. The remaining work is UAE-specific *framing, disclosure, and paperwork* — not a rebuild.

---

## 2. GDPR ↔ UAE PDPL — where they overlap (satisfy once, cover both)

| Obligation | GDPR | UAE PDPL | PackPerks status |
|---|---|---|---|
| Lawful basis / consent | Art. 6 | Art. 4/5 (consent-first + contract necessity) | ✅ mapped (contract for cups/claims/payout; consent for analytics/marketing) |
| Transparent privacy notice | Art. 13–14 | §5.4, §11 | ✅ have one — needs UAE additions (§4) |
| Data minimisation + retention | Art. 5 | §5.4, §12 | ✅ RETENTION_SCHEDULE; verify deletion jobs run |
| Security (encryption, access, resilience) | Art. 32 | §5.11 | ✅ RLS, signed URLs, roles |
| DSAR rights (access/rectify/erase/restrict/port/object) | Art. 15–21 | §5.9 | ✅ manual mailto flow |
| Automated-decision safeguards + human review | Art. 22 | §5.10 | ✅ AI pre-screen, human decides |
| Breach notification | Art. 33–34 | §5.7 | ⚠️ runbook to formalise |
| Processor agreements (DPA) | Art. 28 | §5.6 | ⚠️ DPA_STATUS exists; extend per §5 |
| Records of processing (ROPA) | Art. 30 | §5.5 | ⚠️ formalise as a processing record |
| Cross-border transfer basis | Ch. V (SCCs) | §5.13 | ⚠️ add UAE→EU / →US basis + disclosure |
| DPIA / DPO triggers | Art. 35/37 | §5.8, §5.12 | ⚠️ DPIA-lite + named privacy owner |

**Reading:** everything with ✅ already covers *both* regimes. The ⚠️ rows are the actual to-do list.

---

## 3. What I would implement to comply (UAE-specific gaps, prioritised)

Because the app is now **region-aware** (each vendor has a region → currency/provider/map), I'd make privacy **region-aware too**, reusing the region registry rather than bolting on a parallel system.

### P0 — before any UAE user data is collected
1. **Region-aware privacy notice.** Extend the region registry / a `legal` block per region with: the **controller identity**, **cross-border transfer disclosure**, **rights wording**, and **complaint route** (EU: the lead supervisory authority; UAE: the **UAE Data Office/Bureau**, or DIFC/ADGM commissioner). The app already knows the active region, so it can serve the right notice + complaint contact automatically.
2. **Cross-border transfer register + in-app disclosure.** Document and disclose the two hops that now originate in the UAE:
   - UAE → **EU (Ireland, Supabase)** for storage.
   - UAE/EU → **US (Anthropic)** for receipt AI.
   Add the UAE transfer basis (contract necessity + explicit notice/consent) alongside the existing EU→US SCCs.
3. **Just-in-time notices, region-aware.** Keep the receipt note; add an **IBAN/payout note** that appears only when a UAE payout provider that collects bank details is used (none today — Tikkie is EU-only and stores nothing). Surface the AI + transfer note at receipt upload for UAE users.
4. **Confirm no localStorage bank data** (already the case) and keep the recipient-supplies-IBAN model for the UAE provider too.

### P1 — before a paid UAE pilot
5. **Processing record (ROPA)** — one table: purpose, data category, lawful basis, access role, processor, transfer, retention, security. Serves GDPR Art. 30 **and** UAE §5.5 (and ADGM ROPA).
6. **DPA / processor tracker** — extend `DPA_STATUS.md` to confirm terms with Supabase, Anthropic, Brevo, Tikkie, **and the chosen UAE payout provider** (sub-processors, retention, breach notice, deletion).
7. **Breach runbook** (one page) — detect → contain → assess → notify (EU DPA within 72h *and* UAE Bureau per Executive Regs) → notify users → evidence log.
8. **DPIA-lite** — one doc covering receipt photos + AI + payout + device IDs + behavioural events + transfers. Required-ish under both GDPR Art. 35 and UAE §5.12 given the data mix.
9. **Named privacy owner** (internal DPO-equivalent) — full DPO only if UAE scale/sensitive-data/high-risk-profiling triggers hit.
10. **Retention enforcement** — confirm receipt/scan deletion jobs actually run; cap `client_events` (6–12 months) and payout exports (delete after confirmation), per RETENTION_SCHEDULE.

### P2 — hardening / scaling
11. Region-scoped **admin redaction** (mask IBAN to last-4, limit who sees receipts) — one control satisfies both.
12. Self-service DSAR export/delete (currently manual mailto — fine for MVP).
13. Jurisdiction decision record (mainland UAE vs DIFC vs ADGM) — changes the notification/forms, not the app.

---

## 4. Trade-offs

- **EU-central hosting + documented transfers, vs UAE-local hosting.** The PDPL does **not** require UAE-local storage for a normal loyalty app, so I'd **keep Supabase `eu-west-1`** and document the UAE→EU transfer. Trade-off: simplest now, but a DIFC/ADGM/sector rule or a UAE partner could later demand local residency → forces **regional data segregation** (see §5). Cheaper today, possible re-architecture later.
- **Region-aware privacy content vs one global notice.** Region-aware is more correct (right controller, transfers, complaint route per user) but adds maintenance (two legal blocks to keep current). Worth it once UAE is live; a single combined notice is acceptable only as an interim.
- **Consent-gated analytics.** Keeping analytics behind consent (already the case) reduces behavioural data coverage but satisfies the stricter-of-both — I'd keep it.
- **Manual DSAR/breach handling.** Cheap and MVP-appropriate; the trade-off is speed/consistency at scale. Fine until volume grows.
- **Payout provider choice.** Sticking to a "recipient supplies their own IBAN" provider (Tikkie-style) keeps PackPerks storing **zero** bank data — the single biggest risk-reducer under both regimes. Trade-off: depends on such a provider existing for AED; if the only UAE option makes us collect IBANs, we inherit the doc's P0 IBAN controls (tokenise, restrict, log, delete exports).

---

## 5. Does the UAE work contradict EU law?

**Short answer: no hard contradiction.** UAE PDPL is GDPR-inspired, so complying with the **union of both** (take the stricter requirement each time — usually GDPR) satisfies UAE too. The obligations **stack**, they don't collide. Specifics:

- **Transfers stack, not conflict.** GDPR restricts data leaving the EU; UAE restricts data leaving the UAE. A UAE→EU→US flow just needs a valid basis at **each** hop (contract necessity + notice for UAE; SCCs for EU→US). More paperwork, no contradiction.
- **Automated decisions, marketing, minimisation, security, retention, DSAR** — substantively the same direction in both; the GDPR implementation already satisfies UAE.
- **Jurisdiction split** (mainland UAE vs DIFC vs ADGM vs EU) means different regulators/forms/complaint routes, but the substantive rules are compatible — handled by region-aware notices, not by changing behaviour.

**The one genuine tension to watch — data localization / sovereignty.** If a UAE regulator (a free zone like DIFC/ADGM, or a financial-sector rule tied to IBAN/payout data) requires UAE-resident storage, that **conflicts with the current EU-centralised model** and with GDPR's preference to keep EU personal data in the EU. Resolving it means **segregating data by region** (UAE data in a UAE/appropriate store, EU data in the EU) rather than one shared Supabase project — a real architectural change. Related, lower-order concern: **government lawful-access** powers differ between jurisdictions, so where data physically sits is also a governance decision, not just a technical one.

**Recommendation:** for the MVP/pilot, keep one EU-hosted store, document the transfers, and treat **regional data segregation as the pre-scale decision** — trigger it only if a UAE jurisdiction/partner mandates residency. That keeps EU and UAE compliant simultaneously today without over-building.

---

## 6. Concrete next steps (if you approve)

1. Add a **per-region `legal` block** (controller, transfer text, complaint route, rights) to the region registry, and make the privacy notice + DSAR/complaint contact **region-aware** in the app.
2. Write the four docs: **ROPA**, **cross-border transfer register**, **breach runbook**, **DPIA-lite** (templated; small).
3. Extend `DPA_STATUS.md` with the UAE payout provider + confirm AI/Brevo/Supabase/Tikkie terms.
4. Verify the retention/deletion jobs run (receipts, scans, exports, analytics cap).
5. Record the **jurisdiction decision** (mainland vs DIFC vs ADGM) and name a **privacy owner**.
6. Defer **regional data segregation** unless a UAE residency requirement appears.
