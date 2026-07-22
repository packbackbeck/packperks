# PackPerks — Combining Regions: What Changed + Risk Analysis

**Date:** 20 July 2026
**Subject:** merging the separate regional groups (BYO NL, BYO UAE) into **one BYO programme where region is a per-vendor attribute**.
**Purpose:** a plain record of what changed / was added / removed, an honest look at what's still unfinished, and what could go wrong.

---

## 1. The change in one line

Before, a "group" doubled as a region (`byonl`, `byouae`). Now there is **one BYO programme**, and each vendor carries a **region** (derived from `organizations.country`). The region decides the vendor's **currency**, **map focus**, **payout provider**, and payout wording. All of this is driven by a code registry (`regions.js`) that an admin can extend at runtime.

---

## 2. What we ADDED

| Area | Added |
|---|---|
| Region model | `src/lib/regions.js` — the registry (currency, symbol, locale, map centre, payout provider, collect label) with code defaults **+ an admin overlay** merged in at boot |
| Currency | `formatMoney`/`formatCurrency` (Intl); `RegionContext` (`useMoney`/`useRegion`) provided above `<App/>` |
| Payments | `src/lib/payments.js` — payout-provider registry + `providerForRegion`; **generic `uae-payout` edge function** (link + proxy models, AED, provider slots, "not configured" until credentialed) |
| Admin | `RegionsPanel` (add/edit regions, payout-provider-per-region, assign vendors), region chip on each org, multi-region toggle per group; `getRegionsConfig`/`saveRegionsConfig`/`setOrgRegion`/`setGroupMultiRegion` |
| Future vendors | 50 real UAE "coming soon" venues under the `AE` key (ids, coords, brand colours, logos) |
| Domain | `appUrl.js` (canonical URL for QRs); multi-origin CORS on `share-cups` |
| Docs | multi-region plan, dual-region data-protection plan, UAE compliance pack, payments summary, vendor form, domain checklist |

## 3. What we CHANGED

