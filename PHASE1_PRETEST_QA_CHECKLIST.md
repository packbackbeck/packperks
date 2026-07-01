# PackPerks Phase 1 — Pre-Test QA Checklist (Titaan)

Run this **yourself** before testing with real users. It walks the full return → reward → dashboard loop, the edge cases that have actually broken before, and the cross-org isolation checks. Tick each box; anything that fails, note it and fix before the live test.

> Test on the **real device + browser** users will use (phone, mobile Safari/Chrome), not just your dev laptop. Several issues only show on a fresh device.

URLs:
- **User app (Titaan):** `…/titaan/`
- **Admin dashboard:** `…/admin`

---

## 0. Pre-flight (environment & data)

- [ ] Admin → switch org to **Titaan** → **Rewards & Offers** shows the **6 Lipton/Knorr** items (no Burger King items).
- [ ] Each reward has the right name, price, cups-needed, and an image (or a clean colored card).
- [ ] **Receipt Generator → QR Cup Receipts**: generate a fresh Titaan QR batch (note the cup count).
- [ ] **Receipt Generator → Rewards Receipts**: generate a test receipt for a Lipton item → it downloads with a green "✓ PackPerks Verified Test Receipt" badge + `PPK-` code.
- [ ] Supabase → **Auth → URL Configuration → Redirect URLs** includes the exact app URL (`http://localhost:5173` and/or the deployed domain).
- [ ] Supabase → **Auth → Emails → Magic Link** template is saved (the link + code version).
- [ ] **Clean baseline:** clear the browser's site data (or use a fresh private window) so you start with a brand-new user. Note the starting cup balance = 0.

---

## 1. Happy path — the core loop (do this end-to-end first)

| # | Step | Expected result | Maps to metric |
|---|------|-----------------|----------------|
| 1 | Generate a Titaan QR batch in admin | Batch appears in "Recent batches" | QR generation success |
| 2 | Scan the QR with your phone (or open the batch URL) | Lands on the **Titaan** app (`/titaan/`), Titaan branding, Lipton/Knorr rewards | Correct organization page |
| 3 | After scan | Balance increases by the batch's cup count (e.g. +3) | Correct cup count |
| 4 | Scan a **second** batch | Balance **adds** on top (3 → 5), does NOT reset | Correct cup count / UID accuracy |
| 5 | Pick a Lipton reward | Reward detail shows Lipton item, "how to claim" steps reference **Titaan** (not Burger King) | — |
| 6 | Reach reward, upload the **generated PackPerks receipt** | Verification runs, accepts it (PackPerks token) → success/under-review screen | — |
| 7 | Admin → **Claims** (Titaan) | The claim shows the **correct Lipton reward**, your **real username**, status pending/approved | Dashboard completeness |
| 8 | Admin approves the claim | Status flips to Approved; no errors | — |
| 9 | Admin → **Stats** (Titaan) | Scans/users/metrics reflect what you just did (not 0, not N/A) | Dashboard completeness |

✅ If all 9 pass cleanly, the spine works. Now hammer the edges below.

---

## 2. Cup scanning — edge cases

