-- 057 — PackPulse connections.
--
-- A PackPulse organisation can show one PackPerks venue's Dashboard, System
-- health and Reports & alerts, read-only, inside PackPulse. The whole
-- feature is described in docs/packpulse/INTEGRATION.md.
--
-- How a connection is made
--   1. A master creates a one-time connection code for a venue
--      (packpulse_admin_create_code). Only its sha256 is stored, and it
--      expires after 48 hours.
--   2. PackPulse's server sends the code to the packpulse-link edge function
--      (action `claim`) with the PackPulse organisation it is for. The link
--      becomes `pending`; PackPulse receives its link secret once (stored
--      here as sha256) and a 4-character confirmation code.
--   3. A master approves the request (packpulse_admin_approve) after checking
--      that PackPulse shows the same confirmation code.
--   4. For every page view PackPulse asks packpulse-link for an embed URL.
--      It carries a one-time ticket (2 minutes) that the embed page
--      (/packpulse-embed) exchanges for a session of the link's own login.
--
-- What that login can read
--   Nothing through the ordinary tables: it has no admin_profiles row, so
--   current_admin() is null, and it owns no customer rows. It reads only the
--   packpulse_* views below. Each returns rows of the connected venue while
--   the link is active and a page that needs the view is switched on. The
--   views leave out customer emails, IBANs, device ids, payout links,
--   receipt photos and cup codes (cup and batch ids are hashed, so counts
--   and joins still line up).
--
-- The views are owned by postgres and read the tables as their owner, which
-- is why each one filters on packpulse_org_ids() itself. They are
-- select-only: every other privilege is revoked below.

create extension if not exists pgcrypto with schema extensions;

-- ── Tables (service role and the SECURITY DEFINER functions only) ────────

create table if not exists public.packpulse_links (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  status             text not null default 'awaiting'
                     check (status in ('awaiting', 'pending', 'active', 'paused', 'declined', 'revoked', 'cancelled')),
  code_hash          text unique,
  code_hint          text,
  code_expires_at    timestamptz,
  secret_hash        text unique,
  confirm_code       text,
  packpulse_org_id   text,
  packpulse_org_name text,
  packpulse_origin   text,
  requested_by_email text,
  requested_by_name  text,
  requested_at       timestamptz,
  pages              jsonb not null default '{"overview": true, "stats": true, "reports": true, "preview": true}'::jsonb,
  auth_user_id       uuid unique,
  created_by         uuid,
  created_at         timestamptz not null default now(),
  approved_by        uuid,
  approved_at        timestamptz,
  ended_by           text,
  ended_at           timestamptz,
  last_used_at       timestamptz,
  updated_at         timestamptz not null default now()
);

-- One live connection per PackPerks venue and PackPulse organisation.
create unique index if not exists packpulse_links_live_pair
  on public.packpulse_links (org_id, packpulse_org_id)
  where status in ('pending', 'active', 'paused');

