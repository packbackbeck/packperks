import { useEffect, useMemo, useState } from 'react';
import {
  Eye, EyeOff, KeyRound, Lock, MoreHorizontal, Pencil, Plus, RotateCcw, ShieldCheck, Trash2, Undo2,
} from 'lucide-react';
import { useAccess } from '../context/accessCtx';
import { BUILT_IN_ROLES, LEVELS, TABS, TAB_GROUPS } from '../lib/access';
import { Badge, BetaChip, Button, Card, CardBody, CardHeader, Field, Menu, MenuItem, MenuLabel, MenuSeparator, Modal, Segmented } from '../ui';
import { listPeople, roleCounts, slugForRole } from './masterApi';

const CELL_OPTIONS = [
  { id: 'hidden', label: 'Hidden', icon: EyeOff },
  { id: 'view', label: 'View', icon: Eye },
  { id: 'edit', label: 'Change', icon: Pencil },
];
const MODE_SHORT = { standard: 'Deposit', byo: 'BYO', tikkie_only: 'Deferred Tikkie' };

function presetTabs(preset, role) {
  const out = {};
  for (const t of TABS) {
    if (t.masterOnly) continue;
    if (preset === 'edit') out[t.id] = t.editable === false ? 'view' : 'edit';
    else if (preset === 'view') out[t.id] = 'view';
    else if (preset === 'hidden') out[t.id] = 'hidden';
    else if (preset === 'default') out[t.id] = BUILT_IN_ROLES[role.level]?.tabs?.[t.id] || 'hidden';
  }
  return out;
}

