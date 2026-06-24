# t2 — Investigation: zero-cup users joining on/after 12 June

**Scope:** the `t2` org only (`a5114bbe-8c8b-48a0-ace0-5d013647d577`). Focus on users who **registered on 12 June 2026 or later** and have **0 balance / 0 lifetime cups**. Users who joined on 11 June (poster day) are explicitly excluded.

**Method:** read-only. Cross-checked the Supabase data (`users`, `cup_balances`, `cup_scans`, `client_events`) against the client code (`src/App.jsx`, `src/lib/api.js`, `src/utils/analytics.js`).

---

## TL;DR

- The original worry — *"13 different people each scanned an already-claimed receipt"* — is **disproved by the data.** Of the 14 post-11-June zero-cup users, **only 4 ever attempted a scan**; the other **10 never scanned anything at all.**
- **Root cause:** the app **creates a permanent anonymous user (and a `cup_balances` row at 0) on every app-load, before and regardless of any cup scan.** So a "0-cup user" means *"someone opened the app,"* not *"someone returned a cup that failed to credit."*
- After the poster came down, these 0-cup users keep appearing because **opening the app never required a cup in the first place** — the poster/base URL still resolves (shares, screenshots, bookmarks, the bin's own screen), and re-opens in in-app/ephemeral browsers mint **new** anonymous users (duplicate rows for the same person).
- The 4 who *did* scan hit the separate **`already_claimed`** collision (a cup QR whose cup was already activated) — a real but much smaller issue, not the cause of the 10.

**Conclusion: this is not a broken scan-to-credit pipeline. It is a measurement/identity artifact — the app provisions an account on mere page-open, and that population is being counted as "users with 0 cups."**

---

## The numbers (reconciled)

| Group | Count |
|---|---|
| t2 users total | 52 |
| Users with 0 lifetime cups | **21** |
| → joined **11 June** (poster) | 7 |
| → joined **≥ 12 June** (in scope) | **14** |

(7 + 14 = 21. The report's "8 + 13 = 21 of 50" matches within ±1 — the admin Users list trims to ~50 and a near-midnight join lands the split one either way.)

### The 14 in-scope users — what they actually did

| Joined | Device | Scans | Client events |
|---|---|---|---|
| 12 Jun 09:04 | Android 10 | 1 (failed) | app_loaded, reward_shown, **scan_attempted**, screen_view |
| 12 Jun 09:10 | Android 16 | 0 | app_loaded, reward_shown |
| 12 Jun 14:09:16 | Android 10 | 0 | app_loaded, reward_shown |
| 12 Jun 14:09:36 | Android 10 | 0 | app_loaded, reward_shown |
| 12 Jun 14:37 | Android 10 | 0 | app_loaded, reward_shown |
| 15 Jun 09:11 | Android 10 | 1 (failed) | app_loaded, reward_shown, **scan_attempted**, screen_view |
| 15 Jun 10:30 | Android 16 | 0 | app_loaded, reward_shown |
| 15 Jun 10:31 | Android 10 | 0 | app_loaded, reward_shown |
| 16 Jun 11:28 | iPhone iOS 18.7 | 0 | app_loaded, reward_shown |
| 16 Jun 16:30 | iPhone iOS 18.7 | 0 | app_loaded, reward_shown |
| 17 Jun 13:57 | Android 10 | 1 (failed) | app_loaded, reward_shown, **scan_attempted**, screen_view |
| 19 Jun 07:02:39 | Android 10 | 1 (failed) | app_loaded, reward_shown, **scan_attempted**, screen_view |
| 19 Jun 07:02:45 | Android 10 | 0 | app_loaded, reward_shown |
| 22 Jun 12:08 | Android 10 | 0 | app_loaded, reward_shown |

**Two signatures, nothing in between:**
- **10 users = `app_loaded` + `reward_shown` only.** They opened the app, the home/reward screen rendered, and they left. **No `scan_attempted` → they never tried to return a cup.**
- **4 users = the above + `scan_attempted` + `screen_view`.** They tried to scan; every one produced a `cup_scans` row with `status = failed`, `error_code = already_claimed`.

**Duplicate smell:** no two t2 users share a `device_id`, yet two pairs were created seconds apart — `14:09:16` + `14:09:36` (20 s) and `07:02:39` + `07:02:45` (6 s, where the first scanned-and-failed and the second only opened). These are very likely the **same person opening twice**, each open minting a fresh anonymous user.

---

## Root cause (code-grounded)

On every load, `src/App.jsx` runs its init effect in this order:

1. **`const user = await getOrCreateUser(org?.id);`** — [App.jsx:380](src/App.jsx#L380). This is **unconditional** and happens **first**.
2. `track(EVENTS.APP_LOADED, …)` — [App.jsx:396](src/App.jsx#L396).
3. Rewards load → `track(EVENTS.REWARD_SHOWN, …)` — [App.jsx:454](src/App.jsx#L454).
4. **Only now** does it look for a cup deeplink: `?batch=` / `?cups=` — [App.jsx:477-492](src/App.jsx#L477). If present it auto-runs `handleCupScan(...)` (→ `scan_attempted`). **If absent, nothing happens** and the user simply stays at 0 cups.

`getOrCreateUser()` ([src/lib/api.js:71](src/lib/api.js#L71)) keys anonymous identity off a localStorage `device_id` ([api.js:22-29](src/lib/api.js#L22)) and, when no row exists for that device, **inserts a `users` row *and* a `cup_balances` row (balance 0)**. So:

> Every app-open with a new/cleared `device_id` permanently creates a user + a 0-cup balance row — **before any cup is involved.**

This matches the data exactly: the 10 no-scan users have `app_loaded` + `reward_shown` and no `scan_attempted`, i.e. they reached the app **without** a `?batch`/`?cups` deeplink, so no scan ran, but the account was already created on load.

### Why it keeps happening after the poster came down
Taking the **physical** poster down does not deactivate its **URL**. Anyone who saved/screenshotted/forwarded it — plus the bare slug URL, bookmarks, the bin's own display, link previews, or the team testing — lands on the app and becomes a 0-cup user. The code comment at [api.js:60-62](src/lib/api.js#L60) ("clearing the browser data loses the balance") is the same mechanism that makes **in-app/private browsers mint a new user on each open**, inflating both the user count and the 0-cup count.

---

## Hypotheses & how to test each

### H1 — App provisions an account on page-open, independent of cup return *(PRIMARY — strongly supported)*
**Claim:** "0-cup users" are mostly *visitors who opened the app*, not failed cup credits.
**Already-supporting evidence:** code path above; 10/14 have only `app_loaded`+`reward_shown`.
**How to verify:**
1. In a fresh browser, open the bare slug URL `…/t2` (no `?batch`). Expect: a new `users` row + `cup_balances(0)`, events `app_loaded` then `reward_shown`, and **no** `cup_scans` row. (This is the exact signature of the 10.)
2. SQL: count t2 zero-cup users whose only events are `app_loaded`/`reward_shown` and who have 0 scans — should equal the no-scan cohort.
**Falsified if:** opening the bare URL does *not* create a DB user, or the no-scan users turn out to have scan attempts.

### H2 — Post-poster arrivals come through non-cup entry points *(supported by inference)*
**Claim:** the 10 reached the app via the still-live poster URL / shared links / base URL, not a cup QR.
**Gap:** `app_loaded` currently logs only `{ slug }` ([App.jsx:396](src/App.jsx#L396)) — **not** the referrer, landing path, or whether a `?batch` was present. So entry route can only be *inferred* (absence of `scan_attempted`).
**How to verify:** add entry instrumentation (see S2), then confirm new 0-cup users land without a deeplink. Until then, the absence of `scan_attempted` for all 10 is the strongest available signal.

### H3 — Ephemeral/in-app browsers mint duplicate anonymous users *(partially supported)*
**Claim:** the same person opening in an in-app webview (WhatsApp/Instagram/QR-scanner preview) or private mode gets a **new** `device_id` each time → a new 0-cup user, inflating counts.
**Evidence:** no two t2 users share a `device_id`; pairs created 6 s and 20 s apart.
**How to verify:**
1. Open the link from inside a messaging app's in-app browser, close, reopen → expect a new `device_id` + new `users` row each time.
2. SQL: look for clusters of users created within a short window with identical `device` strings (found: the two pairs above).
**Falsified if:** reopening reuses the same `device_id` (no new row) across these contexts.

### H4 — The 4 scanners hit a genuine cup-QR collision *(supported; separate/minor issue)*
**Claim:** the 4 who scanned came via a real cup QR whose cup was already activated → `already_claimed` → 0 cups.
**Evidence:** all 4 `cup_scans` rows are `status=failed`, `error_code=already_claimed`. Across all of t2, 17 scans failed this way, but 9 were the *same user re-scanning* their own QR and only 8 were *a different user* arriving after someone else claimed it.
**How to verify:** for each failed scan's batch, compare the first successful claimer's `user_id`/time vs the failing user (query in appendix). Confirms reuse/re-scan vs true cross-user collision.

---

## Recommended solutions

### S1 — Stop counting "opened the app" as "a user with 0 cups" *(addresses H1 — highest impact)*
Pick one (in increasing effort):
- **Reporting-only fix (fastest, no schema change):** in the admin Users list and User-Behaviour metrics, separate **visitors** (opened, never scanned) from **returners** (≥1 successful scan / ≥1 lifetime cup). Report the 42% against *returners*, not *every page-open*. This alone makes the metric honest.
- **Flag at the source:** add `first_cup_at` (or a `status: 'visitor' | 'active'`) to `users`, set on first credited cup; exclude visitors from headline counts.
- **Defer creation (cleanest, more work):** keep the anonymous id in localStorage only and **create the `users`/`cup_balances` rows lazily on the first real action** (first scan or email link), instead of on load at [App.jsx:380](src/App.jsx#L380). Then "users" means "people who did something."

### S2 — Instrument the entry point *(addresses H2)*
Extend the `app_loaded` payload to capture `document.referrer`, the landing path, and whether a `?batch`/`?cups` deeplink was present. Then 0-cup users are directly attributable (poster URL vs shared link vs failed deeplink). Consider a distinct, **expirable campaign URL** for posters so that traffic can be switched off and measured separately.

### S3 — Stabilise identity / dedupe *(addresses H3)*
- Prefer a server-set cookie (or a more durable identifier) over localStorage-only, **or** accept in-app-browser churn but **dedupe in reporting** (collapse same-`device`-string rows created within a few seconds).
- Nudge email-link binding earlier so identities consolidate (`users.merged_into` already supports merging).

### S4 — Per-cup one-time QR + collision UX *(addresses H4)*
Ensure each printed cup QR maps to a **unique, unclaimed** cup; when a scan hits `already_claimed`, show a clear message and a path forward instead of a silent 0. Check at the bin whether receipts/deeplinks are being reused or reshared.

---

## Appendix — queries used (read-only)

```sql
-- Balance ledger truth per org (t2 = a5114bbe…): nobody spent, 21 zero-lifetime
select u.org_id, count(*) users,
  count(*) filter (where b.balance < b.lifetime_cups) spent_some,
  count(*) filter (where coalesce(b.lifetime_cups,0)=0) zero_lifetime
from users u left join cup_balances b on b.user_id=u.id
where u.org_id='a5114bbe-8c8b-48a0-ace0-5d013647d577' group by u.org_id;

-- The 14 in-scope users: events + scans
with zero_users as (
  select u.id, u.created_at, u.device
  from users u left join cup_balances b on b.user_id=u.id
  where u.org_id='a5114bbe-8c8b-48a0-ace0-5d013647d577'
    and u.created_at >= '2026-06-12' and coalesce(b.lifetime_cups,0)=0)
select left(z.id::text,8) user8, z.created_at, z.device,
  (select count(*) from cup_scans cs where cs.user_id=z.id) scans,
  array_agg(distinct ce.event) filter (where ce.event is not null) event_types
from zero_users z left join client_events ce on ce.user_id=z.id
group by z.id, z.created_at, z.device order by z.created_at;

-- Failed scans on t2 are all "already_claimed"; who claimed first?
with t2_failed as (
  select f.* from cup_scans f join users u on u.id=f.user_id
  where u.org_id='a5114bbe-8c8b-48a0-ace0-5d013647d577' and f.status='failed')
select count(*) failed,
  count(*) filter (where win.user_id <> f.user_id) claimed_by_other_user,
  count(*) filter (where win.user_id = f.user_id) claimed_by_same_user
from t2_failed f
left join lateral (
  select s.user_id from cup_scans s
  where s.batch_id=f.batch_id and s.status in ('success','partial')
  order by s.scanned_at asc limit 1) win on true;
```

**Key files:** `src/App.jsx` (init + deeplink), `src/lib/api.js` (`getDeviceId`, `getOrCreateUser`), `src/utils/analytics.js` (event names + persistence).

---

# Update — hypothesis tests & refined cause (24 Jun)

## What the live tests showed

- **H1 — confirmed.** Opening the bare slug URL in incognito created a brand-new account (*Ferris Fox, 0 cups, Mac, Chrome 148* — the lone "Mac" zero-cup row in the data is this test). An account is provisioned on load with no cup required. The open question is *why people reach the bare URL after 11 June* — see "Refined cause" below.
- **H3 — confirmed, and worse than expected.** Opening a `?batch` link in **Telegram's in-app browser** created a new account (*Sandy Panda, iOS 18.7*) **and** credited the cup; opening a second batch the same way created **another** new account. Tapping "open in Chrome" then showed the t2 page with no cup and no "already scanned" message — i.e. Chrome opened the param-stripped URL, so the cup is **stranded in the throwaway in-app account** while the user's real browser shows 0. In-app browsers mint a fresh `device_id` (no persisted localStorage) on every open.
- **H4 — confirmed (separate, minor).** All 17 failed t2 scans are `already_claimed`; 9 are the same user re-scanning their own QR, only 8 are a different user arriving after someone else claimed. Of the 14 in-scope empties, 4 are these failed scans.

## The Android pattern (new, important)

The empties skew hard to Android:

| Cohort | iOS | Android |
|---|---|---|
| Has cups | 24 | 10 |
| **Zero cups** | 5 | **16** |

…and **23 users carry the exact string `Android 10`** (14 zero, 9 has) while iPhones show varied versions (18.7, 26.5, 27.0…).

**Why:** `detectDevice()` ([App.jsx:77](src/App.jsx#L77)) pulls the Android model from `; <model> Build/`. Modern **Chrome on Android sends a privacy-"reduced" User-Agent** (`Android 10; K)` — version frozen to 10, model removed), so the regex fails and returns the bare **"Android 10"**. The same reduced UA is used by **Android System WebView**, which backs every Android in-app browser (WhatsApp/Telegram/Instagram). **So "Android 10" lumps real Chrome and all Android in-app webviews into one indistinguishable bucket.** iOS in-app browsers keep the real `iPhone OS x_y`, so they don't collapse.

Mechanistically the skew makes sense: on iOS a camera QR opens in **Safari** (persistent storage, completes the scan); on Android, QR/links more often open in **Custom Tabs / in-app webviews** (ephemeral storage) → more throwaway and no-scan accounts. The device field alone **cannot prove** webview-vs-Chrome — which is exactly the gap S2 closes.

## Refined cause

The empty-user population is **everyone who loaded the app without successfully banking a cup, persisted because the account is created on load**, fed by three streams:

1. **Bare-URL opens (no `?batch`)** → the 10 no-scan empties (`app_loaded`+`reward_shown` only). Source: the 11-June poster QR still circulating (photos/screenshots/history/forwards), the bare URL pasted/bookmarked, or the bin's own screen. *Note: the in-app "share cups" feature is NOT a source here — it emits `?batch` deeplinks, which credit a cup.*
2. **In-app-browser duplication (Android-skewed)** → reopening any link in an Android in-app webview mints a new account each time; cups (if any) strand in the throwaway account. Inflates both 0-cup and 1-cup counts.
3. **`already_claimed` scans** → the 4 who scanned a `?batch` whose cup was already taken.

## S2 — implemented (forward-looking attribution)

To answer *"did this 0-cup account come from a shared link or not?"* going forward, `app_loaded` now records entry context ([analytics.js `getEntryContext()`](src/utils/analytics.js), wired in [App.jsx](src/App.jsx) before the `?batch` param is stripped), and in-app share links are tagged `ref=share` ([ShareCupSheet.jsx](src/components/ShareCupSheet.jsx)). Captured per visit:

| field | meaning |
|---|---|
| `deeplink` | `batch` / `cups` / `null` — was a cup attached to the URL |
| `ref` | `share` for in-app shared links (extensible to campaign tags) |
| `referrer` | hostname they came from (a messaging domain ⇒ someone sent them a link; `null` ⇒ QR/camera/direct) |
| `in_app` | true for known in-app webviews (the duplicate-account culprit) |
| `standalone` | launched from an installed PWA |

**How to read a 0-cup account's origin (from its `app_loaded` event):**
- `ref = 'share'` → came from an in-app cup share.
- `referrer` = whatsapp/telegram/instagram/etc. → a friend pasted a link.
- `deeplink = null` AND `ref = null` AND `referrer = null` → bare URL: poster-QR photo, direct, or bookmark.
- `in_app = true` → opened in an in-app browser (expect a throwaway/duplicate account).

Example query once data accrues:
```sql
select ce.props->>'ref' as ref, ce.props->>'referrer' as referrer,
       ce.props->>'deeplink' as deeplink, ce.props->>'in_app' as in_app,
       count(*) accounts
from client_events ce
join users u on u.id = ce.user_id
left join cup_balances b on b.user_id = u.id
where ce.event='app_loaded'
  and u.org_id='a5114bbe-8c8b-48a0-ace0-5d013647d577'
  and coalesce(b.lifetime_cups,0)=0
group by 1,2,3,4 order by accounts desc;
```

## Suggested next fixes (unchanged priority)
1. **S1** — count *returners* (≥1 scan/cup) separately from *visitors* so the 42% isn't measuring page-opens. Optionally defer account creation until the first real action.
2. **In-app-browser handling** — detect `in_app` and prompt "open in your normal browser" before scanning, so cups don't strand in throwaway webview accounts; and/or push email-link binding earlier to consolidate identities (`users.merged_into`).
3. **S4** — unique one-time cup QRs + a clear "already claimed" screen.

---

# Final summary — hypothesis test log, verdict & actions

## Test log

| # | Hypothesis | How it was tested | Verdict |
|---|---|---|---|
| **H1** | App provisions an account on app-open, no cup required | Opened the bare slug URL in incognito | ✅ **Confirmed** — a new account (Ferris Fox / 0 cups / Mac, Chrome 148) was created on load |
| **H2** | 0-cup accounts arrive via non-cup links (still-live poster URL, shared/bookmarked link) | Couldn't be tested directly — no entry data was captured at the time | ⚙️ **Now testable** — entry instrumentation (S2) + an Entry-source metric have been added |
| **H3** | In-app browsers mint duplicate throwaway accounts | Opened `?batch` links inside Telegram's in-app browser (twice) | ✅ **Confirmed** — a new account each open; the cup stranded in the webview account while the real browser showed 0 |
| H3b | Android-skew sub-finding | Compared device strings of empty vs cup users | ✅ **Confirmed** — 16/26 Android users empty (vs 5/29 iOS); "Android 10" is Chrome/WebView reduced-UA collapsing into one bucket |
| **H4** | The scanners hit a genuinely already-claimed cup | Queried the failed scans + first-claimer | ✅ **Confirmed but minor** — only 4 of 14 scanned; of 17 total fails, 9 are self re-scans, 8 are true cross-user collisions |

## Verdict

Empty users are **app-opens that never banked a cup, made permanent because the account is created on load — not a broken scan-to-credit pipeline.** Three feeders, in order of size: (1) **bare-URL opens** (the 11-June poster QR still circulating, plus shared/bookmarked links); (2) **in-app-browser duplication**, Android-skewed; (3) a small number of **already-claimed** scans. The original "13 different people scanned an already-claimed receipt" theory is **disproved** — only 4 of the 14 scanned at all.

## Steps taken (done)

- **S2 — entry instrumentation.** `app_loaded` now records `deeplink / ref / referrer / in_app / standalone` (`getEntryContext()` in `src/utils/analytics.js`, wired in `src/App.jsx` before the `?batch` param is stripped). In-app cup shares are tagged `ref=share` (`src/components/ShareCupSheet.jsx`).
- **Entry-source metric in User Behaviour.** A new **"Entry source"** tile (Optional group) with a bar/pie breakdown, so the source of every visit is visible in the dashboard: *Shared cups (in-app) · Cup receipt QR · Messaging / social · In-app browser · Other website · Direct / poster QR · Untracked (pre-update)*. Source: `classifyEntry()` in `src/admin/lib/adminApi.js`, rendered via the shared breakdown chart in `MetricDetailModal.jsx`. Opens recorded before S2 shipped show as "Untracked (pre-update)"; real sources accrue from deploy onward.
- **In-app-browser redirect (Android).** When an **Android** in-app webview (Instagram/Facebook/Telegram, detected via the `; wv)` marker — never normal Chrome/Custom Tabs) opens a cup deeplink, the claim is **held** and a thoughtful sheet offers **"Open in default browser"** (an Android intent URL carrying the still-unclaimed `?batch`, so the cup lands on the user's real-browser account) with **"Collect here anyway"** as a never-lose-the-cup fallback. iOS is intentionally skipped (no reliable force-redirect). Actions tracked (`inapp_prompt_shown` / `open_in_default_browser` / `collect_here_anyway`) and surfaced as the **"In-app browser redirect"** metric at the bottom of User Behaviour. Files: `src/components/InAppBrowserSheet.jsx`, `src/App.jsx`, `isAndroidInAppBrowser()` in `src/utils/analytics.js`.
- **S1 — visitor vs. user split.** The dashboard now distinguishes real users from visitors. A profile counts as a **user** the moment it does anything real — adds a cup, *tries* a scan (even an already-claimed one), sets an email or IBAN, picks a reward, or edits/regenerates its name; everything else is a **visitor** (opened only). Added three User-Behaviour metrics (`src/admin/lib/adminApi.js`): **Active users (not just visitors)** %, **Visitor rate** %, and an **Audience split** bar/pie (Active vs Visitors). Customer-side, a small **"Visitor"** badge + **"Add your first cup"** big CTA now shows on the profile page until the first real action (`isVisitor` in `src/App.jsx`, rendered in `src/components/UserPage.jsx`). The selected-reward default is excluded from the signal (it auto-sets on load).

## Steps still recommended (not yet done)

- **Defer account creation (optional hardening of S1).** S1 reframes the *reporting*; the app still creates an anonymous row on load. Optionally hold off persisting the `users`/`cup_balances` row until the first real action, so visitors don't create DB rows at all.
- **In-app-browser handling on iOS** — Android is done (above); iOS in-app browsers can't be force-redirected to Safari and detection (WhatsApp/Telegram) is unreliable, so it's deferred. Optionally guide iOS users to the in-app "Open in Safari" control, and/or push email-link binding to consolidate identities.
- **S4** — unique one-time cup QRs + a clear "already claimed" screen.