create table if not exists public.packpulse_tickets (
  ticket_hash   text primary key,
  link_id       uuid not null references public.packpulse_links(id) on delete cascade,
  page          text not null,
  parent_origin text,
  viewer        text,
  expires_at    timestamptz not null,
  used_at       timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists packpulse_tickets_link on public.packpulse_tickets (link_id, created_at desc);

create table if not exists public.packpulse_link_events (
  id         bigint generated always as identity primary key,
  link_id    uuid not null references public.packpulse_links(id) on delete cascade,
  action     text not null,
  actor      text,
  detail     jsonb,
  created_at timestamptz not null default now()
);
create index if not exists packpulse_link_events_link on public.packpulse_link_events (link_id, created_at desc);

alter table public.packpulse_links       enable row level security;
alter table public.packpulse_tickets     enable row level security;
alter table public.packpulse_link_events enable row level security;
revoke all on public.packpulse_links, public.packpulse_tickets, public.packpulse_link_events from anon, authenticated;

-- ── What the signed-in connection login may read ─────────────────────────

-- The venues the caller's connection shows, for a page that needs them.
-- Empty for everyone who is not a connection login.
create or replace function public.packpulse_org_ids(p_pages text[])
returns uuid[]
language sql stable security definer
set search_path = public
as $$
  select coalesce(array_agg(l.org_id), '{}'::uuid[])
  from packpulse_links l
  where auth.uid() is not null
    and l.auth_user_id = auth.uid()
    and l.status = 'active'
    and exists (select 1 from unnest(p_pages) p where (l.pages ->> p)::boolean is true);
$$;
revoke all on function public.packpulse_org_ids(text[]) from public, anon;
grant execute on function public.packpulse_org_ids(text[]) to authenticated;

-- The connection behind the caller's session, for the embed page.
create or replace function public.packpulse_session()
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select jsonb_build_object('link_id', l.id, 'org_id', l.org_id, 'status', l.status, 'pages', l.pages)
  from packpulse_links l
  where auth.uid() is not null and l.auth_user_id = auth.uid()
  limit 1;
$$;
revoke all on function public.packpulse_session() from public, anon;
grant execute on function public.packpulse_session() to authenticated;

-- A cup or batch id is a code that claims cups. The views show a hash of
-- it instead: the same id always gives the same hash, so counts and joins
-- between the views still work.
create or replace function public.packpulse_hash(p text)
returns text
language sql immutable
set search_path = public, extensions
as $$ select case when p is null then null else encode(extensions.digest(p, 'sha256'), 'hex') end $$;

create or replace view public.packpulse_users with (security_barrier = true) as
  select u.id, u.org_id, u.identity_id, u.display_name, u.device, u.created_at, u.updated_at,
         null::text as email
  from public.users u
  where u.org_id in (select unnest(public.packpulse_org_ids(array['overview', 'reports'])));

create or replace view public.packpulse_cup_balances with (security_barrier = true) as
  select b.id, b.user_id, b.org_id, b.balance, b.lifetime_cups, b.updated_at
  from public.cup_balances b
  where b.org_id in (select unnest(public.packpulse_org_ids(array['overview', 'reports'])));

create or replace view public.packpulse_claims with (security_barrier = true) as
  select c.id, c.org_id, c.user_id, c.type, c.status, c.reward_id, c.cups_redeemed, c.payout_amount,
         c.created_at, c.paid_at, c.payout_status, c.payout_claim_id,
         public.packpulse_hash(c.batch_id::text) as batch_id,
         case when c.tikkie_url is null then null else 'hidden' end as tikkie_url,
         c.tikkie_status, c.tikkie_expires_at, c.tikkie_redeemed_at, c.tikkie_last_error,
         c.ai_confidence, c.ai_failure_checks, c.admin_failure_checks
  from public.claims c
  where c.org_id in (select unnest(public.packpulse_org_ids(array['overview', 'stats', 'reports'])));

create or replace view public.packpulse_cup_scans with (security_barrier = true) as
  select s.id, s.org_id, s.user_id, s.status, s.error_code, s.error_message, s.cups_awarded,
         s.scanned_at, s.scan_type, s.source, s.location_id,
         public.packpulse_hash(s.batch_id::text) as batch_id,
         case when s.requested_cup_ids is null then null
              else array(select public.packpulse_hash(x) from unnest(s.requested_cup_ids) x) end as requested_cup_ids,
         case when s.activated_cup_ids is null then null
              else array(select public.packpulse_hash(x) from unnest(s.activated_cup_ids) x) end as activated_cup_ids
  from public.cup_scans s
  where s.org_id in (select unnest(public.packpulse_org_ids(array['overview', 'stats', 'reports'])));

create or replace view public.packpulse_activity_history with (security_barrier = true) as
  select a.id, a.org_id, a.user_id, a.type, a.label, a.created_at
  from public.activity_history a
  where a.org_id in (select unnest(public.packpulse_org_ids(array['overview', 'reports'])));

create or replace view public.packpulse_cups with (security_barrier = true) as
  select public.packpulse_hash(c.id::text) as id, public.packpulse_hash(c.batch_id::text) as batch_id,
         c.org_id, c.source, c.status, c.created_at
  from public.cups c
  where c.org_id in (select unnest(public.packpulse_org_ids(array['stats'])));

create or replace view public.packpulse_system_events with (security_barrier = true) as
  select e.id, e.org_id, e.event_type, e.status, e.count, e.created_at
  from public.system_events e
  where e.org_id in (select unnest(public.packpulse_org_ids(array['stats'])));

create or replace view public.packpulse_client_events with (security_barrier = true) as
  select e.id, e.org_id, e.session_id, e.user_id, e.event, e.created_at,
         case when e.props ? 'scan_id' then jsonb_build_object('scan_id', e.props -> 'scan_id') else '{}'::jsonb end as props
  from public.client_events e
  where e.org_id in (select unnest(public.packpulse_org_ids(array['stats'])));

create or replace view public.packpulse_pending_batches with (security_barrier = true) as
  select public.packpulse_hash(p.batch_id::text) as batch_id, p.org_id, p.user_id, p.first_seen, p.resolved_at
  from public.pending_batches p
  where p.org_id in (select unnest(public.packpulse_org_ids(array['stats'])));

create or replace view public.packpulse_backup_cup_uses with (security_barrier = true) as
  select b.id, b.org_id, b.claim_id, b.cups_in_scan, b.used_at
  from public.backup_cup_uses b
  where b.org_id in (select unnest(public.packpulse_org_ids(array['stats'])));

create or replace view public.packpulse_bin_sessions with (security_barrier = true) as
  select s.id, s.org_id, s.cups, s.created_at
  from public.bin_sessions s
  where s.org_id in (select unnest(public.packpulse_org_ids(array['stats'])));

revoke all on
  public.packpulse_users, public.packpulse_cup_balances, public.packpulse_claims, public.packpulse_cup_scans,
  public.packpulse_activity_history, public.packpulse_cups, public.packpulse_system_events,
  public.packpulse_client_events, public.packpulse_pending_batches, public.packpulse_backup_cup_uses,
  public.packpulse_bin_sessions
from public, anon, authenticated;
grant select on
  public.packpulse_users, public.packpulse_cup_balances, public.packpulse_claims, public.packpulse_cup_scans,
  public.packpulse_activity_history, public.packpulse_cups, public.packpulse_system_events,
  public.packpulse_client_events, public.packpulse_pending_batches, public.packpulse_backup_cup_uses,
  public.packpulse_bin_sessions
to authenticated;

-- ── Master Settings → PackPulse ──────────────────────────────────────────

create or replace function public.packpulse_actor()
returns text
language sql stable security definer
set search_path = public
as $$ select coalesce((select email from admin_profiles where id = auth.uid()), 'unknown') $$;
revoke all on function public.packpulse_actor() from public, anon, authenticated;

-- Every connection, newest first, with what the panel shows. No hashes.
create or replace function public.packpulse_admin_links()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not is_master() then raise exception 'masters_only' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(row_to_json(x)::jsonb order by x.created_at desc)
    from (
      select l.id, l.org_id, o.name as org_name, o.slug as org_slug, o.logo_url as org_logo,
             o.brand_color as org_color, o.country as org_country,
             case when l.status = 'awaiting' and l.code_expires_at < now() then 'expired' else l.status end as status,
             l.code_hint, l.code_expires_at, l.confirm_code,
             l.packpulse_org_id, l.packpulse_org_name, l.packpulse_origin,
             l.requested_by_email, l.requested_by_name, l.requested_at,
             l.pages, l.created_at, l.approved_at, l.ended_at, l.ended_by, l.last_used_at,
             (select coalesce(p.display_name, p.email) from admin_profiles p where p.id = l.created_by) as created_by_name,
             (select coalesce(p.display_name, p.email) from admin_profiles p where p.id = l.approved_by) as approved_by_name,
             (select count(*) from packpulse_link_events e
               where e.link_id = l.id and e.action = 'view' and e.created_at > now() - interval '7 days') as views_7d,
             (select coalesce(jsonb_agg(ev order by ev.created_at desc), '[]'::jsonb) from (
                select e.action, e.actor, e.detail, e.created_at from packpulse_link_events e
                where e.link_id = l.id order by e.created_at desc limit 12) ev) as events
      from packpulse_links l
      join organizations o on o.id = l.org_id
      where l.status <> 'cancelled'
        and not (l.status = 'awaiting' and l.code_expires_at < now() - interval '7 days')
        and not (l.status in ('declined', 'revoked') and l.ended_at < now() - interval '90 days')
    ) x
  ), '[]'::jsonb);
