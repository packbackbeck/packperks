-- 052 — Revoke, restore and set the expiry of a printed cup batch.
--
-- The Receipt generator changed these with `cups` updates from the browser.
-- `cups` has one policy, a dashboard read (051), and no update policy, so the
-- updates matched no rows and returned no error: revoking a batch, and the
-- expiry picked when generating one, silently did nothing. claim-cups does
-- honour `revoked_at` and `expires_at` once they are set.
--
-- Masters only, like minting cups (generate-cups): a printed batch is worth
-- money, so whether it can still be claimed is a master decision.
--
--   revoke   stamp revoked_at and a reason (3 to 200 characters) on the
--            batch's cups that are still available
--   restore  clear revoked_at and revoked_reason on the batch's cups
--   expiry   set expires_at on the batch's cups that are still available
--            (null: never expires)
--
-- Cups already claimed keep every column as it is. Nothing else changes:
-- not status, activated_at, activated_by_user_id or org_id. Returns the
-- number of cups changed. The dashboard writes the audit log entry.

create or replace function public.admin_set_cup_batch(
  p_batch_id   uuid,
  p_action     text,
  p_expires_at timestamptz default null,
  p_reason     text default null
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  n int := 0;
begin
  if not public.is_master() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if p_action is null or p_action not in ('revoke', 'restore', 'expiry') then
    raise exception 'invalid_action' using errcode = '22023';
  end if;

  if p_batch_id is null
     or not exists (select 1 from public.cups where batch_id = p_batch_id) then
    raise exception 'batch_not_found' using errcode = 'P0002';
  end if;

  if p_action = 'revoke' then
    if char_length(v_reason) < 3 then
      raise exception 'reason_required' using errcode = '22023';
    end if;
    if char_length(v_reason) > 200 then
      raise exception 'reason_too_long' using errcode = '22023';
    end if;

    update public.cups
       set revoked_at = now(),
           revoked_reason = v_reason
     where batch_id = p_batch_id
       and status = 'available';

  elsif p_action = 'restore' then
    update public.cups
       set revoked_at = null,
           revoked_reason = null
     where batch_id = p_batch_id
       and (revoked_at is not null or revoked_reason is not null);

  else
    update public.cups
       set expires_at = p_expires_at
     where batch_id = p_batch_id
       and status = 'available';
  end if;

  get diagnostics n = row_count;
  return n;
end
$$;

revoke all on function public.admin_set_cup_batch(uuid, text, timestamptz, text) from public, anon;
grant execute on function public.admin_set_cup_batch(uuid, text, timestamptz, text) to authenticated;
