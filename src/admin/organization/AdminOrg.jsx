import { useEffect, useState } from 'react';
import {
  getOrgBundle, updateOrg, upsertLocation, deleteLocation,
  updateTeamMember, inviteAdmin, revokeInvitation,
} from '../lib/adminApi';
import Spinner from '../lib/Spinner';
import PermissionGate from '../auth/PermissionGate';
import { useAuth, hasPermission } from '../auth/AuthContext';
import { logAction } from '../auth/actionLog';
import AdminActivityLog from '../activity/AdminActivityLog';
import QuickLinks from '../shared/QuickLinks';
import './AdminOrg.css';

/* AdminOrg — single page covering:
 *
 *   1. Org info card (legal name, KvK, BTW, address, contact, brand)
 *   2. Locations list with add/edit/delete
 *   3. Team members table — invite / change role / block / delete
 *   4. Pending invitations panel — resend / revoke
 *
 * Edit affordances are gated by the permission matrix (Owner/Admin can
 * edit org + manage team; everyone else sees read-only). */

const ROLE_LABELS = {
  owner:   { label: 'Owner',   color: '#7C3AED', desc: 'Absolute control' },
  admin:   { label: 'Admin',   color: '#FD6F46', desc: 'Full operational access' },
  manager: { label: 'Manager', color: '#5333A5', desc: 'Approve claims, edit rewards' },
  checker: { label: 'Checker', color: '#7A7166', desc: 'Read-only + exports' },
};

