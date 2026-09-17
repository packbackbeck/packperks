import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Columns3 } from 'lucide-react';
import './ColumnPicker.css';

/* ─────────────────────────────────────────────────────────────────────
 * ColumnPicker — reusable show/hide-columns dropdown for any admin
 * table. Extracted from the original AdminClaims implementation so we
 * can reuse the exact same affordance in AdminCupScans (and anywhere
 * else that grows a fat table later).
 *
 * Storage is owned by the caller (passed-in `visible` Set + onToggle /
 * onReset callbacks) so each table can persist to its own localStorage
 * key. That also keeps this component pure / easy to test.
 *
 * Props:
 *   • columns   — [{ id, label, desc, defaultOn }]
 *   • visible   — Set<string> of currently-on column ids
 *   • onToggle(id)
 *   • onReset()   — snap back to defaultOn for all
 *
 * Auto-closes on click-outside and Esc.
 * ───────────────────────────────────────────────────────────────────── */
export default function ColumnPicker({ columns, visible, onToggle, onReset }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const shown = columns.filter(c => visible.has(c.id)).length;

  return (
    <div className="cp" ref={wrapRef}>
      <button
        type="button"
        className="ui-btn ui-btn--outline cp__trigger"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        title="Show or hide columns"
      >
        <Columns3 size={15} aria-hidden="true" />
        Columns
        <span className="cp__count">{shown}/{columns.length}</span>
        <ChevronDown size={14} className="cp__chev" aria-hidden="true" />
      </button>
      {open && (
        <div className="cp__menu" role="menu">
          <div className="cp__head">
            <span className="cp__title">Show columns</span>
            <button
              type="button"
              className="cp__reset"
              onClick={onReset}
            >
              Reset
            </button>
          </div>
          {columns.map(c => (
            <label key={c.id} className={`cp__row${visible.has(c.id) ? ' cp__row--on' : ''}`}>
              <input
                type="checkbox"
                checked={visible.has(c.id)}
                onChange={() => onToggle(c.id)}
              />
              <span className="cp__row-label">
                <span className="cp__row-name">{c.label}</span>
                {c.desc && <span className="cp__row-desc">{c.desc}</span>}
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
