-- Smart-bin mint sessions.
--
-- The bin opens a session per customer, counts the cups they deposit, then
-- asks the server for a batch and prints its QR. If the HTTP response is
-- lost (flaky wifi in a venue is normal) the bin retries — and without a
-- dedupe key that retry mints a SECOND batch, so the same physical cups
-- get paid out twice.
--
-- This table is the idempotency ledger: one row per (machine, session).
-- A retry with the same session_id returns the batch that already exists
-- instead of minting a new one.
create table if not exists public.bin_sessions (
  id          uuid primary key default gen_random_uuid(),
  machine_id  text not null,
  session_id  text not null,
  org_id      uuid references public.organizations(id) on delete set null,
  batch_id    uuid not null,
  cups        integer not null,
  amount_eur  numeric,
  created_at  timestamptz not null default now(),
  unique (machine_id, session_id)
);

create index if not exists idx_bin_sessions_batch on public.bin_sessions (batch_id);
create index if not exists idx_bin_sessions_org   on public.bin_sessions (org_id, created_at desc);

-- Service-role only: the bin authenticates with its X-Bin-Key header and the
-- edge function uses the service key. No customer or anon access, ever.
alter table public.bin_sessions enable row level security;

-- Admins (dashboard) may read for the payout log / audit.
drop policy if exists "bin_sessions: admins read" on public.bin_sessions;
create policy "bin_sessions: admins read" on public.bin_sessions
  for select using ((current_admin()).id is not null);
