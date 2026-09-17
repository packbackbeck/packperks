/* ─────────────────────────────────────────────────────────────────────
 * Periods, buckets and deltas for the stats pages.
 *
 * Every tile on Overview, System Health and User Behaviour shows a value
 * for the selected period and its change against the period just before
 * it, and every chart plots the same period in day (or hour, week, month)
 * buckets. Keeping that arithmetic here means the three pages agree.
 * Times are local to the browser, as the rest of the dashboard.
 * ───────────────────────────────────────────────────────────────────── */

const DAY = 24 * 60 * 60 * 1000;

export const PERIODS = [
  { id: 'today', label: 'Today',          short: 'Today', noun: 'today',              prev: 'vs yesterday' },
  { id: '7d',    label: 'Last 7 days',    short: '7D',    noun: 'last 7 days',        prev: 'vs prior 7 days',   days: 7 },
  { id: '14d',   label: 'Last 14 days',   short: '14D',   noun: 'last 14 days',       prev: 'vs prior 14 days',  days: 14 },
  { id: '30d',   label: 'Last 30 days',   short: '30D',   noun: 'last 30 days',       prev: 'vs prior 30 days',  days: 30 },
  { id: '90d',   label: 'Last 90 days',   short: '90D',   noun: 'last 90 days',       prev: 'vs prior 90 days',  days: 90 },
  { id: '12m',   label: 'Last 12 months', short: '12M',   noun: 'last 12 months',     prev: 'vs prior 12 months', days: 365 },
  { id: 'all',   label: 'All time',       short: 'All',   noun: 'all time',           prev: null },
];

export const periodById = (id) => PERIODS.find(p => p.id === id) || PERIODS[3];

/* The period as it reads inside a sentence: "returned today",
 * "claimed in the last 30 days", "returned since the start". */
export function periodPhrase(period) {
  if (!period) return 'in this period';
  if (period.id === 'today') return 'today';
  if (period.id === 'all') return 'since the start';
  return `in the ${period.noun}`;
}

function startOfDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfWeek(ms) {
  const d = new Date(startOfDay(ms));
  const dow = (d.getDay() + 6) % 7; // Monday first
  d.setDate(d.getDate() - dow);
  return d.getTime();
}

function startOfMonth(ms) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

function startOfHour(ms) {
  const d = new Date(ms);
  d.setMinutes(0, 0, 0);
  return d.getTime();
}

/* The selected window, its bucket size and the window before it.
 * `earliestMs` is the first recorded event, used by "All time". */
export function periodRange(periodId, { now = Date.now(), earliestMs = null } = {}) {
  const p = periodById(periodId);
  if (p.id === 'today') {
    const from = startOfDay(now);
    return {
      ...p, fromMs: from, toMs: now, granularity: 'hour',
      prevFromMs: from - DAY, prevToMs: from, days: 1,
    };
  }
  if (p.id === 'all') {
    const from = startOfDay(earliestMs ?? now - 90 * DAY);
    const days = Math.max(1, Math.ceil((now - from) / DAY));
    const granularity = days > 400 ? 'month' : days > 120 ? 'week' : 'day';
    return { ...p, fromMs: from, toMs: now, granularity, prevFromMs: null, prevToMs: null, days };
  }
  const from = startOfDay(now - (p.days - 1) * DAY);
  const span = now - from;
  const granularity = p.days > 120 ? 'week' : 'day';
  return {
    ...p, fromMs: from, toMs: now, granularity,
    prevFromMs: from - span, prevToMs: from, days: p.days,
  };
}

export function bucketStart(ms, granularity) {
  if (granularity === 'hour') return startOfHour(ms);
  if (granularity === 'week') return startOfWeek(ms);
  if (granularity === 'month') return startOfMonth(ms);
  return startOfDay(ms);
}

function nextBucket(ms, granularity) {
  const d = new Date(ms);
  if (granularity === 'hour') return ms + 60 * 60 * 1000;
  if (granularity === 'week') { d.setDate(d.getDate() + 7); return d.getTime(); }
  if (granularity === 'month') return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
  d.setDate(d.getDate() + 1);
  return d.getTime();
}

export function bucketStarts(fromMs, toMs, granularity) {
  const out = [];
  let t = bucketStart(fromMs, granularity);
  let guard = 0;
  while (t <= toMs && guard++ < 2000) {
    out.push(t);
    t = nextBucket(t, granularity);
  }
  return out;
}

const toMs = (v) => (v == null ? NaN : typeof v === 'number' ? v : new Date(v).getTime());

