# PackPerks — Security & Privacy Remediation Plan (GDPR / UAE PDPL)

_Analysis of the 45-item audit against the actual codebase. Assumes the current
MVP still stores IBANs and pays cashback manually (no Tikkie yet)._

---

## 0. System model — why these loopholes exist

PackPerks is a **serverless single-page app**: a React/Vite frontend that talks
**directly to Supabase Postgres using the public `anon` API key**, with a thin
layer of Supabase Edge Functions for the few privileged operations
(`verify-receipt`, `byo-mint`, `claim-cups`, `generate-cups`, admin tools).

Almost every finding traces back to **one design decision**: _customers are
anonymous and there is no application server, so the browser writes customer
rows itself._ To make that work, the tables were opened up with permissive RLS
(`using (true) / with check (true)`), and the anon role was granted the inserts
it needs (users, balances, activity, claims, receipt images).

The feature → loophole map:

| Feature that needed it | Loophole it created | Audit items |
|---|---|---|
| Zero-friction, no-login onboarding (collect cups before signing in) | Anon `INSERT`/`UPDATE`/`SELECT` on `users`, `cup_balances`, `activity_history` | 1, 19, 20, 21 |
| Client-side cashback claim (no server) | Anon `INSERT` on `claims`; IBAN written from the browser | 2, 3, 4 |
| Receipt upload before a session exists | Anon `INSERT`/`SELECT` on the `receipts` storage bucket | 2, 29 |
| AI receipt verification | Receipt image + extracted data sent to Anthropic (US) | 8, 9, 36 |
| Per-store profile / multi-org | IBAN duplicated across `users`, `customer_identities`, `claims` | 3, 33 |
| Product analytics without a backend | Anon `INSERT` on `client_events` | 17, 18, 30 |
| Staff-only prototype (every admin = PackPerks staff) | `to authenticated using(true)` on org/config/customer tables — any admin can read/write any org | 1, 5, 25, 26, 27, 28 |
| Manual payouts | IBAN exported out-of-band; no mapped flow | 6, 35, 42 |

**Two findings are already (partly) handled in the current code — verify before spending time on them:**
- **#4 (IBAN in `localStorage`)**: the current build only persists `packperks_device_id`; the profile/IBAN is held in React state, not `localStorage` (`src/lib/api.js` top comment + `usePersistedState` is used only for `claimed`/`hiw_seen`). Likely a stale finding — **confirm, then close.**
- **#5 (admin IBAN masking)**: `src/admin/shared/PiiMask.jsx` and `AdminReceiptCheck.jsx` already mask IBANs in the UI. What's missing is **role-gating** (payout-admin only) and masking everywhere IBAN is shown.

---

## 1. Severity-ranked remediation plan

Ranked by **risk × likelihood × blast-radius**, then grouped by effort. "P0" = do
before any real customer/PII goes in; "P1" = before public launch; "P2" = before
scaling / adding partners.

### P0 — Data-exposure blockers (days, not weeks)

1. **Lock down anon RLS on customer tables** (items 1, 2). Remove blanket
   anon/`using(true)` read/update; keep only the minimal inserts the app needs,
   or move writes behind Edge Functions. _This is the single biggest fix._ → §2.
2. **Consolidate IBAN into one restricted `payout_details` table**, drop it from
   `users`/`claims`/`customer_identities`, and never expose it to `anon`
   (items 3, 16, 35). → §4.
3. **Confirm no IBAN in `localStorage`** (item 4) — verify + add a visible
   "clear my data" reset (item 34).
4. **Role-gate IBAN viewing** to a `payout_admin` role; mask everywhere else
   (item 5). Extend the existing `PiiMask`.
5. **Route `claims` writes through an Edge Function** so status/payout fields
   can't be set from the browser (item 2).

### P1 — Legal-basis & transparency blockers (1–3 weeks, mostly writing)

6. In-app privacy notice at each collection point — email, IBAN, receipt
   (items 10, 11, 43, 38).
