# PackPerks: the whole system

A complete description of PackPerks as it stands on 15 October 2026: what it
is, how it is built, the three programme modes, every feature and the logic
behind it, the data model, security, and how it connects to the systems
around it (smart bins, Tikkie, Google, Brevo, Claude, PackPulse, Vercel).

This is the reference document. `CLAUDE.md` at the repo root holds the
working notes and landmines for whoever changes the code; the specialist
documents in `docs/` go deeper on single integrations and are linked where
they apply.

---

## Contents

1. [What PackPerks is](#1-what-packperks-is)
2. [The big picture](#2-the-big-picture)
3. [Technology stack](#3-technology-stack)
4. [One codebase, several apps](#4-one-codebase-several-apps)
5. [Core concepts and names](#5-core-concepts-and-names)
6. [The three modes](#6-the-three-modes)
7. [The customer app](#7-the-customer-app)
8. [Accounts, identity and sign-in](#8-accounts-identity-and-sign-in)
9. [Cups: how they are created and claimed](#9-cups-how-they-are-created-and-claimed)
10. [Rewards, claims and payouts](#10-rewards-claims-and-payouts)
11. [The admin dashboard](#11-the-admin-dashboard)
12. [Roles and access](#12-roles-and-access)
13. [PackPerks Staff](#13-packperks-staff)
14. [Analytics, heatmaps and session replay](#14-analytics-heatmaps-and-session-replay)
15. [Emails and notifications](#15-emails-and-notifications)
16. [Integrations with other systems](#16-integrations-with-other-systems)
17. [Data model](#17-data-model)
18. [Edge functions](#18-edge-functions)
19. [Scheduled jobs](#19-scheduled-jobs)
20. [Security model](#20-security-model)
21. [Privacy and data retention](#21-privacy-and-data-retention)
22. [Regions and currencies](#22-regions-and-currencies)
23. [Configuration and publishing](#23-configuration-and-publishing)
24. [Hosting, deploys and environments](#24-hosting-deploys-and-environments)
25. [Development workflow](#25-development-workflow)
26. [Known limits and open items](#26-known-limits-and-open-items)
27. [Glossary](#27-glossary)
28. [Further reading](#28-further-reading)

---

## 1. What PackPerks is

PackPerks is a reward programme for reusable cups, run by PackBack. A
customer returns a reusable cup (or brings their own), and gets something
for it: cups collected towards a free drink, cashback on a purchase, a
deposit refund paid straight to their bank, or a donation to a charity.

It is a web app, not a native app. A customer scans a QR code with their
phone camera and lands in the venue's own branded version of PackPerks in
the browser. Nothing to install, and no account needed to start: the phone
itself holds the balance until the customer chooses to save it to an email
or a Google account.

Three groups of people use it:

| Who | What they use | Where |
|---|---|---|
| **Customers** | The customer app: collect cups, see the balance, claim rewards, get paid | `perks.packback.network/<venue>/` |
| **Venue staff** | PackPerks Staff: make a cup QR code on their phone at the counter | `perks.packback.network/staff` |
| **PackBack and venue managers** | The admin dashboard: configure venues, approve claims, read analytics | `perks.packback.network/admin` |

Live venues include KFC, Burger King Netherlands, Cartouche, La Place,
Titaan (Amsterdam test sites t2/t3), Unknown Campus and NYU Abu Dhabi.

---

## 2. The big picture

```
                         ┌────────────────────────────┐
   smart bin ──────────▶ │                            │ ◀────── Tikkie (ABN AMRO)
   (bin-mint-batch)      │   Supabase                 │         cashback API + webhook
                         │   ─ Postgres (RLS)         │
   customer phone ─────▶ │   ─ Auth (email code,      │ ◀────── Google (OAuth)
   (customer app)        │      Google)               │
                         │   ─ Storage (receipts)     │ ──────▶ Brevo (email)
   staff phone ────────▶ │   ─ ~30 edge functions     │
   (/staff)              │   ─ pg_cron, pg_net        │ ──────▶ Anthropic Claude
                         │                            │         (receipt checks)
   dashboard ──────────▶ │                            │
   (/admin)              └────────────────────────────┘
                                      ▲
   PackPulse ── iframe ── /packpulse-embed (read-only views)

   All three web apps: one React bundle on Vercel at perks.packback.network
```

There is no server of PackPerks' own. The browser talks to Supabase
directly for reads and writes that Row Level Security allows, and calls
**edge functions** (Deno, on Supabase) for anything that needs a secret,
moves money, or must be trusted: minting cups, paying out, checking a
receipt, sending email.

---

## 3. Technology stack

| Layer | Choice |
|---|---|
| Front end | React 19, Vite, plain CSS per component (no CSS framework) |
| Charts | Recharts (dashboard), simpleheat (heatmaps) |
| Maps | Leaflet (smart bin and venue maps) |
| QR | `qrcode` (drawing), `jsqr` (in-app scanning), `@bitjson/qr-code` (animated staff QR) |
| Session recording | rrweb + `@rrweb/packer` |
| Documents | jsPDF, html-to-image (receipts, exports) |
| Icons | lucide-react |
| Backend | Supabase: Postgres, Auth, Storage, Edge Functions (Deno), pg_cron, pg_net |
| AI | Anthropic Claude (Haiku for image moderation, Sonnet for receipt checks) |
| Email | Brevo transactional API |
| Payouts | Tikkie Cashback API (NL); a provider-agnostic UAE adapter (not live) |
| Hosting | Vercel (static SPA, rewrites every path to `index.html`) |
| Source | Git, two remotes: GitHub (`origin`) and GitLab (`gitlab`) |

Fonts are self-hosted (DM Sans for the app; Figtree, Playfair Display and
Bevan for receipt designs).

---

## 4. One codebase, several apps

`src/main.jsx` looks at the path before anything else boots and picks an app:

| Path | App | Source |
|---|---|---|
| `/admin…` | Admin dashboard | `src/admin/` |
| `/staff` | PackPerks Staff | `src/staff/` |
| `/packpulse-embed` | Dashboard pages framed inside PackPulse | `src/admin/embed/` |
| `/mockup…` | MockupMaster (design mockups) | separate entry |
| `/support…`, `/vendor-support…` | Public contact forms | support pages |
| `/` | Root landing | |
| `/<slug>/…` | **Customer app** for one venue or group | `src/App.jsx` and `src/components/` |

These app paths are reserved: an organisation or group can never take one
as its slug (`RESERVED_SLUGS` in `src/admin/master/orgShared.js`), or it
would be unreachable.

Before any of that, `main.jsx` also checks whether a Google sign-in landed
on the wrong venue (see §8) and bounces it back.

All apps ship in **one bundle and one stylesheet**. CSS class prefixes are
therefore not private: the dashboard's device frame uses `ufs-` because the
customer app already owns `sf-`, and a collision once made a phone preview
900px tall.

---

## 5. Core concepts and names

**Organisation** (`organizations`): one venue. Columns that matter: `id`,
`name`, `slug` (its address), `country` (decides the region), `brand_color`,
`logo_url`, `group_id`, `staff_app_enabled`, `deleted_at`.

**Group** (`org_groups`): venues that share one programme, for example a
chain of cafés. A group has its own slug, which opens the **Stores hub**
listing its venues, and its own copy mode (`deposit` or `byo`).

**Mode**: which app a venue runs. Three of them, see §6.

**Cup**: one unit of reward. A cup is a row in `cups` with a UUID that is
printed inside a QR code; claiming it adds one to the customer's balance.

**Batch**: a set of cups minted together (one receipt, one bin session, one
staff code). The QR on a receipt carries `?batch=<id>`.

**Balance** (`cup_balances`): cups a customer holds at one venue. Balances
are per venue, even inside a group.

**User** (`users`): one customer at one venue. A person who uses three
venues has three `users` rows, tied together by a **customer identity**.

**Customer identity** (`customer_identities`): the one shared profile of a
person across a group: name, avatar animal, email, login.

**Device id**: a UUID kept in the browser (`packperks_device_id`). An
anonymous customer *is* their device id. Every database call from the
customer app carries it as the `x-device-id` header.

**Claim** (`claims`): a request to turn cups into money or a reward: a
cashback claim, a direct refund, a donation, a voucher redemption, a
Deferred Tikkie wallet payout. Claims are the payout ledger and are never
deleted, only anonymised.

**Reward**: something a customer can unlock with cups (a free drink, a
cashback amount). Defined per venue in the published config.

**Published config** (`app_config` row `published:<orgId>`): everything a
venue's app shows and how it behaves: rewards, settings, feature switches,
design, copy, privacy policy.

---

## 6. The three modes

Every venue runs exactly one of three programmes. The names below are the
ones used in anything a person reads (`src/admin/lib/orgModes.js`). Older
labels such as "Redirect Refund", "Deferred Refund", "Direct refund only",
"Titaan Direct Refund" and "Rewards only" are stale; their code keys remain.

### 6.1 Deposit Rewards (`standard`, group copy mode `deposit`)

The full app. A customer pays a deposit for a reusable cup; returning it
(at a smart bin or the counter) gives them a receipt with a QR. Scanning it
adds cups to their balance. With cups they can:

- unlock a **reward** and claim **cashback**: buy the reward item, photograph
  the receipt, the AI checks it, a person approves, a Tikkie link is sent;
- take a **direct refund** of the deposit value instead;
- **donate** cups to a charity;
- **share** cups with a friend;
- redeem a **voucher** at the counter, where the venue pays that way.

A venue with no group is Deposit Rewards.

### 6.2 Bring Your Own (group copy mode `byo`)

For cafés where customers bring their own cup. There is no deposit. A
**Static QR code** stays on the counter (`/<slug>/?byo=1`); each scan gives
one cup, up to a per-person limit over a rolling window. Cups unlock the
same rewards and cashback as Deposit Rewards. Groups default to Bring Your
Own when no mode is set. Profiles are shared across all venues of the group.

### 6.3 Deferred Tikkie (`tikkie_only`)

Built for smart bins that print a receipt. Scanning the receipt credits
**money**, not cups, into a wallet on the phone (`TikkieHomePage.jsx`). The
customer collects the whole wallet later as **one Tikkie link**, or donates
some or all of it. No rewards, no receipts to photograph.

Key logic:

- The wallet is keyed by **device**, read through `bin-tikkie`
  (`walletAction`).
- The tile shows the total owed: balance plus every uncollected link.
- **Collect reopens an uncollected link instead of minting a new one**,
  because a Tikkie link cannot be cancelled and a second link covering the
  same money would pay twice. The rest of the wallet gets its own link once
  the first is collected.
- **Donate** (`bin-tikkie` action `donate` → `wallet_donate()`) sweeps every
  credit into one `donation` claim and hands the remainder back as a
  `wallet_change` claim, which the wallet counts like a receipt.
- Logging in moves the account onto this phone (`adoptAccountOnDevice`),
  bringing this phone's earlier receipts with it.
- The account page is the shared `UserPage` with this mode's own handlers.

### 6.4 What each mode shows

| | Deposit Rewards | Bring Your Own | Deferred Tikkie |
|---|---|---|---|
| Unit of value | cups | cups | money (EUR) |
| How value arrives | receipt QR, bin, staff code | counter Static QR, staff code | bin receipt QR, Static QR |
| Rewards / cashback on receipts | yes | yes | no |
| Direct refund | if switched on | if switched on | the whole app is a refund |
| Donations | if switched on | if switched on | yes |
| Cup sharing | if switched on | if switched on | no |
| Shared profile across venues | Stores hub | yes | no |
| Dashboard tabs | all | all | a reduced set (`modes` on each tab) |

---

## 7. The customer app

### 7.1 Booting a venue

1. `main.jsx` routes `/<slug>/` to `App.jsx`.
2. The venue (or group) is looked up by slug; its published config loads.
3. If the venue is Deferred Tikkie, the wallet (`TikkieHomePage`) takes over.
4. Otherwise `getOrCreateUser()` finds or creates this device's `users` row
   for this venue (by login first, then by device id), consolidates a
   signed-in person's rows, resolves the group identity, and shows the home.
5. Query parameters trigger actions: `?batch=` (claim a receipt), `?cups=`
   (backup cups), `?byo=1[&loc=]` (Static QR scan), `?preview=1` and
   `?uxpreview=<screen>` (read-only previews for the dashboard).

### 7.2 Screens (rewards modes)

`home`, `user` (account), `stores` (group hub), `receipt` (photograph a
receipt), `verifying`, `success`, `rejected`, `cup-scan` /
`cup-scan-success` / `cup-scan-error`, `voucher`, `refund-success`,
`donate-success`. Sheets over them: sign-in, direct refund, donate, share
cups, terms, how it works, FAQ, privacy policy, cookie choices.

The **home screen**'s sections and their order are set per venue in the
dashboard (Client app → Sections, §11) and read through `homeOrder()` in
`src/lib/appLayout.js`.

**Smart sorting** (`featureSmartSorting`) features the reward nearest the
customer's balance, so someone with one cup sees an achievable goal.

### 7.3 The account page (`UserPage`)

Profile (animal avatar, name, email), the balance and its value, impact
(CO₂ avoided: 72 g per cup), activity and claims, and two lists:

- **Help**: Contact support, How does it work?, FAQ, and **What is Tikkie?**
  wherever cashback is paid as a Tikkie link (NL, not voucher).
- **Data & privacy**: Privacy & cookie policy, Manage cookie choices,
  Export my data (a CSV generated in the browser), **Sign out** (only when
  signed in), Delete my account.

### 7.4 The Deferred Tikkie wallet

One page with sheets: the wallet tile (available to collect), Collect and
Donate buttons, Save your balance (Google or email), the activity list,
*How you get paid* (above activity for a first-time visitor, below it once
there is activity), impact, and a map of smart bins nearby. Every sheet on
top reports itself as the "screen" for analytics.

### 7.5 Cookie consent

A banner with three categories: technical (always on), analytical, and
marketing. **Analytical** gates all usage analytics (`client_events`,
heatmaps, replays). Marketing email consent is separate and opt-in only
(§8.6).

### 7.6 Previews

The dashboard embeds the real customer app in an iframe for its previews
and heatmaps, using `?preview=1` or `?uxpreview=<screen>`
(`isAppPreview()` in `src/lib/isPreview.js`). A preview boots read-only: no
auth, no account, no writes, no cookie banner, no camera, and it never
records itself into analytics. Deferred Tikkie's preview receives the
dashboard's unpublished draft through `useDraftPreview()`.

---

## 8. Accounts, identity and sign-in

### 8.1 Anonymous first

No email is needed to collect cups. The device id owns an anonymous
`users` row. An email is asked for only when money leaves (a cashback claim
or a direct refund), or when the customer chooses to save their balance.

### 8.2 Two doors into one account

- **Email code**: Supabase sends a 6-digit code; typing it signs in.
- **Sign in with Google** (`src/lib/oauth.js`, `GoogleSignIn.jsx`).

Supabase Auth links an email login and a Google login with the same
verified address automatically, in either order, so a customer is never
told "this email is taken". The Google button shows only when Google is
switched on for the project (read from `/auth/v1/settings`).

Google leaves the app and comes back, so the reason for the trip is kept in
sessionStorage as an **intent** (`pp_oauth_intent`: kind, pending claim or
refund, venue, receipt, marketing tick, starting path). On return:

- rewards modes: App.jsx's auth listener consolidates the account and
  carries on into any waiting claim or refund, with **no screen of its own**;
- Deferred Tikkie: `bin-tikkie` action `oauth_login` moves the wallet onto
  this phone, again with no screen;
- only a failed return shows a sheet.

**Landing at the wrong venue**: Supabase returns to the requested address
only if it is in its Redirect URLs list, otherwise to the Site URL, which is
another venue. `main.jsx` bounces such a return back to where it started
(`misroutedReturnTarget`). `https://perks.packback.network/**` must stay in
Supabase's Redirect URLs.

### 8.3 The sign-in sheet

One short form in every mode: a title, *Continue with Google*, "or", an
email field, one button, the marketing opt-in, and one line naming the
Privacy Policy. New and returning customers use the same form: an address
that already has cups signs in to them, or (at venues that ask for no code)
goes to *This email already has cups*, which verifies by code or Google and
combines the cups. Every successful sign-in goes straight back to the app.

Venues can switch off email verification (`requireEmailVerification`); then
an email is saved directly, unless it already belongs to another account.

### 8.4 What each kind of sign-in may do

| Signed in with | Offered |
|---|---|
| Google | *Use a different Google account*, *Sign out*. No *Change email*: the address is Google's. |
| An email code | *Change email* (confirmed by a link to the new address), *Sign out*. |

Changing to the address already on the account is refused before anything
is sent. The rewards apps read how this session signed in from the token's
`amr` claim; the Tikkie wallet reports `signed_in_with`.

### 8.5 Sign out

Signing out ends the login (local scope, so other phones stay signed in)
**and forgets the device**: the device id, the Tikkie wallet profile, the
avatar, region and claim bookkeeping (`signOutThisDevice` →
`forgetThisDevice`). Cookie choices and every dashboard and staff key stay.
The app reloads as a new visitor; the cups stay with the account and come
back on the next sign-in. It replaced "Reset this device", which wiped all
browser storage (signing out the dashboard too) and stranded the cups of
anyone without an email. Deferred Tikkie signs out through `bin-tikkie`
`sign_out`, which frees the phone; an anonymous wallet cannot be signed out
of, because that would strand the money.

### 8.6 Marketing consent

Opt-in only. It comes from a box or switch the customer turns on: the
sign-in form (carried to Google in the intent), the save-your-balance form,
Edit profile, or the cookie banner's Marketing switch (recorded only when
changed there). It is never pre-ticked, never derived from "Accept all",
and a stored cookie choice is never re-applied onto the account.

### 8.7 Identity consolidation

A person's rows can multiply: several venues, several phones, in-app
browsers. On every sign-in, `consolidate_identity` (via the
`consolidate-identity` function) gathers all rows belonging to the login,
plus unclaimed rows on this device that have no email or the same email
(migration 069), points them at one canonical identity carrying the login,
and merges duplicate per-venue rows so each venue shows one balance.

Merging is rate-limited per venue per week (`merge-guard`,
`merge_requests`); a merge over the limit waits for review in the
dashboard. The dashboard can also merge users by hand (`admin-merge-users`).

### 8.8 Deleting an account

Always an edge function, never SQL, because removing the login needs the
Auth Admin API: `delete-my-account` (the customer) and `admin-delete-user`
(the dashboard). Both call `erase_customer_rows()`, which deletes the
person and their photos but **keeps their claims, anonymised**, as the
payout ledger.

---

## 9. Cups: how they are created and claimed

| Source | How | Function |
|---|---|---|
| Printed deposit receipt | Dashboard → Dynamic QR code mints a batch; the receipt is printed | `generate-cups` |
| Smart bin | The bin prints a QR of its own session UUID and calls PackPerks | `bin-mint-batch` |
| Counter Static QR (Bring Your Own) | Scan `/<slug>/?byo=1`; one cup per scan, within the limit | `byo-mint` |
| Staff app | Staff make a 15-minute code on their phone | `staff-app` |
| Backup cups | 10 reserved reusable cup ids a bin prints when offline (`?cups=`) | `claim-cups` with cooldown and daily cap |
| Cup sharing | A customer gives cups to a friend as a link | `share-cups` |

**Claiming**: the customer app calls `claim-cups` with the batch or cup ids.
It activates each cup, increments the balance, and writes an audit row to
`cup_scans` for every attempt, success or failure. `cups` is readable only
by dashboard accounts (migration 051), so nobody can list unclaimed cups.

**Static QR limit**: per venue, `app_config` `byo:cap:<orgId>` =
`{ cap, windowMinutes }` (the older `windowHours`/`dailyCap` are still
written in step). Two cups a day by default. Scans over the limit wait for
review (`byo_cup_requests`) in rewards modes; in Deferred Tikkie nothing is
added. The customer is told only that the limit is reached, never numbers.

**Printed batches** can be revoked, restored or given an expiry only
through `admin_set_cup_batch` (migration 052); `cups` has no update policy.

**Receipt designs** (Dynamic QR code → Design): a tall thermal receipt plus
four landscape artworks (Banknote Simple, Banknote Full, Willy Wonka,
Ticket). Each is one self-contained SVG (`renderDesign()`) that the
preview, JPG, PDF, browser print and Epson thermal printer all rasterise,
so they cannot drift. On the thermal printer the sheet is turned a quarter
turn so the QR is large enough to scan.

---

## 10. Rewards, claims and payouts

### 10.1 Cashback on a reward

1. The customer unlocks a reward (enough cups) and buys the item.
2. They photograph the receipt (`ReceiptPage`); the claim is created.
3. **`verify-receipt`** runs Claude on the image:
   - moderation first (Claude Haiku): is the image safe to show a person?
   - then one Claude Sonnet call with three short-circuiting checks:
     **is it a receipt**, **is it authentic** (real, recent, the venue's,
     not AI-generated or edited), **does it contain the reward item**.
   - The verdict and status are written onto the claim. Rate limits per
     claim and per user bound abuse.
4. A person reviews in the dashboard (Claims) and approves or rejects.
5. On approval, **`tikkie-cashback`** mints a real Tikkie link and stores it
   on the claim. The customer sees it in the app (never in an email) and
   collects it by entering their IBAN on Tikkie's page.
6. Rejections email the reasons (`send-claim-rejection`).

**Budgets** (`org_reward_budgets`): a venue can cap reward spend; when it
runs out the app pauses claims and says so (`BudgetPausedModal`).

### 10.2 Other ways money leaves

All go through SECURITY DEFINER functions that check the caller owns the
account: `create_cashback_claim`, `refund_all_cups` (direct refund),
`donate_cups`, `redeem_voucher`. Amounts are always computed from the
published config, never from the request.

### 10.3 Rates

`src/lib/rates.js` (`effectiveRates`) gives cashback and refund per cup.
Everything that shows or charges a rate reads it there, and the database
mirrors it in `venue_refund_rate()`. They change together.

### 10.4 Payment method

`src/lib/paymentMethods.js`: `tikkie` (cashback after review) or `voucher`
(a slider voucher redeemed at the counter). Resolved org → group → default.

### 10.5 Tikkie links: status and expiry

- A link's real state lives at ABN AMRO: `created`, `redeemed`, `expired`.
  `tikkie-webhook` hears a collection within seconds (once the subscription
  is registered), `tikkie-sweep` checks open links every 15 minutes, and the
  Claims page can refresh one claim.
- **A link cannot be cancelled** and its expiry is the campaign's end date,
  the same for every link.
- PackPerks adds **its own deadline** per claim (`claims.expires_at`,
  migration 063): Settings → Rules & limits → *When unclaimed money expires*
  (`payoutExpiryMonths`, `rewardExpiryMonths`; three months by default,
  0 = never). Past it, the app offers nothing and reports count the money as
  never claimed.
- `src/lib/payoutLink.js` (`payoutLinkState`) is the one place that decides
  whether a link is collected, expired, open, waiting or failed; the app
  never offers a dead link.

---

## 11. The admin dashboard

`/admin`, behind a login. Sidebar (`TABS` and `TAB_GROUPS` in
`src/admin/lib/access.js`):

| Group | Tabs |
|---|---|
| **Analytics** | Dashboard, User analytics, System health, Reports & alerts |
| **Customers** | Users, Rewards & offers, Client app, Email templates, Future vendors, Smart bin locations |
| **Generate** | Static QR code, Dynamic QR code, Receipt generator, Staff app |
| **Circulation** | Cup scans, Claims, Tikkie payouts, Cup shares, Donations, Backup cups |
| **Workspace** | Settings, Master settings, Help & support, Version history, MockupMaster, PackPulse |

Each tab's `modes` hides it where a programme has no use for it, and a
setting with a tab (cup sharing, donations) hides that tab when off.
`tabAvailability()` is the one place that decides whether a tab shows.

What the main tabs do:

- **Dashboard / System health / User analytics**: one shared layout taken
  from PackPulse: KPI tiles, a trend chart driven from the tiles, an
  Insights card, and detail cards. Readers: `getAdminStats`,
  `getStatsMetrics`, `getUserBehaviourStats` (all in `adminApi.js`).
  Deferred Tikkie's dashboard rebuilds activity from claims.
- **Reports & alerts**: scheduled report emails and real-time alerts
  (§15).
- **Users**: every customer, their balance, sign-in method (Google, email
  code, both, or saved without signing in), merges and deletion.
- **Rewards & offers**: the venue's rewards and budgets.
- **Client app**: colours, logos, copy, and **Sections**: drag the home
  screen's sections into order and switch them off, plus buttons and the
  account screen. A phone preview shows the draft.
- **Email templates**: the customer emails, with test sends to yourself.
- **Static / Dynamic QR code, Receipt generator**: §9.
- **Staff app**: §13.
- **Claims**: review, approve, reject, refresh Tikkie status.
- **Tikkie payouts**: every link, *Check open links*, webhook connection.
- **Settings**: features, payouts, rules and expiry, locations, privacy
  policy, verification, data capture.
- **Master settings** (masters only): people, roles, organisations, groups,
  regions, workspace switches, data purge, PackPulse connections.

**Publishing**: the dashboard edits a local draft and *Publish* writes the
whole settings object to `published:<orgId>`. See §23.

**Demo numbers**: a switch that replaces every reader's data with a
generated dataset (`demoData.js`, `uxAggregate.js`) for sales demos.

---

## 12. Roles and access

Every dashboard account holds one role from `admin_roles`. A role has a
**level** and, per tab, `hidden`, `view` or `edit`.

| Level | Who | Scope |
|---|---|---|
| **master** | PackBack staff | Every organisation, every tab, Master settings. Only masters add people, roles, organisations, or delete records. |
| **manager** | Runs some venues | The organisations on their account (`org_ids` or `all_orgs`). Built-in roles: Manager (edits everything), Viewer (views everything). |
| **vendor** | The venue's own people | Read-only reporting by default. |

Masters can create custom roles at manager or vendor level. Workspace
switches (`workspace:tabs`, `workspace:topbar`, `workspace:display`) turn
tabs, top-bar items and display features off for everyone.
`#overview?as=vendor` previews the vendor view.

**What the database enforces**: the level (`is_master()`), whether an
account can write at all (`is_staff_writer()`), and who manages people,
roles, organisations and workspace switches. **Which tab a role may
change, and which venues it sees, is enforced only by the dashboard**: see
§20. Minting cups and creating payouts stay master-only through the old
`admin_profiles.role` column, kept in step by a trigger.

See `docs/roles-and-features.md` for the full matrix.

---

## 13. PackPerks Staff

A phone web app at `/staff` for counter staff, on for a venue only when
`organizations.staff_app_enabled` is set (NYU Abu Dhabi first).

- **Signing in** starts with the email (`lookup`): `@packback.network`
  addresses always use an emailed 6-digit code; an account with a password
  is asked for it; someone added or approved sets a password with a code;
  anyone else picks a venue and **requests access**, which anyone who can
  view the venue's Staff app tab approves.
- **Making a code**: a staff code is an ordinary cup batch that expires
  after 15 minutes, logged in `staff_qr_codes` with who made it. The
  customer scans it like a printed receipt (`/<slug>/?batch=<id>`).
- The app wears the venue's colours and logo, uses its own Supabase client
  and session (`pp-staff-auth`), and never reads tables directly:
  everything goes through the `staff-app` edge function.
- Venues manage it in Generate → Staff app: the switch, accounts and
  requests, a log of every code, and a preview with sample data.

---

## 14. Analytics, heatmaps and session replay

### 14.1 What is captured

Only from customers who turned the **Analytical** cookie category on.

| Data | Table | Writer |
|---|---|---|
| App events (opens, taps on key actions, funnels) | `client_events` | customer app |
| Taps, scroll depth, screen views, visit end | `ux_events`, `ux_sessions` | `ux-ingest` |
| Where the controls were on each screen | `ux_layouts` | `ux-ingest` |
| Session recordings (rrweb) | `ux_replays` | `ux-ingest` |

Never captured: anything typed (inputs are masked in the browser before
sending), field contents, a pointer trail, or the profile block
(`[data-ppk-private]`). Control labels that look personal are masked.

**A tap is anchored to the control it hit**, not to a page position: it
stores the control's key and where inside the control the finger landed.
The dashboard reads the control's real position in the embedded app and
puts the tap back on it, so heat lands on the button whatever the page
height. The control key never contains a value (`src/lib/uxKeys.js`,
shared by app and dashboard).

**Per-venue switches**: `ux:capture:<orgId>` =
`{ enabled, sample, clicks, scroll, replay, layouts, retentionDays }`, read
by `ux-ingest` before it stores anything. All on by default; taps kept 60
days by default. Ingest is capped (300 rows per batch, 3,000 per visit, 300
new visits per IP per hour).

### 14.2 User analytics: four tabs

- **Programme**: scanning, returning, claiming.
- **User flow**: taps per visit, time to first tap, scroll reach, where
  visits go next, app opens, time per visit, where visits end.
- **Heatmap**: taps, scroll bands or control use over the venue's real app
  running in a phone frame (`ScreenFrame`, `DeviceChrome`), always for one
  device type, with a table of every control.
- **Session replay**: the visit itself, rebuilt by rrweb's `Replayer`, with
  each tap drawn as a pulse, a list of everything the customer did beside
  it, and one timeline with a mark per action. Visits without a recording
  step through the actions over today's app.

The dashboard reads sums through SECURITY DEFINER functions
(`ux_screen_summary`, `ux_heatmap`, `ux_scroll_curve`, `ux_targets`,
`ux_target_series`, `ux_flow`), each guarded by `ux_guard()`.

---

## 15. Emails and notifications

All email goes through **Brevo** from edge functions.

| Email | Trigger | Function |
|---|---|---|
| Sign-in / verification code | Customer asks for a code | Supabase Auth |
| Claim received | Claim goes to review | `send-claim-confirmation` |
| Claim not approved | Admin rejects | `send-claim-rejection` |
| Receipt being checked / now valid | Bin receipt scanned before the bin's call landed | `bin-mint-batch` |
| Deferred Tikkie login and save codes | Wallet login / email change | `bin-tikkie` |
| Staff sign-in codes | Staff app | `staff-app` |
| Admin alerts | Database triggers on configured events (claim, new account, cup scan, held requests) via `pp_notify_event` → pg_net | `notify-event` |
| Weekly / scheduled digests | pg_cron daily at 08:00, sends per config (vendor and staff audiences) | `send-digest` |
| Automated reports | Reports & alerts config | `send-report` |
| Template test sends | Email templates page | `send-test-email` |
| Support form | `/support`, `/vendor-support` → info@packback.network | `send-support` |

Payout links are shown in the app, never put in an email. Push
notifications were removed; `notify_push` stays and is always false.

---

## 16. Integrations with other systems

### 16.1 Smart bins

`docs/SMART_BIN_INTEGRATION.md` has the full contract. In short:

- The bin runs one session per customer, mints a UUID v4 per cup and one
  for the session.
- **Print first**: it prints the QR `…/<slug>/?batch=<session_id>`
  immediately, then calls `bin-mint-batch` with header `X-Bin-Key` and
  `{ cups, session_id, cup_uuids }`, retrying until it lands.
- The session UUID **is** the batch id. If a customer scans before the call
  arrives, they see "we're checking your receipt" and can leave an email;
  when the call lands the receipt becomes valid and they are emailed.
- Bin keys live in `smartbin_keys`; bin sessions in `bin_sessions`; bin
  locations (for the customer map) in `smartbin_locations`.
- Offline bins print **backup cups** (`?cups=`): 10 reserved, reusable cup
  ids, guarded by a cooldown and a daily cap, with an alarm page and email
  alerts (`backup_cups`, `backup_cup_uses`).

### 16.2 Tikkie (ABN AMRO)

`docs/TIKKIE_INTEGRATION.md`. The Tikkie Cashback API mints a `tikkie.me`
link the customer opens to enter their IBAN and get paid.

- `tikkie-cashback` is the only holder of the Tikkie secrets. Actions:
  `create`, `status`, `campaign`, `subscribe`, `unsubscribe`.
- `tikkie-webhook` is public; Tikkie posts "something happened" and the
  function re-fetches the real status, so a spoofed call can do nothing.
- `tikkie-sweep` (every 15 minutes) is the safety net and backfill.
- Links are minted from one campaign managed at ABN AMRO; a link cannot be
  cancelled, and every link expires on the campaign's end date.
- Deferred Tikkie mints per payout (the whole wallet), inside `bin-tikkie`.

### 16.3 UAE payouts

`uae-payout` is a provider-agnostic adapter selected by the
`UAE_PAYOUT_PROVIDER` secret. **Not live**: the mechanism (hosted link or
direct push) is undecided, so UAE copy promises only that cashback is sent
(`payoutCopy()`, `direct` style). Provider research is in
`docs/PAYOUT_PROVIDER_*.md` and `docs/PAYMENT_PROVIDER_REQUIREMENTS_UAE.md`.

### 16.4 Google

Google Cloud OAuth client (web) → Supabase → Authentication → Providers →
Google, callback `https://ozvcpbthnauitaphosfb.supabase.co/auth/v1/callback`.
Google sign-in is also used by the dashboard's `bootstrap-admin` path.

### 16.5 Anthropic Claude

`verify-receipt` uses Claude Haiku for image moderation and Claude Sonnet
for the three receipt checks, with tool calls so the verdict is structured.
Secret: `ANTHROPIC_API_KEY`.

### 16.6 Brevo

Transactional email for every function in §15. Secrets: `BREVO_API_KEY`,
`BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`. Setup: `docs/EMAIL_SETUP.md`.

### 16.7 PackPulse

PackPulse is PackBack's operations platform. It can show one PackPerks
venue's Dashboard, User analytics, System health and Reports & alerts,
read-only, inside an iframe. Full design: `docs/packpulse/INTEGRATION.md`.

1. A master creates a one-time code for a venue (Master settings →
   PackPulse).
2. PackPulse's server claims it through `packpulse-link` and receives a
   link secret.
3. A master approves after comparing a 4-character confirmation code.
4. PackPulse frames `/packpulse-embed` with a one-time ticket that signs in
   the connection's own login (`link-<id>@packpulse.packperks.invalid`).

That login has **no dashboard profile** and reads only the `packpulse_*`
views: its venue, shared pages, no emails, payout links, cup codes or
session recordings. In embed mode `src/lib/supabase.js` maps each table to
its view. RPCs are not remapped, so shared RPCs scope themselves through
`ux_guard()`. The embed's allowed framers are listed in `vercel.json`
(`frame-ancestors`). The prompts for PackPulse's own Claude are in
`docs/packpulse/`.

### 16.8 Printers

The dashboard prints receipts to an Epson thermal printer over its ePOS
interface (`src/admin/lib/eposPrint.js`), or through the browser.
`docs/printer-setup.md`.

### 16.9 MockupMaster

A sidebar link (Workspace → MockupMaster) to the design mockup app at
`/mockup` (`mockups` table). It is a link, never a dashboard page.

---

## 17. Data model

Main tables in the `public` schema (Supabase Postgres):

**Venues and configuration**

| Table | Holds |
|---|---|
| `organizations` | Venues |
| `org_groups` | Groups of venues |
| `app_config` | Published config per venue/group, regions, workspace switches, Static QR limits, capture settings, digests, notification centre |
| `locations` | Locations inside a venue (per-location Static QR) |
| `smartbin_locations` | Bin positions for the map |
| `smartbin_keys` | Bin API keys |
| `org_reward_budgets` | Reward spend caps |
| `store_requests` | "Future vendors": venues customers asked for |

**Customers**

| Table | Holds |
|---|---|
| `users` | One customer at one venue (device id, login, email, consent, profile) |
| `customer_identities` | One person across a group |
| `cup_balances` | Cups per user per venue |
| `activity_history` | The customer's activity feed |
| `payout_details` | A restricted IBAN table, one row per identity, reachable only by edge functions and cleared after payout |
| `email_otps` | Deferred Tikkie's own login codes |
| `merge_requests` | Account merges and those held for review |
| `consent_rejections` | Cookie rejections, counted |

**Cups and claims**

| Table | Holds |
|---|---|
| `cups` | Every minted cup |
| `cup_scans` | Every claim attempt, success or failure |
| `pending_batches` | Bin receipts scanned before the bin's call landed |
| `bin_sessions` | Smart bin sessions |
| `byo_cup_requests` | Static QR scans over the limit, awaiting review |
| `backup_cups`, `backup_cup_uses` | Offline-bin backup cups |
| `claims` | Cashback, refunds, donations, vouchers, wallet payouts; the payout ledger |
| `donation_transfers` | Donations passed on to the charity |
| `payout_exports` | Exported payout batches |
| `generated_receipts` | Test receipts from Receipt generator |

**Staff app**

`staff_members`, `staff_qr_codes`, `staff_email_codes`.

**Dashboard**

`admin_profiles`, `admin_roles`, `admin_invitations`, `admin_login_history`,
`admin_action_log` (audit), `mockups`.

**Analytics and system**

`client_events`, `ux_events`, `ux_sessions`, `ux_layouts`, `ux_replays`,
`system_events` (health and failures), `rate_limits`.

**PackPulse**

`packpulse_links`, `packpulse_tickets`, `packpulse_link_events`, plus the
`packpulse_*` read-only views.

**Schema discipline**: every change is a numbered file in
`supabase/migrations/` (69 so far) applied with `apply_migration`; one that
must wait for an app deploy sits in `supabase/pending/`. Emergency undo
scripts are in `supabase/rollback/`; a full snapshot that rebuilds the
database from nothing is in `supabase/baseline/`.

---

## 18. Edge functions

All in `supabase/functions/`, deployed through the Supabase MCP tools.

| Function | Called by | Does |
|---|---|---|
| `claim-cups` | Customer app | Activates cups for a scan, audits every attempt |
| `generate-cups` | Dashboard | Mints a batch of cup ids for printing |
| `bin-mint-batch` | Smart bin | Registers a bin session; batch id = session id |
| `byo-mint` | Customer app | One cup per Static QR scan, within the limit |
| `share-cups` | Customer app | Turns cups into a link for a friend |
| `bin-tikkie` | Deferred Tikkie wallet | The whole wallet: read, scan, collect, donate, save email, login, Google login, sign out, Static QR |
| `verify-receipt` | Customer app | Claude checks on a receipt photo |
| `tikkie-cashback` | Dashboard | Mints and checks Tikkie links; webhook subscription |
| `tikkie-webhook` | Tikkie | Collection notifications |
| `tikkie-sweep` | pg_cron, dashboard | Re-checks open links |
| `uae-payout` | Dashboard | UAE payout adapter (not live) |
| `check-email-save` | Customer app | Saves an email unless another account has it |
| `consolidate-identity` | Customer app | Unifies a person's rows on sign-in |
| `merge-by-email`, `restore-by-email` | Customer app | Older merge paths |
| `merge-guard`, `merge-status` | Customer app | Weekly merge limit and held merges |
| `admin-merge-users` | Dashboard | Manual merge |
| `delete-my-account` | Customer app | Self-service erasure |
| `admin-delete-user` | Dashboard | Erasure from the dashboard |
| `bootstrap-admin` | Dashboard sign-in | Creates or loads an admin profile; consumes invitations |
| `invite-admin` | Master settings | Invites a person with a role and venues |
| `staff-app` | Staff app, dashboard | Everything the staff app does |
| `ux-ingest` | Customer app | Taps, scrolls, screens, layouts, recordings |
| `packpulse-link` | PackPulse, dashboard | Connection setup and embed tickets |
| `notify-event` | Database triggers | Admin alert emails |
| `send-digest` | pg_cron | Scheduled digests |
| `send-report` | Dashboard, schedule | Automated reports |
| `send-claim-confirmation`, `send-claim-rejection` | Customer app, dashboard | Claim emails |
| `send-test-email` | Dashboard | Template previews to yourself |
| `send-support` | Support forms | Contact emails |

Secrets (Supabase → Edge Functions): `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `ANTHROPIC_API_KEY`,
`BREVO_*`, `TIKKIE_*`, `UAE_PAYOUT_*`, `APP_BASE_URL`, `ALLOWED_ORIGIN(S)`.

---

## 19. Scheduled jobs

pg_cron, inside the database:

| Job | Schedule | Does |
|---|---|---|
| `packperks-data-retention` | daily 03:15 | `run_data_retention()`: deletes data past its retention period, including taps and recordings (`ux_run_retention`) |
| `tikkie-status-sweep` | every 15 minutes | Calls `tikkie-sweep` |
| `weekly-digest-send` | daily 08:00 | Calls `send-digest`, which sends what is due |

Real-time alerts are not scheduled: database triggers call `notify-event`
through pg_net.

---

## 20. Security model

**The anon key ships in the customer bundle and is treated as public.**
What it can do was closed in two stages, both live since 16 September 2026:

- **Stage 1 (migrations 043–045)**: the key cannot move money or change
  dashboard data. Amounts come from the published config; the claims
  insert trigger reprices every claim; balances only go down from the
  client; `tikkie-cashback` refuses to pay more than a reward is worth.
  Staff-only tables take writes only from `is_staff_writer()`.
- **Stage 2 (migration 046)**: customer rows, balances, history and shared
  profiles are visible and changeable only by the device that created them
  (`x-device-id`) or the login and identity they belong to
  (`request_user_ids()`). Without the header the key reads nothing.
  `supabase/rollback/046_to_stage1.sql` undoes it in an emergency.

Rules that follow: never an `anon`/`authenticated` write policy with
`true`; never let a client-sent number decide an amount; new money paths
are SECURITY DEFINER functions that call `owns_user()` and
`assert_can_claim()`.

**Guards** on customer tables act only for `anon`/`authenticated`; edge
functions (service role) and SECURITY DEFINER functions pass through.

**Org isolation is a dashboard convention, not a database boundary.**
`applyOrgFilter()` adds the venue filter in JavaScript; RLS on customer
data only checks that the caller is a dashboard account. Any signed-in
dashboard account can read every venue's rows through the API. Locations
and the audit log are the exceptions (`admin_sees_org()`). The PackPulse
connection is safe because it has no dashboard profile and reads views.

**Guards must actually run**: a guard in a CTE that nothing reads is pruned
by Postgres. The analytics readers were fixed in migration 065
(`volatile` guard, `materialized` CTEs). Test guards as `anon` against a
venue with real rows.

**Most sensitive data**: session recordings (`ux_replays`): written only
by `ux-ingest`, readable only by dashboard accounts, never shared with
PackPulse, deleted with the taps.

**Bins** authenticate with `X-Bin-Key`. **Tikkie's webhook** trusts nothing
it is sent and re-fetches status. **Edge functions** that the browser calls
check CORS against `ALLOWED_ORIGINS` and verify ownership server-side.

---

## 21. Privacy and data retention

- Lawful basis, records of processing, DPIA, retention schedule, breach
  runbook, cookie and privacy policies: see `docs/LAWFUL_BASIS.md`,
  `docs/ROPA.md`, `docs/DPIA_LITE.md`, `docs/RETENTION_SCHEDULE.md`,
  `docs/BREACH_RUNBOOK.md`, `docs/COOKIE_POLICY.md`,
  `docs/PRIVACY_POLICY.md`, `docs/UAE-EU-Compliance-Pack.md`.
- Each venue can publish its own privacy policy text (Settings), shown in
  the app.
- Customers can export their data (CSV in the browser) and delete their
  account themselves.
- Claims are kept (anonymised) as the accounting record.
- Analytics only with the Analytical cookie category; taps and recordings
  are the shortest-lived data (60 days by default).
- Master settings → Data can purge a venue's activity records by kind and
  date (`admin_purge_org_data`); customers, balances, rewards and printed
  cups are never purged there.

---

## 22. Regions and currencies

`src/lib/regions.js`. A venue's region comes from `organizations.country`.

| Region | Currency | Payout | Status | Copy style |
|---|---|---|---|---|
| NL | EUR | Tikkie | live | `link`: promises a link to collect |
| AE | AED | `uae` adapter | not live | `direct`: promises only that cashback is sent |

Region decides currency formatting (`formatMoney`), map focus, payout
provider and copy (`payoutCopy()`). Admins can edit regions in Master
settings → Regions; the overlay is published as `published:regions`.
`normalizeRegion` must carry every field or a field is lost for good.
Customers can also pick a region in Edit profile.

---

## 23. Configuration and publishing

| Key in `app_config` | Holds | Set by |
|---|---|---|
| `published:<orgId>` | A venue's rewards, settings, design, copy, policy | Dashboard Publish |
| `published:group:<groupId>` | Group settings | Dashboard Publish |
| `published:regions` | Region overlay | Master settings |
| `byo:cap:<orgId>` | Static QR limit | Static QR code page |
| `ux:capture:<orgId>` | Analytics capture switches | Capture settings |
| `workspace:tabs`, `workspace:topbar`, `workspace:display` | Global switches | Master settings → Workspace |
| `weekly_digest`, notification centre | Digests and alerts | Reports & alerts |

**Publishing writes the whole settings object** from the dashboard's draft.
A flag written straight into `published:<orgId>` with SQL is wiped by the
next publish from a stale draft, so prefer the dashboard toggles. Settings
with their own row (`byo:cap`, `ux:capture`) are safe from publishing.

**Write only the design group you change**: an empty design is the
defaults, and storing merged defaults once recoloured an unbranded wallet.

Important settings keys: `mode`, `paymentMethod`,
`requireEmailVerification`, `featureDirectRefunds`, `featureDonations`,
`featureCupSharing`, `featureStaticQr`, `featureSmartSorting`,
`tikkieActionButtons`, `payoutExpiryMonths`, `rewardExpiryMonths`,
`donationRecipient`, `privacyPolicyText`, `design` (colours, sections,
layout, copy).

---

## 24. Hosting, deploys and environments

- **Vercel** builds `npm run build` (plain `vite build`) on every push to
  `main` and serves the SPA at `perks.packback.network`; `vercel.json`
  rewrites every path to `index.html` and sets the embed's framing headers.
- **Supabase project** `ozvcpbthnauitaphosfb` holds the database, auth,
  storage and functions.
- **A push is not a deploy.** Vercel has silently skipped builds; check
  what is live by fingerprinting the bundle (fetch a venue page, find
  `index-<hash>.js`, grep it for a string from the change). An empty commit
  re-fires a missed build.
- Edge functions deploy separately, through the Supabase MCP tools, with
  the repo copy kept in step and verified by fetching the deployed source
  back.
- Code is pushed to two remotes: GitHub (`origin`) and GitLab (`gitlab`).

---

## 25. Development workflow

```bash
npm run dev     # Vite dev server on :5173
npm run build   # what Vercel runs
npm run lint    # not clean (~145 pre-existing errors); judge by the count moving
```

- Verify on the running dev server, not by a green build.
- Commit freely; push only when asked; push both remotes.
- The dashboard has no test login. Exercise its readers through the dev
  server's module graph (`import('/src/admin/lib/adminApi.js')` with demo
  mode on), or mount a component in a temporary scratch page.
- The customer app has DEV harnesses: `?__shot=<preset>` renders a screen
  with preset data and no writes (`src/lib/shotPresets.js`); `?demo=` runs
  the Tikkie wallet on sample data; `?google=1` forces the Google button.
- Test database policies in a transaction you roll back, as `anon` or
  `authenticated` with the right headers or claims.

---

## 26. Known limits and open items

- **Org isolation** is enforced in the dashboard, not the database.
- **UAE payouts** are not live; the provider is undecided.
- **Tikkie links** cannot be cancelled and all expire on the campaign's end
  date; PackPerks' own deadline is a reporting and app cutoff only.
- The **Tikkie webhook subscription** must be registered (owner-only, at
  Tikkie's end) for collections to arrive within seconds; otherwise the
  15-minute sweep catches them.
- Supabase's **Redirect URLs** must contain
  `https://perks.packback.network/**` for Google sign-in to return to the
  right venue without the bounce.
- **Merging by email** across devices for venues without verification
  relies on the code path; `consolidate_identity` does not gather rows by
  email alone.

---

## 27. Glossary

| Term | Meaning |
|---|---|
| **Backup cups** | Reserved reusable cup ids an offline bin prints |
| **Batch** | Cups minted together; the `?batch=` in a QR |
| **Bin session** | One customer's deposit at a smart bin |
| **BYO** | Bring Your Own, the counter-QR mode |
| **Claim** | A request to turn cups or a wallet into money or a reward |
| **Client app** | The dashboard tab that designs the customer app |
| **Consolidation** | Unifying one person's rows on sign-in |
| **Deferred Tikkie** | The wallet mode: money credited per receipt, collected as one link |
| **Device id** | The browser-held UUID that is an anonymous customer |
| **Direct refund** | Paying the deposit value out instead of a reward |
| **Dynamic QR code** | Single-use cup batches for receipts |
| **Group** | Venues sharing one programme |
| **Identity** | One person's shared profile across a group |
| **Intent** | What a Google round trip was for, kept in sessionStorage |
| **Master / manager / vendor** | Dashboard access levels |
| **Mode** | Deposit Rewards, Bring Your Own or Deferred Tikkie |
| **PackPulse** | PackBack's operations platform, which embeds PackPerks pages |
| **Publish** | Writing the dashboard's draft config live |
| **Smart sorting** | Featuring the reward nearest the customer's balance |
| **Stage 1 / Stage 2** | The two security hardenings of the public key |
| **Static QR code** | The counter QR in Bring Your Own |
| **Stores hub** | A group's page listing its venues |
| **Tikkie** | ABN AMRO's payment service that pays cashback to a bank account |
| **Venue** | One organisation |
| **Wallet** | A Deferred Tikkie customer's money balance |

---

## 28. Further reading

| Document | About |
|---|---|
| `CLAUDE.md` | Working notes and landmines for changing the code |
| `docs/SMART_BIN_INTEGRATION.md` | The bin's API contract |
| `docs/TIKKIE_INTEGRATION.md` | Tikkie setup and moving parts |
| `docs/packpulse/INTEGRATION.md` | PackPulse connection design |
| `docs/roles-and-features.md` | Who reaches which tab |
| `docs/receipt-designs.md`, `docs/printer-setup.md` | Receipt artwork and printing |
| `docs/EMAIL_SETUP.md` | Brevo and email setup |
| `docs/admin-guide/` | Guides for dashboard users |
| `docs/FAQ.md` | Customer FAQ |
| `docs/HANDOFF.md` | A dated snapshot of state of play |
| Privacy and compliance set | `PRIVACY_POLICY`, `COOKIE_POLICY`, `ROPA`, `DPIA_LITE`, `LAWFUL_BASIS`, `RETENTION_SCHEDULE`, `BREACH_RUNBOOK`, `UAE-EU-Compliance-Pack` |
