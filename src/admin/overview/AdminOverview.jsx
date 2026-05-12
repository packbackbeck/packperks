import { useState, useEffect, useMemo } from 'react';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { getAdminStats } from '../lib/adminApi';
import './AdminOverview.css';

/* ── Data helpers ── */
function buildDailyTimeSeries(items, days) {
  const now = new Date();
  return Array.from({ length: days }, (_, idx) => {
    const day = new Date(now);
    day.setDate(day.getDate() - (days - 1 - idx));
    day.setHours(0, 0, 0, 0);
    const next = new Date(day);
    next.setDate(next.getDate() + 1);
    return {
      date: day.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
      value: items.filter(item => { const t = new Date(item.created_at); return t >= day && t < next; }).length,
    };
  });
}

function buildDailySumSeries(items, days, field, defaultVal = 0) {
  const now = new Date();
  return Array.from({ length: days }, (_, idx) => {
    const day = new Date(now);
    day.setDate(day.getDate() - (days - 1 - idx));
    day.setHours(0, 0, 0, 0);
    const next = new Date(day);
    next.setDate(next.getDate() + 1);
    const value = items
      .filter(item => { const t = new Date(item.created_at); return t >= day && t < next; })
      .reduce((sum, item) => sum + (Number(item[field]) || defaultVal), 0);
    return {
      date: day.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
      value: Math.round(value * 100) / 100,
    };
  });
}

function buildRewardPopularity(rawClaims, draftRewards) {
  const counts = {};
  rawClaims.filter(c => c.type === 'cashback' && c.reward_id).forEach(c => {
    counts[c.reward_id] = (counts[c.reward_id] || 0) + 1;
  });
  return Object.entries(counts)
    .map(([id, value]) => ({ name: draftRewards?.find(r => r.id === id)?.name || id, value }))
    .sort((a, b) => b.value - a.value).slice(0, 5);
}

function buildCupDistribution(rawClaims, rawBalances) {
  const redeemed = rawClaims.filter(c => c.type === 'cashback').reduce((s, c) => s + (c.cups_redeemed || 0), 0);
  const refunded = rawClaims.filter(c => c.type === 'direct_refund').reduce((s, c) => s + (c.cups_redeemed || 0), 0);
  const active   = (rawBalances || []).reduce((s, b) => s + (b.balance || 0), 0);
  const total    = (rawBalances || []).reduce((s, b) => s + (b.lifetime_cups || 0), 0);
  const donated  = Math.max(0, total - redeemed - refunded - active);
  return [
    { name: 'Active Balances', value: active,   color: '#FFC52F' },
    { name: 'Redeemed',        value: redeemed, color: '#D62300' },
    { name: 'Refunded',        value: refunded, color: '#60A5FA' },
    { name: 'Donated',         value: donated,  color: '#4ADE80' },
  ].filter(d => d.value > 0);
}

/* ── Spotlight config ── */
const SPOTLIGHT = {
  'stat-total-users': {
    title: 'New Users Per Day',
    color: '#60A5FA',
    type: 'area',
    getData: (stats, period) => buildDailyTimeSeries(stats?.rawUsers || [], period),
  },
  'stat-active-users': {
    title: 'User Activity Per Day (last update)',
    color: '#A78BFA',
    type: 'area',
    getData: (stats, period) => buildDailyTimeSeries(
      (stats?.rawUsers || []).map(u => ({ created_at: u.updated_at })), period
    ),
  },
  'stat-cups-collected': {
    title: 'Cups Collected Per Day',
    color: '#FFC52F',
    type: 'area',
    getData: (stats, period) => buildDailyTimeSeries(stats?.rawCupActivity || [], period),
  },
  'stat-cups-redeemed': {
    title: 'Cups Redeemed Per Day',
    color: '#D62300',
    type: 'bar',
    getData: (stats, period) => buildDailyTimeSeries(
      (stats?.rawClaims || []).filter(c => c.type === 'cashback'), period
    ),
  },
  'stat-cashback': {
    title: 'Cashback Paid Per Day (€)',
    color: '#4ADE80',
    type: 'area',
    getData: (stats, period) => buildDailySumSeries(
      (stats?.rawClaims || []).filter(c => c.status === 'completed'), period, 'payout_amount'
    ),
  },
};

/* ── Custom tooltip ── */
function ChartTooltip({ active, payload, label, prefix = '' }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="ov-tooltip">
      <div className="ov-tooltip__label">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="ov-tooltip__row">
          <span className="ov-tooltip__dot" style={{ background: p.color }} />
          {prefix}{p.value}
        </div>
      ))}
    </div>
  );
}

/* ── Edit toggle eye button ── */
function EyeToggle({ id, visible, onToggle }) {
  return (
    <button className="ov-edit-toggle" onClick={() => onToggle(id)} title={visible ? 'Hide block' : 'Show block'}>
      {visible ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
        </svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </svg>
      )}
    </button>
  );
}

