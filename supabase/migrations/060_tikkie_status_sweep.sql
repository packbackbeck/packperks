-- 060 — keeping Tikkie link statuses true.
--
-- A Tikkie link's real state lives at ABN AMRO: CREATED, REDEEMED (with the
-- moment it was collected) or EXPIRED. Two things write it onto the claim:
--
--   • tikkie-webhook, once the redemption subscription is registered
--     (Tikkie payouts → Status updates → Connect, which calls
--     tikkie-cashback action `subscribe`). It fires within seconds.
--   • tikkie-sweep, the safety net: every 15 minutes it asks Tikkie about
--     the links we still think are open, oldest check first. It also
--     backfills the links minted before the subscription existed, and the
--     dashboard's "Check open links" button calls the same function.
--
-- `tikkie_checked_at` is when we last asked Tikkie about that link, so the
-- dashboard can say how fresh a status is and the sweep knows where to
-- carry on.

alter table public.claims add column if not exists tikkie_checked_at timestamptz;

comment on column public.claims.tikkie_checked_at is
  'When Tikkie was last asked about this link (tikkie-sweep / tikkie-webhook / the Claims page refresh).';

-- The sweep's working set: links that exist and are not finished yet,
-- oldest check first.
create index if not exists claims_tikkie_open_checked
  on public.claims (tikkie_checked_at nulls first)
  where tikkie_cashback_id is not null
    and (tikkie_status is null or tikkie_status in ('created', 'minting'));

-- The cron caller's shared secret, the same shape as digest_cron.
insert into public.app_config (key, value)
values ('tikkie_sweep_cron', jsonb_build_object('secret', encode(extensions.gen_random_bytes(24), 'hex')))
on conflict (key) do nothing;

-- Every 15 minutes. The function itself does nothing when there is nothing
-- open, so a quiet venue costs one no-op call.
select cron.unschedule('tikkie-status-sweep') where exists (select 1 from cron.job where jobname = 'tikkie-status-sweep');
select cron.schedule('tikkie-status-sweep', '*/15 * * * *', $cron$
  select net.http_post(
    url     := 'https://ozvcpbthnauitaphosfb.supabase.co/functions/v1/tikkie-sweep',
    headers := jsonb_build_object(
      'content-type',   'application/json',
      'x-sweep-secret', (select value->>'secret' from public.app_config where key = 'tikkie_sweep_cron')
    ),
    body    := jsonb_build_object('mode', 'scheduled')
  );
$cron$);
