import { useEffect, useRef, useState } from 'react';
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

  return (
    <div className="cp" ref={wrapRef}>
      <button
        type="button"
        className="cp__trigger"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        title="Show or hide columns"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="18" rx="1" />
          <rect x="14" y="3" width="7" height="11" rx="1" />
        </svg>
        Columns
        <span className="cp__count">{visible.size}/{columns.length}</span>
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
            <label key={c.id} className="cp__row">
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
