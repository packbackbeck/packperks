import { useState, useEffect, useMemo } from 'react';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { getAdminStats, getRewardBudget, getScansByLocation } from '../lib/adminApi';
import RewardBudgetMonitor from '../shared/RewardBudgetMonitor';
import { useOrg } from '../context/OrgContext';
import ScopeToggle from '../shared/ScopeToggle';
import PiiMask from '../shared/PiiMask';
import QuickLinks from '../shared/QuickLinks';
import { useReorder } from './useReorder';
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

/* For each day in the window, compute the % of users who, as of that
 * day, had returned cups on ≥2 distinct calendar days. The denominator
 * is "users who have returned at least one cup by this day", the
 * numerator is "users who have returned on at least two distinct days
 * by this day" — i.e. genuine come-backs. The series shows the
 * retention rate trending over time. */
function buildRetentionTimeSeries(cupEvents, days) {
  const series = [];
  const today = new Date();
  // First pass: bucket each event by user_id → sorted unique days.
  const byUser = new Map();
  for (const ev of cupEvents) {
    if (ev.type !== 'cup_added' || !ev.user_id) continue;
    const day = ev.created_at.slice(0, 10);
    let set = byUser.get(ev.user_id);
    if (!set) { set = new Set(); byUser.set(ev.user_id, set); }
    set.add(day);
  }
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const cutoff = d.toISOString().slice(0, 10);
    let withAny = 0;
    let withReturn = 0;
    for (const set of byUser.values()) {
      const onOrBefore = Array.from(set).filter(day => day <= cutoff);
      if (onOrBefore.length === 0) continue;
      withAny++;
      if (onOrBefore.length >= 2) withReturn++;
    }
    const rate = withAny > 0 ? Math.round((withReturn / withAny) * 100) : 0;
    series.push({ date: d.toLocaleDateString('en', { month: 'short', day: 'numeric' }), value: rate });
  }
  return series;
}

/* ── Customer insights helpers ────────────────────────────────────
 * These power the "User Insights" panel at the bottom of Overview. */

/* Group customers by device type from users.device, returning a pie-
 * chart-ready array with counts + brand colours. We bucket the raw
 * UA-derived label into rough families so the chart stays readable. */
function buildDeviceBreakdown(rawUsers) {
  if (!rawUsers?.length) return [];
  const buckets = { iPhone: 0, Android: 0, iPad: 0, Mac: 0, Windows: 0, Other: 0, Unknown: 0 };
  for (const u of rawUsers) {
    const d = (u.device || '').toLowerCase();
    if (!d)                       buckets.Unknown += 1;
    else if (d.includes('ipad'))  buckets.iPad    += 1;
    else if (d.includes('iphone'))buckets.iPhone  += 1;
    else if (d.includes('android'))buckets.Android += 1;
    else if (d.includes('mac'))   buckets.Mac     += 1;
    else if (d.includes('windows'))buckets.Windows += 1;
    else                          buckets.Other   += 1;
  }
  const palette = {
    iPhone: '#60A5FA', Android: '#4ADE80', iPad: '#A78BFA',
    Mac: '#FFC52F', Windows: '#FF7A2E', Other: '#9E9A93', Unknown: '#D1CDC4',
  };
  return Object.entries(buckets)
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({ name, value, color: palette[name] }));
}

/* Histogram of cup_added events by local hour-of-day, so an admin can
 * spot the lunch/dinner peaks. */
function buildHourlyActivity(cupEvents) {
  const buckets = Array.from({ length: 24 }, (_, h) => ({ hour: h, label: `${h}:00`, value: 0 }));
  for (const ev of cupEvents || []) {
    if (ev.type !== 'cup_added') continue;
    const h = new Date(ev.created_at).getHours();
    if (h >= 0 && h < 24) buckets[h].value += 1;
  }
  return buckets;
}

/* Top N customers by cups returned ever, with display name (resolved
 * from rawUsers). Used as a small leaderboard panel — useful to spot
 * power users or sharers worth thanking. */
