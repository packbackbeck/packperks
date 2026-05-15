-- The cups table previously only had a SELECT policy for the anon
-- role. When the admin dashboard moved to Supabase Auth (AuthGate),
-- its session role became `authenticated` and every admin read of
-- `cups` started returning zero rows silently — most visibly on the
-- Transactions page (which depends on user_share rows) and on the
-- "Recent batches" panel in Cup QR Codes.
--
-- This adds the matching authenticated-read policy. Same class of
-- fix as the receipts + cup-scans storage policies in migration 004.
drop policy if exists "cups: authed read" on cups;

create policy "cups: authed read"
  on cups for select to authenticated
  using (true);
