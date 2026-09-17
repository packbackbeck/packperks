# PackPerks — working notes for Claude

Reusable-cup rewards. Customers return a cup, collect cups in a wallet, and
redeem them for a drink or cashback. React + Vite + Supabase, no server of our
own beyond edge functions.

There are two apps in one codebase:

- **Customer app** — `src/` minus `src/admin`. Per-org, reached at `/<slug>/`.
- **Admin dashboard** — `src/admin/`, served at `/admin`, behind a login.

---

## Commands

```bash
npm run dev        # Vite dev server on :5173  (use this, not a bare `vite`)
npm run build      # what Vercel runs — plain `vite build`, no lint step
npm run lint       # eslint . — src/ alone has ~205 pre-existing errors
```

`npm run lint` is **not** clean and never has been. Judge your work by whether
the count moved, not by whether it is zero:

```bash
npx eslint src/ -f json | python3 -c "import json,sys; print(sum(1 for f in json.load(sys.stdin) for m in f['messages'] if m['severity']==2))"
```

Compare against `git stash` + rerun before claiming you introduced nothing.

---

## Working agreements

1. **Verify on the running dev server.** A green build is not evidence a screen
   looks right. Start `packperks-dev` (`.claude/launch.json`, port 5173) and
   actually look at the page before saying it works. `launch.json` is the one
   file in `.claude/` that is tracked; the rest of that folder is ignored.
2. **Push only when asked.** Commit locally freely; `git push` waits for a
   direct instruction. There are two remotes and both get pushed:
   `origin` (GitHub) and `gitlab`.
3. **A push is not a deploy.** See *Deploys lie* below.

---

## Domain model

**Organisation** = one venue (`organizations`: `id, name, slug, country,
brand_color, logo_url, group_id, deleted_at`). Venues sharing a programme sit
in an `org_groups` row. Config is published to `app_config` under
`published:<orgId>`, group config under `published:group:<groupId>`.

**Mode** decides which app a venue runs. Three modes, three names — use
exactly these in anything a person reads (`src/admin/lib/orgModes.js`):
- **Deposit Rewards** (`standard`, group copy mode `deposit`) — full app: cup
  balance, rewards, direct refunds, receipt claims
- **Bring Your Own** (group copy mode `byo`) — customers bring their own cup
  and scan the counter QR. A group with no mode set is Bring Your Own; a venue
  with no group is Deposit Rewards.
- **Deferred Tikkie** (`tikkie_only`, on the org's own config) — smart bin
  prints a receipt; scans credit a wallet (`TikkieHomePage.jsx`) collected
  later as one Tikkie link. No rewards.

Older labels — “Redirect Refund”, “Deferred Refund”, “Direct refund only”,
“Titaan Direct Refund”, “Rewards only” — are stale. The code keys stay.

**Customer accounts.** No email is needed to collect cups: the device id
(`src/lib/deviceId.js`) owns an anonymous `users` row. An email is asked for
only when money leaves — a cashback claim or a direct refund — and is verified
(signed in) wherever the venue has `requireEmailVerification` on. Payout links
are shown in the app, never in the email.

**Marketing consent is opt-in.** It comes only from a box or switch the
customer turns on: the email form, the wallet's save-your-balance form, Edit
profile, or the cookie banner's Marketing switch (recorded only when changed
there — `takePendingMarketingChoice` in `src/lib/consent.js`). Never pre-tick
it, never derive it from "Accept all", and never re-apply a stored cookie
choice onto the account on load.

**Rates** (`src/lib/rates.js`, `effectiveRates`): cashback and refund per cup.
Everything that shows or charges a rate reads it through this, and the
database mirrors it in `venue_refund_rate()`. Change both together.

**Region** (`src/lib/regions.js`) is derived from `organizations.country` and
decides currency, map focus, payout provider and copy. NL/EUR (Tikkie, live)
and AE/AED (`uae` adapter, **not live** — mechanism undecided). Region copy
goes through `payoutCopy()`: `link` regions promise a link to collect,
`direct` regions promise only that the cashback is sent. Never make a
`direct` region promise a link.

**Payment method** (`src/lib/paymentMethods.js`): `tikkie` (cashback after
review) or `voucher` (slider voucher redeemed at the counter). Resolution is
org → group → default.

**Dashboard access** (`src/admin/lib/access.js`, migration 048). Every
account holds one role from `admin_roles`; a role has a **level** and, per
dashboard tab, `hidden`, `view` or `edit`:
- **master** — PackBack staff. Every organisation, every tab, and Master
  Settings (people, roles, organisations, groups, regions, workspace tabs).
  Only masters add people, roles or organisations.
- **manager** — runs the organisations on their account (`org_ids`, or all of
  them with `all_orgs`). Built-in roles: Manager (changes everything) and
  Viewer (views everything).
