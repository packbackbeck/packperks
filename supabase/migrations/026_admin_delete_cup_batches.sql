-- ──────────────────────────────────────────────────────────────────────
-- PackPerks — admin-only delete of whole QR cup batches (026)
--
-- Powers the "select batches → delete" action in the QR Cup Receipt
-- generator's Recent batches table. Deleting a batch's cup rows removes it
-- from the list and effectively revokes the QR (a scan of a now-missing
-- batch returns batch_not_found). SECURITY DEFINER, gated on current_admin().
-- Nothing references `cups`, so the delete is safe.
--
-- Safe to re-run.
-- ──────────────────────────────────────────────────────────────────────
create or replace function public.admin_delete_cup_batches(p_batch_ids uuid[])
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
  if p_batch_ids is null or array_length(p_batch_ids, 1) is null then
    return json_build_object('deleted_cups', 0, 'batches', 0);
  end if;

  delete from public.cups where batch_id = any(p_batch_ids);
  get diagnostics n = row_count;

  return json_build_object('deleted_cups', n, 'batches', array_length(p_batch_ids, 1));
end $$;

revoke all on function public.admin_delete_cup_batches(uuid[]) from public, anon;
grant execute on function public.admin_delete_cup_batches(uuid[]) to authenticated;