end $$;

-- A one-time connection code for a venue. Returned once, never stored.
create or replace function public.packpulse_admin_create_code(p_org uuid)
returns jsonb
language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare
  v_alpha constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_bytes bytea := extensions.gen_random_bytes(20);
  v_raw   text := '';
  v_id    uuid;
  v_exp   timestamptz := now() + interval '48 hours';
begin
  if not is_master() then raise exception 'masters_only' using errcode = '42501'; end if;
  if not exists (select 1 from organizations where id = p_org and deleted_at is null) then
    raise exception 'org_not_found' using errcode = 'P0002';
  end if;
  for i in 0..19 loop
    v_raw := v_raw || substr(v_alpha, (get_byte(v_bytes, i) % length(v_alpha)) + 1, 1);
  end loop;
  insert into packpulse_links (org_id, status, code_hash, code_hint, code_expires_at, created_by)
  values (p_org, 'awaiting', encode(extensions.digest(v_raw, 'sha256'), 'hex'), right(v_raw, 4), v_exp, auth.uid())
  returning id into v_id;
  insert into packpulse_link_events (link_id, action, actor) values (v_id, 'code_created', packpulse_actor());
  return jsonb_build_object(
    'id', v_id,
    'code', 'PPK-' || substr(v_raw, 1, 5) || '-' || substr(v_raw, 6, 5) || '-' || substr(v_raw, 11, 5) || '-' || substr(v_raw, 16, 5),
    'expires_at', v_exp);
