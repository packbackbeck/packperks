-- ─────────────────────────────────────────────────────────────────────
-- 061 — UX capture: the tables behind User analytics → User flow.
--
-- What a customer does inside a screen — where they tap, how far they
-- scroll, which screen they leave from — has never been recorded. The
-- User flow tab needs three things and nothing more:
--
--   • ux_sessions — one row per visit. This is the analytics spine: every
--     tile and its day-by-day line is computed from these rows alone, the
--     way the rest of the dashboard computes from raw rows, without ever
--     pulling a tap.
--   • ux_events   — the taps, scrolls and screen views themselves. Big,
--     so the dashboard never selects it raw except to replay one visit;
--     the heatmap, the button table and the flow all come back from the
--     aggregate functions below, already summed.
--   • ux_layouts  — where the buttons were on a screen, normalised. The
--     heatmap draws this as a wireframe and lays the heat over it, so a
--     hotspot can be read without a screenshot of the customer's phone.
--
-- CONSENT. Nothing here is written unless the customer turned the
-- Analytical cookie category on (src/lib/consent.js). No text the
-- customer typed, no element contents, no pointer trail outside the app,
-- no IP: a tap is a position and the name of the button under it.
--
-- WRITES. Only the ux-ingest edge function (service role) writes. There
-- is deliberately no anon insert policy — client_events' open one is the
-- mistake this table is not repeating (see CLAUDE.md → Landmines).
-- ─────────────────────────────────────────────────────────────────────

-- ── ux_sessions ────────────────────────────────────────────────────
create table if not exists public.ux_sessions (
  session_id   text primary key,
  org_id       uuid references public.organizations(id) on delete cascade,
  user_id      uuid,
  mode         text,                        -- the app the visit ran: standard | byo | tikkie_only
  device       text,                        -- mobile | tablet | desktop
  entry        text,                        -- how the visit arrived (same classes as App opens)
  started_at   timestamptz not null default now(),
  last_at      timestamptz not null default now(),
  duration_ms  integer not null default 0,
  screens      integer not null default 0,  -- screen views in the visit
  screen_list  text[]  not null default '{}',
  clicks       integer not null default 0,
  rage         integer not null default 0,  -- taps repeated on one spot in frustration
  dead         integer not null default 0,  -- taps on something that does nothing
  max_scroll   real,                        -- deepest scroll of the visit, 0..1
  first_tap_ms integer,                     -- from the first screen view to the first tap
  last_screen  text,
  replay       boolean not null default false,
  events       integer not null default 0,  -- rows kept, so one visit can't flood the table
  created_at   timestamptz not null default now()
);
create index if not exists idx_ux_sessions_org_started on public.ux_sessions(org_id, started_at desc);
create index if not exists idx_ux_sessions_org_user on public.ux_sessions(org_id, user_id);

-- ── ux_events ──────────────────────────────────────────────────────
create table if not exists public.ux_events (
  id         bigint generated always as identity primary key,
  org_id     uuid references public.organizations(id) on delete cascade,
  session_id text not null,
  user_id    uuid,
  seq        integer not null,              -- order within the visit
  kind       text not null,                 -- view | click | rage | dead | scroll | leave | move
  screen     text not null,
  target     text,                          -- stable key for the thing tapped
  label      text,                          -- what a person calls it
  x          real,                          -- 0..1 across the viewport
  y          real,                          -- 0..1 down the whole page
  yv         real,                          -- 0..1 down the viewport
  vw         smallint,
  vh         smallint,
  dh         integer,
  depth      real,                          -- scroll: how far down the page, 0..1
  t_ms       integer,                       -- since the screen view it belongs to
  at         timestamptz not null default now()
);
create index if not exists idx_ux_events_org_at on public.ux_events(org_id, at desc);
create index if not exists idx_ux_events_heat on public.ux_events(org_id, screen, kind, at desc);
create index if not exists idx_ux_events_replay on public.ux_events(session_id, seq);
create index if not exists idx_ux_events_target on public.ux_events(org_id, target, at desc) where target is not null;