| Area | Changed |
|---|---|
| Region resolution | Removed the **slug regex** (`/uae|dubai/…`) — region now comes from `organizations.country`; onboarding country → the customer's focus region |
| Currency display | ~10 customer money components now use `useMoney()` instead of a hardcoded `€` (EUR still renders identically via `Intl`/`en-IE`) |
| Stores hub | Vendors ordered **chosen-region-first**; coming-soon venues from **all** regions, chosen region first |
| Map | Opens **zoomed on the chosen region** but plots **every** region's pins (zoom out to see the others) |
| Payments | Admin approval routes to the payout provider for the claim's region (NL → Tikkie unchanged; AE → `uae-payout`; unknown → "not configured", never wrong-currency) |
| Copy | The customer "collect your cashback" button is region-aware — no "Tikkie" shown in the UAE |
| Data plumbing | `getGroupStores` rewards now carry `id` + `bgColor` (so the market's in-review card shows the reward picture + name) |

## 4. What we REMOVED

- The **slug-as-region** assumption everywhere.
- The hardcoded per-component `€` (in the customer app).
- The implicit "payout = Tikkie" wiring (now provider-routed).
- The per-claim `pc-notify--static` note (unrelated cleanup).

## 5. What we deliberately did NOT do (by design)

- **No DB group merge yet.** Region is derived from `organizations.country`, so no `organizations.region` column and no data migration were needed. The empty `byouae` group still exists in the database and `byonl` was not renamed.
- **No `claims.currency` / `claims.payout_provider` columns.** Currency/provider are derived at payout time from the org's region.
- **UAE payout provider not chosen.** `uae-payout` is a complete seam but returns "not configured" until a provider + secrets are set.

---

## 6. What's still LEFT (gaps)

### 🔴 Must fix before a UAE vendor goes live
1. **Mixed-currency totals.** The customer **combined-account** cashback (`App.jsx` `combinedCashback`) and the **admin** Reports / Overview / Donations still sum amounts into **one number regardless of currency**. Once an AED vendor exists, `€ + AED` get added together with no error — silently wrong. Needs per-currency subtotals + currency-aware admin formatting.
2. **UAE payout provider** — pick one, fill the `uae-payout` slot, set secrets, deploy. Until then no UAE cashback can actually be paid.
3. **Per-org economics in AED.** `create-claim` uses the org's `cashbackRatePerCup` as a bare number. A UAE org left on the €1.25 default would pay 1.25 **AED**/cup (wrong economics). Each AE org must set its rate in AED.
4. **Region-tag data migration.** The region key changed from `'UAE'` → `'AE'`. Existing `store_requests.region` rows (and any analytics tagged `region`) are `'UAE'`; new ones are `'AE'`, and `vendor_request_counts(p_region:'AE')` won't match the old rows. Backfill or alias.

### 🟠 Before scaling / polish
5. **Region-aware payout emails.** The cashback email is EUR + says "Tikkie"; `uae-payout` sends no email. UAE needs its own (provider-neutral) email path.
6. **Copy still says "Tikkie link"** in `RewardDetailSheet` and `SuccessPage` (only the collect **button** was made region-aware).
7. **AED / Arabic rendering unverified** — `Intl('en-AE')` output ("AED 4.80") is untested with real data; **RTL/Arabic is parked**.
8. **Admin-added regions are half-supported** — currency/map/payout apply via the overlay, but `onboarding.js` COUNTRIES/CITIES is code, so a brand-new region (e.g. Saudi) can't be picked in onboarding until added there.
9. **Reward-budget / float is not per-region.** The Tikkie campaign is one EUR pool; a UAE provider has its own float; the budget monitor isn't currency/region aware.
10. **RegionsPanel not visually verified** (admin is login-gated in our environment) — build-clean and data-path-verified, but eyeball it in the console.

### 🟡 Cleanup
11. Retire the empty `byouae` group; optionally rename `byonl` → a generic slug.
12. Persist `claims.currency` + `payout_provider` for clean historical reporting.
13. External coming-soon logos (Google favicons / ui-avatars) can 404 or leak vendor domains to Google.

---

## 7. What can GO WRONG (risk register)

| # | Risk | Severity | Why / trigger | Mitigation |
|---|---|---:|---|---|
| 1 | **Mixed-currency maths** — €+AED summed as one total | High | any cross-region user or any admin report once an AED org exists | per-currency subtotals; currency-aware admin (gap #1) |
| 2 | **Wrong-currency payout** — AE claim paid in EUR via Tikkie | High | an AE vendor created with `country` unset/wrong → region defaults to NL | payout router already blocks unknown/none; **enforce `country=AE` on UAE vendors** at onboarding |
| 3 | **Region-tag split** — old `'UAE'` rows vs new `'AE'` | Medium | store-requests / analytics grouped by region show gaps | backfill `'UAE'`→`'AE'`; `getNotYetStores` already tolerates both |
| 4 | **AED economics wrong** — €1.25 default read as AED | Medium | AE org rate not reset | make currency/rate a required field for AE vendors |
| 5 | **Overlay not loaded** — admin-added region renders with defaults briefly | Low | async load of `published:regions` at boot | defaults are safe; only a first-paint flash |
| 6 | **Onboarding can't offer a new region** | Low | admin adds a region not in `onboarding.js` | document that new regions need a COUNTRIES entry |
| 7 | **Empty `byouae` group reachable** | Low | someone opens `/byouae` | retire it |
| 8 | **UAE `uae-payout` stub called** returns "not configured" | Low (by design) | approving an AE claim before a provider is set | expected; approval stands, retryable — **but a human must know it's not paid yet** |
| 9 | **External coming-soon logos fail** | Low | favicon/avatar host 404 or rate-limits | fall back to coloured initial (already the case) |
| 10 | **AED/Arabic display looks off / RTL** | Low–Med | UAE launch in Arabic | English-first launch is fine; RTL is a separate track |

### The one-liner on safety
Nothing here **breaks the live NL app** — EUR renders identically, Tikkie is untouched, and the payout router refuses to pay the wrong currency. The real danger is **silent wrongness once a UAE vendor is live**: mixed-currency totals (#1) and an under-configured AE org (#2, #4). Those are the pre-launch gate.

---

## 8. Pre-UAE-launch gate (the short list)

- [ ] Choose + integrate the **UAE payout provider** (fill `uae-payout`, secrets, deploy).
- [ ] Make **admin reporting + the combined account currency-aware** (no cross-currency sums).
- [ ] Make **currency + per-cup rate required** when onboarding an AE vendor; enforce `country = AE`.
- [ ] **Backfill** `region` tags (`'UAE'` → `'AE'`).
- [ ] Region-aware **payout email** + finish the "Tikkie" → provider-neutral copy.
- [ ] Eyeball the **RegionsPanel** in the live admin and confirm **AED rendering** with a real AE org.

Everything else (RTL/Arabic, group rename, `claims.currency` column, float-per-region) is post-launch improvement.
