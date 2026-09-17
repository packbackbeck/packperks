import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { logAction } from '../auth/actionLog';
import { AccessCtx } from './accessCtx';
import { BUILT_IN_ROLES, LEVEL_ORDER, WORKSPACE_KEY, accessFor, normalizeRole } from '../lib/access';

/* ─────────────────────────────────────────────────────────────────────
 * AccessContext — the signed-in account's role, tab permissions and
 * organisations, plus the workspace-wide tab switches (Master Settings →
 * Workspace). Roles come from `admin_roles`; if that table can't be read
 * the built-in master / manager / vendor roles apply.
 * ───────────────────────────────────────────────────────────────────── */

async function fetchAccessData() {
  const [rolesRes, wsRes] = await Promise.all([
    supabase.from('admin_roles').select('*'),
    supabase.from('app_config').select('value').eq('key', WORKSPACE_KEY).maybeSingle(),
  ]);
  return { rolesRes, wsRes };
}

const builtInMap = () => Object.fromEntries(
  Object.values(BUILT_IN_ROLES).map(r => [r.key, normalizeRole({ ...r, built_in: true })]),
);

export function AccessProvider({ children }) {
  const { profile } = useAuth();
  const [roles, setRoles] = useState(builtInMap);
  const [rolesSource, setRolesSource] = useState('built-in');
  const [rolesError, setRolesError] = useState(null);
  const [workspace, setWorkspace] = useState({});
  const [loaded, setLoaded] = useState(false);

  const apply = useCallback(({ rolesRes, wsRes }) => {
    setRolesError(rolesRes.error?.message || null);
    if (!rolesRes.error && Array.isArray(rolesRes.data) && rolesRes.data.length) {
      const map = builtInMap();
      for (const row of rolesRes.data) {
        const r = normalizeRole(row);
        if (r) map[r.key] = r;
      }
      setRoles(map);
      setRolesSource('database');
    }
    if (!wsRes.error) setWorkspace(wsRes.data?.value?.tabs || {});
    setLoaded(true);
  }, []);

  const reload = useCallback(() => fetchAccessData().then(apply), [apply]);

  useEffect(() => {
    if (!profile) return undefined;
    let alive = true;
    fetchAccessData().then(res => { if (alive) apply(res); });
    return () => { alive = false; };
  }, [profile, apply]);

  const access = useMemo(() => accessFor(profile, roles), [profile, roles]);

  const rolesList = useMemo(() => Object.values(roles).sort((a, b) => (
    LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level)
    || Number(b.builtIn) - Number(a.builtIn)
    || a.label.localeCompare(b.label)
  )), [roles]);

  /* Master Settings writes. Each returns { error } rather than throwing. */
  const saveRole = useCallback(async (role) => {
    const row = {
      key: role.key,
      label: role.label,
      level: role.level,
      description: role.description || '',
      tabs: role.tabs || {},
      built_in: !!role.builtIn,
      updated_at: new Date().toISOString(),
      updated_by: profile?.id || null,
    };
    const { error } = await supabase.from('admin_roles').upsert(row, { onConflict: 'key' });
    if (!error) {
      logAction({ action: 'role.save', targetType: 'admin_role', targetId: role.key, before: roles[role.key] || null, after: row });
      await reload();
    }
    return { error: error?.message || null };
  }, [profile?.id, reload, roles]);

  const deleteRole = useCallback(async (key) => {
    const { error } = await supabase.from('admin_roles').delete().eq('key', key);
    if (!error) {
      logAction({ action: 'role.delete', targetType: 'admin_role', targetId: key, before: roles[key] || null });
      await reload();
    }
    return { error: error?.message || null };
  }, [reload, roles]);

  const saveWorkspace = useCallback(async (tabs) => {
    const { error } = await supabase.from('app_config').upsert(
      { key: WORKSPACE_KEY, value: { tabs, updated_at: new Date().toISOString(), updated_by: profile?.email || null } },
      { onConflict: 'key' },
    );
    if (!error) {
      logAction({ action: 'workspace.tabs', targetType: 'app_config', targetId: WORKSPACE_KEY, before: workspace, after: tabs });
      setWorkspace(tabs);
    }
    return { error: error?.message || null };
  }, [profile?.email, workspace]);

  const value = {
    access,
    roles,
    rolesList,
    rolesSource,
    rolesError,
    workspace,
    loaded,
    reload,
    saveRole,
    deleteRole,
    saveWorkspace,
  };
  return <AccessCtx.Provider value={value}>{children}</AccessCtx.Provider>;
}