-- ── ux_layouts ─────────────────────────────────────────────────────
create table if not exists public.ux_layouts (
  org_id     uuid not null references public.organizations(id) on delete cascade,
  screen     text not null,
  device     text not null,
  elements   jsonb not null default '[]'::jsonb,  -- [{k,l,x,y,w,h}] normalised to the page
  vw         smallint,
  vh         smallint,
  dh         integer,
  seen       integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key (org_id, screen, device)
);

-- ── Row security ───────────────────────────────────────────────────
alter table public.ux_sessions enable row level security;
alter table public.ux_events   enable row level security;
alter table public.ux_layouts  enable row level security;

-- Dashboard accounts read; nobody with the public key reads or writes.
-- (Org scoping is applied by the dashboard, as everywhere else — see
-- CLAUDE.md → "Org isolation is not enforced in the database".)
do $$
declare t text;
begin
  foreach t in array array['ux_sessions','ux_events','ux_layouts'] loop
    execute format('drop policy if exists "%s: dashboard read" on public.%I', t, t);
    execute format(
      'create policy "%s: dashboard read" on public.%I for select to authenticated using ((public.current_admin()).id is not null)',
      t, t);
  end loop;
end $$;

-- ── Aggregates the dashboard reads ─────────────────────────────────
-- Every one is SECURITY DEFINER so it can sum a table the caller may only
-- select from, and every one refuses a caller without a dashboard profile.

create or replace function public.ux_guard() returns void
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if (public.current_admin()).id is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
end $$;

-- Screens, busiest first: what the screen picker and the flow are built on.
create or replace function public.ux_screen_summary(
  p_orgs uuid[], p_from timestamptz default null, p_to timestamptz default null, p_device text default null
) returns table (
  screen text, views bigint, sessions bigint, clicks bigint, rage bigint, dead bigint,
  exits bigint, avg_dwell_ms double precision, avg_scroll double precision
)
language sql stable security definer set search_path to 'public' as $$
  with guard as (select public.ux_guard()),
  ev as (
    select e.* from public.ux_events e, guard
     where (p_orgs is null or e.org_id = any(p_orgs))
       and (p_from is null or e.at >= p_from)
       and (p_to   is null or e.at <  p_to)
       and (p_device is null or exists (
             select 1 from public.ux_sessions s
              where s.session_id = e.session_id and s.device = p_device))
  ),
  dwell as (
    -- Time on a screen: from the screen view until the next one, or until
    -- the visit ends. Not the gap between any two events.
    select q.screen, q.ms from (
      select e.kind, e.screen,
             extract(epoch from (lead(e.at) over (partition by e.session_id order by e.seq) - e.at)) * 1000 as ms
        from ev e
       where e.kind in ('view','leave')
    ) q
    where q.kind = 'view' and q.ms > 0 and q.ms < 1800000
  ),
  per_screen as (
    select d.screen, avg(d.ms) as avg_ms from dwell d group by d.screen
  )
  select v.screen,
         count(*) filter (where v.kind = 'view')                          as views,
         count(distinct v.session_id)                                     as sessions,
         count(*) filter (where v.kind in ('click','rage','dead'))        as clicks,
         count(*) filter (where v.kind = 'rage')                          as rage,
         count(*) filter (where v.kind = 'dead')                          as dead,
         count(*) filter (where v.kind = 'leave')                         as exits,
         max(p.avg_ms)                                                    as avg_dwell_ms,
         avg(v.depth) filter (where v.kind = 'scroll')                    as avg_scroll
    from ev v
    left join per_screen p on p.screen = v.screen
   group by v.screen
   order by views desc, sessions desc;
$$;

