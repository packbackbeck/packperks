import {
  Activity, Blocks, Building2, CircleCheck, CircleDashed, CircleX, ClipboardCheck, CopyCheck, Database,
  Fingerprint, Hash, Link2, Link2Off, OctagonAlert, Printer, QrCode, ReceiptText, Recycle, ScanLine,
  ServerCrash, TriangleAlert, UserX,
} from 'lucide-react';
import { Badge } from '../ui/primitives';
import {
  bucketStart, fmtDec, fmtInt, pctChange, previousSeriesFor, seriesFor,
} from '../ui/timeSeries';

/* ─────────────────────────────────────────────────────────────────────
 * System health numbers, built from what getStatsMetrics (or, for
 * Deferred Tikkie venues, getTikkieStatsMetrics) returns. Pure functions:
 * the page decides the period and fetches the data.
 *
 * The readers score each check for the whole period, but only hand back
 * their rows inside `details[check].rows`, with the time already formatted
 * by toLocaleString('en-GB'). The day-by-day lines are rebuilt by reading
 * those times back. `timeSeries` (UTC days) is the fallback, and the only
 * source for Deferred Tikkie, whose reader returns no rows.
 * ───────────────────────────────────────────────────────────────────── */

export const BANDS = {
  go:   { label: 'Healthy',      tone: 'emerald', badge: 'success', icon: CircleCheck,   rank: 0 },
  cond: { label: 'Needs a look', tone: 'amber',   badge: 'warning', icon: TriangleAlert, rank: 1 },
  nogo: { label: 'Failing',      tone: 'rose',    badge: 'danger',  icon: OctagonAlert,  rank: 2 },
  na:   { label: 'Not measured', tone: 'slate',   badge: 'neutral', icon: CircleDashed,  rank: -1 },
};
export const bandMeta = (band) => BANDS[band] || BANDS.na;

export function statusBadge(band) {
  const b = bandMeta(band);
  return <Badge tone={b.badge} icon={b.icon}>{b.label}</Badge>;
}

/* 97.3%, 100%, never a rounded-up 100% or a rounded-down 0%. */
export function fmtRate(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  if (v > 0 && v < 0.05) return '<0.1%';
  if (v < 100 && v >= 99.95) return '99.9%';
  const r = Math.round(v * 10) / 10;
  return `${Number.isInteger(r) ? r.toFixed(0) : r.toFixed(1)}%`;
}

export function goalText(lower, t) {
  if (!t) return '';
  if (lower) {
    const ok = t.go === 0 ? 'Healthy at 0%' : `Healthy at ${t.go}% or less`;
    return `${ok}, needs a look up to ${t.condHigh}%, failing above ${t.condHigh}%.`;
  }
  const ok = t.go === 100 ? 'Healthy only at 100%' : `Healthy at ${t.go}% or more`;
  return `${ok}, needs a look from ${t.condLow}%, failing below ${t.condLow}%.`;
}

export function goalShort(lower, t) {
  if (!t) return '—';
  if (lower) return t.go === 0 ? '0%' : `${t.go}% or less`;
  return t.go === 100 ? '100%' : `${t.go}% or more`;
}

/* The line the chart draws. A 0% goal would sit on the axis, so for
 * those the line marks where failing starts. */
function targetFor(lower, t) {
  if (!t) return {};
  if (lower) {
    return t.go === 0
      ? { target: t.condHigh, targetLabel: `Failing above ${t.condHigh}%` }
      : { target: t.go, targetLabel: `Healthy up to ${t.go}%` };
  }
  return { target: t.go, targetLabel: t.go === 100 ? 'Healthy at 100%' : `Healthy from ${t.go}%` };
}

export const plural = (n, word) => (n === 1 ? word : `${word}s`);

/* "in the last 30 days" / "today" / "so far" — the period as a phrase. */
export function inPeriod(range) {
  if (range?.id === 'today') return 'today';
  if (range?.id === 'all' || !range?.noun) return 'so far';
  return `in the ${range.noun}`;
}

/* "against the prior 30 days" / "against yesterday". */
function againstPrev(range) {
  if (!range?.prev) return '';
  return range.id === 'today' ? 'against yesterday' : range.prev.replace(/^vs /, 'against the ');
}
const lowerFirst = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/* ── Errors ────────────────────────────────────────────────────────── */

const ERROR_NAMES = {
  already_claimed: 'Receipt already used',
  batch_not_found: 'Unknown receipt',
  batch_revoked: 'Receipt cancelled',
  batch_expired: 'Receipt expired',
  invalid_uuid: 'Unreadable QR code',
  no_cups: 'Empty QR code',
  too_many: 'Too many cups',
  db_error: 'Database error',
  balance_update_failed: 'Balance not updated',
  survivor_update_failed: 'Account merge not saved',
  merge_balance_failed: 'Merged balance not updated',
  update_failed: 'Update failed',
  photo_download_failed: 'Photo download failed',
  claim_update_failed: 'Claim not updated',
  no_tool_use: 'AI gave no verdict',
  anthropic_error: 'AI service error',
};

const ERROR_WHY = {
  already_claimed: 'That is the system refusing a receipt that was already used, as it should.',
  batch_expired: 'Expected: the receipt was scanned after it ran out.',
  batch_revoked: 'Expected: the receipt was cancelled before it was scanned.',
  batch_not_found: 'The QR code doesn’t match any printed receipt.',
  invalid_uuid: 'The QR code couldn’t be read.',
};