function buildTopReturners(cupEvents, rawUsers, n = 6) {
  const counts = {};
  for (const ev of cupEvents || []) {
    if (ev.type !== 'cup_added' || !ev.user_id) continue;
    counts[ev.user_id] = (counts[ev.user_id] || 0) + 1;
  }
  const byId = Object.fromEntries((rawUsers || []).map(u => [u.id, u]));
  return Object.entries(counts)
    .map(([id, value]) => ({
      id,
      value,
      name: byId[id]?.display_name || 'Anonymous',
      email: byId[id]?.email || '',
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, n);
}

/* Reward Popularity chart helper.
 *
 * Counts every non-rejected claim that has a reward_id attached, then
 * resolves the id to the published reward name (falling back to the
 * short id if the reward has since been archived). The chart shows
 * the top 5.
 *
 * Previous version filtered to `type === 'cashback'` only, which is
 * correct in theory but meant the chart looked broken whenever the
 * only completed claims were direct refunds on a specific reward
 * (the user picks a reward, then bails to cash-out — that still
 * counts as "this reward was popular enough to be chosen"). */
function buildRewardPopularity(rawClaims, draftRewards) {
  const counts = {};
  (rawClaims || []).forEach(c => {
    if (!c.reward_id) return;
    if (c.status === 'failed') return; // rejected claims don't count
    counts[c.reward_id] = (counts[c.reward_id] || 0) + 1;
  });
  return Object.entries(counts)
    .map(([id, value]) => ({
      // Try the live draft first (so an admin editing a name sees the
      // new name in the chart immediately); fall back to a short id
      // for archived rewards that no longer appear in the catalogue.
      name: draftRewards?.find(r => r.id === id)?.name || `Archived (${String(id).slice(0, 6)}…)`,
      value,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);
}

function buildCupDistribution(rawClaims, rawBalances) {
  const redeemed = rawClaims.filter(c => c.type === 'cashback').reduce((s, c) => s + (c.cups_redeemed || 0), 0);
  const refunded = rawClaims.filter(c => c.type === 'direct_refund').reduce((s, c) => s + (c.cups_redeemed || 0), 0);
  const active   = (rawBalances || []).reduce((s, b) => s + (b.balance || 0), 0);
  const total    = (rawBalances || []).reduce((s, b) => s + (b.lifetime_cups || 0), 0);
  const donated  = Math.max(0, total - redeemed - refunded - active);
  return [
    { name: 'Active Balances', value: active,   color: '#FFC52F' },
    { name: 'Redeemed',        value: redeemed, color: '#FD6F46' },
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
    title: 'Cups Added Per Day',
    color: '#FFC52F',
    type: 'area',
    getData: (stats, period) => buildDailyTimeSeries(stats?.rawCupActivity || [], period),
  },
  'stat-cups-redeemed': {
    title: 'Cups Spent Per Day',
    color: '#FD6F46',
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
  'stat-retention': {
    // Retention rate computed daily: for each day, the % of users active
    // on or before that day who have already returned a cup on a later
    // day. Captures the cumulative "fraction of one-time users who came
    // back" trend over the selected period.
    title: 'Retention Rate Per Day (%)',
    color: '#A78BFA',
    type: 'area',
    getData: (stats, period) => buildRetentionTimeSeries(stats?.rawCupActivity || [], period),
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

/* ── Stat card ──
 * A card is clickable when either:
 *   • SPOTLIGHT[id] is set — clicking spotlights its time series in
 *     the main chart, or
 *   • the id is an explicit page-navigator like `stat-pending` —
 *     handleStatFocus jumps straight to the Claims page.
 *
 * The visual affordance (cursor, arrow chevron) follows the same rule. */
function StatCard({ id, label, value, sub, color, icon, tooltip, editMode, visible, onToggle, focused, onFocus, reorder }) {
  const isClickable = !editMode && (SPOTLIGHT[id] || id === 'stat-pending');
  const isDragging  = editMode && reorder?.dragId === id;
  const isDropOver  = editMode && reorder?.overId === id && reorder?.dragId !== id;
  return (
    <div
      className={[
        'ov-stat',
        !visible && editMode ? 'ov-stat--hidden' : '',
        !visible && !editMode ? 'ov-hidden' : '',
        focused ? 'ov-stat--focused' : '',
        isClickable ? 'ov-stat--clickable' : '',
        editMode ? 'ov-stat--editing' : '',
        isDragging ? 'ov-stat--dragging' : '',
        isDropOver ? 'ov-stat--drop-target' : '',
      ].filter(Boolean).join(' ')}
      onClick={() => isClickable && onFocus(id)}
      /* Drag-and-drop wiring — only takes effect when editMode is on.
         draggable={false} otherwise so normal clicks aren't suppressed
         on iPad/touch devices. */
      draggable={editMode}
      onDragStart={editMode ? () => reorder?.onCardDragStart(id) : undefined}
      onDragOver={editMode ? (e) => reorder?.onCardDragOver(e, id) : undefined}
      onDrop={editMode ? () => reorder?.onCardDrop(id) : undefined}
      onDragEnd={editMode ? () => reorder?.onCardDragEnd() : undefined}
    >
      {editMode && <DragHandle />}
      {editMode && <EyeToggle id={id} visible={visible} onToggle={onToggle} />}
      {focused && !editMode && (
        <div className="ov-stat__focus-ring" style={{ borderColor: color }} />
      )}
      <div className="ov-stat__icon" style={{ background: `${color}18`, color }}>
        {icon}
      </div>
      <div className="ov-stat__body">
        <div className="ov-stat__label">
          {label}
          {tooltip && (
            <span className="ov-stat__info" title={tooltip}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
            </span>
          )}
        </div>
        <div className="ov-stat__value">{value}</div>
        {sub && <div className="ov-stat__sub">{sub}</div>}
      </div>
      {isClickable && (
        <svg className="ov-stat__arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          {/* stat-pending jumps to a different page → show a right
           *  arrow; SPOTLIGHT cards expand a chart below → down. */}
          {id === 'stat-pending'
            ? <polyline points="9 6 15 12 9 18" />
            : <polyline points="6 9 12 15 18 9" />}
        </svg>
      )}
    </div>
  );
}

/* ── Chart block ── */
function ChartBlock({ id, label, children, editMode, visible, onToggle, fullWidth, reorder }) {
  const isDragging = editMode && reorder?.dragId === id;
  const isDropOver = editMode && reorder?.overId === id && reorder?.dragId !== id;
  return (
    <div
      className={[
        'ov-card',
        fullWidth ? 'ov-card--span2' : '',
        !visible && editMode ? 'ov-card--hidden' : '',
        !visible && !editMode ? 'ov-hidden' : '',
        editMode ? 'ov-card--editing' : '',
        isDragging ? 'ov-card--dragging' : '',
        isDropOver ? 'ov-card--drop-target' : '',
      ].filter(Boolean).join(' ')}
      draggable={editMode}
      onDragStart={editMode ? () => reorder?.onCardDragStart(id) : undefined}
      onDragOver={editMode ? (e) => reorder?.onCardDragOver(e, id) : undefined}
      onDrop={editMode ? () => reorder?.onCardDrop(id) : undefined}
      onDragEnd={editMode ? () => reorder?.onCardDragEnd() : undefined}
    >
      {editMode && <DragHandle />}
      {editMode && <EyeToggle id={id} visible={visible} onToggle={onToggle} />}
      <div className="ov-card__title">{label}</div>
      <div className="ov-card__body">{children}</div>
    </div>
  );
}

/* ── Drag handle ── shown in the top-left of cards while editing.
 *  A 6-dot grip glyph is the universal "drag me" affordance — Notion,
 *  Linear, Trello all use it. */
function DragHandle() {
  return (
    <span className="ov-drag-handle" aria-hidden="true" title="Drag to reorder">
      <svg width="11" height="14" viewBox="0 0 11 14" fill="currentColor">
        <circle cx="2" cy="2"  r="1.3" />
        <circle cx="2" cy="7"  r="1.3" />
        <circle cx="2" cy="12" r="1.3" />
        <circle cx="9" cy="2"  r="1.3" />
        <circle cx="9" cy="7"  r="1.3" />
        <circle cx="9" cy="12" r="1.3" />
      </svg>
    </span>
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

const PERIOD_OPTIONS = [
  { label: '7d',  days: 7 },
  { label: '14d', days: 14 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
];

const AXIS_TICK = { fill: '#9E9A93', fontSize: 10 };

/* Date-only "today" helper for the custom range picker — gives the
 * date input a sensible max so admins can't pick a future end date. */
function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function AdminOverview({ draftState, onNavigate }) {
  const { draft, updateDraft } = draftState;
  const blocks = draft.dashboardBlocks;

  const { activeOrg, scopeOrgIds, statsScope } = useOrg();
  const [stats, setStats]       = useState(null);
  const [loading, setLoading]   = useState(true);
  const [budget, setBudget]     = useState(null);
  const [budgetLoading, setBudgetLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [period, setPeriod]     = useState(30);
  const [focusedStat, setFocusedStat] = useState(null);

  /* Custom date-range support.
   *
   * When the admin picks "Custom" we open a small popover with two
   * <input type="date"> fields. We translate the chosen range into
   * `period` = number of days for the chart helpers, because all of
   * those expect a day count rooted at "today". The "endIso" knob is
   * preserved for a future enhancement where charts can be anchored
   * to a non-today endpoint; for now the range simply controls the
   * window length. */
  const [showCustomRange, setShowCustomRange] = useState(false);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState(todayIso());
  const customRangeDays = (() => {
    if (!customStart || !customEnd) return null;
    const ms = new Date(customEnd).getTime() - new Date(customStart).getTime();
    if (!Number.isFinite(ms) || ms <= 0) return null;
    return Math.min(365, Math.ceil(ms / 86_400_000) + 1);
  })();
  const isCustomActive = customRangeDays != null && period === customRangeDays;

  function applyCustomRange() {
    if (customRangeDays) {
      setPeriod(customRangeDays);
      setShowCustomRange(false);
    }
  }

  function loadStats() {
    setLoading(true);
    getAdminStats(scopeOrgIds).then(setStats).catch(() => setStats(null)).finally(() => setLoading(false));
  }

  // Re-run on scope toggle (this store ↔ whole group) and org change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadStats(); }, [statsScope, activeOrg?.id]);

  // Reward-budget monitor — refetched when the active org changes.
  useEffect(() => {
    let alive = true;
    setBudgetLoading(true);
    getRewardBudget()
      .then(b => { if (alive) { setBudget(b); setBudgetLoading(false); } })
      .catch(() => { if (alive) setBudgetLoading(false); });
    return () => { alive = false; };
  }, [activeOrg?.id]);

  function toggleBlock(id) {
    updateDraft(prev => ({
      ...prev,
      dashboardBlocks: prev.dashboardBlocks.map(b => b.id === id ? { ...b, visible: !b.visible } : b),
    }));
  }

  function isVisible(id) {
    return blocks.find(b => b.id === id)?.visible ?? true;
  }

  /* Reorder helper — used by the customize-mode drag hooks below.
   * Takes a SUBSET of block ids in a new order (e.g. just the stat
   * cards) and merges that order back into the global dashboardBlocks
   * array. Blocks not in the subset keep their relative position
   * — we only touch the indices that belong to the reordered group. */
  function reorderSubset(scopedIdsInNewOrder) {
    updateDraft(prev => {
      const idSet = new Set(scopedIdsInNewOrder);
      const queue = [...scopedIdsInNewOrder];
      const next = prev.dashboardBlocks.map(b => {
        if (!idSet.has(b.id)) return b; // leave non-scoped blocks alone
        const nextId = queue.shift();
        // Find the full block object for nextId to preserve its other
        // fields (visible, type, span, label).
        return prev.dashboardBlocks.find(x => x.id === nextId) || b;
      });
      return { ...prev, dashboardBlocks: next };
    });
  }

  /* Stat cards in the order the admin has chosen. Built each render
   * by walking dashboardBlocks (which carries the persisted order)
   * and picking out the stat-prefixed ids, then mapping them onto the
   * static STAT_CARDS lookup below. Cards present in STAT_CARDS but
   * NOT in dashboardBlocks (shouldn't happen post-migration) get
   * appended at the end so we never silently drop a card. */
  const STAT_IDS_IN_BLOCKS = blocks.filter(b => b.type === 'stat').map(b => b.id);

  // Stat reorder wiring — only active when editMode is on; cards
  // become draggable then.
  const statReorder = useReorder(STAT_IDS_IN_BLOCKS, reorderSubset);

  // Chart blocks reorder — same hook, different scope. Used by the
  // 2-col charts grid below.
  const CHART_IDS_IN_BLOCKS = blocks
    .filter(b => b.type === 'chart')
    .map(b => b.id);
  const chartReorder = useReorder(CHART_IDS_IN_BLOCKS, reorderSubset);

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

  /* Triage memo removed — the previous "Needs your attention" panel
   *  was double-counting cup-scan transient states alongside real
   *  claim work. Pending Claims is now a single dedicated stat card
   *  below. */
  const spotlightData = useMemo(() => {
    if (!focusedStat || !SPOTLIGHT[focusedStat]) return [];
    return SPOTLIGHT[focusedStat].getData(stats, period);
  }, [focusedStat, stats, period]);

  const s = stats || {};
  const pendingTotal = (s.pendingClaims || 0) + (s.pendingScans || 0);
  const settings = draft.settings;

  /* Each card carries a `tooltip` string explaining what's counted +
   * the denominator, so admins know whether two numbers should be
   * reconcilable. The cup lifecycle:
   *
   *   scanned at bin → validated (server) → balance → spent on reward
   *     → claim created → AI verified → admin approved → cashback paid
   *
   * "Cups Added" counts everything that ever entered a balance.
   * "Cups Spent" counts everything spent on a cashback claim.
   * "Total Cashback" sums payout_amount on completed cashback claims —
   * it does not equal collected×rate because each reward has its own
   * price and the cup→cash mapping isn't a flat per-cup rate. */
  const STAT_CARDS = [
    {
      id: 'stat-total-users',
      label: 'Total Users',
      value: loading ? '—' : (s.totalUsers || 0).toLocaleString(),
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>,
      color: '#60A5FA',
      sub: s.totalUsers ? `${s.activeUsers || 0} active last 30d` : '—',
      tooltip: 'Every users row, including anonymous device-only signups. "Active" = updated_at within last 30 days.',
    },
    {
      id: 'stat-retention',
      label: 'Retention',
      // % of users who came back to return a cup on another day — i.e.
      // not just a one-time tryer. (Counted in adminApi.getAdminStats.)
      value: loading ? '—' : `${s.retentionRate || 0}%`,
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 12a9 9 0 1 0 3-6.7"/>
        <polyline points="3 4 3 10 9 10"/>
      </svg>,
      color: '#A78BFA',
      sub: s.usersWithAnyCup
        ? `${s.returningUsers}/${s.usersWithAnyCup} returners`
        : 'No returns yet',
      tooltip: 'Of users who have ever returned a cup, the percentage that did so on at least two different calendar days. Denominator is "users with ≥1 cup return", not total signups, so it isn\'t diluted by accounts that browsed but never participated.',
    },
    {
      id: 'stat-cups-collected',
      label: 'Cups Added',
      value: loading ? '—' : (s.totalCupsCollected || 0).toLocaleString(),
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8h1a4 4 0 010 8h-1"/><path d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>,
      color: '#FFC52F',
      sub: 'Lifetime total',
      tooltip: 'Every cup that ever made it into a customer balance, ever. Computed as (current balances across all users) + (cups already redeemed via claims). Cups stuck in pending or failed scans are NOT counted.',
    },
    {
      id: 'stat-cups-redeemed',
      label: 'Cups Spent',
      value: loading ? '—' : (s.totalCupsRedeemed || 0).toLocaleString(),
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z"/></svg>,
      color: '#FD6F46',
      sub: s.totalCupsCollected ? `${Math.round((s.totalCupsRedeemed / s.totalCupsCollected) * 100)}% redemption` : '—',
      tooltip: 'Sum of cups_redeemed on claims of type=cashback. Includes pending + approved + rejected. Direct refunds and donations are tracked separately and not included here.',
    },
    {
      id: 'stat-cashback',
      label: 'Total Cashback',
      value: loading ? '—' : `€${(s.totalCashback || 0).toFixed(2)}`,
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>,
      color: '#4ADE80',
      // Previously this card read "@ €1.25/cup" which implied a flat
      // per-cup rate. In reality each reward has its own price and the
      // cashback amount comes from the reward, not from cups×rate.
      // Honest copy: payouts approved so far.
      sub: 'Approved & paid out',
      tooltip: 'Sum of payout_amount on completed claims (cashback + direct refund). This is the actual cash that left the programme, not an estimate based on cup rate. Each reward sets its own price, so total / total cups returned will NOT match €1.25/cup.',
    },
    {
      id: 'stat-pending',
      // Scoped down to claims only — cup-scan pending is a transient
      // state (auto-resolved by the edge function in seconds) and was
      // double-counting against the operational queue.
      label: 'Pending Claims',
      value: loading ? '—' : (s.pendingClaims || 0).toLocaleString(),
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/></svg>,
      color: (s.pendingClaims || 0) > 0 ? '#F97316' : '#6B6860',
      sub: (s.pendingClaims || 0) > 0 ? 'Awaiting your approval' : 'All caught up',
      tooltip: 'Cashback / direct-refund claims that still need a manual decision. Click to jump to the Claims page filtered to pending only.',
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
          <ScopeToggle />
          <div className="ov-period-toggle">
            {PERIOD_OPTIONS.map(opt => (
              <button
                key={opt.days}
                className={`ov-period-btn${period === opt.days && !isCustomActive ? ' ov-period-btn--active' : ''}`}
                onClick={() => { setPeriod(opt.days); setShowCustomRange(false); }}
              >{opt.label}</button>
            ))}
            {/* Custom range button — opens an inline popover with two
             *  date pickers. Once both are valid we translate the
             *  picked span into a day count and feed it through the
             *  same `period` knob the chart helpers already understand. */}
            <button
              type="button"
              className={`ov-period-btn ov-period-btn--custom${isCustomActive ? ' ov-period-btn--active' : ''}`}
              onClick={() => setShowCustomRange(v => !v)}
              aria-expanded={showCustomRange}
              title="Pick a custom date range"
            >
              {isCustomActive && customStart
                ? `${new Date(customStart).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${new Date(customEnd).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
                : 'Custom…'}
            </button>
            {showCustomRange && (
              <div className="ov-range-pop" role="dialog" aria-label="Pick custom date range">
                <div className="ov-range-pop__row">
                  <label className="ov-range-pop__field">
                    <span>From</span>
                    <input
                      type="date"
                      value={customStart}
                      max={customEnd || todayIso()}
                      onChange={e => setCustomStart(e.target.value)}
                    />
                  </label>
                  <label className="ov-range-pop__field">
                    <span>To</span>
                    <input
                      type="date"
                      value={customEnd}
                      min={customStart || undefined}
                      max={todayIso()}
                      onChange={e => setCustomEnd(e.target.value)}
                    />
                  </label>
                </div>
                <div className="ov-range-pop__hint">
                  {customRangeDays
                    ? `${customRangeDays} day${customRangeDays === 1 ? '' : 's'} of activity`
                    : 'Pick a start + end date'}
                </div>
                <div className="ov-range-pop__actions">
                  <button
                    type="button"
                    className="ov-range-pop__btn ov-range-pop__btn--ghost"
                    onClick={() => setShowCustomRange(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="ov-range-pop__btn ov-range-pop__btn--primary"
                    onClick={applyCustomRange}
                    disabled={!customRangeDays}
                  >
                    Apply range
                  </button>
                </div>
              </div>
            )}
          </div>
          <button className="ov-header__refresh" onClick={loadStats} disabled={loading} title="Refresh stats">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
              style={{ animation: loading ? 'ov-spin 1s linear infinite' : 'none' }}>
              <polyline points="23 4 23 10 17 10"/>
              <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
            </svg>
          </button>

          {/* "N pending" alert chip used to live here — removed. The
           *  Pending Claims stat card below + the sidebar badge on the
           *  Claims nav row cover the same signal without duplicating
           *  it in the page header. */}
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
          <span>
            <strong>Customize mode.</strong> Drag the grip handle to reorder, click the eye to show or hide.
          </span>
        </div>
      )}

      {/* Triage queue block was removed — pending work is now surfaced
       *  by the leaner "Pending Claims" stat card below + the per-page
       *  badges on the sidebar (claims count, scans count). */}

      {/* Stat cards — rendered in the admin's chosen order. We index
          STAT_CARDS by id, then walk STAT_IDS_IN_BLOCKS (the saved
          order). Any card present in STAT_CARDS but missing from
          blocks gets appended so we never silently drop a card. */}
      {(() => {
        const byId = Object.fromEntries(STAT_CARDS.map(c => [c.id, c]));
        const orderedIds = STAT_IDS_IN_BLOCKS.filter(id => byId[id]);
        for (const c of STAT_CARDS) {
          if (!orderedIds.includes(c.id)) orderedIds.push(c.id);
        }
        return (
          <div className={`ov-stats-grid${editMode ? ' ov-grid--editing' : ''}`}>
            {orderedIds.map(id => {
              const card = byId[id];
              if (!card) return null;
              return (
                <StatCard
                  key={card.id}
                  {...card}
                  editMode={editMode}
                  visible={isVisible(card.id)}
                  onToggle={toggleBlock}
                  focused={focusedStat === card.id}
                  onFocus={handleStatFocus}
                  /* Reorder wiring — only active in edit mode, no-ops
                     otherwise. The StatCard itself decides whether to
                     render the grip handle and set draggable=true. */
                  reorder={statReorder}
                />
              );
            })}
          </div>
        );
      })()}

      {/* Reward budget monitor — read-only here, edit on the Settings page. */}
      {budget && (
        <div className="ov-budget-block">
          <RewardBudgetMonitor
            cap={budget.cap}
            enabled={budget.enabled}
            spent={budget.spent}
            loading={budgetLoading}
            title="Reward budget"
            onManage={() => onNavigate?.('settings')}
          />
        </div>
      )}

      {/* Charts grid — 2-column layout */}
      <div className="ov-charts-grid">

        {/* Primary chart — shows cups by default, replaced by stat spotlight on click */}
        {(() => {
          const def = focusedStat ? SPOTLIGHT[focusedStat] : null;
          const primData  = def ? spotlightData : cupsData;
          const primTitle = def ? `${def.title} — Last ${period} Days` : `Cups Added — Last ${period} Days`;
          const primColor = def?.color || '#FFC52F';
          const primType  = def?.type || 'area';
          return (
            <ChartBlock id="chart-cups-per-day" label={primTitle}
              fullWidth editMode={editMode} visible={isVisible('chart-cups-per-day')} onToggle={toggleBlock} reorder={chartReorder}>
              {/* The old "← Back to Cups Added" button was removed.
               *  Clicking the focused stat card again (or any other
               *  spotlight card) already toggles focus off — the
               *  button was redundant. */}
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
          editMode={editMode} visible={isVisible('chart-claims-per-day')} onToggle={toggleBlock} reorder={chartReorder}>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={claimsData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }} barSize={period <= 7 ? 28 : period <= 14 ? 18 : 12}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F0EDE8" vertical={false} />
              <XAxis dataKey="date" tick={AXIS_TICK} tickLine={false} axisLine={false} interval={xInterval} />
              <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="value" fill="#FD6F46" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartBlock>

        <ChartBlock id="chart-cup-dist" label="Cup Status Distribution"
          editMode={editMode} visible={isVisible('chart-cup-dist')} onToggle={toggleBlock} reorder={chartReorder}>
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
          editMode={editMode} visible={isVisible('chart-reward-pop')} onToggle={toggleBlock} reorder={chartReorder}>
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
                        style={{ width: `${pct}%`, background: i === 0 ? '#FD6F46' : i === 1 ? '#FFC52F' : '#E8E6E1' }} />
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
          editMode={editMode} visible={isVisible('feed-activity')} onToggle={toggleBlock} reorder={chartReorder}>
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

      {/* ── User Insights ────────────────────────────────────────────
       * Bottom slab of the Overview page. Three charts in a single row
       * (collapses to stacked on narrow viewports) — device split,
       * hourly activity, and a top-returners leaderboard. All driven
       * by the same stats blob the cards above use so there's no extra
       * round-trip. */}
      <div className="ov-insights">
        <header className="ov-insights__header">
          <h2 className="ov-insights__title">User insights</h2>
          <p className="ov-insights__sub">Who's using the app, when, and how.</p>
        </header>

        <div className="ov-insights__grid">
          <InsightDevice stats={stats} />
          <InsightHourly stats={stats} />
          <InsightTopReturners stats={stats} />
        </div>
      </div>

      {/* ── Cup scans by location — share within one organisation ──
       * Uses cup_scans.location_id (set by the per-location counter QR) to
       * show how BYO collection is split across an org's addresses. */}
      <LocationShare orgIds={scopeOrgIds} depKey={`${statsScope}:${activeOrg?.id || ''}`} />

      <QuickLinks currentPage="overview" onNavigate={onNavigate} />
    </div>
  );
}

/* ── Cup scans by location ───────────────────────────────────────────
 * Share of BYO counter-QR scans across an org's physical locations. A cup
 * is redeemable org-wide; this only reflects WHERE it was collected. */
const LOC_PALETTE = ['#1A8737', '#6C4CE0', '#C7891F', '#2E86C1', '#C0392B', '#16A085', '#8E44AD', '#D35400'];
function LocationShare({ orgIds, depKey }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    getScansByLocation(orgIds)
      .then(d => { if (alive) { setData(d); setLoading(false); } })
      .catch(() => { if (alive) { setData(null); setLoading(false); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depKey]);

  const rows = data?.locations || [];
  const total = data?.total || 0;
  const color = (r, i) => (r.locationId ? LOC_PALETTE[i % LOC_PALETTE.length] : '#CFC7B8');

  return (
    <div className="ov-locshare">
      <header className="ov-locshare__header">
        <h2 className="ov-locshare__title">Cup scans by location</h2>
        <p className="ov-locshare__sub">Where cups are collected across this organisation. Cups stay redeemable at every location.</p>
      </header>
      {loading ? (
        <div className="ov-locshare__empty">Loading…</div>
      ) : total === 0 ? (
        <div className="ov-locshare__empty">No location-tagged cup scans yet. Give each counter QR a location on the BYO&nbsp;requests page.</div>
      ) : (
        <>
          <div className="ov-locshare__bar" role="img" aria-label="Cup scans split by location">
            {rows.map((r, i) => (
              <span
                key={r.locationId || 'none'}
                className="ov-locshare__seg"
                style={{ width: `${r.share}%`, background: color(r, i) }}
                title={`${r.label}: ${r.count} (${r.share}%)`}
              />
            ))}
          </div>
          <ul className="ov-locshare__legend">
            {rows.map((r, i) => (
              <li key={r.locationId || 'none'} className="ov-locshare__row">
                <span className="ov-locshare__dot" style={{ background: color(r, i) }} />
                <span className="ov-locshare__name">{r.label}</span>
                <span className="ov-locshare__count">{r.count.toLocaleString()}</span>
                <span className="ov-locshare__pct">{r.share}%</span>
              </li>
            ))}
          </ul>
          <div className="ov-locshare__total">{total.toLocaleString()} BYO scans total</div>
        </>
      )}
    </div>
  );
}

/* ── User Insight panels ─────────────────────────────────────────── */
function InsightDevice({ stats }) {
  const data = useMemo(() => buildDeviceBreakdown(stats?.rawUsers), [stats?.rawUsers]);
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) {
    return (
      <div className="ov-insight">
        <div className="ov-insight__header">
          <h3>Device breakdown</h3>
          <span className="ov-insight__sub">No data yet</span>
        </div>
      </div>
    );
  }
  return (
    <div className="ov-insight">
      <div className="ov-insight__header">
        <h3>Device breakdown</h3>
        <span className="ov-insight__sub">{total.toLocaleString()} customers</span>
      </div>
      <div className="ov-insight__body ov-insight__body--row">
        <ResponsiveContainer width="55%" height={180}>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" outerRadius={70} innerRadius={42} strokeWidth={0}>
              {data.map((d, i) => <Cell key={i} fill={d.color} />)}
            </Pie>
            <Tooltip content={<ChartTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        <ul className="ov-insight__legend">
          {data.map(d => (
            <li key={d.name}>
              <span className="ov-insight__legend-dot" style={{ background: d.color }} />
              <span className="ov-insight__legend-name">{d.name}</span>
              <span className="ov-insight__legend-val">
                {d.value} <span>· {Math.round((d.value / total) * 100)}%</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function InsightHourly({ stats }) {
  const data = useMemo(() => buildHourlyActivity(stats?.rawCupActivity), [stats?.rawCupActivity]);
  const peak = data.reduce((p, d) => d.value > p.value ? d : p, data[0] || { value: 0, hour: 0 });
  return (
    <div className="ov-insight">
      <div className="ov-insight__header">
        <h3>Cup returns by hour</h3>
        <span className="ov-insight__sub">
          {peak.value > 0 ? `Peak at ${peak.hour}:00` : 'No data yet'}
        </span>
      </div>
      <div className="ov-insight__body">
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={data} margin={{ top: 6, right: 4, left: -20, bottom: 0 }} barSize={10}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F0EDE8" vertical={false} />
            <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#9E9A93' }} tickLine={false} axisLine={false} interval={2} />
            <YAxis tick={{ fontSize: 10, fill: '#9E9A93' }} tickLine={false} axisLine={false} />
            <Tooltip content={<ChartTooltip />} />
            <Bar dataKey="value" radius={[4, 4, 0, 0]} fill="#FD6F46" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function InsightTopReturners({ stats }) {
  const data = useMemo(
    () => buildTopReturners(stats?.rawCupActivity, stats?.rawUsers),
    [stats?.rawCupActivity, stats?.rawUsers],
  );
  const max = data[0]?.value || 1;
  return (
    <div className="ov-insight">
      <div className="ov-insight__header">
        <h3>Top returners</h3>
        <span className="ov-insight__sub">
          {data.length > 0 ? 'All-time leaders' : 'No data yet'}
        </span>
      </div>
      <ul className="ov-insight__leaderboard">
        {data.map((u, i) => (
          <li key={u.id}>
            <span className="ov-insight__rank">{i + 1}</span>
            <span className="ov-insight__leader-name">
              {u.name}
              {u.email && (
                <span className="ov-insight__leader-email">
                  <PiiMask type="email" value={u.email} targetType="user" targetId={u.id} inline />
                </span>
              )}
            </span>
            <span className="ov-insight__leader-bar">
              <span className="ov-insight__leader-bar-fill" style={{ width: `${Math.round((u.value / max) * 100)}%` }} />
            </span>
            <span className="ov-insight__leader-val">{u.value}</span>
          </li>
        ))}
        {data.length === 0 && (
          <li className="ov-insight__empty">No cup returns yet.</li>
        )}
      </ul>
    </div>
  );
}
