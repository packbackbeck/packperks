import { useCallback, useEffect, useMemo, useState } from 'react';
import { listAllOrganizations, listOrgGroups, softDeleteOrganization, restoreOrganization, duplicateOrganization } from '../lib/adminApi';
import { useOrg } from '../context/OrgContext';
import OrgGroupsPanel from './OrgGroupsPanel';
import './AdminOrganizations.css';

/* ─────────────────────────────────────────────────────────────────────
 * AdminOrganizations — PackPerks-staff-only page for managing the
 * roster of client organisations.
 *
 * Visible columns:
 *   • Brand colour swatch
 *   • Name
 *   • Slug (URL path on the user app)
 *   • Status (Active / Deleted / Current)
 *   • Created date
 *
 * Per-row actions:
 *   • Switch to        — make this the active org (sidebar switcher follows)
 *   • Edit             — TODO Phase 6+: opens the wizard pre-filled
 *   • Soft delete      — flips deleted_at, hides from switcher
 *   • Restore          — only on already-deleted rows
 *
 * Top of page:
 *   • Header + Add-organisation primary button (calls onAddOrg)
 *
 * Confirm gates: soft delete asks for confirmation since it removes
 * the org from the switcher and (in Phase 6) stops serving the user
 * app slug. Underlying data stays untouched.
 * ───────────────────────────────────────────────────────────────────── */

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return iso;
  }
}