export function errorName(code) {
  if (!code) return 'Unknown error';
  if (ERROR_NAMES[code]) return ERROR_NAMES[code];
  const s = String(code).replace(/_/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function errorWhy(e) {
  return ERROR_WHY[e.code]
    || (e.critical ? 'This is a fault on our side, not a customer mistake.' : 'The system turned the scan away, as designed.');
}

export function buildErrorRows(raw) {
  return (raw?.errorBreakdown || []).map(e => ({ ...e, name: errorName(e.code) }));
}

/* ── Reading the reader's rows back ────────────────────────────────── */

const GB_TIME = /(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/;
function parseGbTime(s) {
  const m = GB_TIME.exec(String(s ?? ''));
  if (!m) return NaN;
  return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0)).getTime();
}

/* "19/08/2026, 17:00:40" → "19 Aug, 17:00" (with the year when it isn't this one). */
export function prettyRowTime(s) {
  const t = parseGbTime(s);
  if (!Number.isFinite(t)) return s;
  const d = new Date(t);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleString('en-GB', {
    day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }), hour: '2-digit', minute: '2-digit',
  });
}

// Setup-uptime rows name their hour in UTC: "2026-09-16 15:00".
const UTC_HOUR = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):00$/;
function parseUtcHour(s) {
  const m = UTC_HOUR.exec(String(s ?? ''));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4]) : NaN;
}

// timeSeries days are UTC dates. Noon UTC falls on the same calendar day
// in every European time zone, so the day lands in the right local bucket.
function utcDayNoon(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? ''));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], 12) : NaN;
}

const SCAN_KEYED = ['correct_org', 'cup_count', 'uid_reg', 'critical_err'];

/* One reader result → rows with a numeric time (`_t`) per check. */
export function prepareHealth(raw, { isTikkie } = {}) {
  if (!raw) return null;
  const out = { raw, totals: raw.totals || {}, rows: {}, broken: {}, ts: [], earliestMs: null };
  let earliest = raw.totals?.firstScan ? new Date(raw.totals.firstScan).getTime() : Infinity;
  if (!Number.isFinite(earliest)) earliest = Infinity;

  out.ts = (raw.timeSeries || [])
    .map(d => ({ ...d, _t: utcDayNoon(d.date) }))
    .filter(d => Number.isFinite(d._t));

  if (!isTikkie) {
    const scanTimes = new Map();
    const attach = (id, timeOf, track = false) => {
      const list = raw.details?.[id]?.rows || [];
      const rows = [];
      for (const r of list) {
        const t = timeOf(r);
        if (!Number.isFinite(t)) continue;
        rows.push({ id: r.id, state: r.state, status: r.cells?.status, code: r.cells?.code, _t: t });
        if (track && t < earliest) earliest = t;
      }
      out.rows[id] = rows;
      // Rows that exist but can't be dated: leave the line off rather than draw zeros.
      if (list.length && !rows.length) out.broken[id] = true;
    };
    attach('qr_scan', (r) => {
      const t = parseGbTime(r.cells?.time);
      if (Number.isFinite(t)) scanTimes.set(r.id, t);
      return t;
    });
    const scanTime = (r) => scanTimes.get(r.id) ?? parseGbTime(r.cells?.time);
    for (const id of SCAN_KEYED) attach(id, scanTime);
    attach('completeness', (r) => parseGbTime(r.cells?.time));
    attach('qr_gen', (r) => parseGbTime(r.cells?.time), true);
    attach('uptime', (r) => parseUtcHour(r.cells?.hour));
  }
  out.earliestMs = Number.isFinite(earliest) ? earliest : null;
  return out;
}

const isProxy = (id, P) => /^proxy/i.test(P?.raw?.details?.[id]?.summary || '');

/* ── Series ────────────────────────────────────────────────────────── */

const tOf = (r) => r._t;
const all = () => true;
const isOk = (r) => r.state === 'ok';
const isBad = (r) => r.state === 'bad';
const notExcluded = (r) => r.state !== 'excluded';

const counts = (rows, range, pred = all) => seriesFor(rows, tOf, range, r => (pred(r) ? 1 : 0));
const prevCounts = (rows, range, pred = all) => (
  rows && range.prevFromMs != null ? previousSeriesFor(rows, tOf, range, r => (pred(r) ? 1 : 0)) : null
);

/* Two count series → a rate per bucket. The shared chart can't leave a
 * gap, so a bucket with no activity repeats the one before it (for an
 * error rate: 0%, as nothing went wrong). */
function ratio(num, den, lower) {
  if (!num || !den) return null;
  const raw = num.map((p, i) => {
    const d = den[i]?.value || 0;
    return { t: p.t, value: d ? Math.round((p.value / d) * 1000) / 10 : null };
  });
  const first = raw.find(p => p.value != null);
  if (!first) return null;
  let last = first.value;
  return raw.map((p) => {
    if (p.value != null) { last = p.value; return p; }
    return { t: p.t, value: lower ? 0 : last };
  });
}

function checkSeries(spec, P, Q, range, lower) {
  if (!spec || !P) return {};
  const numKey = spec.rows;
  const denKey = spec.denRows || spec.rows;
  if (P.broken[numKey] || P.broken[denKey] || !P.rows[numKey] || !P.rows[denKey]) return {};
  const num = spec.num || isOk;
  const den = spec.den || all;
  const series = ratio(counts(P.rows[numKey], range, num), counts(P.rows[denKey], range, den), lower);
  let previousSeries = null;
  if (Q && !Q.broken[numKey] && !Q.broken[denKey] && Q.rows[numKey] && Q.rows[denKey]) {
    previousSeries = ratio(prevCounts(Q.rows[numKey], range, num), prevCounts(Q.rows[denKey], range, den), lower);
  }
  return { series, previousSeries };
}