export const inWindow = (ms, from, to) => Number.isFinite(ms) && (from == null || ms >= from) && (to == null || ms <= to);

/* Rows → [{ t, value }] across the window. `value(row)` defaults to 1, so
 * the series counts rows; pass a function to sum an amount instead. */
export function seriesFor(rows, getTime, { fromMs, toMs: to, granularity }, value = () => 1) {
  const starts = bucketStarts(fromMs, to, granularity);
  const index = new Map(starts.map((t, i) => [t, i]));
  const vals = new Array(starts.length).fill(0);
  for (const r of rows || []) {
    const ms = toMs(getTime(r));
    if (!inWindow(ms, fromMs, to)) continue;
    const i = index.get(bucketStart(ms, granularity));
    if (i !== undefined) vals[i] += Number(value(r)) || 0;
  }
  return starts.map((t, i) => ({ t, value: vals[i] }));
}

/* The same series for the previous window, laid onto the current window's
 * buckets so the two lines share an x axis. */
export function previousSeriesFor(rows, getTime, range, value = () => 1) {
  if (range.prevFromMs == null) return null;
  const shift = range.fromMs - range.prevFromMs;
  const prev = seriesFor(rows, getTime, {
    fromMs: range.prevFromMs, toMs: range.prevToMs - 1, granularity: range.granularity,
  }, value);
  const cur = bucketStarts(range.fromMs, range.toMs, range.granularity);
  return cur.map((t, i) => ({ t, value: prev[i]?.value ?? 0, sourceT: prev[i]?.t ?? t - shift }));
}

/* Running total of a series (for "all customers so far" style lines). */
export function cumulative(series, start = 0) {
  let acc = start;
  return series.map(p => ({ ...p, value: (acc += p.value) }));
}

export function countIn(rows, getTime, from, to) {
  let n = 0;
  for (const r of rows || []) if (inWindow(toMs(getTime(r)), from, to)) n++;
  return n;
}

export function sumIn(rows, getTime, from, to, value) {
  let n = 0;
  for (const r of rows || []) if (inWindow(toMs(getTime(r)), from, to)) n += Number(value(r)) || 0;
  return n;
}

/* Percent change, or null when there is nothing to compare against. */
export function pctChange(cur, prev) {
  if (cur == null || prev == null || !Number.isFinite(cur) || !Number.isFinite(prev)) return null;
  if (prev === 0) return cur === 0 ? 0 : null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

export const isWeekend = (ms) => {
  const d = new Date(ms).getDay();
  return d === 0 || d === 6;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatBucket(t, granularity) {
  const d = new Date(t);
  if (granularity === 'hour') return `${String(d.getHours()).padStart(2, '0')}:00`;
  if (granularity === 'month') return `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function formatBucketFull(t, granularity) {
  const d = new Date(t);
  const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  if (granularity === 'hour') return `${day}, ${String(d.getHours()).padStart(2, '0')}:00`;
  if (granularity === 'week') return `Week of ${day}`;
  if (granularity === 'month') return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  return day;
}

export function formatWindow(fromMs, toMsValue) {
  const f = new Date(fromMs);
  const t = new Date(toMsValue);
  const sameYear = f.getFullYear() === t.getFullYear();
  const a = `${f.getDate()} ${MONTHS[f.getMonth()]}${sameYear ? '' : ` ${f.getFullYear()}`}`;
  const b = `${t.getDate()} ${MONTHS[t.getMonth()]} ${t.getFullYear()}`;
  return `${a} – ${b}`;
}

/* ── Number formats ────────────────────────────────────────────────── */
export const fmtInt = (v) => (v == null || !Number.isFinite(v) ? '—' : Math.round(v).toLocaleString('en-GB'));
export const fmtPct = (v, digits = 0) => (v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(digits)}%`);
export const fmtDec = (v, digits = 1) => (v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('en-GB', { maximumFractionDigits: digits, minimumFractionDigits: digits }));
export function fmtCompact(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (a >= 1e4) return `${(v / 1e3).toFixed(1).replace(/\.0$/, '')}k`;
  return Math.round(v).toLocaleString('en-GB');
}
export function fmtKg(grams) {
  if (grams == null || !Number.isFinite(grams)) return '—';
  if (grams >= 1e6) return `${(grams / 1e6).toFixed(2)} t`;
  if (grams >= 1000) return `${(grams / 1000).toFixed(grams >= 1e5 ? 0 : 1)} kg`;
  return `${Math.round(grams)} g`;
}
