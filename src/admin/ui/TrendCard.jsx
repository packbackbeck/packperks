import { useMemo } from 'react';
import {
  Area, Bar, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceDot, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  AreaChart as AreaIcon, BarChart3, CalendarDays, ChartLine, Download, History, MousePointerClick, Table2,
} from 'lucide-react';
import { Card, CardBody, CardHeader, Segmented, ToggleChip } from './primitives';
import { formatBucket, formatBucketFull, formatWindow, isWeekend } from './timeSeries';
import { SERIES_COLORS, usePersistentState } from './chartState';

function SeriesTooltip({ active, label, payload, series, granularity, previousByT, showPrevious }) {
  if (!active || !payload?.length) return null;
  const seen = new Set();
  const rows = payload
    .filter(p => {
      const k = String(p.dataKey || '');
      if (!k || k.endsWith('__prev') || seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map(p => ({ key: String(p.dataKey), value: p.value == null ? null : Number(p.value) }));
  return (
    <div className="ui-series-tip">
      <p className="ui-series-tip__when">{typeof label === 'number' ? formatBucketFull(label, granularity) : label}</p>
      {rows.map(r => {
        const s = series.find(x => x.id === r.key);
        if (!s) return null;
        const prev = showPrevious ? previousByT?.[label]?.[r.key] : undefined;
        const change = r.value != null && prev != null && prev !== 0 ? ((r.value - prev) / Math.abs(prev)) * 100 : null;
        const good = change == null ? null : (change >= 0) !== !!s.invertGood;
        return (
          <div className="ui-series-tip__row" key={r.key}>
            <span className="ui-chart__swatch" style={{ background: s.color }} />
            <span className="ui-series-tip__val">
              {r.value == null ? 'No data' : s.format ? s.format(r.value) : r.value.toLocaleString('en-GB')}
            </span>
            <span className="ui-series-tip__lbl">{s.label}</span>
            {change != null && (
              <span className="ui-series-tip__chg" style={{ color: good ? 'var(--ui-success)' : 'var(--ui-danger)' }} title="Against the same point in the previous period">
                {change >= 0 ? '+' : ''}{change.toFixed(0)}%
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

const VIEW_OPTIONS = [
  { id: 'line', label: 'Line view', icon: ChartLine },
  { id: 'area', label: 'Area view', icon: AreaIcon },
  { id: 'bar', label: 'Bar view', icon: BarChart3 },
  { id: 'table', label: 'Table view', icon: Table2 },
];

function downloadCsv(filename, header, rows) {
  const csv = [header, ...rows]
    .map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ─────────────────────────────────────────────────────────────────────
 * TrendCard — the chart under the tiles.
 * ───────────────────────────────────────────────────────────────────── */
export function TrendCard({
  metrics, selection, pairs = [], range, loading = false, storageKey,
  titleOverride, emptyHint, height = 320, csvName = 'packperks-chart',
}) {
  const [view, setView] = usePersistentState(storageKey ? `${storageKey}:view` : null, 'line');
  const [weekends, setWeekends] = usePersistentState(storageKey ? `${storageKey}:weekends` : null, true);
  const [showPrevious, setShowPrevious] = usePersistentState(storageKey ? `${storageKey}:previous` : null, false);
  const byId = useMemo(() => Object.fromEntries(metrics.map(m => [m.id, m])), [metrics]);
  const plotted = selection.activeIds.map(id => byId[id]).filter(m => m && !m.unavailable && m.series);
  const single = plotted.length === 1 ? plotted[0] : null;
  const granularity = range?.granularity || 'day';
  const hasPrevious = range?.prevFromMs != null && plotted.some(m => m.previousSeries);

  const series = plotted.map((m, i) => ({
    id: m.id,
    label: m.label,
    color: selection.mode === 'single' ? SERIES_COLORS[0] : SERIES_COLORS[i % SERIES_COLORS.length],
    format: m.format,
    unit: m.unit,
    invertGood: m.invertGood,
  }));

  // Small arrays (a bucket per day at most a year back), so these are
  // simply recomputed on each render.
  const previousByT = {};
  const rows = (plotted[0]?.series || []).map((p, i) => {
    const row = { t: p.t };
    const prevRow = {};
    for (const m of plotted) {
      // null is a gap (nothing to measure that day); a missing point is 0.
      const v = m.series[i]?.value;
      row[m.id] = v === undefined ? 0 : v;
      const pv = m.previousSeries?.[i]?.value;
      if (pv !== undefined) {
        prevRow[m.id] = pv;
        if (showPrevious) row[`${m.id}__prev`] = pv;
      }
    }
    previousByT[p.t] = prevRow;
    return row;
  });

  const unit = plotted[0]?.unit;
  const measured = single ? rows.filter(r => r[single.id] != null) : [];
  const avg = measured.length ? measured.reduce((s, r) => s + Number(r[single.id]), 0) / measured.length : null;
  const peakLow = (() => {
    if (!single || measured.length < 3) return null;
    let hi = measured[0]; let lo = measured[0];
    measured.forEach((r) => {
      if (r[single.id] > hi[single.id]) hi = r;
      if (r[single.id] < lo[single.id]) lo = r;
    });
    const top = hi[single.id];
    const bottom = lo[single.id];
    if (!top || (top - bottom) / top < 0.05) return null;
    return { hi, lo };
  })();

  const weekendBands = (() => {
    if (!weekends || (granularity !== 'day' && granularity !== 'hour') || rows.length < 2) return [];
    const step = rows[1].t - rows[0].t;
    const bands = [];
    rows.forEach((r, i) => {
      if (!isWeekend(r.t)) return;
      const x2 = rows[i + 1]?.t ?? r.t + step;
      const last = bands[bands.length - 1];
      if (last && last.x2 === r.t) last.x2 = x2; else bands.push({ x1: r.t, x2 });
    });
    return bands;
  })();

  const title = titleOverride
    || (selection.pair ? selection.pair.label
      : single ? `${single.label} over time`
        : plotted.length > 1 ? 'Comparing metrics' : 'Trend');

  const bits = [range?.noun];
  if (single?.target != null) bits.push('compared to target');
  if (showPrevious && hasPrevious) bits.push(`dashed line is ${formatWindow(range.prevFromMs, range.prevToMs - 1)}`);
  if (weekendBands.length) bits.push('weekends shaded');
  const subtitle = bits.filter(Boolean).join(' · ');

  const pctDomain = unit === 'pct' ? [0, (max) => Math.max(10, Math.min(100, Math.ceil(max / 10) * 10))] : [0, 'auto'];
  const tickFmt = (v) => {
    if (unit === 'pct') return `${v}%`;
    if (single?.axisFormat) return single.axisFormat(v);
    if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`;
    return String(v);
  };

  const modeOptions = [
    { id: 'single', label: 'Single metric', title: 'One metric over time' },
    ...pairs.map(p => ({ id: p.id, label: p.label, title: p.hint })),
    { id: 'compare', label: 'Compare', title: 'Pick metrics by clicking the tiles above' },
  ];

  const exportCsv = () => {
    const header = ['Period', ...series.map(s => s.label)];
    const body = rows.map(r => [formatBucketFull(r.t, granularity), ...series.map(s => r[s.id])]);
    downloadCsv(`${csvName}-${new Date().toISOString().slice(0, 10)}.csv`, header, body);
  };

  const toolbar = (
    <div className="ui-chart__toolbar">
      <Segmented options={modeOptions} value={selection.mode} onChange={selection.setMode} ariaLabel="Chart mode" />
      {(granularity === 'day' || granularity === 'hour') && (
        <ToggleChip pressed={weekends} onClick={() => setWeekends(w => !w)} icon={CalendarDays} title="Shade Saturdays and Sundays behind the series">
          Weekends
        </ToggleChip>
      )}
      <ToggleChip
        pressed={showPrevious && hasPrevious}
        disabled={!hasPrevious}
        onClick={() => setShowPrevious(v => !v)}
        icon={History}
        title={hasPrevious ? 'Overlay the period just before this one as a dashed line' : 'All time has no earlier period to compare against'}
      >
        {hasPrevious ? `vs ${formatWindow(range.prevFromMs, range.prevToMs - 1)}` : 'Previous period'}
      </ToggleChip>
      <Segmented options={VIEW_OPTIONS} value={view} onChange={setView} iconOnly ariaLabel="Chart type" />
      <button type="button" className="ui-btn ui-btn--outline ui-btn--sm ui-btn--icon" onClick={exportCsv} disabled={!rows.length} aria-label="Download CSV" title="Download this chart's data as CSV">
        <Download size={14} aria-hidden="true" />
      </button>
    </div>
  );

  return (
    <Card className="ui-trend">
      <CardHeader title={title} subtitle={subtitle}>
        {series.length > 1 && (
          <div className="ui-chart__legend">
            {series.map(s => (
              <span className="ui-chart__legend-item" key={s.id}>
                <span className="ui-chart__swatch" style={{ background: s.color }} />
                {s.label}
              </span>
            ))}
          </div>
        )}
      </CardHeader>
      <div style={{ padding: '0 20px 4px' }}>{toolbar}</div>
      <CardBody>
        <div className={loading ? 'ui-chart__loading' : undefined}>
          {!plotted.length ? (
            <div className="ui-chart__empty" style={{ height }}>
              <MousePointerClick size={30} aria-hidden="true" />
              <span>{emptyHint || (selection.mode === 'single' ? 'Click a tile above to see its trend.' : 'Click tiles above to compare them.')}</span>
            </div>
          ) : view === 'table' ? (
            <div className="ui-table-wrap" style={{ maxHeight: height }}>
              <table className="ui-table">
                <thead>
                  <tr>
                    <th>Period</th>
                    {series.map(s => <th key={s.id} className="ui-num">{s.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.t}>
                      <td style={{ whiteSpace: 'nowrap', color: 'var(--ui-muted)' }}>{formatBucketFull(r.t, granularity)}</td>
                      {series.map(s => (
                        <td key={s.id} className="ui-num">{r[s.id] == null ? '—' : s.format ? s.format(r[s.id]) : Number(r[s.id]).toLocaleString('en-GB')}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ width: '100%', height }}>
              <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 720, height }}>
                <ComposedChart data={rows} margin={{ top: 14, right: 18, left: 0, bottom: 4 }}>
                  <defs>
                    {series.map(s => (
                      <linearGradient key={s.id} id={`ui-fill-${s.id}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={s.color} stopOpacity={view === 'area' ? 0.28 : 0.14} />
                        <stop offset="100%" stopColor={s.color} stopOpacity={0} />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid stroke="#ECEAF2" vertical={false} />
                  {weekendBands.map(b => (
                    <ReferenceArea key={b.x1} x1={b.x1} x2={b.x2} fill="#676374" fillOpacity={0.07} strokeOpacity={0} ifOverflow="hidden" />
                  ))}
                  <XAxis
                    dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']}
                    tick={{ fontSize: 11.5, fill: '#8F8B9C' }} axisLine={false} tickLine={false}
                    dy={6} minTickGap={24} height={30} tickFormatter={(t) => formatBucket(t, granularity)}
                  />
                  <YAxis
                    tick={{ fontSize: 11.5, fill: '#8F8B9C' }} axisLine={false} tickLine={false}
                    width={56} tickCount={5} domain={pctDomain} allowDecimals={unit !== 'count'}
                    tickFormatter={tickFmt}
                  />
                  <Tooltip
                    cursor={{ stroke: '#8F8B9C', strokeWidth: 1, strokeOpacity: 0.4 }}
                    content={(p) => (
                      <SeriesTooltip {...p} series={series} granularity={granularity} previousByT={previousByT} showPrevious={showPrevious && hasPrevious} />
                    )}
                  />
                  {single?.target != null && (
                    <ReferenceLine
                      y={single.target} stroke="#5B3FD6" strokeDasharray="6 5" strokeOpacity={0.7}
                      label={{ value: single.targetLabel || `Target ${single.format ? single.format(single.target) : single.target}`, position: 'insideTopRight', fontSize: 11, fill: '#5B3FD6', fontWeight: 600 }}
                    />
                  )}
                  {avg != null && view !== 'bar' && (
                    <ReferenceLine
                      y={avg} stroke="#8F8B9C" strokeDasharray="2 4" strokeOpacity={0.6}
                      label={{ value: 'avg', position: 'insideBottomLeft', fontSize: 10, fill: '#8F8B9C' }}
                    />
                  )}
                  {showPrevious && hasPrevious && series.map(s => (
                    <Line
                      key={`${s.id}__prev`} type="monotone" dataKey={`${s.id}__prev`} stroke={s.color}
                      strokeOpacity={0.35} strokeWidth={1.5} strokeDasharray="4 4" dot={false} isAnimationActive={false}
                    />
                  ))}
                  {series.map(s => (view === 'bar' ? (
                    <Bar key={s.id} dataKey={s.id} fill={s.color} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
                  ) : (
                    <Area
                      key={s.id} type="monotone" dataKey={s.id} stroke={s.color} strokeWidth={2.2}
                      fill={series.length === 1 || view === 'area' ? `url(#ui-fill-${s.id})` : 'transparent'}
                      dot={rows.length <= 16 ? { r: 2.5, fill: s.color, strokeWidth: 0 } : false}
                      activeDot={{ r: 4.5, strokeWidth: 2, stroke: '#fff' }}
                      isAnimationActive={false}
                    />
                  )))}
                  {peakLow && view !== 'bar' && (
                    <>
                      <ReferenceDot x={peakLow.hi.t} y={peakLow.hi[single.id]} r={4} fill="#0E9468" stroke="#fff" strokeWidth={2} />
                      <ReferenceDot x={peakLow.lo.t} y={peakLow.lo[single.id]} r={4} fill="#D92D55" stroke="#fff" strokeWidth={2} />
                    </>
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
          {plotted.length > 0 && view !== 'table' && (
            <p className="ui-chart__note">
              {peakLow ? 'Green marks the busiest point, red the quietest. ' : ''}
              The chart shows the whole selected period. Narrow the period at the top to look closer.
            </p>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
