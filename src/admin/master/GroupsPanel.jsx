import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Layers, Plus } from 'lucide-react';
import { createOrgGroup, getGroupStats } from '../lib/adminApi';
import { DEFAULT_PAYMENT_METHOD, PAYMENT_METHOD_META } from '../../lib/paymentMethods';
import { Button, Card, CardBody, CardHeader, EmptyState, Field, Modal } from '../ui';
import GroupEditor from './GroupEditor';
import { ChoiceCard, ModeChip } from './OrgBits';
import { GROUP_MODES, GROUP_MODE_TO_ORG, MODE_GLYPH, groupModeLabel, plural } from './orgShared';

const NEW_GROUP_BLURB = {
  deposit: 'SmartBin returns. For venues that already run Deposit Rewards and want one market page.',
  byo: 'Customers bring their own cup and scan the counter QR code. The usual choice for a new group.',
};

/* Groups: venues that share one customer profile, one market page and one
 * programme. The list shows each group; its editor opens in a drawer. */
export default function GroupsPanel({ orgs, groups, modes, onChanged, onEditOrg }) {
  const [editing, setEditing] = useState(null); // { id, tab }
  const [creating, setCreating] = useState(null); // { name, mode }
  const [createError, setCreateError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState({});

  const idsKey = groups.map(g => `${g.id}:${(g.members || []).map(m => `${m.id}${m.deleted_at ? 'x' : ''}`).join(',')}`).join('|');
  useEffect(() => {
    let alive = true;
    const ids = idsKey ? idsKey.split('|').map(s => s.split(':')[0]) : [];
    Promise.all(ids.map(id => getGroupStats(id).then(s => [id, s]).catch(() => [id, null])))
      .then(entries => { if (alive) setStats(Object.fromEntries(entries)); });
    return () => { alive = false; };
  }, [idsKey]);

  const orgCount = useMemo(() => (orgs || []).filter(o => !o.deleted_at).length, [orgs]);
  const editGroup = editing && groups.find(g => g.id === editing.id);

  async function create() {
    const name = creating.name.trim();
    if (!name) { setCreateError('Give the group a name.'); return; }
    setBusy(true);
    setCreateError(null);
    try {
      const g = await createOrgGroup({ name, mode: creating.mode });
      setCreating(null);
      await onChanged(`${g.name} is created. Add its venues next.`);
      setEditing({ id: g.id, tab: 'venues' });
    } catch (e) {
      setCreateError(e?.message || 'Could not create the group.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Groups"
        icon={Layers}
        ruled
        subtitle="Venues that share one customer profile and one market page. The group sets their programme, their customer copy and how rewards are paid."
        actions={(
          <Button variant="primary" icon={Plus} onClick={() => { setCreateError(null); setCreating({ name: '', mode: 'byo' }); }}>
            New group
          </Button>
        )}
      />
      <CardBody flush>
        {orgs === null ? (
          <p className="ms-hint ms-pad ms-pad--b">Loading groups…</p>
        ) : groups.length === 0 ? (
          <EmptyState icon={Layers} title="No groups yet"
            action={<Button variant="primary" icon={Plus} onClick={() => setCreating({ name: '', mode: 'byo' })}>New group</Button>}>
            A group lets customers use one profile across several venues. Bring Your Own venues always sit in one.
          </EmptyState>
        ) : (
          <div className="ms-table-wrap">
            <table className="ui-table ms-grid">
              <thead>
                <tr>
                  <th>Group</th>
                  <th>Programme</th>
                  <th>Rewards paid by</th>
                  <th>Venues</th>
                  <th className="ui-num">Customers</th>
                  <th className="ui-num">Cups collected</th>
                  <th aria-label="Open" />
                </tr>
              </thead>
              <tbody>
                {groups.map(g => {
                  const live = (g.members || []).filter(m => !m.deleted_at);
                  const hidden = live.filter(m => !m.group_active).length;
                  const method = g.config?.settings?.paymentMethod;
                  const s = stats[g.id];
                  return (
                    <tr key={g.id} className="ms-grid__row" onClick={() => setEditing({ id: g.id, tab: 'settings' })}>
                      <td>
                        <button type="button" className="ms-grid__name" onClick={(e) => { e.stopPropagation(); setEditing({ id: g.id, tab: 'settings' }); }}>
                          <span className="ms-drawer__icon ms-drawer__icon--sm"><Layers size={15} aria-hidden="true" /></span>
                          <span className="ms-grid__titles">
                            <b>{g.name}</b>
                            <span className="ms-mono">/{g.slug}/</span>
                          </span>
                        </button>
                      </td>
                      <td><ModeChip mode={GROUP_MODE_TO_ORG[g.mode]} /></td>
                      <td>
                        <span className="ms-grid__titles">
                          <span className="ms-nowrap">{PAYMENT_METHOD_META[method || DEFAULT_PAYMENT_METHOD].label}</span>
                          <span className="ms-dim">{method ? 'Set for the group' : 'Default'}</span>
                        </span>
                      </td>
                      <td>
                        <span className="ms-grid__titles">
                          <b>
                            {plural(live.length, 'venue')}
                            {hidden > 0 && <span className="ms-dim"> · {hidden} hidden</span>}
                          </b>
                          <span className="ms-dim ms-clip" title={live.map(m => m.name).join(', ')}>
                            {live.slice(0, 2).map(m => m.name).join(', ')}{live.length > 2 ? ` +${live.length - 2}` : ''}
                          </span>
                        </span>
                      </td>
                      <td className="ui-num">{s === undefined ? '…' : s ? s.totals.users : '—'}</td>
                      <td className="ui-num">{s === undefined ? '…' : s ? s.totals.lifetime : '—'}</td>
                      <td className="ms-row-actions"><ChevronRight size={16} className="ms-dim" aria-hidden="true" /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="ms-foot-note">
          {groups.length ? `${plural(groups.reduce((n, g) => n + (g.members || []).filter(m => !m.deleted_at).length, 0), 'venue')} of ${orgCount} ${orgCount === 1 ? 'is' : 'are'} in a group. ` : ''}
          A venue with no group runs Deposit Rewards or Deferred Tikkie on its own.
        </p>
      </CardBody>

      {editGroup && (
        <GroupEditor
          key={editGroup.id}
          group={editGroup}
          orgs={orgs}
          modes={modes}
          stats={stats[editGroup.id]}
          initialTab={editing.tab}
          onClose={() => setEditing(null)}
          onChanged={onChanged}
          onEditOrg={(id) => { setEditing(null); onEditOrg(id); }}
        />
      )}

      <Modal
        open={!!creating}
        wide
        onClose={() => !busy && setCreating(null)}
        title="New group"
        subtitle="You add its venues after it is created."
        icon={Layers}
        footer={(
          <>
            {createError && <span className="ms-error ms-foot-error" role="alert">{createError}</span>}
            <Button variant="outline" onClick={() => setCreating(null)} disabled={busy}>Cancel</Button>
            <Button variant="primary" onClick={create} disabled={busy || !creating?.name.trim()}>{busy ? 'Creating…' : 'Create group'}</Button>
          </>
        )}
      >
        {creating && (
          <div className="ms-form">
            <Field label="Group name" htmlFor="new-group-name" hint="Its market page address is made from the name. You can change it later.">
              <input id="new-group-name" className="ui-input" autoFocus value={creating.name} placeholder="Amsterdam cafés"
                onChange={e => setCreating(c => ({ ...c, name: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') create(); }} />
            </Field>
            <div className="ui-field">
              <span className="ui-field__label">Programme</span>
              <div className="ms-choices ms-choices--2" role="radiogroup" aria-label="Programme">
                {GROUP_MODES.map(m => (
                  <ChoiceCard
                    key={m}
                    on={creating.mode === m}
                    tag="Picked"
                    icon={MODE_GLYPH[GROUP_MODE_TO_ORG[m]]}
                    tone={GROUP_MODE_TO_ORG[m]}
                    label={groupModeLabel(m)}
                    blurb={NEW_GROUP_BLURB[m]}
                    onClick={() => setCreating(c => ({ ...c, mode: m }))}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </Card>
  );
}