function dailySeries(P, Q, range, pick) {
  if (range.granularity === 'hour') return {};
  return {
    series: seriesFor(P.ts, tOf, range, pick),
    previousSeries: Q && range.prevFromMs != null ? previousSeriesFor(Q.ts, tOf, range, pick) : null,
  };
}

function tikkieRateSeries(pick, P, Q, range, lower) {
  if (!pick || range.granularity === 'hour') return {};
  const total = (d) => d.total;
  const series = ratio(seriesFor(P.ts, tOf, range, pick), seriesFor(P.ts, tOf, range, total), lower);
  const previousSeries = Q && range.prevFromMs != null
    ? ratio(previousSeriesFor(Q.ts, tOf, range, pick), previousSeriesFor(Q.ts, tOf, range, total), lower)
    : null;
  return { series, previousSeries };
}

function countSeries(spec, P, Q, range) {
  if (!spec || !P) return {};
  if (spec.rows && P.rows[spec.rows] && !P.broken[spec.rows]) {
    const pred = spec.pred || all;
    const prevOk = Q && Q.rows[spec.rows] && !Q.broken[spec.rows];
    return {
      series: counts(P.rows[spec.rows], range, pred),
      previousSeries: prevOk ? prevCounts(Q.rows[spec.rows], range, pred) : null,
    };
  }
  return spec.ts ? dailySeries(P, Q, range, spec.ts) : {};
}

/* ── What each tile is ─────────────────────────────────────────────── */

const SCANS = ['scan', 'scans'];
const RECEIPTS = ['receipt', 'receipts'];
const PAYOUTS = ['payout', 'payouts'];
const HOURS = ['busy hour', 'busy hours'];
const NO_LINE = ' It is worked out for the period as a whole, so it has no line on the chart.';

const noScans = () => 'No scans in this period';
const noReceipts = () => 'No receipts scanned in this period';
const noPayouts = () => 'No payouts asked for in this period';

