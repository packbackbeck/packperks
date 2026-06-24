import { useEffect, useState } from 'react';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, LabelList,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import MetricIcon from './behaviourIcons';
import { fmtMetricValue, fmtAxisValue, fmtNum } from '../lib/behaviourFormat';

/* ─────────────────────────────────────────────────────────────────────
 * MetricDetailModal — the deep-dive for a single behaviour tile.
 *
 * Tailored to whichever metric was clicked: its headline value, the raw
 * numerator/denominator it came from, exactly how it's calculated, a plain
 * reading of the trend, and — for every metric — a line/area chart of how
 * it has moved over the selected window. The category dropdown re-files the
 * metric between Primary / Secondary / Optional, live.
 *
 * Metrics that carry a per-item `breakdown` (e.g. Button clicks) get a
 * dedicated bar/pie section in the middle showing the count for each item,
 * and their time-series chart is moved to the bottom.
 * ───────────────────────────────────────────────────────────────────── */

const ACCENT = '#1A8737';

// Distinct, on-brand palette for the per-button breakdown.
const PALETTE = ['#5333A5', '#1A8737', '#E0A12B', '#2EA785', '#5468C8', '#E08A53', '#C0392B', '#8A8175'];

function MetricTooltip({ active, payload, label, valueType }) {
  if (!active || !payload?.length) return null;
  const v = payload[0]?.value;
  return (
    <div className="ub-tip">
      <div className="ub-tip__label">{label}</div>
      <div className="ub-tip__val">
        <span className="ub-tip__dot" style={{ background: ACCENT }} />
        {v == null ? 'No data' : fmtMetricValue(valueType, v)}
      </div>
    </div>
  );
}

function BreakdownTip({ active, payload, total }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload || {};
  const pct = total > 0 ? Math.round((row.count / total) * 100) : 0;
  return (
    <div className="ub-tip">
      <div className="ub-tip__label">{row.label}</div>
      <div className="ub-tip__val">
        <span className="ub-tip__dot" style={{ background: row._color || ACCENT }} />
        {fmtNum(row.count)} {row.count === 1 ? 'click' : 'clicks'} · {pct}%
      </div>
    </div>
  );
}

/* "Redeemed receipts ÷ Generated receipts", or a sensible base line for the
 * metrics that aren't a ratio (durations, counts). */
function calcLine(m) {
  if (m.numLabel && m.denLabel) return `${m.numLabel} ÷ ${m.denLabel}`;
  if (m.valueType === 'duration' && m.numLabel) return `Averaged across ${fmtNum(m.numerator)} · ${m.numLabel.toLowerCase()}`;
  if (m.numLabel) return `${m.numLabel}: ${fmtNum(m.numerator)}`;
  return null;
}

