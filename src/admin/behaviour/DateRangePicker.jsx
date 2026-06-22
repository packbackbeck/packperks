import { useEffect, useRef, useState } from 'react';

/* ─────────────────────────────────────────────────────────────────────
 * DateRangePicker — the time-window control above the behaviour metrics.
 *
 * A single pill shows the active window ("All time" or "1 May – 15 Jun
 * 2026"). Clicking opens a popover with quick presets on the left and a
 * custom from/to range on the right, the custom inputs clamped to the
 * dates we actually have data for. Choosing a preset applies instantly;
 * a custom range applies on "Apply". The parent only ever receives a
 * resolved { from, to } (ISO strings, or nulls for all-time).
 * ───────────────────────────────────────────────────────────────────── */

const DAY = 86400000;

const PRESETS = [
  { id: 'all',  label: 'All time' },
  { id: '7d',   label: 'Last 7 days',  days: 7 },
  { id: '30d',  label: 'Last 30 days', days: 30 },
  { id: '90d',  label: 'Last 90 days', days: 90 },
  { id: 'ytd',  label: 'This year' },
];

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const endOfDay   = (d) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };

// yyyy-mm-dd for <input type="date">, in local time.
function toInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function fmtNice(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function resolvePreset(p) {
  if (!p || p.id === 'all') return { from: null, to: null };
  const now = new Date();
  if (p.id === 'ytd') {
    return { from: new Date(now.getFullYear(), 0, 1).toISOString(), to: endOfDay(now).toISOString() };
  }
  const from = startOfDay(new Date(now.getTime() - (p.days - 1) * DAY));
  return { from: from.toISOString(), to: endOfDay(now).toISOString() };
}

export default function DateRangePicker({ value, meta, onChange }) {
  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState('');
  const [draftTo, setDraftTo] = useState('');
  const wrapRef = useRef(null);

  const isAll = !value?.from && !value?.to;
  const minInput = toInput(meta?.minDate);
  const maxInput = toInput(meta?.maxDate);

  // Seed the custom inputs from the active window (or the data extent) each
  // time the popover opens, so "Custom" starts somewhere sensible.
  useEffect(() => {
    if (!open) return;
    setDraftFrom(toInput(value?.from) || minInput);
    setDraftTo(toInput(value?.to) || maxInput);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const label = isAll ? 'All time' : `${fmtNice(value.from)} – ${fmtNice(value.to)}`;

  function applyPreset(p) {
    onChange(resolvePreset(p));
    setOpen(false);
  }
  function applyCustom() {
    if (!draftFrom || !draftTo) return;
    let from = startOfDay(draftFrom);
    let to = endOfDay(draftTo);
    if (from > to) { const t = from; from = startOfDay(to); to = endOfDay(t); } // tolerate reversed
    onChange({ from: from.toISOString(), to: to.toISOString() });
    setOpen(false);
  }

  return (
    <div className="ub-range" ref={wrapRef}>
      <button className="ub-range__pill" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="4.5" width="18" height="16" rx="2" /><path d="M3 9h18M8 2.5v4M16 2.5v4" />
        </svg>
        <span className="ub-range__label">{label}</span>
        <svg className="ub-range__caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <>
          <div className="ub-range__backdrop" onClick={() => setOpen(false)} role="presentation" />
          <div className="ub-range__pop" role="dialog" aria-label="Choose a time period">
            <div className="ub-range__presets">
              {PRESETS.map(p => {
                const r = resolvePreset(p);
                const active = (p.id === 'all' && isAll) ||
                  (p.id !== 'all' && !isAll && r.from === value.from && r.to === value.to);
                return (
                  <button key={p.id} className={`ub-range__preset${active ? ' is-active' : ''}`} onClick={() => applyPreset(p)}>
                    {p.label}
                  </button>
                );
              })}
            </div>
            <div className="ub-range__custom">
              <div className="ub-range__custom-title">Custom range</div>
              <label className="ub-range__field">
                <span>From</span>
                <input type="date" value={draftFrom} min={minInput} max={maxInput} onChange={e => setDraftFrom(e.target.value)} />
              </label>
              <label className="ub-range__field">
                <span>To</span>
                <input type="date" value={draftTo} min={minInput} max={maxInput} onChange={e => setDraftTo(e.target.value)} />
              </label>
              {meta?.minDate && (
                <p className="ub-range__hint">Data spans {fmtNice(meta.minDate)} – {fmtNice(meta.maxDate)}</p>
              )}
              <button className="ub-range__apply" onClick={applyCustom} disabled={!draftFrom || !draftTo}>
                Apply range
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
