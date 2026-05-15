-- ─────────────────────────────────────────────────────────────────────
-- PackPerks — let the authenticated admin role read storage objects.
--
-- The receipts + cup-scans buckets originally only granted SELECT to
-- the `anon` role, back when the admin dashboard ran on the anon API
-- key. Now the admin signs in through Supabase Auth (AuthGate) so its
-- role is `authenticated` — without these policies, every signed-URL
-- request returns null and the claim/scan thumbnails get stuck on
-- "Loading photo…" indefinitely.
--
-- Security note: gating by membership in admin_profiles would be
-- stricter, but storage RLS can't see custom tables cheaply. For now
-- we accept "any authenticated session can read the buckets", same
-- security boundary we had with anon. The admin signin flow is the
-- real gate.
-- ─────────────────────────────────────────────────────────────────────

drop policy if exists "PackPerks receipts: authed select"  on storage.objects;
drop policy if exists "PackPerks cup-scans: authed select" on storage.objects;

create policy "PackPerks receipts: authed select"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'receipts');

create policy "PackPerks cup-scans: authed select"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'cup-scans');
