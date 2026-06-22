/* ─────────────────────────────────────────────────────────────────────
 * Shared value formatting for User Behaviour metrics.
 *
 * Every metric carries a `valueType` ('percent' | 'duration' | 'count')
 * and a numeric `rawValue`, plus a time `series` of { t, v } points. These
 * helpers turn raw numbers into the strings shown on cards, in the detail
 * modal, on chart axes, and in tooltips — so the same metric reads the
 * same everywhere. Kept in the lib layer because the stats builder
 * (adminApi) and the UI both need them.
 * ───────────────────────────────────────────────────────────────────── */

export function fmtDuration(ms) {
  if (ms == null || Number.isNaN(ms)) return null;
  const sec = ms / 1000;
  if (sec < 90) return `${Math.round(sec)} sec`;
  const min = sec / 60;
  if (min < 90) return `${Math.round(min)} min`;
  const hr = min / 60;
  if (hr < 48) return `${hr.toFixed(1)} hours`;
  return `${(hr / 24).toFixed(1)} days`;
}

export function fmtPct(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}%`;
}

export function fmtNum(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString();
}

/* Format a metric's raw numeric value according to its valueType. Used
 * for chart tooltips and the modal's headline figure. */
export function fmtMetricValue(valueType, v) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  if (valueType === 'percent') return fmtPct(v);
  if (valueType === 'duration') return fmtDuration(v) ?? '—';
  return fmtNum(v);
}

/* Compact axis-tick label for a metric value (shorter than the tooltip). */
export function fmtAxisValue(valueType, v) {
  if (v === null || v === undefined || Number.isNaN(v)) return '';
  if (valueType === 'percent') return `${Math.round(v)}%`;
  if (valueType === 'duration') {
    const sec = v / 1000;
    if (sec < 90) return `${Math.round(sec)}s`;
    const min = sec / 60;
    if (min < 90) return `${Math.round(min)}m`;
    const hr = min / 60;
    if (hr < 48) return `${Math.round(hr)}h`;
    return `${Math.round(hr / 24)}d`;
  }
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return String(Math.round(v));
}
