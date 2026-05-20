import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { setActiveOrgId } from './orgState';

/* ─────────────────────────────────────────────────────────────────────
 * OrgContext — single source of truth for the currently-active
 * organisation in the admin dashboard.
 *
 * Exposes:
 *   • activeOrg       — full org row of the org currently being managed
 *   • activeOrgId     — convenience accessor (activeOrg?.id)
 *   • activeOrgSlug   — convenience accessor (activeOrg?.slug)
 *   • availableOrgs   — array of all non-deleted org rows the admin can see
 *   • status          — 'loading' | 'ready' | 'empty' | 'error'
 *   • switchOrg(idOrSlug) — change the active org (updates URL + localStorage)
 *   • refresh()       — re-fetch the org list (after add/edit/delete)
 *
 * Active org resolution order (when the context mounts):
 *   1. URL `?org=<slug>` query param — link-shareable, wins over storage
 *   2. localStorage `packperks_admin_active_org_id`  — last selection
 *   3. First non-deleted org returned by the DB query
 *
 * The chosen org id is mirrored to:
 *   • localStorage (so a reload restores it)
 *   • URL query string `?org=<slug>` (so links are shareable)
 *   • The orgState module-level variable (so non-React adminApi calls
 *     pick up the right org without prop-drilling)
 *
 * Phase 2 note: today every admin is internal PackPerks staff with
 * full cross-org access, so `availableOrgs` is simply every
 * organisations row where deleted_at IS NULL. When org-admins land
 * (Phase 7+) we'll filter this list by admin_profiles.org_id +
 * is_packperks_staff.
 * ───────────────────────────────────────────────────────────────────── */

const STORAGE_KEY = 'packperks_admin_active_org_id';

const OrgCtx = createContext(null);

function readUrlOrgParam() {
  if (typeof window === 'undefined') return null;
  try {
    const sp = new URLSearchParams(window.location.search);
    return sp.get('org');
  } catch {
    return null;
  }
}

function readStoredOrgId() {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredOrgId(orgId) {
  if (typeof window === 'undefined') return;
  try {
    if (orgId) localStorage.setItem(STORAGE_KEY, orgId);
    else       localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore quota / private-mode errors */
  }
}

function writeUrlOrgParam(slug) {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    if (slug) url.searchParams.set('org', slug);
    else      url.searchParams.delete('org');
    window.history.replaceState({}, '', url.toString());
  } catch {
    /* ignore */
  }
}

export function OrgProvider({ children }) {
  const [availableOrgs, setAvailableOrgs] = useState([]);
  const [activeOrg, setActiveOrg]         = useState(null);
  const [status, setStatus]               = useState('loading');
  const [error, setError]                 = useState(null);

  /* Fetch all visible orgs and pick the active one. */
  const refresh = useCallback(async (preferredId = null) => {
    setStatus('loading');
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from('organizations')
        .select('id, name, slug, brand_color, logo_url, partner_brand_name, email_domain_hint, created_at, updated_at')
        .is('deleted_at', null)
        .order('created_at', { ascending: true });

      if (err) throw err;

      const orgs = data || [];
      setAvailableOrgs(orgs);

      if (orgs.length === 0) {
        setActiveOrg(null);
        setActiveOrgId(null);
        setStatus('empty');
        return;
      }

      // Resolution chain: explicit preferred (passed in) > URL slug > stored id > first org
      const urlSlug = readUrlOrgParam();
      const storedId = readStoredOrgId();

      const byId   = (id)   => orgs.find(o => o.id === id);
      const bySlug = (slug) => orgs.find(o => o.slug === slug);

      const chosen =
        (preferredId && byId(preferredId)) ||
        (urlSlug    && bySlug(urlSlug))    ||
        (storedId   && byId(storedId))     ||
        orgs[0];

      setActiveOrg(chosen);
      setActiveOrgId(chosen.id);
      writeStoredOrgId(chosen.id);
      writeUrlOrgParam(chosen.slug);
      setStatus('ready');
    } catch (e) {
      console.error('OrgContext refresh failed:', e);
      setError(e.message || 'Failed to load organisations');
      setStatus('error');
    }
  }, []);

  // Initial fetch on mount.
  useEffect(() => {
    refresh();
  }, [refresh]);

  /* Switch to a different org. Accepts an id OR a slug. */
  const switchOrg = useCallback((idOrSlug) => {
    if (!idOrSlug) return;
    const next =
      availableOrgs.find(o => o.id === idOrSlug) ||
      availableOrgs.find(o => o.slug === idOrSlug);
    if (!next) {
      console.warn('switchOrg: unknown org', idOrSlug);
      return;
    }
    setActiveOrg(next);
    setActiveOrgId(next.id);
    writeStoredOrgId(next.id);
    writeUrlOrgParam(next.slug);
  }, [availableOrgs]);

  const value = {
    activeOrg,
    activeOrgId:   activeOrg?.id   || null,
    activeOrgSlug: activeOrg?.slug || null,
    availableOrgs,
    status,
    error,
    switchOrg,
    refresh,
  };

  return <OrgCtx.Provider value={value}>{children}</OrgCtx.Provider>;
}

export function useOrg() {
  const ctx = useContext(OrgCtx);
  if (!ctx) {
    throw new Error('useOrg must be used inside <OrgProvider>');
  }
  return ctx;
}
