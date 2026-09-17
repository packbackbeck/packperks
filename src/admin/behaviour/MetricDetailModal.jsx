import { useId } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { ChartLine, Minus, TrendingDown, TrendingUp } from 'lucide-react';
import {
  Button, Modal, Segmented, deltaParts, fmtCompact, fmtInt, formatBucket, formatBucketFull, usePersistentState,
} from '../ui';
import { BreakdownChart, BreakdownViewToggle } from './BreakdownCard';
import { GROUPS } from './behaviourCopy';
import { fmtDay } from './behaviourModel';

/* ─────────────────────────────────────────────────────────────────────
 * The detail window for one metric: its value and change, the counts it
 * came from, what it means and how it's calculated, its breakdown when it
 * has one, and how it moved through the period. The "Show in" control
 * moves the metric between the page's sections (saved in this browser).
 * ───────────────────────────────────────────────────────────────────── */

const CHART_COLOR = '#5B3FD6';
const GROUP_OPTIONS = GROUPS.map(g => ({ id: g.id, label: g.title, title: g.hint }));

function Stat({ label, value, sub }) {
  return (
    <div className="ub-detail__stat">
      <p className="ui-mini-stat__label">{label}</p>
      <p className="ui-mini-stat__value">{value}</p>
      {sub && <p className="ui-mini-stat__sub">{sub}</p>}
    </div>
  );
}

function MiniChart({ metric, points, granularity }) {
  const gid = useId();
  const count = metric.kind === 'count';
  const tick = (v) => {
    if (metric.kind === 'pct') return `${Math.round(v)}%`;
    if (metric.axisFormat) return metric.axisFormat(v);
    return fmtCompact(v);
  };
  const tip = ({ active, payload }) => (active && payload?.length ? (
    <div className="ui-series-tip">
      <p className="ui-series-tip__when">{formatBucketFull(payload[0].payload.t, granularity)}</p>
      <div className="ui-series-tip__row">
        <span className="ui-chart__swatch" style={{ background: CHART_COLOR }} />
        <span className="ui-series-tip__val">{metric.format(payload[0].value)}</span>
        <span className="ui-series-tip__lbl">{metric.label}</span>
      </div>
    </div>
  ) : null);
  const axes = (
    <>
      <CartesianGrid stroke="#ECEAF2" vertical={false} />
      <XAxis
        dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} padding={count ? { left: 12, right: 12 } : undefined}
        tick={{ fontSize: 11, fill: '#8F8B9C' }} axisLine={false} tickLine={false} minTickGap={28}
        tickFormatter={(t) => formatBucket(t, granularity)}
      />
      <YAxis
        tick={{ fontSize: 11, fill: '#8F8B9C' }} axisLine={false} tickLine={false} width={48} tickCount={4}
        allowDecimals={!count} tickFormatter={tick}
        domain={metric.kind === 'pct' ? [0, (max) => Math.max(10, Math.min(100, Math.ceil(max / 10) * 10))] : [0, 'auto']}
      />
      <Tooltip cursor={count ? { fill: 'rgba(91, 63, 214, 0.06)' } : { stroke: '#8F8B9C', strokeOpacity: 0.4 }} content={tip} />
    </>
  );
  return (
    <div style={{ width: '100%', height: 170 }}>
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 640, height: 170 }}>
        {count ? (
          <BarChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            {axes}
            <Bar dataKey="value" fill={CHART_COLOR} radius={[3, 3, 0, 0]} maxBarSize={22} isAnimationActive={false} />
          </BarChart>
        ) : (
          <AreaChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CHART_COLOR} stopOpacity={0.2} />
                <stop offset="100%" stopColor={CHART_COLOR} stopOpacity={0} />
              </linearGradient>
            </defs>
            {axes}
            <Area
              type="monotone" dataKey="value" stroke={CHART_COLOR} strokeWidth={2} fill={`url(#${gid})`}
              dot={points.length <= 16 ? { r: 2.5, fill: CHART_COLOR, strokeWidth: 0 } : false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }} isAnimationActive={false}
            />
          </AreaChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

