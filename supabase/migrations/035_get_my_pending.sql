-- Redirect Refund home: the customer's own "in process" receipts.
--
-- A pending batch is a receipt the customer scanned before the bin's
-- confirmation reached us. The home page lists these with an "In process"
-- status. pending_batches is service-role/admin only, so the anon client
-- reads its own rows through this security-definer RPC, keyed by the
-- account ids the device holds (same trust model as get_customer_claims).
create or replace function public.get_my_pending(p_user_ids uuid[])
returns table (
  batch_id    uuid,
  first_seen  timestamptz,
  resolved_at timestamptz,
  notified_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select pb.batch_id, pb.first_seen, pb.resolved_at, pb.notified_at
  from public.pending_batches pb
  where pb.user_id = any(p_user_ids)
  order by pb.first_seen desc
$$;

grant execute on function public.get_my_pending(uuid[]) to anon, authenticated;
