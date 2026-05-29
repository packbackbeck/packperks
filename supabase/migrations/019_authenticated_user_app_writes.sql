-- ─────────────────────────────────────────────────────────────────────
-- PackPerks — authenticated-role write policies for the user app
--
-- The customer app was built to run as the `anon` role; every write policy
-- on its tables is anon-only. When a customer signs in via magic link, the
-- client switches to the `authenticated` role, which had NO INSERT policies
-- on the user-app tables. After the per-org change (migration 018),
-- getOrCreateUser now needs to INSERT a fresh per-org user row when signed
-- in — which failed with:
--     new row violates row-level security policy for table "users"
-- The same gap broke createClaim, balance creation, and activity inserts
-- for any signed-in customer.
--
-- These policies give the authenticated role the same write posture the
-- anon role already has (a signed-in, email-verified user is at least as
-- trusted as anon). `users` INSERT and the claims owner-UPDATE are scoped
-- to the caller's own auth id; sensitive mutations (cup activation,
-- payouts) still go through edge functions with service_role.
--
-- Hardening note: tighten the permissive (true) policies to per-row
-- ownership before a real-money launch.
--
-- Applied live via the Supabase MCP as migration
-- `019_authenticated_user_app_writes` (+ the claims owner-update follow-up).
-- ─────────────────────────────────────────────────────────────────────

-- users: a signed-in user can create their own row.
DROP POLICY IF EXISTS "users: authed insert" ON public.users;
CREATE POLICY "users: authed insert" ON public.users
  FOR INSERT TO authenticated
  WITH CHECK (auth_user_id = auth.uid());

-- cup_balances: signed-in users can create/update balances (mirrors anon).
DROP POLICY IF EXISTS "cup_balances: authed insert" ON public.cup_balances;
CREATE POLICY "cup_balances: authed insert" ON public.cup_balances
  FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "cup_balances: authed update" ON public.cup_balances;
CREATE POLICY "cup_balances: authed update" ON public.cup_balances
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- activity_history: signed-in users can append their activity (mirrors anon).
DROP POLICY IF EXISTS "activity_history: authed insert" ON public.activity_history;
CREATE POLICY "activity_history: authed insert" ON public.activity_history
  FOR INSERT TO authenticated WITH CHECK (true);

-- claims: signed-in users can create a claim (mirrors anon insert) and
-- update their OWN claim (e.g. attaching the receipt photo path).
DROP POLICY IF EXISTS "claims: authed insert" ON public.claims;
CREATE POLICY "claims: authed insert" ON public.claims
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "claims: authed owner update" ON public.claims;
CREATE POLICY "claims: authed owner update" ON public.claims
  FOR UPDATE TO authenticated
  USING (user_id IN (SELECT id FROM public.users WHERE auth_user_id = auth.uid()))
  WITH CHECK (user_id IN (SELECT id FROM public.users WHERE auth_user_id = auth.uid()));