const CHECKS = {
  qr_scan: {
    label: 'Scan success', icon: ScanLine, tab: 'cupscans', per: SCANS,
    description: 'Scans that added cups to a balance',
    info: 'Of the receipts customers scanned, the share that added cups. Repeat scans of a receipt that was already used are left out: Duplicate protection covers those.',
    how: 'Scans that added cups ÷ all scans, repeat scans left out',
    why: 'A failed scan sends a customer home without their cups.',
    empty: (T) => (T.totalScans ? 'Only repeat scans in this period' : 'No scans in this period'),
    series: { rows: 'qr_scan', num: isOk, den: notExcluded },
  },
  critical_err: {
    label: 'System errors', icon: ServerCrash, tab: 'cupscans', per: SCANS,
    description: 'Scans that broke on our side',
    info: 'The share of scans that failed because something broke, such as saving the scan or updating the balance. Expected refusals, like an expired receipt, don’t count.',
    how: 'Scans that broke on our side ÷ all scans',
    why: 'Each one is a customer who did everything right and still got nothing.',
    empty: noScans,
    series: { rows: 'critical_err', num: isBad, denRows: 'qr_scan', den: all },
  },
  stuck: {
    label: 'Customers stuck', icon: UserX, tab: 'users', per: ['customer', 'customers'],
    description: 'Tried to scan, never got a cup in',
    info: 'Of the customers who tried to scan, the share who never got a single scan through. People who only opened the app are not counted.',
    how: 'Customers whose scans never went through ÷ customers who tried',
    howProxy: 'Customers whose every scan failed ÷ customers who scanned',
    why: 'Stuck customers are the most likely to give up on the programme.',
    empty: () => 'Nobody tried to scan in this period',
    series: null,
    noLine: true,
  },
  uptime: {
    label: 'Uptime', icon: Activity, tab: 'cupscans', per: HOURS,
    description: 'Busy hours without a system error',
    info: 'Of the hours with at least one scan, the share without a system error. An estimate: true uptime needs regular health pings.',
    how: 'Hours with scans and no system error ÷ hours with scans',
    why: 'An hour with a system error is an hour customers couldn’t rely on the setup.',
    empty: noScans,
    series: { rows: 'uptime', num: isOk, den: all },
  },
  qr_gen: {
    label: 'QR codes created', icon: Printer, tab: 'cupqr', per: ['print request', 'print requests'],
    description: 'Receipt codes created without an error',
    info: 'Every printed receipt carries a batch of QR codes. This is the share of print requests that produced them.',
    how: 'Print requests that produced codes ÷ all print requests',
    why: 'When this fails, receipts print without a working code.',
    empty: () => 'No receipts printed in this period',
    series: { rows: 'qr_gen', num: isOk, den: all },
  },
  cup_count: {
    label: 'Correct cup count', icon: Hash, tab: 'cupscans', per: SCANS,
    description: 'Scans that added all their cups',
    info: 'Of the scans that added cups, the share that added all the cups on the receipt, not just some.',
    how: 'Scans that added every cup ÷ scans that added cups',
    why: 'A short count gives customers fewer cups than they returned.',
    empty: (T) => (T.totalScans ? 'No scan added cups in this period' : 'No scans in this period'),
    series: { rows: 'cup_count', num: isOk, den: all },
  },
  correct_org: {
    label: 'Correct venue', icon: Building2, tab: 'cupscans', per: SCANS,
    description: 'Scans that opened the right venue',
    info: 'Every receipt belongs to one venue. This checks that scanning it opened that venue’s page. Scans whose cups were deleted later can’t be checked and are left out.',
    how: 'Scans on the right venue’s page ÷ scans that could be checked',
    why: 'A scan on the wrong venue puts cups in the wrong programme.',
    empty: (T) => (T.totalScans ? 'No scan could be checked in this period' : 'No scans in this period'),
    series: { rows: 'correct_org', num: isOk, den: notExcluded },
  },
  uid_reg: {
    label: 'Linked to a customer', icon: Fingerprint, tab: 'cupscans', per: SCANS,
    description: 'Scans saved to a customer account',
    info: 'The share of scans saved against a customer account, so the cups end up in someone’s balance.',
    how: 'Scans with a customer account ÷ all scans',
    why: 'A scan without a customer is a cup nobody can spend.',
    empty: noScans,
    series: { rows: 'uid_reg', num: isOk, den: all },
  },
  completeness: {
    label: 'Scans recorded', icon: Database, per: SCANS,
    description: 'App scans the server saved',
    info: 'The app notes every scan it sends. This checks that the server saved each one, so the numbers on this dashboard are complete.',
    how: 'Scans the server saved ÷ scans the app sent',
    howProxy: 'Saved scans with every detail filled in ÷ all saved scans',
    why: 'Missing scans make every other number on this page less reliable.',
    empty: noScans,
    series: { rows: 'completeness', num: isOk, den: all },
  },
  duplicate: {
    label: 'Duplicate protection', icon: CopyCheck, tab: 'cupscans', per: ['cup', 'cups'],
    description: 'Cups added to a balance only once',
    info: 'Checks that no cup was added to a balance twice. Scanning a receipt that was already used should be refused.',
    how: 'Cups added exactly once ÷ all cups added',
    why: 'A cup added twice is a reward paid for nothing.',
    empty: () => 'No cups added in this period',
    series: null,
    noLine: true,
  },

  /* Deferred Tikkie */
  tk_mint: {
    label: 'Payout links created', icon: Link2, tab: 'tikkielog', per: PAYOUTS,
    description: 'Payouts that got a Tikkie link',
    info: 'Customers collect their wallet as one Tikkie link. Of the payouts they asked for, the share that got a working link. Receipts from before the wallet each had their own link and count as a payout here.',
    how: 'Payouts with a Tikkie link ÷ payouts asked for',
    why: 'Without a link the customer can’t collect their refund.',
    empty: noPayouts,
    daily: (d) => d.success,
  },
  tk_mint_fail: {
    label: 'Link failure rate', icon: TriangleAlert, tab: 'tikkielog', per: PAYOUTS,
    description: 'Share of payouts whose link failed',
    info: 'Of the payouts customers asked for, the share where creating the Tikkie link failed. The money goes back to the wallet, so they can try again.',
    how: 'Payouts whose link failed ÷ payouts asked for',
    why: 'A failed link holds up the refund until the customer tries again.',
    empty: noPayouts,
    daily: (d) => d.failed,
  },
  tk_pending: {
    label: 'Bin confirmations', icon: ClipboardCheck, per: ['early scan', 'early scans'],
    description: 'Early scans the bin confirmed later',
    info: 'Sometimes a customer scans a receipt before the smart bin has sent its session. This is the share of those early scans the bin confirmed afterwards.',
    how: 'Early scans the bin confirmed ÷ early scans',
    why: 'A low rate means the bin is losing sessions: receipts print but never get paid.',
    empty: () => 'No receipt was scanned before the bin sent it',
    daily: null,
    noLine: true,
  },
  tk_backup: {
    label: 'Backup codes used', icon: Blocks, tab: 'backupcups', per: RECEIPTS,
    description: 'Payouts from the bin’s offline codes',
    info: 'When the smart bin is offline it prints reserved backup codes. Any use means the bin lost its connection at some point.',
    how: 'Payouts from backup codes ÷ receipts scanned',
    why: 'Backup codes mean the bin was offline.',
    empty: noReceipts,
    daily: null,
    noLine: true,
  },
  tk_uptime: {
    label: 'Payout uptime', icon: Activity, tab: 'tikkielog', per: HOURS,
    description: 'Busy hours without a failed link',
    info: 'Of the hours with at least one receipt or payout, the share without a failed Tikkie link. An estimate: true uptime needs regular health pings.',
    how: 'Hours with activity and no failed link ÷ hours with activity',
    why: 'An hour with failed links is an hour customers waited for their money.',
    empty: noReceipts,
    daily: null,
    noLine: true,
  },
};

const COUNTS = {
  scans: {
    label: 'Scans', icon: QrCode, tone: 'violet',
    description: 'Every receipt scan, good or bad',
    info: 'Every time a customer scanned a receipt QR code in this period, including repeat scans and scans that were turned away.',
    value: (T) => T.totalScans,
    series: { rows: 'qr_scan', ts: (d) => d.total },
  },
  failed: {
    label: 'Failed scans', icon: CircleX, tone: 'orange', invertGood: true,
    description: 'Scans that added no cups',
    info: 'Scans that were turned away: an expired receipt, a receipt that was already used, or a scan that broke on our side. The error log below lists the reasons.',
    value: (T) => T.failed,
    series: { rows: 'qr_scan', pred: (r) => r.status === 'failed', ts: (d) => d.failed },
  },
  receipts: {
    label: 'Receipts scanned', icon: ReceiptText, tone: 'violet',
    description: 'Bin receipts added to a wallet',
    info: 'Every smart-bin receipt a customer scanned in this period.',
    value: (T) => T.totalScans,
    series: { ts: (d) => d.receipts ?? d.total },
  },
  failed_links: {
    label: 'Failed payout links', icon: Link2Off, tone: 'orange', invertGood: true,
    description: 'Payouts whose Tikkie link failed',
    info: 'Payouts where creating the Tikkie payment link returned an error. The money goes back to the customer’s wallet, so they can try again.',
    value: (T) => T.failed,
    series: { ts: (d) => d.failed },
  },
  sessions: {
    label: 'Bin sessions', icon: Recycle, tone: 'teal', noLine: true,
    description: 'Times the smart bin was used',
    info: 'Each time a customer uses the smart bin, it sends a session and prints a receipt. Not every customer scans the receipt straight away, so this can be higher than receipts scanned.',
    value: (T) => T.batchesGenerated,
    series: null,
  },
};

