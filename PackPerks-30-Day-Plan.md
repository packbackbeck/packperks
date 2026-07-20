# PackPerks Pilot Plan

**Period:** 15 July – 31 August 2026
**Owner:** Beka
**Product:** PackPerks "Bring Your Own cup" (BYO) programme
**Pilot group:** `byonl` — La Place + The Chocolate Company (Netherlands)
**Stack:** React 19 + Vite front-end · Supabase (Postgres + Auth + Edge Functions, project `ozvcpbthnauitaphosfb`, eu-west-1) · Tikkie Cashback API (payouts) · Brevo (transactional email). No separate app server — all backend logic runs in Supabase Edge Functions.

---

## 1. Main objective

Prepare, launch and improve the PackPerks BYO pilot, starting with one venue and expanding only once the customer flow, payouts, tracking and venue operations are proven stable and measurable.

Because PackPerks moves **real money** (cashback via Tikkie), "stable" means: cups credit reliably, claims are reviewed and paid, payout funds don't run dry, and every step is observable in data before we scale.

---

## 2. My responsibilities

* Polish the full BYO customer and venue experience (scan → collect → claim → get paid).
* Verify the Netherlands **Tikkie** payout integration end-to-end, including funding and the redemption webhook.
* Lead selection and testing of a **UAE payout alternative** (Tikkie is Netherlands-only — see §7).
* Define, instrument and monitor the product + user-behaviour data needed to judge the pilot.
* Run customer and venue support during launch.
* Produce the **vendor onboarding guide** (what a café must provide to go live).

---

## 3. How PackPerks is instrumented (what we can actually measure)

Two independent data sources, both already live:

**A. Behavioural events — `client_events` table** (via `src/utils/analytics.js`). Fired on the front-end and written **only when the user grants analytics consent** (cookie banner). Existing events include:
`app_loaded`, `screen_view`, `account_opened`, `add_cups_opened`, `scan_attempted`, `cup_added`, `reward_shown`, `reward_selected`, `reward_card_opened`, `reward_claim_attempted`, `reward_claim_success`, `direct_refund_opened`, `withdraw_all_cups`, `share_cup`, `store_requested`, `terms_opened`, `howto_opened`, and the onboarding set (`onboarding_screen_viewed / cta_clicked / country_selected / city_selected / completed`).

**B. Server-side truth — Postgres tables** (authoritative, not consent-gated):
* `cup_balances` — `balance`, `lifetime_cups` per user/store.
* `claims` — `status` (pending/completed), `type` (cashback/direct_refund), `payout_amount`, `payout_status`, AI verdict columns (`ai_*`), `tikkie_url`, `tikkie_cashback_id`, `tikkie_status` (created/redeemed/expired), `tikkie_expires_at`, `tikkie_redeemed_at`, `notified_at`, `created_at`, `org_id`, `reward_id`.
* `users` / identity — one shared identity across the group; `org_id` on every row means **everything is measurable per store**.
* `activity_history`, `app_config`, `organizations`, `locations`.
* Tikkie **campaign balance** (`tikkie-cashback` → `campaign` action) — remaining prepaid funds.
* Global impact (`getGlobalImpact`) — grams of plastic avoided.

> **Key consequence:** the *behaviour funnel* (scan → reward → claim attempt) comes from `client_events`; the *money funnel* (claim → approve → mint → redeem) comes from the `claims` table. The claims funnel is 100% reliable regardless of cookie consent.

