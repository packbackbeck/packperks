import { useId, useState } from 'react';
import { ArrowLeft, Calendar, CalendarRange, Check, ChevronDown } from 'lucide-react';
import { Button, Menu, MenuItem, MenuLabel, MenuSeparator, PERIODS, formatWindow } from '../ui';
import { PERIOD_IDS, fmtDay, parseDayInput, toDayInput } from './behaviourModel';

/* ─────────────────────────────────────────────────────────────────────
 * The period control in the User Behaviour header.
 *
 * The shared presets (as on the Dashboard), plus "This year" and a custom
 * range, which this page has always offered. "Custom range…" turns the
 * menu into a small from/to form, limited to the days there is data for.
 *
 *   value     — a preset id, 'ytd' or 'custom'
 *   custom    — { from, to } as yyyy-mm-dd, used when value is 'custom'
 *   onChange  — (id, custom?) => void
 *   minDate   — ISO date of the first recorded event, if known
 * ───────────────────────────────────────────────────────────────────── */

const PRESETS = PERIODS.filter(p => PERIOD_IDS.includes(p.id));

function periodLabel(value, custom) {
  if (value === 'ytd') return 'This year';
  if (value === 'custom') {
    const from = parseDayInput(custom?.from);
    const to = parseDayInput(custom?.to);
    return from != null && to != null ? formatWindow(Math.min(from, to), Math.max(from, to)) : 'Custom range';
  }
  return (PRESETS.find(p => p.id === value) || PRESETS.find(p => p.id === '30d')).label;
}

function CustomForm({ custom, minDate, onBack, onApply }) {
  const id = useId();
  const [today] = useState(() => toDayInput(Date.now()));
  const min = minDate ? toDayInput(Date.parse(minDate)) : undefined;
  const [from, setFrom] = useState(custom?.from || min || today);
  const [to, setTo] = useState(custom?.to || today);
  const ready = parseDayInput(from) != null && parseDayInput(to) != null;
  return (
    <form
      className="ub-range"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) return;
        const [a, b] = from <= to ? [from, to] : [to, from];
        onApply({ from: a, to: b });
      }}
    >
      <div className="ub-range__head">
        <Button size="sm" variant="ghost" icon={ArrowLeft} aria-label="Back to periods" onClick={onBack} />
        <span className="ub-range__title">Custom range</span>
      </div>
      <div className="ub-range__fields">
        <label className="ui-field" htmlFor={`${id}-from`}>
          <span className="ui-field__label">From</span>
          <input id={`${id}-from`} className="ui-input" type="date" value={from} min={min} max={today} onChange={e => setFrom(e.target.value)} required />
        </label>
        <label className="ui-field" htmlFor={`${id}-to`}>
          <span className="ui-field__label">To</span>
          <input id={`${id}-to`} className="ui-input" type="date" value={to} min={min} max={today} onChange={e => setTo(e.target.value)} required />
        </label>
      </div>
      {min && (
        <p className="ub-range__hint">
          Data starts on {fmtDay(Date.parse(minDate), true)}.
        </p>
      )}
      <Button type="submit" variant="primary" block disabled={!ready}>Show this range</Button>
    </form>
  );
}

export default function DateRangePicker({ value, custom, onChange, minDate }) {
  const [view, setView] = useState('list');
  const current = PRESETS.some(p => p.id === value) || value === 'ytd' || value === 'custom' ? value : '30d';
  const label = periodLabel(current, custom);
  return (
    <Menu
      align="right"
      className="ub-period"
      trigger={({ open, toggle, id }) => (
        <button
          type="button"
          className="ui-btn ui-btn--outline"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          onClick={() => { setView('list'); toggle(); }}
        >
          {current === 'custom' ? <CalendarRange size={15} aria-hidden="true" /> : <Calendar size={15} aria-hidden="true" />}
          {label}
          <ChevronDown size={14} aria-hidden="true" style={{ opacity: 0.6 }} />
        </button>
      )}
    >
      {({ close }) => (view === 'custom' ? (
        <CustomForm
          custom={current === 'custom' ? custom : null}
          minDate={minDate}
          onBack={() => setView('list')}
          onApply={(range) => { onChange('custom', range); close(); }}
        />
      ) : (
        <>
          <MenuLabel>Period</MenuLabel>
          {PRESETS.map(p => (
            <MenuItem key={p.id} checked={p.id === current} onClick={() => onChange(p.id)}>
              <span style={{ display: 'flex', alignItems: 'center' }}>
                {p.label}
                {p.id === current && <Check size={14} className="ui-menu__check" aria-hidden="true" />}
              </span>
            </MenuItem>
          ))}
          <MenuItem checked={current === 'ytd'} onClick={() => onChange('ytd')}>
            <span style={{ display: 'flex', alignItems: 'center' }}>
              This year
              {current === 'ytd' && <Check size={14} className="ui-menu__check" aria-hidden="true" />}
            </span>
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={CalendarRange} checked={current === 'custom'} keepOpen onClick={() => setView('custom')}>
            <span style={{ display: 'flex', alignItems: 'center' }}>
              {current === 'custom' ? label : 'Custom range…'}
              {current === 'custom' && <Check size={14} className="ui-menu__check" aria-hidden="true" />}
            </span>
          </MenuItem>
        </>
      ))}
    </Menu>
  );
}
