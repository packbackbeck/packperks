-- 049 — Masters choose which of an organisation's records to delete.
--
-- Master Settings → Data replaces the "Delete test data" card on System
-- health. A master picks one organisation, the kinds of record to delete
-- and, optionally, a time window; `admin_purge_org_data` deletes exactly
-- that and returns how many rows went per kind.
--
-- Only records of activity can be picked. Customers, balances, rewards,
-- printed cups, locations and settings are never touched here: customers are
-- erased through the admin-delete-user edge function, which keeps their
-- claims as the payout ledger.
--
-- The older all-in-one `admin_purge_org_records` (cup scans, claims and
-- charity transfers) was open to any account that can write. The live
-- dashboard only offered it to masters; it is now master-only in the
-- database as well.

create or replace function public.admin_purge_org_data(
  p_org_id uuid,
  p_kinds text[],
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  -- kind → the table's time column. Nothing outside this list can be named.
  time_col constant jsonb := jsonb_build_object(
    'cup_scans',          'scanned_at',
    'claims',             'created_at',
    'activity_history',   'created_at',
    'donation_transfers', 'created_at',
    'bin_sessions',       'created_at',
    'client_events',      'created_at',
    'system_events',      'created_at'
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
end
$$;

revoke all on function public.admin_purge_org_data(uuid, text[], timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_purge_org_data(uuid, text[], timestamptz, timestamptz) to authenticated;

create or replace function public.admin_purge_org_records(p_org_id uuid)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  n_scans int;
  n_claims int;
  n_transfers int;
begin
  if not public.is_master() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_org_id is null then
    raise exception 'org_id_required' using errcode = '22004';
  end if;
  delete from public.cup_scans where org_id = p_org_id;
  get diagnostics n_scans = row_count;
  delete from public.claims where org_id = p_org_id;
  get diagnostics n_claims = row_count;
  delete from public.donation_transfers where org_id = p_org_id;
  get diagnostics n_transfers = row_count;
  return json_build_object(
    'cup_scans', n_scans,
    'claims', n_claims,
    'cup_transfers', n_transfers
  );
end
$$;
