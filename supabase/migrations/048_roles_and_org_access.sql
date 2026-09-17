-- 048 — Roles with three levels, and the organisations each account sees.
--
-- Every dashboard account now holds a role from `admin_roles`. A role has a
-- level — master, manager or vendor — and, per dashboard tab, whether the
-- tab is hidden, view-only or editable. Masters (PackBack staff) see every
-- organisation and own Master Settings: people, roles, organisations and the
-- workspace tabs. Everyone else sees the organisations listed on their
-- account (`org_ids`), or all of them when `all_orgs` is set.
--
-- Expand only. The old `role` column stays, and a trigger keeps it in step
-- with the new role (master → admin, or owner for the founding account;
-- manager → manager, or checker when the role can change nothing; vendor →
-- vendor). Edge functions and the dashboard build that is live today keep
-- reading `role` and behave as before. `org_id` follows the first
-- organisation, or null for accounts that see all of them.
--
-- Backfill: owners and admins become masters. Managers stay managers and
-- keep seeing every organisation, as they did; a master can narrow that in
-- Master Settings → People. Checkers become Viewers (a manager-level role
-- that changes nothing). Vendors keep their one venue. A write that still
-- sets only the old role name is translated the same way.
--
-- What the database enforces: the level (only masters manage people, roles,
-- organisations, groups, regions and the workspace tabs), and whether an
-- account can write at all (`is_staff_writer`: a master, or a role with at
-- least one editable tab). Which tab may be changed, and which organisations
-- are shown, is enforced by the dashboard, as org scoping was before.

-- ── Roles ───────────────────────────────────────────────────────────────
create table if not exists public.admin_roles (
  key         text primary key check (key ~ '^[a-z][a-z0-9_]{1,31}$'),
  label       text not null check (length(btrim(label)) between 1 and 40),
  level       text not null check (level in ('master', 'manager', 'vendor')),
  description text not null default '',
  tabs        jsonb not null default '{}'::jsonb check (jsonb_typeof(tabs) = 'object'),
  built_in    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.admin_profiles(id) on delete set null,
  -- There is one master role. Custom roles are managers or vendors.
  constraint admin_roles_single_master check (level <> 'master' or key = 'master')
);

alter table public.admin_roles enable row level security;

insert into public.admin_roles (key, label, level, description, tabs, built_in) values
  ('master', 'Master', 'master',
   'PackBack staff. Every organisation, every tab, and Master Settings.',
   '{}'::jsonb, true),
  ('manager', 'Manager', 'manager',
   'Runs their organisations day to day: claims, rewards, customers and settings.',
   '{"overview":"edit","stats":"edit","behaviour":"view","reports":"edit",
     "users":"edit","claims":"edit","cupscans":"edit","transactions":"view","donations":"edit",
     "rewards":"edit","appdesign":"edit","cupqr":"edit","byorequests":"edit","futurevendors":"edit",
     "tikkielog":"edit","smartbins":"edit","backupcups":"edit","emailtemplates":"edit",
     "settings":"edit","history":"edit","support":"view"}'::jsonb, true),
  ('vendor', 'Vendor', 'vendor',
   'Read-only reporting for their venue.',
   '{"overview":"view","stats":"hidden","behaviour":"view","reports":"view",
     "users":"hidden","claims":"hidden","cupscans":"hidden","transactions":"hidden","donations":"hidden",
     "rewards":"hidden","appdesign":"hidden","cupqr":"hidden","byorequests":"hidden","futurevendors":"hidden",
     "tikkielog":"hidden","smartbins":"hidden","backupcups":"hidden","emailtemplates":"hidden",
     "settings":"hidden","history":"hidden","support":"view"}'::jsonb, true),
  ('viewer', 'Viewer', 'manager',
   'Sees what a manager sees and changes nothing.',
   '{"overview":"view","stats":"view","behaviour":"view","reports":"view",
     "users":"view","claims":"view","cupscans":"view","transactions":"view","donations":"view",
     "rewards":"view","appdesign":"view","cupqr":"view","byorequests":"view","futurevendors":"view",
     "tikkielog":"view","smartbins":"view","backupcups":"view","emailtemplates":"view",
     "settings":"view","history":"view","support":"view"}'::jsonb, false)
