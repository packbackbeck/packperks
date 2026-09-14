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
npm run lint       # eslint . — the repo ships with ~240 pre-existing errors
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
   actually look at the page before saying it works.
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

**Mode** decides which app a venue runs:
- default — full app: cup balance, rewards, claims
- `tikkie_only` (“Redirect Refund”) — smart bin prints a receipt, no app,
  no rewards; the wallet home is `TikkieHomePage.jsx`
- BYO group — customers bring their own cup, counter QR

**Region** (`src/lib/regions.js`) is derived from `organizations.country` and
decides currency, map focus, payout provider and copy. NL/EUR (Tikkie, live)
and AE/AED (`uae` adapter, **not live** — mechanism undecided). Region copy
goes through `payoutCopy()`: `link` regions promise a link to collect,
`direct` regions promise only that the cashback is sent. Never make a
`direct` region promise a link.

**Payment method** (`src/lib/paymentMethods.js`): `tikkie` (cashback after
review) or `voucher` (slider voucher redeemed at the counter). Resolution is
org → group → default.

**Admin roles** (`src/admin/lib/roles.js`, `AuthContext.hasPermission`):
`owner` > `admin` > `manager` > `checker` > `vendor`. Vendor is the venue's own
staff: read-only, three pages (`VENDOR_TABS` = overview, reports, behaviour),
pinned to one store. Staff roles carry `org_id: null` and see every org;
vendor is the only role scoped to one.

`#overview?as=vendor` previews the vendor view. It can only ever *remove*
access, so any staff role may use it.

---

## Where things live

| | |
|---|---|
| `src/App.jsx` | customer app shell and routing — large, read before editing |
| `src/lib/regions.js` | currency, region seed, `formatMoney`, `payoutCopy` |
| `src/lib/RegionContext.jsx` | `useRegion()`, `useMoney()` for the customer app |
| `src/admin/lib/adminApi.js` | every admin query; ~5k lines |
| `src/admin/lib/adminMoney.js` | `useAdminMoney()` / `adminMoney()` — dashboard currency |
| `src/admin/lib/demoData.js` | the “Demo numbers” dataset |
| `src/admin/context/orgState.js` | module-level active org for non-React callers |
| `supabase/functions/` | ~30 edge functions |
| `supabase/migrations/` | numbered SQL migrations |

The three analytics readers behind the dashboard, all in `adminApi.js`:
`getAdminStats` (Overview), `getStatsMetrics` (System Health),
`getUserBehaviourStats` → `computeMetrics` (User Behaviour).

---

## Supabase

Project ref `ozvcpbthnauitaphosfb`. Use the Supabase MCP tools — `execute_sql`,
`apply_migration`, `deploy_edge_function`. The CLI is **not** authenticated
here (`supabase functions deploy` fails on a missing token), so deploy edge
functions through MCP with the full file contents inline, and keep the local
copy in `supabase/functions/` in sync in the same commit.

---

## Landmines

Things that have already cost real time. Read before touching the area.

**Org isolation is not enforced in the database.** `applyOrgFilter()` adds
`.eq('org_id', …)` in JavaScript. The RLS policies say
`(current_admin()).id IS NOT NULL` with no org constraint. Any authenticated
admin can read every org's rows. Treat org scoping as a UI convention, not a
security boundary, and never hand out a Supabase key expecting it to filter.

**The anon key exposes the customer list.** `users`, `cup_scans` and
`cup_balances` each carry an `anon select` policy with condition `true`. The
anon key ships in the customer bundle, so all user rows including real email
addresses are publicly readable. `claims` is correctly protected. **Still
open** — fix by scoping those three policies to the requesting device.

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

**Admin “delete user” does not delete the login.** `admin_purge_users` is a
Postgres function; deleting an `auth.users` row needs the Auth Admin API, which
SQL cannot call. So the app rows go, the login survives, and the next sign-in
rebuilds the profile and copies the email back off the auth account — balance
gone, account back. The customer's own `delete-my-account` edge function does
it properly (`auth.admin.deleteUser`). **Still open**: an admin-side delete
needs the same two-step in an edge function.

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
