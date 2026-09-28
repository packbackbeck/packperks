import { useId, useState } from 'react';
import {
  ArrowDown, ArrowUp, ArrowUpRight, GripVertical, LayoutGrid, Lock, MousePointerClick, RotateCcw, User,
} from 'lucide-react';
import { Badge, Button, Card, CardBody, CardHeader, Switch } from '../ui';
import { homeOrder, savedOrder } from '../../lib/appLayout';
import { ACCOUNT_ROWS, BUTTON_ROWS, HOME_SECTIONS, featureOn } from './designModel';

/* ─────────────────────────────────────────────────────────────────────
 * Sections: what the customer app shows, and in what order.
 *
 *   Home screen — every section of the home, in order. Drag a row (or use
 *                 its arrows) to move it; switch it off to hide it. The
 *                 parts that ARE the programme (the wallet, the progress
 *                 bar, the featured reward) can move but not hide.
 *   Buttons     — the add button, the donate button, the logos: things
 *                 that can be hidden but have no place in the order.
 *   Account     — (rewards apps) the account screen's buttons and cards.
 *
 * `kind` is 'rewards' (Deposit Rewards, Bring Your Own) or 'tikkie'
 * (Deferred Tikkie). The order is saved to design.layout through
 * `onOrder`, the switches to design.sections through `onPatch`, and a
 * section whose switch is really a setting (Collect and Donate buttons)
 * through `onSetting`, so there is only ever one switch for one thing.
 * ───────────────────────────────────────────────────────────────────── */