on conflict (key) do nothing;

-- Built-in roles keep their key and level and can't be deleted. A role that
-- people hold can't be deleted either (foreign keys below).
create or replace function public.admin_roles_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.built_in then
      raise exception 'built_in_role' using errcode = '42501';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    new.key := old.key;
    new.built_in := old.built_in;
    new.created_at := old.created_at;
    if old.built_in then
      new.level := old.level;
    end if;
  elsif current_user in ('anon', 'authenticated') then
    new.built_in := false;
  end if;
  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists trg_admin_roles_guard on public.admin_roles;
create trigger trg_admin_roles_guard
  before insert or update or delete on public.admin_roles
  for each row execute function public.admin_roles_guard();

-- ── Accounts and invitations ────────────────────────────────────────────
alter table public.admin_profiles
  add column if not exists access_role text
    references public.admin_roles(key) on update cascade on delete restrict,
  add column if not exists org_ids uuid[] not null default '{}',
  add column if not exists all_orgs boolean not null default false;

alter table public.admin_invitations
  add column if not exists access_role text
    references public.admin_roles(key) on update cascade on delete set null,
  add column if not exists org_ids uuid[] not null default '{}',
  add column if not exists all_orgs boolean not null default false;

create index if not exists admin_profiles_access_role_idx on public.admin_profiles (access_role);

-- The old role name a new role maps to.
create or replace function public.admin_access_legacy_role(p_role text, p_current text)
returns text
language sql
stable
set search_path = public
as $$
  select case
    when r.level = 'master' then case when p_current = 'owner' then 'owner' else 'admin' end
    when r.level = 'vendor' then 'vendor'
    when exists (select 1 from jsonb_each_text(r.tabs) t where t.value = 'edit') then 'manager'
    else 'checker'
  end
  from public.admin_roles r
  where r.key = p_role
$$;

-- The new role an old role name stands for. A checker becomes a Viewer
-- (null if that role has been deleted: the account then keeps its old role).
create or replace function public.admin_access_for_legacy_role(p_role text)
returns text
language sql
stable
set search_path = public
as $$
  select case p_role
    when 'owner' then 'master'
    when 'admin' then 'master'
    when 'manager' then 'manager'
    when 'vendor' then 'vendor'
    when 'checker' then (select key from public.admin_roles where key = 'viewer')
  end
$$;

-- Keeps role and org_id in step with access_role, org_ids and all_orgs.
-- A write that only sets the old role (the dashboard build live before this
-- migration, older edge functions) is translated into the new fields first.
create or replace function public.admin_profiles_sync_access()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  lvl text;
begin
  if (tg_op = 'INSERT' and new.access_role is null)
     or (tg_op = 'UPDATE' and new.role is distinct from old.role
         and new.access_role is not distinct from old.access_role) then
    new.access_role := public.admin_access_for_legacy_role(new.role);
    if new.access_role is null then
      return new;
    end if;
    new.all_orgs := new.role in ('owner', 'admin')
      or (new.role in ('manager', 'checker') and new.org_id is null);
    new.org_ids := case when new.org_id is not null then array[new.org_id] else '{}'::uuid[] end;
  end if;
  if new.access_role is null then
    return new;
  end if;
  select level into lvl from public.admin_roles where key = new.access_role;
  if lvl is null then
    return new;
  end if;
  new.role := public.admin_access_legacy_role(new.access_role, new.role);
  new.org_ids := coalesce(new.org_ids, '{}');
  if lvl = 'master' then
    new.all_orgs := true;
    new.org_id := null;
  else
    new.org_id := case when new.all_orgs then null else new.org_ids[1] end;
  end if;
  return new;
