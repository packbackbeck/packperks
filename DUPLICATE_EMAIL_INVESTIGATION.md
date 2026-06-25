# Duplicate-email accounts — investigation & resolution

**Issue flagged:** one real email is attached to **4 separate accounts**:
`samuels.semeiks@gmail.com`, on accounts that joined 11, 16, 16 and 18 June
with balances of 1, 1, 2 and 2 cups — appearing to be **one person spread
across four accounts on the same device**.

**Scope:** read-only investigation of the live Supabase data + the client
code. This document records what we found, the hypotheses, the verdict, the
chosen solution, and exactly what has shipped vs. what is still pending.

---

## TL;DR

- It is **one person, on one iPhone, who became four anonymous accounts** —
  not four colleagues. Each visit started from a QR/deeplink that opened in
  a browser context whose storage was wiped between sessions, so a fresh
  anonymous identity (`device_id`) was minted each time; the same email was
  re-typed on each via the **unverified "save email"** field, which has no
  uniqueness check and never consolidates.
- This is the **same root cause** as the t2 zero-cup investigation
  (`localStorage` `device_id` churn in in-app / ephemeral browsers) — here
  made visible because the person earned cups *and* reused one email.
- The directly-corrective work (merge duplicates + prevent same-email
  duplicates) is the **account-merge feature**, which is **designed and
  partly enabled but not yet built**. Supporting/preventive pieces (iOS
  in-app detection, entry-source tracking, visitor/user split) have shipped.

---

## What the data shows (facts)

`samuels.semeiks@gmail.com` → **4 accounts, 1 org, 4 distinct `device_id`s,
all `iPhone (iOS 18.7)`, all `email_verified = false`, none auth-linked,
none merged.**

| Joined | device | device_id | verified | auth-linked | merged | cups | scans |
|---|---|---|---|---|---|---|---|
| 11 Jun | iPhone (iOS 18.7) | 734b12cc | no | no | no | 1 | 1 |
| 16 Jun 07:46 | iPhone (iOS 18.7) | c3f37fbd | no | no | no | 1 | 1 |
| 16 Jun 11:28 | iPhone (iOS 18.7) | 56f55490 | no | no | no | 2 | 2 |
| 18 Jun | iPhone (iOS 18.7) | 0411e44e | no | no | no | 2 | 3 |

**Scan pattern (the clincher):** every session's **first** scan is a
`deeplink` (they opened a `?batch` QR/link), each from a **fresh
`device_id`**, then sometimes adds in-app `camera` scans within the session.
That is the exact signature of a QR link opening in an **isolated/ephemeral
browser** that doesn't carry over `localStorage` (where `packperks_device_id`
lives).

---

## Hypotheses & theories

- **H1 (primary): iOS in-app / ephemeral-storage browser → `device_id`
  churn.** Each QR-deeplink session landed in an isolated/wiped storage
  context → a new anonymous account. *(Best fit; same root cause as the t2
  zero-cup issue, on iOS.)*
- **H2 (enabler): the casual "save email" is unverified and never
  consolidates.** It writes `users.email` with no uniqueness, no
  verification, and no "this email already exists — sign in?" prompt → the
  same email lands on 4 rows. This is what makes H1 *visible* as a
  duplicate-email instead of being merged.
- **H3 (enabler): even the proper restore flow is pairwise.** `restore-by-
  email` (which this user never used — all unverified) merges the current
  device into **one** email row, not **all** same-email accounts. So 4
  duplicates wouldn't fully collapse even if it had been used.
- **H4: colleagues used his email.** *Unlikely / not supported* — all four
  are the same device profile (iPhone iOS 18.7) on one org; colleagues would
  show different device strings.
- **H5: iOS Private Browsing / manual cookie-clear.** Same effect as H1;
  possible but a QR-driven flow points to an in-app webview.

### Verdict on the original two assumptions
1. **"QR-scanner app / native browser that wipes cookies each session" →
   strongly supported.** Same iPhone, four `device_id`s, each session
   deeplink-initiated and freshly provisioned. On iOS, opening a QR/link
   inside an app's in-app browser (WKWebView / SFSafariViewController) or a
   QR-scanner app's webview doesn't share `localStorage` with Safari and is
   often wiped per session. (Caveat: this is iOS, which the original
   Android-only in-app fix did not cover.)
2. **"Colleagues used his email" → unlikely.** One device, one org,
   clustered timing = one person re-provisioned four times. (The device
   string isn't a unique fingerprint, so it can't be *proven* it's the one
   physical phone, but four colleagues sharing one email on identical iOS
   18.7 is far less plausible.)

**Root problem:** anonymous identity = `localStorage` `device_id`, which iOS
in-app/ephemeral browsers don't persist → one human → many accounts; the
unverified email-save then labels them all with the same email but never
consolidates.

---

## How to test / verify

- **H1 (ephemeral webview):** entry instrumentation is now live, so *new*
  duplicate accounts carry `in_app` / `referrer` / `deeplink` on
  `app_loaded` — watch for `in_app=true` or no persistent referrer.
  (Historical samuels accounts predate it.) Reproduce on an iPhone: open a
  `?batch` link from inside Instagram/Telegram's in-app browser, claim,
  close, repeat → new account each time.
