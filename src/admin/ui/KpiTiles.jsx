import { useContext, useId } from 'react';
import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { InfoTip } from './primitives';
import { deltaParts, unitFamily } from './metrics';
import { TileDisplayContext } from './tileDisplay';

/* ─────────────────────────────────────────────────────────────────────
 * KPI tiles.
 *
 * A metric definition (shared with TrendCard):
 *   { id, label, icon, tone, description, value, format(v), unit,
 *     delta, deltaText?, deltaLabel?, invertGood?, info?, formula?,
 *     unavailable?, series?: [{ t, value }], previousSeries?, target? }
 *
 * unit: 'count' | 'money' | 'pct' | 'kg' | 'ratio' | 'minutes'. Two
 * metrics can share a chart only when their units match.
 * ───────────────────────────────────────────────────────────────────── */

function Sparkline({ values, color }) {
  const id = useId();
  if (!values || values.length < 2) return null;
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const pts = values.map((v, i) => [3 + (i / (values.length - 1)) * 90, 31 - ((v - min) / span) * 28]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},31 L${pts[0][0].toFixed(1)},31 Z`;
  return (
    <svg viewBox="0 0 96 34" className="ui-kpi__spark" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const TONE_COLOR = {
  violet: '#5B3FD6', emerald: '#0E9468', amber: '#C77A06', sky: '#0B7FB8', rose: '#D92D55',
  teal: '#0F8A7E', orange: '#E2552B', slate: '#5A566A', lime: '#4D8A12',
};

export function KpiTile({
  metric, index = 0, selected, compared, compareColor, blockedReason, isKey,
  onClick, sparkline, interactive = true,
}) {
  const Icon = metric.icon;
  const display = useContext(TileDisplayContext);
  const showSpark = display ? !!display.sparklines : sparkline;
  const na = metric.value == null || !!metric.unavailable;
  const delta = na ? null : deltaParts(metric);
  const DeltaIcon = delta?.dir === 'up' ? TrendingUp : delta?.dir === 'down' ? TrendingDown : Minus;
  const blocked = !!blockedReason && !compared;
  const cls = [
    'ui-kpi',
    !interactive ? 'ui-kpi--static' : '',
    selected ? 'ui-kpi--selected' : '',
    compared ? 'ui-kpi--compared' : '',
    blocked ? 'ui-kpi--blocked' : '',
    isKey ? 'ui-kpi--key' : '',
  ].filter(Boolean).join(' ');
  const Tag = interactive ? 'button' : 'div';
  const value = na ? 'N/A' : (metric.format ? metric.format(metric.value) : String(metric.value));
  return (
    <Tag
      type={interactive ? 'button' : undefined}
      className={cls}
      style={{ animationDelay: `${Math.min(index, 12) * 28}ms`, ...(compared && compareColor ? { '--ui-kpi-ring': compareColor } : null) }}
      onClick={interactive && !blocked ? onClick : undefined}
      aria-pressed={interactive ? !!(selected || compared) : undefined}
      aria-disabled={blocked || undefined}
      aria-label={interactive ? `${metric.label}: ${value}.${blocked ? ` ${blockedReason}` : ' Show on the chart.'}` : undefined}
    >
      {isKey && <span className="ui-kpi__flag">Key metric</span>}
      <div className="ui-kpi__head">
        {Icon && (
          <span className={`ui-kpi__icon ui-tone--${metric.tone || 'violet'}`}>
            <Icon size={17} aria-hidden="true" />
          </span>
        )}
        <span className="ui-kpi__label">{metric.label}</span>
        {(metric.info || metric.unavailable || blockedReason) && (
          <InfoTip label={metric.label} formula={!blocked ? metric.formula : undefined} note={blocked ? null : metric.unavailable}>
            {blocked ? blockedReason : metric.info}
          </InfoTip>
        )}
      </div>
      <div className="ui-kpi__main">
        <div style={{ minWidth: 0 }}>
          <p className={`ui-kpi__value${na ? ' ui-kpi__value--na' : ''}`}>{value}</p>
          {metric.description && <p className="ui-kpi__desc">{na && metric.unavailable ? metric.unavailable : metric.description}</p>}
        </div>
        {showSpark && !na && (
          <Sparkline values={(metric.series || []).map(p => p.value)} color={TONE_COLOR[metric.tone] || TONE_COLOR.violet} />
        )}
      </div>
      {(delta || metric.footnote) && (
        <div className="ui-kpi__foot">
          {delta && (
            <span className={`ui-kpi__delta ui-kpi__delta--${delta.good == null ? 'flat' : delta.good ? 'good' : 'bad'}`}>
              <DeltaIcon size={14} aria-hidden="true" />
              {delta.text}
              {metric.deltaLabel && <span style={{ fontWeight: 500, opacity: 0.85 }}>&nbsp;{metric.deltaLabel}</span>}
            </span>
          )}
          {metric.footnote && <span className="ui-kpi__desc" style={{ margin: 0 }}>{metric.footnote}</span>}
        </div>
      )}
    </Tag>
  );
}

/* A grid of tiles wired to a chart selection.
 *   mode 'single'  — clicking a tile shows it on the chart
 *   mode 'compare' — clicking toggles it in the comparison (same unit only) */
export function KpiGrid({
  metrics, mode = 'single', selectedId, comparedIds = [], onSelect, onToggleCompare,
  colorFor, keyMetricId, sparklines = false, interactive = true,
}) {
  const first = mode === 'compare' && comparedIds.length
    ? metrics.find(m => m.id === comparedIds[0])
    : null;
  return (
    <div className="ui-kpis">
      {metrics.map((m, i) => {
        const compared = mode === 'compare' && comparedIds.includes(m.id);
        let blockedReason = null;
        if (interactive && mode === 'compare' && !compared) {
          if (m.unavailable || m.value == null) blockedReason = 'There is no data to plot for this one yet.';
          else if (!m.series) blockedReason = 'This one has no day-by-day line to compare.';
          else if (first && unitFamily(first.unit) !== unitFamily(m.unit)) {
            blockedReason = `${m.label} is measured differently from ${first.label}, so the two can't share one axis. Clear the comparison to start from this one.`;
          } else if (comparedIds.length >= 4) blockedReason = 'Four metrics at once is the most a chart can show clearly.';
        }
        return (
          <KpiTile
            key={m.id}
            metric={m}
            index={i}
            interactive={interactive}
            selected={mode === 'single' && selectedId === m.id}
            compared={compared}
            compareColor={compared ? colorFor?.(m.id) : undefined}
            blockedReason={blockedReason}
            isKey={keyMetricId === m.id}
            sparkline={sparklines}
            onClick={() => (mode === 'compare' ? onToggleCompare?.(m.id) : onSelect?.(m.id))}
          />
        );
      })}
    </div>
  );
}