7. Privacy policy rewritten to match the real system: Supabase(EU), Vercel,
   Anthropic(US), email relay, analytics, manual payouts (item 10).
8. Sign/verify **DPAs** with Supabase, Vercel, Anthropic, email relay; capture
   Anthropic **no-training/no-retention** + SCC/DPF status (items 7, 8, 31).
9. Manual **DSAR process** (access/delete/export/correct) with an owner + SLA
   (item 13, 40).
10. **Retention & deletion schedule** + automated jobs: receipt/scan images,
    claims, analytics, admin logs (items 14, 15, 27, 30). → cron/Edge jobs.
11. **Lawful-basis table** per purpose (item 12) and **ROPA** (item 22).
12. **Analytics consent decision**: legitimate-interest telemetry vs. consented
    analytics; cookie/localStorage notice (items 17, 18).

### P2 — Scale & partner blockers (before adding partners / UAE)

13. Controller/processor roles per partner + partner access model (items 25, 26).
14. DPIA-lite (financial data + receipt images + AI + cross-border) (item 23).
15. Breach-notification runbook (72h GDPR / UAE) (item 24).
16. UAE PDPL notice + cross-border basis; DIFC/ADGM check (items 9, 38, 39).
17. Internal handling policy (Slack/screenshots/exports) + payout-export
    deletion policy (items 41, 42).
18. Duplicate-identity / tombstone minimisation (item 33); signed-URL hygiene
    (item 29); `app_config` public-read review (item 32); fraud-data purpose
    limitation (item 37); no-IBAN cashback fallback (item 44); no behavioural
    targeting yet (item 45).

---

## 2. The exact Supabase RLS / security changes needed FIRST

Goal: **anon can do the minimum to onboard and submit — nothing else.** Read/
update of PII moves to the owner (authenticated) or to Edge Functions. Sketch —
adapt table/column names to your schema and test in a branch DB first.

```sql
-- ── 2.1 Kill the blanket permissive policies ──────────────────────────
-- Drop every "using (true) / with check (true)" customer-table policy that
-- targets anon (and the "to authenticated using(true)" cross-org admin ones).
-- Enumerate first:
--   select schemaname, tablename, policyname, roles, cmd, qual, with_check
--   from pg_policies where schemaname='public' order by tablename;

-- ── 2.2 users: anon may INSERT its own row + SELECT/UPDATE only its own ──
alter table public.users enable row level security;
drop policy if exists "users_anon_all" on public.users;         -- remove broad grant

-- Anon can create exactly one row keyed to its device_id (no admin cols).
create policy "users: anon insert self" on public.users
  for insert to anon
  with check (auth_user_id is null and iban is null);           -- IBAN via payout table only

-- Read/update your own row only (matched by device_id passed as a GUC or,
-- better, after adopting Supabase anonymous auth, by auth.uid()).
create policy "users: owner select" on public.users
  for select to authenticated using (auth_user_id = auth.uid());
create policy "users: owner update" on public.users
  for update to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

-- ── 2.3 claims: NO client-set status/payout. Insert via Edge Function ──
drop policy if exists "claims: authed insert" on public.claims;
drop policy if exists "claims: authed owner update" on public.claims;
-- (no anon/authenticated write policies at all → only service_role, i.e. the
--  create-claim Edge Function, can insert; verify-receipt already runs as
--  service_role and sets status server-side.)
create policy "claims: owner read" on public.claims
  for select to authenticated using (user_id in
    (select id from public.users where auth_user_id = auth.uid()));

-- ── 2.4 cup_balances / activity_history: credited server-side only ─────
-- Remove anon/authenticated INSERT/UPDATE; balances change only inside
-- claim-cups / byo-mint (service_role). Keep owner SELECT.
drop policy if exists "cup_balances: authed insert" on public.cup_balances;
drop policy if exists "cup_balances: authed update" on public.cup_balances;

-- ── 2.5 receipts bucket: drop anon SELECT; upload via signed URL only ──
drop policy if exists "PackPerks receipts: anon select" on storage.objects;
-- Keep a narrow anon INSERT (or switch to short-lived signed upload URLs
-- minted by an Edge Function). Reads: admin/service_role only, via signed URL.

-- ── 2.6 gate admin cross-org access behind a real role ─────────────────
-- Replace "to authenticated using(true)" on organizations/locations/app_config
-- /users with a check against admin_profiles.is_packperks_staff (or org match).
create policy "orgs: staff manage" on public.organizations
  for all to authenticated
  using (exists (select 1 from public.admin_profiles ap
                 where ap.auth_user_id = auth.uid() and ap.is_packperks_staff))
  with check (exists (select 1 from public.admin_profiles ap
                 where ap.auth_user_id = auth.uid() and ap.is_packperks_staff));
```