function trendOf(m) {
  const pts = (m.series || []).filter(p => p.v != null);
  if (pts.length < 2) return null;
  const first = pts[0].v, last = pts[pts.length - 1].v;
  const delta = last - first;
  const peak = pts.reduce((mx, p) => (p.v > mx ? p.v : mx), pts[0].v);
  let deltaText;
  if (m.valueType === 'percent') deltaText = `${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(1)} pts`;
  else if (m.valueType === 'count') deltaText = `${delta >= 0 ? '+' : '−'}${fmtNum(Math.abs(delta))}`;
  else deltaText = `${delta >= 0 ? '+' : '−'}${fmtMetricValue(m.valueType, Math.abs(delta))}`;
  return { delta, deltaText, peak, dir: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat' };
}

/* Per-item breakdown: counts per button as a bar chart, toggleable to a
 * pie with percentages. Used for the Button-clicks metric. */
function ClickBreakdown({ items }) {
  const [view, setView] = useState('bar');
  const rows = items.map((b, i) => ({ ...b, _color: PALETTE[i % PALETTE.length] }));
  const total = rows.reduce((s, b) => s + b.count, 0);
  const barHeight = Math.max(150, rows.length * 46 + 16);

  return (
    <div className="ub-bd">
      <div className="ub-bd__head">
        <div>
          <h3 className="ub-bd__title">Clicks by button</h3>
          <p className="ub-bd__sub">{fmtNum(total)} tracked interactions across {rows.length} buttons</p>
        </div>
        <div className="ub-seg" role="tablist" aria-label="Chart type">
          <button role="tab" aria-selected={view === 'bar'} className={`ub-seg__btn${view === 'bar' ? ' is-active' : ''}`} onClick={() => setView('bar')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="4" y1="20" x2="4" y2="10"/><line x1="10" y1="20" x2="10" y2="4"/><line x1="16" y1="20" x2="16" y2="13"/><line x1="22" y1="20" x2="2" y2="20"/></svg>
            Bar
          </button>
          <button role="tab" aria-selected={view === 'pie'} className={`ub-seg__btn${view === 'pie' ? ' is-active' : ''}`} onClick={() => setView('pie')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a10 10 0 1 0 10 10H12z"/><path d="M12 2v10h10A10 10 0 0 0 12 2z"/></svg>
            Pie
          </button>
        </div>
      </div>

      {view === 'bar' ? (
        <ResponsiveContainer width="100%" height={barHeight}>
          <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 36, left: 4, bottom: 4 }} barCategoryGap="28%">
            <CartesianGrid strokeDasharray="3 3" stroke="#F0ECE5" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11, fill: '#9E9A93' }} tickLine={false} axisLine={false} allowDecimals={false} />
            <YAxis type="category" dataKey="label" width={92} tick={{ fontSize: 12, fill: '#4A443D' }} tickLine={false} axisLine={false} />
            <Tooltip cursor={{ fill: 'rgba(83,51,165,0.05)' }} content={<BreakdownTip total={total} />} />
            <Bar dataKey="count" radius={[0, 6, 6, 0]} isAnimationActive={false}>
              {rows.map(r => <Cell key={r.key} fill={r._color} />)}
              <LabelList dataKey="count" position="right" style={{ fontSize: 11, fontWeight: 700, fill: '#4A443D' }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <div className="ub-bd__pie">
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={rows} dataKey="count" nameKey="label" cx="50%" cy="50%" innerRadius={48} outerRadius={86}
                paddingAngle={2} isAnimationActive={false}
                label={({ percent }) => (percent >= 0.06 ? `${Math.round(percent * 100)}%` : '')}
                labelLine={false} stroke="#fff" strokeWidth={2}>
                {rows.map(r => <Cell key={r.key} fill={r._color} />)}
              </Pie>
              <Tooltip content={<BreakdownTip total={total} />} />
            </PieChart>
          </ResponsiveContainer>
          <ul className="ub-bd__legend">
            {rows.map(r => (
              <li key={r.key} className="ub-bd__legend-item">
                <span className="ub-bd__legend-dot" style={{ background: r._color }} />
                <span className="ub-bd__legend-label">{r.label}</span>
                <span className="ub-bd__legend-val">{fmtNum(r.count)} · {total > 0 ? Math.round((r.count / total) * 100) : 0}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function MetricDetailModal({ metric: m, effectiveGroup, groups, onChangeGroup, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const headline = !m.measurable
    ? 'Not tracked yet'
    : (m.valueText || (m.rawValue == null ? 'No data yet' : fmtMetricValue(m.valueType, m.rawValue)));

  const data = (m.series || []).map(p => ({ label: p.label, v: p.v }));
  const hasSeries = data.some(p => p.v != null);
  const trend = trendOf(m);
  const calc = calcLine(m);
  const hasSubs = m.numLabel != null && m.numerator != null;
  const hasBreakdown = Array.isArray(m.breakdown) && m.breakdown.length > 0;

  // The time-series chart. Rendered near the top normally, or moved to the
  // bottom of the modal for metrics that lead with a breakdown.
  const timeChart = (
    <div className="ub-detail__chart">
      {hasSeries ? (
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
            <defs>
              <linearGradient id="ubGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={ACCENT} stopOpacity={0.22} />
                <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#EFEAE1" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9E9A93' }} tickLine={false} axisLine={{ stroke: '#EFEAE1' }} minTickGap={18} />
            <YAxis tick={{ fontSize: 11, fill: '#9E9A93' }} tickLine={false} axisLine={false} width={44}
              tickFormatter={(v) => fmtAxisValue(m.valueType, v)} />
            <Tooltip content={<MetricTooltip valueType={m.valueType} />} />
            <Area type="monotone" dataKey="v" stroke={ACCENT} strokeWidth={2.2} fill="url(#ubGrad)"
              connectNulls dot={{ r: 2, fill: ACCENT }} activeDot={{ r: 4 }} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      ) : (
        <div className="ub-detail__chart-empty">No data points in this period yet.</div>
      )}
      <div className="ub-detail__chart-cap">{hasBreakdown ? 'Total over the selected period (cumulative).' : 'Progress over the selected period (cumulative).'}</div>
    </div>
  );

  return (
    <div className="ub-detail-overlay" onClick={onClose} role="presentation">
      <div className="ub-detail" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={m.label}>
        {/* Header */}
        <div className="ub-detail__head">
          <div className="ub-detail__head-main">
            <span className="ub-detail__icon"><MetricIcon id={m.id} width="22" height="22" /></span>
            <div>
              <h2 className="ub-detail__title">{m.label}</h2>
              <p className="ub-detail__desc">{m.desc}</p>
            </div>
          </div>
          <button className="ub-detail__close" onClick={onClose} aria-label="Close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        {/* Headline value + trend */}
        <div className="ub-detail__hero">
          <div className={`ub-detail__value${!m.measurable ? ' is-na' : ''}`}>{headline}</div>
          {trend && (
            <span className={`ub-detail__trend ub-detail__trend--${trend.dir}`}>
              {trend.dir === 'up' ? '▲' : trend.dir === 'down' ? '▼' : '■'} {trend.deltaText}
              <span className="ub-detail__trend-cap">over this period</span>
            </span>
          )}
        </div>

        {/* Middle: per-button breakdown (button_clicks) OR the time chart */}
        {hasBreakdown ? <ClickBreakdown items={m.breakdown} /> : timeChart}

        {/* Tailored figures */}
        {m.measurable ? (
          <div className="ub-detail__facts">
            {hasSubs && (
              <div className="ub-detail__subs">
                <div className="ub-detail__sub">
                  <span className="ub-detail__sub-num">{fmtNum(m.numerator)}</span>
                  <span className="ub-detail__sub-lbl">{m.numLabel}</span>
                </div>
                {m.denLabel != null && m.denominator != null && (
                  <>
                    <span className="ub-detail__sub-op">/</span>
                    <div className="ub-detail__sub">
                      <span className="ub-detail__sub-num">{fmtNum(m.denominator)}</span>
                      <span className="ub-detail__sub-lbl">{m.denLabel}</span>
                    </div>
                  </>
                )}
              </div>
            )}
            <dl className="ub-detail__meta">
              {calc && (<><dt>How it's calculated</dt><dd>{calc}</dd></>)}
              {trend && (<><dt>Peak in period</dt><dd>{fmtMetricValue(m.valueType, trend.peak)}</dd></>)}
            </dl>
          </div>
        ) : (
          <div className="ub-detail__note">{m.note}</div>
        )}

        {/* Category control */}
        <div className="ub-detail__cat">
          <div className="ub-detail__cat-text">
            <span className="ub-detail__cat-title">Category</span>
            <span className="ub-detail__cat-sub">Move this metric between sections on the dashboard.</span>
          </div>
          <select
            className="ub-detail__cat-select"
            value={effectiveGroup}
            onChange={e => onChangeGroup(e.target.value)}
          >
            {groups.map(g => <option key={g.id} value={g.id}>{g.title}</option>)}
          </select>
        </div>

        {/* Time-series chart sits at the very bottom for breakdown metrics */}
        {hasBreakdown && (
          <div className="ub-detail__bottom">
            <h3 className="ub-bd__title">Clicks over time</h3>
            {timeChart}
          </div>
        )}
      </div>
    </div>
  );
}