export default function AdminOrganizations({ onAddOrg, onNavigate }) {
  const { activeOrgId, switchOrg, refresh } = useOrg();
  const [orgs, setOrgs]       = useState([]);
  const [groups, setGroups]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null); // {id, name}
  const [duplicatingId, setDuplicatingId] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, grps] = await Promise.all([listAllOrganizations(), listOrgGroups()]);
      setOrgs(list);
      setGroups(grps);
    } catch (e) {
      console.error(e);
      setError(e.message || 'Failed to load organisations.');
    } finally {
      setLoading(false);
    }
  }, []);

  // group_id → { name, mode } for the per-row group chip.
  const groupById = useMemo(() => {
    const m = {};
    groups.forEach(g => { m[g.id] = g; });
    return m;
  }, [groups]);

  useEffect(() => { load(); }, [load]);

  async function handleSoftDelete(id) {
    try {
      await softDeleteOrganization(id);
      await load();
      await refresh();
      setConfirmDelete(null);
    } catch (e) {
      setError(e.message || 'Could not soft-delete.');
    }
  }

  async function handleRestore(id) {
    try {
      await restoreOrganization(id);
      await load();
      await refresh();
    } catch (e) {
      setError(e.message || 'Could not restore.');
    }
  }

  async function handleSwitch(id) {
    switchOrg(id);
  }

  /* Clone an org's config (brand, settings, copy, rewards, budget cap,
   * locations) into a fresh org. No users / scans / transfers / claims are
   * copied, so the duplicate starts with clean stats. */
  async function handleDuplicate(id) {
    setDuplicatingId(id);
    setError(null);
    setNotice(null);
    try {
      const newOrg = await duplicateOrganization(id);
      await load();
      await refresh();
      setNotice(`Created “${newOrg.name}” (slug: ${newOrg.slug}). Settings and rewards copied; users, scans, transfers, and claims start empty.`);
      setTimeout(() => setNotice(null), 6000);
    } catch (e) {
      console.error('duplicate org failed', e);
      setError(e.message || 'Could not duplicate the organisation.');
    } finally {
      setDuplicatingId(null);
    }
  }

  /* Click-through to the per-org settings page. Switches to the org
   * first (so the AdminOrg page loads that org's bundle), then
   * navigates to the 'org' tab — same destination as the OrgBadge /
   * sidebar shortcut, but starting from a list of all orgs. */
  function handleOpen(id) {
    if (id !== activeOrgId) switchOrg(id);
    onNavigate?.('org');
  }

  return (
    <div className="admin-organizations">
      <header className="ao-header">
        <div>
          <span className="ao-eyebrow">PackPerks staff</span>
          <h1 className="ao-title">Organisations</h1>
          <p className="ao-sub">
            Add new client brands, switch between them, or take an org offline.
            Soft-deleting only hides the org from the switcher and the user app —
            data is preserved and can be restored.
          </p>
        </div>
        <button className="ao-btn ao-btn--primary" onClick={onAddOrg}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Add organisation
        </button>
      </header>

      {error && <div className="ao-error">{error}</div>}
      {notice && <div className="ao-notice">{notice}</div>}

      {loading ? (
        <div className="ao-skeleton">Loading…</div>
      ) : orgs.length === 0 ? (
        <div className="ao-empty">
          <h3>No organisations yet.</h3>
          <p>Create your first one to get started.</p>
          <button className="ao-btn ao-btn--primary" onClick={onAddOrg}>Add organisation</button>
        </div>
      ) : (
        <div className="ao-table-wrap">
          <table className="ao-table">
            <thead>
              <tr>
                <th>Org</th>
                <th>Slug</th>
                <th>Status</th>
                <th>Created</th>
                <th className="ao-th-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {orgs.map(org => {
                const isActive  = org.id === activeOrgId;
                const isDeleted = !!org.deleted_at;
                return (
                  <tr
                    key={org.id}
                    className={`${isDeleted ? 'ao-row--deleted' : ''} ${!isDeleted ? 'ao-row--clickable' : ''}`}
                    onClick={!isDeleted ? () => handleOpen(org.id) : undefined}
                    title={!isDeleted ? `Open ${org.name} settings` : ''}
                  >
                    <td>
                      <div className="ao-org-cell">
                        {org.logo_url ? (
                          <img
                            src={org.logo_url}
                            alt={org.name}
                            className="ao-swatch ao-swatch--img"
                          />
                        ) : (
                          <span
                            className="ao-swatch"
                            style={{ background: org.brand_color || '#FD6F46' }}
                          >
                            <span className="ao-swatch__letter">
                              {(org.name || 'O').charAt(0).toUpperCase()}
                            </span>
                          </span>
                        )}
                        <div>
                          <div className="ao-org-name">{org.name}</div>
                          {org.partner_brand_name && org.partner_brand_name !== org.name && (
                            <div className="ao-org-partner">{org.partner_brand_name}</div>
                          )}
                          {org.group_id && groupById[org.group_id] && (
                            <span
                              className={`ao-group-chip ao-group-chip--${groupById[org.group_id].mode}`}
                              title={`In group “${groupById[org.group_id].name}”${org.group_active === false ? ' · hidden from Stores list' : ''}`}
                            >
                              {groupById[org.group_id].name}
                              {org.group_active === false && <span className="ao-group-chip__off">hidden</span>}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td><code className="ao-slug">/{org.slug}/</code></td>
                    <td>
                      {isDeleted ? (
                        <span className="ao-pill ao-pill--deleted">Deleted</span>
                      ) : isActive ? (
                        <span className="ao-pill ao-pill--active">Current</span>
                      ) : (
                        <span className="ao-pill ao-pill--active-org">Active</span>
                      )}
                    </td>
                    <td className="ao-date">{formatDate(org.created_at)}</td>
                    <td onClick={e => e.stopPropagation()}>
                      <div className="ao-actions">
                        {!isDeleted && (
                          <button className="ao-action" onClick={() => handleOpen(org.id)}>
                            Open settings
                          </button>
                        )}
                        {!isDeleted && !isActive && (
                          <button className="ao-action" onClick={() => handleSwitch(org.id)}>Switch to</button>
                        )}
                        {!isDeleted && (
                          <button
                            className="ao-action"
                            onClick={() => handleDuplicate(org.id)}
                            disabled={duplicatingId === org.id}
                            title="Create a new org with this org's settings, copy, and rewards. Stats start empty."
                          >
                            {duplicatingId === org.id ? 'Duplicating…' : 'Duplicate'}
                          </button>
                        )}
                        {!isDeleted && (
                          <button
                            className="ao-action ao-action--danger"
                            onClick={() => setConfirmDelete({ id: org.id, name: org.name })}
                            disabled={orgs.filter(o => !o.deleted_at).length <= 1}
                            title={orgs.filter(o => !o.deleted_at).length <= 1 ? "Can't delete the last active org" : ''}
                          >
                            Soft delete
                          </button>
                        )}
                        {isDeleted && (
                          <button className="ao-action" onClick={() => handleRestore(org.id)}>Restore</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && <OrgGroupsPanel orgs={orgs} groups={groups} onChanged={load} />}

      {confirmDelete && (
        <div className="ao-modal-backdrop" onClick={() => setConfirmDelete(null)}>
          <div className="ao-modal" onClick={e => e.stopPropagation()}>
            <h3>Soft-delete &ldquo;{confirmDelete.name}&rdquo;?</h3>
            <p>
              The organisation will be hidden from the switcher and the user app will
              stop serving its slug. <strong>All claims, users, cups, and history stay
              in the database</strong> — you can restore the org any time.
            </p>
            <div className="ao-modal__actions">
              <button className="ao-btn ao-btn--ghost" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="ao-btn ao-btn--danger" onClick={() => handleSoftDelete(confirmDelete.id)}>
                Soft delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
