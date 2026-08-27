-- Backup cups — the offline fallback for a Redirect Refund smart bin.
--
-- The bin always prints a receipt, even when it can't reach us. In that
-- case it can't be handed a freshly-minted batch, so it falls back to a
-- short list of RESERVED cup ids burned into its own config. Those ids are
-- permanently scannable and, unlike a normal batch, mint a NEW Tikkie link
-- on every scan — they have to, because the same ten ids are handed to
-- many different customers over time.
--
-- That reusability is also the risk: a backup cup is, by construction, a
-- QR that keeps paying. Hence the cooldown + daily cap enforced in
-- bin-tikkie, the use log below, and the alert on every single use.
create table if not exists public.backup_cups (
  id          uuid primary key,          -- the cup uuid the bin prints
  org_id      uuid not null references public.organizations(id) on delete cascade,
  label       text not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create index if not exists idx_backup_cups_org on public.backup_cups (org_id, label);

-- One row per scan of a backup cup. This is the evidence trail: it is the
-- only way to know the bin was offline, and how much that cost.
create table if not exists public.backup_cup_uses (
  id             uuid primary key default gen_random_uuid(),
  backup_cup_id  uuid not null references public.backup_cups(id) on delete cascade,
  org_id         uuid references public.organizations(id) on delete set null,
  claim_id       uuid,                   -- the payout this scan created
  amount_eur     numeric,
  cups_in_scan   integer,                -- a QR may carry several backup cups
  used_at        timestamptz not null default now()
);

create index if not exists idx_backup_uses_org  on public.backup_cup_uses (org_id, used_at desc);
create index if not exists idx_backup_uses_cup  on public.backup_cup_uses (backup_cup_id, used_at desc);

alter table public.backup_cups     enable row level security;
alter table public.backup_cup_uses enable row level security;

-- Admin-read only. The customer app never touches these tables directly —
-- bin-tikkie resolves them with the service key.
drop policy if exists "backup_cups: admins read" on public.backup_cups;
create policy "backup_cups: admins read" on public.backup_cups
  for select using ((current_admin()).id is not null);

drop policy if exists "backup_cup_uses: admins read" on public.backup_cup_uses;
create policy "backup_cup_uses: admins read" on public.backup_cup_uses
  for select using ((current_admin()).id is not null);

-- Seed the ten reserved ids for Titaan 3 (t3), the Redirect Refund org.
insert into public.backup_cups (id, org_id, label) values
  ('137994e7-6f6d-45fe-b201-d0b5d43a1779', 'da6f18cc-7493-4547-b54e-4987de2606b4', 'Backup 01'),
  ('e2d122cf-110d-4c5a-b782-3c2287503fb4', 'da6f18cc-7493-4547-b54e-4987de2606b4', 'Backup 02'),
  ('d3f59280-274d-4c70-a7d5-7cb90a5fcd2b', 'da6f18cc-7493-4547-b54e-4987de2606b4', 'Backup 03'),
  ('68af7461-10fa-48a7-bf41-c4da9390a59a', 'da6f18cc-7493-4547-b54e-4987de2606b4', 'Backup 04'),
  ('b1a26d53-b154-4f62-a8e7-e10ba5552b8f', 'da6f18cc-7493-4547-b54e-4987de2606b4', 'Backup 05'),
  ('ffd3231a-83aa-4804-8a50-d41412fd9927', 'da6f18cc-7493-4547-b54e-4987de2606b4', 'Backup 06'),
  ('72b9a10d-1296-4cde-97af-2ed1be54c21b', 'da6f18cc-7493-4547-b54e-4987de2606b4', 'Backup 07'),
  ('41235284-fe6d-460c-a09c-ca8452e708c4', 'da6f18cc-7493-4547-b54e-4987de2606b4', 'Backup 08'),
  ('d840400d-2d42-4491-9190-474ed7c2c4e4', 'da6f18cc-7493-4547-b54e-4987de2606b4', 'Backup 09'),
  ('e0a88bad-f30b-47df-b2da-f71e206c3c6d', 'da6f18cc-7493-4547-b54e-4987de2606b4', 'Backup 10')
on conflict (id) do nothing;

-- The Backup Cups page switches the whole set off (and back on) via the
-- `active` column, which bin-tikkie already refuses on. Reading was
-- admin-only; writing must be too.
drop policy if exists "backup_cups: admins update" on public.backup_cups;
create policy "backup_cups: admins update" on public.backup_cups
  for update using ((current_admin()).id is not null)
  with check ((current_admin()).id is not null);
