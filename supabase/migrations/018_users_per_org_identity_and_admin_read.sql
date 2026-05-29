-- ─────────────────────────────────────────────────────────────────────
-- PackPerks — per-org user identity + admin read access
--
-- Two bugs this fixes:
--
-- 1. Customers were not org-independent. users.device_id and
--    users.auth_user_id were GLOBALLY unique, so a device/email that
--    opened a second org reused its first org's row. Combined with
--    users.org_id defaulting to the BK org, every new signup (even on the
--    Titaan app) silently landed in BK and never appeared in the correct
--    org's dashboard. Identity is now unique PER ORG.
--
-- 2. The only authenticated SELECT policy on users was self-read
--    (auth_user_id = auth.uid()), so the admin dashboard (which runs as
--    the authenticated role) could not see device/customer users at all —
--    the BK user list looked empty. Add an admin read path. Org scoping
--    for the admin view is applied at the query layer (applyOrgFilter),
--    matching how claims/cups already behave.
--
-- Applied live via the Supabase MCP as migration
-- `018_users_per_org_identity_and_admin_read`.
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_device_id_key;
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_auth_user_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS users_device_org_key
  ON public.users (device_id, org_id) WHERE device_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_auth_org_key
  ON public.users (auth_user_id, org_id) WHERE auth_user_id IS NOT NULL;

DROP POLICY IF EXISTS "users: admins read" ON public.users;
CREATE POLICY "users: admins read" ON public.users
  FOR SELECT TO authenticated
  USING ((current_admin()).id IS NOT NULL OR auth_user_id = auth.uid());
