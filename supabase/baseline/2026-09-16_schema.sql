-- PackPerks — database schema baseline, 16 September 2026
--
-- Generated from the live database's catalog (project ozvcpbthnauitaphosfb)
-- after migration 045. It is the whole `public` schema: tables, keys,
-- indexes, functions and who may call them, triggers, table privileges,
-- row-level security and policies (public and storage), storage buckets and
-- the pg_cron jobs.
--
-- Why it exists: the database has had far more changes applied than the
-- repo's migrations/ folder records (84 applied against 41 files, eight
-- tables with no migration at all), so replaying migrations/ cannot rebuild
-- it. To stand up a copy, run this file on a fresh Supabase project, then
-- any migration numbered above 045, then supabase/pending/ once its
-- conditions are met. From now on every change goes in as a numbered file.
--
-- Not included: data (app_config rows, organisations…), auth settings, edge
-- function secrets (see docs/HANDOFF.md), and the Supabase-managed schemas.
-- Regenerate with the snapshot query described in supabase/baseline/README.md.

-- Functions are created in name order and some call ones defined later.
set check_function_bodies = off;

-- ── Extensions ──
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_stat_statements with schema extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists supabase_vault with schema vault;
create extension if not exists "uuid-ossp" with schema extensions;

-- ── Tables ──
create table if not exists public.activity_history (
  id uuid default gen_random_uuid() not null,
  user_id uuid,
  type text,
  label text,
  created_at timestamp with time zone default now(),
  org_id uuid
);

create table if not exists public.admin_action_log (
  id uuid default gen_random_uuid() not null,
  actor_id uuid,
  actor_email text,
  org_id uuid,
  action text not null,
  target_type text,
  target_id text,
  before_state jsonb,
  after_state jsonb,
  metadata jsonb,
  ip text,
  user_agent text,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.admin_invitations (
  id uuid default gen_random_uuid() not null,
  org_id uuid,
  email text not null,
  role text not null,
  token text not null,
  invited_by uuid,
  invited_at timestamp with time zone default now() not null,
  expires_at timestamp with time zone default (now() + '14 days'::interval) not null,
  accepted_at timestamp with time zone,
  status text default 'pending'::text not null,
  single_use boolean default true not null,
  method text default 'email'::text not null
);

create table if not exists public.admin_login_history (
  id uuid default gen_random_uuid() not null,
  admin_id uuid not null,
  logged_in_at timestamp with time zone default now() not null,
  ip text,
  user_agent text,
  provider text,
  org_id uuid
);

create table if not exists public.admin_profiles (
  id uuid not null,
  org_id uuid,
  email text not null,
  display_name text,
  avatar_url text,
  color text default '#E24400'::text,
  role text default 'checker'::text not null,
  status text default 'active'::text not null,
  location_ids uuid[] default '{}'::uuid[],
  invited_by uuid,
  last_login_at timestamp with time zone,
  last_login_ip text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  is_packperks_staff boolean default false not null
);

create table if not exists public.app_config (
  key text not null,
  value jsonb not null,
  updated_at timestamp with time zone default now()
);

create table if not exists public.backup_cup_uses (
  id uuid default gen_random_uuid() not null,
  backup_cup_id uuid not null,
  org_id uuid,
  claim_id uuid,
  amount_eur numeric,
  cups_in_scan integer,
  used_at timestamp with time zone default now() not null,
  device_id text
);

create table if not exists public.backup_cups (
  id uuid not null,
  org_id uuid not null,
  label text not null,
  active boolean default true not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.bin_sessions (
  id uuid default gen_random_uuid() not null,
  machine_id text not null,
  session_id text not null,
  org_id uuid,
  batch_id uuid not null,
  cups integer not null,
  amount_eur numeric,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.byo_cup_requests (
  id uuid default gen_random_uuid() not null,
  org_id uuid,
  user_id uuid,
  identity_id uuid,
  cups integer default 1 not null,
  status text default 'pending'::text not null,
  device_id text,
  note text,
  created_at timestamp with time zone default now() not null,
  decided_at timestamp with time zone,
  decided_by uuid,
  location_id uuid
);

create table if not exists public.claims (
  id uuid default gen_random_uuid() not null,
  user_id uuid,
  type text,
  reward_id text,
  cups_redeemed integer,
  payout_amount numeric(10,2),
  iban text,
  status text default 'pending'::text,
  created_at timestamp with time zone default now(),
  paid_at timestamp with time zone,
  receipt_photo_url text,
  receipt_photo_path text,
  ai_verdict jsonb,
  ai_confidence numeric,
  ai_is_burger_king boolean,
  ai_reason text,
  extracted_total_eur numeric,
  extracted_datetime timestamp with time zone,
  extracted_receipt_id text,
  verified_at timestamp with time zone,
  ai_is_receipt boolean,
  ai_contains_required_item boolean,
  ai_failure_checks text[],
  ai_required_item text,
  approved_by uuid,
  approved_at timestamp with time zone,
  approval_note text,
  payout_status text,
  org_id uuid,
  image_hidden boolean default false not null,
  image_hidden_reason text,
  image_hidden_at timestamp with time zone,
  image_hidden_by uuid,
  payout_id uuid,
  iban_last4 text,
  tikkie_url text,
  tikkie_status text,
  notify_email boolean default false not null,
  notify_push boolean default false not null,
  notified_at timestamp with time zone,
  flagged boolean default false not null,
  tikkie_cashback_id text,
  tikkie_expires_at timestamp with time zone,
  tikkie_redeemed_at timestamp with time zone,
  tikkie_last_error text,
  tikkie_last_error_at timestamp with time zone,
  admin_failure_checks text[],
  batch_id uuid,
  payout_claim_id uuid
);

create table if not exists public.client_events (
  id uuid default gen_random_uuid() not null,
  org_id uuid,
  session_id text,
  user_id uuid,
  event text not null,
  props jsonb,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.consent_rejections (
  id uuid default gen_random_uuid() not null,
  org_id uuid,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.cup_balances (
  id uuid default gen_random_uuid() not null,
  user_id uuid,
  balance integer default 0,
  lifetime_cups integer default 0,
  updated_at timestamp with time zone default now(),
  org_id uuid
);

create table if not exists public.cup_scans (
  id uuid default gen_random_uuid() not null,
  user_id uuid,
  photo_url text,
  cups_awarded integer default 1,
  ocr_confidence double precision,
  status text default 'approved'::text,
  scanned_at timestamp with time zone default now(),
  scan_type text,
  source text,
  batch_id uuid,
  requested_cup_ids text[],
  activated_cup_ids text[],
  error_code text,
  error_message text,
  photo_path text,
  org_id uuid,
  location_id uuid
);

create table if not exists public.cups (
  id uuid default gen_random_uuid() not null,
  batch_id uuid,
  source text default 'admin_batch'::text not null,
  status text default 'available'::text not null,
  shared_by_user_id uuid,
  activated_by_user_id uuid,
  activated_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  expires_at timestamp with time zone,
  revoked_at timestamp with time zone,
  revoked_reason text,
  org_id uuid
);

create table if not exists public.customer_identities (
  id uuid default gen_random_uuid() not null,
  auth_user_id uuid,
  display_name text,
  animal_index integer default 0,
  email text,
  email_verified boolean default false,
  email_verified_at timestamp with time zone,
  iban text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  entry_org_id uuid,
  marketing_consent boolean default false not null,
  marketing_consent_at timestamp with time zone
);

create table if not exists public.donation_transfers (
  id uuid default gen_random_uuid() not null,
  amount_eur numeric(10,2) not null,
  transfer_date date not null,
  recipient text not null,
  reference text,
  note text,
  receipt_path text,
  receipt_filename text,
  created_by uuid,
  created_at timestamp with time zone default now() not null,
  org_id uuid
);

create table if not exists public.email_otps (
  id uuid default gen_random_uuid() not null,
  org_id uuid not null,
  email text not null,
  code_hash text not null,
  purpose text default 'login'::text not null,
  batch_id uuid,
  device_id text,
  attempts integer default 0 not null,
  expires_at timestamp with time zone not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.generated_receipts (
  id uuid default gen_random_uuid() not null,
  org_id uuid,
  token text not null,
  items jsonb default '[]'::jsonb not null,
  total numeric,
  receipt_date timestamp with time zone,
  venue text,
  created_by uuid,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.locations (
  id uuid default gen_random_uuid() not null,
  org_id uuid not null,
  name text not null,
  address text,
  postal_code text,
  city text,
  country text default 'NL'::text,
  lat numeric,
  lng numeric,
  opening_hours jsonb,
  phone text,
  status text default 'active'::text not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.merge_requests (
  id uuid default gen_random_uuid() not null,
  org_id uuid,
  survivor_user_id uuid,
  absorbed_user_ids uuid[] default '{}'::uuid[] not null,
  email text,
  device_id text,
  source text,
  status text default 'pending'::text not null,
  reason text,
  merged_balance integer,
  merged_lifetime integer,
  requested_at timestamp with time zone default now() not null,
  decided_at timestamp with time zone,
  decided_by uuid,
  decided_note text
);

create table if not exists public.mockups (
  id uuid default gen_random_uuid() not null,
  name text not null,
  config jsonb default '{}'::jsonb not null,
  created_by uuid default auth.uid(),
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  thumb text
);

create table if not exists public.org_groups (
  id uuid default gen_random_uuid() not null,
  name text not null,
  slug text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.org_reward_budgets (
  org_id uuid not null,
  cap_eur numeric default 200 not null,
  enabled boolean default true not null,
  updated_at timestamp with time zone default now() not null,
  updated_by uuid
);

create table if not exists public.organizations (
  id uuid default gen_random_uuid() not null,
  name text not null,
  legal_name text,
  kvk_number text,
  btw_number text,
  address text,
  postal_code text,
  city text,
  country text default 'NL'::text,
  contact_email text,
  contact_phone text,
  website text,
  logo_url text,
  brand_color text default '#E24400'::text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  slug text not null,
  partner_brand_name text,
  email_domain_hint text,
  deleted_at timestamp with time zone,
  created_by_packperks_admin uuid,
  group_id uuid,
  group_active boolean default true not null,
  logo_width smallint
);

create table if not exists public.payout_details (
  id uuid default gen_random_uuid() not null,
  identity_id uuid,
  iban text,
  iban_last4 text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.payout_exports (
  id uuid default gen_random_uuid() not null,
  exported_by uuid,
  claim_count integer,
  exported_at timestamp with time zone default now() not null
);

create table if not exists public.pending_batches (
  batch_id uuid not null,
  org_id uuid,
  email text,
  marketing_consent boolean default false not null,
  user_id uuid,
  first_seen timestamp with time zone default now() not null,
  resolved_at timestamp with time zone,
  notified_at timestamp with time zone
);

create table if not exists public.rate_limits (
  key text not null,
  count integer default 0 not null,
  window_start timestamp with time zone default now() not null
);

create table if not exists public.smartbin_keys (
  bin_key text not null,
  org_id uuid not null,
  machine_id text,
  label text,
  active boolean default true not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.smartbin_locations (
  id uuid default gen_random_uuid() not null,
  org_id uuid not null,
  name text not null,
  address text,
  lat double precision,
  lng double precision,
  status text default 'live'::text not null,
  machine_id text,
  active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.store_requests (
  id uuid default gen_random_uuid() not null,
  name text not null,
  region text,
  org_id uuid,
  device_id text,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.system_events (
  id uuid default gen_random_uuid() not null,
  org_id uuid,
  event_type text not null,
  status text not null,
  count integer,
  detail jsonb,
  actor_id uuid,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.users (
  id uuid default gen_random_uuid() not null,
  device_id text,
  display_name text,
  animal_index integer default 0,
  email text,
  email_verified boolean default false,
  iban text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  selected_reward_id text,
  device text,
  auth_user_id uuid,
  email_verified_at timestamp with time zone,
  org_id uuid,
  merged_into uuid,
  identity_id uuid,
  marketing_consent boolean default false not null,
  marketing_consent_at timestamp with time zone,
  marketing_consent_source text,
  consent_policy_version text
);

-- ── Keys and checks ──
alter table public.activity_history add constraint activity_history_pkey PRIMARY KEY (id);
alter table public.admin_action_log add constraint admin_action_log_pkey PRIMARY KEY (id);
alter table public.admin_invitations add constraint admin_invitations_pkey PRIMARY KEY (id);
alter table public.admin_invitations add constraint admin_invitations_token_key UNIQUE (token);
alter table public.admin_invitations add constraint admin_invitations_method_check CHECK ((method = ANY (ARRAY['email'::text, 'link'::text])));
alter table public.admin_invitations add constraint admin_invitations_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'manager'::text, 'checker'::text, 'vendor'::text])));
alter table public.admin_invitations add constraint admin_invitations_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'expired'::text, 'revoked'::text])));
alter table public.admin_login_history add constraint admin_login_history_pkey PRIMARY KEY (id);
alter table public.admin_profiles add constraint admin_profiles_pkey PRIMARY KEY (id);
alter table public.admin_profiles add constraint admin_profiles_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'manager'::text, 'checker'::text, 'vendor'::text])));
alter table public.admin_profiles add constraint admin_profiles_status_check CHECK ((status = ANY (ARRAY['active'::text, 'blocked'::text, 'deleted'::text])));
alter table public.app_config add constraint app_config_pkey PRIMARY KEY (key);
alter table public.backup_cup_uses add constraint backup_cup_uses_pkey PRIMARY KEY (id);
alter table public.backup_cups add constraint backup_cups_pkey PRIMARY KEY (id);
alter table public.bin_sessions add constraint bin_sessions_pkey PRIMARY KEY (id);
alter table public.bin_sessions add constraint bin_sessions_machine_id_session_id_key UNIQUE (machine_id, session_id);
alter table public.byo_cup_requests add constraint byo_cup_requests_pkey PRIMARY KEY (id);
alter table public.claims add constraint claims_pkey PRIMARY KEY (id);
alter table public.claims add constraint claims_payout_status_check CHECK ((payout_status = ANY (ARRAY['not_queued'::text, 'queued'::text, 'sent'::text, 'failed'::text, 'refunded'::text])));
alter table public.claims add constraint claims_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'completed'::text, 'failed'::text])));
alter table public.claims add constraint claims_type_check CHECK ((type = ANY (ARRAY['cashback'::text, 'direct_refund'::text, 'voucher'::text])));
alter table public.client_events add constraint client_events_pkey PRIMARY KEY (id);
alter table public.consent_rejections add constraint consent_rejections_pkey PRIMARY KEY (id);
alter table public.cup_balances add constraint cup_balances_pkey PRIMARY KEY (id);
alter table public.cup_scans add constraint cup_scans_pkey PRIMARY KEY (id);
alter table public.cup_scans add constraint cup_scans_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'completed'::text, 'success'::text, 'failed'::text, 'partial'::text])));
alter table public.cups add constraint cups_pkey PRIMARY KEY (id);
alter table public.cups add constraint cups_source_check CHECK ((source = ANY (ARRAY['admin_batch'::text, 'user_share'::text])));
alter table public.cups add constraint cups_status_check CHECK ((status = ANY (ARRAY['available'::text, 'activated'::text])));
alter table public.customer_identities add constraint customer_identities_pkey PRIMARY KEY (id);
alter table public.customer_identities add constraint customer_identities_auth_user_id_key UNIQUE (auth_user_id);
alter table public.donation_transfers add constraint donation_transfers_pkey PRIMARY KEY (id);
alter table public.donation_transfers add constraint donation_transfers_amount_eur_check CHECK ((amount_eur > (0)::numeric));
alter table public.email_otps add constraint email_otps_pkey PRIMARY KEY (id);
alter table public.generated_receipts add constraint generated_receipts_pkey PRIMARY KEY (id);
alter table public.generated_receipts add constraint generated_receipts_token_key UNIQUE (token);
alter table public.locations add constraint locations_pkey PRIMARY KEY (id);
alter table public.locations add constraint locations_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text])));
alter table public.merge_requests add constraint merge_requests_pkey PRIMARY KEY (id);
alter table public.mockups add constraint mockups_pkey PRIMARY KEY (id);
alter table public.org_groups add constraint org_groups_pkey PRIMARY KEY (id);
alter table public.org_groups add constraint org_groups_slug_key UNIQUE (slug);
alter table public.org_reward_budgets add constraint org_reward_budgets_pkey PRIMARY KEY (org_id);
alter table public.org_reward_budgets add constraint org_reward_budgets_cap_eur_check CHECK ((cap_eur >= (0)::numeric));
alter table public.organizations add constraint organizations_pkey PRIMARY KEY (id);
alter table public.payout_details add constraint payout_details_pkey PRIMARY KEY (id);
alter table public.payout_details add constraint payout_details_identity_id_key UNIQUE (identity_id);
alter table public.payout_exports add constraint payout_exports_pkey PRIMARY KEY (id);
alter table public.pending_batches add constraint pending_batches_pkey PRIMARY KEY (batch_id);
alter table public.rate_limits add constraint rate_limits_pkey PRIMARY KEY (key);
alter table public.smartbin_keys add constraint smartbin_keys_pkey PRIMARY KEY (bin_key);
alter table public.smartbin_locations add constraint smartbin_locations_pkey PRIMARY KEY (id);
alter table public.store_requests add constraint store_requests_pkey PRIMARY KEY (id);
alter table public.system_events add constraint system_events_pkey PRIMARY KEY (id);
alter table public.users add constraint users_pkey PRIMARY KEY (id);

