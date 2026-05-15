-- ──────────────────────────────────────────────────────────────────────────
-- PackPerks — receipt verification columns
--
-- Adds the columns the verify-receipt Edge Function writes to:
--   • receipt_photo_path  — path inside the private `receipts` bucket
--   • ai_*                — verdict fields from Claude
--   • extracted_*         — fields the LLM pulled out of the receipt
--   • verified_at         — when the verdict was recorded
--
-- The existing receipt_photo_url column is preserved for backwards compat
-- with old (admin-uploaded) claims and any direct image URLs.
--
-- Run this in: Supabase Studio → SQL Editor → New query → paste → Run.
-- ──────────────────────────────────────────────────────────────────────────

ALTER TABLE claims
  ADD COLUMN IF NOT EXISTS receipt_photo_path     text,
  ADD COLUMN IF NOT EXISTS ai_verdict             jsonb,
  ADD COLUMN IF NOT EXISTS ai_confidence          numeric,
  ADD COLUMN IF NOT EXISTS ai_is_receipt          boolean,
  ADD COLUMN IF NOT EXISTS ai_is_burger_king      boolean,
  ADD COLUMN IF NOT EXISTS ai_contains_required_item boolean,
  ADD COLUMN IF NOT EXISTS ai_failure_checks      text[],
  ADD COLUMN IF NOT EXISTS ai_reason              text,
  ADD COLUMN IF NOT EXISTS ai_required_item       text,
  ADD COLUMN IF NOT EXISTS extracted_total_eur    numeric,
  ADD COLUMN IF NOT EXISTS extracted_datetime     timestamptz,
  ADD COLUMN IF NOT EXISTS extracted_receipt_id   text,
  ADD COLUMN IF NOT EXISTS verified_at            timestamptz;

-- Index supporting the duplicate-receipt guard in the edge function
CREATE INDEX IF NOT EXISTS claims_extracted_receipt_id_idx
  ON claims (extracted_receipt_id)
  WHERE extracted_receipt_id IS NOT NULL;

-- Index supporting the admin "show me only AI-flagged claims" filter
CREATE INDEX IF NOT EXISTS claims_ai_failure_checks_idx
  ON claims USING GIN (ai_failure_checks);

-- ──────────────────────────────────────────────────────────────────────────
-- Update the claims_status_check constraint
--
-- The verify-receipt function writes status = 'pending' | 'completed' | 'failed'.
-- These already match your existing constraint, so no change is needed —
-- but we recreate it defensively in case prior schemas drifted.
-- ──────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'claims_status_check'
  ) THEN
    ALTER TABLE claims DROP CONSTRAINT claims_status_check;
  END IF;
  ALTER TABLE claims
    ADD CONSTRAINT claims_status_check
    CHECK (status IN ('pending', 'completed', 'failed'));
END $$;
