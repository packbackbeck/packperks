-- Redirect Refund: print-first bin flow.
--
-- The bin now prints the QR IMMEDIATELY, built from its own session UUID
-- (?batch=<session-uuid>), and notifies us in parallel. Usually our copy
-- of the session arrives before the customer scans. When it doesn't (the
-- bin was offline), the customer lands on a batch we have never heard of.
--
-- pending_batches records that moment: the scan of a not-yet-validated
-- batch, plus the email the customer may leave so we can tell them when
-- their link is ready. When the bin finally delivers the session,
-- bin-mint-batch resolves the row — mints the payout, emails the link,
-- and attaches it to the account we created for them.
create table if not exists public.pending_batches (
  batch_id     uuid primary key,          -- the session uuid the bin printed
  org_id       uuid references public.organizations(id) on delete cascade,
  email        text,
  marketing_consent boolean not null default false,
  user_id      uuid,                      -- account created for the email
  first_seen   timestamptz not null default now(),
  resolved_at  timestamptz,               -- when the bin's session arrived
  notified_at  timestamptz                -- when we emailed the ready link
);

create index if not exists idx_pending_batches_org on public.pending_batches (org_id, first_seen desc);

alter table public.pending_batches enable row level security;

-- Service-role only from the customer side (bin-tikkie writes it); admins
-- may read for the dashboard.
drop policy if exists "pending_batches: admins read" on public.pending_batches;
create policy "pending_batches: admins read" on public.pending_batches
  for select using ((current_admin()).id is not null);

-- Backup-cup uses now record which device scanned, so the per-device
-- daily limit has something to count.
alter table public.backup_cup_uses add column if not exists device_id text;
create index if not exists idx_backup_uses_device on public.backup_cup_uses (device_id, used_at desc);
