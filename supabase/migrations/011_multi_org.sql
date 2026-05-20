-- ─────────────────────────────────────────────────────────────────────
-- PackPerks — Multi-organization foundation (Phase 1 of 6).
--
-- The dashboard and user app were built single-tenant (everything
-- implicitly tied to one Burger King instance). This migration is the
-- *data-layer* groundwork for letting PackPerks staff manage many
-- client organizations (BK, a coffee shop, etc.) from one dashboard.
--
-- What this migration does:
--   1. Extends the existing `organizations` table with the columns
--      multi-tenancy needs (slug for URL routing, logo, brand display
--      name, email domain hint, soft-delete marker).
--   2. Ensures a default "Burger King Netherlands" org row exists and
--      captures its id for backfill.
--   3. Adds `org_id` to every table that holds per-tenant data, with
--      a backfill to the default org so existing rows stay valid.
--   4. Adds `is_packperks_staff` to admin_profiles so we can later
--      distinguish internal staff (cross-org) from org admins (scoped).
--      Every existing admin is marked staff because today they all are.
--   5. Migrates the single `app_config` row (key='published') to a
--      per-org key pattern (key='published:<org_id>') so each org gets
--      its own published rewards + settings JSON document.
--
-- What this migration deliberately does NOT do:
--   • Tighten RLS to enforce org boundaries. That's phase 2/3 once the
--     admin-side context layer is in place and we have an
--     is_packperks_staff helper to reference. For now any authed admin
--     can read/write across orgs exactly as before.
--   • Add per-org storage bucket prefixes. Storage isolation lands in
--     a later migration once the upload paths are updated app-side.
--   • Drop any existing columns or constraints. Everything is additive
--     so the running app keeps working unchanged after this lands.
--
-- Re-running this migration is safe: all DDL uses IF NOT EXISTS / IF
-- EXISTS guards and the backfill is idempotent (it only touches rows
-- where org_id is currently NULL).
-- ─────────────────────────────────────────────────────────────────────


-- ── Step 1: extend `organizations` with multi-tenancy columns ─────────
alter table organizations
  add column if not exists slug text,
  add column if not exists logo_url text,
  add column if not exists partner_brand_name text,
  add column if not exists email_domain_hint text,
  add column if not exists deleted_at timestamptz,
  add column if not exists created_by_packperks_admin uuid references auth.users(id) on delete set null;


-- ── Step 2: ensure a default Burger King org exists ───────────────────
-- If the organizations table is empty (fresh install) seed BK. If a
-- row already exists, we leave it alone — the backfill below uses
-- whichever row sorts oldest as the canonical default.
insert into organizations (name, slug, partner_brand_name, email_domain_hint, brand_color)
select
  'Burger King Netherlands',
  'burgerking',
  'Burger King Netherlands',
  'burgerking.nl',
  '#D62300'
where not exists (select 1 from organizations);