**The clean way to make the "owner only" policies actually work for anonymous
customers: adopt Supabase _Anonymous Sign-in_.** It gives every first-time
visitor a real (anonymous) `auth.uid()` with zero UX friction, so `using
(auth_user_id = auth.uid())` becomes enforceable and you can delete the anon
`using(true)` grants entirely. This is the recommended backbone for fixes 1 & 2.

**Order of operations (so you don't lock the app out):** branch DB → add the new
narrow policies → point writes at Edge Functions / anonymous-auth → smoke-test
the customer + admin flows → drop the old permissive policies → deploy.

---

## 3. Per-problem solutions, recommendations & trade-offs

Detailed for the criticals; grouped for the rest. **R =** recommended.

### #1 Permissive anon RLS on PII tables
- **A.** Adopt **Supabase Anonymous Sign-in** + strict owner-scoped policies
  (`auth.uid()`). **R** — smallest UX change, enforceable per-row, removes the
  `using(true)` grants. _Trade-off:_ every visitor becomes an `auth.users` row
  (more auth rows; wire cleanup for abandoned ones).
- **B.** Move **all** customer writes behind Edge Functions (service_role);
  anon gets zero table grants. _Trade-off:_ more functions to build/maintain;
  higher latency per action.
- **C.** Keep anon writes but add per-row `WITH CHECK` on a device-id GUC.
  _Trade-off:_ device_id is client-supplied → weak ownership proof; not real
  security. **Not recommended** beyond a stopgap.

### #2 Anon insert/update on `claims`
- **A. R** — `create-claim` Edge Function is the **only** writer; drop client
  write policies; client never sets `status`/`payout`/`amount`. _Trade-off:_
  one function + a small client refactor.
- **B.** Keep anon insert but add a DB `CHECK`/trigger forcing `status='pending'`
  and server-owned fields. _Trade-off:_ trigger logic is fragile vs. a function;
  still lets anon spam-insert.

### #3 IBAN stored in 3 places
- **A. R** — single `payout_details` table (one row per identity), IBAN removed
  from `users`/`claims`/`customer_identities`; claims reference `payout_id`.
  _Trade-off:_ migration + backfill + touch every read path. → §4.
- **B.** Keep one column on `customer_identities` only. _Trade-off:_ still on a
  broadly-readable table; less clean deletion story.

### #4 IBAN in `localStorage`
- **A. R** — **confirm it's already gone** (current code only persists
  `device_id`); if any path still caches it, remove and add a "Clear my data"
  button. _Trade-off:_ none. Likely already resolved.

### #5 Admin IBAN access control
- **A. R** — add a `payout_admin` capability; only that role can call the
  "reveal IBAN" Edge Function; everyone else sees the existing `PiiMask`.
  _Trade-off:_ needs a role field + one gated function.
- **B.** Never show full IBAN in-app; export-only for payout. _Trade-off:_
  harder manual reconciliation.

