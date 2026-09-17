import {
  Gift, Leaf, Receipt, Recycle, Repeat, UserPlus, Users, Wallet,
} from 'lucide-react';
import {
  bucketStart, bucketStarts, countIn, fmtInt, fmtKg, fmtPct, pctChange, previousSeriesFor, seriesFor, sumIn,
} from '../ui/timeSeries';
import { CO2_GRAMS_PER_CUP } from '../../lib/impact';

/* ─────────────────────────────────────────────────────────────────────
 * Dashboard numbers, built from the rows getAdminStats returns.
 * Pure functions: the page decides the period and the currency format.
 * ───────────────────────────────────────────────────────────────────── */

const ms = (v) => (v ? new Date(v).getTime() : NaN);
const isCup = (e) => e.type === 'cup_added';
const isRedeem = (c) => c.type === 'cashback' || c.type === 'voucher';
const isPayout = (c) => c.status === 'completed' && (c.type === 'cashback' || c.type === 'direct_refund');
const isVoucher = (c) => c.status === 'completed' && c.type === 'voucher';

/* Share of customers with a cup return who came back on another day, as
 * of `cutoffMs`. */
function retentionAt(daysByUser, cutoffMs) {
  const cutoff = new Date(cutoffMs).toISOString().slice(0, 10);
  let any = 0;
  let back = 0;
  for (const days of daysByUser.values()) {
    let n = 0;
    for (const d of days) if (d <= cutoff) n++;
    if (n) any++;
    if (n >= 2) back++;
  }
  return any ? (back / any) * 100 : null;
}

function distinctUsersSeries(events, range) {
  const starts = bucketStarts(range.fromMs, range.toMs, range.granularity);
  const index = new Map(starts.map((t, i) => [t, i]));
  const sets = starts.map(() => new Set());
  for (const e of events) {
    const t = ms(e.created_at);
    if (!e.user_id || !(t >= range.fromMs && t <= range.toMs)) continue;
    const i = index.get(bucketStart(t, range.granularity));
    if (i !== undefined) sets[i].add(e.user_id);
  }
  return starts.map((t, i) => ({ t, value: sets[i].size }));
}

