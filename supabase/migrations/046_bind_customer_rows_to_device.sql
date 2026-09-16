-- 046 — Tie every customer row to its device or its login.   (STAGE 2)
--
-- Applied 16 Sep 2026, after the app build that sends the x-device-id header
-- (src/lib/supabase.js) was confirmed live on perks.packback.network. An
-- older build sends no header and loses sight of its own rows under these
-- rules, so any rebuild must deploy the app before this.
--
-- Stage 1 (043) stopped anyone from adding cups or choosing what a claim pays.
-- This stage stops anyone from reading or spending another customer's rows:
--
--   • customer rows, balances, history and shared profiles are visible and
--     changeable only by the device that created them, or by the login and
--     shared identity they belong to;
--   • claims are created only through create_cashback_claim / refund_all_cups;
--   • the claim and voucher calls always check whose balance it is;
--   • Tikkie links are only ever returned to their owner.
--
-- Staff access through the dashboard is unchanged: those policies test
-- current_admin() / is_staff_writer(), not the device.

-- ═════════════════════════════════════════════════════════════════════════
-- 1. The rows a request may touch
-- ═════════════════════════════════════════════════════════════════════════
-- The rows this device created and the rows they were merged into, plus, when
-- signed in, every row on the login or on its shared identity.
create or replace function public.request_user_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  with recursive mine as (
    select u.id, u.merged_into
      from users u
     where (public.request_device_id() is not null and u.device_id = public.request_device_id())
        or (auth.uid() is not null and u.auth_user_id = auth.uid())
        or (auth.uid() is not null and u.identity_id in (
              select ci.id from customer_identities ci where ci.auth_user_id = auth.uid()))
    union
    select u.id, u.merged_into
      from users u
      join mine m on u.id = m.merged_into
  )
  select coalesce(array_agg(distinct id), '{}') from mine
$$;

-- The shared identities those rows point at.
create or replace function public.request_identity_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct x), '{}') from (
    select u.identity_id x from users u
     where u.id = any(public.request_user_ids()) and u.identity_id is not null
    union
    select ci.id from customer_identities ci
     where auth.uid() is not null and ci.auth_user_id = auth.uid()
  ) s
$$;

