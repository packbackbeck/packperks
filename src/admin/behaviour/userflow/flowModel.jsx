import {
  Clock, Footprints, Hand, MousePointer2, MousePointerClick,
  MoveVertical, PointerOff, Rows3, ScanEye, Timer, Zap,
} from 'lucide-react';
import { fmtDuration } from '../../lib/behaviourFormat';
import { fmtDec, fmtInt, formatBucket } from '../../ui/timeSeries';
import { screenName } from '../behaviourCopy';
import { fmtRate } from '../behaviourModel';

/* ─────────────────────────────────────────────────────────────────────
 * User flow tiles.
 *
 * Two sources meet here, and the tab is honest about which is which:
 *
 *   • Four tiles moved off the main tab — App opens, Time per visit,
 *     Button taps, Where visits end. They are built by behaviourModel
 *     from client_events, cover every consented visit, and arrive here
 *     already shaped; this file only re-groups them.
 *   • The rest are built below from `ux_sessions` — the visits capture
 *     actually recorded. That is a subset (capture can be sampled, or
 *     switched off for a while), which is why "Visits captured" sits at
 *     the top of the tab: it says how much of the programme the numbers
 *     underneath are speaking for.
 *
 * Series are per bucket, not cumulative: a point is what happened in
 * those days, which is what you want when the question is "did the new
 * button change anything".
 * ───────────────────────────────────────────────────────────────────── */

const DAY = 24 * 60 * 60 * 1000;
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const pct = (n, d) => (d > 0 ? (n / d) * 100 : null);
const avg = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null);

/* The four tiles that came off the main tab, and the sections the tab
 * lays everything out in. */
export const MOVED_METRIC_IDS = ['avg_session', 'button_clicks', 'entry_source', 'last_screen'];
export const MOVED_BREAKDOWN_IDS = ['button_clicks', 'entry_source'];

export const FLOW_GROUPS = [
  { id: 'visits', title: 'Visits', desc: 'How much of a visit the app gets, and where it ends.' },
  { id: 'taps', title: 'Taps', desc: 'What customers reach for, how long it takes them, and what missed.' },
  { id: 'reading', title: 'Reading the screen', desc: 'How far down a screen customers actually get.' },
];

/* ── Buckets ───────────────────────────────────────────────────────── */

/* ~16 evenly spaced, day-aligned buckets across the window, as the main
 * tab uses. A point is the bucket, not a running total. */
export function flowBuckets(fromMs, toMs) {
  if (!(finite(fromMs) && finite(toMs) && toMs > fromMs)) return [];
  const days = (toMs - fromMs) / DAY;
  const stepDays = Math.max(1, Math.ceil(days / 16));
  const step = stepDays * DAY;
  const out = [];
  for (let t = fromMs; t < toMs; t += step) {
    out.push({ startMs: t, endMs: Math.min(toMs, t + step) });
  }
  return out.length ? out : [{ startMs: fromMs, endMs: toMs }];
}

/* ── One metric ────────────────────────────────────────────────────── */

const FORMATS = {
  count: fmtInt,
  pct: fmtRate,
  ratio: (v) => fmtDec(v, 1),
  minutes: (v) => (finite(v) ? fmtDuration(v * 60000) : '—'),
};

