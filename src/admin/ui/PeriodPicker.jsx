import { Calendar, Check, ChevronDown } from 'lucide-react';
import { Menu, MenuItem, MenuLabel } from './primitives';
import { PERIODS, periodById } from './timeSeries';

/* The period dropdown in a page header. `allowed` narrows the list. */
export function PeriodPicker({ value, onChange, allowed }) {
  const options = allowed ? PERIODS.filter(p => allowed.includes(p.id)) : PERIODS;
  const current = periodById(value);
  return (
    <Menu
      align="right"
      trigger={({ open, toggle, id }) => (
        <button
          type="button"
          className="ui-btn ui-btn--outline"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          onClick={toggle}
        >
          <Calendar size={15} aria-hidden="true" />
          {current.label}
          <ChevronDown size={14} aria-hidden="true" style={{ opacity: 0.6 }} />
        </button>
      )}
    >
      <MenuLabel>Period</MenuLabel>
      {options.map(p => (
        <MenuItem key={p.id} checked={p.id === current.id} onClick={() => onChange(p.id)}>
          <span style={{ display: 'flex', alignItems: 'center' }}>
            {p.label}
            {p.id === current.id && <Check size={14} className="ui-menu__check" aria-hidden="true" />}
          </span>
        </MenuItem>
      ))}
    </Menu>
  );
}
