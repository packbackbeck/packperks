# PackPerks — EU + UAE Compliance Pack

**Date:** 20 July 2026 · **Scope:** the combined EU (GDPR) + UAE (PDPL) PackPerks app.
**Status key:** ✅ done · 🟡 partial · ⛔ blocked on the **UAE payout-provider decision** · 📄 doc/decision owner is legal/ops.

> Working artifacts, not legal advice. These progress the plan in `PackPerks-DualRegion-DataProtection-Plan.md`. Items that depend on which UAE payout provider we pick (Aani-style instant-proxy vs Ziina/Mamo-style link) are marked ⛔ because the data we collect and the processor contract change with that choice.

---

## Phase status (the plan's P0 / P1 / P2)

### P0 — before any UAE user data is collected
| # | Task | Status |
|---|------|--------|
| 1 | Region-aware currency + payout routing (no wrong-currency payouts) | ✅ done (region registry + `uae-payout` seam) |
| 2 | Provider-neutral customer payout copy (no "Tikkie" in UAE) | ✅ done (`collectLabel` per region) |
| 3 | Region-aware **privacy notice** (controller, transfers, complaint route) | 🟡 hooks in place (region registry); UI wiring pending |
| 4 | Cross-border **transfer register** + in-app disclosure | ✅ register below; in-app UAE disclosure 🟡 |
| 5 | Just-in-time notice before receipt upload | ✅ exists (receipt page note) |
| 6 | Just-in-time notice before **payout identifier** (IBAN / phone / QR) | ⛔ we don't yet know which identifier the provider needs |
| 7 | No bank data in localStorage | ✅ already true |

### P1 — before a paid UAE pilot
| # | Task | Status |
|---|------|--------|
| 8 | **ROPA** (record of processing) | ✅ below |
| 9 | **Breach runbook** | ✅ below |
| 10 | **DPIA-lite** | ✅ below |
| 11 | Processor/DPA tracker | 🟡 `DPA_STATUS.md` covers Supabase/Anthropic/Brevo/Tikkie; **UAE provider DPA** ⛔ |
| 12 | Retention/deletion jobs verified | 🟡 schedule exists (`RETENTION_SCHEDULE.md`); confirm jobs run |
| 13 | Named privacy owner | 📄 legal/ops decision |

### P2 — hardening / scaling
| # | Task | Status |
|---|------|--------|
| 14 | Admin PII redaction (mask payout identifier to last-4) | ⛔ depends on identifier type |
| 15 | Self-service DSAR export/delete | 🟡 manual mailto works today |
| 16 | Jurisdiction decision (mainland UAE vs DIFC vs ADGM) | 📄 legal decision |
| 17 | Regional data segregation | 📄 defer unless UAE residency is mandated |

---

## Record of Processing (ROPA)

| Purpose | Data | Basis (EU / UAE) | Processor(s) | Transfer | Retention |
|---|---|---|---|---|---|
| Cup progress | device id, org id, cup count, timestamps | contract / consent | Supabase (EU) | — | while active; anonymise after inactivity |
| Save account | email, auth id | contract / consent | Supabase (EU) | — | until deletion |
| Service email | email, claim status | contract necessity | Brevo | EU→? per Brevo | life of claim + support |
| Marketing email | email, marketing consent | **consent only** | Brevo | as above | until withdrawn |
| Receipt verification | receipt image, reward item | contract + fraud prevention | Supabase (EU) | UAE→EU | delete ~90d after decision |
| AI receipt check | receipt image, AI verdict | contract + notice | Anthropic (US) | UAE/EU→US | not retained by us beyond claim |
| Cashback payout | payout amount, currency, **payout identifier** | contract necessity | Tikkie (NL) / **UAE provider ⛔** | UAE→provider | mask/delete after payout + support window |
| Fraud / rate limiting | device id, claim history, timestamps | contract / legal claims | Supabase (EU) | — | limited |
| Analytics | session id, event names, device context | **consent** | Supabase (EU) | — | 6–12 months then aggregate |
| Admin/security logs | admin id, action, timestamps | security necessity | Supabase (EU) | — | 12 months |

**Controller:** PackBack/PackPerks. **Hosting:** Supabase `eu-west-1`. ⛔ the payout row's identifier + processor are finalised once the UAE provider is chosen.

---

## Cross-border transfer register

| From | To | Data | Purpose | EU basis | UAE basis |
|---|---|---|---|---|---|
| UAE | EU (Ireland, Supabase) | all app data | hosting | (origin EU) | contract necessity + notice |
| EU / UAE | US (Anthropic) | receipt image, verdict | AI receipt check | SCCs | notice + contract necessity |
| UAE | UAE payout provider ⛔ | payout amount + identifier | send cashback | — | contract necessity (confirm provider location + terms) |

**Action:** disclose these in the (region-aware) privacy notice for UAE users. The third row is ⛔ until the provider is chosen — most candidates keep the data in-UAE, which is favourable.

---

## Breach runbook (one page)

1. **Detect** — flag the incident (alert, report, anomaly).
2. **Contain** — revoke the exposed key / disable the endpoint.
3. **Preserve** evidence (logs, timestamps).
4. **Assess** data types touched: email, device id, receipt image, claim, payout identifier, admin logs.
5. **Estimate** affected users.
6. **Decide notification:** EU DPA within **72h** if risk to individuals; UAE **Data Office/Bureau** per Executive Regs; DIFC/ADGM commissioner if in a free zone.
7. **Notify users** if high risk.
8. **Notify processors/partners** as required.
9. **Fix + verify**, document corrective action.
Owner: privacy owner (backup: eng lead). Keep a short incident log.

---

## DPIA-lite

- **What:** loyalty app processing receipt photos, device ids, behavioural events, and cashback payouts, with an AI pre-screen and cross-border transfers (EU hosting, US AI).
- **Necessity:** each data item maps to a purpose in the ROPA; nothing collected without product need.
- **Risks:** receipt images may contain incidental personal data; payout identifier is sensitive financial data; US AI transfer; behavioural profiling if analytics deepens.
- **Mitigations:** private buckets + short signed URLs; RLS + server-side payout; **AI is a pre-screen, a human decides** (satisfies EU Art. 22 + UAE automated-decision rules); consent-gated analytics; short retention; **store no bank details** (recipient-supplies-identifier model — provider-dependent ⛔); mask payout identifier in admin ⛔.
- **Residual:** cross-border transfers (documented + based); ⛔ payout-identifier handling pending provider.
- **Re-do trigger:** automating the reject decision, adding fraud profiling, large-scale sensitive data, or entering DIFC/ADGM.
