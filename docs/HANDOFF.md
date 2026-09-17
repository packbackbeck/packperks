# Handoff — state of play, 17 September 2026

A snapshot for whoever picks this up next. Durable guidance lives in
`/CLAUDE.md`; this file is the "where we are right now" half and goes stale.

---

## Recent work

### 1. Dashboard redesign, roles and Master Settings (17 Sep)

The dashboard now follows PackPulse's layout and access model.

- **One look for the stats pages.** Dashboard, System health and User
  behaviour each have KPI tiles, a trend chart you drive from the tiles
  (single, pairs, compare; line/area/bar/table; weekends, previous period,
  CSV), an Insights card beside it, and detail cards below. The design system
  is in `src/admin/ui/`.
- **Shell.** The sidebar groups its tabs (Analytics, Customers, Programme,
  Smart bin, Workspace) under labels, with the organisation switcher at the
  top and the account at the bottom. The top bar has a new programme badge, and
  a green cashback/refund badge where the settings gear used to be.
- **Sign-in page** in PackPulse's layout: the form on the left, a dark panel
  with the pulse animation and screenshots of the dashboard and the phone app
  (`src/assets/images/login/`).
- **Roles (migration `048`, applied).** Three levels: master, manager, vendor.
  Roles live in `admin_roles`, with hidden/view/edit per tab; accounts carry
  `access_role`, `org_ids` and `all_orgs`. Owner and admin became masters.
  The four managers became managers who still see every organisation. The
  built-in Viewer role replaces "checker". 110 rolled-back checks passed
  before applying.
- **Master Settings** (masters only): People (invite, role, organisations,
  block, remove), Roles & permissions (the tab matrix, custom roles),
  Organisations (profile, programme, archive, groups, regions), Workspace
  (switch a tab off for everyone) and the Activity log.
- **Settings** starts with Features, one tile and switch each. Switching off
  cup sharing or donations hides its tab. Then Payouts (payment method,
  rates, budget), Rules & limits, Locations, and Legal (the in-app privacy
  policy, which had no editor). The home-screen headline and donation text
  moved to Design & copy, so nothing is edited in two places. The unused
  privacy/terms/cookie URL fields are no longer shown.
- `activeGroupId` was missing from the organisation context. The old
  Settings page therefore never showed the group switches and never locked
  the programme for grouped venues.

### 2. Architecture audit and the fixes that followed (16 Sep)

An audit of the whole system turned up one critical problem, five high, eight
medium and twelve low. What was done about them:

**Critical: the public (anon) key could move money.** Closed in two stages
(details in `/CLAUDE.md`, *Landmines*).
- Stage 1 is **live**: migrations `043_close_public_write_paths`,
  `044_app_config_public_read` and `045_helper_function_grants`. Amounts are
  priced on the server, balances only go down from the client, dashboard data
  takes staff writes only, and `tikkie-cashback` (v17) refuses to pay more than
  a claim's reward is worth. Tested in rolled-back transactions against the
  live data (80/80) before applying.
- Stage 2 is **live** too (migration `046`), applied the same day once the
  app that sends `x-device-id` was confirmed deployed: without a device
  header the public key reads nothing, a device sees only its own rows, and
  payout links reach only their owner. 56 of 59 rolled-back checks passed
  before applying; the three misses were mistakes in the checks, not the
  rules. First and returning visits on the live site worked
  afterwards, and the API logs showed no failed requests.
  `supabase/rollback/046_to_stage1.sql` undoes it in an emergency.
- No email is needed to collect cups. It is asked for when a customer claims
  cashback or a refund (and verified where the venue requires it). Payout
  links show in the app only.

**High**
- Deleting an account now keeps the claims, anonymised, as the retention
  schedule requires (`erase_customer_rows`).
- Dashboard delete removes the login too: new edge function
  `admin-delete-user`. The dashboard calls it from the next deploy on.
- The repo can rebuild the database again: `supabase/baseline/`.
- Push notifications are gone; customer notifications are email only.
- Missed Vercel deploys: left as is (check the live bundle after a push).

**Medium**
- One set of names everywhere: Deposit Rewards, Bring Your Own, Deferred
  Tikkie. Staff copy and the landing page describe the current flows.
- Rates come from one place (`src/lib/rates.js`) and the database mirrors it,
  so a rate changed in Settings shows the same everywhere and pays the same.
- A group with no mode is Bring Your Own.
- The UAE payout provider is labelled as unavailable until one is chosen.
- Kept as they are: 30 map pins for 2 bins, and the Tikkie webhook (no
  decision yet).

**Low**
- The three retired edge functions (`create-claim`, `delete-account`,
  `payout`) now answer 410 and their source is removed. They still need
  deleting in the Supabase dashboard (Edge Functions → ⋯ → Delete).
- KFC is a Deposit Rewards venue with real menu items at 1 cup = €1.
- Countries are stored as full names (`Netherlands`).
- Titaan (Phase 1) is in maintenance mode.
- `screen-audit/` is no longer versioned; the files stay on disk.
- Unused `src/emails/tikkieReadyEmail.js` removed.
- Emails and receipt checks use the venue's currency (AED for UAE venues).
- Function search paths pinned (`042`, and `config_number` in `045`).
- `.claude/launch.json` is now in the repo.