-- The heat itself: taps summed into a grid, so a busy screen comes back as
-- a few hundred cells instead of tens of thousands of points.
create or replace function public.ux_heatmap(
  p_orgs uuid[], p_screen text, p_from timestamptz default null, p_to timestamptz default null,
  p_device text default null, p_cols integer default 36, p_rows integer default 64
) returns table (cx integer, cy integer, n bigint, sessions bigint)
language sql stable security definer set search_path to 'public' as $$
  with guard as (select public.ux_guard()),
  cols as (select greatest(4, least(80, coalesce(p_cols, 36))) as c,
                  greatest(4, least(160, coalesce(p_rows, 64))) as r)
  select least(cols.c - 1, floor(e.x * cols.c))::int as cx,
         least(cols.r - 1, floor(e.y * cols.r))::int as cy,
         count(*) as n,
         count(distinct e.session_id) as sessions
    from public.ux_events e, guard, cols
   where e.kind in ('click','rage','dead')
     and e.screen = p_screen
     and e.x is not null and e.y is not null
     and (p_orgs is null or e.org_id = any(p_orgs))
     and (p_from is null or e.at >= p_from)
     and (p_to   is null or e.at <  p_to)
     and (p_device is null or exists (
           select 1 from public.ux_sessions s
            where s.session_id = e.session_id and s.device = p_device))
   group by 1, 2;
$$;

-- How far down a screen people actually get: the share of views that
-- reached each twentieth of the page.
create or replace function public.ux_scroll_curve(
  p_orgs uuid[], p_screen text, p_from timestamptz default null, p_to timestamptz default null,
  p_device text default null, p_steps integer default 20
) returns table (step integer, reached bigint, total bigint)
language sql stable security definer set search_path to 'public' as $$
  with guard as (select public.ux_guard()),
  steps as (select greatest(4, least(50, coalesce(p_steps, 20))) as k),
  deep as (
    select e.session_id, max(coalesce(e.depth, 0)) as d
      from public.ux_events e, guard
     where e.screen = p_screen
       and e.kind in ('scroll','view')
       and (p_orgs is null or e.org_id = any(p_orgs))
       and (p_from is null or e.at >= p_from)
       and (p_to   is null or e.at <  p_to)
       and (p_device is null or exists (
             select 1 from public.ux_sessions s
              where s.session_id = e.session_id and s.device = p_device))
     group by e.session_id
  )
  select g.i as step,
         count(*) filter (where deep.d >= g.i::numeric / steps.k) as reached,
         count(*) as total
    from steps, generate_series(1, (select k from steps)) as g(i), deep
   group by g.i
   order by g.i;
$$;

-- Every tracked control, with how long people take to reach it.
create or replace function public.ux_targets(
  p_orgs uuid[], p_from timestamptz default null, p_to timestamptz default null,
  p_screen text default null, p_device text default null
) returns table (
  target text, label text, screen text, taps bigint, sessions bigint, rage bigint, dead bigint,
  first_taps bigint, median_ms double precision, p90_ms double precision,
  avg_x double precision, avg_y double precision
)
language sql stable security definer set search_path to 'public' as $$
  with guard as (select public.ux_guard()),
  ev as (
    select e.*,
           row_number() over (partition by e.session_id order by e.seq) as rn_in_session
      from public.ux_events e, guard
     where e.kind in ('click','rage','dead')
       and e.target is not null
       and (p_orgs is null or e.org_id = any(p_orgs))
       and (p_screen is null or e.screen = p_screen)
       and (p_from is null or e.at >= p_from)
       and (p_to   is null or e.at <  p_to)
       and (p_device is null or exists (
             select 1 from public.ux_sessions s
              where s.session_id = e.session_id and s.device = p_device))
  )
  select ev.target,
         mode() within group (order by ev.label)  as label,
         mode() within group (order by ev.screen) as screen,
         count(*)                                       as taps,
         count(distinct ev.session_id)                  as sessions,
         count(*) filter (where ev.kind = 'rage')       as rage,
         count(*) filter (where ev.kind = 'dead')       as dead,
         count(*) filter (where ev.rn_in_session = 1)   as first_taps,
         percentile_cont(0.5) within group (order by ev.t_ms) filter (where ev.t_ms is not null and ev.t_ms >= 0) as median_ms,
         percentile_cont(0.9) within group (order by ev.t_ms) filter (where ev.t_ms is not null and ev.t_ms >= 0) as p90_ms,
         avg(ev.x), avg(ev.y)
    from ev
   group by ev.target
   order by taps desc;
