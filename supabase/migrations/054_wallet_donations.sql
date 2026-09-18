-- 054 — Deferred Tikkie: donate from the wallet.
--
-- A Deferred Tikkie wallet is a set of receipt credits (claims rows with a
-- batch_id) that a bulk payout sweeps with payout_claim_id. A donation works
-- the same way: it sweeps every available credit into one `donation` row.
-- The customer can give part of the balance, and a credit can't be split
-- (batch_id is unique), so whatever they keep comes back as one
-- `wallet_change` row: no batch, counted by the wallet and swept by the
-- next payout or donation like any credit.
--
-- The donation row is what the dashboard's Donations page already sums
-- (claims.type = 'donation'), so the money owed to the charity shows there.
--
-- Called only by bin-tikkie (service role), after it has matched the device
-- to the profile. Race-safe like the payout sweep: the conditional UPDATE
-- waits on a concurrent sweep's row locks and then skips what it took.

alter table public.claims drop constraint if exists claims_type_check;
alter table public.claims add constraint claims_type_check
  check (type = any (array['cashback', 'direct_refund', 'voucher', 'donation', 'wallet_change']));

create or replace function public.wallet_donate(p_user_id uuid, p_amount numeric)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_org uuid;
  v_donation uuid;
  v_total numeric := 0;
  v_cups integer := 0;
  v_amount numeric;
  v_given_cups integer;
  v_rest numeric;
begin
  select u.org_id into v_org from users u where u.id = p_user_id and u.merged_into is null;
  if v_org is null then
    raise exception 'no_balance' using errcode = 'P0001';
  end if;
  if not public.venue_flag(v_org, 'featureDonations', true) then
    raise exception 'donations_disabled' using errcode = 'P0001';
  end if;
  if p_amount is null or round(p_amount, 2) < 0.01 then
    raise exception 'invalid_amount' using errcode = 'P0001';
  end if;

  insert into claims (user_id, org_id, type, status, cups_redeemed, payout_amount, batch_id, notify_email, notify_push)
  values (p_user_id, v_org, 'donation', 'completed', 0, 0, null, false, false)
  returning id into v_donation;

  with swept as (
    update claims set payout_claim_id = v_donation
     where user_id = p_user_id
       and payout_claim_id is null
       and tikkie_url is null
       and (batch_id is not null or type = 'wallet_change')
    returning payout_amount, cups_redeemed
  )
  select coalesce(sum(payout_amount), 0), coalesce(sum(cups_redeemed), 0)::integer
    into v_total, v_cups
    from swept;

  v_total := round(v_total, 2);
  if v_total < 0.01 then
    raise exception 'no_balance' using errcode = 'P0001';   -- rolls the insert back
  end if;

  v_amount := least(round(p_amount, 2), v_total);
  v_given_cups := least(v_cups, round(v_cups * v_amount / v_total)::integer);
  v_rest := v_total - v_amount;

  update claims set payout_amount = v_amount, cups_redeemed = v_given_cups where id = v_donation;

  if v_rest > 0 then
    insert into claims (user_id, org_id, type, status, cups_redeemed, payout_amount, batch_id, notify_email, notify_push)
    values (p_user_id, v_org, 'wallet_change', 'completed', v_cups - v_given_cups, v_rest, null, false, false);
  end if;

  return jsonb_build_object('amount', v_amount, 'cups', v_given_cups, 'balance', v_rest, 'donation_id', v_donation);
end
$function$;

revoke all on function public.wallet_donate(uuid, numeric) from public, anon, authenticated;
grant execute on function public.wallet_donate(uuid, numeric) to service_role;