**Follow-ups the same day**
- The dashboard audit log records again (migration `047`). Its rules
  compared the entry's venue with the account's, and staff accounts have
  none, so nothing was logged from 31 July. Staff now log under any venue, a
  vendor only under its own, a customer login not at all; owners and admins
  read the whole log. The activity screen also shows entries tied to no
  venue, and staff authors' names.
- Marketing consent is opt-in everywhere: the email form, the Deferred
  Tikkie "save your balance" form and the cookie banner's Customize page
  start unticked. "Accept all" no longer grants marketing emails (its page
  only describes analytics), and the banner's stored choice no longer
  overwrites the account's on every page load; only a change made in the
  banner is recorded.
- NYU Abu Dhabi has a new logo, served from `public/brand/nyuad.png`
  (`logo_width` 110, the height of the header buttons).

### 3. Slider voucher (8 Sep)

A second payment method beside Tikkie cashback: a full-screen voucher at the
counter, slide to confirm. `VoucherPage.jsx`, `SlideToConfirm.jsx`,
`redeem_voucher()` (now priced on the server, see above).

### 4. UAE, the vendor role, the dashboard's currency (9–10 Sep)

AED everywhere for UAE venues (`adminMoney`), a read-only vendor role with
three pages, and a "Demo numbers" toggle. `normalizeRegion` dropping
`payoutStyle` was the root of the wrong UAE copy.

---

## Live demo setup

NYU Abu Dhabi is the pitch venue: `vendorDemoNumbers: true`, payment method
`voucher`, region AE. Preview (staff login needed):

```
https://perks.packback.network/admin?org=nyuad#overview?as=vendor
```

KFC: `https://perks.packback.network/kfc/`

---

## Open items

**Two edge functions are written but not deployed:** `invite-admin` (v3:
roles and organisation lists, masters only) and `bootstrap-admin` (applies
them on first sign-in). The deploy was held for approval. Until they are
live, the dashboard still writes the exact role and organisations onto each
invitation. But the live `bootstrap-admin` gives a new non-vendor person
every organisation on first sign-in, so set their organisations in People
afterwards.

**Shareable-link invitations don't work end to end.** Sign-in only matches
invitations by email, and the sign-in page only creates accounts for
@packback.network. People → Add person sends email invitations only.

**Per-tab "view only" is enforced by the dashboard, not the database.** The
database only knows whether an account can write at all. The dashboard checks
the tab in Settings, Master Settings, Rewards, Design & copy, report
alerts, the Publish button and the actions behind `PermissionGate` (approve
claims, adjust balances). Other pages still show their edit buttons to a role
that can only view them.

**Managers still see every organisation** (as before the roles change).
Narrow them in Master Settings → People.

**Leaked-password protection is still off** according to Supabase's advisor
(Authentication → Password security).

**Three pending La Place claims will be refused at payout**, because the cap
now pays no more than the reward is worth: two for €10.00 on a reward that is
now €0.50, and one for €3.20. Review them by hand.

**Marketing consent recorded before 16 Sep is doubtful.** Until then the
email form's box started ticked and "Accept all" on the cookie banner set
marketing consent. On 16 Sep, 124 customer rows had it on (28 with an
email): 94 from the banner (`source = 'app'`), 22 from the pre-ticked box
(`signin_popup`), 8 from the wallet form (no source). Decide whether to reset
those to off, or ask again, before sending any marketing email.

**Org isolation is still a UI convention.** A vendor or scoped manager can
read every venue's customer rows through the API. Enforcing `org_ids` in the
policies (`admin_sees_org()` exists since 048) is the next step.

**Three Titaan 2 reward photos don't load** (Lipton, Knorr): they point at
`assets.unileversolutions.com`.

**Smaller**
- The rejection email says the cups are still on the balance; cashback cups
  are deducted while the claim is pending.
- Donations are recorded as activity only, and the Donations page estimates
  €1 per cup.
- Voucher redemptions don't ask for an email (by design so far).
- KFC prices are from one Amsterdam store; other stores will trip the
  receipt price check.
- The old screenshots are still in git history.
- A stale dashboard draft for KFC would overwrite the menu set in SQL on its
  next publish.

**Terms copy is wrong for voucher venues.** "The fine print" still describes
uploading receipts and collecting a Tikkie link.

**PackPulse integration** — plan at `docs/packperks-in-packpulse.md`. Not
started.

---

## Things that will bite

Short version; the reasoning is in `/CLAUDE.md` under **Landmines**.

- A push is not a deploy. Vercel has silently skipped triggers — fingerprint
  the live bundle before believing a change is out.
- Publishing from the dashboard overwrites settings written directly in SQL.
- `eslint` is not clean and never was (~205 errors in `src/`). Compare
  counts, don't chase zero.
- There is no admin test login. Verify admin work by importing `adminApi`
  through the dev server's module graph, or with a throwaway harness page.
- Test database rules inside a transaction that ends in `rollback`.
