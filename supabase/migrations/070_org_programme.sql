-- ─────────────────────────────────────────────────────────────────────
-- 070 — a venue's programme: Deposit or BYO.
--
-- A venue runs one of two programmes, chosen when it is created
-- (onboarding), with its ways in and out inside it (src/admin/lib/
-- flowModes.js):
--   deposit  a deposit on the cup: SmartBin ways in, the Staff App and the
--            Static QR tent; every way out, Deferred Refund and Direct
--            Refund included.
--   byo      customers bring their own cup: only the BYO ways in (Staff
--            App, Static QR tent); no Deferred Refund or Direct Refund,
--            because there is no deposit to refund.
--
-- It lives on the venue row, not in the published settings: publishing
-- sends the whole settings object from a draft, and a stale draft would
-- wipe a flag set anywhere else.
--
-- A BYO venue never becomes a Deposit venue. The trigger below refuses it
-- for every caller, the dashboard and SQL alike.
--
-- Backfill: a venue in a group whose published config runs BYO (a group
-- with no mode set is BYO, the same default as normalizeMode) is BYO,
-- unless it runs the wallet (tikkie_only), which only exists on deposit.
-- ─────────────────────────────────────────────────────────────────────

alter table public.organizations
  add column if not exists programme text not null default 'deposit';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'organizations_programme_check'
  ) then
    alter table public.organizations
      add constraint organizations_programme_check check (programme in ('deposit', 'byo'));
  end if;
end $$;

update public.organizations o
   set programme = 'byo'
 where o.group_id is not null
   and coalesce(
         (select c.value->'settings'->>'mode' from public.app_config c
           where c.key = 'published:group:' || o.group_id),
         'byo') = 'byo'
   and coalesce(
         (select c.value->'settings'->>'mode' from public.app_config c
           where c.key = 'published:' || o.id),
         '') <> 'tikkie_only';

create or replace function public.organizations_programme_guard()
returns trigger
language plpgsql
as $$
begin
  if old.programme = 'byo' and new.programme is distinct from 'byo' then
    raise exception 'programme_locked'
      using hint = 'A BYO venue can''t become a Deposit venue.';
  end if;
  return new;
end;
$$;

drop trigger if exists organizations_programme_guard on public.organizations;
create trigger organizations_programme_guard
  before update of programme on public.organizations
  for each row execute function public.organizations_programme_guard();

comment on column public.organizations.programme is
  'deposit | byo. Chosen at onboarding. A BYO venue can''t become deposit (organizations_programme_guard).';
