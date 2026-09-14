# Handoff — state of play, 14 September 2026

A snapshot for whoever picks this up next. Durable guidance lives in
`/CLAUDE.md`; this file is the "where we are right now" half and goes stale.

---

## Recent work

Two threads dominated the last fortnight.

### 1. Slider voucher (8 Sep)

A second payment method beside Tikkie cashback. The customer unlocks a reward
and shows a full-screen holographic voucher at the counter; staff slide to
confirm, which atomically deducts the cups.

- `src/components/VoucherPage.jsx` — the card. Tilt runs on a single rAF loop
  writing CSS custom properties straight to the node, with lerp damping. It is
  written that way on purpose: tilt in React state plus a CSS `transition`
  restarted a tween every frame and the card visibly shook.
- `src/components/SlideToConfirm.jsx` — fill and thumb are driven by one
  `--stc-p` so they cannot drift apart; the fill ends at the knob's *centre*.
- `supabase/migrations/040_counter_voucher.sql` — `redeem_voucher()`, a
  SECURITY DEFINER RPC that locks the balance row and deducts atomically.
- Settable per org and per group; the claims page and the how-it-works guide
  both adapt.

### 2. UAE, the vendor role, and the dashboard's currency (9–10 Sep)

- **UAE copy.** NYU Abu Dhabi is an AE/AED BYO venue. The app no longer names
  Tikkie or promises a link there. Root cause of a whole class of wrong copy:
  `normalizeRegion` was dropping `payoutStyle`.
- **AED everywhere.** ~100 hardcoded `€` across 24 admin files now go through
  `adminMoney`, which follows the *active organisation*. Whole dirham amounts
  drop their decimals (`AED 21`, not `AED 21.00`); fractions keep them.
- **Vendor role.** Read-only, three pages, pinned to one store. Needed changes
  in `admin_profiles`/`admin_invitations` constraints, `invite-admin` (carries
  the store), and `bootstrap-admin` (applies it on accept).
- **Demo numbers.** An org toggle that shows vendor accounts a healthy
  programme instead of a store that went live last week. `demoData.js`
  fabricates *rows*, not numbers — `adminApi` swaps them in at three fetch
  points and the real production code does all the maths, so the demo cannot
  drift from the real dashboard and no figure can contradict another.

---

## Live demo setup

NYU Abu Dhabi is the pitch venue. Currently:

- `vendorDemoNumbers: true` in its published config
- payment method `voucher`, region AE, currency AED
- "More stores" hidden, and the spacer that stood in for it is gone

Preview link (needs a staff login — it is not shareable with NYU):

```
https://perks.packback.network/admin?org=nyuad#overview?as=vendor
```

For NYU themselves: invite a real **Vendor** from Team while NYU Abu Dhabi is
the open store. That cannot be scripted — it needs a password.

---

## Open items

Nothing here is in flight; all of it is known and unstarted.

**Security — anon key exposes the customer list.** `users`, `cup_scans`,
`cup_balances` carry `anon select … true`. 468 user rows including real email
addresses are publicly readable with the key that ships in the customer
bundle. `claims` is fine. Fix: scope those three policies to the requesting
device, the way `claims` already is. Details in `/CLAUDE.md`.

**Admin delete doesn't delete.** Deleting a user from the dashboard removes the
app rows but not the `auth.users` login, so the account and email come back on
next sign-in with the balance gone. Needs an `admin-delete-user` edge function
doing the purge *and* `auth.admin.deleteUser`, mirroring `delete-my-account`.

**Terms copy is wrong for voucher venues.** "The fine print" still describes
uploading receipts and collecting a Tikkie link. Untrue where the method is
`voucher`.

**PackPulse integration** — a written plan exists at
`docs/packperks-in-packpulse.md`. Not started. It opens with the two findings
above because they shape the design. The PackPulse side was never inspected
(it is password-gated), so the open questions at the end are real blockers.

---

## Things that will bite

Short version; the reasoning is in `/CLAUDE.md` under **Landmines**.

- A push is not a deploy. Vercel has silently skipped triggers — fingerprint
  the live bundle before believing a change is out.
- Publishing from the dashboard overwrites settings written directly in SQL.
- `eslint` is not clean and never was (~240 errors). Compare counts, don't
  chase zero.
- There is no admin test login. Verify admin work by importing `adminApi`
  through the dev server's module graph, or with a throwaway harness page.