### Instrumentation gaps to close in Week 1
1. **Analytics consent coverage.** `client_events` needs analytics opt-in, so "complete tracking" can't reach 95% unless opt-in does. Measure the opt-in rate first, then set realistic behavioural-coverage targets; lean on server tables for anything critical.
2. **No explicit failure events.** We log `scan_attempted` and `cup_added` but not a typed `scan_failed`/reason. Derive failures as `scan_attempted` without a following `cup_added`, and capture scan-error codes (e.g. `already_claimed`) — or add a lightweight failure event.
3. **Redemption tracking depends on the Tikkie webhook.** `tikkie_status` only becomes `redeemed` if the `tikkie-webhook` subscription is registered (`subscribe` action). Confirm it's live, or redemption rate and time-to-redeem are blind.
4. **Push notifications are not functional yet.** The "Reward push notifications" toggle captures intent, but there is no push sender (no VAPID keys / `push_subscriptions`). **Email (Brevo) is the only working notification channel** — do not set push-based KPIs this pilot.
5. **Funnel dashboard.** The admin Reports module exists (with PDF export), but the pilot needs saved SQL/queries or a small dashboard for the funnels in §6. Build these in Week 1.

---

## 4. Pre-launch configuration checklist (PackPerks-specific)

These are real setup steps this system requires — verify each before the first venue goes live:

**Payments (Tikkie / NL)**
* [ ] Tikkie campaign **funded** (prepaid pool has enough for expected payouts).
* [ ] Tikkie secrets set in Supabase Edge Function env: `TIKKIE_API_KEY`, `TIKKIE_APP_TOKEN`, `TIKKIE_API_BASE_URL`, `TIKKIE_API_CAMPAIGN_URL`.
* [ ] Redemption **webhook subscribed** (`tikkie-cashback { action: "subscribe" }` → points at `tikkie-webhook`).
* [ ] Per-org **reward budget cap** set (so a runaway spend pauses rewards instead of overspending).
* [ ] Smoke test: read-only `campaign` action returns `status: ACTIVE` + remaining funds.

**Email (Brevo)**
* [ ] `BREVO_API_KEY` + sender domain configured with **SPF/DKIM** so cashback emails land in inbox, not spam.
* [ ] Paste all six branded Supabase Auth templates into the dashboard (confirm-signup, invite, magic-link, change-email, reset-password, reauthentication). *(The cashback-ready email ships via the deployed edge function.)*

**Venue setup (per store)**
* [ ] Counter **QR printed** (admin Cup-QR generator) and placed at the till.
* [ ] Store **brand colour, logo, location coordinates, rewards** published in `app_config`; verify the store home renders in the right brand colour and the map pin is correct.
* [ ] BYO copy (deposit vs bring-your-own wording) reviewed for the venue.
* [ ] Daily cup cap (currently 2 cups / 24h, extra held for review) confirmed with the venue.

**Compliance (NL / GDPR)**
* [ ] Cookie/analytics + marketing-consent flows working; DSAR contact (`info@packback.network`) live.
* [ ] "We never ask for bank details" holds — customer supplies IBAN inside Tikkie, we store none.

---

## 5. Timeline

### 15–21 July — Product & data readiness
* Walk and polish the full BYO journey: onboarding → scan/add cup → progress → pick reward → claim → receipt → approval → collect via Tikkie.
* Fix critical usability, copy and error-state issues (scan errors, budget-paused, daily-cap review, claim rejection).
* Verify each funnel step fires the right `client_events`; confirm rows land in `client_events`.
* Stand up the funnel queries/dashboard (§6) from the `claims` + `cup_balances` tables.
* Set up the support process and issue log.

### 22–31 July — Integration & launch prep
* **Tikkie NL end-to-end:** fund campaign → approve a test claim → link mints → redeem a small real cashback → confirm `tikkie_status` flips to `redeemed` via the webhook.
* **UAE payout:** shortlist and test a Tikkie alternative (see §7) with the PackBack team.
* Test the three journey outcomes: **success, failed (AI-rejected / expired link), interrupted** (abandoned scan, closed app mid-claim).
* Finish the vendor onboarding guide + venue staff instructions.
* Run the §4 checklist for venue #1; confirm launch-ready.

