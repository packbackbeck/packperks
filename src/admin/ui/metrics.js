/* Helpers shared by the KPI tiles and the pages that build metrics. */

export const unitFamily = (unit) => unit || 'count';

export function deltaParts(metric) {
  const d = metric.delta;
  if (d == null || !Number.isFinite(d)) return null;
  const dir = Math.abs(d) < 0.05 ? 'flat' : d > 0 ? 'up' : 'down';
  const good = dir === 'flat' ? null : (dir === 'up') !== !!metric.invertGood;
  const abs = Math.abs(d);
  const text = metric.deltaText
    ?? (metric.unit === 'pct'
      ? `${d > 0 ? '+' : d < 0 ? '−' : ''}${abs.toFixed(1)} pts`
      : `${d > 0 ? '+' : d < 0 ? '−' : ''}${abs >= 10 ? abs.toFixed(0) : abs.toFixed(1)}%`);
  return { dir, good, text };
}