end
$$;

drop trigger if exists trg_admin_profiles_sync_access on public.admin_profiles;
create trigger trg_admin_profiles_sync_access
  before insert or update of access_role, org_ids, all_orgs, role on public.admin_profiles
  for each row execute function public.admin_profiles_sync_access();

create or replace function public.admin_invitations_sync_access()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  lvl text;
begin
  if (tg_op = 'INSERT' and new.access_role is null)
     or (tg_op = 'UPDATE' and new.role is distinct from old.role
         and new.access_role is not distinct from old.access_role) then
    new.access_role := public.admin_access_for_legacy_role(new.role);
    if new.access_role is null then
      return new;
    end if;
    new.all_orgs := new.role = 'admin'
      or (new.role in ('manager', 'checker') and new.org_id is null);
    new.org_ids := case when new.org_id is not null then array[new.org_id] else '{}'::uuid[] end;
  end if;
  if new.access_role is null then
    return new;
  end if;
  select level into lvl from public.admin_roles where key = new.access_role;
  if lvl is null then
    return new;
  end if;
  new.role := public.admin_access_legacy_role(new.access_role, null);
  new.org_ids := coalesce(new.org_ids, '{}');
  if lvl = 'master' then
    new.all_orgs := true;
    new.org_id := null;
  else
    new.org_id := case when new.all_orgs then null else new.org_ids[1] end;
  end if;
  return new;
end
$$;

drop trigger if exists trg_admin_invitations_sync_access on public.admin_invitations;
create trigger trg_admin_invitations_sync_access
  before insert or update of access_role, org_ids, all_orgs, role on public.admin_invitations
  for each row execute function public.admin_invitations_sync_access();

-- A role's tabs decide whether its holders may write, so re-derive the old
-- role name for everyone holding it when the role changes.
create or replace function public.admin_roles_resync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.level is distinct from old.level or new.tabs is distinct from old.tabs then
    update public.admin_profiles set access_role = access_role where access_role = new.key;
    update public.admin_invitations set access_role = access_role
      where access_role = new.key and status = 'pending';
  end if;
  return null;
end
$$;

drop trigger if exists trg_admin_roles_resync on public.admin_roles;
create trigger trg_admin_roles_resync
  after update on public.admin_roles
  for each row execute function public.admin_roles_resync();

-- Backfill.
update public.admin_profiles
set access_role = public.admin_access_for_legacy_role(role),
    all_orgs = role in ('owner', 'admin') or (role in ('manager', 'checker') and org_id is null),
    org_ids = case when org_id is not null then array[org_id] else '{}'::uuid[] end
where access_role is null;

update public.admin_invitations
set access_role = public.admin_access_for_legacy_role(role),
    all_orgs = role = 'admin' or (role in ('manager', 'checker') and org_id is null),
    org_ids = case when org_id is not null then array[org_id] else '{}'::uuid[] end
where access_role is null;

-- ── Who the caller is ───────────────────────────────────────────────────
create or replace function public.admin_level()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    r.level,
    case
      when p.role in ('owner', 'admin') then 'master'
      when p.role = 'vendor' then 'vendor'
      else 'manager'
    end)
  from public.admin_profiles p
  left join public.admin_roles r on r.key = p.access_role
  where p.id = auth.uid() and p.status = 'active'
$$;

create or replace function public.is_master()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select public.admin_level()) = 'master', false)
$$;

-- Whether the caller may see an organisation.
create or replace function public.admin_sees_org(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_profiles p
    left join public.admin_roles r on r.key = p.access_role
    where p.id = auth.uid()
      and p.status = 'active'
      and (
        coalesce(r.level, case when p.role in ('owner', 'admin') then 'master' end) = 'master'
        or p.all_orgs
        or (p.access_role is null and p.org_id is null and p.role in ('manager', 'checker'))
        or p_org = any (p.org_ids)
        or p_org = p.org_id
      )
  )