$$;

-- One control, day by day — the graph behind a button's row.
create or replace function public.ux_target_series(
  p_orgs uuid[], p_target text, p_from timestamptz default null, p_to timestamptz default null,
  p_device text default null
) returns table (day date, taps bigint, sessions bigint, median_ms double precision)
language sql stable security definer set search_path to 'public' as $$
  with guard as (select public.ux_guard())
  select (e.at at time zone 'UTC')::date as day,
         count(*) as taps,
         count(distinct e.session_id) as sessions,
         percentile_cont(0.5) within group (order by e.t_ms) filter (where e.t_ms is not null and e.t_ms >= 0) as median_ms
    from public.ux_events e, guard
   where e.kind in ('click','rage','dead')
     and e.target = p_target
     and (p_orgs is null or e.org_id = any(p_orgs))
     and (p_from is null or e.at >= p_from)
     and (p_to   is null or e.at <  p_to)
     and (p_device is null or exists (
           select 1 from public.ux_sessions s
            where s.session_id = e.session_id and s.device = p_device))
   group by 1
   order by 1;
$$;

-- Screen to screen: what customers open next, and where they stop.
create or replace function public.ux_flow(
  p_orgs uuid[], p_from timestamptz default null, p_to timestamptz default null, p_device text default null
) returns table (from_screen text, to_screen text, n bigint)
language sql stable security definer set search_path to 'public' as $$
  with guard as (select public.ux_guard()),
  views as (
    select e.session_id, e.screen, e.seq,
           lag(e.screen) over (partition by e.session_id order by e.seq) as prev
      from public.ux_events e, guard
     where e.kind = 'view'
       and (p_orgs is null or e.org_id = any(p_orgs))
       and (p_from is null or e.at >= p_from)
       and (p_to   is null or e.at <  p_to)
       and (p_device is null or exists (
             select 1 from public.ux_sessions s
              where s.session_id = e.session_id and s.device = p_device))
  )
  select coalesce(prev, '(entry)') as from_screen, screen as to_screen, count(*) as n
    from views
   where prev is distinct from screen
   group by 1, 2
   order by n desc;
$$;

