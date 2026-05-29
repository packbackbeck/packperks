-- ─────────────────────────────────────────────────────────────────────
-- PackPerks — admin read access for scans / balances / activity
--
-- The C-1 security lockdown added `authenticated` admin SELECT policies to
-- claims, cups, and users — but missed cup_scans, cup_balances, and
-- activity_history. As a result the admin dashboard (which runs as the
-- `authenticated` role when an admin is logged in) received ZERO rows from
-- those tables, which broke:
--   • the Stats page (all metrics N/A — they derive from cup_scans)
--   • the Cup Scans page
--   • parts of the Overview (cups collected/redeemed, activity feed)
--
-- These policies mirror the existing "claims: authed read" pattern: an
-- active admin (current_admin().id present) can read, OR the row's owning
-- email-linked user can read their own rows. Org scoping for the admin view
-- is applied at the query layer (applyOrgFilter), consistent with how
-- claims/cups already behave.
--
-- Applied live via the Supabase MCP as migration
-- `016_admin_read_scans_balances_activity`; saved here for reproducibility.
-- ─────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "cup_scans: authed read" ON public.cup_scans;
CREATE POLICY "cup_scans: authed read" ON public.cup_scans
  FOR SELECT TO authenticated
  USING (
    (current_admin()).id IS NOT NULL
    OR user_id IN (SELECT id FROM public.users WHERE auth_user_id = auth.uid())
  );

DROP POLICY IF EXISTS "cup_balances: authed read" ON public.cup_balances;
CREATE POLICY "cup_balances: authed read" ON public.cup_balances
  FOR SELECT TO authenticated
  USING (
    (current_admin()).id IS NOT NULL
    OR user_id IN (SELECT id FROM public.users WHERE auth_user_id = auth.uid())
  );

DROP POLICY IF EXISTS "activity_history: authed read" ON public.activity_history;
CREATE POLICY "activity_history: authed read" ON public.activity_history
  FOR SELECT TO authenticated
  USING (
    (current_admin()).id IS NOT NULL
    OR user_id IN (SELECT id FROM public.users WHERE auth_user_id = auth.uid())
  );
