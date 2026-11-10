-- 072 — Automatic cashout pays only to a verified email.
--
-- The link goes by email, so a typo would send someone's money to a
-- stranger. A tier is therefore saved only once the wallet's address is
-- proven: by a Google login with that address, or by a 6-digit code sent to
-- it. The proven address is kept on the schedule (`verified_email`), and the
-- run pays only while the wallet's email is still that address; change the
-- email and payouts wait until the new one is confirmed.
--
-- Codes live in their own table, like the schedules: service role only.

alter table public.auto_cashouts
  add column if not exists verified_email text;

comment on column public.auto_cashouts.verified_email is
  'The address proven when the schedule was saved (Google or a 6-digit code). The run pays only while users.email still equals it.';

create table if not exists public.auto_cashout_codes (
  user_id    uuid primary key references public.users(id) on delete cascade,
  email      text not null,
  tier       text not null check (tier in ('week', 'month', 'quarter')),
  code_hash  text not null,
  attempts   integer not null default 0,
  sent_at    timestamptz not null default now(),
  expires_at timestamptz not null
);

comment on table public.auto_cashout_codes is
  'The pending 6-digit code that confirms a wallet email before an automatic-cashout tier is saved. Written only by the auto-cashout function.';

alter table public.auto_cashout_codes enable row level security;
-- No policies: no client role reads or writes it.
