-- ─────────────────────────────────────────────────────────────────────
-- 064 — User analytics for PackPulse.
--
-- The connection could share Dashboard, System health and Reports & alerts.
-- User analytics is the fourth page, and it needs more than a page flag,
-- because it reads through two doors the other pages don't:
--
--   • Six tables the Programme tab loads (cups, cup_scans, claims, users,
--     client_events, consent_rejections). Five already have a packpulse_*
--     view — they just never listed 'behaviour' as a page that opens them,
--     so the page arrays grow one entry. consent_rejections had no view at
--     all and gets one here.
--
--   • Three tables and six RPCs behind User flow, Heatmap and Session
--     replay (ux_sessions, ux_events, ux_layouts; ux_screen_summary,
--     ux_targets, ux_flow, ux_heatmap, ux_scroll_curve, ux_target_series).
--     The views are the easy half. The RPCs are the interesting half:
--     `src/lib/supabase.js` rewrites `.from(table)` to the view, but it
--     cannot rewrite `.rpc(name)`, so a shared RPC is reached directly.
--
-- Every ux RPC opens with `ux_guard()`, which demands an active
-- admin_profiles row. A PackPulse connection deliberately has none (see
-- CLAUDE.md: never give a connection login an admin_profiles row), so the
-- RPCs fail closed for it today. Simply letting a connection through would
-- be worse than useless: the RPCs take `p_orgs` from the caller, so an
-- unscoped connection could ask for any venue's heatmap.
--
-- So the guard gains an org-aware form. `ux_guard(p_orgs)` lets a dashboard
-- account through exactly as before, and lets a connection through only
-- when every organisation it asked for is one its own link shares with the
-- 'behaviour' page on. The six RPCs are repointed at it below by rewriting
-- their own definitions, so none of their SQL is retyped here.
--
-- If 061 is ever re-run, its `ux_guard()` call sites come back and the
-- embed's User flow stops working until this migration is applied again.
-- It fails closed, which is the right way round.
-- ─────────────────────────────────────────────────────────────────────

/* The guard, with the caller's requested organisations in hand.
 * A dashboard account: unchanged, any scope (the dashboard narrows in JS).
 * A PackPulse connection: only its own shared venues, and it must name
 * them — a null scope would mean "everything". */
create or replace function public.ux_guard(p_orgs uuid[])
returns void
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_allowed uuid[];
begin
  if (public.current_admin()).id is not null then
    return;
  end if;

  v_allowed := public.packpulse_org_ids(array['behaviour']);
  if v_allowed is null or cardinality(v_allowed) = 0 then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_orgs is null or cardinality(p_orgs) = 0 then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if exists (select 1 from unnest(p_orgs) o where not (o = any(v_allowed))) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
end $$;

grant execute on function public.ux_guard(uuid[]) to anon, authenticated, service_role;

/* Repoint the six readers at the org-aware guard, by rewriting each one's
 * own definition. Nothing about their queries changes, and re-running this
 * migration is a no-op once they are pointed. */
do $do$
declare
  r record;
  src text;
begin
  for r in
    select p.oid, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('ux_screen_summary', 'ux_targets', 'ux_flow',
                         'ux_heatmap', 'ux_scroll_curve', 'ux_target_series')
  loop
    src := pg_get_functiondef(r.oid);
    if position('public.ux_guard()' in src) > 0 then
      execute replace(src, 'public.ux_guard()', 'public.ux_guard(p_orgs)');
      raise notice 'ux_guard(p_orgs) → %', r.proname;
    end if;
  end loop;
end $do$;

/* ── The three User-flow tables, as this connection's venues only ──
 * Same shape as every other packpulse_* view: the columns the readers ask
 * for, filtered by the link, select-only. `user_id` is an internal id, not
 * a person — the same call the other views make. */
create or replace view public.packpulse_ux_sessions as
  select session_id, org_id, user_id, mode, device, entry, started_at, last_at,
         duration_ms, screens, screen_list, clicks, rage, dead, max_scroll,
         first_tap_ms, last_screen, replay, events, created_at
    from public.ux_sessions
   where org_id in (select unnest(public.packpulse_org_ids(array['behaviour'::text])));

create or replace view public.packpulse_ux_events as
  select id, org_id, session_id, user_id, seq, kind, screen, target, label,
         x, y, yv, vw, vh, dh, depth, t_ms, at
    from public.ux_events
   where org_id in (select unnest(public.packpulse_org_ids(array['behaviour'::text])));

-- If ux_layouts grows a column the readers select (a `page`, say), add it
-- here too: a view's column list is fixed when it is created.
create or replace view public.packpulse_ux_layouts as
  select org_id, screen, device, elements, vw, vh, dh, seen, updated_at
    from public.ux_layouts
   where org_id in (select unnest(public.packpulse_org_ids(array['behaviour'::text])));

-- The Programme tab counts these; there is nothing in the row but a date.
create or replace view public.packpulse_consent_rejections as
  select id, org_id, created_at
    from public.consent_rejections
   where org_id in (select unnest(public.packpulse_org_ids(array['behaviour'::text])));

grant select on public.packpulse_ux_sessions to authenticated;
grant select on public.packpulse_ux_events to authenticated;
grant select on public.packpulse_ux_layouts to authenticated;
grant select on public.packpulse_consent_rejections to authenticated;

/* ── 'behaviour' opens the five views the Programme tab reads ──
 * Done by rewriting each view's own definition, so their column lists and
 * the hashing they already do are untouched. */
do $do$
declare
  r record;
  src text;
begin
  for r in
    select c.oid, c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'v'
       and c.relname in ('packpulse_cups', 'packpulse_cup_scans', 'packpulse_claims',
                         'packpulse_users', 'packpulse_client_events')
  loop
    src := pg_get_viewdef(r.oid, true);
    if position('''behaviour''' in src) = 0 then
      execute format(
        'create or replace view public.%I as %s',
        r.relname,
        replace(src, 'packpulse_org_ids(ARRAY[', 'packpulse_org_ids(ARRAY[''behaviour''::text, ')
      );
      raise notice 'behaviour → %', r.relname;
    end if;
  end loop;
end $do$;