/* Tile order: what answers "is it working?" first. The checks list
 * below the chart keeps the readers' own order. */
const STANDARD_ORDER = [
  'qr_scan', 'scans', 'failed', 'critical_err',
  'stuck', 'uptime', 'qr_gen', 'cup_count',
  'correct_org', 'uid_reg', 'completeness', 'duplicate',
];
const TIKKIE_ORDER = [
  'tk_mint', 'receipts', 'failed_links', 'tk_mint_fail',
  'tk_pending', 'tk_backup', 'tk_uptime', 'sessions',
];

/* A plain line under a check, from the numbers behind it. */
function checkNote(id, m, P) {
  const rows = P?.raw?.details?.[id]?.rows || [];
  const n = (state) => rows.filter(r => r.state === state).length;
  switch (id) {
    case 'qr_scan': {
      const k = n('excluded');
      return k ? `${fmtInt(k)} repeat ${plural(k, 'scan')} of used receipts ${k === 1 ? 'is' : 'are'} left out. Duplicate protection covers them.` : null;
    }
    case 'correct_org': {
      const wrong = n('bad');
      const gone = n('excluded');
      const bits = [];
      if (wrong) bits.push(`${fmtInt(wrong)} ${plural(wrong, 'scan')} opened another venue.`);
      if (gone) bits.push(`${fmtInt(gone)} ${gone === 1 ? 'scan can’t' : 'scans can’t'} be checked because the cups were deleted later.`);
      return bits.join(' ') || null;
    }
    case 'duplicate': {
      const refused = (P?.raw?.details?.qr_scan?.rows || []).filter(r => r.state === 'excluded').length;
      const twice = n('bad');
      return `${fmtInt(refused)} repeat ${plural(refused, 'scan')} refused; ${twice ? `${fmtInt(twice)} ${plural(twice, 'cup')} added more than once.` : 'no cup added twice.'}`;
    }
    case 'critical_err': {
      const crit = n('bad');
      const expected = n('ok');
      if (!crit && !expected) return null;
      return `${fmtInt(expected)} ${plural(expected, 'scan')} turned away for expected reasons, ${crit ? `${fmtInt(crit)} because something broke` : 'none because something broke'}.`;
    }
    case 'completeness':
      return isProxy(id, P) ? 'An estimate until the app notes every scan it sends.' : null;
    case 'stuck':
      return isProxy(id, P) ? 'An estimate until the app notes scan attempts: it counts customers whose every scan failed.' : null;
    case 'uptime':
    case 'tk_uptime':
      return 'An estimate: true uptime needs regular health pings.';
    case 'tk_mint_fail':
      return m.numerator > 0 ? 'The money went back to the wallet, so the customer can try again.' : null;
    case 'tk_pending':
      return m.denominator > 0 ? 'Low means the bin is losing sessions: receipts print but never get confirmed.' : null;
    case 'tk_backup':
      return m.numerator > 0 ? 'Above zero means the bin was offline at some point.' : null;
    default:
      return null;
  }
}

function checkMetric(id, def, { m, pm, P, Q, range, deltaLabel, isTikkie }) {
  const band = m?.band || 'na';
  const meta = bandMeta(band);
  const value = m && band !== 'na' && Number.isFinite(m.value) ? m.value : null;
  const prevValue = pm && pm.band !== 'na' && Number.isFinite(pm.value) ? pm.value : null;
  const lower = !!m?.lowerIsBetter;
  const thresholds = m?.thresholds || null;
  const how = isProxy(id, P) && def.howProxy ? def.howProxy : def.how;
  let lines = {};
  if (value != null && P) {
    lines = isTikkie
      ? tikkieRateSeries(def.daily, P, Q, range, lower)
      : checkSeries(def.series, P, Q, range, lower);
  }
  const per = def.per || SCANS;
  const countText = m?.denominator
    ? `${fmtInt(m.numerator)} of ${fmtInt(m.denominator)} ${m.denominator === 1 ? per[0] : per[1]}`
    : null;
  return {
    id,
    kind: 'check',
    label: def.label,
    icon: def.icon,
    tone: meta.tone,
    unit: 'pct',
    value,
    format: fmtRate,
    // Rounded so a change too small to show reads "0.0 pts", not "−0.0 pts".
    delta: value != null && prevValue != null ? Math.round((value - prevValue) * 10) / 10 || 0 : null,
    deltaLabel,
    invertGood: lower,
    description: def.description,
    unavailable: value == null ? def.empty(P?.totals || {}) : null,
    info: (
      <>
        {def.info}
        {def.noLine ? NO_LINE : ''}
        {thresholds && <span className="hl-tip__goal">{goalText(lower, thresholds)}</span>}
      </>
    ),
    formula: countText ? `${countText} · ${how}` : how,
    footnote: statusBadge(band),
    series: lines.series || undefined,
    previousSeries: lines.previousSeries || undefined,
    ...targetFor(lower, thresholds),
    // Used by the page, not the kit.
    band,
    lower,
    thresholds,
    how,
    why: def.why,
    tab: def.tab || null,
    note: m ? checkNote(id, m, P) : null,
    countText,
    perLabel: per[1].charAt(0).toUpperCase() + per[1].slice(1),
    numerator: m?.numerator ?? null,
    denominator: m?.denominator ?? null,
    prevDenominator: pm?.denominator ?? null,
  };
}

