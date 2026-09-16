-- Emergency undo for migration 046: back to the Stage 1 rules of 043.
--
-- Use only if customers lose sight of their own cups after 046, for example
-- because an app build that doesn't send x-device-id went live. This REOPENS
-- what 046 closed: with the public key alone, anyone can again read every
-- customer row (emails included), balance, scan and identity, and fetch
-- other customers' Tikkie payout links from callers that send no header.
-- Fix the cause and re-apply 046 as soon as you can.
--
-- The rules are copied from supabase/baseline/2026-09-16_schema.sql (taken
-- after 045) and the functions from 043. request_user_ids() and the other
-- 046 helpers are left in place; nothing else uses them once this has run.
begin;
drop policy if exists "users: anon own rows" on public.users;
drop policy if exists "users: anon update own rows" on public.users;
drop policy if exists "users: anon insert on this device" on public.users;
drop policy if exists "users: authed insert" on public.users;
drop policy if exists "users: authed own rows" on public.users;
drop policy if exists "users: authed claim anon" on public.users;
drop policy if exists "cup_balances: anon own rows" on public.cup_balances;
drop policy if exists "cup_balances: anon update own rows" on public.cup_balances;
drop policy if exists "cup_balances: anon insert own rows" on public.cup_balances;
drop policy if exists "cup_balances: authed read" on public.cup_balances;
drop policy if exists "cup_balances: authed update" on public.cup_balances;
drop policy if exists "cup_balances: authed insert" on public.cup_balances;
drop policy if exists "ci anon own" on public.customer_identities;
drop policy if exists "ci anon update own" on public.customer_identities;
drop policy if exists "ci anon insert" on public.customer_identities;
drop policy if exists "ci authed select" on public.customer_identities;
drop policy if exists "ci authed update" on public.customer_identities;
drop policy if exists "activity_history: anon own rows" on public.activity_history;
drop policy if exists "activity_history: anon insert" on public.activity_history;
drop policy if exists "activity_history: authed insert" on public.activity_history;
drop policy if exists "activity_history: authed read" on public.activity_history;
drop trigger if exists trg_u_users_guard_device on public.users;
create policy "users: anon select" on public.users as permissive for select to anon
  using (true);
create policy "users: anon update" on public.users as permissive for update to anon
  using (true)
  with check (true);
create policy "users: anon insert" on public.users as permissive for insert to anon
  with check (true);
create policy "users: authed insert" on public.users as permissive for insert to authenticated
  with check ((auth_user_id = auth.uid()));
create policy "users: authed read anon" on public.users as permissive for select to authenticated
  using ((auth_user_id IS NULL));
create policy "users: authed claim anon" on public.users as permissive for update to authenticated
  using ((auth_user_id IS NULL))
  with check ((auth_user_id = auth.uid()));
create policy "cup_balances: anon select" on public.cup_balances as permissive for select to anon
  using (true);
create policy "cup_balances: anon update" on public.cup_balances as permissive for update to anon
  using (true)
  with check (true);
create policy "cup_balances: anon insert" on public.cup_balances as permissive for insert to anon
  with check (true);
create policy "cup_balances: authed read" on public.cup_balances as permissive for select to authenticated
  using ((((current_admin()).id IS NOT NULL) OR (user_id IN ( SELECT users.id
   FROM users
  WHERE (users.auth_user_id = auth.uid())))));
create policy "cup_balances: authed update" on public.cup_balances as permissive for update to authenticated
  using (true)
  with check (true);
create policy "cup_balances: authed insert" on public.cup_balances as permissive for insert to authenticated
  with check (true);
create policy "cup_scans: anon select" on public.cup_scans as permissive for select to anon
  using (true);
create policy "claims: anon insert" on public.claims as permissive for insert to anon
  with check (true);
create policy "claims: authed insert" on public.claims as permissive for insert to authenticated
  with check (true);
create policy "ci anon select" on public.customer_identities as permissive for select to anon
  using (true);
create policy "ci anon update" on public.customer_identities as permissive for update to anon
  using (true)
  with check (true);
create policy "ci anon insert" on public.customer_identities as permissive for insert to anon
  with check (true);
create policy "ci authed select" on public.customer_identities as permissive for select to authenticated
  using (true);
create policy "ci authed update" on public.customer_identities as permissive for update to authenticated
  using (true)
  with check (((auth_user_id IS NULL) OR (auth_user_id = auth.uid()) OR is_staff_writer()));
create policy "activity_history: anon select" on public.activity_history as permissive for select to anon
  using (true);
create policy "activity_history: anon insert" on public.activity_history as permissive for insert to anon
  with check (true);
create policy "activity_history: authed insert" on public.activity_history as permissive for insert to authenticated
  with check (true);
create policy "activity_history: authed read" on public.activity_history as permissive for select to authenticated
  using ((((current_admin()).id IS NOT NULL) OR (user_id IN ( SELECT users.id
   FROM users
  WHERE (users.auth_user_id = auth.uid())))));