### 1–4 August — First venue launch
* Launch at venue #1; be on-site to watch the real customer + staff journey.
* Work live with PackBack team + venue staff to resolve launch issues.
* Monitor in real time: scans, cup credits, reward progress, claims, AI verdicts, admin approvals, Tikkie mints, redemptions, errors, and **campaign funds remaining**.
* Push online fixes where possible (front-end deploys; edge-function redeploys for backend).
* Exit gate: **zero unresolved critical issues** before the vacation period.

### 5–19 August — Vacation & remote monitoring
* Monitor performance and critical issues remotely (dashboard + Supabase logs).
* Stay reachable on the online customer/venue support channel.
* Review analytics + behaviour remotely; watch Tikkie funds and redemption rate.
* Ship urgent online updates; escalate anything needing on-site or deeper technical work.

### 20–31 August — Improvement & controlled expansion
* Review all pilot data + support issues.
* Fix the top problems from launch; improve the customer journey, venue process and tracking.
* Add venues gradually, only when the expansion criteria (§8) are met.
* Deliver a short findings report + prioritised improvement backlog.

---

## 6. Success KPIs (with data source)

| KPI | Target | How it's measured |
| --- | ---: | --- |
| Critical launch scenarios tested | 100% | QA checklist (success / failed / interrupted paths) |
| Required tracking events firing | 100% | Cross-check `EVENTS` fire per step → rows in `client_events` |
| Analytics-consent opt-in rate | Measure & baseline | Consent grants ÷ sessions (`app_loaded`) — sets realistic coverage |
| Scan-to-cup success rate | ≥ 95% | `cup_added` ÷ `scan_attempted` (client) + `cup_balances` growth (server) |
| Cup-add confirmation time | < 10 s (p50) | Time between `scan_attempted` and `cup_added` (event timestamps) |
| Claim reaches an AI verdict | ≥ 98% | `claims` with an `ai_*` verdict ÷ claims submitted |
| AI pre-screen vs human agreement | Track (target ≥ 90%) | AI verdict vs final admin `status` — false-accept / false-reject rate |
| Admin approval turnaround | p95 ≤ 7 days (per terms) | `notified_at − created_at` on approved `claims` |
| Tikkie mint success (approved → link) | ≥ 99% | `claims` with `tikkie_url` ÷ approved claims; failures in `tikkie_last_error` |
| Cashback redemption rate | ≥ 80% of minted links | `tikkie_status = 'redeemed'` ÷ minted (needs webhook, §3.3) |
| Time to redeem | p50 measured | `tikkie_redeemed_at − created_at` |
| Link-expiry (unredeemed) rate | < 15% | `tikkie_status = 'expired'` ÷ minted |
| Tikkie campaign funds | Never < 1 week of runway | `campaign` action `remainingAmountInCents`; alert on threshold |
| Budget-paused incidents | 0 unplanned | Reward-budget gate / `budget_paused` occurrences |
| Unresolved critical issues before launch | 0 | Issue log |
| NL Tikkie journey tested end-to-end | Completed | Real small redemption verified via webhook |
| UAE payout alternative selected & tested | Completed | §7 decision + sandbox payout test |
| Vendor onboarding guide | Done before first expansion | Deliverable |
| Support issues documented | 100% | Support log |
| Critical support response | ≤ 30 min when available | Support log |

> Removed/renamed from the original: a single "under 15 s median journey time" — journeys differ by orders of magnitude (a cup-add is seconds; a full reward claim spans AI review + a multi-day human approval). Split into a fast **cup-add** target and separate **claim/approval** SLAs above.

---

## 7. UAE payout — the biggest unknown (flag early)

**Tikkie is Netherlands / ABN AMRO only.** The current architecture (see the "cashback link, recipient supplies their own IBAN" model) does not extend to the UAE, and the UAE is **AED, not SEPA/EUR**, so most EU payout rails (Mollie/Adyen SEPA payouts) won't cover it. This is a genuine research + integration task, not a config switch.

