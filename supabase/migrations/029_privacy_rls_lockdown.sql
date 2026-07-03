-- ──────────────────────────────────────────────────────────────────────
-- PackPerks — 029: RLS lockdown (audit items 1 & 2)
--
-- ⚠️ DEPLOY-PENDING / REVIEW FIRST — authored offline. Apply on a BRANCH DB,
-- switch the client to Supabase Anonymous Sign-in FIRST (so every visitor has
-- an auth.uid()), smoke-test the customer + admin flows, THEN drop the old
-- permissive policies. Enumerate current policies before running:
--   select tablename, policyname, roles, cmd, qual, with_check
--   from pg_policies where schemaname='public' order by tablename, policyname;
--
-- Model after this migration:
--   • Anonymous customers sign in anonymously → they get a real auth.uid()
--     which we store on users.auth_user_id. RLS is scoped to that id.
--   • Customer WRITES that credit balances / create claims go through
--     service_role Edge Functions only (claim-cups, byo-mint, create-claim).
--   • Admins are gated by admin_profiles.is_packperks_staff, not `using(true)`.
-- ──────────────────────────────────────────────────────────────────────

-- Helper: is the caller a PackPerks staff admin?
create or replace function public.is_staff_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.admin_profiles ap
    where ap.auth_user_id = auth.uid() and coalesce(ap.is_packperks_staff, false)
  );
$$;

-- ── users: owner-scoped read/update; anon may only INSERT its own row ──
-- drop the broad grants first (names will vary — see the enumeration query):
--   drop policy if exists "users: authed insert" on public.users;   -- etc.
drop policy if exists "users_owner_select" on public.users;
create policy "users_owner_select" on public.users
  for select to authenticated
  using (auth_user_id = auth.uid() or public.is_staff_admin());

drop policy if exists "users_owner_update" on public.users;
create policy "users_owner_update" on public.users
  for update to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid() and iban is null);   -- IBAN only via save-payout

-- First-run insert (anonymous-auth session): create exactly your own row,
-- with no admin columns and no IBAN.
drop policy if exists "users_self_insert" on public.users;
create policy "users_self_insert" on public.users
  for insert to authenticated
  with check (auth_user_id = auth.uid() and iban is null);

-- ── claims: NO client writes. Only service_role (create-claim / verify-
-- receipt) inserts and sets status. Owner may read their own. ──
drop policy if exists "claims: authed insert" on public.claims;
drop policy if exists "claims: authed owner update" on public.claims;
drop policy if exists "claims_owner_select" on public.claims;
create policy "claims_owner_select" on public.claims
  for select to authenticated
  using (
    public.is_staff_admin()
    or user_id in (select id from public.users where auth_user_id = auth.uid())
  );

-- ── cup_balances / activity_history: credited server-side only; owner reads ──
drop policy if exists "cup_balances: authed insert" on public.cup_balances;
drop policy if exists "cup_balances: authed update" on public.cup_balances;
drop policy if exists "activity_history: authed insert" on public.activity_history;
-- (leave the existing owner/admin SELECT policies; balances now change only
--  inside claim-cups / byo-mint, which run as service_role.)

-- ── receipts bucket: drop anon SELECT; uploads via short-lived signed URL ──
drop policy if exists "PackPerks receipts: anon select" on storage.objects;
-- reads: service_role / admins only (signed URLs minted server-side).

-- ── organizations / locations / app_config: gate cross-org admin writes ──
-- Replace the "to authenticated using(true)" policies from migration 012 with
-- a staff check. Example for organizations (repeat for locations/app_config):
drop policy if exists "authenticated can update organizations" on public.organizations;
create policy "staff can update organizations" on public.organizations
  for update to authenticated using (public.is_staff_admin()) with check (public.is_staff_admin());
drop policy if exists "authenticated can insert organizations" on public.organizations;
create policy "staff can insert organizations" on public.organizations
  for insert to authenticated with check (public.is_staff_admin());

-- app_config stays anon-readable for published:* (customer app needs it), but
-- restrict WRITES to staff:
drop policy if exists "authenticated can manage app_config" on public.app_config;
create policy "staff can write app_config" on public.app_config
  for all to authenticated using (public.is_staff_admin()) with check (public.is_staff_admin());
-- keep a separate anon SELECT for published keys only:
drop policy if exists "anon read published app_config" on public.app_config;
create policy "anon read published app_config" on public.app_config
  for select to anon using (key like 'published:%');
