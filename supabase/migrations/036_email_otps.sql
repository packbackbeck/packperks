-- Redirect Refund login: one-time email codes.
--
-- Two uses, both via bin-tikkie:
--   • purpose 'login'  — "Already have an account? Log in" on the redirect
--     page: prove the email, get your refund account back on this device.
--   • purpose 'attach' — "save for later" hit an email that already has an
--     account on a DIFFERENT device: the code proves the saver owns it
--     before the refund is attached.
-- Service-role only (no policies): codes are written and checked entirely
-- inside the edge function; the client never reads this table.
create table if not exists public.email_otps (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  email       text not null,
  code_hash   text not null,
  purpose     text not null default 'login',
  batch_id    uuid,             -- the receipt being saved (attach flow)
  device_id   text,             -- the device that asked
  attempts    int  not null default 0,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_email_otps_lookup
  on public.email_otps (org_id, email, created_at desc);

alter table public.email_otps enable row level security;