- **vendor** — the venue's own people; read-only reporting by default.

Masters add roles of the manager or vendor level in Master Settings → Roles &
permissions. `workspace:tabs` in `app_config` switches a tab off for
everyone. A setting with a tab (cup sharing, donations) hides that tab when it
is off. `tabAvailability()` is the one place that decides whether a tab
shows, and why not.

The old `admin_profiles.role` column stays and a trigger keeps it in step
(master → `admin`, or `owner` for the founding account; manager → `manager`,
or `checker` when the role changes nothing; vendor → `vendor`). Edge
functions and `hasPermission()` still read it, so the money paths keep their
rule: minting cups and creating payouts is master-only. A write that sets
only the old role name is translated into the new fields.

What the database enforces: the level (`is_master()`), whether an account can
write at all (`is_staff_writer()`: a master, or a role with at least one
editable tab), and who may manage people, roles, organisations and the
workspace tabs. Which tab a role may change, and which organisations it sees,
is enforced by the dashboard (see *Org isolation* under Landmines).

`#overview?as=vendor` previews the vendor role. It can only ever *remove*
access, so any account above vendor may use it.

---

## Where things live

| | |
|---|---|
| `src/App.jsx` | customer app shell and routing — large, read before editing |
| `src/lib/regions.js` | currency, region seed, `formatMoney`, `payoutCopy` |
| `src/lib/RegionContext.jsx` | `useRegion()`, `useMoney()` for the customer app |
| `src/admin/lib/adminApi.js` | every admin query; ~5k lines |
| `src/admin/lib/access.js` | tabs, roles, levels; who sees which tab and why |
| `src/admin/ui/` | the dashboard's design system: tokens, cards, KPI tiles, the trend chart, insights |
| `src/admin/settings/` | Settings: features, payouts, rules, locations, privacy policy |
| `src/admin/master/` | Master Settings: people, roles, organisations, workspace |
| `src/admin/lib/adminMoney.js` | `useAdminMoney()` / `adminMoney()` — dashboard currency |
| `src/admin/lib/demoData.js` | the “Demo numbers” dataset |
| `src/admin/context/orgState.js` | module-level active org for non-React callers |
| `src/lib/supabase.js` | the customer client; adds `x-device-id` to database calls |
| `src/lib/deviceId.js` | the device id that owns an anonymous customer |
| `src/lib/rates.js` | `effectiveRates` — cashback and refund per cup |
| `supabase/functions/` | ~30 edge functions |
| `supabase/migrations/` | numbered SQL migrations — every schema change is one |
| `supabase/rollback/` | emergency scripts that undo a migration |
| `supabase/baseline/` | full schema snapshot; rebuilds the database from nothing |

The three analytics readers behind the dashboard, all in `adminApi.js`:
`getAdminStats` (Overview), `getStatsMetrics` (System Health),
`getUserBehaviourStats` → `computeMetrics` (User Behaviour).

Those three pages share one layout, taken from PackPulse: KPI tiles
(`KpiGrid`), the trend chart (`TrendCard`) with `InsightsCard` beside it, then
detail cards. Each page turns its reader's output into metric objects in a
`*Model.jsx` next to it; the metric shape is documented at the top of
`ui/KpiTiles.jsx`. A `value: null` point in a series is a gap, not a zero.
Dialogs (`Modal`) render into `.admin-app`, so they sit above the fixed top
bar and sidebar and keep the dashboard's tokens.

---

## Supabase

Project ref `ozvcpbthnauitaphosfb`. Use the Supabase MCP tools — `execute_sql`,
`apply_migration`, `deploy_edge_function`. The CLI is **not** authenticated
here (`supabase functions deploy` fails on a missing token), so deploy edge
functions through MCP with the full file contents inline, and keep the local
copy in `supabase/functions/` in sync in the same commit.

**Every schema change is a numbered file** in `supabase/migrations/`, applied
with `apply_migration`. One that must wait for an app deploy waits in
`supabase/pending/` and moves into `migrations/` when applied. Changes made straight in the dashboard are how the
repo stopped describing the database; `supabase/baseline/` is the snapshot
that recovered it (regenerate with `baseline/snapshot.sql` after big changes).

**Test policies in a transaction you roll back.** `begin; set local role anon;
select set_config('request.headers', '{"x-device-id":"…"}', true); …; rollback;`
exercises RLS and triggers against real data without changing it. For a
signed-in caller, set `role authenticated` and `request.jwt.claims`.

**Who the guards trust.** Customer-facing guards (`claims_guard_client_*`,
`users_guard_client`, `cup_balances_guard_client`, …) act only when
`current_user` is `anon` or `authenticated`. Edge functions (service role),
SECURITY DEFINER functions and `is_staff_writer()` (active owner, admin or
manager) pass straight through. Checkers and vendors are read-only in the
database, as they are in `hasPermission()`.