$$;

-- A master, or a role that can change at least one tab. Checkers, vendors
-- and view-only roles stay read-only in the database.
create or replace function public.is_staff_writer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_profiles p
    left join public.admin_roles r on r.key = p.access_role
    where p.id = auth.uid()
      and p.status = 'active'
      and case
        when r.key is not null then
          r.level = 'master'
          or exists (select 1 from jsonb_each_text(r.tabs) t where t.value = 'edit')
        else p.role in ('owner', 'admin', 'manager')
      end
  )
$$;

revoke execute on function public.admin_access_legacy_role(text, text) from public, anon;
grant execute on function public.admin_access_legacy_role(text, text) to authenticated, service_role;
revoke execute on function public.admin_access_for_legacy_role(text) from public, anon;
grant execute on function public.admin_access_for_legacy_role(text) to authenticated, service_role;
revoke execute on function public.admin_level() from public, anon;
revoke execute on function public.is_master() from public, anon;
revoke execute on function public.admin_sees_org(uuid) from public, anon;
grant execute on function public.admin_level() to authenticated, service_role;
grant execute on function public.is_master() to authenticated, service_role;
grant execute on function public.admin_sees_org(uuid) to authenticated, service_role;

-- ── Account guard ───────────────────────────────────────────────────────
-- Nobody changes their own role, status or organisations. Only the owner
-- manages the owner.
create or replace function public.admin_profiles_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  me_role text := (public.current_admin()).role;
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  new.id := old.id;
  new.created_at := old.created_at;
  new.invited_by := old.invited_by;
  if old.id = auth.uid() then
    new.role := old.role;
    new.status := old.status;
    new.org_id := old.org_id;
    new.email := old.email;
    new.location_ids := old.location_ids;
    new.is_packperks_staff := old.is_packperks_staff;
    new.access_role := old.access_role;
    new.org_ids := old.org_ids;
    new.all_orgs := old.all_orgs;
    return new;
  end if;
  if me_role is distinct from 'owner' and (old.role = 'owner' or new.role = 'owner') then
    raise exception 'only_an_owner_can_manage_owners' using errcode = '42501';
  end if;
  return new;
end
$$;

-- ── Policies ────────────────────────────────────────────────────────────
drop policy if exists "admin_roles: staff read" on public.admin_roles;
create policy "admin_roles: staff read" on public.admin_roles
  for select to authenticated
  using ((current_admin()).id is not null);

drop policy if exists "admin_roles: master insert" on public.admin_roles;
create policy "admin_roles: master insert" on public.admin_roles
  for insert to authenticated
  with check (is_master());

drop policy if exists "admin_roles: master update" on public.admin_roles;
create policy "admin_roles: master update" on public.admin_roles
  for update to authenticated
  using (is_master())
  with check (is_master());

drop policy if exists "admin_roles: master delete" on public.admin_roles;
create policy "admin_roles: master delete" on public.admin_roles
  for delete to authenticated
  using (is_master());

-- People.
drop policy if exists "profile: owner+admin update" on public.admin_profiles;
drop policy if exists "profile: master update" on public.admin_profiles;
create policy "profile: master update" on public.admin_profiles
  for update to authenticated
  using (is_master())
  with check (is_master());

drop policy if exists "inv: owner+admin read" on public.admin_invitations;
drop policy if exists "inv: master read" on public.admin_invitations;
create policy "inv: master read" on public.admin_invitations
  for select to authenticated
  using (is_master());

drop policy if exists "inv: owner+admin revoke" on public.admin_invitations;
drop policy if exists "inv: master update" on public.admin_invitations;
create policy "inv: master update" on public.admin_invitations
  for update to authenticated
  using (is_master())
  with check (is_master());