-- Backfill defaults on any pre-existing org rows whose new columns are
-- still NULL. Slug is derived from the name (lowercased, non-alnum
-- replaced with dashes); partner_brand_name defaults to the org name;
-- email_domain_hint defaults to a generic placeholder so the admin can
-- edit it later.
update organizations
set
  slug = coalesce(
    slug,
    lower(regexp_replace(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g'))
  ),
  partner_brand_name = coalesce(partner_brand_name, name),
  email_domain_hint  = coalesce(email_domain_hint, 'example.com')
where slug is null or partner_brand_name is null or email_domain_hint is null;


-- ── Step 3: enforce slug invariants ───────────────────────────────────
-- After the backfill every org has a slug, so we can make it NOT NULL
-- and unique among non-deleted orgs. Soft-deleted orgs are allowed to
-- collide so we can reuse a slug after a delete + recreate.
do $$
begin
  if exists (select 1 from organizations where slug is null) then
    raise exception 'organizations.slug backfill incomplete — refusing to set NOT NULL';
  end if;
end $$;

alter table organizations alter column slug set not null;

create unique index if not exists idx_organizations_slug_active
  on organizations(slug)
  where deleted_at is null;


-- ── Step 4: admin_profiles.is_packperks_staff ─────────────────────────
-- Today every signed-in admin is internal PackPerks staff with full
-- cross-org access. Mark them as such so the org-admin role (added
-- later) can be distinguished without a data migration.
alter table admin_profiles
  add column if not exists is_packperks_staff boolean default true;

update admin_profiles
set is_packperks_staff = true
where is_packperks_staff is null;

alter table admin_profiles
  alter column is_packperks_staff set not null,
  alter column is_packperks_staff set default false;
-- Note: default flipped to false going forward. New rows (created when
-- a future org admin accepts an invitation) default to scoped access.
-- Internal staff get explicitly flagged true at insert time.


-- ── Step 5: add `org_id` to every tenant-scoped table ─────────────────
-- We do this in a single DO block so we can capture the default org's
-- id once and reuse it for the backfill. After this block every row
-- in every tenant table has an org_id, and we then NOT-NULL it.
do $$
declare
  default_org_id uuid;
begin
  select id
    into default_org_id
    from organizations
   where deleted_at is null
   order by created_at asc nulls last
   limit 1;

  if default_org_id is null then
    raise exception 'No default organization found — aborting backfill';
  end if;

  -- users (the customer table)
  execute 'alter table users add column if not exists org_id uuid references organizations(id) on delete restrict';
  execute format('update users set org_id = %L where org_id is null', default_org_id);

  -- cup_balances (per-user cup count; mirrors users.org_id but kept
  -- denormalized for fast balance reads without a join)
  if to_regclass('public.cup_balances') is not null then
    execute 'alter table cup_balances add column if not exists org_id uuid references organizations(id) on delete restrict';
    execute format('update cup_balances set org_id = %L where org_id is null', default_org_id);
  end if;

  -- cups (individual reusable cup tokens)
  execute 'alter table cups add column if not exists org_id uuid references organizations(id) on delete restrict';
  execute format('update cups set org_id = %L where org_id is null', default_org_id);

  -- cup_scans (QR scan audit log) — guard in case the table name differs
  if to_regclass('public.cup_scans') is not null then
    execute 'alter table cup_scans add column if not exists org_id uuid references organizations(id) on delete restrict';
    execute format('update cup_scans set org_id = %L where org_id is null', default_org_id);
  end if;

  -- claims
  execute 'alter table claims add column if not exists org_id uuid references organizations(id) on delete restrict';
  execute format('update claims set org_id = %L where org_id is null', default_org_id);

  -- activity_history (append-only user feed)
  if to_regclass('public.activity_history') is not null then
    execute 'alter table activity_history add column if not exists org_id uuid references organizations(id) on delete restrict';
    execute format('update activity_history set org_id = %L where org_id is null', default_org_id);
  end if;

  -- donation_transfers (added in migration 007)
  if to_regclass('public.donation_transfers') is not null then
    execute 'alter table donation_transfers add column if not exists org_id uuid references organizations(id) on delete restrict';
    execute format('update donation_transfers set org_id = %L where org_id is null', default_org_id);
  end if;

  -- admin_profiles (org membership for org-admins; staff have org_id but ignore it)
  if to_regclass('public.admin_profiles') is not null then
    execute 'alter table admin_profiles add column if not exists org_id uuid references organizations(id) on delete restrict';
    execute format('update admin_profiles set org_id = %L where org_id is null', default_org_id);
  end if;

  -- admin_invitations
  if to_regclass('public.admin_invitations') is not null then
    execute 'alter table admin_invitations add column if not exists org_id uuid references organizations(id) on delete restrict';
    execute format('update admin_invitations set org_id = %L where org_id is null', default_org_id);
  end if;

  -- admin_action_log
  if to_regclass('public.admin_action_log') is not null then
    execute 'alter table admin_action_log add column if not exists org_id uuid references organizations(id) on delete restrict';
    execute format('update admin_action_log set org_id = %L where org_id is null', default_org_id);
  end if;

  -- admin_login_history (admin login audit trail)
  if to_regclass('public.admin_login_history') is not null then
    execute 'alter table admin_login_history add column if not exists org_id uuid references organizations(id) on delete restrict';
    execute format('update admin_login_history set org_id = %L where org_id is null', default_org_id);
  end if;
end $$;


-- ── Step 6: add indexes + DEFAULT (but stay nullable) ─────────────────
-- We intentionally do NOT enforce NOT NULL yet. The existing edge
-- functions (generate-cups, claim-cups, invite-admin, bootstrap-admin)
-- insert rows without org_id; making the column required here would
-- break them until they're individually updated to thread the active
-- org through.
--
-- Instead we:
--   • Set a DEFAULT pointing at the canonical default org (BK) so any
--     edge-function insert that omits org_id auto-tags to BK (no
--     orphan rows, no NOT NULL violations).
--   • Add indexes for query performance.
--
-- Phase 7 will update each edge function to receive org_id from the
-- request body, at which point we can promote these columns to NOT
-- NULL with a follow-up migration.
do $$
declare
  default_org_id uuid;
begin
  select id
    into default_org_id
    from organizations
   where deleted_at is null
   order by created_at asc nulls last
   limit 1;

  if default_org_id is null then
    raise notice 'No default org — skipping default-value setup';
    return;
  end if;

  -- Apply default + index to each tenant table that exists.
  if to_regclass('public.users') is not null then
    execute format('alter table users alter column org_id set default %L', default_org_id);
    create index if not exists idx_users_org_id on users(org_id);
  end if;

  if to_regclass('public.cup_balances') is not null then
    execute format('alter table cup_balances alter column org_id set default %L', default_org_id);
    create index if not exists idx_cup_balances_org_id on cup_balances(org_id);
  end if;

  if to_regclass('public.cups') is not null then
    execute format('alter table cups alter column org_id set default %L', default_org_id);
    create index if not exists idx_cups_org_id on cups(org_id);
  end if;

  if to_regclass('public.cup_scans') is not null then
    execute format('alter table cup_scans alter column org_id set default %L', default_org_id);
    create index if not exists idx_cup_scans_org_id on cup_scans(org_id);
  end if;

  if to_regclass('public.claims') is not null then
    execute format('alter table claims alter column org_id set default %L', default_org_id);
    create index if not exists idx_claims_org_id on claims(org_id);
  end if;

  if to_regclass('public.activity_history') is not null then
    execute format('alter table activity_history alter column org_id set default %L', default_org_id);
    create index if not exists idx_activity_history_org_id on activity_history(org_id);
  end if;

  if to_regclass('public.donation_transfers') is not null then
    execute format('alter table donation_transfers alter column org_id set default %L', default_org_id);
    create index if not exists idx_donation_transfers_org_id on donation_transfers(org_id);
  end if;

  if to_regclass('public.admin_profiles') is not null then
    execute format('alter table admin_profiles alter column org_id set default %L', default_org_id);
    create index if not exists idx_admin_profiles_org_id on admin_profiles(org_id);
  end if;

  if to_regclass('public.admin_invitations') is not null then
    execute format('alter table admin_invitations alter column org_id set default %L', default_org_id);
    create index if not exists idx_admin_invitations_org_id on admin_invitations(org_id);
  end if;

  if to_regclass('public.admin_action_log') is not null then
    execute format('alter table admin_action_log alter column org_id set default %L', default_org_id);
    create index if not exists idx_admin_action_log_org_id on admin_action_log(org_id);
  end if;

  if to_regclass('public.admin_login_history') is not null then
    execute format('alter table admin_login_history alter column org_id set default %L', default_org_id);
    create index if not exists idx_admin_login_history_org_id on admin_login_history(org_id);
  end if;
end $$;


-- ── Step 7: migrate app_config to per-org keys ────────────────────────
-- Today there's a single row keyed 'published' holding {rewards, settings}
-- for the implicit BK org. Going forward each org gets its own row keyed
-- 'published:<org_id>'. We rename the existing row in-place.
do $$
declare
  default_org_id uuid;
  new_key text;
begin
  select id
    into default_org_id
    from organizations
   where deleted_at is null
   order by created_at asc nulls last
   limit 1;

  if default_org_id is null then
    raise notice 'No default org — skipping app_config migration';
    return;
  end if;

  new_key := 'published:' || default_org_id::text;

  -- Only rename if the old single-tenant key is still in use AND the
  -- new per-org key doesn't already exist (idempotent).
  if exists (select 1 from app_config where key = 'published')
     and not exists (select 1 from app_config where key = new_key)
  then
    update app_config set key = new_key where key = 'published';
  end if;
end $$;


-- ── Step 8: housekeeping ──────────────────────────────────────────────
-- Add an `updated_at` to organizations if it's missing (the existing
-- AdminOrg.jsx code reads it for "last edited"). Safe no-op if present.
alter table organizations
  add column if not exists updated_at timestamptz not null default now();

-- Touch the default org so its updated_at is current after the
-- migration runs (useful for the "last edited" UI).
update organizations
   set updated_at = now()
 where id = (select id from organizations where deleted_at is null order by created_at asc nulls last limit 1);
