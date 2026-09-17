-- 050 — PackPerks Staff: venue staff make cup QR codes on their phone.
--
-- A separate web app at /staff. Staff sign in with email and password; a
-- 6-digit emailed code is needed only to sign up, reset the password or
-- change the email. Only emails a master added in Master Settings → Staff
-- app can sign up. The app is switched on per organisation
-- (`organizations.staff_app_enabled`), for NYU Abu Dhabi only to begin with.
--
-- A staff QR code is a normal cup batch: `cups` rows with one batch_id,
-- claimed by the customer app through claim-cups. `staff_qr_codes` records
-- who made each batch, for how many cups and of which package type.
--
-- Everything the app does goes through the `staff-app` edge function (service
-- role). Clients get no policies on these tables except masters, who manage
-- staff from the dashboard.

-- ── The switch ──────────────────────────────────────────────────────────
alter table public.organizations
  add column if not exists staff_app_enabled boolean not null default false;

update public.organizations set staff_app_enabled = true
 where slug = 'nyuad' and deleted_at is null;

-- ── Staff accounts ──────────────────────────────────────────────────────
create table if not exists public.staff_members (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  email         text not null,
  name          text,
  avatar_url    text,
  auth_user_id  uuid unique references auth.users(id) on delete set null,
  status        text not null default 'invited'
                check (status in ('invited', 'active', 'blocked')),
  invited_by    uuid,
  created_at    timestamptz not null default now(),
  activated_at  timestamptz,
  last_seen_at  timestamptz,
  updated_at    timestamptz not null default now(),
  constraint staff_members_email_lower check (email = lower(btrim(email)) and email <> '')
);
-- One staff account per email address.
create unique index if not exists staff_members_email_key on public.staff_members (email);
create index if not exists staff_members_org_idx on public.staff_members (org_id);

alter table public.staff_members enable row level security;

drop policy if exists "staff_members: masters read" on public.staff_members;
create policy "staff_members: masters read" on public.staff_members
  for select to authenticated using (public.is_master());
drop policy if exists "staff_members: masters insert" on public.staff_members;
create policy "staff_members: masters insert" on public.staff_members
  for insert to authenticated with check (public.is_master());
drop policy if exists "staff_members: masters update" on public.staff_members;
create policy "staff_members: masters update" on public.staff_members
  for update to authenticated using (public.is_master()) with check (public.is_master());
drop policy if exists "staff_members: masters delete" on public.staff_members;
create policy "staff_members: masters delete" on public.staff_members
  for delete to authenticated using (public.is_master());

-- ── What staff made ─────────────────────────────────────────────────────
create table if not exists public.staff_qr_codes (
  batch_id      uuid primary key,
  org_id        uuid not null references public.organizations(id) on delete cascade,
  staff_id      uuid references public.staff_members(id) on delete set null,
  cups          integer not null check (cups between 1 and 50),
  package_type  text not null default 'cup' check (package_type in ('cup')),
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  cancelled_at  timestamptz
);
create index if not exists staff_qr_codes_staff_idx on public.staff_qr_codes (staff_id, created_at desc);
create index if not exists staff_qr_codes_org_idx on public.staff_qr_codes (org_id, created_at desc);

alter table public.staff_qr_codes enable row level security;

drop policy if exists "staff_qr_codes: masters read" on public.staff_qr_codes;
create policy "staff_qr_codes: masters read" on public.staff_qr_codes
  for select to authenticated using (public.is_master());

-- ── Emailed codes (sign up, password reset, email change) ───────────────
-- Hashed, 10 minutes, 5 attempts. Service role only: no policies.
create table if not exists public.staff_email_codes (
  id          uuid primary key default gen_random_uuid(),
  purpose     text not null check (purpose in ('signup', 'reset', 'email_change')),
  email       text not null,
  staff_id    uuid references public.staff_members(id) on delete cascade,
  code_hash   text not null,
  attempts    integer not null default 0,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
create index if not exists staff_email_codes_lookup on public.staff_email_codes (purpose, email);

alter table public.staff_email_codes enable row level security;

-- ── The login behind an email (the edge function needs it to link an
--    existing login, e.g. someone who is also a customer) ──────────────
create or replace function public.staff_auth_user_id(p_email text)
returns uuid
language sql
stable
security definer
set search_path to 'public', 'auth'
as $$
  select u.id from auth.users u
   where lower(u.email) = lower(btrim(p_email))
   order by u.created_at
   limit 1
$$;

revoke all on function public.staff_auth_user_id(text) from public, anon, authenticated;
grant execute on function public.staff_auth_user_id(text) to service_role;

-- Is the caller an active staff member? (Row level security hides
-- staff_members from staff themselves, so storage rules ask this instead.)
create or replace function public.is_active_staff()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.staff_members s
     where s.auth_user_id = auth.uid() and s.status = 'active'
  )
$$;

revoke all on function public.is_active_staff() from public, anon;
grant execute on function public.is_active_staff() to authenticated, service_role;

-- ── Profile pictures ────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('staff-avatars', 'staff-avatars', true, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "staff-avatars: public read" on storage.objects;
create policy "staff-avatars: public read" on storage.objects
  for select to anon, authenticated using (bucket_id = 'staff-avatars');

drop policy if exists "staff-avatars: own folder write" on storage.objects;
create policy "staff-avatars: own folder write" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'staff-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_active_staff()
  );

drop policy if exists "staff-avatars: own folder delete" on storage.objects;
create policy "staff-avatars: own folder delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'staff-avatars' and (storage.foldername(name))[1] = auth.uid()::text);
