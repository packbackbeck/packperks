-- ─────────────────────────────────────────────────────────────────────
-- PackPerks — Stats feasibility-test event tables (Phase 2)
--
-- Two append-only event logs that power the admin Stats dashboard's
-- go/no-go metrics for the Titaan sandbox validation:
--
--   • system_events  — server-side operational events. The generate-cups
--                      edge function writes one row per QR-generation
--                      attempt (success | failure) so we can compute the
--                      QR-generation success rate (metric #1).
--
--   • client_events  — anonymous user-app funnel events (app_loaded,
--                      scan_attempted, reward_shown, claim attempt/success)
--                      so we can compute dashboard-completeness (#6),
--                      user-stuck rate (#9), and bound the test window
--                      for uptime (#10).
--
-- Applied live via the Supabase MCP as migration
-- `phase2_stats_event_tables`; saved here so the repo stays reproducible.
-- ─────────────────────────────────────────────────────────────────────

-- ── system_events ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.system_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  event_type  text NOT NULL,            -- e.g. 'qr_generation'
  status      text NOT NULL,            -- 'success' | 'failure'
  count       integer,                  -- e.g. cups minted
  detail      jsonb,                    -- { batch_id, error, ... }
  actor_id    uuid,                     -- admin who triggered it
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_system_events_org_created ON public.system_events(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_events_type ON public.system_events(event_type, status);

ALTER TABLE public.system_events ENABLE ROW LEVEL SECURITY;

-- Active admins read their own org's events (org_id IS NULL = PackPerks staff).
DROP POLICY IF EXISTS "system_events: org admins read" ON public.system_events;
CREATE POLICY "system_events: org admins read" ON public.system_events
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.admin_profiles ap
    WHERE ap.id = auth.uid() AND ap.status = 'active'
      AND (ap.org_id = system_events.org_id OR ap.org_id IS NULL)
  ));
-- No anon/authenticated INSERT policy → only edge functions (service_role,
-- which bypasses RLS) can write system events. Clients cannot forge them.

-- ── client_events ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.client_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  session_id  text,
  user_id     uuid,
  event       text NOT NULL,           -- 'app_loaded' | 'scan_attempted' | ...
  props       jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_client_events_org_created ON public.client_events(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_events_event ON public.client_events(event);

ALTER TABLE public.client_events ENABLE ROW LEVEL SECURITY;

-- Anonymous app can append its own events (append-only, no sensitive data).
-- NOTE (pre-prod hardening): this is an open ingestion endpoint — fine for
-- the sandbox test; before public launch, gate behind an edge function or
-- rate-limit by IP to prevent analytics spam.
DROP POLICY IF EXISTS "client_events: app insert" ON public.client_events;
CREATE POLICY "client_events: app insert" ON public.client_events
  FOR INSERT TO anon, authenticated WITH CHECK (true);

-- Admins read their org's events (no anon read).
DROP POLICY IF EXISTS "client_events: org admins read" ON public.client_events;
CREATE POLICY "client_events: org admins read" ON public.client_events
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.admin_profiles ap
    WHERE ap.id = auth.uid() AND ap.status = 'active'
      AND (ap.org_id = client_events.org_id OR ap.org_id IS NULL)
  ));
