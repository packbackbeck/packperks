-- Counter voucher: a third way to settle a reward. The customer shows a
-- live voucher screen, staff slide to confirm, and the cups leave the
-- balance on the spot — no receipt, no AI check, no payout link.
--
-- 1. A claim can now be a 'voucher'.
alter table public.claims drop constraint if exists claims_type_check;
alter table public.claims add constraint claims_type_check
  check (type = any (array['cashback'::text, 'direct_refund'::text, 'voucher'::text]));

-- 2. Redeeming is ONE atomic step. The slide at the counter must never
--    half-happen: the balance row is locked, the cups checked and taken,
--    the claim and the activity row written, or nothing at all. Anon can
--    already do each of these writes on its own (see the RLS on
--    cup_balances / claims / activity_history), so this grants no new
--    power — it only removes the gap between them.
create or replace function public.redeem_voucher(
  p_user_id  uuid,
  p_org_id   uuid,
  p_reward_id text,
  p_cups     integer,
  p_amount   numeric,
  p_label    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance   integer;
  v_claim_id  uuid := gen_random_uuid();
  v_now       timestamptz := now();
begin
  if p_user_id is null or p_cups is null or p_cups < 1 then
    raise exception 'invalid_request';
  end if;

  -- Lock this customer's balance row for the org so two slides can't both win.
  select balance into v_balance
    from cup_balances
   where user_id = p_user_id
     and (p_org_id is null or org_id = p_org_id or org_id is null)
   order by (org_id = p_org_id) desc nulls last
   limit 1
   for update;

  if v_balance is null then
    raise exception 'no_balance';
  end if;
  if v_balance < p_cups then
    raise exception 'insufficient_cups';
  end if;

  update cup_balances
     set balance = balance - p_cups, updated_at = v_now
   where user_id = p_user_id
     and (p_org_id is null or org_id = p_org_id or org_id is null)
     and balance = v_balance;   -- the locked row

  -- The claim: already settled. verified/approved stamps mark it as needing
  -- no review; the reward-budget trigger still runs on this insert.
  insert into claims (
    id, user_id, org_id, type, reward_id, cups_redeemed, payout_amount,
    status, payout_status, verified_at, approved_at, notify_email, notify_push
  ) values (
    v_claim_id, p_user_id, p_org_id, 'voucher', p_reward_id, p_cups, coalesce(p_amount, 0),
    'completed', 'not_queued', v_now, v_now, false, false
  );

  insert into activity_history (user_id, org_id, type, label, created_at)
  values (p_user_id, p_org_id, 'reward_claimed', coalesce(p_label, 'Redeemed at the counter'), v_now);

  return jsonb_build_object(
    'claim_id', v_claim_id,
    'new_balance', v_balance - p_cups,
    'redeemed_at', v_now
  );
end;
$$;

grant execute on function public.redeem_voucher(uuid, uuid, text, integer, numeric, text) to anon, authenticated;
