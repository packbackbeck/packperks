-- ──────────────────────────────────────────────────────────────────────
-- PackPerks — admin-only bulk delete of selected rows by id (025)
--
-- Powers the "select rows / select all → delete selected" feature on the
-- Users, Claims, Cup Scans, and Cup Transfers (donation_transfers) tables.
-- SECURITY DEFINER (deletes past RLS) but gated on current_admin(); the
-- table name is whitelisted so it can never delete arbitrary tables.
-- Deleting users also clears their NO-ACTION-FK dependents (activity_history,
-- claims) first; cup_balances + cup_scans cascade automatically.
--
-- Safe to re-run.
-- ──────────────────────────────────────────────────────────────────────

create or replace function public.admin_delete_records(p_table text, p_ids uuid[])
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid;
  n int := 0;
begin
  v_admin := (current_admin()).id;
  if v_admin is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_ids is null or array_length(p_ids, 1) is null then
    return json_build_object('deleted', 0);
  end if;

  if p_table = 'claims' then
    delete from public.claims where id = any(p_ids);
    get diagnostics n = row_count;
  elsif p_table = 'cup_scans' then
    delete from public.cup_scans where id = any(p_ids);
    get diagnostics n = row_count;
  elsif p_table = 'donation_transfers' then
    delete from public.donation_transfers where id = any(p_ids);
    get diagnostics n = row_count;
  elsif p_table = 'users' then
    delete from public.activity_history where user_id = any(p_ids);
    delete from public.claims where user_id = any(p_ids);
    delete from public.users where id = any(p_ids);
    get diagnostics n = row_count;
  else
    raise exception 'table_not_allowed: %', p_table using errcode = '42501';
  end if;

  return json_build_object('deleted', n);
end $$;

revoke all on function public.admin_delete_records(text, uuid[]) from public, anon;
grant execute on function public.admin_delete_records(text, uuid[]) to authenticated;
