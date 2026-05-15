-- ─────────────────────────────────────────────────────────────────────
-- PackPerks — donation transfer tracking.
--
-- Customers donate cups via the "Donate" flow, which writes a claim
-- with type='direct_refund' but with the donation recipient as the
-- destination. The cash that those donation claims represent is still
-- in the programme's account until an admin actually wires it to the
-- partner charity.
--
-- This table records each outgoing transfer: when it happened, how
-- much, the bank reference, and a receipt photo / PDF (uploaded to
-- the `donation-receipts` storage bucket).
--
-- The admin Donations page rolls these up alongside the sum of cups
-- donated to surface "we've collected €X, transferred €Y, owe the
-- charity €X-Y".
-- ─────────────────────────────────────────────────────────────────────

create table if not exists donation_transfers (
  id              uuid primary key default gen_random_uuid(),
  amount_eur      numeric(10, 2) not null check (amount_eur > 0),
  transfer_date   date not null,
  recipient       text not null,
  reference       text,
  note            text,
  receipt_path    text,
  receipt_filename text,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists idx_donation_transfers_date on donation_transfers(transfer_date desc);

alter table donation_transfers enable row level security;

drop policy if exists "donation_transfers: authed read"   on donation_transfers;
drop policy if exists "donation_transfers: authed write"  on donation_transfers;
drop policy if exists "donation_transfers: authed update" on donation_transfers;

create policy "donation_transfers: authed read"
  on donation_transfers for select to authenticated using (true);

create policy "donation_transfers: authed write"
  on donation_transfers for insert to authenticated with check (true);

create policy "donation_transfers: authed update"
  on donation_transfers for update to authenticated using (true);

insert into storage.buckets (id, name, public)
values ('donation-receipts', 'donation-receipts', false)
on conflict (id) do update set public = false;

drop policy if exists "donation-receipts: authed read"   on storage.objects;
drop policy if exists "donation-receipts: authed write"  on storage.objects;

create policy "donation-receipts: authed read"
  on storage.objects for select to authenticated
  using (bucket_id = 'donation-receipts');

create policy "donation-receipts: authed write"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'donation-receipts');