-- owns_user now covers merge survivors too, the same set RLS uses.
create or replace function public.owns_user(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id = any(public.request_user_ids())
$$;

-- ═════════════════════════════════════════════════════════════════════════
-- 2. users
-- ═════════════════════════════════════════════════════════════════════════
drop policy if exists "users: anon select" on public.users;
drop policy if exists "users: anon own rows" on public.users;
-- The device test on the row itself also covers a row this statement just
-- inserted, which request_user_ids() (a snapshot) can't see yet.
create policy "users: anon own rows" on public.users
  for select to anon
  using (device_id = public.request_device_id() or id = any((select public.request_user_ids())::uuid[]));

drop policy if exists "users: anon update" on public.users;
drop policy if exists "users: anon update own rows" on public.users;
create policy "users: anon update own rows" on public.users
  for update to anon
  using (id = any((select public.request_user_ids())::uuid[]))
  with check (id = any((select public.request_user_ids())::uuid[]));

drop policy if exists "users: anon insert" on public.users;
drop policy if exists "users: anon insert on this device" on public.users;
create policy "users: anon insert on this device" on public.users
  for insert to anon with check (device_id = public.request_device_id());

drop policy if exists "users: authed insert" on public.users;
create policy "users: authed insert" on public.users
  for insert to authenticated
  with check (auth_user_id = auth.uid() and device_id = public.request_device_id());

-- Signed-in customers used to see every unlinked row and could attach any of
-- them to their login. Now only the ones on their own device.
drop policy if exists "users: authed read anon" on public.users;
drop policy if exists "users: authed own rows" on public.users;
create policy "users: authed own rows" on public.users
  for select to authenticated
  using (device_id = public.request_device_id() or id = any((select public.request_user_ids())::uuid[]));

drop policy if exists "users: authed claim anon" on public.users;
create policy "users: authed claim anon" on public.users
  for update to authenticated
  using (auth_user_id is null and id = any((select public.request_user_ids())::uuid[]))
  with check (auth_user_id = auth.uid());

-- Is this shared identity used by any row other than p_user_id? Runs with
-- the owner's rights: the caller can only see their own rows.
create or replace function public.identity_used_by_others(p_identity uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from users o where o.identity_id = p_identity and o.id <> p_user_id)
$$;

-- A request can point its row at a device and an identity it owns, never at
-- someone else's.
create or replace function public.users_guard_device()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('anon', 'authenticated') or public.is_staff_writer() then
    return new;
  end if;
  if new.device_id is distinct from old.device_id
     and new.device_id is distinct from public.request_device_id() then
    new.device_id := old.device_id;
  end if;
  if new.identity_id is distinct from old.identity_id and new.identity_id is not null
     and not (new.identity_id = any(public.request_identity_ids()))
     and public.identity_used_by_others(new.identity_id, new.id)
  then
    -- Only an identity nobody else uses yet (one this device just created)
    -- may be taken on without already belonging to the caller.
    raise exception 'identity_not_yours' using errcode = '42501';
  end if;
  return new;
end
$$;

drop trigger if exists trg_u_users_guard_device on public.users;
create trigger trg_u_users_guard_device
  before update on public.users
  for each row execute function public.users_guard_device();

-- ═════════════════════════════════════════════════════════════════════════
-- 3. cup_balances
-- ═════════════════════════════════════════════════════════════════════════
drop policy if exists "cup_balances: anon select" on public.cup_balances;
drop policy if exists "cup_balances: anon own rows" on public.cup_balances;
create policy "cup_balances: anon own rows" on public.cup_balances
  for select to anon using (user_id = any((select public.request_user_ids())::uuid[]));

drop policy if exists "cup_balances: anon update" on public.cup_balances;
drop policy if exists "cup_balances: anon update own rows" on public.cup_balances;
create policy "cup_balances: anon update own rows" on public.cup_balances
  for update to anon
  using (user_id = any((select public.request_user_ids())::uuid[]))
  with check (user_id = any((select public.request_user_ids())::uuid[]));

drop policy if exists "cup_balances: anon insert" on public.cup_balances;
drop policy if exists "cup_balances: anon insert own rows" on public.cup_balances;
create policy "cup_balances: anon insert own rows" on public.cup_balances
  for insert to anon with check (user_id = any((select public.request_user_ids())::uuid[]));

drop policy if exists "cup_balances: authed read" on public.cup_balances;
create policy "cup_balances: authed read" on public.cup_balances
  for select to authenticated
  using ((current_admin()).id is not null or user_id = any((select public.request_user_ids())::uuid[]));

drop policy if exists "cup_balances: authed update" on public.cup_balances;
create policy "cup_balances: authed update" on public.cup_balances
  for update to authenticated
  using (public.is_staff_writer() or user_id = any((select public.request_user_ids())::uuid[]))
  with check (public.is_staff_writer() or user_id = any((select public.request_user_ids())::uuid[]));

drop policy if exists "cup_balances: authed insert" on public.cup_balances;
create policy "cup_balances: authed insert" on public.cup_balances
  for insert to authenticated
  with check (public.is_staff_writer() or user_id = any((select public.request_user_ids())::uuid[]));

-- ═════════════════════════════════════════════════════════════════════════
-- 4. cup_scans and claims
-- ═════════════════════════════════════════════════════════════════════════
-- The app never reads scans; the dashboard reads them as staff.
drop policy if exists "cup_scans: anon select" on public.cup_scans;

-- Claims are created only through create_cashback_claim and refund_all_cups.
drop policy if exists "claims: anon insert" on public.claims;
drop policy if exists "claims: authed insert" on public.claims;

-- ═════════════════════════════════════════════════════════════════════════
-- 5. customer_identities
-- ═════════════════════════════════════════════════════════════════════════
drop policy if exists "ci anon select" on public.customer_identities;
drop policy if exists "ci anon own" on public.customer_identities;
create policy "ci anon own" on public.customer_identities
  for select to anon using (id = any((select public.request_identity_ids())::uuid[]));

drop policy if exists "ci anon update" on public.customer_identities;
drop policy if exists "ci anon update own" on public.customer_identities;
create policy "ci anon update own" on public.customer_identities
  for update to anon
  using (id = any((select public.request_identity_ids())::uuid[]))
  with check (id = any((select public.request_identity_ids())::uuid[]));

drop policy if exists "ci anon insert" on public.customer_identities;
create policy "ci anon insert" on public.customer_identities
  for insert to anon with check (auth_user_id is null);

drop policy if exists "ci authed select" on public.customer_identities;
create policy "ci authed select" on public.customer_identities
  for select to authenticated
  using ((current_admin()).id is not null or id = any((select public.request_identity_ids())::uuid[]));

drop policy if exists "ci authed update" on public.customer_identities;
create policy "ci authed update" on public.customer_identities
  for update to authenticated
  using (public.is_staff_writer() or id = any((select public.request_identity_ids())::uuid[]))
  with check (auth_user_id is null or auth_user_id = auth.uid() or public.is_staff_writer());

-- ═════════════════════════════════════════════════════════════════════════
-- 6. activity_history
-- ═════════════════════════════════════════════════════════════════════════
drop policy if exists "activity_history: anon select" on public.activity_history;
drop policy if exists "activity_history: anon own rows" on public.activity_history;
create policy "activity_history: anon own rows" on public.activity_history
  for select to anon using (user_id = any((select public.request_user_ids())::uuid[]));

drop policy if exists "activity_history: anon insert" on public.activity_history;
create policy "activity_history: anon insert" on public.activity_history
  for insert to anon with check (user_id = any((select public.request_user_ids())::uuid[]));

drop policy if exists "activity_history: authed insert" on public.activity_history;
create policy "activity_history: authed insert" on public.activity_history
  for insert to authenticated
  with check (public.is_staff_writer() or user_id = any((select public.request_user_ids())::uuid[]));

drop policy if exists "activity_history: authed read" on public.activity_history;
create policy "activity_history: authed read" on public.activity_history
  for select to authenticated
  using ((current_admin()).id is not null or user_id = any((select public.request_user_ids())::uuid[]));

-- ═════════════════════════════════════════════════════════════════════════
-- 7. The calls always check whose rows they are
-- ═════════════════════════════════════════════════════════════════════════
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
    and c.user_id = any(public.request_user_ids())
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
    and pb.user_id = any(public.request_user_ids())
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
     and user_id = any(public.request_user_ids());
$$;

-- redeem_voucher: the same function as 043, with the ownership check always on.
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
  if not public.owns_user(p_user_id) then
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
