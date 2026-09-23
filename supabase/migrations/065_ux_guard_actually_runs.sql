-- ─────────────────────────────────────────────────────────────────────
-- 065 — make the User-flow guard actually run.
--
-- The six analytics readers open with a guard in a CTE:
--
--   with guard as (select public.ux_guard(p_orgs)),
--   ev as (select e.* from public.ux_events e, guard where …)
--
-- No column of `guard` is ever read, and in a LANGUAGE sql function
-- Postgres inlines the CTE and prunes the unused output — so the guard was
-- never evaluated. Proven against the live database on 23 Sep 2026: as
-- plain `anon` (the key that ships in the customer bundle),
-- `ux_screen_summary(null)` returned five screens, `ux_flow(null)` seven
-- rows, `ux_heatmap(null,'home',…)` its cells and `ux_targets(null,…)` real
-- button names — every venue at once, with no account of any kind.
--
-- Two changes, so the fence cannot be optimised away again:
--   • the guard is VOLATILE, so the planner must treat it as having an
--     effect rather than an unused value;
--   • each CTE is MATERIALIZED, which is an optimisation fence: the CTE is
--     executed as written before the scan that joins it.
--
-- The rewrite is done from each function's own definition, so none of the
-- readers' SQL is retyped. If 061 is re-run, re-apply 064 and then this.
-- ─────────────────────────────────────────────────────────────────────

alter function public.ux_guard(uuid[]) volatile;
alter function public.ux_guard() volatile;

do $do$
declare
  r record;
  src text;
  fixed text;
begin
  for r in
    select p.oid, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('ux_screen_summary', 'ux_targets', 'ux_flow',
                         'ux_heatmap', 'ux_scroll_curve', 'ux_target_series')
  loop
    src := pg_get_functiondef(r.oid);
    fixed := replace(
      src,
      'with guard as (select public.ux_guard(',
      'with guard as materialized (select public.ux_guard('
    );
    if fixed <> src then
      execute fixed;
      raise notice 'guard materialised in %', r.proname;
    end if;
  end loop;
end $do$;