export function buildOverviewMetrics(stats, range, { money, voucherVenue = false } = {}) {
  const cups = (stats?.rawCupActivity || []).filter(isCup);
  const users = stats?.rawUsers || [];
  const claims = stats?.rawClaims || [];
  const { fromMs: from, toMs: to, prevFromMs: pFrom, prevToMs: pTo } = range;
  const hasPrev = pFrom != null;
  const prevLabel = range.prev || '';

  const cupsNow = countIn(cups, e => e.created_at, from, to);
  const cupsPrev = hasPrev ? countIn(cups, e => e.created_at, pFrom, pTo - 1) : null;

  const newNow = countIn(users, u => u.created_at, from, to);
  const newPrev = hasPrev ? countIn(users, u => u.created_at, pFrom, pTo - 1) : null;

  const activeIn = (f, t) => new Set(cups.filter(e => { const x = ms(e.created_at); return x >= f && x <= t; }).map(e => e.user_id)).size;
  const activeNow = activeIn(from, to);
  const activePrev = hasPrev ? activeIn(pFrom, pTo - 1) : null;

  const redeemed = claims.filter(isRedeem);
  const redeemNow = sumIn(redeemed, c => c.created_at, from, to, c => c.cups_redeemed);
  const redeemPrev = hasPrev ? sumIn(redeemed, c => c.created_at, pFrom, pTo - 1, c => c.cups_redeemed) : null;

  const payRows = claims.filter(voucherVenue ? isVoucher : isPayout);
  const payNow = sumIn(payRows, c => c.created_at, from, to, c => c.payout_amount);
  const payPrev = hasPrev ? sumIn(payRows, c => c.created_at, pFrom, pTo - 1, c => c.payout_amount) : null;

  const claimsNow = countIn(claims, c => c.created_at, from, to);
  const claimsPrev = hasPrev ? countIn(claims, c => c.created_at, pFrom, pTo - 1) : null;
  const pending = claims.filter(c => c.status === 'pending').length;

  const daysByUser = new Map();
  for (const e of cups) {
    if (!e.user_id || !e.created_at) continue;
    const d = String(e.created_at).slice(0, 10);
    if (!daysByUser.has(e.user_id)) daysByUser.set(e.user_id, new Set());
    daysByUser.get(e.user_id).add(d);
  }
  const retNow = retentionAt(daysByUser, to);
  const retThen = retentionAt(daysByUser, from - 1);
  const starts = bucketStarts(from, to, range.granularity);
  const retSeries = starts.map((t, i) => ({
    t,
    value: Math.round((retentionAt(daysByUser, Math.min((starts[i + 1] ?? to + 1) - 1, to)) ?? 0) * 10) / 10,
  }));

  const co2Now = cupsNow * CO2_GRAMS_PER_CUP;
  const co2Prev = cupsPrev == null ? null : cupsPrev * CO2_GRAMS_PER_CUP;

  const cupSeries = seriesFor(cups, e => e.created_at, range);
  const cupPrevSeries = previousSeriesFor(cups, e => e.created_at, range);
  const fmtMoney = (v) => (money ? money(v) : `€${(v || 0).toFixed(2)}`);

  return [
    {
      id: 'cups', label: 'Cups returned', icon: Recycle, tone: 'emerald', unit: 'count',
      value: cupsNow, format: fmtInt, delta: pctChange(cupsNow, cupsPrev), deltaLabel: prevLabel,
      description: 'Scanned back and added to a balance',
      info: 'Every cup that was scanned back in this period and landed in a customer balance. Scans that failed or are on hold are not counted.',
      formula: 'count(cup_added) in period',
      series: cupSeries, previousSeries: cupPrevSeries,
    },
    {
      id: 'new', label: 'New customers', icon: UserPlus, tone: 'violet', unit: 'count',
      value: newNow, format: fmtInt, delta: pctChange(newNow, newPrev), deltaLabel: prevLabel,
      description: 'Accounts opened in this period',
      info: 'Customer accounts created in this period, including device-only accounts without an email.',
      formula: 'count(users.created_at) in period',
      series: seriesFor(users, u => u.created_at, range),
      previousSeries: previousSeriesFor(users, u => u.created_at, range),
    },
    {
      id: 'active', label: 'Active customers', icon: Users, tone: 'sky', unit: 'count',
      value: activeNow, format: fmtInt, delta: pctChange(activeNow, activePrev), deltaLabel: prevLabel,
      description: 'Returned at least one cup',
      info: 'Distinct customers who returned at least one cup in this period. In the chart each point counts the customers active that day.',
      formula: 'count(distinct user_id with cup_added) in period',
      series: distinctUsersSeries(cups, range),
    },
    {
      id: 'retention', label: 'Retention', icon: Repeat, tone: 'amber', unit: 'pct',
      value: retNow, format: (v) => fmtPct(v), delta: retNow != null && retThen != null ? retNow - retThen : null,
      deltaText: retNow != null && retThen != null ? `${retNow - retThen >= 0 ? '+' : '−'}${Math.abs(retNow - retThen).toFixed(1)} pts` : undefined,
      deltaLabel: 'this period',
      description: 'Came back on another day',
      info: 'Of everyone who ever returned a cup, the share who did so on at least two different days. A lifetime figure: the chart shows how it moved through the period.',
      formula: 'customers with returns on ≥2 days ÷ customers with ≥1 return',
      series: retSeries,
    },
    {
      id: 'redeemed', label: 'Cups redeemed', icon: Gift, tone: 'orange', unit: 'count',
      value: redeemNow, format: fmtInt, delta: pctChange(redeemNow, redeemPrev), deltaLabel: prevLabel,
      description: 'Spent on rewards',
      info: 'Cups customers spent on rewards in this period (cashback claims and counter vouchers). Direct refunds are not included.',
      formula: 'sum(cups_redeemed) of cashback + voucher claims',
      series: seriesFor(redeemed, c => c.created_at, range, c => c.cups_redeemed),
      previousSeries: previousSeriesFor(redeemed, c => c.created_at, range, c => c.cups_redeemed),
    },
    {
      id: 'paid', label: voucherVenue ? 'Voucher value' : 'Paid out', icon: Wallet, tone: 'teal', unit: 'money',
      value: payNow, format: fmtMoney, delta: pctChange(payNow, payPrev), deltaLabel: prevLabel,
      description: voucherVenue ? 'Rewards redeemed at the counter' : 'Cashback and refunds approved',
      info: voucherVenue
        ? 'The value of the rewards customers redeemed at the counter with a voucher in this period.'
        : 'Money approved for customers in this period: cashback and direct refunds. It follows each reward’s price, so it won’t equal cups × rate.',
      formula: voucherVenue ? 'sum(payout_amount) of completed voucher claims' : 'sum(payout_amount) of completed cashback + refund claims',
      series: seriesFor(payRows, c => c.created_at, range, c => c.payout_amount),
      previousSeries: previousSeriesFor(payRows, c => c.created_at, range, c => c.payout_amount),
      axisFormat: (v) => (money ? money(v) : String(v)),
    },
    {
      id: 'claims', label: 'Claims', icon: Receipt, tone: pending ? 'rose' : 'slate', unit: 'count',
      value: claimsNow, format: fmtInt, delta: pctChange(claimsNow, claimsPrev), deltaLabel: prevLabel,
      invertGood: false,
      description: pending ? `${fmtInt(pending)} waiting for review` : 'None waiting for review',
      info: 'Cashback, refund and voucher claims made in this period. The line under the number counts every claim still waiting for a decision, whenever it was made.',
      formula: 'count(claims.created_at) in period',
      series: seriesFor(claims, c => c.created_at, range),
      previousSeries: previousSeriesFor(claims, c => c.created_at, range),
    },
    {
      id: 'co2', label: 'CO₂ avoided', icon: Leaf, tone: 'lime', unit: 'kg',
      value: co2Now, format: fmtKg, delta: pctChange(co2Now, co2Prev), deltaLabel: prevLabel,
      description: `${CO2_GRAMS_PER_CUP} g for every cup reused`,
      info: `Each reused cup avoids about ${CO2_GRAMS_PER_CUP} g of CO₂ compared with a single-use cup.`,
      formula: `cups returned × ${CO2_GRAMS_PER_CUP} g`,
      series: cupSeries.map(p => ({ ...p, value: p.value * CO2_GRAMS_PER_CUP })),
      previousSeries: cupPrevSeries?.map(p => ({ ...p, value: p.value * CO2_GRAMS_PER_CUP })),
      axisFormat: fmtKg,
    },
  ];
}