- **H2/H3 (email gap):** confirmed by code + data — the casual save is
  unverified (0 verified rows), and `restore-by-email`'s lookup is
  `by email … order(updated_at desc) limit 1` (pairwise).
- **H4 (colleagues):** compare device strings / IPs (same here) or ask
  Samuel directly.

---

## Solution

**Identity churn (H1/H5):**
- **Extend in-app handling to iOS** (the detectable apps) — guide "Open in
  Safari" so the cup lands in a persistent context.
- A durable anonymous id (server cookie) would further reduce churn from
  Private mode / storage eviction (it can't fix fully-isolated webviews).

**Email consolidation (H2/H3) — the direct fix:**
- **On email entry, detect that the email already exists and offer to merge
  via a 6-digit code** (the existing restore flow sends a code — confirmed —
  so the merge UI is code-based, not a magic link).
- **Merge folds *all* same-email accounts** (not pairwise): sum every
  balance, and keep the **most-recent non-empty** profile data (fallback to
  any available).
- **Admin "merge selected"** in the Users table (multi-select → confirm) for
  manual cleanup of existing duplicates.
- **Do not** add a hard `UNIQUE` on unverified email (it would break
  legitimate re-entry and invite squatting) — consolidate on verification.

---

## What has been implemented (status)

### ✅ Shipped (live on `main`)
- **Entry-source tracking + metric** — `app_loaded` records how each visit
  arrived (`deeplink / ref / referrer / in_app`), surfaced as the
  "Entry source" tile. Lets new duplicates be attributed going forward.
- **Visitor vs user split** — "Active users", "Visitor rate" and "Audience
  split" metrics, plus a **Type (User/Visitor) column + "Show visitors"
  toggle** in the admin Users table, so duplicate/throwaway accounts are
  visible and the headline counts aren't inflated by mere app-opens.
- **Android in-app redirect** — Android in-app webviews that open a cup
  deeplink are steered to the default browser (intent URL), reducing new
  stranded/duplicate accounts; "Collect here anyway" fallback.

### ✅ Built and shipped (this round)
- **iOS in-app detection** — extends the in-app redirect to the detectable
  iOS in-app browsers (Instagram, Facebook, Line, WeChat, Google app,
  TikTok, Snapchat, Pinterest). Normal Safari/Chrome and WhatsApp/Telegram
  are **not** matched, so normal iOS users are unaffected. iOS can't be
  force-redirected, so the sheet guides "tap ••• → Open in Safari" (with a
  best-effort `x-safari` open) + "Collect here anyway". Verified live by
  spoofing an iOS in-app UA. *Directly reduces the H1 cause for the iOS
  case that produced these 4 accounts.*
- **Clearer restore errors** — replaces the vague "update failed" with a
  precise "you're already signed in with this email on this device" guard
  and a friendlier merge-error message.
- **Merge-all server logic (H3) — `admin-merge-users` edge function.**
  Folds **all** selected accounts into one chosen survivor (not pairwise
  like `restore-by-email`). It sums every cup balance + lifetime, repoints
  `activity_history` / `claims` / `cup_scans` / `cups` (`shared_by_user_id`,
  `activated_by_user_id`) onto the survivor, soft-marks absorbed rows with
  `merged_into` (and clears their `device_id` / `email` / `iban` so no
  anonymous read can hit them again), and writes the merged-profile fields
  as the **most-recent non-empty** value across all selected accounts.
  Cross-org merges and already-merged inputs are refused; the caller must
  be an active admin (`owner`/`admin`/`manager`). Audited to
  `admin_action_log`. Deployed live (v1 ACTIVE).
- **Admin manual merge UI.** In the admin Users table, selecting **2+
  users** turns the existing bulk action bar's purple "Merge N" button on
  alongside "Delete selected" (single-selection still just shows Delete, so
  no existing flow changed). "Merge N" opens a thoughtful modal: total
  cups + lifetime + account count at the top, a radio list of every
  selected account (survivor defaults to the most-recently-active row),
  and a two-step "Continue → Merge N accounts" confirm. Cross-org
  selections refuse in-UI; the server re-validates.

### ⏳ Still to build / decide
- **Customer merge flow (H2):** entering an already-existing email → "we'll
  email you a 6-digit code to merge your cups" → merge on verify. The
  server primitive (`admin-merge-users` / future `merge-by-email`) is now
  in place, so this is a UI-only addition next.
- **One-off cleanup:** merge Samuel's existing 4 accounts (→ 6 cups in one)
  using the new admin tool. This is a destructive write and needs explicit
  authorization before it runs — the tool is ready whenever you say go.

---

## Net position

The duplication is **explained, measurable, and now correctable**. New
iOS-in-app cases are actively reduced (detection + Safari guidance), the
server-side **merge-all** primitive is live, and admins can fold multiple
accounts into one from the Users table in two clicks. The only piece still
to build is the **customer-side "this email already exists — merge via
6-digit code"** flow that prevents new duplicates from forming in the first
place; the underlying merge is now ready for it.