/* ── Stat card ── */
function StatCard({ id, label, value, sub, color, icon, editMode, visible, onToggle, focused, onFocus }) {
  return (
    <div
      className={[
        'ov-stat',
        !visible && editMode ? 'ov-stat--hidden' : '',
        !visible && !editMode ? 'ov-hidden' : '',
        focused ? 'ov-stat--focused' : '',
        !editMode && SPOTLIGHT[id] ? 'ov-stat--clickable' : '',
      ].filter(Boolean).join(' ')}
      onClick={() => !editMode && SPOTLIGHT[id] && onFocus(id)}
    >
      {editMode && <EyeToggle id={id} visible={visible} onToggle={onToggle} />}
      {focused && !editMode && (
        <div className="ov-stat__focus-ring" style={{ borderColor: color }} />
      )}
      <div className="ov-stat__icon" style={{ background: `${color}18`, color }}>
        {icon}
      </div>
      <div className="ov-stat__body">
        <div className="ov-stat__label">{label}</div>
        <div className="ov-stat__value">{value}</div>
        {sub && <div className="ov-stat__sub">{sub}</div>}
      </div>
      {!editMode && SPOTLIGHT[id] && (
        <svg className="ov-stat__arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      )}
    </div>
  );
}

/* ── Chart block ── */
function ChartBlock({ id, label, children, editMode, visible, onToggle, fullWidth }) {
  return (
    <div className={[
      'ov-card',
      fullWidth ? 'ov-card--span2' : '',
      !visible && editMode ? 'ov-card--hidden' : '',
      !visible && !editMode ? 'ov-hidden' : '',
    ].filter(Boolean).join(' ')}>
      {editMode && <EyeToggle id={id} visible={visible} onToggle={onToggle} />}
      <div className="ov-card__title">{label}</div>
      <div className="ov-card__body">{children}</div>
    </div>
  );
}

/* ── Activity helpers ── */
const ACT_META = {
  cup_added:      { label: 'Cup returned',   color: '#4ADE80', symbol: '+' },
  reward_claimed: { label: 'Reward claimed',  color: '#FFC52F', symbol: '✓' },
  cups_withdrawn: { label: 'Refund issued',   color: '#60A5FA', symbol: '−' },
  cups_shared:    { label: 'Cups shared',     color: '#A78BFA', symbol: '→' },
  cups_donated:   { label: 'Cups donated',    color: '#4ADE80', symbol: '♥' },
};

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const PERIOD_OPTIONS = [{ label: '7d', days: 7 }, { label: '14d', days: 14 }, { label: '30d', days: 30 }];

const AXIS_TICK = { fill: '#9E9A93', fontSize: 10 };

export default function AdminOverview({ draftState, onNavigate }) {
  const { draft, updateDraft } = draftState;
  const blocks = draft.dashboardBlocks;

  const [stats, setStats]       = useState(null);
  const [loading, setLoading]   = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [period, setPeriod]     = useState(30);
  const [focusedStat, setFocusedStat] = useState(null);

  function loadStats() {
    setLoading(true);
    getAdminStats().then(setStats).catch(() => setStats(null)).finally(() => setLoading(false));
  }

  useEffect(() => { loadStats(); }, []);

  function toggleBlock(id) {
    updateDraft(prev => ({
      ...prev,
      dashboardBlocks: prev.dashboardBlocks.map(b => b.id === id ? { ...b, visible: !b.visible } : b),
    }));
  }

  function isVisible(id) {
    return blocks.find(b => b.id === id)?.visible ?? true;
  }

  function handleStatFocus(id) {
    if (id === 'stat-pending') { onNavigate('claims'); return; }
    setFocusedStat(prev => prev === id ? null : id);
  }

  /* ── Chart data ── */
  const cupsData = useMemo(
    () => buildDailyTimeSeries(stats?.rawCupActivity || [], period),
    [stats, period]
  );
  const claimsData = useMemo(
    () => buildDailyTimeSeries(stats?.rawClaims || [], period),
    [stats, period]
  );
  const rewardPop = useMemo(
    () => buildRewardPopularity(stats?.rawClaims || [], draft.rewards),
    [stats, draft.rewards]
  );
  const cupDist = useMemo(
    () => buildCupDistribution(stats?.rawClaims || [], stats?.rawBalances || []),
    [stats]
  );
  const spotlightData = useMemo(() => {
    if (!focusedStat || !SPOTLIGHT[focusedStat]) return [];
    return SPOTLIGHT[focusedStat].getData(stats, period);
  }, [focusedStat, stats, period]);

  const s = stats || {};
  const pendingTotal = (s.pendingClaims || 0) + (s.pendingScans || 0);
  const settings = draft.settings;

  const STAT_CARDS = [
    {
      id: 'stat-total-users',
      label: 'Total Users',
      value: loading ? '—' : (s.totalUsers || 0).toLocaleString(),
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>,
      color: '#60A5FA',
      sub: `${s.activeUsers || 0} active last 30d`,
    },
    {
      id: 'stat-active-users',
      label: 'Active (30d)',
      value: loading ? '—' : (s.activeUsers || 0).toLocaleString(),
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>,
      color: '#A78BFA',
      sub: s.totalUsers ? `${Math.round((s.activeUsers / s.totalUsers) * 100)}% of users` : '—',
    },
    {
      id: 'stat-cups-collected',
      label: 'Cups Collected',
      value: loading ? '—' : (s.totalCupsCollected || 0).toLocaleString(),
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8h1a4 4 0 010 8h-1"/><path d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>,
      color: '#FFC52F',
      sub: 'Lifetime total',
    },
    {
      id: 'stat-cups-redeemed',
      label: 'Cups Redeemed',
      value: loading ? '—' : (s.totalCupsRedeemed || 0).toLocaleString(),
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z"/></svg>,
      color: '#D62300',
      sub: s.totalCupsCollected ? `${Math.round((s.totalCupsRedeemed / s.totalCupsCollected) * 100)}% redemption` : '—',
    },
    {
      id: 'stat-cashback',
      label: 'Total Cashback',
      value: loading ? '—' : `€${(s.totalCashback || 0).toFixed(2)}`,
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>,
      color: '#4ADE80',
      sub: `@ €${settings.cashbackRatePerCup}/cup`,
    },
    {
      id: 'stat-pending',
      label: 'Pending Actions',
      value: loading ? '—' : pendingTotal.toLocaleString(),
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>,
      color: pendingTotal > 0 ? '#F97316' : '#6B6860',
      sub: `${s.pendingClaims || 0} claims · ${s.pendingScans || 0} scans`,
    },
  ];

  const spotlightDef = focusedStat ? SPOTLIGHT[focusedStat] : null;
  const xInterval = Math.max(0, Math.floor(period / 7) - 1);

  return (
    <div className="admin-overview">
      {/* Header */}
      <div className="ov-header">
        <div>
          <h1 className="ov-header__title">Overview</h1>
          <p className="ov-header__sub">Platform health at a glance</p>
        </div>
        <div className="ov-header__actions">
          <div className="ov-period-toggle">
            {PERIOD_OPTIONS.map(opt => (
              <button
                key={opt.days}
                className={`ov-period-btn${period === opt.days ? ' ov-period-btn--active' : ''}`}
                onClick={() => setPeriod(opt.days)}
              >{opt.label}</button>
            ))}
          </div>
          <button className="ov-header__refresh" onClick={loadStats} disabled={loading} title="Refresh stats">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
              style={{ animation: loading ? 'ov-spin 1s linear infinite' : 'none' }}>
              <polyline points="23 4 23 10 17 10"/>
              <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
            </svg>
          </button>

          {pendingTotal > 0 && (
            <button className="ov-header__alert" onClick={() => onNavigate('claims')}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              {pendingTotal} pending
            </button>
          )}
          <button
            className={`ov-header__edit-btn${editMode ? ' ov-header__edit-btn--active' : ''}`}
            onClick={() => setEditMode(v => !v)}
          >
            {editMode ? (
              <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>Done</>
            ) : (
              <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Customize</>
            )}
          </button>
        </div>
      </div>

      {editMode && (
        <div className="ov-edit-banner">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          Edit mode — click the eye icon on any block to show or hide it.
        </div>
      )}

      {/* Stat cards */}
      <div className="ov-stats-grid">
        {STAT_CARDS.map(card => (
          <StatCard
            key={card.id}
            {...card}
            editMode={editMode}
            visible={isVisible(card.id)}
            onToggle={toggleBlock}
            focused={focusedStat === card.id}
            onFocus={handleStatFocus}
          />
        ))}
      </div>

      {/* Charts grid — 2-column layout */}
      <div className="ov-charts-grid">

        {/* Primary chart — shows cups by default, replaced by stat spotlight on click */}
        {(() => {
          const def = focusedStat ? SPOTLIGHT[focusedStat] : null;
          const primData  = def ? spotlightData : cupsData;
          const primTitle = def ? `${def.title} — Last ${period} Days` : `Cups Collected — Last ${period} Days`;
          const primColor = def?.color || '#FFC52F';
          const primType  = def?.type || 'area';
          return (
            <ChartBlock id="chart-cups-per-day" label={primTitle}
              fullWidth editMode={editMode} visible={isVisible('chart-cups-per-day')} onToggle={toggleBlock}>
              {focusedStat && !editMode && (
                <button className="ov-primary-back" onClick={() => setFocusedStat(null)}>
                  ← Back to Cups Collected
                </button>
              )}
              <ResponsiveContainer width="100%" height={200}>
                {primType === 'area' ? (
                  <AreaChart data={primData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="primGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor={primColor} stopOpacity={0.25} />
                        <stop offset="95%" stopColor={primColor} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#F0EDE8" />
                    <XAxis dataKey="date" tick={AXIS_TICK} tickLine={false} axisLine={false} interval={xInterval} />
                    <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <Area type="monotone" dataKey="value" stroke={primColor} strokeWidth={2}
                      fill="url(#primGrad)" dot={false} activeDot={{ r: 4, fill: primColor }} />
                  </AreaChart>
                ) : (
                  <BarChart data={primData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }} barSize={period <= 7 ? 28 : 14}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#F0EDE8" vertical={false} />
                    <XAxis dataKey="date" tick={AXIS_TICK} tickLine={false} axisLine={false} interval={xInterval} />
                    <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="value" fill={primColor} radius={[4, 4, 0, 0]} />
                  </BarChart>
                )}
              </ResponsiveContainer>
            </ChartBlock>
          );
        })()}

        {/* Claims per day (2fr) + Cup Distribution (1fr) — SAME ROW */}
        <ChartBlock id="chart-claims-per-day" label={`Claims — Last ${period} Days`}
          editMode={editMode} visible={isVisible('chart-claims-per-day')} onToggle={toggleBlock}>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={claimsData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }} barSize={period <= 7 ? 28 : period <= 14 ? 18 : 12}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F0EDE8" vertical={false} />
              <XAxis dataKey="date" tick={AXIS_TICK} tickLine={false} axisLine={false} interval={xInterval} />
              <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="value" fill="#D62300" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartBlock>

        <ChartBlock id="chart-cup-dist" label="Cup Status Distribution"
          editMode={editMode} visible={isVisible('chart-cup-dist')} onToggle={toggleBlock}>
          {cupDist.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={150}>
                <PieChart>
                  <Pie data={cupDist} cx="50%" cy="50%" innerRadius={40} outerRadius={65}
                    paddingAngle={3} dataKey="value">
                    {cupDist.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Pie>
                  <Tooltip formatter={v => v} contentStyle={{ background: '#1E1E1E', border: '1px solid #333', borderRadius: 8, color: '#E8E6E1', fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="ov-pie-legend">
                {cupDist.map(d => (
                  <div key={d.name} className="ov-pie-legend__item">
                    <span className="ov-pie-legend__dot" style={{ background: d.color }} />
                    <span className="ov-pie-legend__label">{d.name}</span>
                    <span className="ov-pie-legend__val">{d.value}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="ov-empty-state">No cup data yet</div>
          )}
        </ChartBlock>

        {/* Reward popularity (2fr) + Activity feed (1fr) */}
        <ChartBlock id="chart-reward-pop" label="Reward Popularity (Claims)"
          editMode={editMode} visible={isVisible('chart-reward-pop')} onToggle={toggleBlock}>
          {rewardPop.length > 0 ? (
            <div className="ov-pop-list">
              {rewardPop.map((r, i) => {
                const pct = Math.round((r.value / rewardPop[0].value) * 100);
                return (
                  <div key={r.name} className="ov-pop-item">
                    <div className="ov-pop-item__header">
                      <span className="ov-pop-item__rank">#{i + 1}</span>
                      <span className="ov-pop-item__name">{r.name}</span>
                      <span className="ov-pop-item__val">{r.value}</span>
                    </div>
                    <div className="ov-pop-item__bar">
                      <div className="ov-pop-item__fill"
                        style={{ width: `${pct}%`, background: i === 0 ? '#D62300' : i === 1 ? '#FFC52F' : '#E8E6E1' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="ov-empty-state">No claims yet</div>
          )}
        </ChartBlock>

        <ChartBlock id="feed-activity" label="Recent Activity"
          editMode={editMode} visible={isVisible('feed-activity')} onToggle={toggleBlock}>
          <div className="ov-feed">
            {(s.recentActivity?.length > 0) ? s.recentActivity.slice(0, 8).map((item, i) => {
              const meta = ACT_META[item.type] || { label: item.type, color: '#6B6860', symbol: '·' };
              return (
                <div key={i} className="ov-feed__item">
                  <span className="ov-feed__dot" style={{ background: `${meta.color}22`, color: meta.color }}>{meta.symbol}</span>
                  <div className="ov-feed__text">
                    <span className="ov-feed__label">{meta.label}</span>
                    <span className="ov-feed__time">{timeAgo(item.created_at)}</span>
                  </div>
                </div>
              );
            }) : <div className="ov-feed__empty">No recent activity yet</div>}
          </div>
        </ChartBlock>

      </div>
    </div>
  );
}
