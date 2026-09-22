import { fmtDuration } from '../lib/behaviourFormat';
import {
  fmtDec, fmtInt, formatBucket, formatWindow, pctChange, periodPhrase, periodRange,
} from '../ui/timeSeries';
import {
  ERROR_SCREENS, METRIC_COPY, METRIC_ORDER, breakdownLabel, screenName,
} from './behaviourCopy';
import { DEFAULT_LOOK, METRIC_LOOK } from './behaviourIcons';

/* ─────────────────────────────────────────────────────────────────────
 * User Behaviour numbers, shaped for the shared tiles, chart and
 * insights. Pure functions over what getUserBehaviourStats returns.
 *
 * The reader computes every metric over the selected window, plus a
 * series of checkpoints: at each one the metric is recomputed from the
 * start of the window up to that moment. So a rate's series is a running
 * rate that ends at the headline value. Counts are turned back into
 * per-step amounts (taps per day, say), which is what a chart of counts
 * shows everywhere else in the dashboard.
 * ───────────────────────────────────────────────────────────────────── */

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const round2 = (v) => Math.round(v * 100) / 100;

/* ── Periods ───────────────────────────────────────────────────────── */

/* The shared presets this page offers. "Today" is left out: the reader
 * has one checkpoint per day at best, so a day is a single dot. */
export const PERIOD_IDS = ['7d', '14d', '30d', '90d', '12m', 'all'];

const pad = (v) => String(v).padStart(2, '0');
export const toDayInput = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
export function parseDayInput(s) {
  const [y, m, d] = String(s || '').split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d).getTime();
}
const startOfDay = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
const endOfDay = (ms) => { const d = new Date(ms); d.setHours(23, 59, 59, 999); return d.getTime(); };

/* The window a period stands for, and the one before it. Same shape as
 * ui/timeSeries periodRange (prevToMs is exclusive); fromMs is null for
 * all time, where the reader uses the first and last recorded event. */
export function resolveWindow(periodId, custom, now) {
  if (periodId === 'custom') {
    let from = parseDayInput(custom?.from);
    let to = parseDayInput(custom?.to);
    if (from != null && to != null) {
      if (from > to) [from, to] = [to, from];
      from = startOfDay(from);
      to = endOfDay(to);
      const span = to - from + 1;
      const days = Math.round(span / DAY);
      const text = formatWindow(from, to);
      return {
        id: 'custom', label: text, noun: text,
        prev: `vs previous ${days} day${days === 1 ? '' : 's'}`,
        fromMs: from, toMs: to, prevFromMs: from - span, prevToMs: from, days,
      };
    }
  }
  if (periodId === 'ytd') {
    const d = new Date(now);
    const from = new Date(d.getFullYear(), 0, 1).getTime();
    const lastYear = new Date(now);
    lastYear.setFullYear(d.getFullYear() - 1);
    return {
      id: 'ytd', label: 'This year', noun: 'this year so far', prev: 'vs same period last year',
      fromMs: from, toMs: now,
      prevFromMs: new Date(d.getFullYear() - 1, 0, 1).getTime(), prevToMs: lastYear.getTime(),
      days: Math.max(1, Math.ceil((now - from) / DAY)),
    };
  }
  const id = PERIOD_IDS.includes(periodId) ? periodId : '30d';
  const r = periodRange(id, { now });
  if (id === 'all') return { ...r, fromMs: null, toMs: null, prevFromMs: null, prevToMs: null };
  return r;
}

const iso = (ms) => new Date(ms).toISOString();
export const requestFor = (win) => (win.fromMs == null ? null : { from: iso(win.fromMs), to: iso(win.toMs) });
export const previousRequestFor = (win) => (win.prevFromMs == null ? null : { from: iso(win.prevFromMs), to: iso(win.prevToMs - 1) });

/* "19 Aug – 17 Sep 2026" for what is actually on screen. */
export function windowText(win, meta) {
  const from = win.fromMs ?? (meta?.hasData ? Date.parse(meta.from) : null);
  const to = win.toMs ?? (meta?.hasData ? Date.parse(meta.to) : null);
  return from != null && to != null ? formatWindow(from, to) : '';
}

/* "3 Sep", or "3 Sep 2026" — the dashboard's own month names. */
export function fmtDay(ms, withYear = false) {
  if (!finite(ms)) return '';
  const text = formatBucket(ms, 'day');
  return withYear ? `${text} ${new Date(ms).getFullYear()}` : text;
}