create or replace function public.owns_user(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from users u
    left join customer_identities ci on ci.id = u.identity_id
    where u.id = p_user_id
      and (
        (auth.uid() is not null and (u.auth_user_id = auth.uid() or ci.auth_user_id = auth.uid()))
        or (u.device_id is not null and u.device_id = public.request_device_id())
      )
  )
$$;
create or replace function public.get_customer_claims(p_user_ids uuid[])
returns table(
  id uuid, user_id uuid, type text, reward_id text, cups_redeemed integer,
  payout_amount numeric, status text, payout_status text, tikkie_url text,
  tikkie_status text, tikkie_expires_at timestamptz, tikkie_redeemed_at timestamptz,
  notify_email boolean, notify_push boolean, flagged boolean, created_at timestamptz,
  verified_at timestamptz, approved_at timestamptz, ai_failure_checks text[],
  admin_failure_checks text[]
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.user_id, c.type, c.reward_id, c.cups_redeemed, c.payout_amount,
         c.status, c.payout_status,
         c.tikkie_url, c.tikkie_status, c.tikkie_expires_at, c.tikkie_redeemed_at,
         c.notify_email, c.notify_push,
         c.flagged, c.created_at, c.verified_at, c.approved_at,
         c.ai_failure_checks, c.admin_failure_checks
  from public.claims c
  where c.user_id = any(p_user_ids)
    and (public.request_device_id() is null or public.owns_user(c.user_id))
  order by c.created_at desc
$$;
create or replace function public.get_my_pending(p_user_ids uuid[])
returns table(batch_id uuid, first_seen timestamptz, resolved_at timestamptz, notified_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select pb.batch_id, pb.first_seen, pb.resolved_at, pb.notified_at
  from public.pending_batches pb
  where pb.user_id = any(p_user_ids)
    and (public.request_device_id() is null or public.owns_user(pb.user_id))
  order by pb.first_seen desc
$$;
create or replace function public.set_claim_notify(p_claim_id uuid, p_email boolean, p_push boolean)
returns void
language sql
security definer
set search_path = public
as $$
  update public.claims
     set notify_email = coalesce(p_email, false),
         notify_push  = false
   where id = p_claim_id
     and (public.request_device_id() is null or public.owns_user(user_id));
$$;
create or replace function public.redeem_voucher(
  p_user_id   uuid,
  p_org_id    uuid,
  p_reward_id text,
  p_cups      integer,
  p_amount    numeric,
  p_label     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org      uuid;
  v_reward   jsonb;
  v_cups     integer;
  v_amount   numeric;
  v_balance  integer;
  v_claim_id uuid := gen_random_uuid();
  v_now      timestamptz := now();
begin
  if p_user_id is null then
    raise exception 'invalid_request';
  end if;
  if (public.request_device_id() is not null) and not public.owns_user(p_user_id) then
    raise exception 'not_your_account' using errcode = '42501';
  end if;

  select u.org_id into v_org from users u where u.id = p_user_id;
  if not found then
    raise exception 'invalid_request';
  end if;
  v_org := coalesce(v_org, p_org_id);
  if p_org_id is not null and v_org is distinct from p_org_id then
    raise exception 'invalid_request';
  end if;
  if public.venue_payment_method(v_org) <> 'voucher' then
    raise exception 'venue_does_not_use_vouchers';
  end if;

  v_reward := public.published_reward(v_org, p_reward_id);
  if v_reward is null then
    raise exception 'reward_unavailable';
  end if;
  v_cups := round(public.config_number(v_reward -> 'cupsNeeded'))::integer;
  v_amount := coalesce(public.config_number(v_reward -> 'euros'), 0);
  if v_cups is null or v_cups < 1 then
    raise exception 'invalid_request';
  end if;

  -- Lock this customer's balance so two slides can't both win.
  select b.balance into v_balance
    from cup_balances b
   where b.user_id = p_user_id
   for update;

  if v_balance is null then
    raise exception 'no_balance';
  end if;
  if v_balance < v_cups then
    raise exception 'insufficient_cups';
  end if;

  update cup_balances
     set balance = balance - v_cups, updated_at = v_now
   where user_id = p_user_id;

  -- Already settled: the verified/approved stamps mark it as needing no
  -- review. The reward-budget trigger still runs on this insert.
  insert into claims (
    id, user_id, org_id, type, reward_id, cups_redeemed, payout_amount,
    status, payout_status, verified_at, approved_at, notify_email, notify_push
  ) values (
    v_claim_id, p_user_id, v_org, 'voucher', p_reward_id, v_cups, v_amount,
    'completed', 'not_queued', v_now, v_now, false, false
  );

  insert into activity_history (user_id, org_id, type, label, created_at)
  values (p_user_id, v_org, 'reward_claimed',
          coalesce(left(nullif(btrim(p_label), ''), 200), 'Redeemed at the counter'), v_now);

  return jsonb_build_object(
    'claim_id', v_claim_id,
    'new_balance', v_balance - v_cups,
    'redeemed_at', v_now
  );
end
$$;
commit;