-- ── Foreign keys ──
alter table public.activity_history add constraint activity_history_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE RESTRICT;
alter table public.activity_history add constraint activity_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);
alter table public.admin_action_log add constraint admin_action_log_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES admin_profiles(id) ON DELETE SET NULL;
alter table public.admin_action_log add constraint admin_action_log_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE SET NULL;
alter table public.admin_invitations add constraint admin_invitations_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES admin_profiles(id) ON DELETE SET NULL;
alter table public.admin_invitations add constraint admin_invitations_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
alter table public.admin_login_history add constraint admin_login_history_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES admin_profiles(id) ON DELETE CASCADE;
alter table public.admin_login_history add constraint admin_login_history_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE RESTRICT;
alter table public.admin_profiles add constraint admin_profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.admin_profiles add constraint admin_profiles_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES admin_profiles(id) ON DELETE SET NULL;
alter table public.admin_profiles add constraint admin_profiles_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE SET NULL;
alter table public.backup_cup_uses add constraint backup_cup_uses_backup_cup_id_fkey FOREIGN KEY (backup_cup_id) REFERENCES backup_cups(id) ON DELETE CASCADE;
alter table public.backup_cup_uses add constraint backup_cup_uses_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE SET NULL;
alter table public.backup_cups add constraint backup_cups_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
alter table public.bin_sessions add constraint bin_sessions_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE SET NULL;
alter table public.byo_cup_requests add constraint byo_cup_requests_identity_id_fkey FOREIGN KEY (identity_id) REFERENCES customer_identities(id) ON DELETE SET NULL;
alter table public.byo_cup_requests add constraint byo_cup_requests_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL;
alter table public.byo_cup_requests add constraint byo_cup_requests_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
alter table public.byo_cup_requests add constraint byo_cup_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
alter table public.claims add constraint claims_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES admin_profiles(id) ON DELETE SET NULL;
alter table public.claims add constraint claims_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE RESTRICT;
alter table public.claims add constraint claims_payout_claim_id_fkey FOREIGN KEY (payout_claim_id) REFERENCES claims(id);
alter table public.claims add constraint claims_payout_id_fkey FOREIGN KEY (payout_id) REFERENCES payout_details(id);
alter table public.claims add constraint claims_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);
alter table public.client_events add constraint client_events_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE SET NULL;
alter table public.consent_rejections add constraint consent_rejections_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
alter table public.cup_balances add constraint cup_balances_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE RESTRICT;
alter table public.cup_balances add constraint cup_balances_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
alter table public.cup_scans add constraint cup_scans_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL;
alter table public.cup_scans add constraint cup_scans_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE RESTRICT;
alter table public.cup_scans add constraint cup_scans_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
alter table public.cups add constraint cups_activated_by_user_id_fkey FOREIGN KEY (activated_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
alter table public.cups add constraint cups_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE RESTRICT;
alter table public.cups add constraint cups_shared_by_user_id_fkey FOREIGN KEY (shared_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
alter table public.customer_identities add constraint customer_identities_entry_org_id_fkey FOREIGN KEY (entry_org_id) REFERENCES organizations(id) ON DELETE SET NULL;
alter table public.donation_transfers add constraint donation_transfers_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.donation_transfers add constraint donation_transfers_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE RESTRICT;
alter table public.email_otps add constraint email_otps_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
alter table public.generated_receipts add constraint generated_receipts_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE SET NULL;
alter table public.locations add constraint locations_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
alter table public.org_reward_budgets add constraint org_reward_budgets_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
alter table public.organizations add constraint organizations_created_by_packperks_admin_fkey FOREIGN KEY (created_by_packperks_admin) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.organizations add constraint organizations_group_id_fkey FOREIGN KEY (group_id) REFERENCES org_groups(id) ON DELETE SET NULL;
alter table public.payout_details add constraint payout_details_identity_id_fkey FOREIGN KEY (identity_id) REFERENCES customer_identities(id) ON DELETE CASCADE;
alter table public.pending_batches add constraint pending_batches_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
alter table public.smartbin_keys add constraint smartbin_keys_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id);
alter table public.smartbin_locations add constraint smartbin_locations_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
alter table public.system_events add constraint system_events_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE SET NULL;
alter table public.users add constraint users_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.users add constraint users_identity_id_fkey FOREIGN KEY (identity_id) REFERENCES customer_identities(id) ON DELETE SET NULL;
alter table public.users add constraint users_merged_into_fkey FOREIGN KEY (merged_into) REFERENCES users(id) ON DELETE SET NULL;
alter table public.users add constraint users_org_id_fkey FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE RESTRICT;

-- ── Indexes ──
CREATE INDEX idx_activity_history_org_id ON public.activity_history USING btree (org_id);
CREATE INDEX admin_action_log_action_idx ON public.admin_action_log USING btree (action);
CREATE INDEX admin_action_log_actor_idx ON public.admin_action_log USING btree (actor_id);
CREATE INDEX admin_action_log_created_idx ON public.admin_action_log USING btree (created_at DESC);
CREATE INDEX admin_action_log_target_idx ON public.admin_action_log USING btree (target_type, target_id);
CREATE INDEX idx_admin_action_log_org_id ON public.admin_action_log USING btree (org_id);
CREATE INDEX admin_invitations_email_idx ON public.admin_invitations USING btree (email);
CREATE INDEX admin_invitations_token_idx ON public.admin_invitations USING btree (token);
CREATE INDEX idx_admin_invitations_org_id ON public.admin_invitations USING btree (org_id);
CREATE INDEX admin_login_history_admin_idx ON public.admin_login_history USING btree (admin_id, logged_in_at DESC);
CREATE INDEX idx_admin_login_history_org_id ON public.admin_login_history USING btree (org_id);
CREATE INDEX admin_profiles_email_idx ON public.admin_profiles USING btree (email);
CREATE INDEX admin_profiles_org_idx ON public.admin_profiles USING btree (org_id);
CREATE INDEX idx_admin_profiles_org_id ON public.admin_profiles USING btree (org_id);
CREATE INDEX idx_backup_uses_cup ON public.backup_cup_uses USING btree (backup_cup_id, used_at DESC);
CREATE INDEX idx_backup_uses_device ON public.backup_cup_uses USING btree (device_id, used_at DESC);
CREATE INDEX idx_backup_uses_org ON public.backup_cup_uses USING btree (org_id, used_at DESC);
CREATE INDEX idx_backup_cups_org ON public.backup_cups USING btree (org_id, label);
CREATE INDEX idx_bin_sessions_batch ON public.bin_sessions USING btree (batch_id);
CREATE INDEX idx_bin_sessions_org ON public.bin_sessions USING btree (org_id, created_at DESC);
CREATE INDEX idx_byo_requests_org_status ON public.byo_cup_requests USING btree (org_id, status);
CREATE INDEX idx_byo_requests_user ON public.byo_cup_requests USING btree (user_id);
CREATE INDEX claims_ai_failure_checks_idx ON public.claims USING gin (ai_failure_checks);
CREATE INDEX claims_approved_by_idx ON public.claims USING btree (approved_by);
CREATE UNIQUE INDEX claims_batch_id_key ON public.claims USING btree (batch_id) WHERE (batch_id IS NOT NULL);
CREATE INDEX claims_extracted_receipt_id_idx ON public.claims USING btree (extracted_receipt_id) WHERE (extracted_receipt_id IS NOT NULL);
CREATE INDEX claims_tikkie_cashback_id_idx ON public.claims USING btree (tikkie_cashback_id) WHERE (tikkie_cashback_id IS NOT NULL);
CREATE INDEX idx_claims_extracted_receipt_id ON public.claims USING btree (extracted_receipt_id) WHERE (extracted_receipt_id IS NOT NULL);
CREATE INDEX idx_claims_image_hidden ON public.claims USING btree (image_hidden) WHERE (image_hidden = true);
CREATE INDEX idx_claims_org_id ON public.claims USING btree (org_id);
CREATE INDEX idx_claims_wallet ON public.claims USING btree (user_id, payout_claim_id) WHERE (batch_id IS NOT NULL);
CREATE INDEX idx_client_events_event ON public.client_events USING btree (event);
CREATE INDEX idx_client_events_org_created ON public.client_events USING btree (org_id, created_at DESC);
CREATE INDEX idx_consent_rejections_org_time ON public.consent_rejections USING btree (org_id, created_at DESC);
CREATE INDEX idx_cup_balances_org_id ON public.cup_balances USING btree (org_id);
CREATE INDEX cup_scans_batch_idx ON public.cup_scans USING btree (batch_id) WHERE (batch_id IS NOT NULL);
CREATE INDEX cup_scans_source_idx ON public.cup_scans USING btree (source);
CREATE INDEX idx_cup_scans_location ON public.cup_scans USING btree (location_id) WHERE (location_id IS NOT NULL);
CREATE INDEX idx_cup_scans_org_id ON public.cup_scans USING btree (org_id);
CREATE INDEX cups_batch_idx ON public.cups USING btree (batch_id) WHERE (batch_id IS NOT NULL);
CREATE INDEX cups_batch_status_idx ON public.cups USING btree (batch_id, status) WHERE (batch_id IS NOT NULL);
CREATE INDEX cups_status_idx ON public.cups USING btree (status);
CREATE INDEX idx_cups_batch_id ON public.cups USING btree (batch_id);
CREATE INDEX idx_cups_org_id ON public.cups USING btree (org_id);
CREATE INDEX idx_donation_transfers_date ON public.donation_transfers USING btree (transfer_date DESC);
CREATE INDEX idx_donation_transfers_org_id ON public.donation_transfers USING btree (org_id);
CREATE INDEX idx_email_otps_lookup ON public.email_otps USING btree (org_id, email, created_at DESC);
CREATE INDEX idx_generated_receipts_org_created ON public.generated_receipts USING btree (org_id, created_at DESC);
CREATE INDEX idx_generated_receipts_token ON public.generated_receipts USING btree (token);
CREATE INDEX locations_org_idx ON public.locations USING btree (org_id);
CREATE INDEX idx_merge_requests_email ON public.merge_requests USING btree (email);
CREATE INDEX idx_merge_requests_org_status ON public.merge_requests USING btree (org_id, status, requested_at DESC);
CREATE INDEX idx_organizations_group_id ON public.organizations USING btree (group_id);
CREATE UNIQUE INDEX idx_organizations_slug_active ON public.organizations USING btree (slug) WHERE (deleted_at IS NULL);
CREATE INDEX idx_pending_batches_org ON public.pending_batches USING btree (org_id, first_seen DESC);
CREATE INDEX idx_smartbin_locations_org ON public.smartbin_locations USING btree (org_id, active, name);
CREATE INDEX store_requests_region_created_idx ON public.store_requests USING btree (region, created_at DESC);
CREATE INDEX idx_system_events_org_created ON public.system_events USING btree (org_id, created_at DESC);
CREATE INDEX idx_system_events_type ON public.system_events USING btree (event_type, status);
CREATE INDEX idx_users_auth_user_id ON public.users USING btree (auth_user_id);
CREATE INDEX idx_users_identity_id ON public.users USING btree (identity_id);
CREATE INDEX idx_users_merged_into ON public.users USING btree (merged_into) WHERE (merged_into IS NOT NULL);
CREATE INDEX idx_users_org_id ON public.users USING btree (org_id);
CREATE UNIQUE INDEX users_auth_org_key ON public.users USING btree (auth_user_id, org_id) WHERE (auth_user_id IS NOT NULL);
CREATE UNIQUE INDEX users_device_org_key ON public.users USING btree (device_id, org_id) WHERE (device_id IS NOT NULL);

-- ── Functions ──
CREATE OR REPLACE FUNCTION public.admin_delete_cup_batches(p_batch_ids uuid[])
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  n int := 0;
begin
  if not public.is_staff_writer() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_batch_ids is null or array_length(p_batch_ids, 1) is null then
    return json_build_object('deleted_cups', 0, 'batches', 0);
  end if;
  delete from public.cups where batch_id = any(p_batch_ids);
  get diagnostics n = row_count;
  return json_build_object('deleted_cups', n, 'batches', array_length(p_batch_ids, 1));
end
$function$
;
CREATE OR REPLACE FUNCTION public.admin_delete_records(p_table text, p_ids uuid[])
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  n integer := 0;
  idents uuid[];
  result jsonb;
begin
  if not public.is_staff_writer() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_ids is null or array_length(p_ids, 1) is null then
    return json_build_object('deleted', 0);
  end if;
  if p_table = 'claims' then
    delete from public.claims where id = any(p_ids);
    get diagnostics n = row_count;
  elsif p_table = 'cup_scans' then
    delete from public.cup_scans where id = any(p_ids);
    get diagnostics n = row_count;
  elsif p_table = 'donation_transfers' then
    delete from public.donation_transfers where id = any(p_ids);
    get diagnostics n = row_count;
  elsif p_table = 'users' then
    select coalesce(array_agg(distinct u.identity_id), '{}') into idents
      from users u
     where u.id = any(p_ids) and u.identity_id is not null
       and not exists (select 1 from users o where o.identity_id = u.identity_id and not (o.id = any(p_ids)));
    result := public.erase_customer_rows(p_ids, idents);
    return (result || jsonb_build_object('deleted', result -> 'deleted_rows'))::json;
  else
    raise exception 'table_not_allowed: %', p_table using errcode = '42501';
  end if;
  return json_build_object('deleted', n);
end
$function$
;
CREATE OR REPLACE FUNCTION public.admin_list_cup_batches(p_org_id uuid)
 RETURNS TABLE(batch_id uuid, total bigint, activated bigint, created_at timestamp with time zone, expires_at timestamp with time zone, revoked_at timestamp with time zone, revoked_reason text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if (current_admin()).id is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return query
    select
      c.batch_id,
      count(*)::bigint,
      count(*) filter (where c.status = 'activated')::bigint,
      min(c.created_at),
      max(c.expires_at),
      max(c.revoked_at),
      max(c.revoked_reason)
    from public.cups c
    where (p_org_id is null or c.org_id = p_org_id)
      and c.batch_id is not null
    group by c.batch_id
    order by min(c.created_at) desc;
end $function$
;
CREATE OR REPLACE FUNCTION public.admin_merge_identities(p_survivor_user uuid, p_absorbed_users uuid[])
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_surv_ident uuid;
  v_abs_idents uuid[];
  v_org uuid;
  v_survivor_row uuid;
  v_absorbed_rows uuid[];
begin
  if not public.is_staff_writer() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select identity_id into v_surv_ident from users where id = p_survivor_user;
  select coalesce(array_agg(distinct identity_id), '{}')
    into v_abs_idents
    from users
    where id = any(p_absorbed_users) and identity_id is not null
      and identity_id is distinct from v_surv_ident;
  if v_surv_ident is not null then
    if v_abs_idents <> '{}'::uuid[] then
      update users set identity_id = v_surv_ident where identity_id = any(v_abs_idents);
    end if;
    update users set identity_id = v_surv_ident where id = any(p_absorbed_users);
    for v_org in
      select org_id from users
        where identity_id = v_surv_ident and merged_into is null and org_id is not null
        group by org_id having count(*) > 1
    loop
      select u.id into v_survivor_row
        from users u left join cup_balances b on b.user_id = u.id
        where u.identity_id = v_surv_ident and u.org_id = v_org and u.merged_into is null
        order by coalesce(b.lifetime_cups, 0) desc, u.updated_at desc limit 1;
      select coalesce(array_agg(u.id), '{}') into v_absorbed_rows
        from users u
        where u.identity_id = v_surv_ident and u.org_id = v_org and u.merged_into is null and u.id <> v_survivor_row;
      if v_absorbed_rows <> '{}'::uuid[] then
        perform merge_user_rows(v_survivor_row, v_absorbed_rows, true);
      end if;
    end loop;
    if v_abs_idents <> '{}'::uuid[] then
      delete from customer_identities ci
        where ci.id = any(v_abs_idents) and ci.id <> v_surv_ident
          and not exists (select 1 from users u where u.identity_id = ci.id);
    end if;
  else
    for v_org in
      select org_id from users
        where id = any(array_append(p_absorbed_users, p_survivor_user)) and merged_into is null and org_id is not null
        group by org_id having count(*) > 1
    loop
      select coalesce(array_agg(u.id), '{}') into v_absorbed_rows
        from users u where u.id = any(p_absorbed_users) and u.org_id = v_org and u.merged_into is null;
      if v_absorbed_rows <> '{}'::uuid[] then
        perform merge_user_rows(p_survivor_user, v_absorbed_rows, true);
      end if;
    end loop;
  end if;
  return json_build_object('survivor_identity', v_surv_ident, 'absorbed_identities', to_jsonb(v_abs_idents));
end
$function$
;
CREATE OR REPLACE FUNCTION public.admin_profiles_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  me_role text := (public.current_admin()).role;
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  new.id := old.id;
  new.created_at := old.created_at;
  new.invited_by := old.invited_by;
  if old.id = auth.uid() then
    new.role := old.role;
    new.status := old.status;
    new.org_id := old.org_id;
    new.email := old.email;
    new.location_ids := old.location_ids;
    new.is_packperks_staff := old.is_packperks_staff;
    return new;
  end if;
  if me_role is distinct from 'owner' and (old.role = 'owner' or new.role = 'owner') then
    raise exception 'only_an_owner_can_manage_owners' using errcode = '42501';
  end if;
  return new;
end
$function$
;
CREATE OR REPLACE FUNCTION public.admin_purge_org_records(p_org_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  n_scans int;
  n_claims int;
  n_transfers int;
begin
  if not public.is_staff_writer() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_org_id is null then
    raise exception 'org_id_required' using errcode = '22004';
  end if;
  delete from public.cup_scans where org_id = p_org_id;
  get diagnostics n_scans = row_count;
  delete from public.claims where org_id = p_org_id;
  get diagnostics n_claims = row_count;
  delete from public.donation_transfers where org_id = p_org_id;
  get diagnostics n_transfers = row_count;
  return json_build_object(
    'cup_scans', n_scans,
    'claims', n_claims,
    'cup_transfers', n_transfers
  );
end
$function$
;
CREATE OR REPLACE FUNCTION public.admin_purge_users(p_user_ids uuid[])
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  rows_  uuid[];
  idents uuid[];
begin
  if not public.is_staff_writer() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_user_ids is null or array_length(p_user_ids, 1) is null then
    return json_build_object('deleted_rows', 0, 'deleted_identities', 0);
  end if;
  select c.user_ids, c.ident_ids into rows_, idents
    from public.connected_customer_rows(p_user_ids, null) c;
  return public.erase_customer_rows(rows_, idents)::json;
end
$function$
;
CREATE OR REPLACE FUNCTION public.assert_can_claim(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  u users;
  identity_email text;
begin
  select * into u from users where id = p_user_id;
  if public.venue_flag(u.org_id, 'requireEmailVerification', true) then
    if auth.uid() is null or not exists (
      select 1 from users x
      left join customer_identities ci on ci.id = x.identity_id
      where x.id = p_user_id and (x.auth_user_id = auth.uid() or ci.auth_user_id = auth.uid())
    ) then
      raise exception 'verification_required' using errcode = 'P0001';
    end if;
    return;
  end if;
  select email into identity_email from customer_identities where id = u.identity_id;
  if nullif(btrim(coalesce(u.email, identity_email, '')), '') is null and u.auth_user_id is null then
    raise exception 'email_required' using errcode = 'P0001';
  end if;
end
$function$
;
CREATE OR REPLACE FUNCTION public.check_rate_limit(p_key text, p_window_seconds integer, p_max_calls integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count INT;
BEGIN
  INSERT INTO public.rate_limits AS rl (key, count, window_start)
  VALUES (p_key, 1, now())
  ON CONFLICT (key) DO UPDATE
    SET
      count = CASE
        WHEN now() - rl.window_start > (p_window_seconds || ' seconds')::INTERVAL
          THEN 1
          ELSE rl.count + 1
      END,
      window_start = CASE
        WHEN now() - rl.window_start > (p_window_seconds || ' seconds')::INTERVAL
          THEN now()
          ELSE rl.window_start
      END
  RETURNING count INTO v_count;

  RETURN v_count;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.claims_guard_client_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_user_org uuid;
  v_reward   jsonb;
  v_balance  integer;
begin
  if current_user not in ('anon', 'authenticated') or public.is_staff_writer() then
    return new;
  end if;
  select org_id into v_user_org from users where id = new.user_id;
  if not found then
    raise exception 'claim_user_unknown' using errcode = '23514';
  end if;
  if v_user_org is not null and new.org_id is distinct from v_user_org then
    raise exception 'claim_org_mismatch' using errcode = '23514';
  end if;
  if new.type = 'cashback' then
    v_reward := public.published_reward(new.org_id, new.reward_id);
    if v_reward is null then
      raise exception 'reward_unavailable' using errcode = '23514';
    end if;
    new.cups_redeemed := round(public.config_number(v_reward -> 'cupsNeeded'))::integer;
    new.payout_amount := public.config_number(v_reward -> 'euros');
    select b.balance into v_balance from cup_balances b where b.user_id = new.user_id;
    if coalesce(v_balance, 0) < coalesce(new.cups_redeemed, 0) then
      raise exception 'insufficient_cups' using errcode = '23514';
    end if;
  elsif new.type = 'direct_refund' then
    if coalesce(new.cups_redeemed, 0) < 1 then
      raise exception 'claim_cups_required' using errcode = '23514';
    end if;
    new.reward_id := null;
    new.payout_amount := round(new.cups_redeemed * public.venue_refund_rate(new.org_id), 2);
  else
    raise exception 'claim_type_not_allowed' using errcode = '23514';
  end if;
  new.status := 'pending';
  new.created_at := now();
  new.receipt_photo_path := case when new.receipt_photo_path = new.id::text || '.jpg' then new.receipt_photo_path end;
  new.receipt_photo_url := null;
  new.iban := null;
  new.iban_last4 := null;
  new.ai_verdict := null;
  new.ai_confidence := null;
  new.ai_is_receipt := null;
  new.ai_is_burger_king := null;
  new.ai_contains_required_item := null;
  new.ai_failure_checks := null;
  new.ai_reason := null;
  new.ai_required_item := null;
  new.extracted_total_eur := null;
  new.extracted_datetime := null;
  new.extracted_receipt_id := null;
  new.verified_at := null;
  new.approved_by := null;
  new.approved_at := null;
  new.approval_note := null;
  new.admin_failure_checks := null;
  new.payout_status := null;
  new.payout_id := null;
  new.payout_claim_id := null;
  new.paid_at := null;
  new.batch_id := null;
  new.tikkie_url := null;
  new.tikkie_status := null;
  new.tikkie_cashback_id := null;
  new.tikkie_expires_at := null;
  new.tikkie_redeemed_at := null;
  new.tikkie_last_error := null;
  new.tikkie_last_error_at := null;
  new.image_hidden := false;
  new.image_hidden_reason := null;
  new.image_hidden_at := null;
  new.image_hidden_by := null;
  new.flagged := false;
  new.notify_email := false;
  new.notify_push := false;
  new.notified_at := null;
  return new;
end
$function$
;
CREATE OR REPLACE FUNCTION public.claims_guard_client_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
  then
    raise exception 'claim_field_locked' using errcode = '42501';
  end if;
  return new;
end
$function$
;
CREATE OR REPLACE FUNCTION public.config_number(p jsonb)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case
    when jsonb_typeof(p) = 'number' then (p #>> '{}')::numeric
    when jsonb_typeof(p) = 'string' and btrim(p #>> '{}') ~ '^-?[0-9]+(\.[0-9]+)?$'
      then btrim(p #>> '{}')::numeric
  end
$function$
;
CREATE OR REPLACE FUNCTION public.confirm_payout_and_purge_iban(p_claim_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_identity uuid;
begin
  update public.claims set payout_status = 'paid', paid_at = now() where id = p_claim_id;
  select u.identity_id into v_identity
    from public.claims c join public.users u on u.id = c.user_id where c.id = p_claim_id;
  if v_identity is not null and not exists (
      select 1 from public.claims c2 join public.users u2 on u2.id = c2.user_id
      where u2.identity_id = v_identity and c2.type = 'cashback' and c2.status = 'pending'
  ) then
    update public.payout_details set iban = null, updated_at = now() where identity_id = v_identity;
  end if;
end $function$
;
CREATE OR REPLACE FUNCTION public.connected_customer_rows(p_user_ids uuid[], p_auth uuid DEFAULT NULL::uuid)
 RETURNS TABLE(user_ids uuid[], ident_ids uuid[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  rows_now  uuid[] := coalesce(p_user_ids, '{}');
  rows_next uuid[];
  idents    uuid[];
  i integer;
begin
  for i in 1..6 loop
    select coalesce(array_agg(distinct u.identity_id), '{}') into idents
      from users u where u.id = any(rows_now) and u.identity_id is not null;
    select coalesce(array_agg(u.id), '{}') into rows_next
      from users u
     where (p_auth is null or u.auth_user_id is null or u.auth_user_id = p_auth)
       and (u.id = any(rows_now)
            or (p_auth is not null and u.auth_user_id = p_auth)
            or (idents <> '{}'::uuid[] and u.identity_id = any(idents)));
    exit when rows_next @> rows_now and rows_now @> rows_next;
    rows_now := rows_next;
  end loop;
  select coalesce(array_agg(distinct x), '{}') into idents from (
    select u.identity_id x from users u where u.id = any(rows_now) and u.identity_id is not null
    union
    select ci.id from customer_identities ci where p_auth is not null and ci.auth_user_id = p_auth
  ) s;
  return query select rows_now, idents;
end
$function$
;
CREATE OR REPLACE FUNCTION public.consolidate_identity(p_auth uuid, p_device text DEFAULT NULL::text, p_email text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row_ids   uuid[] := '{}';
  v_new_rows  uuid[] := '{}';
  v_ident_ids uuid[] := '{}';
  v_canonical uuid;
  v_org       uuid;
  v_survivor  uuid;
  v_absorbed  uuid[];
  i           int;
begin
  if p_auth is null then
    raise exception 'no_auth';
  end if;

  -- 1. Seed: rows this auth user owns + UNCLAIMED rows on this device.
  select coalesce(array_agg(id), '{}')
    into v_row_ids
    from users
    where merged_into is null
      and (
        auth_user_id = p_auth
        or (p_device is not null and device_id = p_device
            and (auth_user_id is null or auth_user_id = p_auth))
      );

  -- 2. Expand by shared identity (connected components), bounded.
  for i in 1..6 loop
    select coalesce(array_agg(distinct identity_id), '{}')
      into v_ident_ids
      from users where id = any(v_row_ids) and identity_id is not null;

    select coalesce(array_agg(id), '{}')
      into v_new_rows
      from users
      where merged_into is null
        and (auth_user_id is null or auth_user_id = p_auth)
        and (
          id = any(v_row_ids)
          or auth_user_id = p_auth
          or (v_ident_ids <> '{}'::uuid[] and identity_id = any(v_ident_ids))
        );

    exit when (v_new_rows @> v_row_ids and v_row_ids @> v_new_rows);
    v_row_ids := v_new_rows;
  end loop;

  if v_row_ids = '{}'::uuid[] then
    return jsonb_build_object('identity_id', null, 'rows', 0);
  end if;

  select coalesce(array_agg(distinct identity_id), '{}')
    into v_ident_ids
    from users where id = any(v_row_ids) and identity_id is not null;

  -- 3. Canonical identity: one already holding this auth, else oldest, else mint.
  select id into v_canonical from customer_identities
    where auth_user_id = p_auth order by created_at asc limit 1;
  if v_canonical is null and v_ident_ids <> '{}'::uuid[] then
    select id into v_canonical from customer_identities
      where id = any(v_ident_ids) order by created_at asc limit 1;
  end if;
  if v_canonical is null then
    insert into customer_identities (auth_user_id, display_name, animal_index, email, email_verified)
    values (
      p_auth,
      (select display_name from users where id = any(v_row_ids) and display_name is not null order by updated_at desc limit 1),
      coalesce((select animal_index from users where id = any(v_row_ids) and animal_index is not null order by updated_at desc limit 1), 0),
      coalesce(p_email, (select email from users where id = any(v_row_ids) and email is not null and email <> '' order by updated_at desc limit 1)),
      true
    )
    returning id into v_canonical;
  end if;

  update customer_identities set auth_user_id = null
    where auth_user_id = p_auth and id <> v_canonical;
  update customer_identities
    set auth_user_id = p_auth,
        email = coalesce(nullif(email, ''), p_email, email),
        display_name = coalesce(display_name,
          (select display_name from users where id = any(v_row_ids) and display_name is not null order by updated_at desc limit 1)),
        animal_index = coalesce(animal_index,
          (select animal_index from users where id = any(v_row_ids) and animal_index is not null order by updated_at desc limit 1), 0)
    where id = v_canonical;

  -- 4. Merge duplicate LIVE rows per store FIRST (so only one live row per org
  --    survives before we assign the auth slot). merge_user_rows nulls the
  --    absorbed rows' auth so the survivor can own (auth_user_id, org_id).
  for v_org in
    select org_id from users
      where id = any(v_row_ids) and merged_into is null and org_id is not null
      group by org_id having count(*) > 1
  loop
    select u.id into v_survivor
      from users u left join cup_balances b on b.user_id = u.id
      where u.id = any(v_row_ids) and u.org_id = v_org and u.merged_into is null
      order by coalesce(b.lifetime_cups, 0) desc, u.updated_at desc
      limit 1;
    select coalesce(array_agg(u.id), '{}') into v_absorbed
      from users u
      where u.id = any(v_row_ids) and u.org_id = v_org and u.merged_into is null and u.id <> v_survivor;
    if v_absorbed <> '{}'::uuid[] then
      perform merge_user_rows(v_survivor, v_absorbed, true);
    end if;
  end loop;

  -- 5a. Point ALL gathered rows (incl. tombstones) at the canonical identity so
  --     orphan identities can be cleaned up.
  update users set identity_id = v_canonical, updated_at = now()
    where id = any(v_row_ids);
  -- 5b. Assign the auth user + email to the LIVE survivors only (tombstones keep
  --     auth = null, so no users_auth_org_key collision).
  update users
    set auth_user_id = p_auth,
        email = coalesce(nullif(email, ''), p_email, email),
        updated_at = now()
    where id = any(v_row_ids) and merged_into is null;

  -- 6. Delete identities in the set that no longer have any rows pointing at them.
  delete from customer_identities ci
    where ci.id = any(v_ident_ids) and ci.id <> v_canonical
      and not exists (select 1 from users u where u.identity_id = ci.id);

  return jsonb_build_object('identity_id', v_canonical, 'rows', coalesce(array_length(v_row_ids, 1), 0));
end;
$function$
;
CREATE OR REPLACE FUNCTION public.create_cashback_claim(p_user_id uuid, p_reward_id text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org uuid;
  v_reward jsonb;
  v_cups integer;
  v_balance integer;
  v_claim_id uuid := gen_random_uuid();
begin
  if not public.owns_user(p_user_id) then
    raise exception 'not_your_account' using errcode = '42501';
  end if;
  select u.org_id into v_org from users u where u.id = p_user_id;
  if public.venue_payment_method(v_org) <> 'tikkie' then
    raise exception 'venue_uses_vouchers' using errcode = 'P0001';
  end if;
  perform public.assert_can_claim(p_user_id);
  v_reward := public.published_reward(v_org, p_reward_id);
  if v_reward is null then
    raise exception 'reward_unavailable' using errcode = 'P0001';
  end if;
  v_cups := round(public.config_number(v_reward -> 'cupsNeeded'))::integer;
  select b.balance into v_balance from cup_balances b where b.user_id = p_user_id;
  if coalesce(v_balance, 0) < coalesce(v_cups, 0) then
    raise exception 'insufficient_cups' using errcode = 'P0001';
  end if;
  insert into claims (id, user_id, org_id, type, reward_id, cups_redeemed, payout_amount,
                      receipt_photo_path, status)
  values (v_claim_id, p_user_id, v_org, 'cashback', p_reward_id, v_cups,
          public.config_number(v_reward -> 'euros'), v_claim_id::text || '.jpg', 'pending');
  return v_claim_id;
end
$function$
;
CREATE OR REPLACE FUNCTION public.cup_balances_guard_client()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if current_user not in ('anon', 'authenticated') or public.is_staff_writer() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.balance := 0;
    new.lifetime_cups := 0;
    return new;
  end if;
  new.id := old.id;
  new.user_id := old.user_id;
  new.org_id := old.org_id;
  new.lifetime_cups := old.lifetime_cups;
  new.balance := greatest(0, least(coalesce(new.balance, 0), coalesce(old.balance, 0)));
  return new;
end
$function$
;
CREATE OR REPLACE FUNCTION public.cup_scans_set_org()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE v_org uuid;
BEGIN
  IF NEW.org_id IS NULL THEN
    IF NEW.batch_id IS NOT NULL THEN
      SELECT org_id INTO v_org FROM public.cups WHERE batch_id = NEW.batch_id LIMIT 1;
    END IF;
    IF v_org IS NULL AND NEW.user_id IS NOT NULL THEN
      SELECT org_id INTO v_org FROM public.users WHERE id = NEW.user_id;
    END IF;
    NEW.org_id := v_org;
  END IF;
  RETURN NEW;
END $function$
;
CREATE OR REPLACE FUNCTION public.current_admin()
 RETURNS admin_profiles
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p.* FROM admin_profiles p
  WHERE p.id = auth.uid() AND p.status = 'active'
  LIMIT 1
$function$
;
CREATE OR REPLACE FUNCTION public.customer_identities_guard_client()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  uid uuid := auth.uid();
  jwt_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  verified_by_login boolean;
begin
  if current_user not in ('anon', 'authenticated') or public.is_staff_writer() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if uid is null or new.auth_user_id is distinct from uid then
      new.auth_user_id := null;
    end if;
  else
    new.id := old.id;
    new.created_at := old.created_at;
    new.iban := old.iban;
    if new.auth_user_id is distinct from old.auth_user_id
      and not (uid is not null and old.auth_user_id is null and new.auth_user_id = uid) then
      new.auth_user_id := old.auth_user_id;
    end if;
  end if;
  verified_by_login := uid is not null
    and new.auth_user_id = uid
    and jwt_email <> ''
    and lower(coalesce(new.email, '')) = jwt_email;
  if tg_op = 'INSERT' then
    if not verified_by_login then
      new.email_verified := false;
      new.email_verified_at := null;
    end if;
  else
    if coalesce(new.email_verified, false) and not coalesce(old.email_verified, false)
      and not verified_by_login then
      new.email_verified := old.email_verified;
    end if;
    if new.email_verified_at is distinct from old.email_verified_at
      and new.email_verified_at is not null and not verified_by_login then
      new.email_verified_at := old.email_verified_at;
    end if;
  end if;
  return new;
end
$function$
;
CREATE OR REPLACE FUNCTION public.donate_cups(p_user_id uuid, p_cups integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org uuid;
  v_balance integer;
  v_given integer;
  v_now timestamptz := now();
begin
  if not public.owns_user(p_user_id) then
    raise exception 'not_your_account' using errcode = '42501';
  end if;
  select u.org_id into v_org from users u where u.id = p_user_id;
  if not public.venue_flag(v_org, 'featureDonations', true) then
    raise exception 'donations_disabled' using errcode = 'P0001';
  end if;
  select b.balance into v_balance from cup_balances b where b.user_id = p_user_id for update;
  v_given := least(coalesce(p_cups, 0), coalesce(v_balance, 0));
  if v_given < 1 then
    raise exception 'no_cups' using errcode = 'P0001';
  end if;
  update cup_balances set balance = balance - v_given, updated_at = v_now where user_id = p_user_id;
  insert into activity_history (user_id, org_id, type, label, created_at)
  values (p_user_id, v_org, 'cups_donated',
          'Donated ' || v_given || ' cup' || case when v_given = 1 then '' else 's' end
            || ' to Plastic Soup Foundation',
          v_now);
  return jsonb_build_object('cups', v_given, 'new_balance', v_balance - v_given);
end
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_reward_budget()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if NEW.type = 'cashback' and public.reward_budget_status(NEW.org_id) then
    raise exception 'reward_budget_exceeded'
      using errcode = 'check_violation',
            hint = 'Org reward budget cap reached; new cashback claims are blocked.';
  end if;
  return NEW;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.erase_customer_rows(p_user_ids uuid[], p_ident_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  receipts text[];
  scans    text[];
  devices  text[];
  logins   uuid[];
  n_claims integer := 0;
  n_rows   integer := 0;
  n_idents integer := 0;
begin
  p_user_ids  := coalesce(p_user_ids, '{}');
  p_ident_ids := coalesce(p_ident_ids, '{}');
  select coalesce(array_agg(c.receipt_photo_path), '{}') into receipts
    from claims c where c.user_id = any(p_user_ids) and c.receipt_photo_path is not null;
  select coalesce(array_agg(s.photo_path), '{}') into scans
    from cup_scans s where s.user_id = any(p_user_ids) and s.photo_path is not null;
  select coalesce(array_agg(distinct u.device_id), '{}') into devices
    from users u where u.id = any(p_user_ids) and u.device_id is not null;
  select coalesce(array_agg(distinct a), '{}') into logins from (
    select u.auth_user_id a from users u where u.id = any(p_user_ids) and u.auth_user_id is not null
    union
    select ci.auth_user_id from customer_identities ci where ci.id = any(p_ident_ids) and ci.auth_user_id is not null
  ) s;
  update claims set
    user_id            = null,
    receipt_photo_path = null,
    receipt_photo_url  = null,
    ai_verdict         = null,
    iban               = null,
    tikkie_url         = null,
    notify_email       = false,
    notify_push        = false,
    approval_note      = case when status = 'pending' then 'Account deleted before review' else approval_note end,
    payout_status      = case when status = 'pending' then 'not_queued' else payout_status end,
    status             = case when status = 'pending' then 'failed' else status end
  where user_id = any(p_user_ids);
  get diagnostics n_claims = row_count;
  delete from activity_history where user_id = any(p_user_ids);
  delete from byo_cup_requests where user_id = any(p_user_ids) or identity_id = any(p_ident_ids);
  delete from client_events where user_id = any(p_user_ids);
  delete from pending_batches where user_id = any(p_user_ids);
  delete from merge_requests where survivor_user_id = any(p_user_ids) or absorbed_user_ids && p_user_ids;
  delete from store_requests where device_id = any(devices);
  update backup_cup_uses set device_id = null where device_id = any(devices);
  delete from users where id = any(p_user_ids);
  get diagnostics n_rows = row_count;
  delete from customer_identities where id = any(p_ident_ids);
  get diagnostics n_idents = row_count;
  return jsonb_build_object(
    'deleted_rows', n_rows,
    'deleted_identities', n_idents,
    'kept_claims', n_claims,
    'receipt_paths', to_jsonb(receipts),
    'scan_paths', to_jsonb(scans),
    'auth_user_ids', to_jsonb(logins)
  );
end
$function$
;
CREATE OR REPLACE FUNCTION public.get_customer_claims(p_user_ids uuid[])
 RETURNS TABLE(id uuid, user_id uuid, type text, reward_id text, cups_redeemed integer, payout_amount numeric, status text, payout_status text, tikkie_url text, tikkie_status text, tikkie_expires_at timestamp with time zone, tikkie_redeemed_at timestamp with time zone, notify_email boolean, notify_push boolean, flagged boolean, created_at timestamp with time zone, verified_at timestamp with time zone, approved_at timestamp with time zone, ai_failure_checks text[], admin_failure_checks text[])
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select c.id, c.user_id, c.type, c.reward_id, c.cups_redeemed, c.payout_amount,
         c.status, c.payout_status,
         c.tikkie_url, c.tikkie_status, c.tikkie_expires_at, c.tikkie_redeemed_at,
         c.notify_email, c.notify_push,
         c.flagged, c.created_at, c.verified_at, c.approved_at,
         c.ai_failure_checks, c.admin_failure_checks
  from public.claims c
  where c.user_id = any(p_user_ids)
    and (public.request_device_id() is null or public.owns_user(c.user_id))
  order by c.created_at desc
$function$
;
CREATE OR REPLACE FUNCTION public.get_my_pending(p_user_ids uuid[])
 RETURNS TABLE(batch_id uuid, first_seen timestamp with time zone, resolved_at timestamp with time zone, notified_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select pb.batch_id, pb.first_seen, pb.resolved_at, pb.notified_at
  from public.pending_batches pb
  where pb.user_id = any(p_user_ids)
    and (public.request_device_id() is null or public.owns_user(pb.user_id))
  order by pb.first_seen desc
$function$
;
CREATE OR REPLACE FUNCTION public.impact_totals(p_org_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(total_lifetime_cups bigint, returning_users bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(sum(lifetime_cups), 0)::bigint,
         count(*) filter (where lifetime_cups > 0)::bigint
  from cup_balances
  where p_org_id is null or org_id = p_org_id
$function$
;
CREATE OR REPLACE FUNCTION public.increment_cup_balance(p_user_id uuid, p_org_id uuid, p_delta integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare new_bal int;
begin
  update cup_balances
     set balance = balance + p_delta,
         lifetime_cups = lifetime_cups + greatest(0, p_delta),
         updated_at = now()
   where user_id = p_user_id
   returning balance into new_bal;
  if new_bal is null then
    insert into cup_balances (user_id, org_id, balance, lifetime_cups)
      values (p_user_id, p_org_id, greatest(0, p_delta), greatest(0, p_delta))
      returning balance into new_bal;
  end if;
  return new_bal;
end $function$
;
CREATE OR REPLACE FUNCTION public.is_staff_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from admin_profiles
    where id = auth.uid() and status = 'active'
  )
$function$
;
CREATE OR REPLACE FUNCTION public.is_staff_writer()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from admin_profiles
    where id = auth.uid()
      and status = 'active'
      and role in ('owner', 'admin', 'manager')
  )
$function$
;
CREATE OR REPLACE FUNCTION public.merge_user_rows(p_survivor uuid, p_absorbed uuid[], p_enforce_same_org boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_surv_org uuid;
  v_absorbed uuid[];
  v_merged_balance numeric := 0;
  v_merged_lifetime numeric := 0;
  v_has_surv_bal boolean;
  v_bad_org int := 0;
begin
  select coalesce(array_agg(distinct a), '{}')
    into v_absorbed
    from unnest(p_absorbed) as a
    where a is not null and a <> p_survivor;

  if v_absorbed = '{}'::uuid[] then
    raise exception 'no_absorbed_ids';
  end if;

  select org_id into v_surv_org from users where id = p_survivor for update;
  if not found then
    raise exception 'survivor_not_found';
  end if;

  perform 1 from users where id = any(v_absorbed) for update;

  if p_enforce_same_org then
    select count(*) into v_bad_org
      from users
      where id = any(v_absorbed)
        and org_id is distinct from v_surv_org;
    if v_bad_org > 0 then
      raise exception 'cross_org_merge_refused';
    end if;
  end if;

  select coalesce(sum(balance), 0), coalesce(sum(lifetime_cups), 0)
    into v_merged_balance, v_merged_lifetime
    from cup_balances
    where user_id = p_survivor or user_id = any(v_absorbed);

  select exists(select 1 from cup_balances where user_id = p_survivor)
    into v_has_surv_bal;
  if v_has_surv_bal then
    update cup_balances
      set balance = v_merged_balance,
          lifetime_cups = v_merged_lifetime,
          updated_at = now()
      where user_id = p_survivor;
  else
    insert into cup_balances (user_id, org_id, balance, lifetime_cups)
      values (p_survivor, v_surv_org, v_merged_balance, v_merged_lifetime);
  end if;

  update activity_history set user_id = p_survivor where user_id = any(v_absorbed);
  update claims           set user_id = p_survivor where user_id = any(v_absorbed);
  update cup_scans        set user_id = p_survivor where user_id = any(v_absorbed);
  update cups set shared_by_user_id    = p_survivor where shared_by_user_id    = any(v_absorbed);
  update cups set activated_by_user_id = p_survivor where activated_by_user_id = any(v_absorbed);

  delete from cup_balances where user_id = any(v_absorbed);
  -- Tombstone absorbed rows: scrub PII + free the device slot AND the auth slot
  -- (auth_user_id = null) so the survivor can safely own (auth_user_id, org_id).
  update users
    set device_id = 'merged:' || id::text,
        auth_user_id = null,
        email = null,
        device = null,
        display_name = null,
        merged_into = p_survivor,
        updated_at = now()
    where id = any(v_absorbed);

  return jsonb_build_object(
    'survivor_id',    p_survivor,
    'absorbed_ids',   to_jsonb(v_absorbed),
    'merged_balance', v_merged_balance,
    'merged_lifetime', v_merged_lifetime,
    'absorbed_count', coalesce(array_length(v_absorbed, 1), 0)
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.owns_user(p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from users u
    left join customer_identities ci on ci.id = u.identity_id
    where u.id = p_user_id
      and (
        (auth.uid() is not null and (u.auth_user_id = auth.uid() or ci.auth_user_id = auth.uid()))
        or (u.device_id is not null and u.device_id = public.request_device_id())
      )
  )
$function$
;
CREATE OR REPLACE FUNCTION public.pp_notify_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'net'
AS $function$
DECLARE
  cfg      jsonb;
  ev       text := TG_ARGV[0];
  cfg_org  uuid;
  row_org  uuid;
  summary  text;
  secret   text;
BEGIN
  BEGIN
    SELECT value INTO cfg FROM app_config WHERE key = 'notification_center';
    IF cfg IS NULL OR COALESCE((cfg->>'enabled')::boolean, false) = false THEN RETURN NEW; END IF;
    IF NOT (COALESCE(cfg->'events', '[]'::jsonb) ? ev) THEN RETURN NEW; END IF;

    cfg_org := NULLIF(cfg->>'org_id', '')::uuid;
    row_org := NULLIF(to_jsonb(NEW)->>'org_id', '')::uuid;
    IF cfg_org IS NOT NULL AND row_org IS NOT NULL AND cfg_org <> row_org THEN RETURN NEW; END IF;

    summary := CASE ev
      WHEN 'claim_created'   THEN 'New ' || COALESCE(NULLIF(to_jsonb(NEW)->>'type',''), 'cashback') || ' claim submitted'
      WHEN 'claim_approved'  THEN 'A claim was approved'
      WHEN 'claim_rejected'  THEN 'A claim was rejected'
      WHEN 'payout_failed'   THEN 'A cashback payout could not be minted'
      WHEN 'account_created' THEN 'A new account was created'
      WHEN 'cup_scanned'     THEN 'A cup was scanned'
      WHEN 'byo_request'     THEN 'A BYO cup request is awaiting review'
      WHEN 'merge_request'   THEN 'An account-merge request is awaiting review'
      ELSE ev
    END;

    SELECT value->>'secret' INTO secret FROM app_config WHERE key = 'digest_cron';

    PERFORM net.http_post(
      url     := 'https://ozvcpbthnauitaphosfb.supabase.co/functions/v1/notify-event',
      headers := jsonb_build_object('content-type', 'application/json', 'x-notify-secret', COALESCE(secret, '')),
      body    := jsonb_build_object('event_type', ev, 'summary', summary, 'org_id', row_org, 'row_id', to_jsonb(NEW)->>'id')
    );
  EXCEPTION WHEN OTHERS THEN
    RETURN NEW;
  END;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.published_reward(p_org_id uuid, p_reward_id text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select r
  from app_config ac
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(ac.value -> 'rewards') = 'array' then ac.value -> 'rewards' else '[]'::jsonb end
  ) r
  where ac.key = 'published:' || p_org_id
    and r ->> 'id' = p_reward_id
    and r ->> 'status' = 'live'
  limit 1
$function$
;
CREATE OR REPLACE FUNCTION public.purge_my_account(p_auth uuid, p_device text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  seed   uuid[];
  rows_  uuid[];
  idents uuid[];
begin
  if p_auth is null then
    raise exception 'no_auth';
  end if;
  select coalesce(array_agg(u.id), '{}') into seed
    from users u
   where u.auth_user_id = p_auth
      or (p_device is not null and u.device_id = p_device
          and (u.auth_user_id is null or u.auth_user_id = p_auth));
  select c.user_ids, c.ident_ids into rows_, idents
    from public.connected_customer_rows(seed, p_auth) c;
  return public.erase_customer_rows(rows_, idents);
end
$function$
;
CREATE OR REPLACE FUNCTION public.redeem_voucher(p_user_id uuid, p_org_id uuid, p_reward_id text, p_cups integer, p_amount numeric, p_label text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org      uuid;
  v_reward   jsonb;
  v_cups     integer;
  v_amount   numeric;
  v_balance  integer;
  v_claim_id uuid := gen_random_uuid();
  v_now      timestamptz := now();
begin
  if p_user_id is null then
    raise exception 'invalid_request';
  end if;
  if (public.request_device_id() is not null) and not public.owns_user(p_user_id) then
    raise exception 'not_your_account' using errcode = '42501';
  end if;
  select u.org_id into v_org from users u where u.id = p_user_id;
  if not found then
    raise exception 'invalid_request';
  end if;
  v_org := coalesce(v_org, p_org_id);
  if p_org_id is not null and v_org is distinct from p_org_id then
    raise exception 'invalid_request';
  end if;
  if public.venue_payment_method(v_org) <> 'voucher' then
    raise exception 'venue_does_not_use_vouchers';
  end if;
  v_reward := public.published_reward(v_org, p_reward_id);
  if v_reward is null then
    raise exception 'reward_unavailable';
  end if;
  v_cups := round(public.config_number(v_reward -> 'cupsNeeded'))::integer;
  v_amount := coalesce(public.config_number(v_reward -> 'euros'), 0);
  if v_cups is null or v_cups < 1 then
    raise exception 'invalid_request';
  end if;
  select b.balance into v_balance
    from cup_balances b
   where b.user_id = p_user_id
   for update;
  if v_balance is null then
    raise exception 'no_balance';
  end if;
  if v_balance < v_cups then
    raise exception 'insufficient_cups';
  end if;
  update cup_balances
     set balance = balance - v_cups, updated_at = v_now
   where user_id = p_user_id;
  insert into claims (
    id, user_id, org_id, type, reward_id, cups_redeemed, payout_amount,
    status, payout_status, verified_at, approved_at, notify_email, notify_push
  ) values (
    v_claim_id, p_user_id, v_org, 'voucher', p_reward_id, v_cups, v_amount,
    'completed', 'not_queued', v_now, v_now, false, false
  );
  insert into activity_history (user_id, org_id, type, label, created_at)
  values (p_user_id, v_org, 'reward_claimed',
          coalesce(left(nullif(btrim(p_label), ''), 200), 'Redeemed at the counter'), v_now);
  return jsonb_build_object(
    'claim_id', v_claim_id,
    'new_balance', v_balance - v_cups,
    'redeemed_at', v_now
  );
end
$function$
;
CREATE OR REPLACE FUNCTION public.refund_all_cups(p_user_id uuid, p_label text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org uuid;
  v_cups integer;
  v_amount numeric;
  v_claim_id uuid := gen_random_uuid();
  v_now timestamptz := now();
begin
  if not public.owns_user(p_user_id) then
    raise exception 'not_your_account' using errcode = '42501';
  end if;
  select u.org_id into v_org from users u where u.id = p_user_id;
  if not public.venue_flag(v_org, 'featureDirectRefunds', true) then
    raise exception 'refunds_disabled' using errcode = 'P0001';
  end if;
  perform public.assert_can_claim(p_user_id);
  select b.balance into v_cups from cup_balances b where b.user_id = p_user_id for update;
  if coalesce(v_cups, 0) < 1 then
    raise exception 'no_cups' using errcode = 'P0001';
  end if;
  v_amount := round(v_cups * public.venue_refund_rate(v_org), 2);
  update cup_balances set balance = 0, updated_at = v_now where user_id = p_user_id;
  insert into claims (id, user_id, org_id, type, cups_redeemed, payout_amount, status)
  values (v_claim_id, p_user_id, v_org, 'direct_refund', v_cups, v_amount, 'pending');
  insert into activity_history (user_id, org_id, type, label, created_at)
  values (p_user_id, v_org, 'cups_withdrawn',
          coalesce(left(nullif(btrim(p_label), ''), 200),
                   'Direct refund: ' || v_cups || ' cup' || case when v_cups = 1 then '' else 's' end),
          v_now);
  return jsonb_build_object('claim_id', v_claim_id, 'cups', v_cups, 'amount', v_amount, 'new_balance', 0);
end
$function$
;
CREATE OR REPLACE FUNCTION public.request_device_id()
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select nullif(nullif(current_setting('request.headers', true), '')::json ->> 'x-device-id', '')
$function$
;
CREATE OR REPLACE FUNCTION public.reward_budget_status(p_org_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from org_reward_budgets b
    where b.org_id = p_org_id
      and b.enabled
      and coalesce((
        select sum(c.payout_amount)
        from claims c
        where c.org_id = p_org_id
          and c.type = 'cashback'
          and c.status in ('completed', 'pending')
      ), 0) >= b.cap_eur
  );
$function$
;
CREATE OR REPLACE FUNCTION public.reward_unlock_date(p_user_id uuid, p_org_id uuid, p_cups_needed integer, p_exclude_claim uuid DEFAULT NULL::uuid)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_run    int := 0;
  v_unlock timestamptz := null;
  r        record;
begin
  if p_user_id is null or p_cups_needed is null or p_cups_needed <= 0 then
    return null;
  end if;

  for r in
    select ts, delta from (
      select scanned_at as ts, coalesce(cups_awarded, 0) as delta
        from cup_scans
        where user_id = p_user_id
          and (p_org_id is null or org_id = p_org_id)
          and coalesce(cups_awarded, 0) > 0
          and coalesce(status, '') not in ('failed', 'pending', 'held', 'rejected')
      union all
      select created_at as ts, -coalesce(cups_redeemed, 0) as delta
        from claims
        where user_id = p_user_id
          and (p_org_id is null or org_id = p_org_id)
          and coalesce(cups_redeemed, 0) > 0
          and coalesce(status, '') in ('pending', 'completed')
          and (p_exclude_claim is null or id <> p_exclude_claim)
    ) e
    where ts is not null
    order by ts asc, delta desc   -- process gains before losses at the same instant
  loop
    if v_run < p_cups_needed and (v_run + r.delta) >= p_cups_needed then
      v_unlock := r.ts;           -- crossing up to the threshold (keep the latest)
    end if;
    v_run := v_run + r.delta;
    if v_run < 0 then v_run := 0; end if;
  end loop;

  return v_unlock;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.run_data_retention()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'storage'
AS $function$
begin
  -- Receipt images: 90 days after the claim is resolved.
  begin
    delete from storage.objects o using public.claims c
     where o.bucket_id = 'receipts' and o.name = c.receipt_photo_path
       and c.status in ('completed','failed') and c.verified_at < now() - interval '90 days';
  exception when others then raise notice 'retention receipts: %', sqlerrm; end;
  -- Cup-scan images: 90 days after upload.
  begin
    delete from storage.objects where bucket_id = 'cup-scans' and created_at < now() - interval '90 days';
  exception when others then raise notice 'retention cup-scans: %', sqlerrm; end;
  -- Behavioural analytics: 14 months.
  begin
    delete from public.client_events where created_at < now() - interval '14 months';
  exception when others then raise notice 'retention client_events: %', sqlerrm; end;
  -- Admin action + login logs: 12 months.
  begin
    delete from public.admin_action_log where created_at < now() - interval '12 months';
  exception when others then raise notice 'retention admin_action_log: %', sqlerrm; end;
  begin
    delete from public.admin_login_history where logged_in_at < now() - interval '12 months';
  exception when others then raise notice 'retention admin_login_history: %', sqlerrm; end;
end $function$
;
CREATE OR REPLACE FUNCTION public.set_claim_notify(p_claim_id uuid, p_email boolean, p_push boolean)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update public.claims
     set notify_email = coalesce(p_email, false),
         notify_push  = false
   where id = p_claim_id
     and (public.request_device_id() is null or public.owns_user(user_id));
$function$
;
CREATE OR REPLACE FUNCTION public.set_org_from_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.org_id IS NULL AND NEW.user_id IS NOT NULL THEN
    SELECT org_id INTO NEW.org_id FROM public.users WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END $function$
;
CREATE OR REPLACE FUNCTION public.spend_cup_balance(p_user_id uuid, p_amount integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare new_bal int;
begin
  if p_amount <= 0 then
    select balance into new_bal from cup_balances where user_id = p_user_id;
    return coalesce(new_bal, 0);
  end if;
  update cup_balances
     set balance = balance - p_amount, updated_at = now()
   where user_id = p_user_id and balance >= p_amount
   returning balance into new_bal;
  return coalesce(new_bal, -1);   -- -1 = insufficient balance / no row
end $function$
;
CREATE OR REPLACE FUNCTION public.users_guard_client()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  uid uuid := auth.uid();
  jwt_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  verified_by_login boolean;
begin
  if current_user not in ('anon', 'authenticated') or public.is_staff_writer() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.merged_into := null;
    if uid is null or new.auth_user_id is distinct from uid then
      new.auth_user_id := null;
    end if;
  else
    new.id := old.id;
    new.org_id := old.org_id;
    new.merged_into := old.merged_into;
    new.created_at := old.created_at;
    if uid is null then
      new.auth_user_id := old.auth_user_id;
      new.device_id := old.device_id;
    elsif new.auth_user_id is distinct from old.auth_user_id
      and not (old.auth_user_id is null and new.auth_user_id = uid) then
      new.auth_user_id := old.auth_user_id;
    end if;
  end if;
  verified_by_login := uid is not null
    and new.auth_user_id = uid
    and jwt_email <> ''
    and lower(coalesce(new.email, '')) = jwt_email;
  if tg_op = 'INSERT' then
    if not verified_by_login then
      new.email_verified_at := null;
      new.email_verified := false;
    end if;
  else
    if new.email_verified_at is distinct from old.email_verified_at
      and new.email_verified_at is not null and not verified_by_login then
      new.email_verified_at := old.email_verified_at;
    end if;
    if coalesce(new.email_verified, false) and not coalesce(old.email_verified, false)
      and not verified_by_login then
      new.email_verified := old.email_verified;
    end if;
  end if;
  return new;
end
$function$
;
CREATE OR REPLACE FUNCTION public.vendor_request_counts(p_region text DEFAULT NULL::text)
 RETURNS TABLE(name text, count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select props->>'name' as name, count(*)::bigint as count
  from client_events
  where event = 'store_requested'
    and props->>'name' is not null
    and (p_region is null or props->>'region' = p_region)
  group by props->>'name';
$function$
;
CREATE OR REPLACE FUNCTION public.venue_flag(p_org_id uuid, p_flag text, p_default boolean)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case jsonb_typeof(public.venue_settings(p_org_id) -> p_flag)
    when 'boolean' then (public.venue_settings(p_org_id) ->> p_flag)::boolean
    else p_default
  end
$function$
;
CREATE OR REPLACE FUNCTION public.venue_payment_method(p_org_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (select m from (select public.venue_settings(p_org_id) ->> 'paymentMethod' m) x
      where m in ('tikkie', 'voucher')),
    (select g.value -> 'settings' ->> 'paymentMethod'
       from organizations o
       join app_config g on g.key = 'published:group:' || o.group_id
      where o.id = p_org_id
        and g.value -> 'settings' ->> 'paymentMethod' in ('tikkie', 'voucher')),
    'tikkie')
$function$
;
CREATE OR REPLACE FUNCTION public.venue_refund_rate(p_org_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_settings jsonb := public.venue_settings(p_org_id);
  v_refund numeric := public.config_number(v_settings -> 'refundRatePerCup');
  v_cashback numeric := public.config_number(v_settings -> 'cashbackRatePerCup');
begin
  if v_refund <= 0 then v_refund := null; end if;
  if v_cashback <= 0 then v_cashback := null; end if;
  if v_settings ->> 'mode' = 'tikkie_only' then
    return coalesce(v_refund, v_cashback, 0.10);
  end if;
  return coalesce(v_refund, 1.00);
end
$function$
;
CREATE OR REPLACE FUNCTION public.venue_settings(p_org_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (select case when jsonb_typeof(ac.value -> 'settings') = 'object' then ac.value -> 'settings' end
       from app_config ac where ac.key = 'published:' || p_org_id),
    '{}'::jsonb)
$function$
;

-- ── Function privileges ──
revoke all on function public.admin_delete_cup_batches(p_batch_ids uuid[]) from public, anon, authenticated;
grant execute on function public.admin_delete_cup_batches(p_batch_ids uuid[]) to authenticated, service_role;
revoke all on function public.admin_delete_records(p_table text, p_ids uuid[]) from public, anon, authenticated;
grant execute on function public.admin_delete_records(p_table text, p_ids uuid[]) to authenticated, service_role;
revoke all on function public.admin_list_cup_batches(p_org_id uuid) from public, anon, authenticated;
grant execute on function public.admin_list_cup_batches(p_org_id uuid) to authenticated, service_role;
revoke all on function public.admin_merge_identities(p_survivor_user uuid, p_absorbed_users uuid[]) from public, anon, authenticated;
grant execute on function public.admin_merge_identities(p_survivor_user uuid, p_absorbed_users uuid[]) to authenticated, service_role;
revoke all on function public.admin_profiles_guard() from public, anon, authenticated;
grant execute on function public.admin_profiles_guard() to anon, authenticated, service_role;
revoke all on function public.admin_purge_org_records(p_org_id uuid) from public, anon, authenticated;
grant execute on function public.admin_purge_org_records(p_org_id uuid) to authenticated, service_role;
revoke all on function public.admin_purge_users(p_user_ids uuid[]) from public, anon, authenticated;
grant execute on function public.admin_purge_users(p_user_ids uuid[]) to authenticated, service_role;
revoke all on function public.assert_can_claim(p_user_id uuid) from public, anon, authenticated;
grant execute on function public.assert_can_claim(p_user_id uuid) to service_role;
revoke all on function public.check_rate_limit(p_key text, p_window_seconds integer, p_max_calls integer) from public, anon, authenticated;
grant execute on function public.check_rate_limit(p_key text, p_window_seconds integer, p_max_calls integer) to service_role;
revoke all on function public.claims_guard_client_insert() from public, anon, authenticated;
grant execute on function public.claims_guard_client_insert() to anon, authenticated, service_role;
revoke all on function public.claims_guard_client_update() from public, anon, authenticated;
grant execute on function public.claims_guard_client_update() to anon, authenticated, service_role;
revoke all on function public.config_number(p jsonb) from public, anon, authenticated;
grant execute on function public.config_number(p jsonb) to anon, authenticated, service_role;
revoke all on function public.confirm_payout_and_purge_iban(p_claim_id uuid) from public, anon, authenticated;
grant execute on function public.confirm_payout_and_purge_iban(p_claim_id uuid) to service_role;
revoke all on function public.connected_customer_rows(p_user_ids uuid[], p_auth uuid) from public, anon, authenticated;
grant execute on function public.connected_customer_rows(p_user_ids uuid[], p_auth uuid) to service_role;
revoke all on function public.consolidate_identity(p_auth uuid, p_device text, p_email text) from public, anon, authenticated;
grant execute on function public.consolidate_identity(p_auth uuid, p_device text, p_email text) to service_role;
revoke all on function public.create_cashback_claim(p_user_id uuid, p_reward_id text) from public, anon, authenticated;
grant execute on function public.create_cashback_claim(p_user_id uuid, p_reward_id text) to anon, authenticated, service_role;
revoke all on function public.cup_balances_guard_client() from public, anon, authenticated;
grant execute on function public.cup_balances_guard_client() to anon, authenticated, service_role;
revoke all on function public.cup_scans_set_org() from public, anon, authenticated;
grant execute on function public.cup_scans_set_org() to anon, authenticated, service_role;
revoke all on function public.current_admin() from public, anon, authenticated;
grant execute on function public.current_admin() to anon, authenticated, service_role;
revoke all on function public.customer_identities_guard_client() from public, anon, authenticated;
grant execute on function public.customer_identities_guard_client() to anon, authenticated, service_role;
revoke all on function public.donate_cups(p_user_id uuid, p_cups integer) from public, anon, authenticated;
grant execute on function public.donate_cups(p_user_id uuid, p_cups integer) to anon, authenticated, service_role;
revoke all on function public.enforce_reward_budget() from public, anon, authenticated;
grant execute on function public.enforce_reward_budget() to anon, authenticated, service_role;
revoke all on function public.erase_customer_rows(p_user_ids uuid[], p_ident_ids uuid[]) from public, anon, authenticated;
grant execute on function public.erase_customer_rows(p_user_ids uuid[], p_ident_ids uuid[]) to service_role;
revoke all on function public.get_customer_claims(p_user_ids uuid[]) from public, anon, authenticated;
grant execute on function public.get_customer_claims(p_user_ids uuid[]) to anon, authenticated, service_role;
revoke all on function public.get_my_pending(p_user_ids uuid[]) from public, anon, authenticated;
grant execute on function public.get_my_pending(p_user_ids uuid[]) to anon, authenticated, service_role;
revoke all on function public.impact_totals(p_org_id uuid) from public, anon, authenticated;
grant execute on function public.impact_totals(p_org_id uuid) to anon, authenticated, service_role;
revoke all on function public.increment_cup_balance(p_user_id uuid, p_org_id uuid, p_delta integer) from public, anon, authenticated;
grant execute on function public.increment_cup_balance(p_user_id uuid, p_org_id uuid, p_delta integer) to service_role;
revoke all on function public.is_staff_admin() from public, anon, authenticated;
grant execute on function public.is_staff_admin() to anon, authenticated, service_role;
revoke all on function public.is_staff_writer() from public, anon, authenticated;
grant execute on function public.is_staff_writer() to anon, authenticated, service_role;
revoke all on function public.merge_user_rows(p_survivor uuid, p_absorbed uuid[], p_enforce_same_org boolean) from public, anon, authenticated;
grant execute on function public.merge_user_rows(p_survivor uuid, p_absorbed uuid[], p_enforce_same_org boolean) to service_role;
revoke all on function public.owns_user(p_user_id uuid) from public, anon, authenticated;
grant execute on function public.owns_user(p_user_id uuid) to anon, authenticated, service_role;
revoke all on function public.pp_notify_event() from public, anon, authenticated;
grant execute on function public.pp_notify_event() to anon, authenticated, service_role;
revoke all on function public.published_reward(p_org_id uuid, p_reward_id text) from public, anon, authenticated;
grant execute on function public.published_reward(p_org_id uuid, p_reward_id text) to anon, authenticated, service_role;
revoke all on function public.purge_my_account(p_auth uuid, p_device text) from public, anon, authenticated;
grant execute on function public.purge_my_account(p_auth uuid, p_device text) to service_role;
revoke all on function public.redeem_voucher(p_user_id uuid, p_org_id uuid, p_reward_id text, p_cups integer, p_amount numeric, p_label text) from public, anon, authenticated;
grant execute on function public.redeem_voucher(p_user_id uuid, p_org_id uuid, p_reward_id text, p_cups integer, p_amount numeric, p_label text) to anon, authenticated, service_role;
revoke all on function public.refund_all_cups(p_user_id uuid, p_label text) from public, anon, authenticated;
grant execute on function public.refund_all_cups(p_user_id uuid, p_label text) to anon, authenticated, service_role;
revoke all on function public.request_device_id() from public, anon, authenticated;
grant execute on function public.request_device_id() to anon, authenticated, service_role;
revoke all on function public.reward_budget_status(p_org_id uuid) from public, anon, authenticated;
grant execute on function public.reward_budget_status(p_org_id uuid) to anon, authenticated, service_role;
revoke all on function public.reward_unlock_date(p_user_id uuid, p_org_id uuid, p_cups_needed integer, p_exclude_claim uuid) from public, anon, authenticated;
grant execute on function public.reward_unlock_date(p_user_id uuid, p_org_id uuid, p_cups_needed integer, p_exclude_claim uuid) to service_role;
revoke all on function public.run_data_retention() from public, anon, authenticated;
grant execute on function public.run_data_retention() to service_role;
revoke all on function public.set_claim_notify(p_claim_id uuid, p_email boolean, p_push boolean) from public, anon, authenticated;
grant execute on function public.set_claim_notify(p_claim_id uuid, p_email boolean, p_push boolean) to anon, authenticated, service_role;
revoke all on function public.set_org_from_user() from public, anon, authenticated;
grant execute on function public.set_org_from_user() to anon, authenticated, service_role;
revoke all on function public.spend_cup_balance(p_user_id uuid, p_amount integer) from public, anon, authenticated;
grant execute on function public.spend_cup_balance(p_user_id uuid, p_amount integer) to service_role;
revoke all on function public.users_guard_client() from public, anon, authenticated;
grant execute on function public.users_guard_client() to anon, authenticated, service_role;
revoke all on function public.vendor_request_counts(p_region text) from public, anon, authenticated;
grant execute on function public.vendor_request_counts(p_region text) to anon, authenticated, service_role;
revoke all on function public.venue_flag(p_org_id uuid, p_flag text, p_default boolean) from public, anon, authenticated;
grant execute on function public.venue_flag(p_org_id uuid, p_flag text, p_default boolean) to service_role;
revoke all on function public.venue_payment_method(p_org_id uuid) from public, anon, authenticated;
grant execute on function public.venue_payment_method(p_org_id uuid) to service_role;
revoke all on function public.venue_refund_rate(p_org_id uuid) from public, anon, authenticated;
grant execute on function public.venue_refund_rate(p_org_id uuid) to anon, authenticated, service_role;
revoke all on function public.venue_settings(p_org_id uuid) from public, anon, authenticated;
grant execute on function public.venue_settings(p_org_id uuid) to service_role;

-- ── Triggers ──
CREATE TRIGGER trg_set_org BEFORE INSERT ON public.activity_history FOR EACH ROW EXECUTE FUNCTION set_org_from_user();
CREATE TRIGGER trg_admin_profiles_guard BEFORE UPDATE ON public.admin_profiles FOR EACH ROW EXECUTE FUNCTION admin_profiles_guard();
CREATE TRIGGER trg_notify_byo AFTER INSERT ON public.byo_cup_requests FOR EACH ROW EXECUTE FUNCTION pp_notify_event('byo_request');
CREATE TRIGGER trg_notify_claim_approved AFTER UPDATE ON public.claims FOR EACH ROW WHEN (((old.approved_by IS NULL) AND (new.approved_by IS NOT NULL) AND (new.status = 'completed'::text))) EXECUTE FUNCTION pp_notify_event('claim_approved');
CREATE TRIGGER trg_notify_claim_passed AFTER UPDATE ON public.claims FOR EACH ROW WHEN (((old.verified_at IS NULL) AND (new.verified_at IS NOT NULL) AND (new.status <> 'failed'::text) AND ((new.ai_failure_checks IS NULL) OR (cardinality(new.ai_failure_checks) = 0)))) EXECUTE FUNCTION pp_notify_event('claim_created');
CREATE TRIGGER trg_notify_claim_rejected AFTER UPDATE ON public.claims FOR EACH ROW WHEN (((old.approved_by IS NULL) AND (new.approved_by IS NOT NULL) AND (new.status = 'failed'::text))) EXECUTE FUNCTION pp_notify_event('claim_rejected');
CREATE TRIGGER trg_notify_payout_failed AFTER UPDATE ON public.claims FOR EACH ROW WHEN (((old.payout_status IS DISTINCT FROM 'failed'::text) AND (new.payout_status = 'failed'::text))) EXECUTE FUNCTION pp_notify_event('payout_failed');
CREATE TRIGGER trg_set_org BEFORE INSERT ON public.claims FOR EACH ROW EXECUTE FUNCTION set_org_from_user();
CREATE TRIGGER trg_t_claims_guard_client_insert BEFORE INSERT ON public.claims FOR EACH ROW EXECUTE FUNCTION claims_guard_client_insert();
CREATE TRIGGER trg_t_claims_guard_client_update BEFORE UPDATE ON public.claims FOR EACH ROW EXECUTE FUNCTION claims_guard_client_update();
CREATE TRIGGER trg_z_enforce_reward_budget BEFORE INSERT ON public.claims FOR EACH ROW EXECUTE FUNCTION enforce_reward_budget();
CREATE TRIGGER trg_set_org BEFORE INSERT ON public.cup_balances FOR EACH ROW EXECUTE FUNCTION set_org_from_user();
CREATE TRIGGER trg_t_cup_balances_guard_client BEFORE INSERT OR UPDATE ON public.cup_balances FOR EACH ROW EXECUTE FUNCTION cup_balances_guard_client();
CREATE TRIGGER trg_cup_scans_set_org BEFORE INSERT ON public.cup_scans FOR EACH ROW EXECUTE FUNCTION cup_scans_set_org();
CREATE TRIGGER trg_notify_scan AFTER INSERT ON public.cup_scans FOR EACH ROW WHEN ((new.status = 'success'::text)) EXECUTE FUNCTION pp_notify_event('cup_scanned');
CREATE TRIGGER trg_t_customer_identities_guard_client BEFORE INSERT OR UPDATE ON public.customer_identities FOR EACH ROW EXECUTE FUNCTION customer_identities_guard_client();
CREATE TRIGGER trg_set_org BEFORE INSERT ON public.donation_transfers FOR EACH ROW EXECUTE FUNCTION set_org_from_user();
CREATE TRIGGER trg_notify_merge AFTER INSERT ON public.merge_requests FOR EACH ROW WHEN ((new.status = 'pending'::text)) EXECUTE FUNCTION pp_notify_event('merge_request');
CREATE TRIGGER trg_notify_account AFTER INSERT ON public.users FOR EACH ROW EXECUTE FUNCTION pp_notify_event('account_created');
CREATE TRIGGER trg_t_users_guard_client BEFORE INSERT OR UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION users_guard_client();

-- ── Table privileges ──
revoke all on table public.activity_history from anon, authenticated;
grant delete, insert, select, update on table public.activity_history to anon;
grant delete, insert, select, update on table public.activity_history to authenticated;
revoke all on table public.admin_action_log from anon, authenticated;
grant delete, insert, select, update on table public.admin_action_log to anon;
grant delete, insert, select, update on table public.admin_action_log to authenticated;
revoke all on table public.admin_invitations from anon, authenticated;
grant delete, insert, select, update on table public.admin_invitations to anon;
grant delete, insert, select, update on table public.admin_invitations to authenticated;
revoke all on table public.admin_login_history from anon, authenticated;
grant delete, insert, select, update on table public.admin_login_history to anon;
grant delete, insert, select, update on table public.admin_login_history to authenticated;
revoke all on table public.admin_profiles from anon, authenticated;
grant delete, insert, select, update on table public.admin_profiles to anon;
grant delete, insert, select, update on table public.admin_profiles to authenticated;
revoke all on table public.app_config from anon, authenticated;
grant delete, insert, select, update on table public.app_config to anon;
grant delete, insert, select, update on table public.app_config to authenticated;
revoke all on table public.backup_cup_uses from anon, authenticated;
grant delete, insert, select, update on table public.backup_cup_uses to anon;
grant delete, insert, select, update on table public.backup_cup_uses to authenticated;
revoke all on table public.backup_cups from anon, authenticated;
grant delete, insert, select, update on table public.backup_cups to anon;
grant delete, insert, select, update on table public.backup_cups to authenticated;
revoke all on table public.bin_sessions from anon, authenticated;
grant delete, insert, select, update on table public.bin_sessions to anon;
grant delete, insert, select, update on table public.bin_sessions to authenticated;
revoke all on table public.byo_cup_requests from anon, authenticated;
grant delete, insert, select, update on table public.byo_cup_requests to anon;
grant delete, insert, select, update on table public.byo_cup_requests to authenticated;
revoke all on table public.claims from anon, authenticated;
grant delete, insert, select, update on table public.claims to anon;
grant delete, insert, select, update on table public.claims to authenticated;
revoke all on table public.client_events from anon, authenticated;
grant delete, insert, select, update on table public.client_events to anon;
grant delete, insert, select, update on table public.client_events to authenticated;
revoke all on table public.consent_rejections from anon, authenticated;
grant delete, insert, select, update on table public.consent_rejections to anon;
grant delete, insert, select, update on table public.consent_rejections to authenticated;
revoke all on table public.cup_balances from anon, authenticated;
grant delete, insert, select, update on table public.cup_balances to anon;
grant delete, insert, select, update on table public.cup_balances to authenticated;
revoke all on table public.cup_scans from anon, authenticated;
grant delete, insert, select, update on table public.cup_scans to anon;
grant delete, insert, select, update on table public.cup_scans to authenticated;
revoke all on table public.cups from anon, authenticated;
grant delete, insert, select, update on table public.cups to anon;
grant delete, insert, select, update on table public.cups to authenticated;
revoke all on table public.customer_identities from anon, authenticated;
grant delete, insert, select, update on table public.customer_identities to anon;
grant delete, insert, select, update on table public.customer_identities to authenticated;
revoke all on table public.donation_transfers from anon, authenticated;
grant delete, insert, select, update on table public.donation_transfers to anon;
grant delete, insert, select, update on table public.donation_transfers to authenticated;
revoke all on table public.email_otps from anon, authenticated;
grant delete, insert, select, update on table public.email_otps to anon;
grant delete, insert, select, update on table public.email_otps to authenticated;
revoke all on table public.generated_receipts from anon, authenticated;
grant delete, insert, select, update on table public.generated_receipts to anon;
grant delete, insert, select, update on table public.generated_receipts to authenticated;
revoke all on table public.locations from anon, authenticated;
grant delete, insert, select, update on table public.locations to anon;
grant delete, insert, select, update on table public.locations to authenticated;
revoke all on table public.merge_requests from anon, authenticated;
grant delete, insert, select, update on table public.merge_requests to anon;
grant delete, insert, select, update on table public.merge_requests to authenticated;
revoke all on table public.mockups from anon, authenticated;
grant delete, insert, select, update on table public.mockups to anon;
grant delete, insert, select, update on table public.mockups to authenticated;
revoke all on table public.org_groups from anon, authenticated;
grant delete, insert, select, update on table public.org_groups to anon;
grant delete, insert, select, update on table public.org_groups to authenticated;
revoke all on table public.org_reward_budgets from anon, authenticated;
grant delete, insert, select, update on table public.org_reward_budgets to anon;
grant delete, insert, select, update on table public.org_reward_budgets to authenticated;
revoke all on table public.organizations from anon, authenticated;
grant delete, insert, select, update on table public.organizations to anon;
grant delete, insert, select, update on table public.organizations to authenticated;
revoke all on table public.payout_details from anon, authenticated;
grant delete, insert, select, update on table public.payout_details to anon;
grant delete, insert, select, update on table public.payout_details to authenticated;
revoke all on table public.payout_exports from anon, authenticated;
grant delete, insert, select, update on table public.payout_exports to anon;
grant delete, insert, select, update on table public.payout_exports to authenticated;
revoke all on table public.pending_batches from anon, authenticated;
grant delete, insert, select, update on table public.pending_batches to anon;
grant delete, insert, select, update on table public.pending_batches to authenticated;
revoke all on table public.rate_limits from anon, authenticated;
grant delete, insert, select, update on table public.rate_limits to anon;
grant delete, insert, select, update on table public.rate_limits to authenticated;
revoke all on table public.smartbin_keys from anon, authenticated;
revoke all on table public.smartbin_locations from anon, authenticated;
grant delete, insert, select, update on table public.smartbin_locations to anon;
grant delete, insert, select, update on table public.smartbin_locations to authenticated;
revoke all on table public.store_requests from anon, authenticated;
grant delete, insert, select, update on table public.store_requests to anon;
grant delete, insert, select, update on table public.store_requests to authenticated;
revoke all on table public.system_events from anon, authenticated;
grant delete, insert, select, update on table public.system_events to anon;
grant delete, insert, select, update on table public.system_events to authenticated;
revoke all on table public.users from anon, authenticated;
grant delete, insert, select, update on table public.users to anon;
grant delete, insert, select, update on table public.users to authenticated;

-- ── Row level security ──
alter table public.activity_history enable row level security;
alter table public.admin_action_log enable row level security;
alter table public.admin_invitations enable row level security;
alter table public.admin_login_history enable row level security;
alter table public.admin_profiles enable row level security;
alter table public.app_config enable row level security;
alter table public.backup_cup_uses enable row level security;
alter table public.backup_cups enable row level security;
alter table public.bin_sessions enable row level security;
alter table public.byo_cup_requests enable row level security;
alter table public.claims enable row level security;
alter table public.client_events enable row level security;
alter table public.consent_rejections enable row level security;
alter table public.cup_balances enable row level security;
alter table public.cup_scans enable row level security;
alter table public.cups enable row level security;
alter table public.customer_identities enable row level security;
alter table public.donation_transfers enable row level security;
alter table public.email_otps enable row level security;
alter table public.generated_receipts enable row level security;
alter table public.locations enable row level security;
alter table public.merge_requests enable row level security;
alter table public.mockups enable row level security;
alter table public.org_groups enable row level security;
alter table public.org_reward_budgets enable row level security;
alter table public.organizations enable row level security;
alter table public.payout_details enable row level security;
alter table public.payout_exports enable row level security;
alter table public.pending_batches enable row level security;
alter table public.rate_limits enable row level security;
alter table public.smartbin_keys enable row level security;
alter table public.smartbin_locations enable row level security;
alter table public.store_requests enable row level security;
alter table public.system_events enable row level security;
alter table public.users enable row level security;

-- ── Policies ──
create policy "PackPerks cup-scans: anon insert" on storage.objects as permissive for insert to anon
  with check ((bucket_id = 'cup-scans'::text));
create policy "PackPerks cup-scans: staff select" on storage.objects as permissive for select to authenticated
  using (((bucket_id = 'cup-scans'::text) AND ((current_admin()).id IS NOT NULL)));
create policy "PackPerks receipts: anon insert" on storage.objects as permissive for insert to anon
  with check ((bucket_id = 'receipts'::text));
create policy "PackPerks receipts: staff select" on storage.objects as permissive for select to authenticated
  using (((bucket_id = 'receipts'::text) AND ((current_admin()).id IS NOT NULL)));
create policy "admin-avatars: public read" on storage.objects as permissive for select to anon, authenticated
  using ((bucket_id = 'admin-avatars'::text));
create policy "admin-avatars: self write" on storage.objects as permissive for insert to authenticated
  with check (((bucket_id = 'admin-avatars'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
create policy "admins can delete storage files" on storage.objects as permissive for delete to authenticated
  using ((EXISTS ( SELECT 1
   FROM admin_profiles
  WHERE ((admin_profiles.id = auth.uid()) AND (admin_profiles.status = 'active'::text)))));
create policy "donation-receipts: staff read" on storage.objects as permissive for select to authenticated
  using (((bucket_id = 'donation-receipts'::text) AND ((current_admin()).id IS NOT NULL)));
create policy "donation-receipts: staff write" on storage.objects as permissive for insert to authenticated
  with check (((bucket_id = 'donation-receipts'::text) AND is_staff_writer()));
create policy packperks_anon_upload_receipts on storage.objects as permissive for insert to anon, authenticated
  with check ((bucket_id = 'receipts'::text));
create policy packperks_service_read_receipts on storage.objects as permissive for select to service_role
  using ((bucket_id = 'receipts'::text));
create policy "reward-images: public read" on storage.objects as permissive for select to public
  using ((bucket_id = 'reward-images'::text));
create policy "reward-images: staff write" on storage.objects as permissive for insert to authenticated
  with check (((bucket_id = 'reward-images'::text) AND is_staff_writer()));
create policy "activity_history: anon insert" on public.activity_history as permissive for insert to anon
  with check (true);
create policy "activity_history: anon select" on public.activity_history as permissive for select to anon
  using (true);
create policy "activity_history: authed insert" on public.activity_history as permissive for insert to authenticated
  with check (true);
create policy "activity_history: authed read" on public.activity_history as permissive for select to authenticated
  using ((((current_admin()).id IS NOT NULL) OR (user_id IN ( SELECT users.id
   FROM users
  WHERE (users.auth_user_id = auth.uid())))));
create policy "audit: org owner+admin read" on public.admin_action_log as permissive for select to authenticated
  using (((org_id = (current_admin()).org_id) AND ((current_admin()).role = ANY (ARRAY['owner'::text, 'admin'::text]))));
create policy "audit: self insert" on public.admin_action_log as permissive for insert to authenticated
  with check (((actor_id = auth.uid()) AND ((org_id IS NULL) OR (org_id = (current_admin()).org_id))));
create policy "audit: self read" on public.admin_action_log as permissive for select to authenticated
  using ((actor_id = auth.uid()));
create policy "inv: owner+admin read" on public.admin_invitations as permissive for select to authenticated
  using ((((current_admin()).role = ANY (ARRAY['owner'::text, 'admin'::text])) AND (((current_admin()).org_id IS NULL) OR (org_id = (current_admin()).org_id))));
create policy "inv: owner+admin revoke" on public.admin_invitations as permissive for update to authenticated
  using ((((current_admin()).role = ANY (ARRAY['owner'::text, 'admin'::text])) AND (((current_admin()).org_id IS NULL) OR (org_id = (current_admin()).org_id))))
  with check ((((current_admin()).role = ANY (ARRAY['owner'::text, 'admin'::text])) AND (((current_admin()).org_id IS NULL) OR (org_id = (current_admin()).org_id))));
create policy "login: self read" on public.admin_login_history as permissive for select to authenticated
  using ((admin_id = auth.uid()));
create policy "admin_profiles: deny direct insert" on public.admin_profiles as permissive for insert to anon, authenticated
  with check (false);
create policy "profile: admins read all" on public.admin_profiles as permissive for select to public
  using (((current_admin()).id IS NOT NULL));
create policy "profile: org members select" on public.admin_profiles as permissive for select to authenticated
  using (((id = auth.uid()) OR ((org_id IS NOT NULL) AND (org_id = (current_admin()).org_id))));
create policy "profile: owner+admin update" on public.admin_profiles as permissive for update to authenticated
  using ((((current_admin()).role = ANY (ARRAY['owner'::text, 'admin'::text])) AND (((current_admin()).org_id IS NULL) OR (org_id = (current_admin()).org_id))))
  with check ((((current_admin()).role = ANY (ARRAY['owner'::text, 'admin'::text])) AND (((current_admin()).org_id IS NULL) OR (org_id = (current_admin()).org_id))));
create policy "profile: self update" on public.admin_profiles as permissive for update to authenticated
  using ((id = auth.uid()))
  with check ((id = auth.uid()));
create policy "app_config: public read published" on public.app_config as permissive for select to anon, authenticated
  using (((key = 'published'::text) OR (key ~~ 'published:%'::text)));
create policy "app_config: staff delete" on public.app_config as permissive for delete to authenticated
  using (is_staff_writer());
create policy "app_config: staff insert" on public.app_config as permissive for insert to authenticated
  with check (is_staff_writer());
create policy "app_config: staff read" on public.app_config as permissive for select to authenticated
  using (((current_admin()).id IS NOT NULL));
create policy "app_config: staff update" on public.app_config as permissive for update to authenticated
  using (is_staff_writer())
  with check (is_staff_writer());
create policy "backup_cup_uses: admins read" on public.backup_cup_uses as permissive for select to public
  using (((current_admin()).id IS NOT NULL));
create policy "backup_cups: admins read" on public.backup_cups as permissive for select to public
  using (((current_admin()).id IS NOT NULL));
create policy "backup_cups: admins update" on public.backup_cups as permissive for update to public
  using (((current_admin()).id IS NOT NULL))
  with check (((current_admin()).id IS NOT NULL));
create policy "bin_sessions: admins read" on public.bin_sessions as permissive for select to public
  using (((current_admin()).id IS NOT NULL));
create policy "byo_cup_requests: staff delete" on public.byo_cup_requests as permissive for delete to authenticated
  using (is_staff_writer());
create policy "byo_cup_requests: staff read" on public.byo_cup_requests as permissive for select to authenticated
  using (((current_admin()).id IS NOT NULL));
create policy "byo_cup_requests: staff update" on public.byo_cup_requests as permissive for update to authenticated
  using (is_staff_writer())
  with check (is_staff_writer());
create policy "claims: anon insert" on public.claims as permissive for insert to anon
  with check (true);
create policy "claims: authed insert" on public.claims as permissive for insert to authenticated
  with check (true);
create policy "claims: authed read" on public.claims as permissive for select to authenticated
  using ((((current_admin()).id IS NOT NULL) OR (user_id IN ( SELECT users.id
   FROM users
  WHERE (users.auth_user_id = auth.uid())))));
create policy "claims: staff update" on public.claims as permissive for update to authenticated
  using (is_staff_writer())
  with check (is_staff_writer());
create policy "client_events: app insert" on public.client_events as permissive for insert to anon, authenticated
  with check (true);
create policy "client_events: org admins read" on public.client_events as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM admin_profiles ap
  WHERE ((ap.id = auth.uid()) AND (ap.status = 'active'::text) AND ((ap.org_id = client_events.org_id) OR (ap.org_id IS NULL))))));
create policy "consent_rejections: admin read" on public.consent_rejections as permissive for select to public
  using (((current_admin()).id IS NOT NULL));
create policy "consent_rejections: anon insert" on public.consent_rejections as permissive for insert to public
  with check (true);
create policy "cup_balances: anon insert" on public.cup_balances as permissive for insert to anon
  with check (true);
create policy "cup_balances: anon select" on public.cup_balances as permissive for select to anon
  using (true);
create policy "cup_balances: anon update" on public.cup_balances as permissive for update to anon
  using (true)
  with check (true);
create policy "cup_balances: authed insert" on public.cup_balances as permissive for insert to authenticated
  with check (true);
create policy "cup_balances: authed read" on public.cup_balances as permissive for select to authenticated
  using ((((current_admin()).id IS NOT NULL) OR (user_id IN ( SELECT users.id
   FROM users
  WHERE (users.auth_user_id = auth.uid())))));
create policy "cup_balances: authed update" on public.cup_balances as permissive for update to authenticated
  using (true)
  with check (true);
create policy "cup_scans: anon select" on public.cup_scans as permissive for select to anon
  using (true);
create policy "cup_scans: authed read" on public.cup_scans as permissive for select to authenticated
  using ((((current_admin()).id IS NOT NULL) OR (user_id IN ( SELECT users.id
   FROM users
  WHERE (users.auth_user_id = auth.uid())))));
create policy "cup_scans: staff insert" on public.cup_scans as permissive for insert to authenticated
  with check (is_staff_writer());
create policy "cup_scans: staff update" on public.cup_scans as permissive for update to authenticated
  using (is_staff_writer())
  with check (is_staff_writer());
create policy "cups: anon read" on public.cups as permissive for select to anon
  using (true);
create policy "cups: authed read" on public.cups as permissive for select to authenticated
  using (true);
create policy "ci anon insert" on public.customer_identities as permissive for insert to anon
  with check (true);
create policy "ci anon select" on public.customer_identities as permissive for select to anon
  using (true);
create policy "ci anon update" on public.customer_identities as permissive for update to anon
  using (true)
  with check (true);
create policy "ci authed insert" on public.customer_identities as permissive for insert to authenticated
  with check (((auth_user_id IS NULL) OR (auth_user_id = auth.uid())));
create policy "ci authed select" on public.customer_identities as permissive for select to authenticated
  using (true);
create policy "ci authed update" on public.customer_identities as permissive for update to authenticated
  using (true)
  with check (((auth_user_id IS NULL) OR (auth_user_id = auth.uid()) OR is_staff_writer()));
create policy "donation_transfers: staff insert" on public.donation_transfers as permissive for insert to authenticated
  with check (is_staff_writer());
create policy "donation_transfers: staff read" on public.donation_transfers as permissive for select to authenticated
  using (((current_admin()).id IS NOT NULL));
create policy "donation_transfers: staff update" on public.donation_transfers as permissive for update to authenticated
  using (is_staff_writer())
  with check (is_staff_writer());
create policy "generated_receipts: admins insert" on public.generated_receipts as permissive for insert to authenticated
  with check (((current_admin()).id IS NOT NULL));
create policy "generated_receipts: admins read" on public.generated_receipts as permissive for select to authenticated
  using (((current_admin()).id IS NOT NULL));
create policy "authenticated can select locations" on public.locations as permissive for select to authenticated
  using (true);
create policy "loc: members read" on public.locations as permissive for select to authenticated
  using ((org_id = (current_admin()).org_id));
create policy "loc: owner+admin write" on public.locations as permissive for all to authenticated
  using (((org_id = (current_admin()).org_id) AND ((current_admin()).role = ANY (ARRAY['owner'::text, 'admin'::text]))))
  with check (((org_id = (current_admin()).org_id) AND ((current_admin()).role = ANY (ARRAY['owner'::text, 'admin'::text]))));
create policy "locations: staff delete" on public.locations as permissive for delete to authenticated
  using (is_staff_writer());
create policy "locations: staff insert" on public.locations as permissive for insert to authenticated
  with check (is_staff_writer());
create policy "locations: staff update" on public.locations as permissive for update to authenticated
  using (is_staff_writer())
  with check (is_staff_writer());
create policy locations_anon_read on public.locations as permissive for select to anon
  using (true);
create policy merge_requests_admin_insert on public.merge_requests as permissive for insert to authenticated
  with check ((EXISTS ( SELECT 1
   FROM admin_profiles a
  WHERE ((a.id = auth.uid()) AND ((a.status IS NULL) OR (a.status = 'active'::text))))));
create policy merge_requests_admin_read on public.merge_requests as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM admin_profiles a
  WHERE ((a.id = auth.uid()) AND ((a.status IS NULL) OR (a.status = 'active'::text))))));
create policy merge_requests_admin_write on public.merge_requests as permissive for update to authenticated
  using ((EXISTS ( SELECT 1
   FROM admin_profiles a
  WHERE ((a.id = auth.uid()) AND ((a.status IS NULL) OR (a.status = 'active'::text))))));
create policy "mockups: staff delete" on public.mockups as permissive for delete to authenticated
  using (is_staff_writer());
create policy "mockups: staff insert" on public.mockups as permissive for insert to authenticated
  with check (is_staff_writer());
create policy "mockups: staff read" on public.mockups as permissive for select to authenticated
  using (((current_admin()).id IS NOT NULL));
create policy "mockups: staff update" on public.mockups as permissive for update to authenticated
  using (is_staff_writer())
  with check (is_staff_writer());
create policy "anon can read org_groups" on public.org_groups as permissive for select to anon
  using (true);
create policy "org_groups: authed read" on public.org_groups as permissive for select to authenticated
  using (true);
create policy "org_groups: staff delete" on public.org_groups as permissive for delete to authenticated
  using (is_staff_writer());
create policy "org_groups: staff insert" on public.org_groups as permissive for insert to authenticated
  with check (is_staff_writer());
create policy "org_groups: staff update" on public.org_groups as permissive for update to authenticated
  using (is_staff_writer())
  with check (is_staff_writer());
create policy "reward budget: admin read" on public.org_reward_budgets as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM admin_profiles ap
  WHERE ((ap.id = auth.uid()) AND (ap.status = 'active'::text)))));
create policy "reward budget: admin write" on public.org_reward_budgets as permissive for all to authenticated
  using ((EXISTS ( SELECT 1
   FROM admin_profiles ap
  WHERE ((ap.id = auth.uid()) AND (ap.status = 'active'::text)))))
  with check ((EXISTS ( SELECT 1
   FROM admin_profiles ap
  WHERE ((ap.id = auth.uid()) AND (ap.status = 'active'::text)))));
create policy "anon can read active organizations" on public.organizations as permissive for select to anon
  using ((deleted_at IS NULL));
create policy "authenticated can select organizations" on public.organizations as permissive for select to authenticated
  using (true);
create policy "org: members read" on public.organizations as permissive for select to authenticated
  using ((id = (current_admin()).org_id));
create policy "org: owner+admin write" on public.organizations as permissive for update to authenticated
  using (((id = (current_admin()).org_id) AND ((current_admin()).role = ANY (ARRAY['owner'::text, 'admin'::text]))))
  with check (((id = (current_admin()).org_id) AND ((current_admin()).role = ANY (ARRAY['owner'::text, 'admin'::text]))));
create policy "organizations: staff insert" on public.organizations as permissive for insert to authenticated
  with check (is_staff_writer());
create policy "organizations: staff update" on public.organizations as permissive for update to authenticated
  using (is_staff_writer())
  with check (is_staff_writer());
create policy "pending_batches: admins read" on public.pending_batches as permissive for select to public
  using (((current_admin()).id IS NOT NULL));
create policy "smartbin_locations: admin all" on public.smartbin_locations as permissive for all to public
  using (((current_admin()).id IS NOT NULL))
  with check (((current_admin()).id IS NOT NULL));
create policy "smartbin_locations: public read" on public.smartbin_locations as permissive for select to public
  using ((active = true));
create policy "store_requests: admins delete" on public.store_requests as permissive for delete to authenticated
  using ((EXISTS ( SELECT 1
   FROM admin_profiles ap
  WHERE ((ap.id = auth.uid()) AND (ap.status = 'active'::text)))));
create policy "store_requests: admins read" on public.store_requests as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM admin_profiles ap
  WHERE ((ap.id = auth.uid()) AND (ap.status = 'active'::text)))));
create policy "store_requests: anon insert" on public.store_requests as permissive for insert to anon, authenticated
  with check (((char_length(name) >= 1) AND (char_length(name) <= 200)));
create policy "system_events: org admins read" on public.system_events as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM admin_profiles ap
  WHERE ((ap.id = auth.uid()) AND (ap.status = 'active'::text) AND ((ap.org_id = system_events.org_id) OR (ap.org_id IS NULL))))));
create policy "users: admins read" on public.users as permissive for select to authenticated
  using ((((current_admin()).id IS NOT NULL) OR (auth_user_id = auth.uid())));
create policy "users: anon insert" on public.users as permissive for insert to anon
  with check (true);
create policy "users: anon select" on public.users as permissive for select to anon
  using (true);
create policy "users: anon update" on public.users as permissive for update to anon
  using (true)
  with check (true);
create policy "users: authed claim anon" on public.users as permissive for update to authenticated
  using ((auth_user_id IS NULL))
  with check ((auth_user_id = auth.uid()));
create policy "users: authed insert" on public.users as permissive for insert to authenticated
  with check ((auth_user_id = auth.uid()));
create policy "users: authed read anon" on public.users as permissive for select to authenticated
  using ((auth_user_id IS NULL));
create policy "users: staff update" on public.users as permissive for update to authenticated
  using (is_staff_writer())
  with check (is_staff_writer());
create policy users_self_read_authed on public.users as permissive for select to authenticated
  using ((auth_user_id = auth.uid()));
create policy users_self_update_authed on public.users as permissive for update to authenticated
  using ((auth_user_id = auth.uid()))
  with check ((auth_user_id = auth.uid()));

-- ── Storage buckets ──
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('admin-avatars', 'admin-avatars', t, 5242880, '{image/jpeg,image/png,image/webp,image/gif}'::text[]) on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('cup-scans', 'cup-scans', f, 10485760, '{image/jpeg,image/png,image/webp,image/heic,image/heif}'::text[]) on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('donation-receipts', 'donation-receipts', f, 10485760, '{image/jpeg,image/png,image/webp,image/heic,image/heif}'::text[]) on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('receipts', 'receipts', f, 10485760, '{image/jpeg,image/png,image/webp,image/heic,image/heif}'::text[]) on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('reward-images', 'reward-images', t, 10485760, '{image/jpeg,image/png,image/webp,image/heic,image/heif}'::text[]) on conflict (id) do nothing;

-- ── Scheduled jobs (pg_cron) ──
select cron.schedule('packperks-data-retention', '15 3 * * *', ' select public.run_data_retention(); ');
select cron.schedule('weekly-digest-send', '0 8 * * *', '
  SELECT net.http_post(
    url     := ''https://ozvcpbthnauitaphosfb.supabase.co/functions/v1/send-digest'',
    headers := jsonb_build_object(
      ''content-type'',    ''application/json'',
      ''x-digest-secret'', (SELECT value->>''secret'' FROM public.app_config WHERE key = ''digest_cron'')
    ),
    body    := jsonb_build_object(''mode'', ''scheduled'')
  );
  ');
