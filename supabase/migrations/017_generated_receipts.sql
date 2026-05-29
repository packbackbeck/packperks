-- ─────────────────────────────────────────────────────────────────────
-- PackPerks — generated_receipts (Rewards Receipt Generator / test tool)
--
-- Receipts minted by the admin "Receipt Generator → Rewards Receipts" tab
-- for the feasibility test. Each carries a unique PackPerks token (printed
-- on the image as a "PackPerks Verified Test Receipt" badge). The
-- verify-receipt edge function extracts that token from the uploaded image
-- and, if it matches a row here for the same org, auto-accepts the receipt
-- — letting testers complete the redemption flow without a real purchase.
-- Doubles as the generated-receipts log shown in the admin UI.
--
-- Applied live via the Supabase MCP as migration `017_generated_receipts`.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.generated_receipts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  token        text UNIQUE NOT NULL,        -- e.g. PPK-1A2B3C4D
  items        jsonb NOT NULL DEFAULT '[]', -- [{ name, qty, price }]
  total        numeric,
  receipt_date timestamptz,
  venue        text,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_generated_receipts_org_created ON public.generated_receipts(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_generated_receipts_token ON public.generated_receipts(token);

ALTER TABLE public.generated_receipts ENABLE ROW LEVEL SECURITY;

-- Active admins read + insert (org_id IS NULL = PackPerks staff).
-- verify-receipt reads via service_role (bypasses RLS).
DROP POLICY IF EXISTS "generated_receipts: admins read" ON public.generated_receipts;
CREATE POLICY "generated_receipts: admins read" ON public.generated_receipts
  FOR SELECT TO authenticated
  USING ((current_admin()).id IS NOT NULL);

DROP POLICY IF EXISTS "generated_receipts: admins insert" ON public.generated_receipts;
CREATE POLICY "generated_receipts: admins insert" ON public.generated_receipts
  FOR INSERT TO authenticated
  WITH CHECK ((current_admin()).id IS NOT NULL);