function durationTick(minutes) {
  if (!finite(minutes)) return '';
  const sec = minutes * 60;
  if (sec < 90) return `${Math.round(sec)}s`;
  if (minutes < 90) return `${Math.round(minutes)}m`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1440)}d`;
}

/* A tile in the shape KpiTile and TrendCard already understand. */
function tile({
  id, group, label, icon, tone, kind, value, describe, info, formula,
  good = 'up', series = [], prevValue = null, prevLabel = '', empty, text,
}) {
  const format = kind === 'text' ? () => (text ? screenName(text) : '—') : FORMATS[kind] || fmtInt;
  const defined = series.filter(p => p.value != null);
  let delta = null;
  let footnote;
  if (finite(value) && finite(prevValue) && !(value === 0 && prevValue === 0)) {
    const change = kind === 'pct'
      ? value - prevValue
      : (prevValue === 0 ? null : ((value - prevValue) / Math.abs(prevValue)) * 100);
    const d = finite(change) ? Math.round(change * 10) / 10 + 0 : null;
    if (finite(d)) {
      if (good) delta = d;
      else {
        const abs = Math.abs(d);
        footnote = abs < 0.05
          ? `No change ${prevLabel}`
          : `${d > 0 ? '+' : '−'}${kind === 'pct' ? `${abs.toFixed(1)} pts` : `${abs >= 10 ? abs.toFixed(0) : abs.toFixed(1)}%`} ${prevLabel}`;
      }
    }
  }
  const missing = kind === 'text' ? !text : !finite(value);
  return {
    id,
    group,
    label,
    icon,
    tone,
    kind,
    unit: kind === 'text' ? 'text' : kind,
    value: kind === 'text' ? (missing ? null : 1) : (missing ? null : value),
    format,
    axisFormat: kind === 'minutes' ? durationTick : kind === 'ratio' ? (v) => fmtDec(v, 1) : undefined,
    delta,
    deltaLabel: prevLabel,
    invertGood: good === 'down',
    neutral: !good,
    footnote,
    description: missing ? (empty || 'Nothing captured in this period yet.') : describe,
    info,
    formula,
    unavailable: missing ? (empty || 'Nothing captured in this period yet.') : null,
    chartable: kind !== 'text' && defined.length > 0,
    running: false,
    series: defined,
    points: series,
    prevPoints: null,
    breakdown: null,
    screen: kind === 'text' ? text : null,
    basis: {},
    text,
  };
}

/* ── Every number a set of visits carries ──────────────────────────── */

function summarise(sessions) {
  const n = sessions.length;
  const taps = sessions.reduce((s, v) => s + (Number(v.clicks) || 0), 0);
  const rage = sessions.reduce((s, v) => s + (Number(v.rage) || 0), 0);
  const dead = sessions.reduce((s, v) => s + (Number(v.dead) || 0), 0);
  const screens = sessions.reduce((s, v) => s + (Number(v.screens) || 0), 0);
  const firstTaps = sessions.map(v => Number(v.first_tap_ms)).filter(finite);
  const scrolls = sessions.map(v => Number(v.max_scroll)).filter(finite);
  const noTap = sessions.filter(v => !(Number(v.clicks) > 0)).length;
  const bottom = sessions.filter(v => Number(v.max_scroll) >= 0.9).length;
  return {
    n,
    taps,
    rage,
    dead,
    screens,
    tapsPerVisit: n ? taps / n : null,
    screensPerVisit: n ? screens / n : null,
    firstTapMin: firstTaps.length ? avg(firstTaps) / 60000 : null,
    scrollPct: scrolls.length ? avg(scrolls) * 100 : null,
    noTapPct: pct(noTap, n),
    bottomPct: pct(bottom, n),
    ragePct: pct(rage, taps),
    deadPct: pct(dead, taps),
  };
}

const inBucket = (sessions, startMs, endMs) => sessions.filter((v) => {
  const t = Date.parse(v.started_at);
  return finite(t) && t >= startMs && t < endMs;
});

/**
 * buildFlowMetrics — the tab's own tiles.
 *
 * @param sessions  ux_sessions rows for the window
 * @param targets   ux_targets rows (for "most tapped" / "slowest to reach")
 * @param prev      the same two for the window before, or null
 * @param win       the resolved window, for buckets and the delta label
 * @param appOpens  App opens in this window, so coverage has a denominator
 */
export function buildFlowMetrics({ sessions = [], targets = [], prev = null, win, appOpens = null }) {
  const cur = summarise(sessions);
  const before = prev ? summarise(prev.sessions || []) : null;
  const prevLabel = win?.prev || '';
  const fromMs = win?.fromMs ?? (sessions.length ? Math.min(...sessions.map(s => Date.parse(s.started_at))) : null);
  const toMs = win?.toMs ?? Date.now();
  const buckets = flowBuckets(fromMs, toMs);

  /* One pass over the buckets gives every tile its line. */
  const series = (pick) => buckets.map((b) => {
    const s = summarise(inBucket(sessions, b.startMs, b.endMs));
    const v = pick(s);
    return { t: b.startMs, endMs: b.endMs, value: finite(v) ? Math.round(v * 100) / 100 : null };
  });

  const top = targets.find(t => Number(t.taps) > 0) || null;
  // The control people take longest to reach, out of the ones enough
  // visits touched for a median to mean anything.
  const slow = [...targets]
    .filter(t => finite(Number(t.median_ms)) && Number(t.sessions) >= 5)
    .sort((a, b) => Number(b.median_ms) - Number(a.median_ms))[0] || null;

  const coverage = pct(cur.n, appOpens);

  return [
    tile({
      id: 'flow_captured', group: 'visits', label: 'Visits captured',
      icon: ScanEye, tone: 'violet', kind: 'count', value: cur.n,
      describe: finite(coverage)
        ? `${fmtRate(coverage)} of ${fmtInt(appOpens)} app opens`
        : `${fmtInt(cur.n)} visits with taps recorded`,
      info: 'Visits where taps and scrolling were recorded. Only customers who turned the Analytical cookie category on are captured, and capture can be sampled or switched off, so this is the share of the programme every other number on this tab speaks for.',
      formula: 'count of captured visits',
      series: series(s => s.n), prevValue: before?.n ?? null, prevLabel,
      empty: 'No visit was captured in this period.',
    }),
    tile({
      id: 'flow_screens', group: 'visits', label: 'Screens per visit',
      icon: Rows3, tone: 'sky', kind: 'ratio', value: cur.screensPerVisit,
      describe: `${fmtInt(cur.screens)} screen views across ${fmtInt(cur.n)} visits`,
      info: 'How many screens a customer opens in one visit. One means they saw the first screen and left.',
      formula: 'screen views ÷ captured visits',
      good: null,
      series: series(s => s.screensPerVisit), prevValue: before?.screensPerVisit ?? null, prevLabel,
    }),
    tile({
      id: 'flow_taps', group: 'taps', label: 'Taps per visit',
      icon: MousePointer2, tone: 'violet', kind: 'ratio', value: cur.tapsPerVisit,
      describe: `${fmtInt(cur.taps)} taps across ${fmtInt(cur.n)} visits`,
      info: 'Every tap, not only the ones on a named button. A visit that taps a lot is either engaged or lost — the heatmap below says which.',
      formula: 'taps ÷ captured visits',
      good: null,
      series: series(s => s.tapsPerVisit), prevValue: before?.tapsPerVisit ?? null, prevLabel,
    }),
    tile({
      id: 'flow_first_tap', group: 'taps', label: 'Time to first tap',
      icon: Timer, tone: 'amber', kind: 'minutes', value: cur.firstTapMin,
      describe: `Average across ${fmtInt(sessions.filter(v => finite(Number(v.first_tap_ms))).length)} visits`,
      info: 'How long a customer looks at the app before touching anything. Long means the first screen is not making the next step obvious.',
      formula: 'average of (first tap − visit start)',
      good: 'down',
      series: series(s => s.firstTapMin), prevValue: before?.firstTapMin ?? null, prevLabel,
      empty: 'No captured visit had a tap in this period.',
    }),
    tile({
      id: 'flow_no_tap', group: 'taps', label: 'Visits with no tap',
      icon: PointerOff, tone: 'slate', kind: 'pct', value: cur.noTapPct,
      describe: `${fmtInt(sessions.filter(v => !(Number(v.clicks) > 0)).length)} of ${fmtInt(cur.n)} visits`,
      info: 'Visits where the customer touched nothing at all. They opened the app, looked, and left.',
      formula: 'visits with no tap ÷ captured visits',
      good: 'down',
      series: series(s => s.noTapPct), prevValue: before?.noTapPct ?? null, prevLabel,
    }),
    tile({
      id: 'flow_dead', group: 'taps', label: 'Taps that did nothing',
      icon: Hand, tone: 'orange', kind: 'pct', value: cur.deadPct,
      describe: `${fmtInt(cur.dead)} of ${fmtInt(cur.taps)} taps`,
      info: 'Taps that landed on something that is not a control — a picture that looks pressable, a number the customer expected to open. Each one is a small disappointment, and the heatmap shows where they cluster.',
      formula: 'taps outside a control ÷ all taps',
      good: 'down',
      series: series(s => s.deadPct), prevValue: before?.deadPct ?? null, prevLabel,
    }),
    tile({
      id: 'flow_rage', group: 'taps', label: 'Rage taps',
      icon: Zap, tone: 'rose', kind: 'pct', value: cur.ragePct,
      describe: `${fmtInt(cur.rage)} of ${fmtInt(cur.taps)} taps`,
      info: 'Three taps in one spot inside a second and a bit: the customer pressed, nothing happened, and they pressed again. Anything above zero is worth opening.',
      formula: 'repeated taps on one spot ÷ all taps',
      good: 'down',
      series: series(s => s.ragePct), prevValue: before?.ragePct ?? null, prevLabel,
    }),
    tile({
      id: 'flow_top_target', group: 'taps', label: 'Most tapped',
      icon: MousePointerClick, tone: 'emerald', kind: 'text',
      text: top?.label || null, value: top ? Number(top.taps) : null,
      describe: top ? `${fmtInt(top.taps)} taps, ${fmtInt(top.sessions)} visits` : '',
      info: 'The control customers reach for most often in this period.',
      formula: 'the control with the most taps',
      good: null,
      empty: 'No tap on a named control yet.',
    }),
    tile({
      id: 'flow_slow_target', group: 'taps', label: 'Slowest to reach',
      icon: Clock, tone: 'amber', kind: 'text',
      text: slow?.label || null, value: slow ? Number(slow.median_ms) : null,
      describe: slow ? `Typically ${fmtDuration(Number(slow.median_ms))} after the screen opens` : '',
      info: 'Of the controls at least five visits used, the one customers take longest to find after the screen appears. A slow control is usually one that is below the fold or does not look pressable.',
      formula: 'highest median time from screen view to tap (5+ visits)',
      good: null,
      empty: 'No control has enough visits to time yet.',
    }),
    tile({
      id: 'flow_scroll', group: 'reading', label: 'Scroll reach',
      icon: MoveVertical, tone: 'teal', kind: 'pct', value: cur.scrollPct,
      describe: `Average deepest point across ${fmtInt(sessions.filter(v => finite(Number(v.max_scroll))).length)} visits`,
      info: 'How far down the page a visit gets at its deepest, averaged. Fifty per cent means the average visit never saw the bottom half.',
      formula: 'average of each visit’s deepest scroll',
      good: 'up',
      series: series(s => s.scrollPct), prevValue: before?.scrollPct ?? null, prevLabel,
    }),
    tile({
      id: 'flow_bottom', group: 'reading', label: 'Reached the bottom',
      icon: Footprints, tone: 'lime', kind: 'pct', value: cur.bottomPct,
      describe: `${fmtInt(sessions.filter(v => Number(v.max_scroll) >= 0.9).length)} of ${fmtInt(cur.n)} visits`,
      info: 'Visits that scrolled to within a tenth of the end of a page. Anything you put at the bottom is seen by this many people.',
      formula: 'visits reaching 90% down ÷ captured visits',
      good: 'up',
      series: series(s => s.bottomPct), prevValue: before?.bottomPct ?? null, prevLabel,
    }),
  ];
}

/* Placeholder tiles, so the grid has its shape before the first load. */
export function flowSkeleton() {
  return buildFlowMetrics({ sessions: [], targets: [], win: null, appOpens: null })
    .map(m => ({ ...m, value: null, delta: null, description: undefined, unavailable: null, series: [], points: [] }));
}

/* The chart's own labels. Every flow series is per bucket. */
export function flowChartRange(win, metrics, activeIds) {
  const from = win?.fromMs ?? null;
  const to = win?.toMs ?? Date.now();
  const days = finite(from) && finite(to) ? (to - from) / DAY : 0;
  const step = Math.max(1, Math.ceil(days / 16));
  const granularity = step >= 15 ? 'month' : step >= 3 ? 'week' : 'day';
  const first = metrics.find(m => m.chartable && activeIds.includes(m.id));
  let detail = '';
  if (first?.kind === 'count') detail = step === 1 ? 'per day' : `per ${step} days`;
  else if (first) detail = step === 1 ? 'each day' : `each ${step} days`;
  return {
    fromMs: from, toMs: to, granularity, stepDays: step, detail,
    label: finite(from) ? `${formatBucket(from, 'day')} – ${formatBucket(to, 'day')}` : '',
  };
}

/* ── Insights ──────────────────────────────────────────────────────── */

/** What is worth saying about this period, most important first. */
export function buildFlowInsights({ metrics, screens = [], targets = [], config, phrase }) {
  const byId = Object.fromEntries(metrics.map(m => [m.id, m]));
  const out = [];
  const v = (id) => byId[id]?.value;

  if (config && config.enabled === false) {
    out.push({
      id: 'off', tone: 'warn',
      text: <>Capture is switched off, so nothing new is being recorded. What is on screen is whatever was captured before it was turned off.</>,
    });
  } else if (config && Number(config.sample) < 100) {
    out.push({
      id: 'sample', tone: 'info',
      text: <>Capture is sampled at <strong>{config.sample}%</strong> of visits, so every count here is roughly that share of the real thing. Rates and averages are unaffected.</>,
    });
  }

  const rage = v('flow_rage');
  if (finite(rage) && rage >= 1) {
    const worst = [...screens].sort((a, b) => Number(b.rage) - Number(a.rage))[0];
    out.push({
      id: 'rage', tone: 'warn',
      text: <><strong>{fmtRate(rage)}</strong> of taps were the same spot pressed again in frustration{worst && Number(worst.rage) > 0 ? <> — most of them on <strong>{screenName(worst.screen)}</strong></> : null}. Something there looks pressable and is not reacting.</>,
    });
  }

  const dead = v('flow_dead');
  if (finite(dead) && dead >= 8) {
    const worst = [...screens].sort((a, b) => Number(b.dead) - Number(a.dead))[0];
    out.push({
      id: 'dead', tone: 'warn',
      text: <>About <strong>{fmtRate(dead)}</strong> of taps hit something that does nothing{worst ? <>, mostly on <strong>{screenName(worst.screen)}</strong></> : null}. Usually a picture or a number that reads as a button.</>,
    });
  }

  const noTap = v('flow_no_tap');
  if (finite(noTap) && noTap >= 35) {
    out.push({
      id: 'notap', tone: 'down',
      text: <><strong>{fmtRate(noTap)}</strong> of captured visits {phrase} touched nothing at all. The first screen is being read and abandoned.</>,
    });
  }

  const scroll = v('flow_scroll');
  const bottom = v('flow_bottom');
  if (finite(scroll) && scroll < 45) {
    out.push({
      id: 'scroll', tone: 'info',
      text: <>The average visit gets <strong>{fmtRate(scroll)}</strong> of the way down{finite(bottom) ? <>, and only {fmtRate(bottom)} reach the bottom</> : null}. Anything below that line is effectively unpublished.</>,
    });
  }

  const slow = byId.flow_slow_target;
  if (slow?.text && finite(slow.value) && slow.value > 8000) {
    out.push({
      id: 'slow', tone: 'info',
      text: <><strong>{slow.text}</strong> takes about {fmtDuration(slow.value)} to be found after its screen opens. Moving it up is usually worth more than relabelling it.</>,
    });
  }

  const exits = [...screens].filter(s => Number(s.exits) > 0)
    .sort((a, b) => Number(b.exits) - Number(a.exits))[0];
  if (exits && Number(exits.exits) >= 5) {
    const share = pct(Number(exits.exits), screens.reduce((s, x) => s + Number(x.exits || 0), 0));
    out.push({
      id: 'exit', tone: 'info',
      text: <><strong>{screenName(exits.screen)}</strong> ends {finite(share) ? fmtRate(share) : 'most'} of captured visits. That is where to look first for the step people give up on.</>,
    });
  }

  const untouched = targets.filter(t => Number(t.taps) > 0 && Number(t.sessions) <= 2);
  if (untouched.length >= 3) {
    out.push({
      id: 'quiet', tone: 'info',
      text: <><strong>{untouched.length}</strong> controls were tapped by two visits or fewer {phrase}. Worth asking whether they earn their place on the screen.</>,
    });
  }

  return out.slice(0, 6);
}
