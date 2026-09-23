import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, MousePointerClick, Search } from 'lucide-react';
import {
  Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Card, CardBody, CardHeader, EmptyState, Segmented } from '../../ui';
import { fmtInt, formatBucket } from '../../ui/timeSeries';
import { fmtDuration } from '../../lib/behaviourFormat';
import { screenName } from '../behaviourCopy';
import { fmtRate } from '../behaviourModel';

/* ─────────────────────────────────────────────────────────────────────
 * Every control, and what it costs to reach.
 *
 * A tap count on its own says a button is popular, which is usually just
 * a statement about where it sits. The columns beside it are the ones
 * that change a decision:
 *
 *   Visits       — how many different people used it, not how many taps.
 *   Of visits    — that, as a share of every captured visit on its screen.
 *   Time to tap  — the median wait from the screen appearing to the tap.
 *                  A long median is a discovery problem, not a wording one.
 *   Slowest 10%  — the same at the ninetieth percentile: who struggles.
 *   Opens with   — how often this is the FIRST thing tapped in a visit.
 *   Missed       — rage and dead taps aimed at it.
 *
 * Opening a row charts that one control day by day, taps against the time
 * it took to reach it, which is where a redesign shows up.
 * ───────────────────────────────────────────────────────────────────── */

const SORTS = [
  { id: 'taps', label: 'Most tapped' },
  { id: 'slow', label: 'Slowest to reach' },
  { id: 'first', label: 'Opens the visit' },
  { id: 'missed', label: 'Most missed' },
];

function sortRows(rows, sort) {
  const n = (v) => Number(v) || 0;
  const copy = [...rows];
  if (sort === 'slow') return copy.sort((a, b) => n(b.median_ms) - n(a.median_ms));
  if (sort === 'first') return copy.sort((a, b) => n(b.first_taps) - n(a.first_taps));
  if (sort === 'missed') return copy.sort((a, b) => (n(b.rage) + n(b.dead)) - (n(a.rage) + n(a.dead)));
  return copy.sort((a, b) => n(b.taps) - n(a.taps));
}

function TargetChart({ series }) {
  const rows = (series || []).map(p => ({
    t: Date.parse(p.day),
    taps: Number(p.taps) || 0,
    secs: p.median_ms == null ? null : Math.round(Number(p.median_ms) / 100) / 10,
  }));
  if (rows.length < 2) {
    return <p className="uf-btn__nochart">Not enough days yet to draw a line for this one.</p>;
  }
  return (
    <div className="uf-btn__chart">
      <ResponsiveContainer width="100%" height={150}>
        <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
          <defs>
            <linearGradient id="ufTapFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#5B3FD6" stopOpacity="0.26" />
              <stop offset="100%" stopColor="#5B3FD6" stopOpacity="0" />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--ui-border)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="t" type="number" domain={['dataMin', 'dataMax']} scale="time"
            tickFormatter={t => formatBucket(t, 'day')}
            tick={{ fontSize: 11, fill: 'var(--ui-muted)' }} axisLine={false} tickLine={false}
          />
          <YAxis yAxisId="taps" tick={{ fontSize: 11, fill: 'var(--ui-muted)' }} axisLine={false} tickLine={false} width={34} />
          <YAxis
            yAxisId="secs" orientation="right" tick={{ fontSize: 11, fill: 'var(--ui-muted)' }}
            axisLine={false} tickLine={false} width={40} tickFormatter={v => `${v}s`}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--ui-card)', border: '1px solid var(--ui-border)',
              borderRadius: 10, fontSize: 12, color: 'var(--ui-fg)',
            }}
            labelFormatter={t => formatBucket(t, 'day')}
            formatter={(v, k) => (k === 'secs' ? [`${v}s to reach`, 'Time to tap'] : [fmtInt(v), 'Taps'])}
          />
          <Area yAxisId="taps" dataKey="taps" stroke="#5B3FD6" strokeWidth={2} fill="url(#ufTapFill)" />
          <Line yAxisId="secs" dataKey="secs" stroke="#E8930C" strokeWidth={2} dot={false} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
      <p className="uf-btn__chartkey">
        <span className="uf-key uf-key--violet" /> Taps per day
        <span className="uf-key uf-key--amber" /> Seconds from the screen opening to the tap
      </p>
    </div>
  );
}