- [ ] **Balance accumulates** across multiple scans (regression: it used to reset to the last scan's amount).
- [ ] **Duplicate scan**: scan the *same* QR/batch twice → 2nd time shows "already used / already claimed", balance does NOT double-count. *(metric: Duplicate scan handling)*
- [ ] **Multi-cup batch**: a 5-cup QR adds exactly 5.
- [ ] **Expired batch**: set a batch to expire (or use a past one) → scanning shows "this receipt has expired", no cups added.
- [ ] **Revoked batch**: revoke a batch in admin → scanning shows "QR cancelled", no cups added.
- [ ] **Invalid / random QR**: scan a non-PackPerks QR or a made-up `?batch=` → friendly "this QR isn't valid" error, no crash.
- [ ] **Rapid double-tap / double scan** of a valid batch → counts once, not twice.
- [ ] **Refresh mid-scan** (reload while on the scan-success page) → balance is still correct after reload (matches DB).

---

## 3. Reward & receipt verification — edge cases

- [ ] **Generated PackPerks receipt (correct item)** → accepted. *(this is the test path)*
- [ ] **Generated receipt for reward A, but you claim reward B** → flagged "required item not on receipt" / sent to review (not silently approved).
- [ ] **Real non-receipt photo** (selfie, random object) → rejected as "not a receipt".
- [ ] **Screenshot of a receipt** → handled (rejected or low-confidence review, not a crash).
- [ ] **Blurry / dark photo** → rejected conservatively or routed to review, with a clear message.
- [ ] **Very large image** (high-res phone photo) → uploads and verifies (or clear "compress" message), no silent failure.
- [ ] **Cancel mid-upload / no photo** → returns to reward screen, no claim created, cups untouched.
- [ ] **Verification "system error" screen** should NOT appear for a normal upload (regression: was caused by an auth gate). If it does, check edge-function logs.
- [ ] **Cups are NOT spent** when a claim fails/rejects — balance stays intact.

---

## 4. Cross-org isolation (critical — this broke repeatedly)

- [ ] **Titaan Rewards & Offers** = only Lipton/Knorr. Switch to **Burger King** → only BK items. Switch to **KFC** → only KFC items. No bleed-through.
- [ ] A scan/return done on **Titaan** appears under **Titaan** in Stats / Cup Scans / Users — **not** under Burger King.
- [ ] A reward claim on Titaan appears under **Titaan** Claims only.
- [ ] **Users**: a person who signs up on the Titaan app shows in the **Titaan** Users list (not BK).
- [ ] **Stats** numbers differ per org (switch the org switcher and watch them change).
- [ ] Open the user app with **no slug** (`/`) → it falls back to the default org (Burger King) — this is expected; just confirm `/titaan/` always shows Titaan.
- [ ] The user app never flashes Burger King items while loading on `/titaan/`.

---

## 5. Auth / magic link (optional "save my cups" feature — only if testers will use it)

- [ ] Tap "Sign in / save cups", enter email → "check your inbox".
- [ ] Email arrives with **both** a sign-in link **and** a 6-digit code.
- [ ] Tapping the link returns to the **Titaan** app and you're signed in ("signed in as …").
- [ ] After signing in, your **cup balance is unchanged** (regression: signing in used to mint a fresh 0-cup user).
- [ ] Sign out → you're back to the anonymous device user, balance still correct for this device+org.
- [ ] Signed-in actions (scan, claim) work without an "row-level security" error.

---

## 6. Admin dashboard checks

- [ ] **Claims** (Titaan): correct reward names, real usernames (no "Unknown"), correct €, statuses.
- [ ] **Approve** a claim → status updates, recorded who approved.
- [ ] **Reject** a claim → status updates, cups handled per your policy.
- [ ] **Users** (Titaan): the test users appear with names/cup balances.
- [ ] **Cup Scans** (Titaan): your scans appear with success/failed status.
- [ ] **Stats** (Titaan): metric cards show live numbers + Go/Conditional/No-go colors; not all N/A.
- [ ] **QR generation** metric fills in after you generate a batch (logging is live).
- [ ] Refresh each admin page → data persists (reads from DB, not stale cache).

---

## 7. Resilience / device

- [ ] **Slow / spotty network**: actions show a loading state, then succeed or show a clear retry — no permanent stuck spinner.
- [ ] **Airplane mode mid-scan** → clear error, recover when back online.
- [ ] **Back button** during the flow → no broken/blank screen.
- [ ] **Two phones, one batch** → first scan wins, second gets "already used".
- [ ] Works on **iOS Safari** and **Android Chrome** (camera QR open + upload from camera/gallery).

---

## 8. Regression re-check (bugs already fixed — confirm they stay fixed)

- [ ] Cups **add**, don't replace.
- [ ] Claim uses the **selected reward** (not "Chicken Sandwich").
- [ ] Receipt verification **doesn't** instant-error with "something went wrong on our side".
- [ ] Titaan admin shows **Titaan** rewards (no BK).
- [ ] New Titaan signups land in **Titaan** org (not BK).
- [ ] Claims show **real usernames**, not "Unknown".
- [ ] Stats show **real per-org numbers**, not N/A.
- [ ] Signed-in users don't hit **RLS "row violates policy"** errors.

---

## 9. Quick triage (symptom → likely cause)

| Symptom | Most likely cause / where to look |
|---|---|
| Balance resets to last scan | a getOrCreateUser call missing the org → fresh user (should be fixed) |
| "Wrong item" on a correct receipt | claim created with stale reward id (should be fixed) |
| BK items on Titaan | stale localStorage admin draft → hard-refresh; DB is source of truth now |
| "Unknown" user in Claims | claim made by an orphan (org-less) user — re-test on a clean device |
| Stats all N/A | the org has no scans yet, or scans tagged to the wrong org |
| Receipt instant "system error" | check verify-receipt edge function logs (auth/RLS) |
| Magic link is a code only | Magic Link email template doesn't include `{{ .ConfirmationURL }}` |
| Data missing in dashboard | admin reads are org-scoped — confirm you're on the right org in the switcher |

---

### Notes for the run
- Keep the **admin dashboard open on a second screen** so you can watch events land in real time (Cup Scans / Claims / Stats).
- Do one **fully clean run** (fresh device data) end-to-end before inviting anyone — orphan/test data from your own debugging can muddy the first impression.
- Decide up front: **demo rewards or real** for this phase (Phase 1 = demo per the roadmap).