function countMetric(id, def, { P, Q, range, deltaLabel }) {
  const value = P ? def.value(P.totals) ?? null : null;
  const prevValue = Q ? def.value(Q.totals) ?? null : null;
  const lines = value != null ? countSeries(def.series, P, Q, range) : {};
  return {
    id,
    kind: 'count',
    label: def.label,
    icon: def.icon,
    tone: def.tone,
    unit: 'count',
    value,
    format: fmtInt,
    // Nothing in either period: no change worth printing.
    delta: value === 0 && prevValue === 0 ? null : pctChange(value, prevValue),
    deltaLabel,
    invertGood: !!def.invertGood,
    description: def.description,
    info: def.noLine ? `${def.info}${NO_LINE}` : def.info,
    series: lines.series || undefined,
    previousSeries: lines.previousSeries || undefined,
  };
}

/* cur / prev: prepareHealth() results for the period and the one before. */
export function buildHealthMetrics({ cur, prev, range, isTikkie }) {
  const byId = Object.fromEntries((cur?.raw?.metrics || []).map(m => [m.id, m]));
  const prevById = Object.fromEntries((prev?.raw?.metrics || []).map(m => [m.id, m]));
  const deltaLabel = range?.prev || '';
  return (isTikkie ? TIKKIE_ORDER : STANDARD_ORDER).map(id => (COUNTS[id]
    ? countMetric(id, COUNTS[id], { P: cur, Q: prev, range, deltaLabel })
    : checkMetric(id, CHECKS[id], { m: byId[id], pm: prevById[id], P: cur, Q: prev, range, deltaLabel, isTikkie })));
}

/* The checks in the reader's own order (the order of the test plan). */
export function orderedChecks(cur, metrics) {
  const byId = Object.fromEntries(metrics.map(m => [m.id, m]));
  const ids = (cur?.raw?.metrics || []).map(m => m.id).filter(id => byId[id]);
  return ids.length ? ids.map(id => byId[id]) : metrics.filter(m => m.kind === 'check');
}

/* ── Insights ──────────────────────────────────────────────────────── */

const HOUR = 60 * 60 * 1000;