/* A reward by id. The demo dataset uses its own ids (rw-…); those map onto
 * this venue's live rewards so a demo dashboard names real menu items. */
export function findReward(id, rewards) {
  const hit = rewards?.find(r => r.id === id);
  if (hit || !String(id).startsWith('rw-')) return hit || null;
  const live = (rewards || []).filter(r => r.status === 'live');
  if (!live.length) return null;
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return live[h % live.length];
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/* What stands out in the period, most important first. */
export function buildOverviewInsights({ stats, metrics, range, rewards, budget, money, onNavigate, isVendorView }) {
  const out = [];
  const byId = Object.fromEntries(metrics.map(m => [m.id, m]));
  const cups = byId.cups;
  const claims = stats?.rawClaims || [];

  if (cups?.delta != null && Math.abs(cups.delta) >= 5 && range.prev) {
    out.push({
      id: 'cups-trend', weight: 90, tone: cups.delta >= 0 ? 'up' : 'down',
      text: <>Cups returned {cups.delta >= 0 ? 'rose' : 'fell'} <b>{Math.abs(cups.delta).toFixed(0)}%</b> {range.prev.replace(/^vs /, 'against the ')}, to <b>{fmtInt(cups.value)}</b>.</>,
    });
  }

  const pending = claims.filter(c => c.status === 'pending');
  if (pending.length && !isVendorView) {
    const oldest = pending.reduce((a, c) => (ms(c.created_at) < ms(a.created_at) ? c : a), pending[0]);
    const days = Math.floor((Date.now() - ms(oldest.created_at)) / 86400000);
    out.push({
      id: 'pending', weight: days >= 2 ? 95 : 70, tone: days >= 2 ? 'warn' : 'info',
      text: <><b>{pending.length}</b> claim{pending.length === 1 ? '' : 's'} waiting for review{days >= 1 ? <>, the oldest for <b>{days} day{days === 1 ? '' : 's'}</b></> : ''}. Customers are paid once they are approved.</>,
      action: onNavigate ? { label: 'Review claims', onClick: () => onNavigate('claims') } : undefined,
    });
  }

  if (budget?.enabled && budget.cap > 0 && !isVendorView) {
    const share = (budget.spent / budget.cap) * 100;
    if (share >= 80) {
      out.push({
        id: 'budget', weight: share >= 100 ? 100 : 85, tone: 'warn',
        text: share >= 100
          ? <>The reward budget of <b>{money(budget.cap)}</b> is used up, so new cashback claims are paused.</>
          : <>The reward budget is <b>{share.toFixed(0)}%</b> used: {money(Math.max(0, budget.cap - budget.spent))} left of {money(budget.cap)}.</>,
        action: onNavigate ? { label: 'Budget settings', onClick: () => onNavigate('settings', { section: 'payouts' }) } : undefined,
      });
    }
  }

  // Busiest and quietest day in the period.
  if (cups?.series?.length >= 5 && range.granularity === 'day' && cups.value > 0) {
    let hi = cups.series[0]; let lo = cups.series[0];
    for (const p of cups.series) { if (p.value > hi.value) hi = p; if (p.value < lo.value) lo = p; }
    const fmt = (t) => new Date(t).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
    out.push({
      id: 'busiest', weight: 40, tone: 'info',
      text: <><b>{fmt(hi.t)}</b> was the busiest day with {fmtInt(hi.value)} cups{lo.value < hi.value ? <>; the quietest was {fmt(lo.t)} with {fmtInt(lo.value)}</> : ''}.</>,
    });
  }

  // Peak hour and weekday across the period.
  const inPeriod = (stats?.rawCupActivity || []).filter(e => isCup(e) && ms(e.created_at) >= range.fromMs && ms(e.created_at) <= range.toMs);
  if (inPeriod.length >= 10) {
    const hours = new Array(24).fill(0);
    const weekdays = new Array(7).fill(0);
    for (const e of inPeriod) {
      const d = new Date(e.created_at);
      hours[d.getHours()]++;
      weekdays[d.getDay()]++;
    }
    const peakHour = hours.indexOf(Math.max(...hours));
    const share = Math.round((hours[peakHour] / inPeriod.length) * 100);
    const peakDay = weekdays.indexOf(Math.max(...weekdays));
    out.push({
      id: 'peak', weight: 45, tone: 'info',
      text: <>Most cups come back between <b>{String(peakHour).padStart(2, '0')}:00 and {String((peakHour + 1) % 24).padStart(2, '0')}:00</b> ({share}% of the period), and on <b>{WEEKDAYS[peakDay]}s</b>.</>,
    });
  }

  // Reward that carries the claims.
  const popular = buildRewardPopularity(stats, rewards, range, Infinity);
  const totalRewardClaims = popular.reduce((a, r) => a + r.value, 0);
  if (totalRewardClaims >= 3) {
    const top = popular[0];
    const share = Math.round((top.value / totalRewardClaims) * 100);
    out.push({
      id: 'top-reward', weight: share >= 50 ? 60 : 35, tone: 'info',
      text: <><b>{top.name}</b> accounts for <b>{share}%</b> of the rewards claimed in this period.</>,
      action: onNavigate && !isVendorView ? { label: 'Rewards', onClick: () => onNavigate('rewards') } : undefined,
    });
  }

  const ret = byId.retention;
  if (ret?.value != null) {
    out.push({
      id: 'retention', weight: 30, tone: ret.value >= 40 ? 'up' : 'info',
      text: <><b>{fmtPct(ret.value)}</b> of customers who returned a cup came back on another day{ret.delta != null && Math.abs(ret.delta) >= 0.5 ? <>, {ret.delta > 0 ? 'up' : 'down'} {Math.abs(ret.delta).toFixed(1)} points in this period</> : ''}.</>,
    });
  }

  const newM = byId.new;
  if (newM?.value > 0 && cups?.value > 0) {
    const created = new Set((stats?.rawUsers || []).filter(u => ms(u.created_at) >= range.fromMs && ms(u.created_at) <= range.toMs).map(u => u.id));
    const withCup = new Set(inPeriod.filter(e => created.has(e.user_id)).map(e => e.user_id)).size;
    const share = Math.round((withCup / created.size) * 100);
    if (created.size >= 5) {
      out.push({
        id: 'activation', weight: 25, tone: share >= 50 ? 'up' : 'info',
        text: <><b>{share}%</b> of the {fmtInt(created.size)} new customers returned a cup in the same period.</>,
      });
    }
  }

  return out.sort((a, b) => b.weight - a.weight).slice(0, 5);
}

/* Where every cup ever collected is now. */
export function buildCupFlow(stats) {
  const claims = stats?.rawClaims || [];
  const balances = stats?.rawBalances || [];
  const redeemed = claims.filter(isRedeem).reduce((s, c) => s + (c.cups_redeemed || 0), 0);
  const refunded = claims.filter(c => c.type === 'direct_refund').reduce((s, c) => s + (c.cups_redeemed || 0), 0);
  const inBalance = balances.reduce((s, b) => s + (b.balance || 0), 0);
  const lifetime = balances.reduce((s, b) => s + (b.lifetime_cups || 0), 0);
  const donated = Math.max(0, lifetime - redeemed - refunded - inBalance);
  return [
    { id: 'balance', name: 'In balances', value: inBalance, color: '#5B3FD6', hint: 'waiting to be spent' },
    { id: 'redeemed', name: 'Redeemed', value: redeemed, color: '#E8930C', hint: 'spent on rewards' },
    { id: 'refunded', name: 'Refunded', value: refunded, color: '#1F8FCE', hint: 'paid back as a refund' },
    { id: 'donated', name: 'Donated or shared', value: donated, color: '#0E9E74', hint: 'given away' },
  ];
}

export function buildRewardPopularity(stats, rewards, range, limit = 6) {
  const counts = new Map();
  for (const c of stats?.rawClaims || []) {
    if (!c.reward_id || c.status === 'failed') continue;
    if (range && !(ms(c.created_at) >= range.fromMs && ms(c.created_at) <= range.toMs)) continue;
    const r = findReward(c.reward_id, rewards);
    const key = r?.id || c.reward_id;
    const row = counts.get(key) || { id: key, value: 0, name: r?.name || 'Archived reward', image: r?.image || null };
    row.value += 1;
    counts.set(key, row);
  }
  return [...counts.values()].sort((a, b) => b.value - a.value).slice(0, limit);
}

export function buildHourly(stats, range) {
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, label: `${String(h).padStart(2, '0')}:00`, value: 0 }));
  for (const e of stats?.rawCupActivity || []) {
    if (!isCup(e)) continue;
    const t = ms(e.created_at);
    if (range && !(t >= range.fromMs && t <= range.toMs)) continue;
    hours[new Date(t).getHours()].value++;
  }
  return hours;
}

