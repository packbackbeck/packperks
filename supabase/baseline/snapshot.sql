-- Regenerates supabase/baseline/<date>_schema.sql from the live catalog.
--
-- 1. Make a one-off token and its hash:
--      python3 -c "import secrets; print(secrets.token_hex(24))" > /tmp/tok
--      tr -d '\n' < /tmp/tok | shasum -a 256
-- 2. Put the hash below, run this file (Supabase MCP execute_sql).
-- 3. Call it once over REST with the token and save the output:
--      curl -s -X POST "$SUPABASE_URL/rest/v1/rpc/pp_tmp_schema_snapshot" \
--        -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
--        -H "Content-Type: application/json" \
--        -d "{\"p_token\":\"$(cat /tmp/tok)\"}" -o snapshot.json
--    The body is a JSON string; decode it and prepend the header and
--    `set check_function_bodies = off;` from the current baseline.
-- 4. Drop it straight away:
--      drop function public.pp_tmp_schema_snapshot(text);

create or replace function public.pp_tmp_schema_snapshot(p_token text)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $fn$
declare
  parts text[] := '{}';
  t text;
begin
  if encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') <> '<sha256 of the one-off token>' then
    raise exception 'forbidden';
  end if;

  select string_agg(format('create extension if not exists %I with schema %I;', e.extname, n.nspname), E'\n' order by e.extname)
    into t
    from pg_extension e join pg_namespace n on n.oid = e.extnamespace
   where e.extname <> 'plpgsql';
  parts := parts || ('-- ── Extensions ──' || E'\n' || coalesce(t, ''));

  select string_agg(ddl, E'\n\n' order by relname) into t from (
    select c.relname,
      format(E'create table if not exists public.%I (\n%s\n);', c.relname,
        (select string_agg(format('  %I %s%s%s', a.attname, format_type(a.atttypid, a.atttypmod),
                 case when d.adbin is not null then ' default ' || pg_get_expr(d.adbin, d.adrelid) else '' end,
                 case when a.attnotnull then ' not null' else '' end), E',\n' order by a.attnum)
           from pg_attribute a
           left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
          where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped)) as ddl
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
  ) s;
  parts := parts || ('-- ── Tables ──' || E'\n' || coalesce(t, ''));

  select string_agg(format('alter table public.%I add constraint %I %s;', c.relname, k.conname, pg_get_constraintdef(k.oid)), E'\n'
                    order by c.relname, case k.contype when 'p' then 0 when 'u' then 1 else 2 end, k.conname)
    into t
    from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and k.contype in ('p', 'u', 'c', 'x');
  parts := parts || ('-- ── Keys and checks ──' || E'\n' || coalesce(t, ''));

  select string_agg(format('alter table public.%I add constraint %I %s;', c.relname, k.conname, pg_get_constraintdef(k.oid)), E'\n'
                    order by c.relname, k.conname)
    into t
    from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and k.contype = 'f';
  parts := parts || ('-- ── Foreign keys ──' || E'\n' || coalesce(t, ''));

  select string_agg(i.indexdef || ';', E'\n' order by i.tablename, i.indexname)
    into t
    from pg_indexes i
   where i.schemaname = 'public'
     and not exists (select 1 from pg_constraint k where k.conname = i.indexname and k.connamespace = 'public'::regnamespace);
  parts := parts || ('-- ── Indexes ──' || E'\n' || coalesce(t, ''));

  select string_agg(pg_get_functiondef(p.oid) || ';', E'\n' order by p.proname, pg_get_function_identity_arguments(p.oid))
    into t
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind in ('f', 'p')
     and p.proname <> 'pp_tmp_schema_snapshot'
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e');
  parts := parts || ('-- ── Functions ──' || E'\n' || coalesce(t, ''));

  select string_agg(
           format('revoke all on function public.%I(%s) from public, anon, authenticated;', p.proname, pg_get_function_identity_arguments(p.oid))
           || coalesce(E'\n' || format('grant execute on function public.%I(%s) to %s;', p.proname, pg_get_function_identity_arguments(p.oid),
                (select string_agg(r, ', ' order by r) from unnest(array['anon', 'authenticated', 'service_role']) r
                  where has_function_privilege(r, p.oid, 'EXECUTE'))), ''),
           E'\n' order by p.proname)
    into t
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind in ('f', 'p')
     and p.proname <> 'pp_tmp_schema_snapshot'
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e');
  parts := parts || ('-- ── Function privileges ──' || E'\n' || coalesce(t, ''));

  select string_agg(pg_get_triggerdef(tg.oid) || ';', E'\n' order by c.relname, tg.tgname)
    into t
    from pg_trigger tg join pg_class c on c.oid = tg.tgrelid join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and not tg.tgisinternal;
  parts := parts || ('-- ── Triggers ──' || E'\n' || coalesce(t, ''));

  select string_agg(
           format('revoke all on table public.%I from anon, authenticated;', c.relname)
           || coalesce(E'\n' || (select string_agg(format('grant %s on table public.%I to %s;', privs, c.relname, r), E'\n' order by r)
                from (select r, (select string_agg(lower(pv), ', ' order by pv) from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) pv
                                  where has_table_privilege(r, c.oid, pv)) privs
                        from unnest(array['anon', 'authenticated']) r) g
               where privs is not null), ''),
           E'\n' order by c.relname)
    into t
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p');
  parts := parts || ('-- ── Table privileges ──' || E'\n' || coalesce(t, ''));

  select string_agg(format('alter table public.%I enable row level security;', c.relname), E'\n' order by c.relname)
    into t
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity;
  parts := parts || ('-- ── Row level security ──' || E'\n' || coalesce(t, ''));

  select string_agg(
           format('create policy %I on %I.%I as %s for %s to %s%s%s;',
                  pl.policyname, pl.schemaname, pl.tablename, lower(pl.permissive), lower(pl.cmd),
                  (select string_agg(case when r = 'public' then 'public' else quote_ident(r) end, ', ') from unnest(pl.roles) r),
                  case when pl.qual is not null then E'\n  using (' || pl.qual || ')' else '' end,
                  case when pl.with_check is not null then E'\n  with check (' || pl.with_check || ')' else '' end),
           E'\n' order by pl.schemaname desc, pl.tablename, pl.policyname)
    into t
    from pg_policies pl
   where pl.schemaname in ('public', 'storage');
  parts := parts || ('-- ── Policies ──' || E'\n' || coalesce(t, ''));

  select string_agg(format('insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values (%L, %L, %s, %s, %s) on conflict (id) do nothing;',
                           b.id, b.name, b.public, coalesce(b.file_size_limit::text, 'null'),
                           coalesce(quote_literal(b.allowed_mime_types::text) || '::text[]', 'null')), E'\n' order by b.id)
    into t
    from storage.buckets b;
  parts := parts || ('-- ── Storage buckets ──' || E'\n' || coalesce(t, ''));

  select string_agg(format('select cron.schedule(%L, %L, %L);', j.jobname, j.schedule, j.command), E'\n' order by j.jobid)
    into t
    from cron.job j;
  parts := parts || ('-- ── Scheduled jobs (pg_cron) ──' || E'\n' || coalesce(t, ''));

  return array_to_string(parts, E'\n\n');
end
$fn$;
revoke all on function public.pp_tmp_schema_snapshot(text) from public, authenticated;
grant execute on function public.pp_tmp_schema_snapshot(text) to anon;
