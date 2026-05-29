-- ─────────────────────────────────────────────────────────────────────
-- PackPerks — final sweep: remove the Burger King org_id DEFAULT from the
-- remaining (admin) tables.
--
-- After migrations 020/021 every CUSTOMER-data table was clean; the only
-- org_id defaults still pointing at the BK org were on the four admin
-- tables. Their writers already set org_id explicitly:
--   • admin_action_log    → logAction() sets getActiveOrgId()
--   • admin_invitations   → invite-admin sets caller.org_id
--   • admin_profiles      → bootstrap-admin sets invitation.org_id (or seed)
--   • admin_login_history → login audit; org non-essential, NULL acceptable
-- so the default was never relied on. Removing it guarantees nothing can
-- silently fall back to Burger King anywhere in the database.
--
-- Verified afterwards: zero columns in the public schema have a default
-- referencing the BK org id.
--
-- Applied live via the Supabase MCP as migration
-- `022_drop_bk_org_defaults_admin_tables`.
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.admin_action_log    ALTER COLUMN org_id DROP DEFAULT;
ALTER TABLE public.admin_invitations   ALTER COLUMN org_id DROP DEFAULT;
ALTER TABLE public.admin_profiles      ALTER COLUMN org_id DROP DEFAULT;
ALTER TABLE public.admin_login_history ALTER COLUMN org_id DROP DEFAULT;
