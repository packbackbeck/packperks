-- ──────────────────────────────────────────────────────────────────────
-- PackPerks — let the PUBLIC user app resolve orgs by slug (023)
--
-- Bug: scanning a receipt QR for a non-default org (e.g. /titaan/?batch=…)
-- always landed on the DEFAULT org's page. Root cause: migration 012 only
-- granted SELECT on `organizations` to the `authenticated` role. The
-- public user app runs as the `anon` role, so:
--
--     getOrgBySlug('titaan')  -> [] (RLS) -> null
--     getDefaultOrg()         -> null
--     => org resolution fails -> app falls back to the default brand.
--
-- Every phone-camera scan is an anonymous visitor, so NO slug ever
-- resolved — the slug in the URL was correct but unreadable.
--
-- Fix: allow `anon` to SELECT non-deleted organizations. The exposed
-- columns are public storefront branding (name, slug, brand colour, logo,
-- partner brand name) — the same data already printed on the receipts and
-- rendered on the public app. No private/admin data lives on this table.
--
-- Soft-deleted orgs stay hidden from the public (deleted_at must be null),
-- matching getOrgBySlug()/getDefaultOrg() which already filter on it.
--
-- Safe to re-run.
-- ──────────────────────────────────────────────────────────────────────

alter table public.organizations enable row level security;

drop policy if exists "anon can read active organizations" on public.organizations;
create policy "anon can read active organizations"
  on public.organizations
  for select
  to anon
  using (deleted_at is null);
