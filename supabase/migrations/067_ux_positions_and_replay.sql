-- ─────────────────────────────────────────────────────────────────────
-- 067 — put the taps where they actually landed, and record the visit.
--
-- WHY. A tap's Y was stored as a fraction of the document height of the
-- visit it happened in (`y = pageY / dh`), and that number means nothing
-- outside that one visit. On the home screen the page ran from 1153px to
-- 1947px — a 69% spread — so the same button was filed at a different
-- height every time. Measured per control on 23-28 Sep 2026: *Add email to
-- save your balance* was spread over 0.19 of the page, about 154px on a
-- phone, for a button 48px tall. Most of a button's own heat landed off
-- the button.
--
-- Two more faults rode on top. Every sheet, modal, cookie banner and the
-- scan page is `position: fixed`, and capture added the scroll position
-- behind them to the tap, so the whole popup funnel slid down the page by
-- however far the page behind happened to be scrolled. And the heat was
-- binned server-side into 36x64 cells before it was drawn, which on a
-- 375px phone quantises every point to roughly 10x30px.
--
-- WHAT REPLACES IT. The industry answer is to anchor a tap to the element
-- it hit rather than to a coordinate (Microsoft Clarity aggregates per DOM
-- element; PostHog's clickmap does the same and says plainly that
-- coordinate heatmaps "drift onto non-clickable areas"; Mixpanel keeps the
-- page dimensions beside each click so it can rescale rather than bake a
-- ratio). We already record `target`, a stable key for the control, so:
--
--   ox, oy  — where in the control's OWN box the finger landed, 0..1.
--             The dashboard finds that control in the embedded app, reads
--             its real rectangle, and puts the tap back on it. Page height
--             stops mattering.
--   px, py  — the page pixels as measured, for a tap that hit no control
--             (a dead tap has nothing to anchor to). Kept beside the vw/dh
--             already on the row, so a reader can rescale.
--   pinned  — the control does not scroll, so py is viewport-relative and
--             the scroll position was never added.
--
-- The old x/y/yv stay and are still written: every row already recorded
-- has only those, and the readers fall back to them.
-- ─────────────────────────────────────────────────────────────────────

alter table public.ux_events add column if not exists ox real;
alter table public.ux_events add column if not exists oy real;
alter table public.ux_events add column if not exists px real;
alter table public.ux_events add column if not exists py real;
alter table public.ux_events add column if not exists pinned boolean;

comment on column public.ux_events.ox is 'Where in the tapped control''s own box the finger landed, 0..1 across. Null when the tap hit no control.';
comment on column public.ux_events.oy is 'The same, down the control''s box.';
comment on column public.ux_events.px is 'Page x in CSS pixels as measured on that visit.';
comment on column public.ux_events.py is 'Page y in CSS pixels; viewport-relative when pinned is true.';
comment on column public.ux_events.pinned is 'The control is fixed or sticky, so it does not move with the scroll.';

/* The taps themselves, for a screen. The heatmap draws these on the real
 * control positions read out of the embedded app, so it wants points, not
 * a pre-binned grid. Capped, newest first. */
create or replace function public.ux_points(
  p_orgs uuid[],
  p_screen text,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_device text default null,
  p_limit integer default 4000
)
returns table (
  kind text, target text,
  ox real, oy real, px real, py real, pinned boolean,
  x real, y real, yv real,
  vw smallint, vh smallint, dh integer
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with guard as materialized (select public.ux_guard(p_orgs))
  select e.kind, e.target,
         e.ox, e.oy, e.px, e.py, e.pinned,
         e.x, e.y, e.yv,
         e.vw, e.vh, e.dh
    from public.ux_events e, guard
   where e.screen = p_screen
     and e.kind in ('click', 'rage', 'dead')
     and (p_orgs is null or e.org_id = any(p_orgs))
     and (p_from is null or e.at >= p_from)
     and (p_to   is null or e.at <  p_to)
     and (p_device is null or exists (
           select 1 from public.ux_sessions s
            where s.session_id = e.session_id and s.device = p_device))
   order by e.at desc
   limit greatest(1, least(20000, p_limit));
$$;

grant execute on function public.ux_points(uuid[], text, timestamptz, timestamptz, text, integer)
  to anon, authenticated, service_role;

/* ── Session replay, the real thing ────────────────────────────────────
 * rrweb records a snapshot of the DOM and every change to it. A visit's
 * recording arrives in chunks, in order, and is replayed in an iframe.
 *
 * This is a copy of what was on the screen, so it is the most sensitive
 * thing this app stores and it is treated that way: written only by
 * ux-ingest with the service role, readable only by a dashboard account,
 * never exposed to a PackPulse connection (no packpulse_* view — see
 * CLAUDE.md), and deleted on the same clock as the taps. Field contents
 * are masked in the browser before they are ever sent (`maskAllInputs`),
 * and the profile block is blocked outright. */
create table if not exists public.ux_replays (
  id          bigserial primary key,
  org_id      uuid not null references public.organizations(id) on delete cascade,
  session_id  text not null,
  user_id     uuid,
  seq         integer not null,
  events      jsonb not null,
  created_at  timestamptz not null default now(),
  unique (session_id, seq)
);

create index if not exists ux_replays_session on public.ux_replays (session_id, seq);
create index if not exists ux_replays_org_time on public.ux_replays (org_id, created_at desc);
create index if not exists ux_replays_user on public.ux_replays (user_id) where user_id is not null;

alter table public.ux_replays enable row level security;

-- Dashboard accounts read; nobody else, and nobody writes but the service
-- role (which bypasses RLS from the edge function).
drop policy if exists ux_replays_admin_read on public.ux_replays;
create policy ux_replays_admin_read on public.ux_replays
  for select to authenticated
  using ((public.current_admin()).id is not null);

grant select on public.ux_replays to authenticated;

/* Deleting a customer takes their recordings with them, on the same call
 * that already takes their taps — the shape of the original is kept, with
 * one more table in the chain. */
create or replace function public.ux_erase_user(p_user_ids uuid[])
returns void
language sql
security definer
set search_path to 'public'
as $$
  with s as (
    delete from public.ux_sessions where user_id = any(p_user_ids) returning session_id
  ), e as (
    delete from public.ux_events where user_id = any(p_user_ids) returning 1
  ), r as (
    delete from public.ux_replays where user_id = any(p_user_ids) returning 1
  )
  select null::void;
$$;

/* Retention: a recording is deleted on the same clock as the taps it goes
 * with. Rebuilt from the function's own definition so the venue-by-venue
 * loop it already does is not retyped. */
do $do$
declare
  src text;
  fixed text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'ux_run_retention';
  if src is null then
    raise notice 'ux_run_retention is missing - skipped';
    return;
  end if;
  if position('ux_replays' in src) > 0 then
    raise notice 'retention already clears recordings';
    return;
  end if;
  fixed := replace(
    src,
    'delete from public.ux_sessions where org_id = o.id and last_at < cutoff;',
    'delete from public.ux_replays where org_id = o.id and created_at < cutoff;'
    || chr(10) || '    get diagnostics n = row_count; total := total + n;'
    || chr(10) || '    delete from public.ux_sessions where org_id = o.id and last_at < cutoff;'
  );
  if fixed = src then
    raise notice 'could not find the retention delete - recordings NOT covered';
  else
    execute fixed;
    raise notice 'retention now clears recordings too';
  end if;
end $do$;
