import { useState } from 'react';
import { ChartSpline, LayoutGrid, Lock, MoonStar, PanelTop, SunMoon } from 'lucide-react';
import { useAccess } from '../context/accessCtx';
import { TABS, TAB_GROUPS, TOPBAR_ITEMS, topbarShows } from '../lib/access';
import { Badge, BetaChip, Card, CardBody, CardHeader, Switch } from '../ui';

const MODE_SHORT = { standard: 'Deposit Rewards', byo: 'Bring Your Own', tikkie_only: 'Deferred Tikkie' };

/* Workspace: what the top bar shows, how the number tiles look and which
 * tabs exist, for everyone.
 * A tab switched off here is gone for every role and organisation; roles
 * can only narrow what is left. */
export default function WorkspacePanel() {
  return (
    <div className="ms-stack">
      <TopbarCard />
      <DarkModeCard />
      <DisplayCard />
      <TabsCard />
    </div>
  );
}

/* What the top bar shows, for everyone. */
function TopbarCard() {
  const { topbar, saveTopbar } = useAccess();
  const [saving, setSaving] = useState(null);
  const [message, setMessage] = useState(null);

  async function toggle(item, on) {
    const next = { ...topbar };
    // Only store a choice that differs from the item's own default.
    if (on === !item.defaultOff) delete next[item.id]; else next[item.id] = on;
    setSaving(item.id);
    setMessage(null);
    const { error } = await saveTopbar(next);
    setSaving(null);
    setMessage(error
      ? { ok: false, text: /row-level security/i.test(error) ? 'Only a master can change the top bar.' : error }
      : { ok: true, text: `${item.label} is ${on ? 'shown' : 'hidden'} in the top bar for everyone.` });
  }

  const hidden = TOPBAR_ITEMS.filter(i => !i.fixed && !topbarShows(topbar, i.id)).length;

  return (
    <Card>
      <CardHeader
        title="Top bar"
        icon={PanelTop}
        ruled
        subtitle="Choose what the bar above every page shows. It saves straight away and applies to everyone."
        actions={hidden > 0 && <Badge tone="warning">{hidden} hidden</Badge>}
      />
      <CardBody>
        {message && <p className={message.ok ? 'ms-ok' : 'ms-error'} role="status">{message.text}</p>}
        <ul className="ms-ws__list ms-ws__list--grid">
          {TOPBAR_ITEMS.map(item => {
            const Icon = item.icon;
            const on = topbarShows(topbar, item.id);
            return (
              <li key={item.id} className={`ms-ws__row${on ? '' : ' ms-ws__row--off'}`}>
                <span className="ms-ws__icon" aria-hidden="true"><Icon size={16} /></span>
                <div className="ms-ws__text">
                  <p className="ms-ws__name">{item.label}</p>
                  <p className="ms-ws__desc">{item.description}</p>
                </div>
                {item.fixed ? (
                  <span className="ms-fixed" title="Publish is how changes go live">
                    <Lock size={12} aria-hidden="true" /> Always on
                  </span>
                ) : (
                  <Switch
                    checked={on}
                    disabled={saving === item.id}
                    label={`Show ${item.label} in the top bar`}
                    onChange={v => toggle(item, v)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      </CardBody>
    </Card>
  );
}

/* The dark-mode switch in the corner of every page, for everyone. */
function DarkModeCard() {
  const { display, saveDisplay } = useAccess();
  const [saving, setSaving] = useState(null);
  const [message, setMessage] = useState(null);
  const shown = display?.darkModeSwitch !== false;
  const auto = display?.darkModeAuto === true;

  async function save(patch, text) {
    setSaving(Object.keys(patch)[0]);
    setMessage(null);
    const { error } = await saveDisplay({ ...display, ...patch });
    setSaving(null);
    setMessage(error
      ? { ok: false, text: /row-level security/i.test(error) ? 'Only a master can change this.' : error }
      : { ok: true, text });
  }

  return (
    <Card>
      <CardHeader
        title="Dark mode"
        icon={MoonStar}
        ruled
        subtitle="The round switch in the bottom-right corner of every dashboard page. Each person's choice is remembered in their own browser; previews of the customer app, emails and receipts always stay light."
        actions={!shown && <Badge tone="warning">Switch hidden</Badge>}
      />
      <CardBody>
        {message && <p className={message.ok ? 'ms-ok' : 'ms-error'} role="status">{message.text}</p>}
        <ul className="ms-ws__list ms-ws__list--grid">
          <li className={`ms-ws__row${shown ? '' : ' ms-ws__row--off'}`}>
            <span className="ms-ws__icon" aria-hidden="true"><MoonStar size={16} /></span>
            <div className="ms-ws__text">
              <p className="ms-ws__name">Dark mode switch</p>
              <p className="ms-ws__desc">Off hides the switch completely, for everyone.</p>
            </div>
            <Switch
              checked={shown}
              disabled={saving === 'darkModeSwitch'}
              label="Show the dark mode switch"
              onChange={v => save({ darkModeSwitch: v }, `The dark mode switch is ${v ? 'shown' : 'hidden'} for everyone.`)}
            />
          </li>
          <li className={`ms-ws__row${auto ? '' : ' ms-ws__row--off'}`}>
            <span className="ms-ws__icon" aria-hidden="true"><SunMoon size={16} /></span>
            <div className="ms-ws__text">
              <p className="ms-ws__name">Automatic</p>
              <p className="ms-ws__desc">
                Follow the sunrise and sunset of each person’s own time zone: light by day, dark after dark.
                Their own choice still wins until the next sunrise or sunset.
              </p>
            </div>
            <Switch
              checked={auto}
              disabled={saving === 'darkModeAuto'}
              label="Follow sunrise and sunset"
              onChange={v => save({ darkModeAuto: v }, v
                ? 'The dashboard now follows sunrise and sunset.'
                : 'The dashboard stays light until someone switches it.')}
            />
          </li>
        </ul>
      </CardBody>
    </Card>
  );
}

/* How the number tiles look, for everyone. */
function DisplayCard() {
  const { display, saveDisplay } = useAccess();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const sparklines = display?.sparklines !== false;

  async function toggle(on) {
    setSaving(true);
    setMessage(null);
    const { error } = await saveDisplay({ ...display, sparklines: on });
    setSaving(false);
    setMessage(error
      ? { ok: false, text: /row-level security/i.test(error) ? 'Only a master can change this.' : error }
      : { ok: true, text: `Mini graphs are ${on ? 'on' : 'off'} for everyone.` });
  }

  return (
    <Card>
      <CardHeader
        title="Number tiles"
        icon={ChartSpline}
        ruled
        subtitle="How the tiles at the top of Dashboard, System health and User behaviour look. It saves straight away and applies to everyone."
      />
      <CardBody>
        {message && <p className={message.ok ? 'ms-ok' : 'ms-error'} role="status">{message.text}</p>}
        <ul className="ms-ws__list ms-ws__list--grid">
          <li className={`ms-ws__row${sparklines ? '' : ' ms-ws__row--off'}`}>
            <span className="ms-ws__icon" aria-hidden="true"><ChartSpline size={16} /></span>
            <div className="ms-ws__text">
              <p className="ms-ws__name">Mini graphs<BetaChip /></p>
              <p className="ms-ws__desc">A small line in each tile showing how the number moved over the period.</p>
            </div>
            <Switch
              checked={sparklines}
              disabled={saving}
              label="Show mini graphs on number tiles"
              onChange={toggle}
            />
          </li>
        </ul>
      </CardBody>
    </Card>
  );
}

/* Tabs that exist for everyone. */
function TabsCard() {
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
                          <p className="ms-ws__name">{tab.label}{tab.beta && <BetaChip />}</p>
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