export default function MetricDetailModal({
  metric: m, group, onGroupChange, onClose, onChart, granularity = 'day', stepLabel, windowLabel, breakdownCopy,
}) {
  const [view, setView] = usePersistentState(`pp-behaviour:breakdown:${m.id}`, 'bar');
  const na = m.value == null || !!m.unavailable;
  const delta = na ? null : deltaParts(m);
  const DeltaIcon = delta?.dir === 'up' ? TrendingUp : delta?.dir === 'down' ? TrendingDown : Minus;
  const points = (m.points || []).filter(p => p.value != null);
  const { num, den, numLabel, denLabel } = m.basis || {};
  const breakdownTotal = (m.breakdown || []).reduce((s, r) => s + (r.count || 0), 0);

  // The highest point of the period: the busiest step for counts, the
  // peak of the running value otherwise.
  let peak = null;
  for (const p of points) if (!peak || p.value > peak.value) peak = p;

  return (
    <Modal
      open
      wide
      onClose={onClose}
      icon={m.icon}
      iconTone={m.tone}
      title={m.label}
      subtitle={windowLabel}
      footer={(
        <div className="ub-detail__footer">
          <div className="ub-detail__group">
            <span className="ub-detail__group-label">Show in</span>
            <Segmented options={GROUP_OPTIONS} value={group} onChange={onGroupChange} ariaLabel="Section on this page" />
          </div>
          <div className="ub-detail__actions">
            {m.chartable && <Button variant="outline" icon={ChartLine} onClick={onChart}>Show on chart</Button>}
            <Button variant="primary" onClick={onClose}>Done</Button>
          </div>
        </div>
      )}
    >
      <div className="ub-detail__hero">
        <p className={`ub-detail__value${na ? ' ub-detail__value--na' : ''}`}>{na ? 'No data' : m.format(m.value)}</p>
        <div className="ub-detail__hero-side">
          {delta && (
            <span className={`ui-kpi__delta ui-kpi__delta--${delta.good == null ? 'flat' : delta.good ? 'good' : 'bad'}`}>
              <DeltaIcon size={14} aria-hidden="true" />
              {delta.text}
              {m.deltaLabel && <span className="ub-detail__muted">&nbsp;{m.deltaLabel}</span>}
            </span>
          )}
          {!delta && m.footnote && <span className="ub-detail__muted">{m.footnote}</span>}
          <span className="ub-detail__muted">{na ? m.unavailable : m.description}</span>
        </div>
      </div>

      {(numLabel && num != null) || m.prevRaw || peak ? (
        <div className="ub-detail__stats">
          {numLabel && num != null && <Stat label={numLabel} value={fmtInt(num)} />}
          {denLabel && den != null && <Stat label={denLabel} value={fmtInt(den)} />}
          {m.prevRaw && (
            <Stat
              label="Previous period"
              value={m.prevDisplay ?? '—'}
              sub={m.deltaLabel ? m.deltaLabel.replace(/^vs /, '') : undefined}
            />
          )}
          {peak && m.kind !== 'text' && points.length > 1 && (
            <Stat
              label={m.kind === 'count' ? `Busiest ${stepLabel || 'day'}` : 'Highest in period'}
              value={m.format(peak.value)}
              sub={fmtDay(peak.t)}
            />
          )}
        </div>
      ) : null}

      <div className="ub-detail__text">
        <h4 className="ub-detail__h">What it shows</h4>
        <p>{m.info}</p>
        {m.formula && (
          <>
            <h4 className="ub-detail__h">How it’s calculated</h4>
            <p className="ub-detail__formula">{m.formula}</p>
          </>
        )}
      </div>

      {breakdownTotal > 0 && (
        <section className="ub-detail__section">
          <div className="ub-detail__section-head">
            <h4 className="ub-detail__h">{breakdownCopy?.title || 'Breakdown'}</h4>
            <BreakdownViewToggle value={view} onChange={setView} />
          </div>
          <BreakdownChart rows={m.breakdown} noun={breakdownCopy?.noun} view={view} />
        </section>
      )}

      {points.length > 1 && (
        <section className="ub-detail__section">
          <h4 className="ub-detail__h">
            {m.kind === 'count' ? `${m.label} per ${stepLabel || 'day'}` : `${m.label} through the period`}
          </h4>
          <MiniChart metric={m} points={points} granularity={granularity} />
          <p className="ub-detail__cap">
            {m.kind === 'count'
              ? 'Each bar counts what happened in that step.'
              : 'Each point counts everything from the start of the period up to that day, so the line ends at the value above.'}
          </p>
        </section>
      )}
    </Modal>
  );
}