/* What each role may see and change, tab by tab. */
export default function RolesPanel({ workspace }) {
  const { rolesList, roles, saveRole, deleteRole, rolesError } = useAccess();
  const [edits, setEdits] = useState({});     // key → tabs
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [holders, setHolders] = useState({});
  const [creating, setCreating] = useState(null);
  const [renaming, setRenaming] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState(null);

  useEffect(() => {
    let alive = true;
    listPeople().then(list => {
      if (!alive) return;
      const counts = {};
      for (const p of list) counts[p.roleKey] = (counts[p.roleKey] || 0) + 1;
      setHolders(counts);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const tabsFor = (role) => edits[role.key] || role.tabs;
  const changedCount = useMemo(() => {
    let n = 0;
    for (const [key, tabs] of Object.entries(edits)) {
      const saved = roles[key]?.tabs || {};
      for (const t of TABS) if (!t.masterOnly && (tabs[t.id] || 'hidden') !== (saved[t.id] || 'hidden')) n += 1;
    }
    return n;
  }, [edits, roles]);

  function setCell(role, tabId, value) {
    setMessage(null);
    setEdits(prev => ({ ...prev, [role.key]: { ...tabsFor(role), [tabId]: value } }));
  }

  function applyPreset(role, preset) {
    setMessage(null);
    setEdits(prev => ({ ...prev, [role.key]: preset === 'saved' ? role.tabs : presetTabs(preset, role) }));
  }

  async function saveAll() {
    setSaving(true);
    setMessage(null);
    const failed = [];
    for (const [key, tabs] of Object.entries(edits)) {
      const role = roles[key];
      if (!role || role.level === 'master') continue;
      const { error } = await saveRole({ ...role, tabs });
      if (error) failed.push(`${role.label}: ${error}`);
    }
    setSaving(false);
    if (failed.length) {
      setMessage({ ok: false, text: failed.join(' · ') });
    } else {
      setEdits({});
      setMessage({ ok: true, text: 'Saved. People see the change the next time they load the dashboard.' });
    }
  }

  async function createRole() {
    const label = creating.label.trim();
    if (!label) { setFormError('Give the role a name.'); return; }
    if (label.length > 40) { setFormError('Keep the name under 40 characters.'); return; }
    if (rolesList.some(r => r.label.toLowerCase() === label.toLowerCase())) { setFormError('A role with that name already exists.'); return; }
    const from = roles[creating.from];
    const key = slugForRole(label, new Set(Object.keys(roles)));
    setBusy(true);
    setFormError(null);
    const tabs = from ? { ...from.tabs } : presetTabs('default', { level: creating.level });
    const { error } = await saveRole({ key, label, level: creating.level, description: creating.description.trim(), tabs, builtIn: false });
    setBusy(false);
    if (error) { setFormError(error); return; }
    setCreating(null);
    setMessage({ ok: true, text: `${label} created. Set what it can do below, then give it to people in People.` });
  }

  async function renameRole() {
    const label = renaming.label.trim();
    if (!label) { setFormError('Give the role a name.'); return; }
    setBusy(true);
    setFormError(null);
    const role = roles[renaming.key];
    const { error } = await saveRole({ ...role, tabs: tabsFor(role), label, description: renaming.description.trim() });
    setBusy(false);
    if (error) { setFormError(error); return; }
    setEdits(prev => { const next = { ...prev }; delete next[renaming.key]; return next; });
    setRenaming(null);
  }

  async function removeRole() {
    setBusy(true);
    const { error } = await deleteRole(removing.key);
    setBusy(false);
    if (error) {
      setMessage({ ok: false, text: /foreign key/i.test(error) ? `${removing.label} is still given to someone. Move them to another role first.` : error });
    } else {
      setEdits(prev => { const next = { ...prev }; delete next[removing.key]; return next; });
    }
    setRemoving(null);
  }

  const columns = rolesList;

  return (
    <Card>
      <CardHeader
        title="Roles & permissions"
        icon={KeyRound}
        ruled
        subtitle="What each role can see and change, tab by tab. Masters always have everything. Which organisations someone sees is set per person, in People."
        actions={(
          <Button
            variant="primary"
            icon={Plus}
            onClick={() => { setFormError(null); setCreating({ label: '', level: 'manager', from: 'manager', description: '' }); }}
          >
            New role
          </Button>
        )}
      >
        <div className="ms-legend" aria-label="Legend">
          {CELL_OPTIONS.map(o => (
            <span key={o.id} className={`ms-legend__item ms-legend__item--${o.id}`}>
              <o.icon size={13} aria-hidden="true" /> {o.label}
            </span>
          ))}
          {rolesError && (
            <Badge tone="warning" title={rolesError}>Showing the built-in roles: the saved roles couldn’t be loaded</Badge>
          )}
        </div>
      </CardHeader>
      <CardBody flush>
        <div className="ms-matrix-wrap">
          <table className="ms-matrix">
            <thead>
              <tr>
                <th className="ms-matrix__corner" scope="col">Tab</th>
                {columns.map(role => {
                  const c = roleCounts({ ...role, tabs: tabsFor(role) });
                  const isMaster = role.level === 'master';
                  return (
                    <th key={role.key} scope="col" className={`ms-matrix__role${isMaster ? ' ms-matrix__role--master' : ''}`}>
                      <div className="ms-matrix__role-head">
                        <div className="ms-matrix__role-titles">
                          <span className="ms-matrix__role-name">{role.label}</span>
                          <span className="ms-matrix__role-meta">
                            <span className={`ms-level-dot ms-level-dot--${role.level}`} aria-hidden="true" />
                            {LEVELS[role.level].label}
                            {' · '}
                            {holders[role.key] || 0} {holders[role.key] === 1 ? 'person' : 'people'}
                          </span>
                          <span className="ms-matrix__role-counts">
                            {isMaster ? 'Everything' : `${c.edit} change · ${c.view} view · ${c.hidden} hidden`}
                          </span>
                        </div>
                        {isMaster ? (
                          <span className="ms-lock" title="The master role always has everything"><Lock size={13} aria-hidden="true" /></span>
                        ) : (
                          <Menu
                            trigger={({ toggle, open, id }) => (
                              <Button variant="ghost" size="sm" icon={MoreHorizontal} aria-label={`${role.label} options`} aria-expanded={open} aria-controls={id} onClick={toggle} />
                            )}
                          >
                            <MenuItem icon={Pencil} onClick={() => { setFormError(null); setRenaming({ key: role.key, label: role.label, description: role.description || '' }); }}>
                              Rename and describe
                            </MenuItem>
                            <MenuSeparator />
                            <MenuLabel>Set every tab to</MenuLabel>
                            <MenuItem icon={Pencil} onClick={() => applyPreset(role, 'edit')}>Change everything</MenuItem>
                            <MenuItem icon={Eye} onClick={() => applyPreset(role, 'view')}>View everything</MenuItem>
                            <MenuItem icon={EyeOff} onClick={() => applyPreset(role, 'hidden')}>Hide everything</MenuItem>
                            <MenuItem icon={RotateCcw} onClick={() => applyPreset(role, 'default')}>
                              The {LEVELS[role.level].label.toLowerCase()} defaults
                            </MenuItem>
                            {edits[role.key] && <MenuItem icon={Undo2} onClick={() => applyPreset(role, 'saved')}>Undo my changes</MenuItem>}
                            {!role.builtIn && (
                              <>
                                <MenuSeparator />
                                <MenuItem icon={Trash2} danger onClick={() => setRemoving(role)}>Delete role</MenuItem>
                              </>
                            )}
                          </Menu>
                        )}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {TAB_GROUPS.map(group => {
                const rows = TABS.filter(t => t.group === group.id);
                return [
                  <tr key={`g-${group.id}`} className="ms-matrix__group">
                    <td colSpan={columns.length + 1}>{group.label}</td>
                  </tr>,
                  ...rows.map(tab => {
                    const Icon = tab.icon;
                    const off = !tab.fixed && workspace?.[tab.id] === false;
                    return (
                      <tr key={tab.id}>
                        <th scope="row" className="ms-matrix__tab">
                          <span className="ms-matrix__tab-icon" aria-hidden="true"><Icon size={15} /></span>
                          <span className="ms-matrix__tab-text">
                            <span className="ms-matrix__tab-name">
                              {tab.label}
                              {tab.beta && <BetaChip />}
                              {off && <span className="ms-chip ms-chip--off">Off for everyone</span>}
                            </span>
                            <span className="ms-matrix__tab-desc">
                              {tab.modes.length < 3 ? tab.modes.map(m => MODE_SHORT[m]).join(' · ') : 'Every programme'}
                              {tab.feature ? ' · needs its feature on' : ''}
                              {tab.needsGroup ? ' · grouped venues' : ''}
                            </span>
                          </span>
                        </th>
                        {columns.map(role => {
                          if (tab.masterOnly || role.level === 'master') {
                            const masterCell = role.level === 'master';
                            return (
                              <td key={role.key} className={`ms-matrix__cell${masterCell ? ' ms-matrix__cell--master' : ''}`}>
                                <span className={`ms-fixed${masterCell ? ' ms-fixed--on' : ''}`}>
                                  {masterCell ? <><ShieldCheck size={13} aria-hidden="true" /> Change</> : <><Lock size={12} aria-hidden="true" /> Masters only</>}
                                </span>
                              </td>
                            );
                          }
                          const value = tabsFor(role)[tab.id] || 'hidden';
                          const saved = roles[role.key]?.tabs?.[tab.id] || 'hidden';
                          const changed = value !== saved;
                          return (
                            <td key={role.key} className={`ms-matrix__cell${changed ? ' ms-matrix__cell--changed' : ''}`}>
                              <div className="ms-cell" role="radiogroup" aria-label={`${role.label}: ${tab.label}`}>
                                {CELL_OPTIONS.map(o => {
                                  const disabled = o.id === 'edit' && tab.editable === false;
                                  return (
                                    <button
                                      key={o.id}
                                      type="button"
                                      role="radio"
                                      aria-checked={value === o.id}
                                      aria-label={o.label}
                                      title={disabled ? 'Nothing to change on this tab' : o.label}
                                      disabled={disabled}
                                      className={`ms-cell__btn ms-cell__btn--${o.id}`}
                                      onClick={() => setCell(role, tab.id, o.id)}
                                    >
                                      <o.icon size={13} aria-hidden="true" />
                                    </button>
                                  );
                                })}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  }),
                ];
              })}
            </tbody>
          </table>
        </div>

        {(changedCount > 0 || message) && (
          <div className={`ms-savebar${changedCount > 0 ? ' ms-savebar--dirty' : ''}`}>
            <span className={message && !changedCount ? (message.ok ? 'ms-ok' : 'ms-error') : 'ms-savebar__text'}>
              {changedCount > 0
                ? `${changedCount} change${changedCount === 1 ? '' : 's'} · nobody sees them until you save`
                : message?.text}
            </span>
            {changedCount > 0 && (
              <span className="ms-savebar__actions">
                {message && !message.ok && <span className="ms-error">{message.text}</span>}
                <Button variant="outline" onClick={() => { setEdits({}); setMessage(null); }} disabled={saving}>Discard</Button>
                <Button variant="primary" onClick={saveAll} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
              </span>
            )}
          </div>
        )}
      </CardBody>

      <Modal
        open={!!creating}
        onClose={() => !busy && setCreating(null)}
        title="New role"
        subtitle="A role sets which tabs people see and can change. Give it to people in People."
        icon={Plus}
        footer={(
          <>
            {formError && <span className="ms-error ms-foot-error" role="alert">{formError}</span>}
            <Button variant="outline" onClick={() => setCreating(null)} disabled={busy}>Cancel</Button>
            <Button variant="primary" onClick={createRole} disabled={busy}>{busy ? 'Creating…' : 'Create role'}</Button>
          </>
        )}
      >
        {creating && (
          <div className="ms-form">
            <Field label="Name" htmlFor="role-name">
              <input id="role-name" className="ui-input" autoFocus maxLength={40} value={creating.label}
                placeholder="e.g. Shift lead" onChange={e => setCreating(s => ({ ...s, label: e.target.value }))} />
            </Field>
            <Field label="Level" hint={LEVELS[creating.level].description}>
              <Segmented
                ariaLabel="Level"
                value={creating.level}
                onChange={level => setCreating(s => ({ ...s, level, from: level }))}
                options={[{ id: 'manager', label: 'Manager' }, { id: 'vendor', label: 'Vendor' }]}
              />
            </Field>
            <Field label="Start from" htmlFor="role-from" hint="Copies that role’s tab permissions. You can change them after.">
              <select id="role-from" className="ui-select" value={creating.from}
                onChange={e => setCreating(s => ({ ...s, from: e.target.value }))}>
                {rolesList.filter(r => r.level !== 'master').map(r => (
                  <option key={r.key} value={r.key}>{r.label} ({LEVELS[r.level].label})</option>
                ))}
              </select>
            </Field>
            <Field label="Description" htmlFor="role-desc" hint="One line on who this role is for.">
              <input id="role-desc" className="ui-input" value={creating.description}
                placeholder="Runs the counter, approves claims, can't change settings"
                onChange={e => setCreating(s => ({ ...s, description: e.target.value }))} />
            </Field>
          </div>
        )}
      </Modal>

      <Modal
        open={!!renaming}
        onClose={() => !busy && setRenaming(null)}
        title="Rename and describe"
        icon={Pencil}
        footer={(
          <>
            {formError && <span className="ms-error ms-foot-error" role="alert">{formError}</span>}
            <Button variant="outline" onClick={() => setRenaming(null)} disabled={busy}>Cancel</Button>
            <Button variant="primary" onClick={renameRole} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
          </>
        )}
      >
        {renaming && (
          <div className="ms-form">
            <Field label="Name" htmlFor="rename-name">
              <input id="rename-name" className="ui-input" autoFocus maxLength={40} value={renaming.label}
                onChange={e => setRenaming(s => ({ ...s, label: e.target.value }))} />
            </Field>
            <Field label="Description" htmlFor="rename-desc">
              <input id="rename-desc" className="ui-input" value={renaming.description}
                onChange={e => setRenaming(s => ({ ...s, description: e.target.value }))} />
            </Field>
            {edits[renaming.key] && <p className="ms-note">Your unsaved tab changes for this role are saved too.</p>}
          </div>
        )}
      </Modal>

      <Modal
        open={!!removing}
        onClose={() => !busy && setRemoving(null)}
        title={`Delete ${removing?.label || 'role'}?`}
        icon={Trash2}
        iconTone="rose"
        footer={(
          <>
            <Button variant="outline" onClick={() => setRemoving(null)} disabled={busy}>Cancel</Button>
            <Button variant="danger" onClick={removeRole} disabled={busy || (holders[removing?.key] || 0) > 0}>
              {busy ? 'Deleting…' : 'Delete role'}
            </Button>
          </>
        )}
      >
        {removing && (
          <p className="ms-modal-text">
            {(holders[removing.key] || 0) > 0
              ? `${holders[removing.key]} ${holders[removing.key] === 1 ? 'person has' : 'people have'} this role. Give them another role in People first.`
              : 'Nobody has this role. Pending invitations that use it will fall back to their old role name.'}
          </p>
        )}
      </Modal>
    </Card>
  );
}
