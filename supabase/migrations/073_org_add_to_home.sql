-- ─────────────────────────────────────────────────────────────────────
-- 073 — Add to Home Screen, per venue.
--
-- The customer app can offer "Add to Home Screen": a short sheet with
-- pictures of the iPhone and Android steps (Share → Add to Home Screen →
-- Add). Masters switch it per venue in Master Settings → Organisations →
-- the venue → Profile, and choose where it sits:
--   null      off (every venue until it is switched on)
--   'home'    a tab under the cup progress on the home page
--   'account' a row under Help on the account page
--
-- It lives on the venue row, like the programme (070): publishing sends
-- the whole settings object from a draft, and a stale draft would wipe a
-- switch set anywhere else. Writes follow the table's existing policies
-- (dashboard staff only); the anon key only reads it, like the rest of
-- the venue's branding.
--
-- KFC (slug kfc) starts with it on the home page.
-- ─────────────────────────────────────────────────────────────────────

alter table public.organizations
  add column if not exists add_to_home text;

alter table public.organizations
  drop constraint if exists organizations_add_to_home_check;
alter table public.organizations
  add constraint organizations_add_to_home_check
  check (add_to_home is null or add_to_home in ('home', 'account'));

comment on column public.organizations.add_to_home is
  'Add to Home Screen in the customer app: null = off, home = under the cup progress, account = under Help.';

update public.organizations set add_to_home = 'home' where slug = 'kfc' and deleted_at is null;