export default function AdminOrg({ onNavigate }) {
  const { profile } = useAuth();
  const [bundle, setBundle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    getOrgBundle()
      .then(setBundle)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="org-page"><Spinner label="Loading organisation…" /></div>;
  if (error)   return <div className="org-page"><p className="org-err">{error}</p><QuickLinks currentPage="org" onNavigate={onNavigate} /></div>;
  if (!bundle?.org) {
    return (
      <div className="org-page">
        <p className="org-err">No organisation linked to your account. Ask an owner to invite you.</p>
        <QuickLinks currentPage="org" onNavigate={onNavigate} />
      </div>
    );
  }

  const canEditOrg  = hasPermission(profile.role, 'org.edit');
  const canManage   = hasPermission(profile.role, 'team.invite');

  return (
    <div className="org-page">
      <header className="org-header">
        <h1 className="org-header__title">Organisation</h1>
        <p className="org-header__sub">Profile, locations, and the team that operates this PackPerks programme.</p>
      </header>

      <OrgInfoCard
        org={bundle.org}
        canEdit={canEditOrg}
        onSaved={updated => setBundle(b => ({ ...b, org: updated }))}
      />

      <LocationsSection
        org={bundle.org}
        locations={bundle.locations}
        canEdit={canEditOrg}
        onChange={locations => setBundle(b => ({ ...b, locations }))}
      />

      <TeamSection
        org={bundle.org}
        team={bundle.team}
        invitations={bundle.invitations}
        canManage={canManage}
        currentRole={profile.role}
        currentUserId={profile.id}
        onTeamChange={team => setBundle(b => ({ ...b, team }))}
        onInvitationsChange={invitations => setBundle(b => ({ ...b, invitations }))}
      />

      {/* Activity log lives at the bottom of the Org page so the
       * who-did-what trail sits alongside the team it describes. Owners
       * + admins see every event; lower roles see only their own
       * (RLS-enforced inside AdminActivityLog itself). */}
      <section className="org-card org-card--no-padding">
        <AdminActivityLog embedded />
      </section>

      <QuickLinks currentPage="org" onNavigate={onNavigate} />
    </div>
  );
}

/* ── Org info card ─────────────────────────────────────────────────── */
function OrgInfoCard({ org, canEdit, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(org);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => { setDraft(org); }, [org]);

  async function handleSave() {
    setErr(null); setSaving(true);
    try {
      const before = { ...org };
      const updated = await updateOrg(org.id, {
        name: draft.name?.trim() || org.name,
        legal_name: draft.legal_name?.trim() || null,
        kvk_number: draft.kvk_number?.trim() || null,
        btw_number: draft.btw_number?.trim() || null,
        address: draft.address?.trim() || null,
        postal_code: draft.postal_code?.trim() || null,
        city: draft.city?.trim() || null,
        contact_email: draft.contact_email?.trim() || null,
        contact_phone: draft.contact_phone?.trim() || null,
        website: draft.website?.trim() || null,
        brand_color: draft.brand_color || '#FD6F46',
      });
      onSaved(updated);
      setEditing(false);
      logAction({
        action: 'org.update',
        targetType: 'organization',
        targetId: org.id,
        before, after: updated,
      });
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  if (!editing) {
    return (
      <section className="org-card">
        <div className="org-card__row org-card__row--header">
          <div className="org-card__title-row">
            <span className="org-card__logo" style={{ background: org.brand_color || '#FD6F46' }}>
              {(org.name || 'O')[0]}
            </span>
            <div>
              <h2 className="org-card__title">{org.name}</h2>
              <p className="org-card__sub">{org.legal_name}</p>
            </div>
          </div>
          {canEdit && (
            <button className="org-btn org-btn--ghost" onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
        </div>

        <div className="org-card__grid">
          <Field label="KvK" value={org.kvk_number} mono />
          <Field label="BTW" value={org.btw_number} mono />
          <Field label="Address" value={fullAddress(org)} span={2} />
          <Field label="Contact email" value={org.contact_email} />
          <Field label="Contact phone" value={org.contact_phone} />
          <Field label="Website" value={org.website} />
          <Field label="Brand colour" value={
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 16, height: 16, borderRadius: 4, background: org.brand_color, display: 'inline-block', border: '1px solid #E0DDD8' }} />
              {org.brand_color}
            </span>
          } />
        </div>
      </section>
    );
  }

  return (
    <section className="org-card">
      <div className="org-card__row org-card__row--header">
        <h2 className="org-card__title">Edit organisation</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="org-btn org-btn--ghost" onClick={() => { setEditing(false); setDraft(org); }} disabled={saving}>
            Cancel
          </button>
          <button className="org-btn org-btn--primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <div className="org-card__grid">
        <EditField label="Display name"  value={draft.name}          onChange={v => setDraft(d => ({ ...d, name: v }))} />
        <EditField label="Legal name"    value={draft.legal_name}    onChange={v => setDraft(d => ({ ...d, legal_name: v }))} />
        <EditField label="KvK"           value={draft.kvk_number}    onChange={v => setDraft(d => ({ ...d, kvk_number: v }))} mono />
        <EditField label="BTW"           value={draft.btw_number}    onChange={v => setDraft(d => ({ ...d, btw_number: v }))} mono />
        <EditField label="Address"       value={draft.address}       onChange={v => setDraft(d => ({ ...d, address: v }))} span={2} />
        <EditField label="Postal code"   value={draft.postal_code}   onChange={v => setDraft(d => ({ ...d, postal_code: v }))} />
        <EditField label="City"          value={draft.city}          onChange={v => setDraft(d => ({ ...d, city: v }))} />
        <EditField label="Contact email" value={draft.contact_email} onChange={v => setDraft(d => ({ ...d, contact_email: v }))} type="email" />
        <EditField label="Contact phone" value={draft.contact_phone} onChange={v => setDraft(d => ({ ...d, contact_phone: v }))} />
        <EditField label="Website"       value={draft.website}       onChange={v => setDraft(d => ({ ...d, website: v }))} span={2} />
        <div className="org-field">
          <span className="org-field__label">Brand colour</span>
          <input type="color" value={draft.brand_color || '#FD6F46'} onChange={e => setDraft(d => ({ ...d, brand_color: e.target.value }))} className="org-color-input" />
        </div>
      </div>

      {err && <p className="org-err">{err}</p>}
    </section>
  );
}

/* ── Locations ──────────────────────────────────────────────────────── */
function LocationsSection({ org, locations, canEdit, onChange }) {
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);

  function startNew() {
    setEditingId('new');
    setDraft({ name: '', address: '', postal_code: '', city: '', phone: '', status: 'active' });
  }
  function startEdit(loc) {
    setEditingId(loc.id);
    setDraft({ ...loc });
  }
  async function handleSave() {
    setBusy(true);
    try {
      const before = editingId === 'new' ? null : locations.find(l => l.id === editingId);
      const saved = await upsertLocation(org.id, editingId === 'new' ? draft : draft);
      const next = editingId === 'new'
        ? [...locations, saved]
        : locations.map(l => l.id === saved.id ? saved : l);
      onChange(next);
      logAction({
        action: editingId === 'new' ? 'location.create' : 'location.update',
        targetType: 'location',
        targetId: saved.id,
        before, after: saved,
      });
      setEditingId(null);
      setDraft(null);
    } catch (e) {
      alert(e.message);
    } finally { setBusy(false); }
  }
  async function handleDelete(loc) {
    if (!confirm(`Delete location "${loc.name}"?`)) return;
    setBusy(true);
    try {
      await deleteLocation(loc.id);
      onChange(locations.filter(l => l.id !== loc.id));
      logAction({
        action: 'location.delete',
        targetType: 'location',
        targetId: loc.id,
        before: loc,
      });
    } catch (e) {
      alert(e.message);
    } finally { setBusy(false); }
  }

  return (
    <section className="org-card">
      <div className="org-card__row org-card__row--header">
        <h2 className="org-card__title">Locations <span className="org-card__count">{locations.length}</span></h2>
        {canEdit && (
          <button className="org-btn org-btn--ghost" onClick={startNew} disabled={editingId !== null}>
            + Add location
          </button>
        )}
      </div>

      <table className="org-loc-table">
        <thead>
          <tr><th>Name</th><th>Address</th><th>City</th><th>Phone</th><th>Status</th><th></th></tr>
        </thead>
        <tbody>
          {editingId === 'new' && draft && (
            <LocationEditRow draft={draft} setDraft={setDraft} onSave={handleSave} onCancel={() => { setEditingId(null); setDraft(null); }} busy={busy} />
          )}
          {locations.map(loc =>
            editingId === loc.id && draft ? (
              <LocationEditRow key={loc.id} draft={draft} setDraft={setDraft} onSave={handleSave} onCancel={() => { setEditingId(null); setDraft(null); }} busy={busy} />
            ) : (
              <tr key={loc.id} className="org-loc-row">
                <td><strong>{loc.name}</strong></td>
                <td className="org-muted">{loc.address}{loc.postal_code ? `, ${loc.postal_code}` : ''}</td>
                <td>{loc.city}</td>
                <td className="org-mono">{loc.phone}</td>
                <td><span className={`org-status org-status--${loc.status}`}>{loc.status}</span></td>
                <td style={{ textAlign: 'right' }}>
                  {canEdit && (
                    <>
                      <button className="org-link" onClick={() => startEdit(loc)}>Edit</button>
                      <button className="org-link org-link--danger" onClick={() => handleDelete(loc)}>Delete</button>
                    </>
                  )}
                </td>
              </tr>
            )
          )}
        </tbody>
      </table>
    </section>
  );
}

function LocationEditRow({ draft, setDraft, onSave, onCancel, busy }) {
  return (
    <tr className="org-loc-row org-loc-row--editing">
      <td><input className="org-input" value={draft.name || ''} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} placeholder="e.g. Amsterdam Damrak" autoFocus /></td>
      <td><input className="org-input" value={draft.address || ''} onChange={e => setDraft(d => ({ ...d, address: e.target.value }))} placeholder="Street + nr" /></td>
      <td><input className="org-input" value={draft.city || ''} onChange={e => setDraft(d => ({ ...d, city: e.target.value }))} placeholder="City" /></td>
      <td><input className="org-input" value={draft.phone || ''} onChange={e => setDraft(d => ({ ...d, phone: e.target.value }))} placeholder="+31 …" /></td>
      <td>
        <select className="org-input" value={draft.status} onChange={e => setDraft(d => ({ ...d, status: e.target.value }))}>
          <option value="active">active</option>
          <option value="inactive">inactive</option>
        </select>
      </td>
      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
        <button className="org-btn org-btn--ghost org-btn--xs" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className="org-btn org-btn--primary org-btn--xs" onClick={onSave} disabled={busy || !draft.name?.trim()}>Save</button>
      </td>
    </tr>
  );
}

/* ── Team members ──────────────────────────────────────────────────── */
function TeamSection({ org, team, invitations, canManage, currentRole, currentUserId, onTeamChange, onInvitationsChange }) {
  const [inviteOpen, setInviteOpen] = useState(false);

  async function handleRoleChange(member, newRole) {
    if (!confirm(`Change ${member.email}'s role to "${newRole}"?`)) return;
    try {
      const before = { role: member.role };
      const updated = await updateTeamMember(member.id, { role: newRole });
      onTeamChange(team.map(t => t.id === member.id ? updated : t));
      logAction({
        action: 'team.role',
        targetType: 'admin_profile',
        targetId: member.id,
        before, after: { role: newRole },
        metadata: { target_email: member.email },
      });
    } catch (e) { alert(e.message); }
  }
  async function handleBlock(member) {
    if (!confirm(`Block ${member.email}? They won't be able to sign in.`)) return;
    try {
      const updated = await updateTeamMember(member.id, { status: 'blocked' });
      onTeamChange(team.map(t => t.id === member.id ? updated : t));
      logAction({ action: 'team.block', targetType: 'admin_profile', targetId: member.id, metadata: { target_email: member.email } });
    } catch (e) { alert(e.message); }
  }
  async function handleUnblock(member) {
    try {
      const updated = await updateTeamMember(member.id, { status: 'active' });
      onTeamChange(team.map(t => t.id === member.id ? updated : t));
      logAction({ action: 'team.unblock', targetType: 'admin_profile', targetId: member.id, metadata: { target_email: member.email } });
    } catch (e) { alert(e.message); }
  }
  async function handleSoftDelete(member) {
    if (!confirm(`Remove ${member.email} from the team? Their audit trail is preserved.`)) return;
    try {
      const updated = await updateTeamMember(member.id, { status: 'deleted' });
      onTeamChange(team.filter(t => t.id !== member.id));
      logAction({ action: 'team.delete', targetType: 'admin_profile', targetId: member.id, metadata: { target_email: member.email } });
    } catch (e) { alert(e.message); }
  }
  async function handleRevoke(inv) {
    // Friendly label: for link-mode invites the stored email is a
    // synthetic "link-invite+...@invites.local" placeholder which would
    // make the confirm dialog look broken. Show "shareable link" instead.
    const label = inv.method === 'link' ? 'this shareable link' : inv.email;
    if (!confirm(`Revoke pending invitation for ${label}?`)) return;
    try {
      await revokeInvitation(inv.id);
      onInvitationsChange(invitations.filter(i => i.id !== inv.id));
      logAction({ action: 'team.invite_revoke', targetType: 'admin_invitation', targetId: inv.id, metadata: { email: inv.email, method: inv.method } });
    } catch (e) { alert(e.message); }
  }

  return (
    <section className="org-card">
      <div className="org-card__row org-card__row--header">
        <h2 className="org-card__title">
          Team members <span className="org-card__count">{team.filter(t => t.status !== 'deleted').length}</span>
        </h2>
        <PermissionGate action="team.invite">
          <button className="org-btn org-btn--primary" onClick={() => setInviteOpen(true)}>
            + Invite teammate
          </button>
        </PermissionGate>
      </div>

      <table className="org-team-table">
        <thead>
          <tr><th>Member</th><th>Email</th><th>Role</th><th>Status</th><th>Last login</th><th></th></tr>
        </thead>
        <tbody>
          {team.map(m => (
            <tr key={m.id} className="org-team-row">
              <td>
                <div className="org-member">
                  <span className="org-member__avatar" style={{ background: m.color || '#FD6F46' }}>
                    {m.avatar_url
                      ? <img src={m.avatar_url} alt="" />
                      : (m.display_name || m.email)[0].toUpperCase()}
                  </span>
                  <span className="org-member__name">
                    {m.display_name || '—'}
                    {m.id === currentUserId && <span className="org-you-pill">you</span>}
                  </span>
                </div>
              </td>
              <td className="org-muted">{m.email}</td>
              <td>
                {canManage && m.id !== currentUserId ? (
                  <select
                    className={`org-role-select org-role-select--${m.role}`}
                    value={m.role}
                    onChange={e => handleRoleChange(m, e.target.value)}
                    // Only owners can promote to owner. Non-owners can only set admin/manager/checker.
                    disabled={m.role === 'owner' && currentRole !== 'owner'}
                  >
                    {currentRole === 'owner' && <option value="owner">Owner</option>}
                    <option value="admin">Admin</option>
                    <option value="manager">Manager</option>
                    <option value="checker">Checker</option>
                  </select>
                ) : (
                  <RoleBadge role={m.role} />
                )}
              </td>
              <td>
                <span className={`org-status org-status--${m.status}`}>{m.status}</span>
              </td>
              <td className="org-muted">{m.last_login_at ? new Date(m.last_login_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                {canManage && m.id !== currentUserId && (
                  <>
                    {m.status === 'active' ? (
                      <button className="org-link" onClick={() => handleBlock(m)}>Block</button>
                    ) : m.status === 'blocked' ? (
                      <button className="org-link" onClick={() => handleUnblock(m)}>Unblock</button>
                    ) : null}
                    {currentRole === 'owner' && m.role !== 'owner' && (
                      <button className="org-link org-link--danger" onClick={() => handleSoftDelete(m)}>Remove</button>
                    )}
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {invitations.length > 0 && (
        <div className="org-pending">
          <h3 className="org-pending__title">Pending invitations <span className="org-card__count">{invitations.length}</span></h3>
          <table className="org-team-table">
            <thead>
              <tr><th>Email</th><th>Role</th><th>Invited</th><th>Expires</th><th></th></tr>
            </thead>
            <tbody>
              {invitations.map(inv => (
                <tr key={inv.id}>
                  <td className="org-muted">
                    {/* Link-mode invites have no real recipient email — the
                     * server stores a synthetic placeholder like
                     * "link-invite+abc12345@invites.local" so the row has a
                     * NOT NULL email value. Showing that placeholder to the
                     * admin is confusing; render the actual shareable URL
                     * (with a one-click copy) instead, so it matches what
                     * was offered in the invite modal. */}
                    {inv.method === 'link'
                      ? <InvitationLinkCell token={inv.token} />
                      : inv.email}
                  </td>
                  <td><RoleBadge role={inv.role} /></td>
                  <td className="org-muted">{new Date(inv.invited_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                  <td className="org-muted">{new Date(inv.expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                  <td style={{ textAlign: 'right' }}>
                    {canManage && (
                      <button className="org-link org-link--danger" onClick={() => handleRevoke(inv)}>Revoke</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {inviteOpen && (
        <InviteModal
          onClose={() => setInviteOpen(false)}
          onInvited={(inv) => {
            // Always push the new invitation into the pending list so
            // the parent's UI reflects it immediately. Closing behaviour
            // depends on the method: email invites are fire-and-forget
            // and close the modal, but link invites need to STAY OPEN so
            // the admin can actually see + copy the generated URL — the
            // whole point of link mode. The modal's own "Done" button
            // (or the X) closes it after they're done copying.
            onInvitationsChange([inv, ...invitations]);
            if (inv?.method !== 'link') setInviteOpen(false);
          }}
          allowAdmin={currentRole === 'owner' || currentRole === 'admin'}
        />
      )}
    </section>
  );
}

/* Side-by-side feature matrix shown in the redesigned invite modal so
 * the inviter can see exactly what they're handing out before sending.
 * Order matches the permission tiers; ✓ = granted, — = not granted.   */
const ROLE_FEATURE_MATRIX = [
  { feature: 'View dashboards + reports',  admin: '✓', manager: '✓', checker: '✓' },
  { feature: 'Approve / reject claims',    admin: '✓', manager: '✓', checker: '—' },
  { feature: 'Manage rewards',             admin: '✓', manager: '✓', checker: '—' },
  { feature: 'Generate cup QR codes',      admin: '✓', manager: '✓', checker: '—' },
  { feature: 'Invite team / change roles', admin: '✓', manager: '—', checker: '—' },
  { feature: 'Edit organisation + locations', admin: '✓', manager: '—', checker: '—' },
  { feature: 'View action log',            admin: '✓', manager: '—', checker: '—' },
];

function RoleIcon({ role, size = 28 }) {
  const stroke = 'currentColor';
  const sw = 1.8;
  if (role === 'admin')
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2 4 6v6c0 5 3.5 9 8 10 4.5-1 8-5 8-10V6Z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    );
  if (role === 'manager')
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    );
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function InviteModal({ onClose, onInvited, allowAdmin }) {
  const [method, setMethod] = useState('email'); // 'email' | 'link'
  const [email, setEmail]   = useState('');
  const [role, setRole]     = useState('checker');
  const [singleUse, setSingleUse] = useState(true);
  const [busy, setBusy]     = useState(false);
  const [err, setErr]       = useState(null);
  const [linkResult, setLinkResult] = useState(null);
  // { url, token, single_use, expires_at } once a link has been generated.
  const [copied, setCopied] = useState(false);

  function buildInviteUrl(token) {
    if (typeof window === 'undefined' || !token) return '';
    return `${window.location.origin}/admin?invite=${token}`;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setErr(null); setBusy(true);
    try {
      const inv = await inviteAdmin({
        email: email.trim().toLowerCase(),
        role,
        method,
        single_use: singleUse,
      });
      if (method === 'link') {
        // Stay open and reveal the generated URL for the admin to copy.
        // The parent gets the row too so the pending-invitations list
        // updates in the background.
        setLinkResult({
          url: buildInviteUrl(inv?.token),
          token: inv?.token,
          single_use: inv?.single_use,
          expires_at: inv?.expires_at,
        });
        onInvited(inv);
      } else {
        onInvited(inv);
      }
    } catch (ex) {
      setErr(ex?.detail?.detail || ex?.message || 'Could not send invite.');
    } finally { setBusy(false); }
  }

  async function handleCopy() {
    if (!linkResult?.url) return;
    try {
      await navigator.clipboard.writeText(linkResult.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Fallback for browsers without permission — select the field
      // contents so the admin can ⌘C manually.
    }
  }

  function handleGenerateAnother() {
    setLinkResult(null);
    setCopied(false);
    setErr(null);
  }

  return (
    <div className="invite-overlay" onClick={onClose}>
      <form className="invite-modal" onClick={e => e.stopPropagation()} onSubmit={handleSubmit}>
        <header className="invite-modal__header">
          <div className="invite-modal__header-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <line x1="20" y1="8" x2="20" y2="14"/>
              <line x1="23" y1="11" x2="17" y2="11"/>
            </svg>
          </div>
          <div>
            <h3 className="invite-modal__title">Invite a teammate</h3>
            <p className="invite-modal__sub">
              {method === 'email'
                ? <>We'll email them a sign-in link. They'll join <strong>Burger King Netherlands</strong> with the role you pick below.</>
                : <>We'll generate a shareable URL. Send it through Slack, WhatsApp, or wherever — anyone with the link can self-onboard into <strong>Burger King Netherlands</strong>.</>}
            </p>
          </div>
          <button type="button" className="invite-modal__close" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="invite-modal__body">
          {/* Method tabs — Email vs Link. */}
          <div className="invite-method" role="tablist" aria-label="Invite method">
            <button
              type="button"
              role="tab"
              aria-selected={method === 'email'}
              className={`invite-method__tab${method === 'email' ? ' invite-method__tab--active' : ''}`}
              onClick={() => { setMethod('email'); setLinkResult(null); }}
              disabled={busy}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <path d="m22 7-10 5L2 7" />
              </svg>
              Email
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={method === 'link'}
              className={`invite-method__tab${method === 'link' ? ' invite-method__tab--active' : ''}`}
              onClick={() => { setMethod('link'); setLinkResult(null); }}
              disabled={busy}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
              Shareable link
            </button>
          </div>

          {/* Email mode — input. Link mode w/o email — skip the field
           *  entirely (recipient identifies themselves on first
           *  sign-in). Admin can still optionally pre-fill an email
           *  for record-keeping in link mode. */}
          <label className="invite-field">
            <span className="invite-field__label">
              {method === 'email'
                ? 'Email address'
                : 'Email (optional — helps track who you sent it to)'}
            </span>
            <input
              className="invite-input"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder={method === 'email' ? 'teammate@burgerking.nl' : 'Leave blank to skip'}
              required={method === 'email'}
              autoFocus
              disabled={busy || !!linkResult}
            />
          </label>

          <div className="invite-field">
            <span className="invite-field__label">Role</span>
            <div className="invite-role-grid" role="radiogroup">
              {['checker', 'manager', 'admin'].map(r => (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={role === r}
                  className={`invite-role-card${role === r ? ' invite-role-card--active' : ''}`}
                  onClick={() => setRole(r)}
                  disabled={busy || (r === 'admin' && !allowAdmin)}
                  style={{ '--role-color': ROLE_LABELS[r].color }}
                >
                  <span className="invite-role-card__icon" style={{ background: ROLE_LABELS[r].color }}>
                    <RoleIcon role={r} size={22} />
                  </span>
                  <span className="invite-role-card__name">{ROLE_LABELS[r].label}</span>
                  <span className="invite-role-card__desc">{ROLE_LABELS[r].desc}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="invite-matrix">
            <div className="invite-matrix__title">What each role can do</div>
            <table className="invite-matrix__table">
              <thead>
                <tr>
                  <th></th>
                  <th className={role === 'checker' ? 'invite-matrix__th--active' : ''}>Checker</th>
                  <th className={role === 'manager' ? 'invite-matrix__th--active' : ''}>Manager</th>
                  <th className={role === 'admin'   ? 'invite-matrix__th--active' : ''}>Admin</th>
                </tr>
              </thead>
              <tbody>
                {ROLE_FEATURE_MATRIX.map(row => (
                  <tr key={row.feature}>
                    <td className="invite-matrix__feature">{row.feature}</td>
                    <td className={`invite-matrix__cell invite-matrix__cell--${row.checker === '✓' ? 'yes' : 'no'} ${role === 'checker' ? 'invite-matrix__cell--active' : ''}`}>{row.checker}</td>
                    <td className={`invite-matrix__cell invite-matrix__cell--${row.manager === '✓' ? 'yes' : 'no'} ${role === 'manager' ? 'invite-matrix__cell--active' : ''}`}>{row.manager}</td>
                    <td className={`invite-matrix__cell invite-matrix__cell--${row.admin === '✓' ? 'yes' : 'no'} ${role === 'admin' ? 'invite-matrix__cell--active' : ''}`}>{row.admin}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Link-mode-only one-time toggle. Default ON: the link
           *  burns out on first successful sign-in. Flip OFF for a
           *  durable link (e.g. paste in the team handbook). */}
          {method === 'link' && !linkResult && (
            <label className="invite-toggle">
              <input
                type="checkbox"
                checked={singleUse}
                onChange={e => setSingleUse(e.target.checked)}
                disabled={busy}
              />
              <span className="invite-toggle__body">
                <span className="invite-toggle__title">One-time link</span>
                <span className="invite-toggle__desc">
                  {singleUse
                    ? 'Burns out the moment someone uses it. Recommended.'
                    : 'Anyone with this URL can self-onboard until it expires in 14 days.'}
                </span>
              </span>
            </label>
          )}

          {/* Generated-link result — replaces the form footer once
           *  the admin clicks "Generate link". */}
          {linkResult && (
            <div className="invite-link-result">
              <div className="invite-link-result__head">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
                <div>
                  <div className="invite-link-result__title">Invitation link ready</div>
                  <div className="invite-link-result__sub">
                    {linkResult.single_use ? 'One-time use' : 'Multi-use'} · expires{' '}
                    {linkResult.expires_at ? new Date(linkResult.expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'in 14 days'}
                  </div>
                </div>
              </div>
              <div className="invite-link-result__row">
                <input
                  className="invite-input invite-input--mono"
                  value={linkResult.url}
                  readOnly
                  onFocus={e => e.target.select()}
                />
                <button
                  type="button"
                  className={`org-btn ${copied ? 'org-btn--success' : 'org-btn--primary'}`}
                  onClick={handleCopy}
                >
                  {copied ? '✓ Copied' : 'Copy link'}
                </button>
              </div>
              <p className="invite-link-result__hint">
                Share it through Slack, WhatsApp, or wherever your team hangs out. Whoever clicks first
                {linkResult.single_use ? ' (and only they) will join the org' : ' will join — the link stays live for everyone else too'}.
              </p>
            </div>
          )}

          {err && <p className="org-err">{err}</p>}
        </div>

        <div className="invite-modal__actions">
          {linkResult ? (
            <>
              <button type="button" className="org-btn org-btn--ghost" onClick={handleGenerateAnother} disabled={busy}>
                Generate another
              </button>
              <button type="button" className="org-btn org-btn--primary" onClick={onClose}>
                Done
              </button>
            </>
          ) : (
            <>
              <button type="button" className="org-btn org-btn--ghost" onClick={onClose} disabled={busy}>Cancel</button>
              <button
                type="submit"
                className="org-btn org-btn--primary"
                disabled={busy || (method === 'email' && !email)}
              >
                {busy
                  ? (method === 'email' ? 'Sending…' : 'Generating…')
                  : (method === 'email' ? 'Send invitation' : 'Generate link')}
              </button>
            </>
          )}
        </div>
      </form>
    </div>
  );
}

/* ── Tiny helpers ──────────────────────────────────────────────────── */
function Field({ label, value, mono, span }) {
  return (
    <div className="org-field" style={span ? { gridColumn: `span ${span}` } : undefined}>
      <span className="org-field__label">{label}</span>
      <span className={`org-field__val${mono ? ' org-field__val--mono' : ''}`}>{value || '—'}</span>
    </div>
  );
}
function EditField({ label, value, onChange, mono, span, type = 'text' }) {
  return (
    <div className="org-field" style={span ? { gridColumn: `span ${span}` } : undefined}>
      <span className="org-field__label">{label}</span>
      <input
        type={type}
        className={`org-input${mono ? ' org-input--mono' : ''}`}
        value={value || ''}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  );
}
function RoleBadge({ role }) {
  const meta = ROLE_LABELS[role] || { label: role, color: '#7A7166' };
  return <span className="org-role-badge" style={{ background: meta.color }}>{meta.label}</span>;
}

/* Inline display for link-mode invitations in the pending list.
 * Shows the full shareable URL (truncated visually but selectable in
 * full on focus) plus a one-click Copy. Falls back to a plain label
 * if the token is missing for some reason — old rows from before
 * migration 010 won't have one. */
function InvitationLinkCell({ token }) {
  const [copied, setCopied] = useState(false);
  if (!token) return <span className="org-muted">Shareable link (legacy)</span>;
  const url = typeof window === 'undefined'
    ? `/admin?invite=${token}`
    : `${window.location.origin}/admin?invite=${token}`;
  async function handleCopy(e) {
    e.preventDefault(); e.stopPropagation();
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {/* best-effort */}
  }
  return (
    <div className="org-invite-link-cell">
      <input
        type="text"
        className="org-invite-link-cell__input"
        value={url}
        readOnly
        onFocus={e => e.target.select()}
        aria-label="Invitation URL"
      />
      <button
        type="button"
        className={`org-invite-link-cell__copy${copied ? ' org-invite-link-cell__copy--ok' : ''}`}
        onClick={handleCopy}
        title="Copy invitation link"
      >
        {copied ? '✓' : 'Copy'}
      </button>
    </div>
  );
}

function fullAddress(o) {
  return [o.address, o.postal_code, o.city].filter(Boolean).join(', ');
}
