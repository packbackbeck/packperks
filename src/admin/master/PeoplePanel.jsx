import { useCallback, useEffect, useMemo, useState } from 'react';
import { Ban, Copy, MailPlus, MoreHorizontal, Pencil, RotateCcw, Search, UserMinus, UserPlus, Users, X } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useAccess } from '../context/accessCtx';
import { OrgAvatar } from '../context/OrgSwitcher';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Menu, MenuItem, MenuSeparator, Modal, Segmented } from '../ui';
import AccessEditor from './AccessEditor';
import { daysUntil, invitePerson, listPeople, relativeTime, revokeInvite, setPersonStatus, updatePersonAccess } from './masterApi';

const AVATAR_TONES = ['#5B3FD6', '#0E9E74', '#E8930C', '#1F8FCE', '#E03E6B', '#0F8A7E', '#8B6CFF', '#E2552B'];

function initials(p) {
  const base = (p.name || p.email || '?').trim();
  const parts = base.split(/[\s._@-]+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : base.slice(0, 2)).toUpperCase();
}
function toneFor(key) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (31 * h + key.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

export default function PeoplePanel({ orgs, groupsById }) {
  const { profile } = useAuth();
  const { rolesList, roles } = useAccess();
  const [people, setPeople] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [editing, setEditing] = useState(null);   // { person, value, name }
  const [adding, setAdding] = useState(null);     // { email, value }
  const [confirm, setConfirm] = useState(null);   // { kind, person }
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    try {
      setPeople(await listPeople());
      setError(null);
    } catch (e) {
      setError(e?.message || 'Could not load people.');
      setPeople([]);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    listPeople()
      .then(list => { if (alive) setPeople(list); })
      .catch(e => { if (alive) { setError(e?.message || 'Could not load people.'); setPeople([]); } });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(null), 3500);
    return () => clearTimeout(t);
  }, [notice]);

  const orgById = useMemo(() => Object.fromEntries(orgs.map(o => [o.id, o])), [orgs]);
  const levelOf = (p) => roles[p.roleKey]?.level || 'manager';

  const counts = useMemo(() => {
    const c = { all: 0, master: 0, manager: 0, vendor: 0, invited: 0 };
    for (const p of people || []) {
      c.all += 1;
      if (p.kind === 'invite') c.invited += 1;
      else c[roles[p.roleKey]?.level || 'manager'] += 1;
    }
    return c;
  }, [people, roles]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (people || [])
      .filter(p => filter === 'all'
        || (filter === 'invited' ? p.kind === 'invite' : p.kind === 'account' && (roles[p.roleKey]?.level || 'manager') === filter))
      .filter(p => !q || `${p.name || ''} ${p.email || ''}`.toLowerCase().includes(q));
  }, [people, query, filter, roles]);

  async function saveEdit() {
    const { person, value, name } = editing;
    if (!value.allOrgs && roles[value.roleKey]?.level !== 'master' && value.orgIds.length === 0) {
      setFormError('Pick at least one organisation, or switch on all organisations.');
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await updatePersonAccess(person, { ...value, name });
      setEditing(null);
      setNotice(`${person.name || person.email || 'Invitation'} updated.`);
      await load();
    } catch (e) {
      setFormError(friendlyDbError(e));
    } finally {
      setBusy(false);
    }
  }

  async function sendInvite() {
    const role = roles[adding.value.roleKey];
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adding.email.trim())) {
      setFormError('Enter the email address they sign in with.');
      return;
    }
    if (!role) { setFormError('Pick a role.'); return; }
    if (role.level !== 'master' && !adding.value.allOrgs && adding.value.orgIds.length === 0) {
      setFormError('Pick at least one organisation, or switch on all organisations.');
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await invitePerson({ email: adding.email, role, orgIds: adding.value.orgIds, allOrgs: adding.value.allOrgs });
      setAdding(null);
      setNotice(`Invitation sent to ${adding.email.trim().toLowerCase()}.`);
      await load();
    } catch (e) {
      setFormError(e?.message || 'Could not send the invitation.');
    } finally {
      setBusy(false);
    }
  }

  async function runConfirm() {
    const { kind, person } = confirm;
    setBusy(true);
    try {
      if (kind === 'revoke') await revokeInvite(person);
      if (kind === 'block') await setPersonStatus(person, 'blocked');
      if (kind === 'remove') await setPersonStatus(person, 'deleted');
      setConfirm(null);
      await load();
    } catch (e) {
      setError(friendlyDbError(e));
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  }

  async function unblock(person) {
    try {
      await setPersonStatus(person, 'active');
      await load();
    } catch (e) {
      setError(friendlyDbError(e));
    }
  }

  const defaultRoleKey = roles.manager ? 'manager' : rolesList[0]?.key;

  return (
    <Card>
      <CardHeader
        title="People"
        icon={Users}
        subtitle="Everyone with dashboard access, their role, and the organisations they see."
        ruled
        actions={(
          <>
            <span className="ms-search ms-search--card">
              <Search size={14} aria-hidden="true" />
              <input
                className="ms-search__input"
                placeholder="Search people"
                value={query}
                onChange={e => setQuery(e.target.value)}
                aria-label="Search people"
              />
              {query && (
                <button type="button" className="ms-search__clear" aria-label="Clear search" onClick={() => setQuery('')}>
                  <X size={13} />
                </button>
              )}
            </span>
            <Button
              variant="primary"
              icon={UserPlus}
              onClick={() => { setFormError(null); setAdding({ email: '', value: { roleKey: defaultRoleKey, orgIds: [], allOrgs: false } }); }}
            >
              Add person
            </Button>
          </>
        )}
      >
        <div className="ms-filters">
          <Segmented
            ariaLabel="Filter people"
            value={filter}
            onChange={setFilter}
            options={[
              { id: 'all', label: 'Everyone', count: counts.all },
              { id: 'master', label: 'Masters', count: counts.master },
              { id: 'manager', label: 'Managers', count: counts.manager },
              { id: 'vendor', label: 'Vendors', count: counts.vendor },
              { id: 'invited', label: 'Invited', count: counts.invited },
            ]}
          />
        </div>
      </CardHeader>
      <CardBody flush>
        {error && <p className="ms-error ms-pad" role="alert">{error}</p>}
        {notice && <p className="ms-ok ms-pad" role="status">{notice}</p>}
        {people === null ? (
          <p className="ms-hint ms-pad">Loading people…</p>
        ) : shown.length === 0 ? (
          <EmptyState icon={Users} title={query ? 'Nobody matches that search' : 'Nobody here yet'}>
            {query ? 'Try a name or an email address.' : 'Add a person to give them dashboard access.'}
          </EmptyState>
        ) : (
          <div className="ms-table-wrap">
            <table className="ui-table ms-people">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Role</th>
                  <th>Organisations</th>
                  <th>Status</th>
                  <th>Last active</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {shown.map(p => {
                  const role = roles[p.roleKey];
                  const level = levelOf(p);
                  const self = p.kind === 'account' && p.id === profile?.id;
                  const isOwner = p.legacyRole === 'owner';
                  const canTouch = !self && (!isOwner || profile?.role === 'owner');
                  const orgChips = p.orgIds.map(id => orgById[id]).filter(Boolean);
                  return (
                    <tr key={p.key} className={p.status === 'blocked' ? 'ms-row--muted' : ''}>
                      <td>
                        <div className="ms-person">
                          <span
                            className={`ms-avatar${p.kind === 'invite' ? ' ms-avatar--invite' : ''}`}
                            style={p.kind === 'invite' ? undefined : { background: p.color && p.color !== '#E24400' ? p.color : toneFor(p.email || p.key) }}
                            aria-hidden="true"
                          >
                            {p.kind === 'invite' ? <MailPlus size={15} /> : p.avatarUrl ? <img src={p.avatarUrl} alt="" /> : initials(p)}
                          </span>
                          <span className="ms-person__text">
                            <span className="ms-person__name">
                              {p.name || (p.kind === 'invite' ? (p.email || 'Shareable link') : p.email)}
                              {self && <Badge tone="primary">You</Badge>}
                              {isOwner && <Badge tone="neutral">Owner</Badge>}
                            </span>
                            {p.name && <span className="ms-person__email">{p.email}</span>}
                            {!p.name && p.kind === 'account' && <span className="ms-person__email">No name yet</span>}
                            {p.kind === 'invite' && <span className="ms-person__email">Invited {relativeTime(p.invitedAt)}</span>}
                          </span>
                        </div>
                      </td>
                      <td>
                        <span className={`ms-role-chip ms-role-chip--${level}`}>
                          <span className={`ms-level-dot ms-level-dot--${level}`} aria-hidden="true" />
                          {role?.label || p.roleKey.charAt(0).toUpperCase() + p.roleKey.slice(1).replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td>
                        {level === 'master' || p.allOrgs ? (
                          <span className="ms-chip ms-chip--all">All organisations</span>
                        ) : orgChips.length === 0 ? (
                          <span className="ms-chip ms-chip--warn">None — sees nothing</span>
                        ) : (
                          <span className="ms-org-chips">
                            {orgChips.slice(0, 3).map(o => (
                              <span key={o.id} className="ms-org-chip" title={o.name}>
                                <OrgAvatar org={o} size={18} />
                                <span>{o.name}</span>
                              </span>
                            ))}
                            {orgChips.length > 3 && (
                              <span className="ms-chip" title={orgChips.slice(3).map(o => o.name).join(', ')}>+{orgChips.length - 3}</span>
                            )}
                          </span>
                        )}
                      </td>
                      <td>
                        {p.kind === 'invite' ? (
                          <Badge tone="info">Invited · {daysUntil(p.expiresAt)}d left</Badge>
                        ) : p.status === 'blocked' ? (
                          <Badge tone="danger">Blocked</Badge>
                        ) : (
                          <Badge tone="success">Active</Badge>
                        )}
                      </td>
                      <td className="ms-muted">{p.kind === 'invite' ? '—' : relativeTime(p.lastActiveAt)}</td>
                      <td className="ms-row-actions">
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={Pencil}
                          aria-label={`Edit ${p.name || p.email || 'invitation'}`}
                          disabled={!canTouch}
                          title={self ? 'You can’t change your own access. Another master can.' : !canTouch ? 'Only the owner can change the owner.' : undefined}
                          onClick={() => {
                            setFormError(null);
                            setEditing({ person: p, name: p.name || '', value: { roleKey: p.roleKey, orgIds: p.orgIds, allOrgs: p.allOrgs } });
                          }}
                        />
                        {canTouch && (
                          <Menu
                            trigger={({ toggle, open, id }) => (
                              <Button variant="ghost" size="sm" icon={MoreHorizontal} aria-label="More actions" aria-expanded={open} aria-controls={id} onClick={toggle} />
                            )}
                          >
                            {p.kind === 'invite' ? (
                              <>
                                {p.method === 'link' && p.token && (
                                  <MenuItem icon={Copy} onClick={() => navigator.clipboard?.writeText(`${window.location.origin}/admin?invite=${p.token}`)}>
                                    Copy invitation link
                                  </MenuItem>
                                )}
                                <MenuItem icon={X} danger onClick={() => setConfirm({ kind: 'revoke', person: p })}>Revoke invitation</MenuItem>
                              </>
                            ) : (
                              <>
                                {p.status === 'blocked'
                                  ? <MenuItem icon={RotateCcw} onClick={() => unblock(p)}>Unblock</MenuItem>
                                  : <MenuItem icon={Ban} onClick={() => setConfirm({ kind: 'block', person: p })}>Block sign-in</MenuItem>}
                                <MenuSeparator />
                                <MenuItem icon={UserMinus} danger onClick={() => setConfirm({ kind: 'remove', person: p })}>Remove access</MenuItem>
                              </>
                            )}
                          </Menu>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="ms-foot-note">
          People you add get their access the first time they sign in with the invited address.
          Removing someone ends their access; what they did stays in the activity log.
        </p>
      </CardBody>

      <Modal
        open={!!editing}
        wide
        onClose={() => !busy && setEditing(null)}
        title={editing ? `Edit ${editing.person.name || editing.person.email || 'invitation'}` : ''}
        subtitle={editing?.person.kind === 'invite'
          ? 'They get this access when they accept the invitation.'
          : 'Changes apply the next time they load the dashboard.'}
        icon={Pencil}
        footer={(
          <>
            {formError && <span className="ms-error ms-foot-error" role="alert">{formError}</span>}
            <Button variant="outline" onClick={() => setEditing(null)} disabled={busy}>Cancel</Button>
            <Button variant="primary" onClick={saveEdit} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</Button>
          </>
        )}
      >
        {editing && (
          <div className="ms-form">
            {editing.person.kind === 'account' && (
              <Field label="Name" htmlFor="person-name" hint="How colleagues see them in the dashboard.">
                <input id="person-name" className="ui-input" value={editing.name}
                  onChange={e => setEditing(s => ({ ...s, name: e.target.value }))} placeholder="Firstname Lastname" />
              </Field>
            )}
            <AccessEditor
              idPrefix="edit"
              value={editing.value}
              onChange={value => setEditing(s => ({ ...s, value }))}
              roles={rolesList}
              orgs={orgs}
              groupsById={groupsById}
            />
          </div>
        )}
      </Modal>

      <Modal
        open={!!adding}
        wide
        onClose={() => !busy && setAdding(null)}
        title="Add a person"
        subtitle="We email them an invitation. They get this access the first time they sign in."
        icon={UserPlus}
        footer={(
          <>
            {formError && <span className="ms-error ms-foot-error" role="alert">{formError}</span>}
            <Button variant="outline" onClick={() => setAdding(null)} disabled={busy}>Cancel</Button>
            <Button variant="primary" icon={MailPlus} onClick={sendInvite} disabled={busy}>{busy ? 'Sending…' : 'Send invitation'}</Button>
          </>
        )}
      >
        {adding && (
          <div className="ms-form">
            <Field label="Work email" htmlFor="invite-email" hint="The address they will sign in with.">
              <input id="invite-email" type="email" className="ui-input" autoFocus value={adding.email}
                placeholder="name@company.com"
                onChange={e => setAdding(s => ({ ...s, email: e.target.value }))} />
            </Field>
            <AccessEditor
              idPrefix="add"
              value={adding.value}
              onChange={value => setAdding(s => ({ ...s, value }))}
              roles={rolesList}
              orgs={orgs}
              groupsById={groupsById}
            />
          </div>
        )}
      </Modal>

      <Modal
        open={!!confirm}
        onClose={() => !busy && setConfirm(null)}
        title={confirm ? CONFIRM_COPY[confirm.kind].title(confirm.person) : ''}
        icon={confirm ? CONFIRM_COPY[confirm.kind].icon : undefined}
        iconTone="rose"
        footer={(
          <>
            <Button variant="outline" onClick={() => setConfirm(null)} disabled={busy}>Cancel</Button>
            <Button variant="danger" onClick={runConfirm} disabled={busy}>
              {busy ? 'Working…' : confirm ? CONFIRM_COPY[confirm.kind].action : ''}
            </Button>
          </>
        )}
      >
        {confirm && <p className="ms-modal-text">{CONFIRM_COPY[confirm.kind].body}</p>}
      </Modal>
    </Card>
  );
}

const CONFIRM_COPY = {
  revoke: {
    icon: X,
    action: 'Revoke invitation',
    title: (p) => `Revoke the invitation for ${p.email || 'this link'}?`,
    body: 'The invitation stops working. You can invite them again at any time.',
  },
  block: {
    icon: Ban,
    action: 'Block sign-in',
    title: (p) => `Block ${p.name || p.email}?`,
    body: 'They can’t use the dashboard until you unblock them. Their role and organisations are kept.',
  },
  remove: {
    icon: UserMinus,
    action: 'Remove access',
    title: (p) => `Remove ${p.name || p.email}?`,
    body: 'Their dashboard access ends now. The activity log keeps what they did. To bring them back, invite them again.',
  },
};

function friendlyDbError(e) {
  const msg = e?.message || '';
  if (/only_an_owner_can_manage_owners/.test(msg)) return 'Only the owner can change the owner’s access.';
  if (/row-level security|permission denied/i.test(msg)) return 'Only a master can change people’s access.';
  return msg || 'Something went wrong. Try again.';
}