export function buildDevices(stats) {
  const buckets = { iPhone: 0, Android: 0, iPad: 0, Mac: 0, Windows: 0, Other: 0, Unknown: 0 };
  for (const u of stats?.rawUsers || []) {
    const d = (u.device || '').toLowerCase();
    if (!d) buckets.Unknown++;
    else if (d.includes('ipad')) buckets.iPad++;
    else if (d.includes('iphone')) buckets.iPhone++;
    else if (d.includes('android')) buckets.Android++;
    else if (d.includes('mac')) buckets.Mac++;
    else if (d.includes('windows')) buckets.Windows++;
    else buckets.Other++;
  }
  const palette = { iPhone: '#5B3FD6', Android: '#0E9E74', iPad: '#8B6CFF', Mac: '#E8930C', Windows: '#1F8FCE', Other: '#9A96A8', Unknown: '#D6D3E0' };
  return Object.entries(buckets).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value, color: palette[name] }));
}

export function buildTopReturners(stats, range, n = 6) {
  const counts = {};
  for (const e of stats?.rawCupActivity || []) {
    if (!isCup(e) || !e.user_id) continue;
    const t = ms(e.created_at);
    if (range && !(t >= range.fromMs && t <= range.toMs)) continue;
    counts[e.user_id] = (counts[e.user_id] || 0) + 1;
  }
  const byId = Object.fromEntries((stats?.rawUsers || []).map(u => [u.id, u]));
  return Object.entries(counts)
    .map(([id, value]) => ({ id, value, name: byId[id]?.display_name || 'Anonymous', email: byId[id]?.email || '' }))
    .sort((a, b) => b.value - a.value)
    .slice(0, n);
}
