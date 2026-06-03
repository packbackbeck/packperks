-- ──────────────────────────────────────────────────────────────────────
-- PackPerks — server-side aggregation of QR cup batches (027)
--
-- Returns one row per batch for an org so the Recent-batches table can list
-- EVERY batch (the old client-side cup-row rollup hit PostgREST's row cap and
-- silently dropped older batches). Admin-gated; the client paginates.
--
-- Safe to re-run.
-- ──────────────────────────────────────────────────────────────────────
create or replace function public.admin_list_cup_batches(p_org_id uuid)
returns table (
  batch_id uuid,
  total bigint,
  activated bigint,
  created_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_reason text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if (current_admin()).id is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return query
    select
      c.batch_id,
      count(*)::bigint,
      count(*) filter (where c.status = 'activated')::bigint,
      min(c.created_at),
      max(c.expires_at),
      max(c.revoked_at),
      max(c.revoked_reason)
    from public.cups c
    where (p_org_id is null or c.org_id = p_org_id)
      and c.batch_id is not null
    group by c.batch_id
    order by min(c.created_at) desc;
end $$;

revoke all on function public.admin_list_cup_batches(uuid) from public, anon;
grant execute on function public.admin_list_cup_batches(uuid) to authenticated;