/* The period inside a sentence, as the Dashboard says it ("in the last 30
 * days", "since the start"), plus this page's own two periods. */
export function phraseFor(win) {
  if (win?.id === 'ytd') return 'this year';
  if (win?.id === 'custom') return `in ${win.noun}`;
  return periodPhrase(win);
}

/* ── Values ────────────────────────────────────────────────────────── */

/* How a metric is measured. The unit decides which metrics may share a
 * chart; 'text' (the most common last screen) never charts. */
export function kindOf(m) {
  if (m.id === 'last_screen') return 'text';
  if (m.id === 'tk_avg_payout') return 'money';
  if (m.id === 'tk_avg_cups') return 'ratio';
  if (m.valueType === 'percent') return 'pct';
  if (m.valueType === 'duration') return 'minutes';
  return 'count';
}
const RUNNING = new Set(['pct', 'minutes', 'money', 'ratio']);

export const fmtRate = (v) => {
  if (!finite(v)) return '—';
  const r = Math.round(v * 10) / 10;
  return `${Number.isInteger(r) ? r.toFixed(0) : r.toFixed(1)}%`;
};

function durationTick(minutes) {
  if (!finite(minutes)) return '';
  const sec = minutes * 60;
  if (sec < 90) return `${Math.round(sec)}s`;
  if (minutes < 90) return `${Math.round(minutes)}m`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1440)}d`;
}

function formatterFor(kind, money) {
  if (kind === 'pct') return fmtRate;
  if (kind === 'minutes') return (v) => (finite(v) ? fmtDuration(v * 60000) : '—');
  if (kind === 'money') return (v) => (finite(v) ? (money ? money(v) : `€${v.toFixed(2)}`) : '—');
  if (kind === 'ratio') return (v) => fmtDec(v, 1);
  return fmtInt;
}

function headlineValue(kind, m) {
  if (!m) return null;
  if (kind === 'pct') return finite(m.value) ? m.value : null;
  if (kind === 'minutes') return finite(m.rawValue) ? m.rawValue / 60000 : null;
  if (kind === 'money' || kind === 'ratio') return finite(m.rawValue) ? m.rawValue : null;
  if (kind === 'text') return m.measurable && m.valueText ? (Number(m.numerator) || 0) : null;
  // Counts: a count with nothing recorded is a real zero.
  return finite(m.rawValue) ? m.rawValue : 0;
}

export function signedChange(kind, d) {
  if (!finite(d)) return '';
  const abs = Math.abs(d);
  if (abs < 0.05) return 'No change';
  const sign = d > 0 ? '+' : '−';
  if (kind === 'pct') return `${sign}${abs.toFixed(1)} pts`;
  return `${sign}${abs >= 10 ? abs.toFixed(0) : abs.toFixed(1)}%`;
}

/* Checkpoints → chart points. Running values keep their checkpoint (moved
 * two hours back so a midnight checkpoint reads as the day it closes);
 * counts become the amount added since the previous checkpoint, dated
 * from the start of that step. */
function pointsOf(kind, m, startMs) {
  const s = m?.series || [];
  if (kind === 'text') return [];
  if (kind === 'count') {
    let before = 0;
    let stepStart = startMs;
    return s.map((p) => {
      const total = finite(p.v) ? p.v : 0;
      const point = { t: finite(stepStart) ? stepStart : p.t, endMs: p.t, value: Math.max(0, total - before) };
      before = total;
      stepStart = p.t;
      return point;
    });
  }
  const scale = kind === 'minutes' ? 1 / 60000 : 1;
  return s.map((p, i) => ({
    t: i === s.length - 1 ? p.t : p.t - 2 * HOUR,
    endMs: p.t,
    value: finite(p.v) ? round2(p.v * scale) : null,
  }));
}

function buildOne(m, p, ctx) {
  const copy = METRIC_COPY[m.id] || {};
  const look = METRIC_LOOK[m.id] || DEFAULT_LOOK;
  const kind = kindOf(m);
  const value = headlineValue(kind, m);
  const prevValue = p ? headlineValue(kind, p) : null;
  const good = copy.good === undefined ? 'up' : copy.good;

  let delta = null;
  let footnote;
  // Nothing in either period is not a change worth a line.
  if (value != null && prevValue != null && kind !== 'text' && !(value === 0 && prevValue === 0)) {
    const change = kind === 'pct' ? value - prevValue : pctChange(value, prevValue);
    // Rounded as shown, so a change of −0.04 reads as no change, not "−0.0".
    const d = finite(change) ? Math.round(change * 10) / 10 + 0 : null;
    if (finite(d)) {
      if (good) delta = d;
      // A change that is neither good nor bad is stated, not coloured.
      else footnote = `${signedChange(kind, d)} ${ctx.prevLabel}`;
    }
  }

  const points = pointsOf(kind, m, ctx.curStart);
  const defined = points.filter(x => x.value != null);
  const format = kind === 'text' ? () => screenName(m.valueText) : formatterFor(kind, ctx.money);
  let prevDisplay = null;
  if (p && kind === 'text') prevDisplay = p.measurable && p.valueText ? screenName(p.valueText) : null;
  else if (p && prevValue != null) prevDisplay = format(prevValue);
  const empty = m.note || copy.empty || 'Nothing to measure in this period yet.';
  const reader = typeof m.desc === 'string' ? m.desc : '';
  const breakdown = Array.isArray(m.breakdown)
    ? m.breakdown.map(b => ({ ...b, label: breakdownLabel(m.id, b) }))
    : null;

  return {
    id: m.id,
    label: copy.label || m.label,
    icon: look.icon,
    tone: look.tone,
    kind,
    unit: kind === 'text' ? 'text' : kind,
    group: m.group,
    value,
    prevValue,
    prevDisplay,
    format,
    axisFormat: kind === 'minutes' ? durationTick
      : kind === 'money' ? formatterFor('money', ctx.money)
        : kind === 'ratio' ? (v) => fmtDec(v, 1) : undefined,
    delta,
    deltaLabel: ctx.prevLabel,
    invertGood: good === 'down',
    neutral: !good,
    footnote,
    description: value == null ? empty : (copy.describe ? copy.describe(m) : reader),
    info: copy.info || reader,
    formula: copy.formula,
    unavailable: value == null ? empty : null,
    chartable: kind !== 'text' && defined.length > 0,
    running: RUNNING.has(kind),
    series: defined.map(x => ({ t: x.t, value: x.value })),
    points,
    prevPoints: p ? pointsOf(kind, p, ctx.prevStart) : null,
    breakdown,
    screen: kind === 'text' ? m.valueText : null,
    basis: {
      num: m.numerator,
      den: m.denominator,
      numLabel: copy.num || m.numLabel || null,
      denLabel: copy.den || m.denLabel || null,
    },
    raw: m,
    prevRaw: p || null,
  };
}

/* Tiles for what the reader returned. `prev` is the same reader for the
 * window before (null for all time, or while it loads). */
export function buildMetrics(cur, prev, win, { money } = {}) {
  if (!cur?.metrics) return [];
  const prevById = new Map((prev?.metrics || []).map(m => [m.id, m]));
  const ctx = {
    money,
    prevLabel: win.prev || '',
    curStart: cur.meta?.from ? Date.parse(cur.meta.from) : NaN,
    prevStart: prev?.meta?.from ? Date.parse(prev.meta.from) : NaN,
  };
  const withPrev = !!prev && win.prevFromMs != null;
  return cur.metrics.map(m => buildOne(m, withPrev ? prevById.get(m.id) : null, ctx));
}

/* Placeholder tiles for the first load, in the reader's order. */
export function skeletonMetrics(modeKey) {
  return (METRIC_ORDER[modeKey] || METRIC_ORDER.standard).map(([id, group]) => {
    const copy = METRIC_COPY[id] || {};
    const look = METRIC_LOOK[id] || DEFAULT_LOOK;
    return {
      id, group, label: copy.label || id, icon: look.icon, tone: look.tone,
      kind: 'pct', unit: 'pct', value: null, unavailable: null, info: copy.info, formula: copy.formula,
      chartable: false, points: [], series: [], basis: {},
    };
  });
}

/* ── Chart ─────────────────────────────────────────────────────────── */

/* What TrendCard plots. A running rate has nothing to show until its
 * denominator exists; those checkpoints are null, which the chart draws as
 * a gap rather than as 0%. The previous window is laid on the same steps. */
export function chartMetricsFor(metrics) {
  return metrics.map((m) => {
    if (!m.chartable) return { ...m, series: undefined, previousSeries: undefined };
    const previousSeries = m.prevPoints
      ? m.points.map((p, i) => ({ t: p.t, value: m.prevPoints[i]?.value ?? null }))
      : null;
    return {
      ...m,
      series: m.points.map(p => ({ t: p.t, value: p.value })),
      previousSeries: previousSeries?.some(p => p.value != null) ? previousSeries : undefined,
    };
  });
}

/* The range TrendCard labels the chart with: the bucket size matches the
 * reader's checkpoint step, and the subtitle says what a point means. */
export function chartRangeFor(win, meta, metrics, activeIds) {
  const from = meta?.from ? Date.parse(meta.from) : win.fromMs;
  const to = meta?.to ? Date.parse(meta.to) : win.toMs;
  const days = finite(from) && finite(to) ? (to - from) / DAY : 0;
  const step = Math.max(1, Math.ceil(days / 16));
  const granularity = step >= 15 ? 'month' : step >= 3 ? 'week' : 'day';
  const first = metrics.find(m => m.chartable && activeIds.includes(m.id));
  const since = fmtDay(from);
  let detail = '';
  if (first?.kind === 'count') detail = step === 1 ? 'per day' : `per ${step} days`;
  else if (first?.kind === 'pct') detail = `running rate since ${since}`;
  else if (first) detail = `running average since ${since}`;
  return {
    ...win,
    fromMs: finite(from) ? from : null,
    toMs: finite(to) ? to : null,
    granularity,
    stepDays: step,
    noun: [win.noun, detail].filter(Boolean).join(' · '),
  };
}

/* ── Funnels ───────────────────────────────────────────────────────── */

/* Each step's rate is the reader's own metric, and its denominator is the
 * step before, so the chain is exact. */
export function buildFunnels(byId) {
  const q = byId.qr_scan_receipts?.raw;
  const s2 = byId.second_scan?.raw;
  const s3 = byId.third_scan_returning?.raw;
  const a = byId.active_users?.raw;
  const c = byId.rewards_claim?.raw;
  const e = byId.emails_active?.raw;
  const out = [];
  if (q && s2 && s3) {
    out.push({
      id: 'scan',
      title: 'From receipt to habit',
      steps: [
        { id: 'printed', label: 'Receipts printed', count: q.denominator, tone: 'slate' },
        { id: 'scanned', label: 'Scanned by a customer', count: q.numerator, rate: q.value, of: 'of printed receipts', tone: 'violet' },
        { id: 'second', label: 'Customers who came back', count: s2.numerator, rate: s2.value, of: 'of scanned receipts', tone: 'emerald' },
        { id: 'third', label: 'Came back a third time', count: s3.numerator, rate: s3.value, of: 'of those who came back', tone: 'teal' },
      ],
    });
  }
  if (a && c) {
    out.push({
      id: 'people',
      title: 'From profile to claim',
      steps: [
        { id: 'profiles', label: 'New profiles', count: a.denominator, tone: 'slate' },
        { id: 'active', label: 'Active users', count: a.numerator, rate: a.value, of: 'of new profiles', tone: 'sky' },
        { id: 'claimed', label: 'Made a claim', count: c.numerator, rate: c.value, of: 'of active users', tone: 'amber' },
      ],
      note: e && finite(e.value)
        ? `${fmtInt(e.numerator)} active users (${fmtRate(e.value)}) left an email.`
        : null,
    });
  }
  // The weakest step of each funnel, when there is enough to judge it.
  for (const f of out) {
    let weakest = null;
    f.steps.forEach((s, i) => {
      if (i === 0 || !finite(s.rate) || (f.steps[i - 1].count || 0) < 10) return;
      if (!weakest || s.rate < weakest.rate) weakest = s;
    });
    f.weakestId = weakest?.id || null;
    f.total = f.steps[0].count || 0;
  }
  return out;
}

/* Deferred Tikkie: what happened to the payout links issued. */
export function buildLinkSplit(byId) {
  const c = byId.tk_collect?.raw;
  if (!c) return null;
  const issued = Number(c.denominator) || 0;
  const collected = Number(c.numerator) || 0;
  const expired = Number(byId.tk_expired?.raw?.numerator) || 0;
  return {
    issued,
    rows: [
      { key: 'collected', label: 'Collected', hint: 'IBAN entered, money paid', count: collected, color: '#0E9E74' },
      { key: 'open', label: 'Not collected yet', hint: 'still waiting for the customer', count: Math.max(0, issued - collected - expired), color: '#E8930C' },
      { key: 'expired', label: 'Expired', hint: 'the money was never collected', count: expired, color: '#E03E6B' },
    ],
  };
}

/* ── Insights ──────────────────────────────────────────────────────── */

const DROP_TEXT = {
  scanned: (s) => <><b>{fmtRate(100 - s.rate)}</b> of printed receipts are never scanned, the biggest drop in the funnel. Make the QR code easy to spot and mention it at the counter.</>,
  second: (s) => <>The biggest drop comes after the first scan: <b>{fmtRate(s.rate)}</b> of scanned receipts bring a customer back. Remind first-time customers what their next cup gets them.</>,
  third: (s) => <>The biggest drop is between the second and third visit: <b>{fmtRate(s.rate)}</b> of returning customers come back again. A reward within reach of three cups can make the habit stick.</>,
  active: (s) => <>Only <b>{fmtRate(s.rate)}</b> of new profiles collected a cup or left an email. The rest are mostly visitors from shared or poster links.</>,
  claimed: (s) => <>Only <b>{fmtRate(s.rate)}</b> of active users have made a claim. Check that a reward is within reach of a typical balance.</>,
};

const GOOD_TEXT = {
  scanned: (r) => <><b>{fmtRate(r)}</b> of printed receipts get scanned, so customers find the QR code.</>,
  second: (r) => <><b>{fmtRate(r)}</b> of scanned receipts bring a customer back for a second scan.</>,
  third: (r) => <><b>{fmtRate(r)}</b> of customers who came back once came back again: the habit sticks.</>,
  active: (r) => <><b>{fmtRate(r)}</b> of new profiles became active users.</>,
  claimed: (r) => <><b>{fmtRate(r)}</b> of active users have made a claim.</>,
  email: (r) => <><b>{fmtRate(r)}</b> of active users left an email, so you can reach them.</>,
};
const GOOD_AT = { scanned: 80, second: 35, third: 50, active: 70, claimed: 40, email: 50 };

/* Metrics that tell the same story; only the biggest mover of each is told. */
const FAMILY = {
  emails_active: 'email', emails_input: 'email', tk_email_capture: 'email',
  third_scan: 'third', third_scan_returning: 'third',
  qr_scan_receipts: 'scan', ignored_receipts: 'scan',
  active_users: 'audience', visitor_rate: 'audience',
  rewards_share: 'mix', donation_share: 'mix',
  tk_collect: 'links', tk_expired: 'links',
};

function movementInsights(metrics, vs) {
  const scored = [];
  for (const m of metrics) {
    if (m.delta == null || m.value == null || m.neutral) continue;
    const r = m.raw || {};
    const p = m.prevRaw || {};
    let score = 0;
    if (m.kind === 'pct') {
      const base = Math.min(Number(r.denominator) || 0, Number(p.denominator) || 0);
      if (base >= 20 && Math.abs(m.delta) >= 3) score = Math.abs(m.delta) / 3;
    } else if (m.kind === 'count') {
      if (Math.max(m.value, m.prevValue || 0) >= 20 && Math.abs(m.delta) >= 20) score = Math.abs(m.delta) / 20;
    } else {
      const base = Math.min(Number(r.numerator) || 0, Number(p.numerator) || 0);
      if (base >= 10 && Math.abs(m.delta) >= 20) score = Math.abs(m.delta) / 20;
    }
    if (score > 0) scored.push({ m, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const seen = new Set();
  const picked = scored.filter(({ m }) => {
    const family = FAMILY[m.id] || m.id;
    if (seen.has(family)) return false;
    seen.add(family);
    return true;
  });
  return picked.slice(0, 2).map(({ m, score }, i) => {
    const up = m.delta > 0;
    const size = m.kind === 'pct' ? `${Math.abs(m.delta).toFixed(1)} points` : `${Math.abs(m.delta).toFixed(0)}%`;
    return {
      id: `move-${m.id}`,
      weight: Math.min(92, 62 + score * 6) - i * 4,
      tone: up !== m.invertGood ? 'up' : 'down',
      text: <><b>{m.label}</b> {up ? 'rose' : 'fell'} <b>{size}</b> {vs}, to {m.format(m.value)}.</>,
    };
  });
}

function standardInsights(byId, funnels, action) {
  const out = [];
  const drops = [];
  for (const f of funnels) {
    const s = f.steps.find(x => x.id === f.weakestId);
    if (s && DROP_TEXT[s.id]) drops.push(s);
  }
  drops.sort((a, b) => a.rate - b.rate);
  drops.slice(0, 1).forEach((s) => {
    out.push({
      id: `drop-${s.id}`, weight: 80, tone: 'warn', text: DROP_TEXT[s.id](s),
      action: s.id === 'claimed' ? action('rewards', 'Rewards') : undefined,
    });
  });

  // What is working: the step furthest above its bar.
  const steps = funnels.flatMap(f => f.steps.map((s, i) => ({ ...s, prevCount: f.steps[i - 1]?.count })));
  const email = byId.emails_active?.raw;
  if (email && finite(email.value)) steps.push({ id: 'email', rate: email.value, prevCount: email.denominator });
  const best = steps
    .filter(s => GOOD_AT[s.id] && finite(s.rate) && (s.prevCount || 0) >= 10 && s.rate >= GOOD_AT[s.id] && s.id !== drops[0]?.id)
    .sort((a, b) => b.rate / GOOD_AT[b.id] - a.rate / GOOD_AT[a.id])[0];
  if (best) out.push({ id: `good-${best.id}`, weight: 50, tone: 'up', text: GOOD_TEXT[best.id](best.rate) });

  if (email && finite(email.value) && email.denominator >= 20 && email.value < 30) {
    out.push({
      id: 'email-low', weight: 66, tone: 'warn',
      text: <>Only <b>{fmtRate(email.value)}</b> of active users left an email, so most customers can’t be reached.</>,
    });
  }

  const last = byId.last_screen?.raw;
  if (last?.measurable && last.valueText && (last.denominator || 0) >= 20) {
    const share = Math.round((last.numerator / last.denominator) * 100);
    if (ERROR_SCREENS.has(last.valueText)) {
      out.push({
        id: 'last-screen', weight: 76, tone: 'warn',
        text: <><b>{share}%</b> of visits end on the <b>{screenName(last.valueText)}</b> screen. Failed scans and rejected claims are worth a look.</>,
        action: action(last.valueText === 'rejected' ? 'claims' : 'cupscans', last.valueText === 'rejected' ? 'Claims' : 'Cup scans'),
      });
    } else if (last.valueText !== 'home' && share >= 35) {
      out.push({
        id: 'last-screen', weight: 32, tone: 'info',
        text: <>Most visits end on the <b>{screenName(last.valueText)}</b> screen ({share}% of visits).</>,
      });
    }
  }

  const visitors = byId.visitor_rate?.raw;
  if (visitors && finite(visitors.value) && visitors.denominator >= 20 && visitors.value >= 40) {
    out.push({
      id: 'visitors', weight: 60, tone: 'warn',
      text: <><b>{fmtRate(visitors.value)}</b> of new profiles never collected a cup or left an email, so the profile count overstates your customers.</>,
    });
  }

  const rejected = Number(byId.cookie_rejected?.raw?.rawValue) || 0;
  if (rejected >= 5) {
    const opens = Number(byId.entry_source?.raw?.rawValue) || 0;
    const share = opens ? (rejected / (rejected + opens)) * 100 : null;
    out.push({
      id: 'cookies', weight: share != null && share >= 5 ? 55 : 34, tone: share != null && share >= 5 ? 'warn' : 'info',
      text: <><b>{fmtInt(rejected)}</b> visitors turned essential cookies off and couldn’t use the app{share != null ? <> ({fmtRate(share)} of attempts)</> : ''}.</>,
    });
  }

  const inapp = byId.inapp_redirect?.raw;
  const shown = Number(inapp?.rawValue) || 0;
  if (shown >= 10) {
    const opened = inapp.breakdown?.find(b => b.key === 'opened')?.count || 0;
    const rate = (opened / shown) * 100;
    if (rate < 50) {
      out.push({
        id: 'inapp', weight: 45, tone: 'warn',
        text: <>Only <b>{fmtRate(rate)}</b> of customers in an in-app browser switched to their own browser, so some cups may not reach their real account.</>,
      });
    }
  }

  const gap = byId.avg_second_scan;
  if (gap?.value != null && (gap.raw?.numerator || 0) >= 5) {
    out.push({
      id: 'gap', weight: 22, tone: 'info',
      text: <>Returning customers scan again <b>{gap.format(gap.value)}</b> after their first scan, on average.</>,
    });
  }
  return out;
}

function tikkieInsights(byId, action) {
  const out = [];
  const rate = (id) => byId[id]?.raw;
  const expired = rate('tk_expired');
  if (expired && finite(expired.value) && expired.denominator >= 10 && expired.value >= 10) {
    out.push({
      id: 'expired', weight: 85, tone: 'warn',
      text: <><b>{fmtRate(expired.value)}</b> of payout links ({fmtInt(expired.numerator)}) expired before customers collected them. That money was never paid out.</>,
      action: action('tikkielog', 'Tikkie payouts'),
    });
  }
  const collect = rate('tk_collect');
  if (collect && finite(collect.value) && collect.denominator >= 10) {
    if (collect.value < 50) {
      out.push({
        id: 'collect', weight: 75, tone: 'warn',
        text: <>Customers collected only <b>{fmtRate(collect.value)}</b> of the payout links issued.</>,
        action: action('tikkielog', 'Tikkie payouts'),
      });
    } else if (collect.value >= 70) {
      out.push({ id: 'collect', weight: 48, tone: 'up', text: <>Customers collected <b>{fmtRate(collect.value)}</b> of the payout links issued.</> });
    }
  }
  const pending = rate('tk_pending_resolved');
  const open = pending ? (Number(pending.denominator) || 0) - (Number(pending.numerator) || 0) : 0;
  if (pending && open > 0 && finite(pending.value) && pending.value < 90) {
    out.push({
      id: 'pending', weight: 80, tone: 'warn',
      text: <><b>{fmtInt(open)}</b> receipt{open === 1 ? ' was' : 's were'} scanned before the bin confirmed {open === 1 ? 'it' : 'them'} and {open === 1 ? 'is' : 'are'} still unconfirmed.</>,
      action: action('smartbins', 'Smart bin locations'),
    });
  }
  const backup = rate('tk_backup_share');
  if (backup && (Number(backup.numerator) || 0) > 0) {
    out.push({
      id: 'backup', weight: 70, tone: 'warn',
      text: <><b>{fmtInt(backup.numerator)}</b> payout{backup.numerator === 1 ? '' : 's'} came from backup codes, so the bin was offline at some point.</>,
      action: action('backupcups', 'Backup cups'),
    });
  }
  const email = rate('tk_email_capture');
  if (email && finite(email.value) && email.denominator >= 10) {
    if (email.value < 25) {
      out.push({ id: 'email', weight: 60, tone: 'warn', text: <>Only <b>{fmtRate(email.value)}</b> of scanned receipts led to an email you can reach.</> });
    } else if (email.value >= 50) {
      out.push({ id: 'email', weight: 40, tone: 'up', text: <><b>{fmtRate(email.value)}</b> of scanned receipts led to an email you can reach.</> });
    }
  }
  const accounts = rate('tk_account_conv');
  if (accounts && finite(accounts.value) && accounts.denominator >= 10) {
    out.push({ id: 'accounts', weight: 28, tone: 'info', text: <><b>{fmtRate(accounts.value)}</b> of new profiles saved an email and became an account.</> });
  }
  const rejected = Number(rate('tk_cookie_rejected')?.rawValue) || 0;
  if (rejected >= 3) {
    out.push({
      id: 'cookies', weight: 34, tone: 'info',
      text: <><b>{fmtInt(rejected)}</b> scanners turned essential cookies off. Their receipts still work if they scan again.</>,
    });
  }
  return out;
}

/* What stands out in the period, most important first. `canOpen(tab)`
 * says whether a page link may be offered to this viewer. */
export function buildInsights({ metrics, win, tikkie, canOpen, onNavigate }) {
  const byId = Object.fromEntries(metrics.map(m => [m.id, m]));
  const vs = win.prev ? win.prev.replace(/^vs /, 'against the ') : '';
  const action = (tab, label) => (onNavigate && canOpen?.(tab) ? { label, onClick: () => onNavigate(tab) } : undefined);
  const out = [
    ...(vs ? movementInsights(metrics, vs) : []),
    ...(tikkie ? tikkieInsights(byId, action) : standardInsights(byId, buildFunnels(byId), action)),
  ];
  return out.sort((a, b) => b.weight - a.weight).slice(0, 5);
}