export default function ButtonsCard({
  targets = [], screens = [], loading, phrase, onLoadSeries, seriesByTarget = {}, screenFilter, onScreenFilter,
}) {
  const [sort, setSort] = useState('taps');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(null);

  const visitsByScreen = useMemo(
    () => Object.fromEntries(screens.map(s => [s.screen, Number(s.sessions) || 0])),
    [screens],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = targets.filter((t) => {
      if (screenFilter && t.screen !== screenFilter) return false;
      if (!q) return true;
      return `${t.label || ''} ${t.target || ''} ${t.screen || ''}`.toLowerCase().includes(q);
    });
    return sortRows(filtered, sort);
  }, [targets, sort, query, screenFilter]);

  useEffect(() => {
    if (open && onLoadSeries && !seriesByTarget[open]) onLoadSeries(open);
  }, [open, onLoadSeries, seriesByTarget]);

  const screenOptions = useMemo(() => [
    { id: '', label: 'All screens' },
    ...screens.slice(0, 8).map(s => ({ id: s.screen, label: screenName(s.screen) })),
  ], [screens]);

  return (
    <Card className="uf-btns">
      <CardHeader
        title="Every button, and how long it takes to find"
        icon={MousePointerClick}
        subtitle={`Controls customers tapped ${phrase}. Open one for its day-by-day line.`}
        actions={<Segmented options={SORTS} value={sort} onChange={setSort} ariaLabel="Sort controls" />}
      />
      <CardBody flush>
        <div className="uf-btns__tools">
          <label className="uf-search">
            <Search size={14} aria-hidden="true" />
            <input
              type="search"
              value={query}
              placeholder="Find a button"
              onChange={e => setQuery(e.target.value)}
              aria-label="Find a button"
            />
          </label>
          {screens.length > 1 && (
            <select
              className="uf-select"
              value={screenFilter || ''}
              onChange={e => onScreenFilter?.(e.target.value || null)}
              aria-label="Filter by screen"
            >
              {screenOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          )}
          <span className="uf-btns__count">{fmtInt(rows.length)} controls</span>
        </div>

        {loading ? (
          <div className="uf-btns__skeleton" aria-busy="true">
            {[0, 1, 2, 3, 4].map(i => <div key={i} className="uf-btns__skelrow" />)}
          </div>
        ) : !rows.length ? (
          <EmptyState icon={MousePointerClick} title="No control was tapped">
            {query || screenFilter
              ? 'Nothing matches that filter. Clear it to see every control.'
              : `No tap landed on a named control ${phrase}.`}
          </EmptyState>
        ) : (
          <div className="uf-table" role="table">
            <div className="uf-table__head" role="row">
              <span role="columnheader">Control</span>
              <span role="columnheader" className="uf-num">Taps</span>
              <span role="columnheader" className="uf-num">Visits</span>
              <span role="columnheader" className="uf-num">Of visits</span>
              <span role="columnheader" className="uf-num">Time to tap</span>
              <span role="columnheader" className="uf-num">Slowest 10%</span>
              <span role="columnheader" className="uf-num">Opens with</span>
              <span role="columnheader" className="uf-num">Missed</span>
              <span role="columnheader" aria-label="Open" />
            </div>
            {rows.map((t) => {
              const taps = Number(t.taps) || 0;
              const visits = Number(t.sessions) || 0;
              const base = visitsByScreen[t.screen] || 0;
              const share = base > 0 ? (visits / base) * 100 : null;
              const missed = (Number(t.rage) || 0) + (Number(t.dead) || 0);
              const isOpen = open === t.target;
              return (
                <div key={t.target} className={`uf-row${isOpen ? ' uf-row--open' : ''}`} role="row">
                  <button
                    type="button"
                    className="uf-row__main"
                    aria-expanded={isOpen}
                    onClick={() => setOpen(isOpen ? null : t.target)}
                  >
                    <span className="uf-row__name">
                      <strong>{t.label || t.target}</strong>
                      <em>{screenName(t.screen)}</em>
                    </span>
                    <span className="uf-num">{fmtInt(taps)}</span>
                    <span className="uf-num">{fmtInt(visits)}</span>
                    <span className="uf-num">{share == null ? '—' : fmtRate(share)}</span>
                    <span className="uf-num">{t.median_ms == null ? '—' : fmtDuration(Number(t.median_ms))}</span>
                    <span className="uf-num uf-num--quiet">{t.p90_ms == null ? '—' : fmtDuration(Number(t.p90_ms))}</span>
                    <span className="uf-num">{fmtRate(taps > 0 ? ((Number(t.first_taps) || 0) / taps) * 100 : 0)}</span>
                    <span className={`uf-num${missed > 0 ? ' uf-num--bad' : ' uf-num--quiet'}`}>{missed ? fmtInt(missed) : '—'}</span>
                    <span className="uf-row__chev"><ChevronDown size={15} aria-hidden="true" /></span>
                  </button>
                  {isOpen && (
                    <div className="uf-row__detail">
                      <div className="uf-row__facts">
                        <p>
                          <strong>{t.label || t.target}</strong> sits on {screenName(t.screen)}. It was tapped{' '}
                          <strong>{fmtInt(taps)}</strong> times by <strong>{fmtInt(visits)}</strong> visits
                          {share != null && <> — {fmtRate(share)} of every visit to that screen</>}.
                        </p>
                        <p>
                          {t.median_ms == null
                            ? 'There is no timing for it yet.'
                            : <>Half the people who used it did so within <strong>{fmtDuration(Number(t.median_ms))}</strong> of the screen appearing{t.p90_ms != null && <>; the slowest tenth took over {fmtDuration(Number(t.p90_ms))}</>}.</>}
                          {' '}It was the first thing tapped in <strong>{fmtInt(t.first_taps)}</strong> visits.
                          {missed > 0 && <> <strong>{fmtInt(missed)}</strong> taps aimed at it were repeats or misses.</>}
                        </p>
                        <p className="uf-row__key">Tracked as <code>{t.target}</code></p>
                      </div>
                      <TargetChart series={seriesByTarget[t.target]} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
