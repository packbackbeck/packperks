-- ─────────────────────────────────────────────────────────────────────
-- 066 — let a master switch User analytics on.
--
-- 064 opened the data and the embed, and the edge function learned the new
-- page id, but the master-only writer that saves the switches did not:
-- `packpulse_admin_update` action 'pages' rebuilds the whole `pages` object
-- from its own fixed list, so a page it has never heard of is dropped on
-- the way in. The switch would have moved in the dashboard and come back
-- off on the next refresh.
--
-- Rewritten from the function's own definition so none of its SQL is
-- retyped. Re-running is a no-op once 'behaviour' is in the list.
-- ─────────────────────────────────────────────────────────────────────

do $do$
declare
  src text;
  fixed text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'packpulse_admin_update';
  if src is null then
    raise exception 'packpulse_admin_update is missing';
  end if;
  fixed := replace(
    src,
    'array[''overview'', ''stats'', ''reports'', ''preview'']',
    'array[''overview'', ''behaviour'', ''stats'', ''reports'', ''preview'']'
  );
  if fixed = src then
    raise notice 'page list already carries behaviour (or its spelling changed) - nothing done';
  else
    execute fixed;
    raise notice 'behaviour added to packpulse_admin_update';
  end if;
end $do$;