---

## Landmines

Things that have already cost real time. Read before touching the area.

**Org isolation is not enforced in the database.** `applyOrgFilter()` adds
`.eq('org_id', …)` in JavaScript, and the organisation list on an account
(`org_ids`) only narrows the switcher. The RLS policies on customer data say
`(current_admin()).id IS NOT NULL` with no org constraint, so any signed-in
dashboard account can read every org's rows through the API. Locations and
the audit log are the exceptions (`admin_sees_org()`, migration 048). Treat
org scoping as a UI convention, not a security boundary, and never hand out
a Supabase key expecting it to filter.

**The anon key ships in the customer bundle — treat it as public.** Closing
what it could do is split in two stages, because the live app and the database
change at different times:

- **Stage 1 (migrations 043–045).** The key can no longer move money or
  change dashboard data. Amounts come from the published config, never the
  request: the `claims` insert trigger reprices every claim, balances only go
  down from the client, and `tikkie-cashback` refuses to pay more than the
  claim's reward is worth. Money leaves only through `create_cashback_claim`,
  `refund_all_cups`, `donate_cups` and `redeem_voucher`, which check the caller
  owns the account. Staff-only tables (config, venues, invitations, roles)
  take writes from `is_staff_writer()` only.
- **Stage 2 (migration 046).** Customer rows, balances, history and shared
  profiles are visible and changeable only by the device that created them
  (the `x-device-id` header) or the login and shared identity they belong to
  (`request_user_ids()`). Without the header the key reads nothing, claims
  can't be inserted directly, and payout links go only to their owner.
  Both stages are live since 16 Sep 2026. Every customer database call must
  go through `src/lib/supabase.js` so it carries the header; a client without
  it sees an empty account. `supabase/rollback/046_to_stage1.sql` undoes
  Stage 2 in an emergency (and reopens the reads).

Never add an `anon`/`authenticated` write policy with `true`, and never let a
client-sent number decide an amount. New money paths are SECURITY DEFINER
functions that call `owns_user()` and `assert_can_claim()`.

**Deploys lie.** Vercel has silently skipped deploy triggers; production sat
two commits behind `main` for hours while the code was correct. `last-modified`
on Vercel assets is edge-cache fill time (`date − age`), not build time, so it
cannot date a deploy. To check what is actually live, fingerprint the bundle:

```bash
html=$(curl -s "https://perks.packback.network/nyuad/?cb=$RANDOM")
js=$(echo "$html" | grep -oE 'index-[A-Za-z0-9_-]+\.js' | head -1)
curl -s "https://perks.packback.network/assets/$js" | grep -c "some-class-name"
```

Class names and object keys survive minification; local variable names do not.
An empty commit re-fires the hook when a trigger was missed.

**Publishing overwrites settings you set in SQL.** The dashboard publishes the
whole settings object from the local draft. A flag written straight into
`app_config` is wiped by the next publish from a stale draft. The draft
hydrates from published, so it sticks *after* one load — but prefer the UI
toggle for anything that must persist.

**`normalizeRegion` must carry every region field.** The admin Regions panel
round-trips regions through it and saves the result, so a field dropped there
is dropped from the stored overlay for good. This is how AE silently lost
`payoutStyle` and started promising UAE customers a payment link that no live
adapter could deliver.

**`OrgContext` only selects the columns it lists.** `country` was missing for
months, so `activeOrg.country` was undefined and every org fell back to the NL
region. If you need a column on the active org, add it to that select.

**Deleting a customer is an edge function, not SQL.** Removing an
`auth.users` login needs the Auth Admin API, which SQL cannot call. A SQL-only
delete removed the app rows and left the login, so the next sign-in rebuilt
the account and copied the email back, with the balance gone. Both paths now
go through edge functions: `delete-my-account` (the customer) and
`admin-delete-user` (the dashboard). Both call `erase_customer_rows()`, which
deletes the person but **keeps their claims**, anonymised: they are the
payout ledger. Erase through that function; don't write a new delete.

**Customer emails are email only.** Push notifications were removed; the
`notify_push` column stays and is always false.

---

## Verifying without an admin login

The dashboard is behind a password and there is no test account. Two ways to
check admin work without signing in:

1. **Exercise the real readers through the dev server's module graph** — in the
   browser pane on any page:
   ```js
   const api = await import('/src/admin/lib/adminApi.js');
   api.setAdminDemoMode(true);
   await api.getAdminStats(['some-org-id']);
   ```
2. **A scratch harness** — a temporary `foo.html` + `src/foo.jsx` that mounts the
   component with stub props, viewed at `localhost:5173/foo.html`. Delete it and
   revert any temporary exports before committing; grep to prove it is gone.
