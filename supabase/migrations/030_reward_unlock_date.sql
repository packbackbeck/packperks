-- reward_unlock_date(user, org, cups_needed, exclude_claim)
--
-- Most recent moment the user's running cup balance (in this org) crossed up to
-- >= cups_needed — i.e. when the reward was MOST RECENTLY unlocked. Built from
-- the cup ledger: gains = cup_scans.cups_awarded @ scanned_at, losses =
-- claims.cups_redeemed @ created_at (the claim being verified is excluded).
-- Returns null if the threshold was never reached.
--
-- Used by the verify-receipt edge function to flag a receipt dated BEFORE the
-- reward's most-recent unlock (a re-unlock after a redeem-to-zero resets the
-- clock, so we check the latest crossing, not the first).
create or replace function public.reward_unlock_date(
  p_user_id uuid,
  p_org_id uuid,
  p_cups_needed int,
  p_exclude_claim uuid default null
) returns timestamptz
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_run    int := 0;
  v_unlock timestamptz := null;
  r        record;
begin
  if p_user_id is null or p_cups_needed is null or p_cups_needed <= 0 then
    return null;
  end if;

  for r in
    select ts, delta from (
      select scanned_at as ts, coalesce(cups_awarded, 0) as delta
        from cup_scans
        where user_id = p_user_id
          and (p_org_id is null or org_id = p_org_id)
          and coalesce(cups_awarded, 0) > 0
          and coalesce(status, '') not in ('failed', 'pending', 'held', 'rejected')
      union all
      select created_at as ts, -coalesce(cups_redeemed, 0) as delta
        from claims
        where user_id = p_user_id
          and (p_org_id is null or org_id = p_org_id)
          and coalesce(cups_redeemed, 0) > 0
          and coalesce(status, '') in ('pending', 'completed')
          and (p_exclude_claim is null or id <> p_exclude_claim)
    ) e
    where ts is not null
    order by ts asc, delta desc   -- process gains before losses at the same instant
  loop
    if v_run < p_cups_needed and (v_run + r.delta) >= p_cups_needed then
      v_unlock := r.ts;           -- crossing up to the threshold (keep the latest)
    end if;
    v_run := v_run + r.delta;
    if v_run < 0 then v_run := 0; end if;
  end loop;

  return v_unlock;
end;
$$;

revoke all on function public.reward_unlock_date(uuid, uuid, int, uuid) from public, anon;
grant execute on function public.reward_unlock_date(uuid, uuid, int, uuid) to authenticated, service_role;
