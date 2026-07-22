# PackPerks — Domain Migration Checklist (.app → .network, + Vercel URL)

**Goal:** PackPerks (customer app **and** admin) works on **all three** domains at once:
1. the Vercel-generated URL (`*.vercel.app`)
2. `perks.packback.app` (old)
3. `perks.packback.network` (new primary)

> **Key insight — cup redemption is already domain-agnostic.** When a QR is scanned **inside the app**, we re-enter the scan on the *current* origin and ignore whatever host is in the QR (`App.handleCupScan` + `parseQr`). So an in-app scan works on any of the three domains with no change. The domain in the QR only matters for a **native phone-camera** scan, which opens that exact URL in a browser.

---

## A. Code changes (done in this repo)

| Change | Why |
|---|---|
| New `src/lib/appUrl.js` → `APP_URL` from `VITE_APP_URL`, default `https://perks.packback.network/` | One place decides the canonical domain baked into a NEW printed QR / share link |
| `AdminCupQr`, `AdminByoRequests`, `ShareCupSheet` now use `APP_URL` (were hardcoded `perks.packback.app`) | New QRs + shares point at the new domain (configurable per deploy) |
| `share-cups` edge fn: `ALLOWED_ORIGIN` → `ALLOWED_ORIGINS` (comma-separated list; wildcard if unset) | Its CORS previously allowed only ONE origin — would block two of the three domains |

Everything else that builds a URL already uses `window.location.origin` (auth redirects, admin invite link, PWA `start_url:"/"`), so it follows whatever domain you're on automatically.

---

## B. Config you must set (dashboards — not code)

### 1. Vercel
- [ ] Add **all three** domains to the project: `perks.packback.network`, `perks.packback.app`, and keep the `*.vercel.app` URL. Point DNS for both custom domains at Vercel.
- [ ] **Keep `perks.packback.app` live** (don't delete it) — previously-printed QR codes point at it, so native-camera scans of old prints still resolve.
- [ ] (Optional) set `VITE_APP_URL=https://perks.packback.network/` as a Vercel env var so new QRs use the new domain. If unset, it defaults to `.network` anyway.
- [ ] Confirm `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are set for all deployments (they're shared across domains — no per-domain change).

### 2. Supabase → Authentication → URL Configuration  *(critical for admin + customer email sign-in)*
Auth redirects use `window.location.origin`, so every origin must be allow-listed or the redirect is rejected:
- [ ] **Site URL:** `https://perks.packback.network`
- [ ] **Redirect URLs** — add all three, both app + admin paths:
  - `https://perks.packback.network/**`
  - `https://perks.packback.app/**`
  - `https://<your-project>.vercel.app/**`
  - (the `/**` wildcard covers `/admin`, `/admin#reset`, and customer paths)

### 3. Supabase → Edge Functions → Secrets
- [ ] `share-cups`: set `ALLOWED_ORIGINS` = `https://perks.packback.network,https://perks.packback.app,https://<your-project>.vercel.app` — **then redeploy `share-cups`** (the CORS code change ships with the deploy). *(Interim: unsetting the old `ALLOWED_ORIGIN` makes it wildcard, which also unblocks all domains.)*
- [ ] Other edge functions already use `Access-Control-Allow-Origin: *`, so no change (tikkie-cashback, uae-payout, byo-mint, etc.).

---

## C. QR codes & redemption — what actually happens

| Scan method | Behaviour | Action |
|---|---|---|
| **In-app camera** (customer taps "add a cup" in PackPerks) | Domain-agnostic — re-enters `?byo=1` on the current origin | ✅ works on all 3 domains, no reprint |
| **Native phone camera** on a **NEW** QR | Opens `VITE_APP_URL` (→ `.network`) | ✅ once B.1 is set |
| **Native phone camera** on an **OLD** printed QR | Opens `perks.packback.app` | ✅ as long as `.app` stays live (B.1) |

**Bottom line:** you do **not** need to reprint existing QR codes. Keep `.app` live and new prints will use `.network`.

---

## D. Worth doing (not blocking)

- [ ] **Admin invite redirect bug:** `invite-admin/index.ts` builds `redirectTo` from the Supabase function URL (`new URL(req.url).origin.replace(/\.supabase\.co.*$/, "")`), which produces a malformed URL. Change it to a configured `APP_URL` Deno env (e.g. `${Deno.env.get("APP_URL")}/admin`). Pre-existing; surfaces now because you're touching auth/domains.
- [ ] (Optional) pick one **canonical** domain for SEO/PWA and 301 the others, *only if* you don't want all three indexed. Not required for functionality.

---

## E. Smoke test after config

1. Load the app on each of the three domains → home renders, cookie banner works.
2. Admin sign-in (OTP) on `.network` and the Vercel URL → the emailed code + redirect land back correctly.
3. Generate a cup QR in admin → the encoded URL starts with `https://perks.packback.network/`.
4. Scan that QR **in-app** on `.network` and on `.app` → a cup is credited on both.
5. Share a cup → the shared link opens and credits on the receiver's device.