### #6 / #35 / #42 Manual payout flow off-map
- **R** — write the payout SOP: IBAN pulled **only** via a logged
  `export-payouts` Edge Function (payout_admin only) → time-boxed secure file →
  deleted after payment confirmation; log who/when/what. _Trade-off:_ process
  discipline; add an `payout_exports` audit table.

### #7 / #8 / #31 DPAs & Anthropic transfer
- **R** — sign Supabase/Vercel/Anthropic/email DPAs; get Anthropic's
  **no-training + zero-retention** (API default) + DPF/SCC in writing; record in
  ROPA. _Trade-off:_ paperwork only. (Consider an EU inference route later to
  drop finding #8 entirely — larger change.)

### #9 / #38 / #39 UAE PDPL
- **R** — add UAE notice (EU storage + US AI transfer + rights + deletion
  route); document transfer basis; **decide DIFC/ADGM applicability** with the
  partner entity. _Trade-off:_ if a partner is in DIFC/ADGM, that free-zone law
  adds requirements — scope early.

### #10–#13, #22–#24, #38, #40 Documentation & process
- **R** — one bundle: privacy policy rewrite, in-app just-in-time notices,
  lawful-basis table, ROPA, DPIA-lite, DSAR runbook, breach runbook, named
  privacy owner. _Trade-off:_ ~1–2 weeks of writing; low code. Highest
  legal-risk reduction per hour.

### #14–#16, #27, #30 Retention & deletion
- **A. R** — scheduled Edge Function / `pg_cron`: delete receipt & scan images
  N days after claim resolution (e.g. 90); purge/anon analytics > 12–24 mo;
  admin logs > 12 mo; mask IBAN on claims after payout + accounting window.
  _Trade-off:_ must keep minimal financial proof (see #35) → keep a masked
  payout ledger, delete the raw IBAN.
- **B.** Manual quarterly purges. _Trade-off:_ cheap now, unreliable, doesn't
  scale, weak audit story.

### #17 / #18 Analytics consent
- **A. R** — classify `client_events` as **essential product telemetry** under
  legitimate interest (no ad networks, no cross-site), document the LIA, add a
  localStorage/telemetry notice, offer opt-out. _Trade-off:_ must genuinely keep
  it non-marketing (see #37).
- **B.** Treat as non-essential → consent banner gating. _Trade-off:_ worse data
  completeness; more UX friction.

### #19–#21 Device ID / fingerprint / behavioural profile
- **R** — treat device_id + parsed UA + behaviour as **pseudonymous personal
  data**: include in the notice, retention and deletion logic; rotate/clear on
  request. _Trade-off:_ none beyond doc + delete wiring.

### #25 / #26 Controller/processor & partner access
- **R** — PackPerks = **controller** for the customer relationship; partners get
  **aggregate stats only** (no user rows/emails/IBANs/receipts) under a data-
  sharing addendum. _Trade-off:_ enforce with org-scoped RLS for partner admins
  when they land (Phase 7).

### #29 / #32 / #33 / #37 / #44 / #45 Remaining mediums
- Signed-URL expiry short + no URL logging (#29); audit `app_config` for secrets
  (#32); ensure merge/tombstone scrubs email/IBAN/device (#33); firewall fraud
  data from marketing (#37); add a **"skip cashback / non-cash reward"** path so
  IBAN is never forced (#44 — **R**, also reduces data collection); **no
  behavioural targeting until P0/P1 done** (#45).

---

## 4. Database changes to reduce IBAN exposure (keeping manual payout)

```sql
-- 4.1 One restricted home for payout data. Never granted to anon.
create table public.payout_details (
  id           uuid primary key default gen_random_uuid(),
  identity_id  uuid unique references public.customer_identities(id) on delete cascade,
  iban         text not null,
  iban_last4   text generated always as (right(regexp_replace(iban,'\s','','g'),4)) stored,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.payout_details enable row level security;
-- No anon/authenticated policies → only service_role (Edge Functions) touches it.

-- 4.2 Claims stop carrying the raw IBAN; keep a reference + last4 for display.
alter table public.claims add column payout_id uuid references public.payout_details(id);
alter table public.claims add column iban_last4 text;   -- for admin list, no full IBAN

-- 4.3 Backfill, then drop the raw columns.
--   insert into payout_details(identity_id, iban) select ... ;   -- de-dupe by identity
--   update claims set payout_id = ..., iban_last4 = right(...,4);
alter table public.users               drop column iban;
alter table public.customer_identities drop column iban;
alter table public.claims              drop column iban;   -- after backfill + app updated

-- 4.4 Post-payout minimisation (retention): keep the ledger, drop the IBAN.
--   e.g. nightly job: delete from payout_details p
--        where not exists (unpaid claim) and p.updated_at < now() - interval '½ your accounting window';
--   leaving claims.iban_last4 + amount + date as the financial record.
```

**Edge Functions to add/adjust (service_role):**
- `save-payout` — validates + upserts `payout_details` for the caller's identity
  (replaces the browser writing `users.iban`).
- `export-payouts` — payout_admin only; returns IBANs for **pending** claims,
  logs the export, and is the **only** read path for full IBANs.
- `reveal-iban` — payout_admin only, single-claim, audited (for support).

**Client changes:** IBAN input calls `save-payout` (never writes `users.iban`);
admin screens read `iban_last4` from `claims` and call `reveal-iban` on demand.

_Trade-off:_ a migration + backfill and touching every IBAN read/write path, but
it shrinks the breach surface from "3 broadly-readable tables + the browser" to
"one table only Edge Functions can read," and makes deletion/retention a single
place. This is the highest-leverage privacy change after the RLS lockdown.

---

## 5. Minimum GDPR / UAE launch checklist (4-person startup)

Ship-blockers only — the pragmatic floor to launch with real users:

**Security (P0)**
- [ ] No `anon`/`using(true)` read or update on any table with email/IBAN/
      device/balance/history (§2). Verified with `pg_policies`.
- [ ] `claims` writable only via Edge Function; status/amount server-set.
- [ ] IBAN in one restricted table; not on anon-readable tables; not in
      `localStorage`; masked in UI; full value only via audited payout_admin
      function (§4).
- [ ] Private receipt bucket; no anon SELECT; short-lived signed URLs.
- [ ] Admin cross-org access gated by a real staff/role check, not `using(true)`.

**Legal & transparency (P1)**
- [ ] Privacy policy matches reality (Supabase EU, Vercel, Anthropic US, email
      relay, analytics, manual payout) + named privacy owner + contact.
- [ ] Just-in-time in-app notice at email / IBAN / receipt capture, incl. the
      US AI transfer and "when/why we pay you" (#43).
- [ ] Signed/verified DPAs: Supabase, Vercel, Anthropic (no-train/no-retain),
      email relay.
- [ ] Lawful-basis table (1 page) + ROPA (1 page) + retention schedule (1 page).
- [ ] Manual DSAR path (access/export/delete/correct) with owner + 30-day SLA.
- [ ] Retention jobs live: receipt/scan images auto-deleted (~90d post-review);
      analytics + admin logs bounded (12–24 mo).
- [ ] Analytics classified (legitimate-interest telemetry) + opt-out + notice.
- [ ] Breach runbook (72h) — even a 1-page checklist.

**UAE (only if launching there)**
- [ ] UAE notice: EU storage + US AI transfer + rights + deletion route.
- [ ] Cross-border transfer basis documented; DIFC/ADGM applicability decided.

**Nice-to-have before scale:** DPIA-lite, partner data-sharing addenda + partner
RLS, internal Slack/export handling policy, "skip cashback" fallback.

---

### Deploy constraint note
Every §2 RLS change and every §4 schema/Edge-Function change is a **Supabase
migration / function deploy**. They can't be applied from this session (Supabase
CLI/MCP not connected here). This document is the spec — apply it against a
branch DB, smoke-test the customer + admin flows, then promote.