end $$;

-- Every other change a master makes: cancel a code, approve or decline a
-- request, pause or resume, the shared pages, disconnect.
create or replace function public.packpulse_admin_update(p_link uuid, p_action text, p_pages jsonb default null)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $$
declare
  l       packpulse_links%rowtype;
  v_pages jsonb;
  v_from  text;
  v_next  text;
begin
  if not is_master() then raise exception 'masters_only' using errcode = '42501'; end if;
  select * into l from packpulse_links where id = p_link for update;
  if not found then raise exception 'link_not_found' using errcode = 'P0002'; end if;

  if p_action = 'cancel' then
    if l.status <> 'awaiting' then raise exception 'not_awaiting'; end if;
    update packpulse_links set status = 'cancelled', code_hash = null, ended_by = 'packperks', ended_at = now(), updated_at = now() where id = l.id;
  elsif p_action = 'approve' then
    if l.status <> 'pending' then raise exception 'not_pending'; end if;
    update packpulse_links set status = 'active', approved_by = auth.uid(), approved_at = now(), updated_at = now() where id = l.id;
  elsif p_action = 'decline' then
    if l.status <> 'pending' then raise exception 'not_pending'; end if;
    update packpulse_links set status = 'declined', secret_hash = null, ended_by = 'packperks', ended_at = now(), updated_at = now() where id = l.id;
  elsif p_action in ('pause', 'resume') then
    v_from := case p_action when 'pause' then 'active' else 'paused' end;
    v_next := case p_action when 'pause' then 'paused' else 'active' end;
    if l.status <> v_from then raise exception 'wrong_status'; end if;
    update packpulse_links set status = v_next, updated_at = now() where id = l.id;
  elsif p_action = 'pages' then
    if p_pages is null or jsonb_typeof(p_pages) <> 'object' then raise exception 'bad_pages'; end if;
    select jsonb_object_agg(k, coalesce((p_pages ->> k)::boolean, (l.pages ->> k)::boolean, false))
      into v_pages from unnest(array['overview', 'stats', 'reports', 'preview']) k;
    update packpulse_links set pages = v_pages, updated_at = now() where id = l.id;
  elsif p_action = 'disconnect' then
    if l.status not in ('pending', 'active', 'paused') then raise exception 'not_connected'; end if;
    update packpulse_links
       set status = 'revoked', secret_hash = null, auth_user_id = null,
           ended_by = 'packperks', ended_at = now(), updated_at = now()
     where id = l.id;
    -- The connection's own login goes with it (sessions and all).
    if l.auth_user_id is not null then delete from auth.users where id = l.auth_user_id; end if;
    delete from packpulse_tickets where link_id = l.id;
  else
    raise exception 'unknown_action';
  end if;

  insert into packpulse_link_events (link_id, action, actor, detail)
  values (l.id, case p_action when 'cancel' then 'code_cancelled' when 'approve' then 'approved' when 'decline' then 'declined'
                              when 'pause' then 'paused' when 'resume' then 'resumed' when 'pages' then 'pages_changed'
                              else 'disconnected' end,
          packpulse_actor(), case when p_action = 'pages' then jsonb_build_object('pages', v_pages) end);
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.packpulse_admin_links() from public, anon;
revoke all on function public.packpulse_admin_create_code(uuid) from public, anon;
revoke all on function public.packpulse_admin_update(uuid, text, jsonb) from public, anon;
grant execute on function public.packpulse_admin_links() to authenticated;
grant execute on function public.packpulse_admin_create_code(uuid) to authenticated;
grant execute on function public.packpulse_admin_update(uuid, text, jsonb) to authenticated;