-- Audit log: masters read everything, managers the organisations they see,
-- everyone their own entries ("audit: self read", unchanged).
drop policy if exists "audit: owner+admin read" on public.admin_action_log;
drop policy if exists "audit: master and manager read" on public.admin_action_log;
create policy "audit: master and manager read" on public.admin_action_log
  for select to authenticated
  using (
    is_master()
    or (org_id is not null and admin_level() = 'manager' and admin_sees_org(org_id))
  );

drop policy if exists "audit: self insert" on public.admin_action_log;
create policy "audit: self insert" on public.admin_action_log
  for insert to authenticated
  with check (
    actor_id = auth.uid()
    and (current_admin()).id is not null
    and (org_id is null or admin_sees_org(org_id))
  );

-- Organisations and groups: masters only.
drop policy if exists "org: owner+admin write" on public.organizations;
drop policy if exists "organizations: staff insert" on public.organizations;
drop policy if exists "organizations: master insert" on public.organizations;
create policy "organizations: master insert" on public.organizations
  for insert to authenticated
  with check (is_master());

drop policy if exists "organizations: staff update" on public.organizations;
drop policy if exists "organizations: master update" on public.organizations;
create policy "organizations: master update" on public.organizations
  for update to authenticated
  using (is_master())
  with check (is_master());

drop policy if exists "org_groups: staff insert" on public.org_groups;
drop policy if exists "org_groups: master insert" on public.org_groups;
create policy "org_groups: master insert" on public.org_groups
  for insert to authenticated
  with check (is_master());

drop policy if exists "org_groups: staff update" on public.org_groups;
drop policy if exists "org_groups: master update" on public.org_groups;
create policy "org_groups: master update" on public.org_groups
  for update to authenticated
  using (is_master())
  with check (is_master());

drop policy if exists "org_groups: staff delete" on public.org_groups;
drop policy if exists "org_groups: master delete" on public.org_groups;
create policy "org_groups: master delete" on public.org_groups
  for delete to authenticated
  using (is_master());

-- Locations: writers, for the organisations they see.
drop policy if exists "loc: owner+admin write" on public.locations;

drop policy if exists "locations: staff insert" on public.locations;
create policy "locations: staff insert" on public.locations
  for insert to authenticated
  with check (is_staff_writer() and admin_sees_org(org_id));

drop policy if exists "locations: staff update" on public.locations;
create policy "locations: staff update" on public.locations
  for update to authenticated
  using (is_staff_writer() and admin_sees_org(org_id))
  with check (is_staff_writer() and admin_sees_org(org_id));

drop policy if exists "locations: staff delete" on public.locations;
create policy "locations: staff delete" on public.locations
  for delete to authenticated
  using (is_staff_writer() and admin_sees_org(org_id));

-- Workspace tab switches and the region list apply to every organisation,
-- so only masters change them.
drop policy if exists "app_config: master keys insert" on public.app_config;
create policy "app_config: master keys insert" on public.app_config
  as restrictive for insert to authenticated
  with check (not (key like 'workspace:%' or key = 'published:regions') or is_master());

drop policy if exists "app_config: master keys update" on public.app_config;
create policy "app_config: master keys update" on public.app_config
  as restrictive for update to authenticated
  using (not (key like 'workspace:%' or key = 'published:regions') or is_master())
  with check (not (key like 'workspace:%' or key = 'published:regions') or is_master());

drop policy if exists "app_config: master keys delete" on public.app_config;
create policy "app_config: master keys delete" on public.app_config
  as restrictive for delete to authenticated
  using (not (key like 'workspace:%' or key = 'published:regions') or is_master());

-- Trigger functions are never called directly.
revoke execute on function public.admin_roles_resync() from public, anon, authenticated;
revoke execute on function public.admin_roles_guard() from public, anon, authenticated;
revoke execute on function public.admin_profiles_sync_access() from public, anon, authenticated;
revoke execute on function public.admin_invitations_sync_access() from public, anon, authenticated;