function peakTime(t, granularity) {
  const d = new Date(t);
  if (granularity === 'hour') return <>at <b>{String(d.getHours()).padStart(2, '0')}:00</b></>;
  if (granularity === 'week') return <>in the <b>week of {d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</b></>;
  if (granularity === 'month') return <>in <b>{d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</b></>;
  return <>on <b>{d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</b></>;
}

const PER = { hour: 'an hour', day: 'a normal day', week: 'a normal week', month: 'a normal month' };

function ago(ms, now) {
  const h = Math.floor((now - ms) / HOUR);
  if (h < 48) return `${h} hours ago`;
  return `${Math.floor(h / 24)} days ago`;
}

function mostCommon(list) {
  const c = new Map();
  for (const x of list) if (x) c.set(x, (c.get(x) || 0) + 1);
  let best = null;
  for (const [k, v] of c) if (!best || v > best[1]) best = [k, v];
  return best ? best[0] : null;
}

function list(names) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/* What stands out in the period, most important first.
 *   onInspect(id)        opens the rows behind a check
 *   onNavigate(tab)      opens another page; tabLabel(tab) names it
 *   canOpen(tab)         whether this account and venue have that page
 *   onScroll(elementId)  jumps to a section on this page */
export function buildHealthInsights({
  cur, prev, ai, metrics, range, isTikkie, groupScope, now,
  onInspect, onNavigate, canOpen, tabLabel, onScroll,
}) {
  if (!cur) return [];
  const out = [];
  const T = cur.totals || {};
  const details = cur.raw?.details || {};
  const checks = metrics.filter(m => m.kind === 'check');
  const measured = checks.filter(m => m.band !== 'na');
  const failing = checks.filter(m => m.band === 'nogo');
  const watch = checks.filter(m => m.band === 'cond');
  const unmeasured = checks.filter(m => m.band === 'na');
  const when = inPeriod(range);
  const against = againstPrev(range);
  const scanWord = isTikkie ? 'receipt' : 'scan';
  const nav = (tab) => (tab && onNavigate && canOpen?.(tab)
    ? { label: tabLabel?.(tab) || 'Open', onClick: () => onNavigate(tab) }
    : undefined);
  const inspect = (id, label) => ((details[id]?.rows?.length && onInspect)
    ? { label, onClick: () => onInspect(id) }
    : undefined);
  const volume = (
    <>
      {fmtInt(T.totalScans || 0)} {plural(T.totalScans || 0, scanWord)} from {fmtInt(T.attemptingUsers || 0)}{' '}
      {plural(T.attemptingUsers || 0, isTikkie ? 'account' : 'customer')}
    </>
  );

  // 1. The overall verdict: the worst measured check decides it.
  const verdict = cur.raw?.verdict || 'na';
  if (verdict === 'go') {
    out.push({
      id: 'verdict', weight: 100, tone: 'up',
      text: <><b>All {measured.length} {measured.length < checks.length ? 'measured ' : ''}checks are healthy</b>, across {volume} {when}.</>,
    });
  } else if (verdict === 'nogo') {
    out.push({
      id: 'verdict', weight: 100, tone: 'down',
      text: (
        <>
          <b>{failing.length} {plural(failing.length, 'check')} {failing.length === 1 ? 'is' : 'are'} failing</b>
          {watch.length ? <> and {watch.length} {watch.length === 1 ? 'needs' : 'need'} a look</> : null}, across {volume} {when}. Start with the red ones.
        </>
      ),
    });
  } else if (verdict === 'cond') {
    out.push({
      id: 'verdict', weight: 100, tone: 'warn',
      text: <><b>Nothing is failing</b>, but {watch.length} {plural(watch.length, 'check')} {watch.length === 1 ? 'needs' : 'need'} a look, across {volume} {when}.</>,
    });
  } else {
    out.push({
      id: 'verdict', weight: 100, tone: 'info',
      text: <><b>Not enough activity to judge</b> the setup {when}. The checks fill in as {isTikkie ? 'receipts are scanned' : 'customers scan'}.</>,
    });
  }

  // 2. The checks that are off, worst first.
  const gap = (m) => {
    const t = m.thresholds || {};
    return m.lower ? m.value - t.go : t.go - m.value;
  };
  [...failing, ...watch]
    .sort((a, b) => (bandMeta(b.band).rank - bandMeta(a.band).rank) || (gap(b) - gap(a)))
    .slice(0, 3)
    .forEach((m, i) => {
      const t = m.thresholds || {};
      const goal = m.lower
        ? (t.go === 0 ? 'where it should be 0%' : `above the ${t.go}% it should stay under`)
        : (t.go === 100 ? 'where it should be 100%' : `below the ${t.go}% it should reach`);
      const flagged = (details[m.id]?.rows || []).filter(r => r.state === 'bad').length;
      out.push({
        id: `check-${m.id}`,
        weight: (m.band === 'nogo' ? 96 : 82) - i,
        tone: m.band === 'nogo' ? 'down' : 'warn',
        text: <><b>{m.label}</b> is at <b>{fmtRate(m.value)}</b>, {goal}. {m.why}</>,
        action: inspect(m.id, flagged ? `Inspect ${fmtInt(flagged)} flagged` : 'Inspect') || nav(m.tab),
      });
    });

  // 3. Nothing coming in.
  if (range.id !== 'all' && range.id !== 'today') {
    const prevTotal = prev?.totals?.totalScans || 0;
    const lastMs = T.lastScan ? new Date(T.lastScan).getTime() : null;
    const hint = isTikkie
      ? 'Check that the smart bin is online and printing.'
      : 'If the venue is open, check the receipt printer and the QR codes.';
    const silenceTab = isTikkie ? 'backupcups' : 'cupqr';
    if (!T.totalScans && prevTotal > 0) {
      out.push({
        id: 'silence', weight: 93, tone: 'warn',
        text: <><b>No {scanWord}s {when}</b>, against {fmtInt(prevTotal)} {range.prev.replace(/^vs /, 'in the ')}. {hint}</>,
        action: nav(silenceTab),
      });
    } else if (lastMs && now - lastMs >= 24 * HOUR) {
      const long = now - lastMs >= 72 * HOUR;
      out.push({
        id: 'silence', weight: long ? 74 : 30, tone: long ? 'warn' : 'info',
        text: (
          <>
            The last {scanWord} came in <b>{ago(lastMs, now)}</b>, on{' '}
            {new Date(lastMs).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.
            {long ? <> {hint}</> : null}
          </>
        ),
        action: long ? nav(silenceTab) : undefined,
      });
    }
  }

  // 4. A day (or hour) with far more errors than usual.
  const errorsLog = onScroll ? { label: 'Error log', onClick: () => onScroll('hl-errors') } : undefined;
  if (range.granularity !== 'hour' || !isTikkie) {
    let perBucket = null;
    let rowsInBucket = () => [];
    if (!isTikkie && cur.rows.critical_err && !cur.broken.critical_err) {
      const errRows = cur.rows.critical_err;
      perBucket = seriesFor(errRows, tOf, range);
      rowsInBucket = (t) => errRows.filter(r => bucketStart(r._t, range.granularity) === t);
    } else if (isTikkie && cur.ts.length) {
      perBucket = seriesFor(cur.ts, tOf, range, d => d.failed);
    }
    if (perBucket && perBucket.length >= 3) {
      const total = perBucket.reduce((s, p) => s + p.value, 0);
      const peak = perBucket.reduce((a, p) => (p.value > a.value ? p : a), perBucket[0]);
      const typical = (total - peak.value) / (perBucket.length - 1);
      const rounded = Math.round(typical * 10) / 10;
      if (peak.value >= Math.max(4, typical * 3)) {
        const inPeak = rowsInBucket(peak.t);
        const critical = isTikkie || inPeak.some(isBad);
        const topCode = isTikkie ? cur.raw?.errorBreakdown?.[0]?.code : mostCommon(inPeak.map(r => r.code));
        const what = isTikkie ? plural(peak.value, 'failed link') : `turned-away ${plural(peak.value, 'scan')}`;
        out.push({
          id: 'spike', weight: critical ? 88 : 62, tone: critical ? 'down' : 'warn',
          text: (
            <>
              {isTikkie ? 'Failed links' : 'Errors'} peaked {peakTime(peak.t, range.granularity)} with <b>{fmtInt(peak.value)}</b> {what}, against{' '}
              {rounded < 1 ? 'less than one' : `about ${Number.isInteger(rounded) ? rounded : fmtDec(rounded, 1)}`} on {PER[range.granularity] || PER.day}.
              {topCode ? <> Most were <b>{errorName(topCode)}</b>.</> : null}
            </>
          ),
          action: errorsLog,
        });
      }
    }
  }

  // 5. Failed scans against the period before.
  const failedM = metrics.find(m => m.id === (isTikkie ? 'failed_links' : 'failed'));
  const prevFailed = prev?.totals?.failed ?? null;
  if (failedM?.delta != null && range.prev && prevFailed != null
    && Math.abs(failedM.delta) >= 25 && Math.max(failedM.value || 0, prevFailed) >= 5) {
    const up = failedM.delta > 0;
    out.push({
      id: 'failed-trend', weight: up ? 58 : 32, tone: up ? 'down' : 'up',
      text: <>{failedM.label} {up ? 'rose' : 'fell'} <b>{Math.abs(failedM.delta).toFixed(0)}%</b> {against}, to <b>{fmtInt(failedM.value)}</b>.</>,
    });
  }

  // 6. The most common reason something was turned away.
  const errs = cur.raw?.errorBreakdown || [];
  const allErrors = errs.reduce((s, e) => s + e.count, 0);
  if (errs.length && allErrors >= 3) {
    const top = errs[0];
    const share = Math.round((top.count / allErrors) * 100);
    out.push({
      id: 'top-error', weight: top.critical && !isTikkie ? 86 : isTikkie ? 55 : 34, tone: top.critical ? 'down' : 'info',
      text: isTikkie
        ? <>Most failed links report <b>{errorName(top.code)}</b>: {fmtInt(top.count)} of {fmtInt(allErrors)} ({share}%).</>
        : <><b>{errorName(top.code)}</b> is the most common reason a scan is turned away: {fmtInt(top.count)} of {fmtInt(allErrors)} ({share}%). {errorWhy(top)}</>,
      action: errorsLog,
    });
  }

  // 7. Checks that moved a lot while staying healthy.
  // Only on enough rows in both periods: a handful of scans moves a rate a lot.
  const moved = measured.filter(m => m.delta != null && m.band === 'go' && range.prev
    && m.denominator >= 20 && m.prevDenominator >= 20);
  const slipping = moved
    .map(m => ({ m, bad: m.lower ? m.delta : -m.delta }))
    .filter(x => x.bad >= 2)
    .sort((a, b) => b.bad - a.bad)[0];
  if (slipping) {
    out.push({
      id: 'slipping', weight: 50, tone: 'info',
      text: <><b>{slipping.m.label}</b> slipped {slipping.bad.toFixed(1)} points {against}. Still healthy, but worth watching.</>,
    });
  }
  const improving = moved
    .map(m => ({ m, good: m.lower ? -m.delta : m.delta }))
    .filter(x => x.good >= 2)
    .sort((a, b) => b.good - a.good)[0];
  if (improving) {
    out.push({
      id: 'improving', weight: 28, tone: 'up',
      text: <><b>{improving.m.label}</b> improved {improving.good.toFixed(1)} points {against}.</>,
    });
  }

  if (!isTikkie) {
    // 8. Repeat scans refused, nothing credited twice.
    const refused = (details.qr_scan?.rows || []).filter(r => r.state === 'excluded').length;
    const twice = (details.duplicate?.rows || []).filter(isBad).length;
    if (refused > 0 && twice === 0) {
      out.push({
        id: 'duplicates', weight: 20, tone: 'up',
        text: <><b>{fmtInt(refused)} repeat {plural(refused, 'scan')}</b> of used receipts {refused === 1 ? 'was' : 'were'} refused, and no cup was added twice.</>,
      });
    }

    // 9. A few stuck customers, even when the rate is fine.
    const stuck = metrics.find(m => m.id === 'stuck');
    if (stuck?.band === 'go' && stuck.numerator > 0) {
      out.push({
        id: 'stuck-few', weight: 44, tone: 'info',
        text: <><b>{fmtInt(stuck.numerator)} {plural(stuck.numerator, 'customer')}</b> tried to scan and never got a cup in. Worth a follow-up if they left an email.</>,
        action: inspect('stuck', 'See who'),
      });
    }

    // 10. The receipt AI against the reviewers.
    const aiLink = onScroll ? { label: 'AI accuracy', onClick: () => onScroll('hl-ai') } : undefined;
    if (ai && !ai.total) {
      out.push({
        id: 'ai-none', weight: 14, tone: 'info',
        text: <>The receipt AI can’t be scored yet: no claim {when === 'so far' ? 'has been' : `${when} was`} reviewed check by check.</>,
        action: nav('claims'),
      });
    } else if (ai?.total) {
      const rate = ai.overallRate;
      const worst = (ai.perCriterion || []).find(c => c.inPlay >= 3 && c.rate != null && c.rate < 70);
      const leaning = worst
        ? (worst.aiFalsePos > worst.aiFalseNeg ? ', mostly by flagging receipts the reviewer passed'
          : worst.aiFalseNeg > 0 ? ', mostly by missing problems the reviewer found' : '')
        : '';
      out.push({
        id: 'ai', weight: rate < 60 ? 76 : worst ? 52 : 38, tone: rate >= 85 ? 'up' : rate >= 60 ? 'info' : 'warn',
        text: (
          <>
            The receipt AI agreed with reviewers on <b>{rate}%</b> of {fmtInt(ai.total)} reviewed {plural(ai.total, 'claim')}
            {groupScope ? ' across the group' : ''}.
            {worst ? <> It disagrees most on <b>{worst.label}</b> ({worst.rate}%){leaning}.</> : null}
          </>
        ),
        action: aiLink,
      });
    }
  }

  // 11. Checks with nothing to measure.
  if (verdict !== 'na' && unmeasured.length) {
    const names = unmeasured.length <= 2
      ? unmeasured.map(m => `${m.label} (${lowerFirst(m.unavailable)})`)
      : unmeasured.map(m => m.label);
    out.push({
      id: 'unmeasured', weight: 26, tone: 'info',
      text: <><b>{unmeasured.length} {plural(unmeasured.length, 'check')}</b> can’t be measured {when}: {list(names)}.</>,
    });
  }

  return out.sort((a, b) => b.weight - a.weight).slice(0, 5);
}
