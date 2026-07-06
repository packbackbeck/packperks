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
        <div className="ao-header__actions">
          <button
            className="ao-btn ao-btn--mockup"
            onClick={() => window.open('/mockup', '_blank', 'noopener')}
            title="Open MockupMaster — build a pitch mockup without creating an org"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="6" y="2" width="12" height="20" rx="3" />
              <line x1="10" y1="18" x2="14" y2="18" />
            </svg>
            MockupMaster
          </button>
          <button className="ao-btn ao-btn--primary" onClick={onAddOrg}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Add organisation
          </button>
        </div>
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
                          <button className="ao-action ao-action--primary" onClick={() => handleOpen(org.id)}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" /></svg>
                            <span>Open settings</span>
                          </button>
                        )}
                        {!isDeleted && !isActive && (
                          <button className="ao-action" onClick={() => handleSwitch(org.id)}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></svg>
                            <span>Switch to</span>
                          </button>
                        )}
                        {!isDeleted && (
                          <button
                            className="ao-action"
                            onClick={() => handleDuplicate(org.id)}
                            disabled={duplicatingId === org.id}
                            title="Create a new org with this org's settings, copy, and rewards. Stats start empty."
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                            <span>{duplicatingId === org.id ? 'Duplicating…' : 'Duplicate'}</span>
                          </button>
                        )}
                        {!isDeleted && (
                          <button
                            className="ao-action ao-action--danger"
                            onClick={() => setConfirmDelete({ id: org.id, name: org.name })}
                            disabled={orgs.filter(o => !o.deleted_at).length <= 1}
                            title={orgs.filter(o => !o.deleted_at).length <= 1 ? "Can't delete the last active org" : ''}
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                            <span>Soft delete</span>
                          </button>
                        )}
                        {isDeleted && (
                          <button className="ao-action" onClick={() => handleRestore(org.id)}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></svg>
                            <span>Restore</span>
                          </button>
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
