-- 043 — Stop the public key, and signed-in customers, from moving money or
-- taking over the dashboard.
--
-- The customer app talks to the database with the public (anon) key. A
-- customer who verifies an email becomes an `authenticated` user, the same
-- database role the dashboard uses. Until now both could write far more than
-- the app needs. Each of these was confirmed with a rolled-back transaction:
--
--   • any signed-in person could insert an admin invitation for their own
--     email, which bootstrap-admin then honoured: a stranger could become an
--     admin;
--   • any dashboard account, a vendor included, could set its own role to
--     owner;
--   • any signed-in person could rewrite app_config (reward prices, rates),
--     organisations, groups and locations;
--   • anyone could set any cup balance, call increment_cup_balance, and
--     create claims with a payout amount and status of their choosing.
--
-- This is stage 1 of 2. Everything here works with the customer app that is
-- live today, which does not say which device is asking. It closes the
-- takeovers, the config rewrites, balance inflation and payout tampering, and
-- adds the device-checked calls the next app build uses. Stage 2
-- (supabase/pending/046_bind_customer_rows_to_device.sql) ties every customer
-- row to its device once that build is live.

-- ═════════════════════════════════════════════════════════════════════════
-- 1. Who is asking
-- ═════════════════════════════════════════════════════════════════════════

-- A dashboard account that may change data. Checkers and vendors only read,
-- which matches hasPermission() in src/admin/auth/AuthContext.jsx.
create or replace function public.is_staff_writer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from admin_profiles
    where id = auth.uid()
      and status = 'active'
      and role in ('owner', 'admin', 'manager')
  )
$$;

-- The device id the customer app sends with every database request, as the
-- x-device-id header (src/lib/supabase.js). Null for app builds from before
-- the header, for edge functions and for the dashboard.
create or replace function public.request_device_id()
returns text
language sql
stable
set search_path = public
as $$
  select nullif(nullif(current_setting('request.headers', true), '')::json ->> 'x-device-id', '')
$$;

-- Does the caller own this customer row? Signed in: the rows linked to their
-- login, directly or through their shared identity. Otherwise: the rows their
-- device created.
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

-- ═════════════════════════════════════════════════════════════════════════
-- 2. Prices come from the published config, never from the request
-- ═════════════════════════════════════════════════════════════════════════

