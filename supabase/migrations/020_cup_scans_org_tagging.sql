-- ─────────────────────────────────────────────────────────────────────
-- PackPerks — tag cup_scans with the correct org
--
-- cup_scans.org_id defaulted to the BK org and claim-cups never set it, so
-- EVERY scan (even of Titaan cups) was recorded under BK. The per-org Stats
-- dashboard therefore showed 0 scans for every org except BK.
--
-- Fix: drop the BK default and add a BEFORE INSERT trigger that tags each
-- scan with the org that owns the scanned cups (its batch's org), falling
-- back to the scanning user's org when there's no batch (e.g. photo scans).
-- Then backfill the existing rows from their batch's org.
--
-- Applied live via the Supabase MCP as migration `020_cup_scans_org_tagging`.
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.cup_scans ALTER COLUMN org_id DROP DEFAULT;

CREATE OR REPLACE FUNCTION public.cup_scans_set_org()
RETURNS trigger LANGUAGE plpgsql AS $$
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
END $$;

DROP TRIGGER IF EXISTS trg_cup_scans_set_org ON public.cup_scans;
CREATE TRIGGER trg_cup_scans_set_org
  BEFORE INSERT ON public.cup_scans
  FOR EACH ROW EXECUTE FUNCTION public.cup_scans_set_org();

-- Backfill existing QR scans to their batch's org.
WITH batch_org AS (
  SELECT batch_id, min(org_id::text)::uuid AS org_id
  FROM public.cups WHERE batch_id IS NOT NULL GROUP BY batch_id
)
UPDATE public.cup_scans cs
SET org_id = bo.org_id
FROM batch_org bo
WHERE cs.batch_id = bo.batch_id
  AND bo.org_id IS NOT NULL
  AND cs.org_id IS DISTINCT FROM bo.org_id;