export default function SectionsPanel({
  kind = 'rewards', sections, layout, settings, readOnly, onPatch, onOrder, onSetting, onReveal,
}) {
  const defs = HOME_SECTIONS[kind];
  const order = homeOrder(layout, kind);
  const custom = !!savedOrder(layout, kind);
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null);

  const isShown = (key) => {
    const d = defs[key];
    if (d.locked) return true;
    if (d.setting) return settings?.[d.setting] !== false;
    return sections[d.toggle] !== false;
  };
  const setShown = (key, v) => {
    const d = defs[key];
    if (d.setting) onSetting(d.setting, v);
    else onPatch({ [d.toggle]: v });
    onReveal('home');
  };
  const move = (key, to) => {
    const next = order.filter(k => k !== key);
    next.splice(Math.max(0, Math.min(next.length, to)), 0, key);
    if (next.join() !== order.join()) onOrder(next);
    onReveal('home');
  };

  const buttons = BUTTON_ROWS[kind];
  const rowOn = (r) => (!r.feature || featureOn(settings, r.feature)) && sections[r.key] !== false;
  const shownHome = order.filter(isShown).length;

  return (
    <div className="dz-stack">
      <Card>
        <CardHeader
          icon={LayoutGrid}
          title="Home screen"
          subtitle="Drag a section to change where it sits. Switch it off to hide it."
          actions={<Badge tone="neutral">{shownHome} of {order.length} shown</Badge>}
          ruled
        />
        <CardBody>
          <ol className="dz-order" aria-label="Home screen sections, top to bottom">
            {order.map((key, i) => {
              const d = defs[key];
              const on = isShown(key);
              const Icon = d.icon;
              return (
                <li
                  key={key}
                  className={`dz-order__row${on ? ' is-on' : ''}${drag === key ? ' is-dragging' : ''}${over === key && drag && drag !== key ? ' is-over' : ''}`}
                  draggable={!readOnly}
                  onDragStart={(e) => {
                    setDrag(key);
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', key);
                  }}
                  onDragOver={(e) => { if (drag) { e.preventDefault(); setOver(key); } }}
                  onDragLeave={() => setOver(o => (o === key ? null : o))}
                  onDrop={(e) => { e.preventDefault(); if (drag) move(drag, i); setDrag(null); setOver(null); }}
                  onDragEnd={() => { setDrag(null); setOver(null); }}
                >
                  <span className="dz-order__grip" aria-hidden="true"><GripVertical size={16} /></span>
                  <span className="dz-order__pos" aria-hidden="true">{i + 1}</span>
                  <span className={`dz-sec__icon ui-tone--${d.tone}`} aria-hidden="true"><Icon size={17} /></span>
                  <div className="dz-sec__text">
                    <span className="dz-sec__title">{d.label}</span>
                    <p className="dz-sec__summary">{d.summary}</p>
                  </div>
                  <span className="dz-order__moves">
                    <Button
                      variant="ghost" size="sm" icon={ArrowUp}
                      aria-label={`Move ${d.label} up`}
                      disabled={readOnly || i === 0}
                      onClick={() => move(key, i - 1)}
                    />
                    <Button
                      variant="ghost" size="sm" icon={ArrowDown}
                      aria-label={`Move ${d.label} down`}
                      disabled={readOnly || i === order.length - 1}
                      onClick={() => move(key, i + 1)}
                    />
                  </span>
                  {d.locked ? (
                    <span className="dz-order__lock" title="This is the programme itself, so it always shows">
                      <Lock size={13} aria-hidden="true" /> Always
                    </span>
                  ) : (
                    <Switch checked={on} disabled={readOnly} label={`Show ${d.label}`} onChange={(v) => setShown(key, v)} />
                  )}
                </li>
              );
            })}
          </ol>
          <div className="dz-order__foot">
            <p className="dz-order__note">
              {kind === 'tikkie' && !custom
                ? 'In the default order, How you get paid sits above Activity until a customer has some activity, then moves below it. Moving anything fixes the order as you set it.'
                : custom
                  ? 'Customers see this order the next time they open the app after you publish.'
                  : 'This is the default order.'}
            </p>
            {custom && (
              <Button variant="ghost" size="sm" icon={RotateCcw} disabled={readOnly} onClick={() => { onOrder(null); onReveal('home'); }}>
                Default order
              </Button>
            )}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          icon={MousePointerClick}
          title="Buttons and logos"
          subtitle="Hide a button without switching its feature off. The features themselves are in Settings → Features."
          actions={<Badge tone="neutral">{buttons.filter(rowOn).length} of {buttons.length} shown</Badge>}
          ruled
        />
        <CardBody>
          <div className="dz-sec-list">
            {buttons.map(r => (
              <SectionRow
                key={r.key}
                row={r}
                on={rowOn(r)}
                blocked={!!r.feature && !featureOn(settings, r.feature)}
                readOnly={readOnly}
                onChange={(v) => { onPatch({ [r.key]: v }); onReveal('home'); }}
                onPeek={() => onReveal('home')}
              />
            ))}
          </div>
        </CardBody>
      </Card>

      {kind === 'rewards' && (
        <Card>
          <CardHeader
            icon={User}
            title="Account screen"
            subtitle="The buttons and cards on the customer’s own page."
            actions={<Badge tone="neutral">{ACCOUNT_ROWS.filter(rowOn).length} of {ACCOUNT_ROWS.length} shown</Badge>}
            ruled
          />
          <CardBody>
            <div className="dz-sec-list">
              {ACCOUNT_ROWS.map(r => (
                <SectionRow
                  key={r.key}
                  row={r}
                  on={rowOn(r)}
                  blocked={!!r.feature && !featureOn(settings, r.feature)}
                  readOnly={readOnly}
                  onChange={(v) => { onPatch({ [r.key]: v }); onReveal('account'); }}
                  onPeek={() => onReveal('account')}
                />
              ))}
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function SectionRow({ row, on, blocked, readOnly, onChange, onPeek }) {
  const id = useId();
  const Icon = row.icon;
  return (
    <div className={`dz-sec${on ? ' is-on' : ''}${blocked ? ' is-blocked' : ''}`} onFocus={onPeek}>
      <span className={`dz-sec__icon ui-tone--${row.tone}`} aria-hidden="true"><Icon size={17} /></span>
      <div className="dz-sec__text">
        <label className="dz-sec__title" htmlFor={id}>{row.label}</label>
        <p className="dz-sec__summary">
          {blocked ? `${row.featureLabel} is off in Settings → Features, so this can’t show.` : row.summary}
        </p>
      </div>
      {blocked && (
        <a className="dz-chip-link" href="#settings?section=features">
          Features <ArrowUpRight size={12} aria-hidden="true" />
        </a>
      )}
      <Switch id={id} checked={on} disabled={blocked || readOnly} label={row.label} onChange={onChange} />
    </div>
  );
}