-- A number stored in JSON config, whether it was saved as 1.5 or "1.5".
create or replace function public.config_number(p jsonb)
returns numeric
language sql
immutable
as $$
  select case
    when jsonb_typeof(p) = 'number' then (p #>> '{}')::numeric
    when jsonb_typeof(p) = 'string' and btrim(p #>> '{}') ~ '^-?[0-9]+(\.[0-9]+)?$'
      then btrim(p #>> '{}')::numeric
  end
$$;

-- A live reward from a venue's published config.
create or replace function public.published_reward(p_org_id uuid, p_reward_id text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select r
  from app_config ac
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(ac.value -> 'rewards') = 'array' then ac.value -> 'rewards' else '[]'::jsonb end
  ) r
  where ac.key = 'published:' || p_org_id
    and r ->> 'id' = p_reward_id
    and r ->> 'status' = 'live'
  limit 1
$$;

-- A venue's published settings; an empty object when it has none.
create or replace function public.venue_settings(p_org_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select case when jsonb_typeof(ac.value -> 'settings') = 'object' then ac.value -> 'settings' end
       from app_config ac where ac.key = 'published:' || p_org_id),
    '{}'::jsonb)
$$;

-- The refund a venue pays per cup. Mirrors effectiveRates() in
-- src/lib/rates.js: a positive number from settings, else the mode default.
-- Deferred Tikkie reads refundRatePerCup, then cashbackRatePerCup, then 0.10.
create or replace function public.venue_refund_rate(p_org_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_settings jsonb := public.venue_settings(p_org_id);
  v_refund numeric := public.config_number(v_settings -> 'refundRatePerCup');
  v_cashback numeric := public.config_number(v_settings -> 'cashbackRatePerCup');
begin
  if v_refund <= 0 then v_refund := null; end if;
  if v_cashback <= 0 then v_cashback := null; end if;
  if v_settings ->> 'mode' = 'tikkie_only' then
    return coalesce(v_refund, v_cashback, 0.10);
  end if;
  return coalesce(v_refund, 1.00);
end
$$;

-- How a venue settles rewards: its own choice, its group's, else Tikkie.
-- Mirrors resolvePaymentMethod() in src/lib/paymentMethods.js.
create or replace function public.venue_payment_method(p_org_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select m from (select public.venue_settings(p_org_id) ->> 'paymentMethod' m) x
      where m in ('tikkie', 'voucher')),
    (select g.value -> 'settings' ->> 'paymentMethod'
       from organizations o
       join app_config g on g.key = 'published:group:' || o.group_id
      where o.id = p_org_id
        and g.value -> 'settings' ->> 'paymentMethod' in ('tikkie', 'voucher')),
    'tikkie')
$$;

-- A feature switch in a venue's settings. Missing means the app default.
create or replace function public.venue_flag(p_org_id uuid, p_flag text, p_default boolean)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case jsonb_typeof(public.venue_settings(p_org_id) -> p_flag)
    when 'boolean' then (public.venue_settings(p_org_id) ->> p_flag)::boolean
    else p_default
  end
$$;

-- A claim that pays money needs an email on the account, and a verified one
-- (a signed-in session) wherever the venue requires verification. Mirrors the
-- check in handleClaim() in src/App.jsx.
create or replace function public.assert_can_claim(p_user_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  u users;
  identity_email text;
begin
  select * into u from users where id = p_user_id;
  if public.venue_flag(u.org_id, 'requireEmailVerification', true) then
    if auth.uid() is null or not exists (
      select 1 from users x
      left join customer_identities ci on ci.id = x.identity_id
      where x.id = p_user_id and (x.auth_user_id = auth.uid() or ci.auth_user_id = auth.uid())
    ) then
      raise exception 'verification_required' using errcode = 'P0001';
    end if;
    return;
  end if;
  select email into identity_email from customer_identities where id = u.identity_id;
  if nullif(btrim(coalesce(u.email, identity_email, '')), '') is null and u.auth_user_id is null then
    raise exception 'email_required' using errcode = 'P0001';
  end if;
end
$$;

-- ═════════════════════════════════════════════════════════════════════════
-- 3. Dashboard accounts: invitations and roles
-- ═════════════════════════════════════════════════════════════════════════

-- invite-admin writes invitations with the service role. Nothing else may.
drop policy if exists "authenticated can insert admin_invitations" on public.admin_invitations;
-- Pending invitations (emails, roles, tokens) were readable without signing
-- in. Nothing reads them that way.
drop policy if exists "inv: anon accept lookup" on public.admin_invitations;
-- The old rule compared org ids, which never matches a global admin, so
-- owners and admins could neither list nor revoke invitations.
drop policy if exists "inv: org admins manage" on public.admin_invitations;
drop policy if exists "inv: owner+admin read" on public.admin_invitations;
create policy "inv: owner+admin read" on public.admin_invitations
  for select to authenticated
  using ((current_admin()).role in ('owner', 'admin')
         and ((current_admin()).org_id is null or org_id = (current_admin()).org_id));
drop policy if exists "inv: owner+admin revoke" on public.admin_invitations;
create policy "inv: owner+admin revoke" on public.admin_invitations
  for update to authenticated
  using ((current_admin()).role in ('owner', 'admin')
         and ((current_admin()).org_id is null or org_id = (current_admin()).org_id))
  with check ((current_admin()).role in ('owner', 'admin')
         and ((current_admin()).org_id is null or org_id = (current_admin()).org_id));

-- Same org-id comparison problem on team management: role changes, blocking
-- and removal from the Team page matched no rows for a global admin.
drop policy if exists "profile: owner+admin update" on public.admin_profiles;
create policy "profile: owner+admin update" on public.admin_profiles
  for update to authenticated
  using ((current_admin()).role in ('owner', 'admin')
         and ((current_admin()).org_id is null or org_id = (current_admin()).org_id))
  with check ((current_admin()).role in ('owner', 'admin')
         and ((current_admin()).org_id is null or org_id = (current_admin()).org_id));

-- "profile: self update" lets anyone edit their own row, which included the
-- role column. Keep your own row to name, colour and picture; only an owner
-- may create or change an owner.
create or replace function public.admin_profiles_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  me_role text := (public.current_admin()).role;
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  new.id := old.id;
  new.created_at := old.created_at;
  new.invited_by := old.invited_by;
  if old.id = auth.uid() then
    new.role := old.role;
    new.status := old.status;
    new.org_id := old.org_id;
    new.email := old.email;
    new.location_ids := old.location_ids;
    new.is_packperks_staff := old.is_packperks_staff;
    return new;
  end if;
  if me_role is distinct from 'owner' and (old.role = 'owner' or new.role = 'owner') then
    raise exception 'only_an_owner_can_manage_owners' using errcode = '42501';
  end if;
  return new;
end
$$;

drop trigger if exists trg_admin_profiles_guard on public.admin_profiles;
create trigger trg_admin_profiles_guard
  before update on public.admin_profiles
  for each row execute function public.admin_profiles_guard();

-- ═════════════════════════════════════════════════════════════════════════
-- 4. Dashboard-only tables: staff write, customers read at most
-- ═════════════════════════════════════════════════════════════════════════

-- app_config — reward prices, rates, every venue setting. "public_read" stays.
drop policy if exists "authenticated can manage app_config" on public.app_config;
drop policy if exists "app_config: staff insert" on public.app_config;
create policy "app_config: staff insert" on public.app_config
  for insert to authenticated with check (public.is_staff_writer());
drop policy if exists "app_config: staff update" on public.app_config;
create policy "app_config: staff update" on public.app_config
  for update to authenticated using (public.is_staff_writer()) with check (public.is_staff_writer());
drop policy if exists "app_config: staff delete" on public.app_config;
create policy "app_config: staff delete" on public.app_config
  for delete to authenticated using (public.is_staff_writer());

-- organizations — reads stay as they are.
drop policy if exists "authenticated can insert organizations" on public.organizations;
drop policy if exists "authenticated can update organizations" on public.organizations;
drop policy if exists "organizations: staff insert" on public.organizations;
create policy "organizations: staff insert" on public.organizations
  for insert to authenticated with check (public.is_staff_writer());
drop policy if exists "organizations: staff update" on public.organizations;
create policy "organizations: staff update" on public.organizations
  for update to authenticated using (public.is_staff_writer()) with check (public.is_staff_writer());

-- org_groups — signed-in customers still need to read them (src/lib/groups.js).
drop policy if exists "authenticated can manage org_groups" on public.org_groups;
drop policy if exists "org_groups: authed read" on public.org_groups;
create policy "org_groups: authed read" on public.org_groups
  for select to authenticated using (true);
drop policy if exists "org_groups: staff insert" on public.org_groups;
create policy "org_groups: staff insert" on public.org_groups
  for insert to authenticated with check (public.is_staff_writer());
drop policy if exists "org_groups: staff update" on public.org_groups;
create policy "org_groups: staff update" on public.org_groups
  for update to authenticated using (public.is_staff_writer()) with check (public.is_staff_writer());
drop policy if exists "org_groups: staff delete" on public.org_groups;
create policy "org_groups: staff delete" on public.org_groups
  for delete to authenticated using (public.is_staff_writer());

-- locations — reads stay as they are.
drop policy if exists "authenticated can insert locations" on public.locations;
drop policy if exists "authenticated can update locations" on public.locations;
drop policy if exists "authenticated can delete locations" on public.locations;
drop policy if exists "locations: staff insert" on public.locations;
create policy "locations: staff insert" on public.locations
  for insert to authenticated with check (public.is_staff_writer());
drop policy if exists "locations: staff update" on public.locations;
create policy "locations: staff update" on public.locations
  for update to authenticated using (public.is_staff_writer()) with check (public.is_staff_writer());
drop policy if exists "locations: staff delete" on public.locations;
create policy "locations: staff delete" on public.locations
  for delete to authenticated using (public.is_staff_writer());

-- donation_transfers — the Donations page only.
drop policy if exists "donation_transfers: authed write" on public.donation_transfers;
drop policy if exists "donation_transfers: authed read" on public.donation_transfers;
drop policy if exists "donation_transfers: authed update" on public.donation_transfers;
drop policy if exists "donation_transfers: staff read" on public.donation_transfers;
create policy "donation_transfers: staff read" on public.donation_transfers
  for select to authenticated using ((current_admin()).id is not null);
drop policy if exists "donation_transfers: staff insert" on public.donation_transfers;
create policy "donation_transfers: staff insert" on public.donation_transfers
  for insert to authenticated with check (public.is_staff_writer());
drop policy if exists "donation_transfers: staff update" on public.donation_transfers;
create policy "donation_transfers: staff update" on public.donation_transfers
  for update to authenticated using (public.is_staff_writer()) with check (public.is_staff_writer());

-- mockups — the /mockup tool, opened from a dashboard session.
drop policy if exists "mockups_sel" on public.mockups;
drop policy if exists "mockups_ins" on public.mockups;
drop policy if exists "mockups_upd" on public.mockups;
drop policy if exists "mockups_del" on public.mockups;
drop policy if exists "mockups: staff read" on public.mockups;
create policy "mockups: staff read" on public.mockups
  for select to authenticated using ((current_admin()).id is not null);
drop policy if exists "mockups: staff insert" on public.mockups;
create policy "mockups: staff insert" on public.mockups
  for insert to authenticated with check (public.is_staff_writer());
drop policy if exists "mockups: staff update" on public.mockups;
create policy "mockups: staff update" on public.mockups
  for update to authenticated using (public.is_staff_writer()) with check (public.is_staff_writer());
drop policy if exists "mockups: staff delete" on public.mockups;
create policy "mockups: staff delete" on public.mockups
  for delete to authenticated using (public.is_staff_writer());

-- byo_cup_requests — byo-mint writes them with the service role; the
-- dashboard approves them. A signed-in customer could approve their own.
drop policy if exists "byo_requests_auth_all" on public.byo_cup_requests;
drop policy if exists "byo_cup_requests: staff read" on public.byo_cup_requests;
create policy "byo_cup_requests: staff read" on public.byo_cup_requests
  for select to authenticated using ((current_admin()).id is not null);
drop policy if exists "byo_cup_requests: staff update" on public.byo_cup_requests;
create policy "byo_cup_requests: staff update" on public.byo_cup_requests
  for update to authenticated using (public.is_staff_writer()) with check (public.is_staff_writer());
drop policy if exists "byo_cup_requests: staff delete" on public.byo_cup_requests;
create policy "byo_cup_requests: staff delete" on public.byo_cup_requests
  for delete to authenticated using (public.is_staff_writer());

-- Storage: receipt photos, cup-scan photos and donation receipts were
-- readable by any signed-in customer. Only the dashboard opens them.
drop policy if exists "PackPerks receipts: authed select" on storage.objects;
drop policy if exists "PackPerks receipts: staff select" on storage.objects;
create policy "PackPerks receipts: staff select" on storage.objects
  for select to authenticated
  using (bucket_id = 'receipts' and (public.current_admin()).id is not null);
drop policy if exists "PackPerks cup-scans: authed select" on storage.objects;
drop policy if exists "PackPerks cup-scans: staff select" on storage.objects;
create policy "PackPerks cup-scans: staff select" on storage.objects
  for select to authenticated
  using (bucket_id = 'cup-scans' and (public.current_admin()).id is not null);
drop policy if exists "donation-receipts: authed read" on storage.objects;
drop policy if exists "donation-receipts: staff read" on storage.objects;
create policy "donation-receipts: staff read" on storage.objects
  for select to authenticated
  using (bucket_id = 'donation-receipts' and (public.current_admin()).id is not null);
drop policy if exists "donation-receipts: authed write" on storage.objects;
drop policy if exists "donation-receipts: staff write" on storage.objects;
create policy "donation-receipts: staff write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'donation-receipts' and public.is_staff_writer());
drop policy if exists "reward-images: authed write" on storage.objects;
drop policy if exists "reward-images: staff write" on storage.objects;
create policy "reward-images: staff write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'reward-images' and public.is_staff_writer());

-- ═════════════════════════════════════════════════════════════════════════
-- 5. Customer tables
-- ═════════════════════════════════════════════════════════════════════════
-- Guards below apply to requests made as anon or authenticated. Edge
-- functions (service_role) and SECURITY DEFINER functions (which run as their
-- owner) are trusted and pass straight through, as do dashboard staff.

-- ── claims ────────────────────────────────────────────────────────────────
-- Neither customer update rule was used: the app records the notify choice
-- through set_claim_notify(), and sets the receipt path when it inserts.
drop policy if exists "claims: anon update receipt path" on public.claims;
drop policy if exists "claims: authed owner update" on public.claims;
-- Reviewing claims is a writer's job; vendors and checkers only read.
drop policy if exists "admin_update_claims_authenticated" on public.claims;
drop policy if exists "claims: staff update" on public.claims;
create policy "claims: staff update" on public.claims
  for update to authenticated using (public.is_staff_writer()) with check (public.is_staff_writer());

-- The app build that is live today still inserts claims itself. Whatever it
-- sends, the amount, the cups and every review or payout field are decided
-- here. (trg_set_org fills org_id first; trg_z_enforce_reward_budget runs
-- after this, on the amount set here.)
create or replace function public.claims_guard_client_insert()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_user_org uuid;
  v_reward   jsonb;
  v_balance  integer;
begin
  if current_user not in ('anon', 'authenticated') or public.is_staff_writer() then
    return new;
  end if;

  select org_id into v_user_org from users where id = new.user_id;
  if not found then
    raise exception 'claim_user_unknown' using errcode = '23514';
  end if;
  if v_user_org is not null and new.org_id is distinct from v_user_org then
    raise exception 'claim_org_mismatch' using errcode = '23514';
  end if;

  if new.type = 'cashback' then
    v_reward := public.published_reward(new.org_id, new.reward_id);
    if v_reward is null then
      raise exception 'reward_unavailable' using errcode = '23514';
    end if;
    new.cups_redeemed := round(public.config_number(v_reward -> 'cupsNeeded'))::integer;
    new.payout_amount := public.config_number(v_reward -> 'euros');
    select b.balance into v_balance from cup_balances b where b.user_id = new.user_id;
    if coalesce(v_balance, 0) < coalesce(new.cups_redeemed, 0) then
      raise exception 'insufficient_cups' using errcode = '23514';
    end if;
  elsif new.type = 'direct_refund' then
    -- The live app zeroes the balance in a parallel request, so the balance
    -- can't be checked here without failing honest refunds. Refunds wait for
    -- review; stage 2 moves them to refund_all_cups().
    if coalesce(new.cups_redeemed, 0) < 1 then
      raise exception 'claim_cups_required' using errcode = '23514';
    end if;
    new.reward_id := null;
    new.payout_amount := round(new.cups_redeemed * public.venue_refund_rate(new.org_id), 2);
  else
    raise exception 'claim_type_not_allowed' using errcode = '23514';
  end if;

  new.status := 'pending';
  new.created_at := now();
  new.receipt_photo_path := case when new.receipt_photo_path = new.id::text || '.jpg' then new.receipt_photo_path end;
  new.receipt_photo_url := null;
  new.iban := null;
  new.iban_last4 := null;
  new.ai_verdict := null;
  new.ai_confidence := null;
  new.ai_is_receipt := null;
  new.ai_is_burger_king := null;
  new.ai_contains_required_item := null;
  new.ai_failure_checks := null;
  new.ai_reason := null;
  new.ai_required_item := null;
  new.extracted_total_eur := null;
  new.extracted_datetime := null;
  new.extracted_receipt_id := null;
  new.verified_at := null;
  new.approved_by := null;
  new.approved_at := null;
  new.approval_note := null;
  new.admin_failure_checks := null;
  new.payout_status := null;
  new.payout_id := null;
  new.payout_claim_id := null;
  new.paid_at := null;
  new.batch_id := null;
  new.tikkie_url := null;
  new.tikkie_status := null;
  new.tikkie_cashback_id := null;
  new.tikkie_expires_at := null;
  new.tikkie_redeemed_at := null;
  new.tikkie_last_error := null;
  new.tikkie_last_error_at := null;
  new.image_hidden := false;
  new.image_hidden_reason := null;
  new.image_hidden_at := null;
  new.image_hidden_by := null;
  new.flagged := false;
  new.notify_email := false;
  new.notify_push := false;
  new.notified_at := null;
  return new;
end
$$;

drop trigger if exists trg_t_claims_guard_client_insert on public.claims;
create trigger trg_t_claims_guard_client_insert
  before insert on public.claims
  for each row execute function public.claims_guard_client_insert();

-- The dashboard reviews a claim. It never changes what the claim pays, to
-- whom, or where the money went; the app, the AI check and the payout
-- provider own those.
create or replace function public.claims_guard_client_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if new.id                 is distinct from old.id
  or new.user_id            is distinct from old.user_id
  or new.org_id             is distinct from old.org_id
  or new.type               is distinct from old.type
  or new.reward_id          is distinct from old.reward_id
  or new.cups_redeemed      is distinct from old.cups_redeemed
  or new.payout_amount      is distinct from old.payout_amount
  or new.receipt_photo_path is distinct from old.receipt_photo_path
  or new.iban               is distinct from old.iban
  or new.tikkie_url         is distinct from old.tikkie_url
  or new.tikkie_cashback_id is distinct from old.tikkie_cashback_id
  or new.created_at         is distinct from old.created_at
  then
    raise exception 'claim_field_locked' using errcode = '42501';
  end if;
  return new;
end
$$;

drop trigger if exists trg_t_claims_guard_client_update on public.claims;
create trigger trg_t_claims_guard_client_update
  before update on public.claims
  for each row execute function public.claims_guard_client_update();

-- ── cup_balances ──────────────────────────────────────────────────────────
-- Cups are credited only by the scan functions (claim-cups, byo-mint,
-- bin-mint-batch). A customer's own request can open an empty balance and
-- spend from it, never add to it.
create or replace function public.cup_balances_guard_client()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('anon', 'authenticated') or public.is_staff_writer() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.balance := 0;
    new.lifetime_cups := 0;
    return new;
  end if;
  new.id := old.id;
  new.user_id := old.user_id;
  new.org_id := old.org_id;
  new.lifetime_cups := old.lifetime_cups;
  new.balance := greatest(0, least(coalesce(new.balance, 0), coalesce(old.balance, 0)));
  return new;
end
$$;

drop trigger if exists trg_t_cup_balances_guard_client on public.cup_balances;
create trigger trg_t_cup_balances_guard_client
  before insert or update on public.cup_balances
  for each row execute function public.cup_balances_guard_client();

-- ── cup_scans ─────────────────────────────────────────────────────────────
-- The app never writes scans (claim-cups does, as the service role). The
-- dashboard does, when it approves a BYO request or reviews a scan, and had
-- no rule allowing it, so those writes silently did nothing.
drop policy if exists "cup_scans: anon update" on public.cup_scans;
drop policy if exists "cup_scans: anon insert" on public.cup_scans;
drop policy if exists "cup_scans: staff insert" on public.cup_scans;
create policy "cup_scans: staff insert" on public.cup_scans
  for insert to authenticated with check (public.is_staff_writer());
drop policy if exists "cup_scans: staff update" on public.cup_scans;
create policy "cup_scans: staff update" on public.cup_scans
  for update to authenticated using (public.is_staff_writer()) with check (public.is_staff_writer());

-- ── users ─────────────────────────────────────────────────────────────────
-- Editing a customer from the dashboard matched no rows for a signed-in
-- customer and failed outright for an anonymous one.
drop policy if exists "users: staff update" on public.users;
create policy "users: staff update" on public.users
  for update to authenticated using (public.is_staff_writer()) with check (public.is_staff_writer());

-- A customer's own request can't attach a row to someone else's login, mark
-- an email verified that the login didn't verify, or move the row.
create or replace function public.users_guard_client()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  jwt_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  verified_by_login boolean;
begin
  if current_user not in ('anon', 'authenticated') or public.is_staff_writer() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.merged_into := null;
    if uid is null or new.auth_user_id is distinct from uid then
      new.auth_user_id := null;
    end if;
  else
    new.id := old.id;
    new.org_id := old.org_id;
    new.merged_into := old.merged_into;
    new.created_at := old.created_at;
    if uid is null then
      new.auth_user_id := old.auth_user_id;
      new.device_id := old.device_id;
    elsif new.auth_user_id is distinct from old.auth_user_id
      and not (old.auth_user_id is null and new.auth_user_id = uid) then
      new.auth_user_id := old.auth_user_id;
    end if;
  end if;

  verified_by_login := uid is not null
    and new.auth_user_id = uid
    and jwt_email <> ''
    and lower(coalesce(new.email, '')) = jwt_email;
  if tg_op = 'INSERT' then
    if not verified_by_login then
      new.email_verified_at := null;
      new.email_verified := false;
    end if;
  else
    if new.email_verified_at is distinct from old.email_verified_at
      and new.email_verified_at is not null and not verified_by_login then
      new.email_verified_at := old.email_verified_at;
    end if;
    if coalesce(new.email_verified, false) and not coalesce(old.email_verified, false)
      and not verified_by_login then
      new.email_verified := old.email_verified;
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists trg_t_users_guard_client on public.users;
create trigger trg_t_users_guard_client
  before insert or update on public.users
  for each row execute function public.users_guard_client();

-- ── customer_identities ───────────────────────────────────────────────────
-- "ci authed all" let any signed-in person read, rewrite or delete every
-- shared profile. Nothing in the app deletes one.
drop policy if exists "ci authed all" on public.customer_identities;
drop policy if exists "ci authed select" on public.customer_identities;
create policy "ci authed select" on public.customer_identities
  for select to authenticated using (true);
drop policy if exists "ci authed insert" on public.customer_identities;
create policy "ci authed insert" on public.customer_identities
  for insert to authenticated with check (auth_user_id is null or auth_user_id = auth.uid());
drop policy if exists "ci authed update" on public.customer_identities;
create policy "ci authed update" on public.customer_identities
  for update to authenticated
  using (true)
  with check (auth_user_id is null or auth_user_id = auth.uid() or public.is_staff_writer());

create or replace function public.customer_identities_guard_client()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  jwt_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  verified_by_login boolean;
begin
  if current_user not in ('anon', 'authenticated') or public.is_staff_writer() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if uid is null or new.auth_user_id is distinct from uid then
      new.auth_user_id := null;
    end if;
  else
    new.id := old.id;
    new.created_at := old.created_at;
    new.iban := old.iban;
    if new.auth_user_id is distinct from old.auth_user_id
      and not (uid is not null and old.auth_user_id is null and new.auth_user_id = uid) then
      new.auth_user_id := old.auth_user_id;
    end if;
  end if;

  verified_by_login := uid is not null
    and new.auth_user_id = uid
    and jwt_email <> ''
    and lower(coalesce(new.email, '')) = jwt_email;
  if tg_op = 'INSERT' then
    if not verified_by_login then
      new.email_verified := false;
      new.email_verified_at := null;
    end if;
  else
    if coalesce(new.email_verified, false) and not coalesce(old.email_verified, false)
      and not verified_by_login then
      new.email_verified := old.email_verified;
    end if;
    if new.email_verified_at is distinct from old.email_verified_at
      and new.email_verified_at is not null and not verified_by_login then
      new.email_verified_at := old.email_verified_at;
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists trg_t_customer_identities_guard_client on public.customer_identities;
create trigger trg_t_customer_identities_guard_client
  before insert or update on public.customer_identities
  for each row execute function public.customer_identities_guard_client();

-- ═════════════════════════════════════════════════════════════════════════
-- 6. Functions the public key must not call
-- ═════════════════════════════════════════════════════════════════════════
-- Only edge functions call these, as the service role.
revoke execute on function public.increment_cup_balance(uuid, uuid, integer) from public, anon, authenticated;
revoke execute on function public.spend_cup_balance(uuid, integer) from public, anon, authenticated;
revoke execute on function public.check_rate_limit(text, integer, integer) from public, anon, authenticated;
revoke execute on function public.reward_unlock_date(uuid, uuid, integer, uuid) from public, anon, authenticated;
grant execute on function public.increment_cup_balance(uuid, uuid, integer) to service_role;
grant execute on function public.spend_cup_balance(uuid, integer) to service_role;
grant execute on function public.check_rate_limit(text, integer, integer) to service_role;
grant execute on function public.reward_unlock_date(uuid, uuid, integer, uuid) to service_role;

-- ═════════════════════════════════════════════════════════════════════════
-- 7. Customer actions, each one checked and done in one step
-- ═════════════════════════════════════════════════════════════════════════
-- The next app build calls these instead of writing tables. Each proves the
-- caller owns the row (owns_user) and takes every amount from the config.

-- A receipt claim. The receipt photo goes to receipts/<claim id>.jpg.
create or replace function public.create_cashback_claim(p_user_id uuid, p_reward_id text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_reward jsonb;
  v_cups integer;
  v_balance integer;
  v_claim_id uuid := gen_random_uuid();
begin
  if not public.owns_user(p_user_id) then
    raise exception 'not_your_account' using errcode = '42501';
  end if;
  select u.org_id into v_org from users u where u.id = p_user_id;
  if public.venue_payment_method(v_org) <> 'tikkie' then
    raise exception 'venue_uses_vouchers' using errcode = 'P0001';
  end if;
  perform public.assert_can_claim(p_user_id);

  v_reward := public.published_reward(v_org, p_reward_id);
  if v_reward is null then
    raise exception 'reward_unavailable' using errcode = 'P0001';
  end if;
  v_cups := round(public.config_number(v_reward -> 'cupsNeeded'))::integer;

  select b.balance into v_balance from cup_balances b where b.user_id = p_user_id;
  if coalesce(v_balance, 0) < coalesce(v_cups, 0) then
    raise exception 'insufficient_cups' using errcode = 'P0001';
  end if;

  insert into claims (id, user_id, org_id, type, reward_id, cups_redeemed, payout_amount,
                      receipt_photo_path, status)
  values (v_claim_id, p_user_id, v_org, 'cashback', p_reward_id, v_cups,
          public.config_number(v_reward -> 'euros'), v_claim_id::text || '.jpg', 'pending');
  return v_claim_id;
end
$$;

-- Cash out the whole balance. The balance is locked, emptied and the claim
-- written together, so the amount always matches the cups taken.
create or replace function public.refund_all_cups(p_user_id uuid, p_label text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_cups integer;
  v_amount numeric;
  v_claim_id uuid := gen_random_uuid();
  v_now timestamptz := now();
begin
  if not public.owns_user(p_user_id) then
    raise exception 'not_your_account' using errcode = '42501';
  end if;
  select u.org_id into v_org from users u where u.id = p_user_id;
  if not public.venue_flag(v_org, 'featureDirectRefunds', true) then
    raise exception 'refunds_disabled' using errcode = 'P0001';
  end if;
  perform public.assert_can_claim(p_user_id);

  select b.balance into v_cups from cup_balances b where b.user_id = p_user_id for update;
  if coalesce(v_cups, 0) < 1 then
    raise exception 'no_cups' using errcode = 'P0001';
  end if;
  v_amount := round(v_cups * public.venue_refund_rate(v_org), 2);

  update cup_balances set balance = 0, updated_at = v_now where user_id = p_user_id;
  insert into claims (id, user_id, org_id, type, cups_redeemed, payout_amount, status)
  values (v_claim_id, p_user_id, v_org, 'direct_refund', v_cups, v_amount, 'pending');
  insert into activity_history (user_id, org_id, type, label, created_at)
  values (p_user_id, v_org, 'cups_withdrawn',
          coalesce(left(nullif(btrim(p_label), ''), 200),
                   'Direct refund: ' || v_cups || ' cup' || case when v_cups = 1 then '' else 's' end),
          v_now);

  return jsonb_build_object('claim_id', v_claim_id, 'cups', v_cups, 'amount', v_amount, 'new_balance', 0);
end
$$;

-- Give cups to the venue's charity. There is no payout, so no email is
-- needed. (The claims table has never accepted a 'donation' type; the
-- Donations page reads these activity rows.)
create or replace function public.donate_cups(p_user_id uuid, p_cups integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_balance integer;
  v_given integer;
  v_now timestamptz := now();
begin
  if not public.owns_user(p_user_id) then
    raise exception 'not_your_account' using errcode = '42501';
  end if;
  select u.org_id into v_org from users u where u.id = p_user_id;
  if not public.venue_flag(v_org, 'featureDonations', true) then
    raise exception 'donations_disabled' using errcode = 'P0001';
  end if;

  select b.balance into v_balance from cup_balances b where b.user_id = p_user_id for update;
  v_given := least(coalesce(p_cups, 0), coalesce(v_balance, 0));
  if v_given < 1 then
    raise exception 'no_cups' using errcode = 'P0001';
  end if;

  update cup_balances set balance = balance - v_given, updated_at = v_now where user_id = p_user_id;
  insert into activity_history (user_id, org_id, type, label, created_at)
  values (p_user_id, v_org, 'cups_donated',
          'Donated ' || v_given || ' cup' || case when v_given = 1 then '' else 's' end
            || ' to Plastic Soup Foundation',
          v_now);

  return jsonb_build_object('cups', v_given, 'new_balance', v_balance - v_given);
end
$$;

-- The counter voucher, with the same call the live app makes. The cups and
-- the value now come from the reward, not the request. A request that says
-- which device it is must own the balance; the live app says nothing, so
-- stage 2 makes that check unconditional.
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

-- ═════════════════════════════════════════════════════════════════════════
-- 8. Reading claims and pending receipts
-- ═════════════════════════════════════════════════════════════════════════
-- These hand out Tikkie payout links. When the request says which device it
-- is, only that customer's own rows come back. The live app says nothing, so
-- it keeps today's behaviour until stage 2.

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

-- ═════════════════════════════════════════════════════════════════════════
-- 9. Deleting a customer keeps the accounting record
-- ═════════════════════════════════════════════════════════════════════════
-- docs/RETENTION_SCHEDULE.md: a claim's amount, date, status and IBAN last 4
-- are kept for 7 years. Both deletion paths used to delete claims outright.
-- They now detach the claims from the person and strip everything personal,
-- then delete the rest. Receipt and scan photos can only be removed through
-- the Storage API, so their paths are returned for the calling edge function.

create or replace function public.erase_customer_rows(p_user_ids uuid[], p_ident_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  receipts text[];
  scans    text[];
  devices  text[];
  logins   uuid[];
  n_claims integer := 0;
  n_rows   integer := 0;
  n_idents integer := 0;
begin
  p_user_ids  := coalesce(p_user_ids, '{}');
  p_ident_ids := coalesce(p_ident_ids, '{}');

  select coalesce(array_agg(c.receipt_photo_path), '{}') into receipts
    from claims c where c.user_id = any(p_user_ids) and c.receipt_photo_path is not null;
  select coalesce(array_agg(s.photo_path), '{}') into scans
    from cup_scans s where s.user_id = any(p_user_ids) and s.photo_path is not null;
  select coalesce(array_agg(distinct u.device_id), '{}') into devices
    from users u where u.id = any(p_user_ids) and u.device_id is not null;
  select coalesce(array_agg(distinct a), '{}') into logins from (
    select u.auth_user_id a from users u where u.id = any(p_user_ids) and u.auth_user_id is not null
    union
    select ci.auth_user_id from customer_identities ci where ci.id = any(p_ident_ids) and ci.auth_user_id is not null
  ) s;

  -- A claim nobody reviewed yet can no longer be paid to anyone.
  update claims set
    user_id            = null,
    receipt_photo_path = null,
    receipt_photo_url  = null,
    ai_verdict         = null,
    iban               = null,
    tikkie_url         = null,
    notify_email       = false,
    notify_push        = false,
    approval_note      = case when status = 'pending' then 'Account deleted before review' else approval_note end,
    payout_status      = case when status = 'pending' then 'not_queued' else payout_status end,
    status             = case when status = 'pending' then 'failed' else status end
  where user_id = any(p_user_ids);
  get diagnostics n_claims = row_count;

  delete from activity_history where user_id = any(p_user_ids);
  delete from byo_cup_requests where user_id = any(p_user_ids) or identity_id = any(p_ident_ids);
  delete from client_events where user_id = any(p_user_ids);
  delete from pending_batches where user_id = any(p_user_ids);
  delete from merge_requests where survivor_user_id = any(p_user_ids) or absorbed_user_ids && p_user_ids;
  delete from store_requests where device_id = any(devices);
  update backup_cup_uses set device_id = null where device_id = any(devices);

  -- cup_balances and cup_scans cascade; cups and merge pointers are nulled.
  delete from users where id = any(p_user_ids);
  get diagnostics n_rows = row_count;
  -- payout_details cascades.
  delete from customer_identities where id = any(p_ident_ids);
  get diagnostics n_idents = row_count;

  return jsonb_build_object(
    'deleted_rows', n_rows,
    'deleted_identities', n_idents,
    'kept_claims', n_claims,
    'receipt_paths', to_jsonb(receipts),
    'scan_paths', to_jsonb(scans),
    'auth_user_ids', to_jsonb(logins)
  );
end
$$;
revoke execute on function public.erase_customer_rows(uuid[], uuid[]) from public, anon, authenticated;
grant execute on function public.erase_customer_rows(uuid[], uuid[]) to service_role;

-- Every row and identity connected to a set of rows, across the group's
-- stores. Bounded, like the expansion it replaces.
create or replace function public.connected_customer_rows(p_user_ids uuid[], p_auth uuid default null)
returns table(user_ids uuid[], ident_ids uuid[])
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  rows_now  uuid[] := coalesce(p_user_ids, '{}');
  rows_next uuid[];
  idents    uuid[];
  i integer;
begin
  for i in 1..6 loop
    select coalesce(array_agg(distinct u.identity_id), '{}') into idents
      from users u where u.id = any(rows_now) and u.identity_id is not null;
    select coalesce(array_agg(u.id), '{}') into rows_next
      from users u
     where (p_auth is null or u.auth_user_id is null or u.auth_user_id = p_auth)
       and (u.id = any(rows_now)
            or (p_auth is not null and u.auth_user_id = p_auth)
            or (idents <> '{}'::uuid[] and u.identity_id = any(idents)));
    exit when rows_next @> rows_now and rows_now @> rows_next;
    rows_now := rows_next;
  end loop;

  select coalesce(array_agg(distinct x), '{}') into idents from (
    select u.identity_id x from users u where u.id = any(rows_now) and u.identity_id is not null
    union
    select ci.id from customer_identities ci where p_auth is not null and ci.auth_user_id = p_auth
  ) s;

  return query select rows_now, idents;
end
$$;
revoke execute on function public.connected_customer_rows(uuid[], uuid) from public, anon, authenticated;

-- The customer's own deletion (delete-my-account, service role).
create or replace function public.purge_my_account(p_auth uuid, p_device text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  seed   uuid[];
  rows_  uuid[];
  idents uuid[];
begin
  if p_auth is null then
    raise exception 'no_auth';
  end if;
  select coalesce(array_agg(u.id), '{}') into seed
    from users u
   where u.auth_user_id = p_auth
      or (p_device is not null and u.device_id = p_device
          and (u.auth_user_id is null or u.auth_user_id = p_auth));
  select c.user_ids, c.ident_ids into rows_, idents
    from public.connected_customer_rows(seed, p_auth) c;
  return public.erase_customer_rows(rows_, idents);
end
$$;
revoke execute on function public.purge_my_account(uuid, text) from public, anon, authenticated;
grant execute on function public.purge_my_account(uuid, text) to service_role;

-- The dashboard's whole-account delete (admin-delete-user edge function).
create or replace function public.admin_purge_users(p_user_ids uuid[])
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  rows_  uuid[];
  idents uuid[];
begin
  if not public.is_staff_writer() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_user_ids is null or array_length(p_user_ids, 1) is null then
    return json_build_object('deleted_rows', 0, 'deleted_identities', 0);
  end if;
  select c.user_ids, c.ident_ids into rows_, idents
    from public.connected_customer_rows(p_user_ids, null) c;
  return public.erase_customer_rows(rows_, idents)::json;
end
$$;

-- The dashboard's per-store delete, plus claims, scans and donation records.
-- Deleting a customer row erases it the same way; an identity goes with it
-- only when no other row still uses it.
create or replace function public.admin_delete_records(p_table text, p_ids uuid[])
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer := 0;
  idents uuid[];
  result jsonb;
begin
  if not public.is_staff_writer() then
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
    select coalesce(array_agg(distinct u.identity_id), '{}') into idents
      from users u
     where u.id = any(p_ids) and u.identity_id is not null
       and not exists (select 1 from users o where o.identity_id = u.identity_id and not (o.id = any(p_ids)));
    result := public.erase_customer_rows(p_ids, idents);
    return (result || jsonb_build_object('deleted', result -> 'deleted_rows'))::json;
  else
    raise exception 'table_not_allowed: %', p_table using errcode = '42501';
  end if;

  return json_build_object('deleted', n);
end
$$;

-- ═════════════════════════════════════════════════════════════════════════
-- 10. The other dashboard functions: writers only
-- ═════════════════════════════════════════════════════════════════════════
-- They checked only for "any active dashboard account", which includes the
-- read-only vendor and checker roles.

create or replace function public.admin_delete_cup_batches(p_batch_ids uuid[])
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  n int := 0;
begin
  if not public.is_staff_writer() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_batch_ids is null or array_length(p_batch_ids, 1) is null then
    return json_build_object('deleted_cups', 0, 'batches', 0);
  end if;

  delete from public.cups where batch_id = any(p_batch_ids);
  get diagnostics n = row_count;

  return json_build_object('deleted_cups', n, 'batches', array_length(p_batch_ids, 1));
end
$$;

create or replace function public.admin_purge_org_records(p_org_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  n_scans int;
  n_claims int;
  n_transfers int;
begin
  if not public.is_staff_writer() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_org_id is null then
    raise exception 'org_id_required' using errcode = '22004';
  end if;

  delete from public.cup_scans where org_id = p_org_id;
  get diagnostics n_scans = row_count;

  delete from public.claims where org_id = p_org_id;
  get diagnostics n_claims = row_count;

  delete from public.donation_transfers where org_id = p_org_id;
  get diagnostics n_transfers = row_count;

  return json_build_object(
    'cup_scans', n_scans,
    'claims', n_claims,
    'cup_transfers', n_transfers
  );
end
$$;

create or replace function public.admin_merge_identities(p_survivor_user uuid, p_absorbed_users uuid[])
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_surv_ident uuid;
  v_abs_idents uuid[];
  v_org uuid;
  v_survivor_row uuid;
  v_absorbed_rows uuid[];
begin
  if not public.is_staff_writer() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select identity_id into v_surv_ident from users where id = p_survivor_user;

  -- Identities of the absorbed selections (excluding the survivor's own).
  select coalesce(array_agg(distinct identity_id), '{}')
    into v_abs_idents
    from users
    where id = any(p_absorbed_users) and identity_id is not null
      and identity_id is distinct from v_surv_ident;

  if v_surv_ident is not null then
    -- Move every row of the absorbed identities (all stores) onto the survivor
    -- identity, plus any explicitly-selected loose rows without an identity.
    if v_abs_idents <> '{}'::uuid[] then
      update users set identity_id = v_surv_ident where identity_id = any(v_abs_idents);
    end if;
    update users set identity_id = v_surv_ident where id = any(p_absorbed_users);

    -- Collapse duplicate per-store rows (sum balances, tombstone the losers).
    for v_org in
      select org_id from users
        where identity_id = v_surv_ident and merged_into is null and org_id is not null
        group by org_id having count(*) > 1
    loop
      select u.id into v_survivor_row
        from users u left join cup_balances b on b.user_id = u.id
        where u.identity_id = v_surv_ident and u.org_id = v_org and u.merged_into is null
        order by coalesce(b.lifetime_cups, 0) desc, u.updated_at desc limit 1;
      select coalesce(array_agg(u.id), '{}') into v_absorbed_rows
        from users u
        where u.identity_id = v_surv_ident and u.org_id = v_org and u.merged_into is null and u.id <> v_survivor_row;
      if v_absorbed_rows <> '{}'::uuid[] then
        perform merge_user_rows(v_survivor_row, v_absorbed_rows, true);
      end if;
    end loop;

    -- Remove now-orphaned absorbed identities.
    if v_abs_idents <> '{}'::uuid[] then
      delete from customer_identities ci
        where ci.id = any(v_abs_idents) and ci.id <> v_surv_ident
          and not exists (select 1 from users u where u.identity_id = ci.id);
    end if;
  else
    -- Survivor is a loose row with no identity: fall back to same-org row merges.
    for v_org in
      select org_id from users
        where id = any(array_append(p_absorbed_users, p_survivor_user)) and merged_into is null and org_id is not null
        group by org_id having count(*) > 1
    loop
      select coalesce(array_agg(u.id), '{}') into v_absorbed_rows
        from users u where u.id = any(p_absorbed_users) and u.org_id = v_org and u.merged_into is null;
      if v_absorbed_rows <> '{}'::uuid[] then
        perform merge_user_rows(p_survivor_user, v_absorbed_rows, true);
      end if;
    end loop;
  end if;

  return json_build_object('survivor_identity', v_surv_ident, 'absorbed_identities', to_jsonb(v_abs_idents));
end
$$;
