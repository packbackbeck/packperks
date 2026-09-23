-- ─────────────────────────────────────────────────────────────────────
-- 063 — a deadline on the money and the rewards we owe.
--
-- Until now nothing said when an uncollected refund or reward stops being
-- claimable, so "how much do we still owe?" had no definitive answer: a
-- Tikkie link from July and one from yesterday both counted as open
-- forever. Two settings (Settings → Rules & limits → When unclaimed money
-- expires) give each venue a window, and this column stamps the deadline
-- on every claim as it is created:
--
--   settings.payoutExpiryMonths — cashback, refunds and wallet payouts
--   settings.rewardExpiryMonths — a claim against a reward (reward_id)
--
-- Three months unless a venue says otherwise; 0 means never.
--
-- What it does and does not do. `expires_at` is OUR deadline: past it the
-- app stops offering the link, the claim cards drop it, and the reporting
-- counts the money as never claimed. It is NOT enforcement at ABN AMRO —
-- a Tikkie link cannot be cancelled (see CLAUDE.md), and its own
-- expiryDateTime is the campaign's end date, the same instant for every
-- link the campaign ever mints. So someone still holding the URL can
-- collect until the campaign ends; our deadline is the point from which we
-- stop counting on it. Keep the window shorter than the campaign's end and
-- the two agree.
--
-- Donations and wallet change are never claimable by a customer, so they
-- get no deadline.
-- ─────────────────────────────────────────────────────────────────────

alter table public.claims add column if not exists expires_at timestamptz;

comment on column public.claims.expires_at is
  'Our deadline for collecting this claim (Settings → Rules & limits). Past it the app offers nothing and the money counts as never claimed. Not the same as tikkie_expires_at, which is the Tikkie campaign end date.';

-- The reporting set: claims with a deadline that nobody has collected.
create index if not exists claims_expires_at_open
  on public.claims (expires_at)
  where expires_at is not null and tikkie_redeemed_at is null;

/* The window for one claim, in months, from the venue's published
 * settings. A claim against a reward uses the reward window; money out
 * (cashback, refund, wallet payout) uses the payout window. */
create or replace function public.claim_expiry_months(p_org uuid, p_is_reward boolean)
returns numeric
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    nullif(
      (select c.value -> 'settings' ->> (case when p_is_reward then 'rewardExpiryMonths' else 'payoutExpiryMonths' end)
         from app_config c where c.key = 'published:' || p_org::text),
      ''
    )::numeric,
    3
  )
$$;

create or replace function public.claims_set_expiry()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_months numeric;
begin
  -- An explicit deadline (a backfill, or a future admin override) wins.
  if new.expires_at is not null then
    return new;
  end if;
  -- Bookkeeping rows are not claimable, so they never expire.
  if new.type in ('donation', 'wallet_change') then
    return new;
  end if;
  if new.org_id is null then
    return new;
  end if;

  v_months := public.claim_expiry_months(new.org_id, new.reward_id is not null);
  if v_months is null or v_months <= 0 then
    return new;                                   -- 0 = never expires
  end if;
  new.expires_at := coalesce(new.created_at, now()) + (v_months::text || ' months')::interval;
  return new;
end
$$;

-- After trg_set_org (which fills org_id from the user) and before the
-- budget guard: triggers on one event fire in name order.
drop trigger if exists trg_u_claims_set_expiry on public.claims;
create trigger trg_u_claims_set_expiry
  before insert on public.claims
  for each row execute function public.claims_set_expiry();

-- Backfill, so the question has an answer for the rows already there. The
-- oldest live Tikkie link was minted 8 Jul 2026, so at three months
-- nothing that is currently collectable is retro-expired.
update public.claims c
   set expires_at = c.created_at
       + (public.claim_expiry_months(c.org_id, c.reward_id is not null)::text || ' months')::interval
 where c.expires_at is null
   and c.org_id is not null
   and c.type not in ('donation', 'wallet_change')
   and public.claim_expiry_months(c.org_id, c.reward_id is not null) > 0;

/* The customer's own claims, now carrying the deadline so the app can
 * stop offering a link it knows is past it. Same trust model as before:
 * the rows this device's account owns. The signature gains a column, so
 * the old one has to go first; the grants go back on by hand. */
drop function if exists public.get_customer_claims(uuid[]);

create function public.get_customer_claims(p_user_ids uuid[])
returns table (
  id uuid, user_id uuid, type text, reward_id text, cups_redeemed integer,
  payout_amount numeric, status text, payout_status text,
  tikkie_url text, tikkie_status text, tikkie_expires_at timestamptz, tikkie_redeemed_at timestamptz,
  expires_at timestamptz,
  notify_email boolean, notify_push boolean, flagged boolean,
  created_at timestamptz, verified_at timestamptz, approved_at timestamptz,
  ai_failure_checks text[], admin_failure_checks text[]
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select c.id, c.user_id, c.type, c.reward_id, c.cups_redeemed, c.payout_amount,
         c.status, c.payout_status,
         c.tikkie_url, c.tikkie_status, c.tikkie_expires_at, c.tikkie_redeemed_at,
         c.expires_at,
         c.notify_email, c.notify_push,
         c.flagged, c.created_at, c.verified_at, c.approved_at,
         c.ai_failure_checks, c.admin_failure_checks
  from public.claims c
  where c.user_id = any(p_user_ids)
    and c.user_id = any(public.request_user_ids())
  order by c.created_at desc
$$;

grant execute on function public.get_customer_claims(uuid[]) to anon, authenticated, service_role;
