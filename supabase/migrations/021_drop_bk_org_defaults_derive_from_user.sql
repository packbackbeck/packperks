-- ─────────────────────────────────────────────────────────────────────
-- PackPerks — stop cross-org leakage: drop the Burger King org_id defaults
--
-- Root cause of data leaking into Burger King: org_id DEFAULTed to the BK
-- org on every customer-data table. Any insert that omitted org_id (e.g.
-- addHistoryEntry) silently became a BK row — even for Titaan/KFC. So a
-- different org's activity, claims, balances, etc. could surface under BK.
--
-- Fix: drop those defaults, and derive org_id from the owning user
-- (user_id -> users.org_id) via a BEFORE INSERT trigger when an insert
-- doesn't set it. A missing org now resolves to the CORRECT org (or a
-- loud NULL), never a silent BK row.
--
-- (cup_scans was handled separately in migration 020. cups have no user_id
-- so their org comes from generate-cups, which always stamps the active
-- org as of edge function v4. users.org_id is set by getOrCreateUser.)
--
-- Applied live via the Supabase MCP as migration
-- `021_drop_bk_org_defaults_derive_from_user`.
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.users              ALTER COLUMN org_id DROP DEFAULT;
ALTER TABLE public.cups               ALTER COLUMN org_id DROP DEFAULT;
ALTER TABLE public.claims             ALTER COLUMN org_id DROP DEFAULT;
ALTER TABLE public.cup_balances       ALTER COLUMN org_id DROP DEFAULT;
ALTER TABLE public.activity_history   ALTER COLUMN org_id DROP DEFAULT;
ALTER TABLE public.donation_transfers ALTER COLUMN org_id DROP DEFAULT;

CREATE OR REPLACE FUNCTION public.set_org_from_user()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.org_id IS NULL AND NEW.user_id IS NOT NULL THEN
    SELECT org_id INTO NEW.org_id FROM public.users WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_set_org ON public.claims;
CREATE TRIGGER trg_set_org BEFORE INSERT ON public.claims
  FOR EACH ROW EXECUTE FUNCTION public.set_org_from_user();

DROP TRIGGER IF EXISTS trg_set_org ON public.cup_balances;
CREATE TRIGGER trg_set_org BEFORE INSERT ON public.cup_balances
  FOR EACH ROW EXECUTE FUNCTION public.set_org_from_user();

DROP TRIGGER IF EXISTS trg_set_org ON public.activity_history;
CREATE TRIGGER trg_set_org BEFORE INSERT ON public.activity_history
  FOR EACH ROW EXECUTE FUNCTION public.set_org_from_user();

DROP TRIGGER IF EXISTS trg_set_org ON public.donation_transfers;
CREATE TRIGGER trg_set_org BEFORE INSERT ON public.donation_transfers
  FOR EACH ROW EXECUTE FUNCTION public.set_org_from_user();