revoke all on function public.ux_guard() from public;
grant execute on function public.ux_screen_summary(uuid[], timestamptz, timestamptz, text) to authenticated;
grant execute on function public.ux_heatmap(uuid[], text, timestamptz, timestamptz, text, integer, integer) to authenticated;
grant execute on function public.ux_scroll_curve(uuid[], text, timestamptz, timestamptz, text, integer) to authenticated;
grant execute on function public.ux_targets(uuid[], timestamptz, timestamptz, text, text) to authenticated;
grant execute on function public.ux_target_series(uuid[], text, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.ux_flow(uuid[], timestamptz, timestamptz, text) to authenticated;

-- ── Erasing a customer takes their taps with it ────────────────────
-- erase_customer_rows() is the one delete path (CLAUDE.md → Landmines).
-- A visit that belonged to a deleted customer keeps no user_id; the row
-- itself goes, because a replay of one person's visit is personal data.
create or replace function public.ux_erase_user(p_user_ids uuid[])
returns void language sql security definer set search_path to 'public' as $$
  with s as (
    delete from public.ux_sessions where user_id = any(p_user_ids) returning session_id
  ), e as (
    delete from public.ux_events where user_id = any(p_user_ids) returning 1
  )
  select null::void;
$$;
revoke all on function public.ux_erase_user(uuid[]) from public;

-- ── Retention ──────────────────────────────────────────────────────
-- Tap-level data is the shortest-lived thing we hold. A venue can shorten
-- it further from User flow → Capture settings (`retentionDays`).
create or replace function public.ux_run_retention(p_default_days integer default 60)
returns integer language plpgsql security definer set search_path to 'public' as $$
declare
  o record;
  cutoff timestamptz;
  days integer;
  n integer := 0;
  total integer := 0;
begin
  for o in select id from public.organizations loop
    select greatest(1, least(400, coalesce((value->>'retentionDays')::int, p_default_days)))
      into days
      from public.app_config where key = 'ux:capture:' || o.id;
    days := coalesce(days, p_default_days);
    cutoff := now() - make_interval(days => days);
    delete from public.ux_events where org_id = o.id and at < cutoff;
    get diagnostics n = row_count; total := total + n;
    delete from public.ux_sessions where org_id = o.id and last_at < cutoff;
    get diagnostics n = row_count; total := total + n;
  end loop;
  -- Orphans: a visit whose org was removed, and layouts nobody has seen.
  delete from public.ux_events where org_id is null and at < now() - make_interval(days => p_default_days);
  delete from public.ux_layouts where updated_at < now() - interval '400 days';
  return total;
end $$;
revoke all on function public.ux_run_retention(integer) from public;

-- The nightly retention job already runs; give it the new tables.
create or replace function public.run_data_retention()
returns void language plpgsql security definer set search_path to 'public', 'storage' as $function$
begin
  -- Receipt images: 90 days after the claim is resolved.
  begin
    delete from storage.objects o using public.claims c
     where o.bucket_id = 'receipts' and o.name = c.receipt_photo_path
       and c.status in ('completed','failed') and c.verified_at < now() - interval '90 days';
  exception when others then raise notice 'retention receipts: %', sqlerrm; end;
  -- Cup-scan images: 90 days after upload.
  begin
    delete from storage.objects where bucket_id = 'cup-scans' and created_at < now() - interval '90 days';
  exception when others then raise notice 'retention cup-scans: %', sqlerrm; end;
  -- Behavioural analytics: 14 months.
  begin
    delete from public.client_events where created_at < now() - interval '14 months';
  exception when others then raise notice 'retention client_events: %', sqlerrm; end;
  -- Taps, scrolls and visits: 60 days, or whatever the venue shortened it to.
  begin
    perform public.ux_run_retention(60);
  exception when others then raise notice 'retention ux: %', sqlerrm; end;
  -- Admin action + login logs: 12 months.
  begin
    delete from public.admin_action_log where created_at < now() - interval '12 months';
  exception when others then raise notice 'retention admin_action_log: %', sqlerrm; end;
  begin
    delete from public.admin_login_history where logged_in_at < now() - interval '12 months';
  exception when others then raise notice 'retention admin_login_history: %', sqlerrm; end;
end $function$;

-- Deleting a customer deletes their visits too.
create or replace function public.erase_customer_rows(p_user_ids uuid[], p_ident_ids uuid[])
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  receipts text[];
  scans    text[];
  devices  text[];
  logins   uuid[];
  n_claims integer := 0;
  n_rows   integer := 0;
  n_idents integer := 0;
begin
  p_user_ids  := coalesce(p_user_ids, '{}');
  p_ident_ids := coalesce(p_ident_ids, '{}');
  select coalesce(array_agg(c.receipt_photo_path), '{}') into receipts
    from claims c where c.user_id = any(p_user_ids) and c.receipt_photo_path is not null;
  select coalesce(array_agg(s.photo_path), '{}') into scans
    from cup_scans s where s.user_id = any(p_user_ids) and s.photo_path is not null;
  select coalesce(array_agg(distinct u.device_id), '{}') into devices
    from users u where u.id = any(p_user_ids) and u.device_id is not null;
  select coalesce(array_agg(distinct a), '{}') into logins from (
    select u.auth_user_id a from users u where u.id = any(p_user_ids) and u.auth_user_id is not null
    union
    select ci.auth_user_id from customer_identities ci where ci.id = any(p_ident_ids) and ci.auth_user_id is not null
  ) s;
  update claims set
    user_id            = null,
    receipt_photo_path = null,
    receipt_photo_url  = null,
    ai_verdict         = null,
    iban               = null,
    tikkie_url         = null,
    notify_email       = false,
    notify_push        = false,
    approval_note      = case when status = 'pending' then 'Account deleted before review' else approval_note end,
    payout_status      = case when status = 'pending' then 'not_queued' else payout_status end,
    status             = case when status = 'pending' then 'failed' else status end
  where user_id = any(p_user_ids);
  get diagnostics n_claims = row_count;
  delete from activity_history where user_id = any(p_user_ids);
  delete from byo_cup_requests where user_id = any(p_user_ids) or identity_id = any(p_ident_ids);
  delete from client_events where user_id = any(p_user_ids);
  perform public.ux_erase_user(p_user_ids);
  delete from pending_batches where user_id = any(p_user_ids);
  delete from merge_requests where survivor_user_id = any(p_user_ids) or absorbed_user_ids && p_user_ids;
  delete from store_requests where device_id = any(devices);
  update backup_cup_uses set device_id = null where device_id = any(devices);
  delete from users where id = any(p_user_ids);
  get diagnostics n_rows = row_count;
  delete from customer_identities where id = any(p_ident_ids);
  get diagnostics n_idents = row_count;
  return jsonb_build_object(
    'deleted_rows', n_rows,
    'deleted_identities', n_idents,
    'kept_claims', n_claims,
    'receipt_paths', to_jsonb(receipts),
    'scan_paths', to_jsonb(scans),
    'auth_user_ids', to_jsonb(logins)
  );
end $function$;

-- Master Settings → Data can clear a venue's taps and visits, like any
-- other kind of activity record. Keep this list and ORG_DATA_TIME_COLUMN
-- (adminApi.js) in step.
create or replace function public.admin_purge_org_data(
  p_org_id uuid, p_kinds text[], p_from timestamptz default null, p_to timestamptz default null
) returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  time_col constant jsonb := jsonb_build_object(
    'cup_scans',          'scanned_at',
    'claims',             'created_at',
    'activity_history',   'created_at',
    'donation_transfers', 'created_at',
    'bin_sessions',       'created_at',
    'client_events',      'created_at',
    'system_events',      'created_at',
    'ux_events',          'at',
    'ux_sessions',        'started_at'
  );
  k text;
  col text;
  n integer;
  result jsonb := '{}'::jsonb;
begin
  if not public.is_master() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_org_id is null then
    raise exception 'org_id_required' using errcode = '22004';
  end if;
  if p_kinds is null or cardinality(p_kinds) = 0 then
    return result;
  end if;
  if p_from is not null and p_to is not null and p_from > p_to then
    raise exception 'invalid_range' using errcode = '22023';
  end if;
  foreach k in array p_kinds loop
    if not time_col ? k then
      raise exception 'kind_not_allowed: %', k using errcode = '42501';
    end if;
  end loop;

  foreach k in array (select array_agg(distinct x) from unnest(p_kinds) as x) loop
    col := time_col ->> k;
    execute format(
      'delete from public.%I where org_id = $1 and ($2::timestamptz is null or %I >= $2) and ($3::timestamptz is null or %I < $3)',
      k, col, col
    ) using p_org_id, p_from, p_to;
    get diagnostics n = row_count;
    result := result || jsonb_build_object(k, n);
  end loop;
  return result;
end $function$;
