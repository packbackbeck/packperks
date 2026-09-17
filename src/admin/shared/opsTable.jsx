import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowUp, ArrowUpDown, CircleAlert, CircleCheck, Info, Search, TriangleAlert, X } from 'lucide-react';
import './opsTable.css';

/* ─────────────────────────────────────────────────────────────────────
 * Small pieces shared by the operational table pages (Users, Claims,
 * Cup scans, Cup transfers, Donations), in the admin design system.
 * Styles: opsTable.css. Tokens: ui/ui.css.
 * ───────────────────────────────────────────────────────────────────── */

const TONES = ['violet', 'emerald', 'amber', 'sky', 'rose', 'teal', 'orange', 'slate'];

/* A stable tone per person, so the same customer keeps one colour. */
function toneFor(seed) {
  const key = String(seed || '');
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (31 * h + key.charCodeAt(i)) >>> 0;
  return TONES[h % TONES.length];
}

export function Avatar({ name, seed, size = 30, className = '' }) {
  const letter = (name || '?')[0].toUpperCase();
  return (
    <span
      className={`ot-avatar ui-tone--${toneFor(seed || name)} ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
      aria-hidden="true"
    >
      {letter}
    </span>
  );
}

/* Column header. `sort` is { key, dir }; clicking (or Enter) calls onSort(field). */
export function SortTh({ label, field, sort, onSort, sortable = true, style, className = '' }) {
  const active = sortable && sort?.key === field;
  const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
  const cls = [className, sortable ? 'ot-th--sortable' : '', active ? 'ot-th--active' : ''].filter(Boolean).join(' ');
  return (
    <th
      style={style}
      className={cls || undefined}
      onClick={sortable ? () => onSort(field) : undefined}
      onKeyDown={sortable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSort(field); } } : undefined}
      tabIndex={sortable ? 0 : undefined}
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
    >
      <span className="ot-th">
        {label}
        {sortable && <Icon size={12} className="ot-th__icon" aria-hidden="true" />}
      </span>
    </th>
  );
}

export function SearchBox({ value, onChange, placeholder, label, className = '' }) {
  return (
    <div className={`ot-search ${className}`}>
      <Search size={14} aria-hidden="true" />
      <input
        className="ot-search__input"
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        aria-label={label || placeholder}
      />
      {value && (
        <button type="button" className="ot-search__clear" aria-label="Clear search" onClick={() => onChange('')}>
          <X size={13} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/* Drag handle between a table and its detail panel. */
export function SplitHandle({ onMouseDown, onDoubleClick, label, className = '' }) {
  return (
    <div
      className={`ot-split ${className}`}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title="Drag to resize · double-click to reset"
    >
      <span className="ot-split__grip" aria-hidden="true" />
    </div>
  );
}

/* Full-screen image viewer. Rendered at the root of the dashboard so it
 * covers the top bar and keeps the admin's tokens. Escape closes it. */
export function Lightbox({ src, alt = 'Image', onClose }) {
  useEffect(() => {
    if (!src) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [src, onClose]);
  if (!src) return null;
  const host = document.querySelector('.admin-app') || document.body;
  return createPortal(
    <div className="ot-lightbox" onClick={onClose} role="dialog" aria-modal="true" aria-label={alt}>
      <button type="button" className="ot-lightbox__close" aria-label="Close" onClick={e => { e.stopPropagation(); onClose?.(); }}>
        <X size={18} aria-hidden="true" />
      </button>
      <img src={src} alt={alt} className="ot-lightbox__img" onClick={e => e.stopPropagation()} />
    </div>,
    host,
  );
}

const NOTICE_ICON = { danger: CircleAlert, warning: TriangleAlert, success: CircleCheck, info: Info };

/* One-line status message: errors, confirmations, read-only hints. */
export function Notice({ tone = 'info', children, action, onDismiss, className = '' }) {
  const Icon = NOTICE_ICON[tone] || Info;
  return (
    <div className={`ot-notice ot-notice--${tone} ${className}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon size={16} className="ot-notice__icon" aria-hidden="true" />
      <div className="ot-notice__text">{children}</div>
      {action}
      {onDismiss && (
        <button type="button" className="ot-notice__close" aria-label="Dismiss" onClick={onDismiss}>
          <X size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
