import { useEffect } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
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
 * ───────────────────────────────────────────────────────────────────── */

const ACCENT = '#1A8737';

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

        {/* Chart */}
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
          <div className="ub-detail__chart-cap">Progress over the selected period (cumulative).</div>
        </div>

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
      </div>
    </div>
  );
}
