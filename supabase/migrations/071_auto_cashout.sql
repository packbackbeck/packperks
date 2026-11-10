-- 071 — Automatic cashout, for the Deferred Refund way out.
--
-- A customer on a Deferred Refund wallet can pick how often their balance
-- is paid out without asking: every week, every month or every 3 months
-- (or never, the slider's zero, which keeps the manual Claim deposit). On
-- the day, the auto-cashout edge function sweeps the wallet into one payout
-- exactly as Collect does, adds the venue's bonus for that tier, mints one
-- Tikkie link and emails it. The venue switches the feature and its bonus
-- on in Settings (published settings `autoCashout`, `autoCashoutBonus`,
-- `autoCashoutBonusPct`), so the amounts always come from the venue's
-- config and never from the request.
--
-- The schedule lives in its OWN table, not on `users`: a customer can
-- update their own `users` row (Stage 2), and a customer who could move
-- their own next date to "now" could collect the bonus every hour. Nobody
-- but the service role writes here: the auto-cashout function, for the
-- customer's choice (tied to the device that owns the wallet) and the run.

create table if not exists public.auto_cashouts (
  user_id       uuid primary key references public.users(id) on delete cascade,
  org_id        uuid not null references public.organizations(id) on delete cascade,
  tier          text not null check (tier in ('week', 'month', 'quarter')),
  started_at    timestamptz not null default now(),
  next_at       timestamptz not null,
  last_run_at   timestamptz,
  last_claim_id uuid references public.claims(id) on delete set null,
  last_error    text,
  updated_at    timestamptz not null default now()
);

comment on table public.auto_cashouts is
  'Automatic cashout schedules (Deferred Refund). One row per customer who chose a tier; written only by the auto-cashout function with the service role.';

create index if not exists auto_cashouts_due on public.auto_cashouts (next_at);
create index if not exists auto_cashouts_org on public.auto_cashouts (org_id);

alter table public.auto_cashouts enable row level security;

-- Dashboard accounts may read (reporting); no client role may write.
drop policy if exists "auto_cashouts: staff read" on public.auto_cashouts;
create policy "auto_cashouts: staff read" on public.auto_cashouts
  for select to authenticated using ((public.current_admin()).id is not null);

-- What an automatic payout was: the tier it ran for and the bonus on top.
-- payout_amount stays the total that left (deposit + bonus), so every
-- existing report keeps adding up; bonus_amount says how much of it was
-- the bonus.
alter table public.claims
  add column if not exists auto_cashout_tier text,
  add column if not exists bonus_pct numeric(5, 2),
  add column if not exists bonus_amount numeric(10, 2);

comment on column public.claims.auto_cashout_tier is 'Set on a payout made by automatic cashout: week, month or quarter.';
comment on column public.claims.bonus_amount is 'The part of payout_amount that was the automatic-cashout bonus.';

-- A customer may not rewrite the payout ledger: the new columns join the
-- locked list.
create or replace function public.claims_guard_client_update()
returns trigger
language plpgsql
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
  or new.auto_cashout_tier  is distinct from old.auto_cashout_tier
  or new.bonus_pct          is distinct from old.bonus_pct
  or new.bonus_amount       is distinct from old.bonus_amount
  then
    raise exception 'claim_field_locked' using errcode = '42501';
  end if;
  return new;
end
$$;

-- The cron caller's shared secret, the same shape as tikkie_sweep_cron.
insert into public.app_config (key, value)
values ('auto_cashout_cron', jsonb_build_object('secret', encode(extensions.gen_random_bytes(24), 'hex')))
on conflict (key) do nothing;

-- Every hour. A schedule is due from its next_at, so a payout leaves within
-- the hour of its day; with nothing due the function is one empty query.
select cron.unschedule('auto-cashout') where exists (select 1 from cron.job where jobname = 'auto-cashout');
select cron.schedule('auto-cashout', '23 * * * *', $cron$
  select net.http_post(
    url     := 'https://ozvcpbthnauitaphosfb.supabase.co/functions/v1/auto-cashout',
    headers := jsonb_build_object(
      'content-type',  'application/json',
      'x-cron-secret', (select value->>'secret' from public.app_config where key = 'auto_cashout_cron')
    ),
    body    := jsonb_build_object('mode', 'scheduled'),
    timeout_milliseconds := 60000
  );
$cron$);
