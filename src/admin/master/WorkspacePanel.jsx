import { useState } from 'react';
import { LayoutGrid, Lock } from 'lucide-react';
import { useAccess } from '../context/accessCtx';
import { TABS, TAB_GROUPS } from '../lib/access';
import { Badge, Card, CardBody, CardHeader, Switch } from '../ui';

const MODE_SHORT = { standard: 'Deposit Rewards', byo: 'Bring Your Own', tikkie_only: 'Deferred Tikkie' };

/* Tabs that exist for everyone. A tab switched off here is gone for every
 * role and organisation; roles can only narrow what is left. */
export default function WorkspacePanel() {
  const { workspace, saveWorkspace } = useAccess();
  const [saving, setSaving] = useState(null);
  const [message, setMessage] = useState(null);

  async function toggle(tab, on) {
    const next = { ...workspace };
    if (on) delete next[tab.id]; else next[tab.id] = false;
    setSaving(tab.id);
    setMessage(null);
    const { error } = await saveWorkspace(next);
    setSaving(null);
    setMessage(error
      ? { ok: false, text: /row-level security/i.test(error) ? 'Only a master can change workspace tabs.' : error }
      : { ok: true, text: `${tab.label} is ${on ? 'back on' : 'off'} for everyone.` });
  }

  const offCount = TABS.filter(t => !t.fixed && !t.masterOnly && workspace?.[t.id] === false).length;

  return (
    <Card>
      <CardHeader
        title="Workspace tabs"
        icon={LayoutGrid}
        ruled
        subtitle="Switch a tab off for everyone, whatever their role. It saves straight away."
        actions={offCount > 0 && <Badge tone="warning">{offCount} off</Badge>}
      />
      <CardBody>
        {message && <p className={message.ok ? 'ms-ok' : 'ms-error'} role="status">{message.text}</p>}
        <div className="ms-ws">
          {TAB_GROUPS.map(group => {
            const tabs = TABS.filter(t => t.group === group.id);
            return (
              <section key={group.id} className="ms-ws__group" aria-labelledby={`ws-${group.id}`}>
                <h3 id={`ws-${group.id}`} className="ms-ws__label">{group.label}</h3>
                <ul className="ms-ws__list">
                  {tabs.map(tab => {
                    const Icon = tab.icon;
                    const locked = tab.fixed || tab.masterOnly;
                    const on = locked || workspace?.[tab.id] !== false;
                    return (
                      <li key={tab.id} className={`ms-ws__row${on ? '' : ' ms-ws__row--off'}`}>
                        <span className="ms-ws__icon" aria-hidden="true"><Icon size={16} /></span>
                        <div className="ms-ws__text">
                          <p className="ms-ws__name">{tab.label}</p>
                          <p className="ms-ws__desc">
                            {tab.description}
                            <span className="ms-ws__modes">
                              {tab.modes.length === 3 ? 'Every programme' : tab.modes.map(m => MODE_SHORT[m]).join(', ')}
                            </span>
                          </p>
                        </div>
                        {locked ? (
                          <span className="ms-fixed" title={tab.masterOnly ? 'Masters always have it' : 'Every workspace needs this tab'}>
                            <Lock size={12} aria-hidden="true" /> Always on
                          </span>
                        ) : (
                          <Switch
                            checked={on}
                            disabled={saving === tab.id}
                            label={`${tab.label} for everyone`}
                            onChange={v => toggle(tab, v)}
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      </CardBody>
    </Card>
  );
}
