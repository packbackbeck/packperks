-- ──────────────────────────────────────────────────────────────────────────
-- PackPerks — storage policies for the `receipts` bucket
--
-- The bucket itself must already exist (Supabase Studio → Storage → New
-- bucket → name: receipts, public: OFF). This script adds RLS policies so:
--
--   • anon role can INSERT new receipt photos
--   • anon role can SELECT (so the admin app can show them via signed URLs)
--   • service_role can do everything (used by the edge function)
--
-- Security note for demo: anon SELECT means anyone who can guess a path
-- (UUID-based filename) can download. For a public launch, swap this for
-- admin-auth-gated SELECT only.
-- ──────────────────────────────────────────────────────────────────────────

-- Confirm bucket exists, mark it private
UPDATE storage.buckets SET public = false WHERE id = 'receipts';

-- Drop existing PackPerks policies if they exist (idempotent)
DROP POLICY IF EXISTS "PackPerks receipts: anon insert"  ON storage.objects;
DROP POLICY IF EXISTS "PackPerks receipts: anon select"  ON storage.objects;

-- anon can upload to receipts/
CREATE POLICY "PackPerks receipts: anon insert"
  ON storage.objects FOR INSERT
  TO anon
  WITH CHECK (bucket_id = 'receipts');

-- anon can read from receipts/ (needed for client-side signed URLs in admin)
CREATE POLICY "PackPerks receipts: anon select"
  ON storage.objects FOR SELECT
  TO anon
  USING (bucket_id = 'receipts');
