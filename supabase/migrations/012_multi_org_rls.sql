-- ──────────────────────────────────────────────────────────────────────
-- PackPerks — multi-org RLS follow-up (012)
--
-- Migration 011 added the org_id columns + backfill but the existing
-- RLS policies on `organizations`, `locations`, and `app_config` were
-- scoped to "rows where org_id = my home-org" and have NO insert
-- policy at all. That blocks the create-org wizard from working with
-- the error:
--
--   new row violates row-level security policy for table "organizations"
--
-- This migration adds the missing policies. For the prototype we
-- assume any authenticated admin is PackPerks staff (cross-org
-- access). When org-admins land, gate these by an
-- `admin_profiles.is_packperks_staff` boolean instead.
--
-- Safe to re-run: every `create policy` is wrapped in a drop-if-exists.
-- ──────────────────────────────────────────────────────────────────────

-- ── organizations: allow authenticated users to INSERT new orgs ──────
drop policy if exists "authenticated can insert organizations" on public.organizations;
create policy "authenticated can insert organizations"
  on public.organizations
  for insert
  to authenticated
  with check (true);

-- Existing UPDATE policies are scoped to "your home org". The Manage
-- Organisations page (soft-delete / restore) needs to update any org,
-- so we add a permissive UPDATE policy for authenticated users too.
drop policy if exists "authenticated can update organizations" on public.organizations;
create policy "authenticated can update organizations"
  on public.organizations
  for update
  to authenticated
  using (true)
  with check (true);

-- Authenticated can SELECT every org (so the switcher can list them).
drop policy if exists "authenticated can select organizations" on public.organizations;
create policy "authenticated can select organizations"
  on public.organizations
  for select
  to authenticated
  using (true);

-- ── locations: allow authenticated users to manage locations ─────────
-- The wizard inserts the first location for a brand-new org; existing
-- policies likely scope INSERT to a single org_id which wouldn't match
-- a freshly-created org.
drop policy if exists "authenticated can insert locations" on public.locations;
create policy "authenticated can insert locations"
  on public.locations
  for insert
  to authenticated
  with check (true);

drop policy if exists "authenticated can update locations" on public.locations;
create policy "authenticated can update locations"
  on public.locations
  for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "authenticated can select locations" on public.locations;
create policy "authenticated can select locations"
  on public.locations
  for select
  to authenticated
  using (true);

drop policy if exists "authenticated can delete locations" on public.locations;
create policy "authenticated can delete locations"
  on public.locations
  for delete
  to authenticated
  using (true);

-- ── app_config: per-org published rewards/settings ───────────────────
-- The wizard upserts `published:<new_org_id>` after creating the org.
-- The user-facing app reads `published:<org_id>` for each org.
do $$
begin
  if to_regclass('public.app_config') is not null then
    drop policy if exists "authenticated can manage app_config" on public.app_config;
    create policy "authenticated can manage app_config"
      on public.app_config
      for all
      to authenticated
      using (true)
      with check (true);
  end if;
end $$;

-- ── admin_invitations: wizard step 8 creates rows for the new org ────
do $$
begin
  if to_regclass('public.admin_invitations') is not null then
    drop policy if exists "authenticated can insert admin_invitations" on public.admin_invitations;
    create policy "authenticated can insert admin_invitations"
      on public.admin_invitations
      for insert
      to authenticated
      with check (true);
  end if;
end $$;
