# PackPerks in PackPulse

**Integration plan — 9 September 2026**

How to get the Overview, System Health and User Behaviour data out of PackPerks and onto a PackPulse admin's screen — and how to decide which PackPerks venue belongs to which PackPulse organisation.

Written from the PackPerks codebase and its live database. The PackPulse side was not inspected — see [What I need from you](#what-i-need-from-you).

---

## The short version: one read-only API, pulled server to server

1. PackPerks exposes **one metrics endpoint** that returns the same numbers those three pages already compute — as aggregates, never customer rows.
2. PackPulse calls it **from its server, never the browser**, holding an access key that is bound to an explicit list of PackPerks organisations.
3. The **org-to-org mapping lives in PackPulse master settings**, seeded from a discovery endpoint so a super admin picks venues from a list instead of pasting UUIDs.

The good news first: you do not have to design a payload. All three pages already produce a normalised metric shape — `{ id, label, value, numerator, denominator, band }` — so most of this work is moving an existing computation from the browser to the server, not inventing a new contract.

---

## Read this first: two things that shape the design

Both are verified against the live database. The first rules out the simplest integration; the second is a live exposure that should be closed before another consumer is added.

### 1. Org isolation is not enforced in the database — *blocks the easy option*

PackPerks scopes every admin query *in the browser*. `applyOrgFilter()` appends `.eq('org_id', …)` to each Supabase call. The row-level policy behind it does not mention the org at all — for `claims`, `users`, `cup_scans` and `cup_balances` it is effectively "is this an admin?".

```
claims: authed read  →  (current_admin()).id IS NOT NULL  OR  own rows
users:  admins read  →  (current_admin()).id IS NOT NULL  OR  auth_user_id = auth.uid()
```

**Consequence for this project:** you cannot hand PackPulse a Supabase credential and trust it to filter to one venue. Any such credential reads every organisation. The scoping has to happen server-side, inside an endpoint that decides which orgs the caller may see — which is exactly what the plan below does.

### 2. The publishable key already returns customer emails — *live exposure*

`users`, `cup_scans` and `cup_balances` each carry an `anon select` policy with the condition `true`. The anon key is not a secret — it ships inside the customer app's JavaScript bundle. I checked what it returns:

```
GET /rest/v1/users?select=email&email=not.is.null   (anon key only)
→ 200   [{"email":"gravityfallsrus1@gmail.com"}, {"email":"tinebakia@gmail.com"}, …]
→ content-range: 0-0/468        all 468 profiles readable, every org

GET /rest/v1/claims?select=id                        (anon key only)
→ 200   []                      payout data correctly blocked
```

Claims are properly protected, so no payout or cashback data leaks. But the customer list and its email addresses do. This is not caused by the integration and does not block it — it is the same class of mistake the integration must avoid, and it is worth fixing on its own. The fix is to replace those three blanket `anon select` policies with ones scoped to the requesting device, the way `claims` already is.

---

## How the two systems talk

```
  PACKPULSE                                     PACKPERKS
  ┌──────────────────────────────────┐          ┌──────────────────────────────────┐
  │  ┌────────────┐   ┌────────────┐ │  HTTPS   │ ┌──────────────┐  ┌────────────┐ │
  │  │   Admin    │──▶│  PackPulse │─┼─────────▶│ │   Metrics    │─▶│  Postgres  │ │
  │  │  browser   │   │   server   │ │  scoped  │ │   endpoint   │  │  service   │ │
  │  │ holds no   │   │  holds the │ │   key    │ │ packpulse-   │  │    role    │ │
  │  │    key     │   │     key    │ │          │ │   metrics    │  └────────────┘ │
  │  └────────────┘   └────────────┘ │          │ └──────┬───────┘                 │
  │  ┌─────────────────────────────┐ │          │ ┌──────┴───────────────────────┐ │
  │  │ Master settings · org map   │ │          │ │  Key → allowed orgs          │ │
  │  │ pulse_org → [pp_org_id, …]  │ │          │ │  packpulse_keys.org_ids[]    │ │
  │  └─────────────────────────────┘ │          │ └──────────────────────────────┘ │
  └──────────────────────────────────┘          └──────────────────────────────────┘

        Aggregates only — no emails, device ids or names cross this line
```

The browser never talks to PackPerks. That single rule is what keeps the access key out of a bundle and makes the org allow-list meaningful.

### Why not the alternatives

| Approach | Why not | When it would be right |
|---|---|---|
| **Give PackPulse a Supabase key** | Org scoping is browser-side, so any key reads every venue. It also couples PackPulse to the PackPerks schema. | Never, as things stand. |
| **Read replica / direct SQL** | Same coupling, plus PackPulse would have to reimplement metric logic that already exists — and the two would drift. | If you later want ad-hoc analysis rather than these fixed pages. |
| **Nightly push into PackPulse's own tables** | Adds a pipeline to run and backfill; numbers go stale between runs. | Worth adding *later* for long history and fast charts. |
| **Embed the PackPerks pages in an iframe** | Fastest to look at, but you inherit PackPerks auth, styling and layout, and PackPulse cannot combine the numbers with its own. | A demo this week, if the real thing is weeks away. |

---

## Access: keys that carry their own scope

PackPerks already has a proven pattern for a machine client: the smart bins authenticate with a device secret in a header, checked against `smartbin_keys`, and *that same row maps the bin to its organisation*. Pointing a bin at a different venue is a one-row change. Do the same thing here.

**PackPerks side.** A `packpulse_keys` table: `key`, `label`, `org_ids uuid[]`, `active`, `created_at`, `last_used_at`. The request carries `X-PackPulse-Key`; the endpoint resolves it to an allowed org list and intersects that with whatever was asked for. Anything outside the list is refused — not silently emptied, so a mis-mapping surfaces as an error instead of a plausible zero.

- One key per PackPulse environment, not per user. Rotate by issuing a second key and deactivating the first — the table supports both being live at once.
- Rate-limit per key using the `rate_limits` table the bin endpoints already use, so a runaway dashboard poll cannot hammer the database.
- `last_used_at` gives you a cheap answer to "is this integration actually running?" without new plumbing.

---

## The mapping problem: connecting an org to an org

This is the part most likely to go quietly wrong, because a wrong mapping still renders a believable dashboard.

On the PackPerks side an organisation is one venue — `organizations` with `id`, `name`, `slug`, `country` and an optional `group_id`. Venues that share a programme sit in an `org_groups` row; today there is one such group, "Bring Your Own", holding the BYO cafés and NYU Abu Dhabi. So a PackPulse organisation can legitimately correspond to three different things:

| Shape | Example | What to store |
|---|---|---|
| **One to one** | A single venue with its own PackPerks page. | `[org_id]` |
| **One to many** | A chain whose branches are separate PackPerks orgs. | `[org_id, org_id, …]` |
| **Whole group** | A BYO programme — members change over time. | `group_id`, resolved at read time |

Store the group id rather than a frozen list where a group is meant, otherwise a venue added next month silently goes missing from PackPulse.

**PackPulse master settings.** Super admins map each PackPulse organisation to its PackPerks counterpart. To make that safe, PackPerks exposes a second, tiny endpoint — a directory of connectable orgs returning `id`, `name`, `slug`, `country`, programme mode and group. The settings screen shows a searchable list; nobody types a UUID, and every mapping is picked from things that actually exist.

- Enforce that one PackPerks org maps to **at most one** PackPulse org, or the same cups get counted twice across two customers' dashboards.
- Show unmapped PackPulse orgs as **"not connected"**. Never as zero — a zero is indistinguishable from a venue having a bad week.
- Record who changed a mapping and when. This decides what a customer sees about their own performance, so it deserves the same audit trail as a payout.

---

## Contract: what the three pages actually hand over

These are the real metric ids in the codebase today. Each already carries a value, its numerator and denominator, so PackPulse can re-render or re-aggregate rather than trusting a single number.

### Overview — from `getAdminStats`

Counts and totals for the venue, deduplicated by person rather than by row — someone with a balance at three BYO cafés is one customer, not three.

`totalUsers` · `activeUsers (30d)` · `retentionRate` · `returningUsers` · `usersWithAnyCup` · `totalCupsCollected` · `totalCupsRedeemed` · `totalCashback` · `pendingClaims` · `pendingScans` · `failedClaims` · `rewardPopularity[]` · `cupDistribution` · `dailyCups[]`

> **Must be trimmed before it leaves.** This function currently also returns `rawUsers`, `rawClaims`, `rawScans` and `rawBalances` so the page can draw its own charts — including display names and emails. The endpoint sends the aggregates only, and the device-breakdown and top-returner panels either drop or arrive anonymised.

### System Health — from `getStatsMetrics`

Ten go/no-go metrics, each already banded `go / cond / nogo / na` against thresholds — so PackPulse can show a state, not just a percentage.

`qr_gen` · `qr_scan` · `correct_org` · `cup_count` · `uid_reg` · `completeness` · `duplicate` · `critical_err` · `stuck` · `uptime`

Redirect Refund venues (the smart-bin programme) compute a different set — `tk_mint`, `tk_mint_fail`, `tk_pending`, `tk_backup`, `tk_uptime`. The payload should name which set it is returning so PackPulse never renders an empty card for a metric that does not apply to that venue.

### User Behaviour — from `getUserBehaviourStats`

Funnel and engagement rates over a date window, each with a cumulative series for charting.

`qr_scan_receipts` · `second_scan` · `avg_second_scan` · `cup_spent` · `rewards_claim` · `active_users` · `emails_active` · `emails_input` · `changed_rewards` · `third_scan` · `rewards_share` · `donation_share` · `ignored_receipts` · `visitor_rate` · `audience_split` · `cookie_rejected` · `entry_source` · `buttons`

---

## The trap: both products already count "returns"

PackPulse's dashboard leads with **Total Returns**, **Return Rate**, **Avg Reuse Cycle** and **CO₂ Emissions Saved**. PackPerks counts cups credited to a customer's balance and rewards redeemed. These are different events: a package can come back to a bin without anyone scanning a receipt, and a cup can be credited without the packaging ever reaching PackPulse's count.

Put both on one screen under the same word and they will disagree — and the person looking at them will not know which is wrong. Two things prevent that:

- **Namespace the labels in the UI.** "PackPerks · Cups credited" next to PackPulse's own "Returns", not two things both called returns.
- **Publish a definition table** — one line per metric saying which event it counts and which system observes it. This is half a day of writing that prevents a recurring argument.

> **Decide before launch: CO₂ appears in both products.** PackPulse shows 68.8 kg saved; PackPerks computes its own figure from a flat 72 g per cup — a constant with no source recorded in the codebase, which I have flagged separately. Two different carbon numbers in one product is worse than one imperfect number. Pick which system owns CO₂ and have the other defer to it.

---

## Decisions to make once, up front

| Concern | Decision |
|---|---|
| **Time zone** | PackPulse displays Amsterdam time; PackPerks buckets by UTC calendar date. Pass an explicit time zone with each request and bucket server-side, or day totals will disagree at the boundary — and the disagreement will be largest for evening traffic. |
| **Currency** | PackPerks is multi-region: Netherlands in EUR, UAE in AED. Return cash figures per currency and never sum them. A PackPulse org spanning both regions needs two totals, not one converted one. |
| **Personal data** | Aggregates only across the boundary. No emails, device ids or display names — which also keeps this integration out of scope for most of the data questions a customer will ask. |
| **Freshness** | These metrics are computed from full-table reads today. Cache for 5–15 minutes and show the computed-at time. Super admins looking at trends do not need live numbers. |
| **Versioning** | Version the path (`/v1/`) and only ever add fields. PackPerks metrics change as the product does; PackPulse must not break when one is renamed. |
| **When PackPerks is down** | PackPulse shows "PackPerks data unavailable" with the last good timestamp. Never zeros, never a blank chart — both read as real performance. |

---

## Build order

Stages, in the order they unblock each other.

| # | Stage | What it is | Size |
|---|---|---|---|
| 1 | **Agree the metric definitions** | Which PackPerks number answers which PackPulse question, and what each one counts. No code. Everything downstream depends on it. | ½ day |
| 2 | **Close the anon read on `users`** | Independent of the integration, but do it before adding a consumer. Scope the three `anon select` policies to the requesting device. | ½ day |
| 3 | **Move the three computations server-side** | One edge function returning the aggregates. The logic exists — it is being lifted out of the browser, trimmed of raw rows, and given a date window and time zone. This is the bulk of the work. | 2–3 days |
| 4 | **Keys and the org allow-list** | `packpulse_keys`, header auth, scope intersection, rate limit — following the existing smart-bin pattern. | 1 day |
| 5 | **Directory endpoint and the mapping screen** | The connectable-orgs list on the PackPerks side; the master-settings picker and stored mapping on the PackPulse side. | 1–2 days |
| 6 | **The PackPulse panels** | Server-side fetch, cache, and the three views. Sized properly once I know what PackPulse is built with. | unknown |
| 7 | **Failure handling and an alert** | Stale-data banner, and a notification when the integration stops returning data — `last_used_at` makes this nearly free. | ½ day |

---

## What I need from you

**What is PackPulse built with, and does it have a server side?**
The whole design rests on PackPulse holding a key somewhere the browser cannot see. It is on Vercel, but everything including `/api/*` sits behind the password gate, and I do not enter passwords into login forms — so I could not look. If it is a Next.js app, its route handlers are the natural home; if it is purely static, that changes the plan.

**Does PackPulse have its own database?**
It decides where the org mapping lives and whether stage 6 can cache server-side.

**Who sees PackPerks data — only PackBack super admins, or customer admins too?**
You said master settings are for PackBack staff. If a venue's own admins will also see it, the endpoint needs per-user scoping, not just per-key.

**Should a PackPulse org see one venue or a whole programme?**
NYU Abu Dhabi and the Dutch BYO cafés share one PackPerks group. Whether that is one PackPulse customer or several decides the mapping shape.

**Which system owns the CO₂ figure?**
Both compute one today, by different methods. One of them has to defer.
