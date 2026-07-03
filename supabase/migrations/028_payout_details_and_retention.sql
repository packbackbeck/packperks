-- ──────────────────────────────────────────────────────────────────────
-- PackPerks — 028: IBAN consolidation + retention schedule
--
-- ⚠️ DEPLOY-PENDING / REVIEW FIRST. This migration was authored offline (the
-- Supabase CLI/MCP was not connected). Apply it against a BRANCH database,
-- run the customer + admin smoke tests, then promote. The `alter table …
-- drop column iban` statements at the end are commented out until the app is
-- reading from payout_details everywhere.
--
-- Implements audit items 3, 5, 6, 14, 15, 16, 27, 35:
--   • one restricted home for IBANs (payout_details)
--   • claims keep only iban_last4 + a payout reference (raw IBAN removed)
--   • IBAN deleted after the admin confirms that claim's payout
--   • retention jobs (receipts 90d, scans 90d, analytics 14mo, admin logs 12mo)
-- ──────────────────────────────────────────────────────────────────────

-- ── 3/16/35: one restricted IBAN table, reachable only by Edge Functions ──
create table if not exists public.payout_details (
  id           uuid primary key default gen_random_uuid(),
  identity_id  uuid unique references public.customer_identities(id) on delete cascade,
  iban         text,                       -- nullable: cleared after payout (item 6)
  iban_last4   text,                       -- kept for admin display + accounting
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.payout_details enable row level security;
-- No anon/authenticated policies at all → only the service_role (Edge
-- Functions save-payout / export-payouts / reveal-iban) can read or write it.

-- ── claims: stop carrying the raw IBAN; keep a reference + last4 ──
alter table public.claims add column if not exists payout_id  uuid references public.payout_details(id);
alter table public.claims add column if not exists iban_last4 text;

-- ── Backfill (run once, then verify before dropping the raw columns) ──
-- insert into public.payout_details (identity_id, iban, iban_last4)
--   select distinct on (u.identity_id) u.identity_id, u.iban,
--          right(regexp_replace(u.iban,'\s','','g'),4)
--   from public.users u
--   where u.identity_id is not null and coalesce(u.iban,'') <> ''
--   on conflict (identity_id) do nothing;
-- update public.claims c set iban_last4 = right(regexp_replace(c.iban,'\s','','g'),4)
--   where coalesce(c.iban,'') <> '' and c.iban_last4 is null;

-- ── After the app reads/writes payout_details everywhere, remove raw IBANs ──
-- alter table public.users               drop column if exists iban;
-- alter table public.customer_identities drop column if exists iban;
-- alter table public.claims              drop column if exists iban;

-- ── 6: helper the payout Edge Function calls after confirming a payout.
-- Deletes the raw IBAN but KEEPS the claim record (amount/date/status/last4).
create or replace function public.confirm_payout_and_purge_iban(p_claim_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_identity uuid;
begin
  update public.claims set status = 'paid', paid_at = now() where id = p_claim_id;
  select u.identity_id into v_identity
    from public.claims c join public.users u on u.id = c.user_id
    where c.id = p_claim_id;
  -- Purge the raw IBAN only if no OTHER unpaid claim still needs it.
  if v_identity is not null and not exists (
      select 1 from public.claims c2 join public.users u2 on u2.id = c2.user_id
      where u2.identity_id = v_identity and c2.status not in ('paid','failed','denied')
  ) then
    update public.payout_details set iban = null, updated_at = now() where identity_id = v_identity;
  end if;
end $$;
revoke all on function public.confirm_payout_and_purge_iban(uuid) from public, anon, authenticated;

-- ── 14/15/16/27: retention jobs (pg_cron). Requires the pg_cron extension. ──
-- create extension if not exists pg_cron;

-- Receipt images: delete 90 days after the claim is resolved.
-- select cron.schedule('purge-receipt-images','0 3 * * *', $$
--   -- delete storage objects for claims resolved > 90 days ago
--   with old as (
--     select receipt_photo_path from public.claims
--     where status in ('completed','failed','denied','paid')
--       and coalesce(verified_at, updated_at) < now() - interval '90 days'
--       and receipt_photo_path is not null)
--   delete from storage.objects o using old
--   where o.bucket_id = 'receipts' and o.name = old.receipt_photo_path;
-- $$);

-- Cup-scan images: delete 90 days after the scan.
-- select cron.schedule('purge-scan-images','15 3 * * *', $$
--   delete from storage.objects
--   where bucket_id = 'cup-scans' and created_at < now() - interval '90 days';
-- $$);

-- Behavioural analytics: delete after 14 months.
-- select cron.schedule('purge-client-events','30 3 * * *', $$
--   delete from public.client_events where created_at < now() - interval '14 months';
-- $$);

-- Admin audit + login logs: delete after 12 months.
-- select cron.schedule('purge-admin-logs','45 3 * * *', $$
--   delete from public.admin_audit_log  where created_at < now() - interval '12 months';
--   delete from public.admin_login_log  where created_at < now() - interval '12 months';
-- $$);

-- Inactive accounts: 24 months no activity → cascade delete (best-effort).
-- select cron.schedule('purge-inactive-accounts','0 4 * * 0', $$
--   -- delete users (and cascade balances/activity/claims via FKs) whose most
--   -- recent activity_history row is older than 24 months.
--   delete from public.users u where not exists (
--     select 1 from public.activity_history a
--     where a.user_id = u.id and a.created_at > now() - interval '24 months');
-- $$);

-- See docs/RETENTION_SCHEDULE.md for the human-readable schedule.
