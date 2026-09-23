# PackPerks — working notes for Claude

Reusable-cup rewards. Customers return a cup, collect cups in a wallet, and
redeem them for a drink or cashback. React + Vite + Supabase, no server of our
own beyond edge functions.

There are three apps in one codebase, picked by path in `src/main.jsx`:

- **Customer app** — `src/` minus `src/admin` and `src/staff`. Per-org,
  reached at `/<slug>/`.
- **Admin dashboard** — `src/admin/`, served at `/admin`, behind a login.
- **PackPerks Staff** — `src/staff/`, served at `/staff`: venue staff make
  cup QR codes on their phone. Its own login (see *PackPerks Staff* below).

---

## Commands

```bash
npm run dev        # Vite dev server on :5173  (use this, not a bare `vite`)
npm run build      # what Vercel runs — plain `vite build`, no lint step
npm run lint       # eslint . — src/ alone has ~150 pre-existing errors
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
  later as one Tikkie link. No rewards. The customer can instead donate
  some or all of the balance (`bin-tikkie` action `donate` →
  `wallet_donate()`, migration 054): it sweeps every credit into one
  `donation` claim and hands the rest back as a `wallet_change` claim,
  which the wallet counts like a receipt. Count wallet credits with both.
  A first-time visitor reads *How you get paid* above the activity list;
  once there is activity it moves below it (`hasActivity` in
  `TikkieHomePage`), and that block is a normal card that follows the
  venue's colours.
  Its Dashboard rebuilds per-cup activity from those claims
  (`getAdminStats(orgIds, { mode })`, `buildTikkieMetrics`): there are no
  cup balances or `activity_history` rows for this mode.

**User analytics is four tabs** (`AdminUserBehaviour.jsx`). *Programme*
is the old page: scanning, coming back, claiming. The other three are
one component (`userflow/UserFlowTab.jsx` with a `section`), because
they read the same window, scope and device — switching between them
refetches nothing:
- *User flow* — the app in numbers: taps per visit, time to first tap,
  scroll reach, where visits go next. Four tiles moved here because they
  were always answering that question: *App opens*, *Time per visit*,
  *Button taps*, *Where visits end*. They keep their own reader
  (`computeMetrics` over `client_events`, every consented visit) and stay
  in the export; the rest is built from what capture recorded, which is
  why *Visits captured* is the first tile — it says how much of the
  programme the others speak for.
- *Heatmap* — taps, scroll bands or control use, over the venue's own
  screen, plus the table of every control and how long it takes to reach.
- *Session replay* — one visit, played back step by step.

In Deferred Tikkie the four moved tiles are absent (that mode's reader
has no such metrics) and the tabs show the capture-built ones alone, over
that mode's own screens — TikkieHomePage reports whichever sheet is on
top as the screen, so the wallet gets a real heatmap rather than one page
called "home".

**UX capture** (`src/lib/uxCapture.js`, `supabase/functions/ux-ingest`,
migration 061) is what fills it. Taps (position plus the name of the
control under the finger), scroll depth, screen views and the visit's
end, written to `ux_events` / `ux_sessions`, plus `ux_layouts`: what each
screen LOOKED like, measured off the live DOM — every piece's position
and size as a fraction of the page, and how it was drawn (background and
text colour, corner radius, type size, weight, line height, border, its
words, and the public image URL where it had one).

`ScreenPaint` repaints that, and it is what the heatmap and the replay
are drawn over, so a venue sees its own app with the heat exactly where
the thumbs landed. **There is never a screenshot of a customer's screen
anywhere in this system**: it is a measurement, the page is never
recorded, and replay is the event stream played over the repaint. The
phone is a scroll window over the whole page at its true proportions —
capping the aspect squashes every piece and pushes its words out of the
box measured for them. A visit on a desktop gets a window frame instead
of a phone.

Personal-looking text never reaches `ux_layouts`, which is shared across
every visit to a screen: emails, IBANs and long numbers are masked in the
browser, and `[data-ppk-private]` (on UserPage's profile block) excludes
a subtree outright — no tap on it is named and it is never painted.

Only customers who turned the **Analytical** cookie category on are
captured, the same switch that gates `client_events`. Nothing typed,
no field contents, no pointer trail. A control is found by walking up
from the tap to a native control or to the outermost element with
`cursor: pointer` — half this app's buttons are card-shaped divs, and
without that every tap on a reward would be filed as a dead tap. A
control holding one phrase paints that phrase itself; one holding several
(a reward card) paints none, and its own pieces are painted instead, or
the card would collapse to a single line of text.

Per venue, `app_config` `ux:capture:<orgId>` holds `{ enabled, sample,
clicks, scroll, replay, layouts, retentionDays }` (User flow → Capture
settings; its own row, like `byo:cap:<orgId>`, so publishing can't wipe
it). `ux-ingest` reads the same row before it stores anything, so a
switch off stops the data at the server. The function is the only writer:
a batch is capped at 300 rows, a visit at 3,000 however long it stays
open, and a new visit counts against 300 per IP per hour — inventing
session ids is the only way to flood the table, and a visit already
under way is never turned away mid-flow.

Everything is **on by default**, replay included: the customer has
already agreed to behavioural analytics, replay is reconstructed rather
than recorded, and none of it outlives `retentionDays`. A visit is listed
for replay only when `ux_sessions.replay` was true at the moment it was
captured, so turning replay off leaves a permanent gap rather than one
that fills in later. Taps are the shortest-lived thing we hold:
`ux_run_retention()` (inside the nightly `run_data_retention()`) deletes
past `retentionDays`, 60 by default.
Deleting a customer takes their visits (`ux_erase_user`, called by
`erase_customer_rows`), and Master Settings → Data can clear them per
venue. The dashboard reads sums, not taps: `ux_screen_summary`,
`ux_heatmap`, `ux_scroll_curve`, `ux_targets`, `ux_target_series`,
`ux_flow` (SECURITY DEFINER, dashboard accounts only). `uxAggregate.js`
is the same sums in JavaScript, for "Demo numbers".

**Dashboard sidebar** (`TABS` and `TAB_GROUPS` in `src/admin/lib/access.js`,
in sidebar order): Analytics (Dashboard, User analytics, System health,
Reports & alerts), Customers (Users, Rewards & offers, Design & copy, Email
templates, Future vendors, Smart bin locations), Generate (Static QR code,
Dynamic QR code, Receipt generator, Staff app), Circulation (Cup scans,
Claims, Tikkie payouts, Cup shares, Donations, Backup cups), Workspace
(Settings, Master settings, Help & support, Version history, MockupMaster,
PackPulse). Each tab's `modes` hides it where the programme has no use for it.

**Static QR code** (feature `featureStaticQr` in the org's published
settings; Settings → Features; tab `byorequests`, labelled Static QR code). A
QR code that stays on the counter, `/<slug>/?byo=1[&loc=<location>]`: each
scan gives one cup, up to a per-person limit over a rolling window
(`app_config` `byo:cap:<orgId>` = `{ cap, windowMinutes, windowHours,
dailyCap }`, set on that page). **The window is minutes** — the page offers
minutes, hours, days and weeks up to 90 days, and two cups a day is the
default when a venue sets nothing. `windowHours` and `dailyCap` are the old
names, still written in step so an older reader keeps working; a row from
before minutes existed carries only those, and every reader falls back
`windowMinutes` → `windowHours × 60` → a day. The limit's numbers never
reach the customer: the app says only that the limit is reached, and neither
edge function returns counts. On by default for Bring
Your Own (unset means on there, off everywhere else; `featureDefault` on the
tab, `fallbackByMode` on the feature). Bring Your Own and Deposit Rewards
mint through `byo-mint` into the cup balance, and scans over the limit wait
for review. Deferred Tikkie credits one cup's refund to the wallet through
`bin-tikkie` action `static_qr` (a claim with a synthetic batch id, like a
backup receipt, so it shows as a return); over the limit nothing is added.

**Tikkie link status** (migration 060). A link's real state lives at ABN
AMRO: `created`, `redeemed` (with `tikkie_redeemed_at`) or `expired`. Three
things write it onto the claim: `tikkie-webhook` (seconds after a
collection, but only once the subscription is registered — Tikkie payouts →
Status updates → Connect, owner-only at Tikkie's end), `tikkie-sweep`
(pg_cron every 15 minutes and the same page's *Check open links*, which
also backfills), and the Claims page's per-claim refresh
(`tikkie-cashback` action `status`). `tikkie_checked_at` is when we last
asked. Backfilling 48 old links on 23 Sep 2026 found 33 of them collected
that we had recorded as open, so treat a stale `created` as "not asked".

**A Tikkie link cannot be cancelled, and its expiry is not ours to set.**
The Cashback API has no delete, cancel or expire call: a `DELETE` on a
cashback is refused by the gateway as a disallowed method (probed 23 Sep
2026), while `GET` validates the id. Nor is there a per-link expiry — a
cashback's `expiryDateTime` **is the campaign's `endDate`**, the same
instant for every link the campaign ever mints (all 48 of ours read
2026-12-31T22:59:59.999Z; `GET /cashback-campaigns/<id>` returns
`startDate`, `endDate`, `status` and `remainingAmountInCents`, and the
campaigns collection itself answers 404, so campaigns are managed at ABN
AMRO, not through this API). Two consequences: **every link dies on the
campaign's end date**, and minting a second link that covers money an open
link already covers would pay twice.
The Deferred Tikkie wallet therefore shows the total owed (balance plus
every uncollected link) on its tile, and Collect **reopens** an uncollected
link instead of minting; the rest of the wallet gets its own link once that
one is collected, which the webhook knows within seconds. Under the big
number, and only when the total really is split across the two, two short
lines say to collect it all with the button below and that the older part
sits in a link in the activity list.

**Unclaimed money has a deadline of our own** (`claims.expires_at`,
migration 063). Two settings — Settings → Rules & limits → *When unclaimed
money expires* — give each venue a window in months
(`payoutExpiryMonths` for cashback, refunds and wallet payouts,
`rewardExpiryMonths` for a claim against a reward; three months unless set,
0 means never), and a BEFORE INSERT trigger stamps the deadline on every
claim as it is made. It is **our** cutoff, not enforcement at Tikkie: past
it the app offers nothing and the reporting counts the money as never
claimed, but someone still holding the URL can collect until the campaign
ends, because the link cannot be cancelled. Keep the window shorter than
the campaign's end and the two agree — the Rules & limits footer shows that
date and warns when the window overshoots it.

**The app never offers a dead payout link.** `src/lib/payoutLink.js`
(`payoutLinkState`) is the one place that decides: collected, expired (by
status, or by the **earliest** of Tikkie's expiry and ours being in the
past), open, waiting or failed. A row without a deadline of its own can be
judged with `opts.expireAfterMonths`, measured from `created_at` — the
Deferred Tikkie wallet passes the venue's window that way, because its
history rows come from `bin-tikkie` rather than the claims table. The activity
list, its popups (`ActivityDetailModal`, `TikkieActivitySheet`), the claim
cards (`PendingClaims`) and the wallet all read it, show the status and its
time, and hand out a URL only while the link still works.

A Deferred Tikkie **Tikkie link is made per payout**, not per receipt, so
System health's *Payout links created* divides links made by payouts asked
for (`getTikkieStatsMetrics`). A wallet payout whose link fails is deleted,
so `bin-tikkie` first writes a `system_events` row (`tikkie_payout_link`,
`failure`); that row is the only record of it.

Three code pages, one tab each: **Dynamic QR code** (tab `cupqr`, single-use
cup batches, every mode), **Static QR code** (`byorequests`) and **Receipt
generator** (`receiptgen`, test purchase receipts for rewards, so not in
Deferred Tikkie).

**Receipt designs** (`src/admin/cupqr/receiptDesigns.js`, Dynamic QR code →
Design). Five choices: the tall thermal receipt the page has always printed,
plus four landscape artworks — Banknote Simple, Banknote Full, Willy Wonka,
Ticket. An artwork is the designer's Figma export with only the changing
parts cut out (`scripts/receipt-designs/build.py` → `public/receipt-designs/`);
its wording is outlined vector and **cannot** be changed from the app, so it
reads as a deposit refund whatever mode the venue runs. `renderDesign()`
builds one self-contained SVG — fonts embedded as base64, because an SVG in
an `<img>` cannot reach the page's stylesheets — and the preview, the JPG,
the PDF, the browser print and the thermal printer all rasterise that same
string, so none of them can drift. Measure the value **after** the font
loads or it is sized against Helvetica and overflows the artwork. On the
Epson the sheet goes out turned a quarter turn (`rasteriseForThermal`):
printed upright on an 80 mm roll its QR lands at about 10 mm and will not
scan. Fonts are self-hosted in `public/fonts/` (Figtree, Playfair Display,
Bevan — all OFL), same rule as DM Sans. Every mode has **Design & copy** (`appdesign`); in Deferred
Tikkie it shows only Colours and the two header logos (`showPackbackLogo`,
`showBrandLogo`).

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
  Settings (people, roles, organisations, groups, regions, workspace, data).
  Only masters add people, roles or organisations, or delete records.
- **manager** — runs the organisations on their account (`org_ids`, or all of
  them with `all_orgs`). Built-in roles: Manager (changes everything) and
  Viewer (views everything).
- **vendor** — the venue's own people; read-only reporting by default.

Masters add roles of the manager or vendor level in Master Settings → Roles &
permissions. `workspace:tabs` in `app_config` switches a tab off for
everyone, `workspace:topbar` hides top-bar items (Publish can't be
hidden) and `workspace:display` holds display switches (`sparklines: false`
turns the mini graphs off on every number tile); all three are set in
Master Settings → Workspace. A tab with an `href`
(MockupMaster) is a sidebar link to another app, never a dashboard page. A setting with a tab (cup sharing, donations) hides that tab when it
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

**PackPerks Staff** (`src/staff/`, `supabase/functions/staff-app`,
migrations 050, 053, 055). A phone app at `/staff`, on for an organisation
only when `organizations.staff_app_enabled` is set (NYU Abu Dhabi first).
Each venue runs it from Generate → Staff app (`src/admin/staffapp/`, tab
`staffapp`): the on/off switch, accounts, a log of every code tagged with who
made it, and a preview (`/staff?preview=<orgId>`: sample data, nothing
minted). Staff are added by email there (`staff_members`, one venue per
email), or ask for access from the app: they pick a venue, the row waits as
`status = 'requested'`, and anyone who can *view* the tab approves it
(masters, managers, vendors). `@packback.network` addresses skip the wait.
Changing the switch or adding people needs *edit* on the tab; the function
checks the role and the venue itself (`adminCtx`), because the dashboard's
tab rules are not in the database. The app wears the venue's customer-app
colours (`settings.design.colors` of `published:<orgId>`, mapped in
`src/staff/staffTheme.js`) and shows its logo. Signing in starts with the
email (`lookup` in the function, migration 056): `@packback.network` always
signs in with an emailed one-time code (`code_request` / `code_verify`, which
returns a token the app turns into a session with `auth.verifyOtp`); an
account with a password is asked for it; someone added or approved sets a
password with an emailed code; anyone else picks a venue and asks
(`request_access`), with no login until someone approves it. The function
emails its own 6-digit codes (Brevo), and sets the password on an existing
login with the same email (a customer or dashboard account) rather than
making a second one. A
staff code is an ordinary cup batch (`cups` rows, source `admin_batch`) that
expires after 15 minutes, logged in `staff_qr_codes`; the customer claims it
at `/<slug>/?batch=<id>` like a printed receipt. Staff never read tables
directly: everything goes through `staff-app` with the service role. The app
uses its own Supabase client with storage key `pp-staff-auth`, so a staff
login never mixes with a dashboard or customer session. The QR is drawn by
the `<qr-code>` web component (`@bitjson/qr-code`, MIT), whose animations
run on the browser's Web Animations engine.

The customer app, the staff app's password logins and the dashboard share
one Supabase login per browser on this domain (the staff app keeps its own
session, but the login rows are the same). A signed-in login with no
dashboard profile gets the dashboard's sign-in page with a note
(`AuthGate`, status `no_profile`), never an empty dashboard.

**PackPulse connection** (`docs/packpulse/INTEGRATION.md`, migrations
057–059, edge function `packpulse-link`, Master Settings → PackPulse). A
master creates a one-time code for a venue; PackPulse's server claims it and
gets a link secret; a master approves after comparing a 4-character
confirmation code. PackPulse then frames `/packpulse-embed` (Dashboard,
System health, Reports & alerts, as a vendor sees them) with a one-time
ticket that signs in the connection's own login
(`link-<id>@packpulse.packperks.invalid`). That login has no dashboard
profile and reads only the `packpulse_*` views: its venue, active links,
shared pages, no emails, payout links or cup codes. The panel is two cards:
*Set up a connection* (the three steps, each holding its own control —
create the code, hand it over, approve what comes back) and *Connections*
(the diagram and one row per connection). In embed mode
`src/lib/supabase.js` keeps the session in memory and maps each table to its
view. The prompt for PackPulse's own Claude is `docs/packpulse/PACKPULSE_PROMPT.md`.

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
| `src/staff/` | PackPerks Staff: login, the QR screen, history, profile |
| `src/admin/staffapp/` | Generate → Staff app: switch, accounts and requests, logs, preview |
| `src/lib/uxCapture.js` | taps, scrolls and screen flow from the customer app |
| `src/admin/behaviour/userflow/` | User flow, Heatmap and Session replay: tiles, the repainted screen, controls, flow, replay, capture settings |
| `src/admin/lib/uxAggregate.js` | the User flow sums in JS — the demo's half of migration 061 |
| `src/admin/lib/access.js` | tabs, roles, levels; who sees which tab and why |
| `src/admin/ui/` | the dashboard's design system: tokens, cards, KPI tiles, the trend chart, insights |
| `src/admin/settings/` | Settings: features, payouts, rules and expiry, locations, privacy policy |
| `src/admin/master/` | Master Settings: people, roles, organisations, groups, regions, workspace, data, PackPulse |
| `src/admin/embed/` | `/packpulse-embed`: one venue's pages inside PackPulse |
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
| `docs/roles-and-features.md` | who reaches which tab, and the FigJam chart of it |

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

**Deleting an organisation's records is one master-only function.**
Master Settings → Data calls `admin_purge_org_data(org, kinds, from, to)`
(migration 049): it deletes only the listed kinds of activity record (cup
scans, claims, customer history, charity transfers, bin sessions, app and
system events) for one organisation. Customers, balances, rewards and
printed cups are never deleted there. Add a kind in the function's list and
in `ORG_DATA_TIME_COLUMN` (adminApi.js) together.

**App paths are not venue addresses.** `src/main.jsx` sends `/admin…`,
`/mockup…`, `/staff`, `/support…`, `/vendor-support…` and `/packpulse-embed` to their own apps
before any venue lookup, so an organisation or group with such a slug would
be unreachable. `RESERVED_SLUGS` (`src/admin/master/orgShared.js`) and
`isOrgSlugAvailable` refuse them; add a new app path to both.

**Printed batches change through one master-only function.** Revoke,
restore and expiry on the Dynamic QR code page call `admin_set_cup_batch`
(migration 052); `cups` has no update policy, so a browser `update` on it
silently changes nothing. Batches generated before 18 Sep never got the
expiry they were given.

**`cups` is readable by dashboard accounts only** (migration 051). It used to
be readable with the public key, which let anyone list unclaimed cup ids and
claim them. Never add a broader read policy; the customer app claims through
claim-cups.

**UX capture is not shared with PackPulse.** `ux_events`, `ux_sessions`
and `ux_layouts` have no `packpulse_*` view, on purpose: the shared pages
are Dashboard, System health and Reports, and a connection has no
business replaying a venue's visits. If User flow is ever added to the
shared pages, each table needs its own view and a `PACKPULSE_VIEWS`
entry, like everything else below.

**The PackPulse embed reads views, not tables.** A Dashboard, System health
or Reports reader that starts reading a new table shows zeros in PackPulse
until that table gets a `packpulse_*` view (only the columns needed, filtered
by `packpulse_org_ids()`, select-only) and an entry in `PACKPULSE_VIEWS`
(`src/lib/supabase.js`). Never give a connection login an `admin_profiles`
row: dashboard accounts read every venue. A new PackPulse address must be
added to `frame-ancestors` in `vercel.json`.

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