Two solution shapes to evaluate:
* **A. Like-for-like payout link** — a provider that mints a claimable payout where the *recipient* enters their own bank details (so we still store none). Candidates with UAE/AED reach: **Wise**, **PayPal Payouts**, **Stripe** (limited UAE payout support), or a **local UAE provider** (e.g. Ziina, PayTabs, Telr). Fit hinges on: does the recipient supply their own IBAN, and is AED/UAE payout supported?
* **B. Collect-IBAN-ourselves + batch payout** — PackPerks already has **dormant scaffolding** for this (an unused `payout` edge function + `payout_details` / `payout_exports` tables with IBAN storage and a purge routine). UAE uses IBANs too, so this could be activated and paired with a UAE-capable payout rail — but it means we'd hold bank details (added compliance).

**Action:** by 31 July, produce a one-page comparison of 2–3 candidates against these criteria (recipient-supplies-IBAN? AED support? per-payout cost on small €3–8 amounts? API + webhook? prepaid float or per-transfer?) and pick one to sandbox-test. Keep the payout layer provider-agnostic so NL (Tikkie) and UAE can coexist.

---

## 8. Pilot metrics to monitor (ongoing)

* Unique users and new-vs-returning (identity-level).
* Valid cup additions; cups collected per user (`lifetime_cups`).
* **7-day and 30-day repeat-return rate** (identity + `activity_history` timestamps).
* Cross-store collection (one identity earning at both venues — a BYO-group signal).
* Reward selection and unlock rates (`reward_selected` / cups vs goal).
* Claim → approval → redemption success rates (claims table funnel).
* Drop-off points in the behaviour funnel (`app_loaded` → `add_cups_opened` → `cup_added` → `reward_claim_attempted` → `reward_claim_success`).
* Support issues per session; performance per venue.
* Cashback paid (Σ `payout_amount` where redeemed) and plastic avoided (impact).

> A full 30-day repeat-rate read only lands **after** the first cohort has had a complete 30-day window (i.e. early September for a 1 August launch).

---

## 9. Expansion criteria

Add a new venue only when venue #1 has:
* ≥ 95% scan-to-cup success and a healthy claim→redemption funnel.
* Complete, reliable tracking (server tables solid; behaviour events firing).
* Zero unresolved critical issues.
* Sufficient Tikkie campaign runway (no budget-paused events).
* Venue staff who understand the process.
* ≥ 2 consecutive stable operating days.

---

## 10. Risk register

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Tikkie campaign runs out of funds mid-pilot | Payouts fail silently | Monitor `remainingAmountInCents`; alert threshold; per-org budget cap |
| Redemption webhook not registered | Redemption KPIs blind | Verify `subscribe` before launch (§4) |
| Brevo emails hit spam | Customers miss their cashback link | SPF/DKIM on sender domain; the link is also in-app on the "Collect via Tikkie" card |
| Low analytics-consent opt-in | Behaviour funnel undercounts | Rely on server `claims`/`cup_balances` for anything critical |
| UAE payout unresolved | Blocks UAE expansion | Decision by 31 July (§7); keep NL and UAE payout layers separate |
| AI over-approves receipts | Overspend / fraud | Human is the final approver; track AI-vs-human agreement; daily-cap review queue |
| On-site absence 5–19 Aug | Slow response to a live issue | No expansion during vacation; exit-gate at zero critical issues; escalation path defined |

---

## 11. Expected outcome by 31 August

* A functioning BYO pilot at ≥ 1 stable venue.
* A tested, funded Netherlands (Tikkie) payout flow with verified redemption tracking.
* A selected and sandbox-tested UAE payout alternative, with a provider-agnostic payout layer.
* A completed vendor onboarding guide.
* A measurable, observable pilot funnel (behaviour + money), backed by saved queries/dashboard.
* A prioritised improvement backlog and a clear, data-backed recommendation on further expansion.
