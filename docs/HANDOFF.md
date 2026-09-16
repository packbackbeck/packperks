# Handoff — state of play, 16 September 2026

A snapshot for whoever picks this up next. Durable guidance lives in
`/CLAUDE.md`; this file is the "where we are right now" half and goes stale.

---

## Recent work

### 1. Architecture audit and the fixes that followed (16 Sep)

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
- Stage 2 is **written, tested and waiting**: `supabase/pending/046_…` binds
  customer rows to the device header. Apply it only after the app build that
  sends `x-device-id` is live.
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

### 2. Slider voucher (8 Sep)

A second payment method beside Tikkie cashback: a full-screen voucher at the
counter, slide to confirm. `VoucherPage.jsx`, `SlideToConfirm.jsx`,
`redeem_voucher()` (now priced on the server, see above).

### 3. UAE, the vendor role, the dashboard's currency (9–10 Sep)

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

Its logo URL (`savant.qmul.ac.uk`) now redirects to an HTML page, so the logo
is broken in production. Upload a copy to `reward-images` and point the venue
at it.

KFC: `https://perks.packback.network/kfc/`

---

## Open items

**Deploy, then Stage 2.** Until the current `main` is live and 046 is applied,
the public key can still read customer rows (emails) and serve unexpired Tikkie
links to callers that send no device header — 39 links, about €15, on 16 Sep.

**Leaked-password protection is still off** according to Supabase's advisor
(Authentication → Password security).

**Three pending La Place claims will be refused at payout**, because the cap
now pays no more than the reward is worth: two for €10.00 on a reward that is
now €0.50, and one for €3.20. Review them by hand.

**The dashboard audit log has been empty since 31 July.** Its insert rule only
accepts rows whose `org_id` matches the admin's own, and staff admins have
none, so every entry logged under an open venue is silently dropped.

**Org isolation is still a UI convention.** A vendor account can read every
venue's rows through the API.

**Smaller**
- The sign-in sheet's "Send me offers" box starts ticked (consent must be
  opt-in).
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
- `eslint` is not clean and never was (~230 errors). Compare counts, don't
  chase zero.
- There is no admin test login. Verify admin work by importing `adminApi`
  through the dev server's module graph, or with a throwaway harness page.
- Test database rules inside a transaction that ends in `rollback`.
