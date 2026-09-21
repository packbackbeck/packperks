import { useId } from 'react';
import { ArrowUpRight, LayoutGrid } from 'lucide-react';
import { Badge, Card, CardBody, CardHeader, Switch } from '../ui';
import { SECTION_GROUPS, featureOn } from './designModel';

/* Sections: switch parts of the app on or off without touching the
 * feature behind them. A part whose feature is off in Settings can't be
 * shown, and says where to change that. */
export default function SectionsPanel({ sections, settings, readOnly, onPatch, onReveal, only = null }) {
  // `only`: the row keys that apply (Deferred Tikkie shows just the logos).
  const groups = only
    ? SECTION_GROUPS.map(g => ({ ...g, rows: g.rows.filter(r => only.includes(r.key)) })).filter(g => g.rows.length)
    : SECTION_GROUPS;
  const rows = groups.flatMap(g => g.rows);
  const isOn = (r) => (!r.feature || featureOn(settings, r.feature)) && sections[r.key] !== false;
  const shown = rows.filter(isOn).length;

  return (
    <div className="dz-stack">
      <Card>
        <CardHeader
          icon={LayoutGrid}
          title="What customers see"
          subtitle="Hide a part of the app without switching its feature off. The features themselves are in Settings → Features."
          actions={<Badge tone="neutral">{shown} of {rows.length} shown</Badge>}
          ruled
        />
        <CardBody>
          {groups.map(g => (
            <section key={g.id} className="dz-sec-group" aria-labelledby={`dz-sg-${g.id}`}>
              <div className="dz-rule-head">
                <h3 id={`dz-sg-${g.id}`} className="dz-group-label">{g.title}</h3>
                <span className="dz-rule" aria-hidden="true" />
              </div>
              <div className="dz-sec-list">
                {g.rows.map(r => (
                  <SectionRow
                    key={r.key}
                    row={r}
                    on={isOn(r)}
                    blocked={!!r.feature && !featureOn(settings, r.feature)}
                    readOnly={readOnly}
                    onChange={(v) => { onPatch({ [r.key]: v }); onReveal(g.screen); }}
                    onPeek={() => onReveal(g.screen)}
                  />
                ))}
              </div>
            </section>
          ))}
        </CardBody>
      </Card>
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
