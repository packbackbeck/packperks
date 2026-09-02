-- Cookie-banner rejections, counted for the User Behaviour dashboard.
--
-- A visitor who rejects essential cookies has, by definition, given no
-- analytics consent — so this CANNOT ride on client_events (that table is
-- consent-gated and pseudonymously keyed by session_id). This table is
-- therefore deliberately identifier-free: no session, no device, no user,
-- no IP, no props. One anonymous row per rejection, which is a bare count
-- and not personal data.
create table if not exists public.consent_rejections (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid references public.organizations(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists idx_consent_rejections_org_time
  on public.consent_rejections (org_id, created_at desc);

alter table public.consent_rejections enable row level security;

-- Anyone may add a rejection (the visitor is anonymous by design), but
-- nobody anonymous may read them back.
drop policy if exists "consent_rejections: anon insert" on public.consent_rejections;
create policy "consent_rejections: anon insert" on public.consent_rejections
  for insert with check (true);

drop policy if exists "consent_rejections: admin read" on public.consent_rejections;
create policy "consent_rejections: admin read" on public.consent_rejections
  for select using ((current_admin()).id is not null);
