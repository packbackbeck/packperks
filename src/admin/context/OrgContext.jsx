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
  const [groups, setGroups]               = useState([]); // org_groups rows (id, name, slug)
  const [activeOrg, setActiveOrg]         = useState(null);
  const [status, setStatus]               = useState('loading');
  const [error, setError]                 = useState(null);
  // Phase 3: analytics scope for the group-aware pages — 'org' (this store,
  // default) or 'group' (all stores in the active org's group combined).
  const [statsScope, setStatsScope]       = useState('org');

  /* Fetch all visible orgs and pick the active one. */
  const refresh = useCallback(async (preferredId = null) => {
    setStatus('loading');
    setError(null);
    try {
      const [{ data, error: err }, { data: grpData }] = await Promise.all([
        supabase
          .from('organizations')
          .select('id, name, slug, brand_color, logo_url, partner_brand_name, email_domain_hint, group_id, group_active, created_at, updated_at')
          .is('deleted_at', null)
          .order('created_at', { ascending: true }),
        supabase.from('org_groups').select('id, name, slug'),
      ]);

      if (err) throw err;

      const orgs = data || [];
      setAvailableOrgs(orgs);
      setGroups(grpData || []);

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

  // Reset the analytics scope to "this store" whenever the active org
  // changes — a new org may be in a different group (or none).
  useEffect(() => {
    setStatsScope('org');
  }, [activeOrg?.id]);

  // Active org's cup-sharing flag + its group's copy mode — used to gate
  // the sidebar (Cup Transfers only when sharing is on; BYO Requests vs
  // Receipt Generator by mode).
  const [activeOrgSharing, setActiveOrgSharing] = useState(false);
  const [activeGroupMode, setActiveGroupMode] = useState(null);
  // Org-level operating mode (null | 'tikkie_only') — see orgModes.js. Gates
  // the whole dashboard, so it lives here next to the group mode.
  const [activeOrgMode, setActiveOrgMode] = useState(null);
  // Bumped by the settings mode picker (via the 'pp-org-mode-changed' event)
  // so the dashboard re-gates immediately without a full reload.
  const [modeRefresh, setModeRefresh] = useState(0);
  useEffect(() => {
    const bump = () => setModeRefresh(n => n + 1);
    window.addEventListener('pp-org-mode-changed', bump);
    return () => window.removeEventListener('pp-org-mode-changed', bump);
  }, []);
  useEffect(() => {
    let alive = true;
    const oid = activeOrg?.id;
    const gid = activeOrg?.group_id;
    if (!oid) { setActiveOrgSharing(false); setActiveGroupMode(null); setActiveOrgMode(null); return undefined; }
    (async () => {
      const keys = [`published:${oid}`];
      if (gid) keys.push(`published:group:${gid}`);
      const { data } = await supabase.from('app_config').select('key, value').in('key', keys);
      if (!alive) return;
      const orgCfg = (data || []).find(r => r.key === `published:${oid}`);
      const grpCfg = gid ? (data || []).find(r => r.key === `published:group:${gid}`) : null;
      setActiveOrgSharing(orgCfg?.value?.settings?.featureCupSharing === true);
      setActiveGroupMode(grpCfg?.value?.settings?.mode || null);
      setActiveOrgMode(orgCfg?.value?.settings?.mode || null);
    })();
    return () => { alive = false; };
  }, [activeOrg?.id, activeOrg?.group_id, modeRefresh]);

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

  // ── Group awareness (Phase 3) ──────────────────────────────────────
  const groupsById = {};
  groups.forEach(g => { groupsById[g.id] = g; });

  const activeGroupId = activeOrg?.group_id || null;
  const activeGroup   = activeGroupId ? (groupsById[activeGroupId] || null) : null;
  const groupMembers  = activeGroupId ? availableOrgs.filter(o => o.group_id === activeGroupId) : [];
  const groupMemberIds = groupMembers.map(o => o.id);

  // The org id(s) analytics should cover, given the current scope toggle.
  const scopeOrgIds =
    (statsScope === 'group' && activeGroupId && groupMemberIds.length)
      ? groupMemberIds
      : (activeOrg?.id ? [activeOrg.id] : []);

  const value = {
    activeOrg,
    activeOrgId:   activeOrg?.id   || null,
    activeOrgSlug: activeOrg?.slug || null,
    availableOrgs,
    status,
    error,
    switchOrg,
    refresh,
    // group awareness
    groups,
    groupsById,
    activeGroup,          // { id, name, slug } | null
    groupMembers,         // full org rows in the active org's group
    groupMemberIds,
    statsScope,           // 'org' | 'group'
    setStatsScope,
    scopeOrgIds,          // org id(s) the analytics pages should query
    activeOrgSharing,     // is cup sharing on for the active org?
    activeGroupMode,      // 'byo' | 'deposit' | null (active org's group)
    activeOrgMode,        // org-level mode: 'tikkie_only' | null
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
