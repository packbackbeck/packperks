# PackPerks → Multi-Regional App — Architecture Analysis & Integration Plan

**Goal:** turn PackPerks from *one group per region* (BYO NL, BYO UAE) into **one BYO programme where region is an attribute of each vendor**, so the app adapts currency, payment provider, and (later) language per region.

*Analysis + plan only — nothing here has been executed.*

---

## 1. How it works today (the parts this change touches)

**Groups ARE regions.** A "store group" (`org_groups`) currently conflates two ideas: the *programme* (BYO) and the *region* (NL vs UAE). Reality in the DB right now:

| Group (`org_groups`) | Members | `organizations.country` |
| --- | --- | --- |
| `byonl` — "BYO NL" | La Place, The Chocolate Company | `NL` |
| `byouae` — "BYO UAE" | *(none — empty)* | – |

- **Routing:** `main.jsx` branches on the URL path; a group slug (`/byonl`) → the Stores hub / customer app for that group. One org resolves to exactly one group via `organizations.group_id`.
- **Group context:** `getGroupContext(orgId)` ([src/lib/groups.js](src/lib/groups.js)) returns the group, its `mode` (`deposit`|`byo`), the group config (`app_config` key `published:group:<groupId>`), and the member orgs. The Stores hub shows **all members of the group**.
- **Identity & balances:** one shared customer identity spans the whole group; balances are **per-store** (`cup_balances`, keyed by `org_id`). So a person already can hold separate balances at multiple venues.
- **Region is inferred, not stored:** `App.jsx:1605` does `/uae|dubai|emirat|abu\s*dhabi/i.test(group.slug + group.name) ? 'UAE' : 'NL'`. That region only feeds the "coming soon" curated list (`getNotYetStores`, [src/lib/notYetStores.js](src/lib/notYetStores.js)) and the store-request tag.
- **`organizations.country`** exists (text, `'NL'`) but is not used for currency or payment.
- **Currency is hardcoded `€`** in 30+ files (customer + admin). No central formatter, no `Intl.NumberFormat`. Examples: `PendingClaims.jsx` `const money = n => €${...}`, admin reports/overview/onboarding-wizard, reward editors, refund pages, EPOS print.
- **Payout assumes EUR:** `create-claim` computes `payout_amount = cups × rate` (rate from org settings, e.g. €1.25/cup); `tikkie-cashback` converts `amountInCents = payout_amount × 100` and posts to the **Tikkie Cashback API (EUR, ABN AMRO)**. There is **no `currency` on `claims`** and **no provider abstraction** — Tikkie is called directly.
- **No i18n.** UI copy is inline English; reward names are Dutch (e.g. "Verse sinaasappelsap"). `copyPresets.js` supports per-*mode* copy (deposit/byo) but not per-*locale*.
- **Onboarding already knows countries:** `onboarding.js` has `COUNTRIES` (incl. 🇦🇪 UAE) and `CITIES`, used to score/prioritise venues.

**Takeaway:** the data model is *closer* than it looks — `organizations.country` and per-store balances already exist — but three things are hard-wired to a single region: **currency (`€`), payment (Tikkie), and the "group = region" routing.**

---

## 2. Target model

**One programme, region as a first-class attribute.**

```
Group: "BYO" (one)
 └─ Vendor (organization)  ── region: "NL" | "AE" | …
                              country: "NL" | "AE"
 Region registry (NL, AE, …) ─→ { currency, locale(s), paymentProvider, countries[] }
```

A **region** resolves everything region-dependent:

| Region | Currency | Payment provider | Locale(s) | Coming-soon list |
| --- | --- | --- | --- | --- |
| NL | EUR (`€`) | Tikkie (live) | nl-NL / en | NL vendors |
| AE | AED (`د.إ`) | *UAE provider — TBD (seam left open)* | en-AE / ar (RTL) | UAE vendors |

Everything money- or place-specific reads from the region, not from a hardcoded value or a regex on the group slug.

---

## 3. The core design decision: *what is the customer's active region?*

This is the crux — get it right and the rest is mechanical. Options, and the recommendation:

- **Anchor region to the venue (recommended).** The customer enters by scanning a venue's counter QR → that org has a `region` → the whole session (currency, payment, copy, hub filter) follows `venue.region`. Persist it as the identity's **home region** so return visits and direct hub entry keep working.
- **New / direct entry (no venue):** resolve region from, in order: persisted home region → onboarding country → geolocation → an explicit region chooser. Onboarding already collects country, so this is a small hop.
- **Hub scoping:** the multi-venue Stores hub filters to the active region (a NL user shouldn't see AED cafés on their map, and balances of two currencies can't be summed). Offer an explicit "switch region" only if we later want cross-region browsing.

**Cross-region identity (must decide):** one identity can legitimately collect in two regions (a NL user travels to Dubai). Since balances are already per-store, this is fine at the data layer — but the **account "combined balance" view must show per-region / per-currency subtotals, never a single mixed total.** Recommendation: keep one identity, group balances by region in the UI, and scope the active hub to the current venue's region.

---

## 4. Work breakdown — change / add / remove

### 4.1 Data model
- **ADD** `organizations.region` (text, e.g. `NL`/`AE`) — the explicit "region tag" the pivot calls for. (`country` stays as supporting data; region can default from country during backfill.)
- **ADD** a **region registry** — a small mapping of region → `{ currency, currencyLocale, locales, paymentProvider, countries }`. Start as a code constant (`src/lib/regions.js`) for velocity; promote to a table only if non-engineers must edit it.
- **ADD** `claims.currency` (text, default `EUR`) and `claims.payout_provider` (text, default `tikkie`) — so every payout records what currency it was and who paid it. Critical for reporting once two currencies coexist.
- **CHANGE / MERGE** the two groups into one BYO group; **REMOVE** the now-redundant `byouae` (it's empty, so this is low-risk) and relabel `byonl` → a generic BYO group. Backfill `region` on every org.
- **REMOVE** the "group slug = region" assumption everywhere.

### 4.2 Currency layer
- **ADD** one currency formatter: `formatMoney(amount, currency, locale)` using `Intl.NumberFormat`. Single source of truth.
- **CHANGE** all ~30 hardcoded `€` sites (customer + admin) to call it with the region's currency. This is the largest *mechanical* task — grep for `€`, `toFixed(2)`, and the per-component `money` helpers.
- **CHANGE** payout amount semantics: `payout_amount` becomes currency-aware. Note AED has fractional units too (fils, 2 decimals), so `× 100` cents math is fine for AED; but **do not assume the provider takes "cents"** — the UAE provider's amount format is TBD, so the amount→provider conversion must live in the provider adapter, not in shared code.
- **CHANGE** rates/caps: `cashbackRatePerCup` / `refundRatePerCup` / reward `euros` / reward-budget cap are all per-org numbers — they keep working, but the UI must label them in the org's currency (rename the field concept from "euros" to "amount" over time).

### 4.3 Payment routing (leave the UAE seam open)
- **ADD** a provider abstraction: a `payout` dispatcher keyed by region/provider, with a common contract (`createPayout`, `getStatus`, redemption webhook, `getFloatBalance`). Tikkie becomes **one adapter behind it**; the current `tikkie-cashback` logic moves largely unchanged.
- **ADD** a **UAE adapter stub** implementing the same contract but returning "not configured" until a provider is chosen (this is the "leave space" the pivot asks for). The admin approve flow calls the dispatcher, which picks the adapter from `org.region`.
- Region → provider comes from the region registry. NL keeps Tikkie exactly as-is; nothing about the live NL payout changes.
- Note (from the earlier payout analysis): the repo also has **dormant IBAN scaffolding** (`payout` edge fn + `payout_details`/`payout_exports` tables). If the UAE provider ends up being "collect IBAN + batch payout," that scaffolding is a head start; if it's a Tikkie-style link, the adapter is thin.

### 4.4 Region-scoped experience
- **CHANGE** the Stores hub to filter members by active region; the map, "nearby," and coming-soon list already key off region (`getNotYetStores`) — feed them the resolved region instead of the regex.
- **CHANGE** onboarding: country → region (map via the registry), and use it to seed the customer's home region.
- **REMOVE** `App.jsx:1605` regex region inference; replace with `activeOrg.region` (+ persisted home region).
- **CHANGE** account/combined view to show per-region balance sections (see §3).

### 4.5 Admin
- **CHANGE** the Org Onboarding Wizard to set **region + currency** per vendor (today it sets € rates with no currency).
- **CHANGE** Reports / Overview / Donations / Reward-budget monitor to be **currency-aware** — aggregate per currency/region, never sum mixed currencies into one €total.
- **CHANGE** group management UI: a vendor now belongs to the single BYO group **and** carries a region tag (instead of being placed in a regional group).

### 4.6 Internationalisation (recommend: parking lot, phased)
- Today: English UI + Dutch content, no i18n library. UAE realistically needs **English + Arabic**, and **Arabic is RTL** — that's a layout project (mirroring the whole UI), not just string translation. This is the single most expensive strand.
- **Recommendation:** park full i18n. Ship multi-region on **English-everywhere** first (UAE can launch in English). Do i18n as a later, self-contained track:
  1. Introduce a locale on the region + a tiny string catalog; externalise customer-facing strings (`copyPresets` is already the natural home — extend it from per-mode to per-mode-per-locale).
  2. Add Arabic copy.
  3. Add RTL layout support (the big one) — treat as its own milestone.
- If we want *some* i18n now with low effort: make the currency/date/number formatting locale-aware (free once `Intl.NumberFormat` is in) and keep copy English. That gets "feels localised" without the RTL cost.

---

## 5. Suggested sequencing (each phase ships safely; NL never breaks)

- **Phase 0 — Data model, no behaviour change.** Add `organizations.region`, `claims.currency` + `payout_provider` (defaults EUR/tikkie), and the region registry. Backfill NL. Everything still behaves exactly as today.
- **Phase 1 — Currency layer.** Add `formatMoney`; replace the ~30 `€` hardcodes; make admin currency-aware. Still 100% EUR, but now currency-driven.
- **Phase 2 — Merge groups + region scoping.** Collapse `byonl`/`byouae` into one BYO group; retire the regex; scope hub/onboarding/coming-soon by region; per-region account view. NL is the only live region, so this is verifiable before UAE exists.
- **Phase 3 — Payment routing.** Introduce the provider dispatcher; move Tikkie behind it; add the UAE adapter **stub**. NL payout unchanged.
- **Phase 4 — First UAE vendor.** Choose + integrate the UAE provider (see the separate payout analysis: recipient-supplies-IBAN link vs. collect-IBAN batch; note **UAE = AED, not SEPA**), set the vendor's region/currency, go live.
- **Phase 5 — i18n / Arabic / RTL (parking lot).** Only after multi-region is stable.

Phases 0–2 can proceed immediately and are low-risk (NL-only, no new provider). Phase 4 is gated on the UAE payment decision, which is the real external dependency.

---

## 6. Things easy to miss
- **Mixed-currency totals.** Any admin or customer view that sums cashback must partition by currency. This bug is silent (numbers just look wrong).
- **Tikkie float is per-region.** The prepaid Tikkie campaign is EUR-only; the UAE provider has its own funding pool. The reward-budget/funds monitor must track them separately.
- **Reward-budget cap currency.** The per-org cap is a bare number today; it must be interpreted in the org's currency.
- **Receipts & rewards are region-flavoured** (Dutch item names, € prices on receipts). AED receipts and Arabic item names arrive with UAE vendors — the AI receipt check (`verify-receipt`) must tolerate non-EUR receipts and (eventually) Arabic text.
- **Email/formatting locale.** Cashback emails hardcode `€` and English — they'll need the currency + (later) locale.
- **`notYetStores` is already region-keyed** (NL/UAE) — good; it just needs the real region instead of the regex.
- **Legal/consent per region.** GDPR (NL) vs UAE data rules; terms and the "we never store bank details" claim may differ by provider/region.

---

## 7. What gets removed
- The `byouae` group (empty) and the "one group per region" concept.
- The regex region inference at `App.jsx:1605`.
- Hardcoded `€` literals (replaced by the currency layer).
- The implicit "payout provider = Tikkie" wiring (replaced by the region→provider dispatcher).

---

## 8. Open questions to lock before building
1. **Region resolution** — confirm "anchor to venue + persisted home region + onboarding fallback" (§3).
2. **One identity across regions?** Yes (per-store balances already support it) — confirm the per-region account view.
3. **UAE provider** — the gating external decision; needed for Phase 4 (AED, not SEPA).
4. **i18n scope** — confirm English-first launch, RTL/Arabic parked.
5. **Region registry location** — code constant now, or a DB-editable table for ops?
