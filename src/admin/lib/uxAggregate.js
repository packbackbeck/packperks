/* ─────────────────────────────────────────────────────────────────────
 * uxAggregate — the same sums the database does, in JavaScript.
 *
 * User flow reads its heavy numbers from SQL (ux_screen_summary,
 * ux_heatmap, ux_scroll_curve, ux_targets, ux_flow — migration 061):
 * a busy screen is tens of thousands of taps, and nobody should pull
 * those over the wire to count them.
 *
 * "Demo numbers" has no database to ask, so it fabricates rows like the
 * rest of demoData and hands them here. Every function below returns
 * exactly the shape its SQL twin returns, so the page downstream cannot
 * tell the two apart — and a change to one is a visible mismatch with
 * the other rather than a silent drift.
 * ───────────────────────────────────────────────────────────────────── */

const CLICK_KINDS = new Set(['click', 'rage', 'dead']);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/** Keep the rows a window and a device filter allow through. */
export function uxSlice(events, sessions, { from, to, device } = {}) {
  const fromMs = from ? Date.parse(from) : null;
  const toMs = to ? Date.parse(to) : null;
  const allowed = device
    ? new Set(sessions.filter(s => s.device === device).map(s => s.session_id))
    : null;
  return events.filter((e) => {
    const t = Date.parse(e.at);
    if (!Number.isFinite(t)) return false;
    if (fromMs != null && t < fromMs) return false;
    if (toMs != null && t >= toMs) return false;
    return !allowed || allowed.has(e.session_id);
  });
}

/** ux_screen_summary: one row per screen, busiest first. */
export function uxScreenSummary(events) {
  const bySession = new Map();
  for (const e of events) {
    if (!bySession.has(e.session_id)) bySession.set(e.session_id, []);
    bySession.get(e.session_id).push(e);
  }
  // Dwell: from a screen view until the next view, or until the visit ends.
  const dwell = new Map();
  for (const list of bySession.values()) {
    const marks = list.filter(e => e.kind === 'view' || e.kind === 'leave')
      .sort((a, b) => a.seq - b.seq);
    for (let i = 0; i < marks.length - 1; i++) {
      if (marks[i].kind !== 'view') continue;
      const ms = Date.parse(marks[i + 1].at) - Date.parse(marks[i].at);
      if (!(ms > 0) || ms >= 1800000) continue;
      const cur = dwell.get(marks[i].screen) || { sum: 0, n: 0 };
      cur.sum += ms; cur.n += 1;
      dwell.set(marks[i].screen, cur);
    }
  }
  const rows = new Map();
  for (const e of events) {
    let r = rows.get(e.screen);
    if (!r) {
      r = { screen: e.screen, views: 0, sessions: new Set(), clicks: 0, rage: 0, dead: 0, exits: 0, depthSum: 0, depthN: 0 };
      rows.set(e.screen, r);
    }
    r.sessions.add(e.session_id);
    if (e.kind === 'view') r.views += 1;
    if (CLICK_KINDS.has(e.kind)) r.clicks += 1;
    if (e.kind === 'rage') r.rage += 1;
    if (e.kind === 'dead') r.dead += 1;
    if (e.kind === 'leave') r.exits += 1;
    if (e.kind === 'scroll' && num(e.depth) != null) { r.depthSum += num(e.depth); r.depthN += 1; }
  }
  return [...rows.values()]
    .map(r => ({
      screen: r.screen,
      views: r.views,
      sessions: r.sessions.size,
      clicks: r.clicks,
      rage: r.rage,
      dead: r.dead,
      exits: r.exits,
      avg_dwell_ms: dwell.get(r.screen) ? dwell.get(r.screen).sum / dwell.get(r.screen).n : null,
      avg_scroll: r.depthN ? r.depthSum / r.depthN : null,
    }))
    .sort((a, b) => b.views - a.views || b.sessions - a.sessions);
}

/** ux_heatmap: taps summed into a grid of `cols` × `rows` cells. */
export function uxHeatmap(events, screen, cols = 36, rows = 64) {
  const cells = new Map();
  for (const e of events) {
    if (e.screen !== screen || !CLICK_KINDS.has(e.kind)) continue;
    const x = num(e.x); const y = num(e.y);
    if (x == null || y == null) continue;
    const cx = Math.min(cols - 1, Math.floor(x * cols));
    const cy = Math.min(rows - 1, Math.floor(y * rows));
    const k = `${cx}:${cy}`;
    let c = cells.get(k);
    if (!c) { c = { cx, cy, n: 0, sessions: new Set() }; cells.set(k, c); }
    c.n += 1;
    c.sessions.add(e.session_id);
  }
  return [...cells.values()].map(c => ({ cx: c.cx, cy: c.cy, n: c.n, sessions: c.sessions.size }));
}

/** ux_scroll_curve: the share of visits that reached each step down. */
export function uxScrollCurve(events, screen, steps = 20) {
  const deepest = new Map();
  for (const e of events) {
    if (e.screen !== screen) continue;
    if (e.kind !== 'scroll' && e.kind !== 'view') continue;
    const d = num(e.depth) || 0;
    deepest.set(e.session_id, Math.max(deepest.get(e.session_id) || 0, d));
  }
  const all = [...deepest.values()];
  const out = [];
  for (let i = 1; i <= steps; i++) {
    out.push({ step: i, reached: all.filter(d => d >= i / steps).length, total: all.length });
  }
  return out;
}

const median = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = s.length / 2;
  return s.length % 2 ? s[Math.floor(mid)] : (s[mid - 1] + s[mid]) / 2;
};
const quantile = (arr, q) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (pos - lo);
};
const commonest = (arr) => {
  const counts = new Map();
  for (const v of arr) if (v) counts.set(v, (counts.get(v) || 0) + 1);
  let best = null; let n = 0;
  for (const [v, c] of counts) if (c > n) { best = v; n = c; }
  return best;
};

/** ux_targets: every tracked control, with how long people take to reach it. */
export function uxTargets(events, { screen = null } = {}) {
  // Which tap was the first of its visit — the "opens with this" share.
  const firstSeq = new Map();
  for (const e of events) {
    if (!CLICK_KINDS.has(e.kind)) continue;
    const cur = firstSeq.get(e.session_id);
    if (cur == null || e.seq < cur) firstSeq.set(e.session_id, e.seq);
  }
  const rows = new Map();
  for (const e of events) {
    if (!CLICK_KINDS.has(e.kind) || !e.target) continue;
    if (screen && e.screen !== screen) continue;
    let r = rows.get(e.target);
    if (!r) {
      r = { target: e.target, labels: [], screens: [], taps: 0, sessions: new Set(), rage: 0, dead: 0, first_taps: 0, times: [], xs: [], ys: [] };
      rows.set(e.target, r);
    }
    r.taps += 1;
    r.sessions.add(e.session_id);
    r.labels.push(e.label);
    r.screens.push(e.screen);
    if (e.kind === 'rage') r.rage += 1;
    if (e.kind === 'dead') r.dead += 1;
    if (firstSeq.get(e.session_id) === e.seq) r.first_taps += 1;
    const t = num(e.t_ms);
    if (t != null && t >= 0) r.times.push(t);
    if (num(e.x) != null) r.xs.push(num(e.x));
    if (num(e.y) != null) r.ys.push(num(e.y));
  }
  const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
  return [...rows.values()]
    .map(r => ({
      target: r.target,
      label: commonest(r.labels) || r.target,
      screen: commonest(r.screens),
      taps: r.taps,
      sessions: r.sessions.size,
      rage: r.rage,
      dead: r.dead,
      first_taps: r.first_taps,
      median_ms: median(r.times),
      p90_ms: quantile(r.times, 0.9),
      avg_x: avg(r.xs),
      avg_y: avg(r.ys),
    }))
    .sort((a, b) => b.taps - a.taps);
}

/** ux_target_series: one control, day by day. */
export function uxTargetSeries(events, target) {
  const days = new Map();
  for (const e of events) {
    if (!CLICK_KINDS.has(e.kind) || e.target !== target) continue;
    const day = String(e.at).slice(0, 10);
    let d = days.get(day);
    if (!d) { d = { day, taps: 0, sessions: new Set(), times: [] }; days.set(day, d); }
    d.taps += 1;
    d.sessions.add(e.session_id);
    const t = num(e.t_ms);
    if (t != null && t >= 0) d.times.push(t);
  }
  return [...days.values()]
    .map(d => ({ day: d.day, taps: d.taps, sessions: d.sessions.size, median_ms: median(d.times) }))
    .sort((a, b) => (a.day < b.day ? -1 : 1));
}

/** ux_flow: screen to screen, busiest first. `(entry)` is where a visit starts. */
export function uxFlow(events) {
  const bySession = new Map();
  for (const e of events) {
    if (e.kind !== 'view') continue;
    if (!bySession.has(e.session_id)) bySession.set(e.session_id, []);
    bySession.get(e.session_id).push(e);
  }
  const edges = new Map();
  for (const list of bySession.values()) {
    list.sort((a, b) => a.seq - b.seq);
    let prev = null;
    for (const e of list) {
      if (prev === e.screen) continue;
      const k = `${prev || '(entry)'}\u0000${e.screen}`;
      edges.set(k, (edges.get(k) || 0) + 1);
      prev = e.screen;
    }
  }
  return [...edges.entries()]
    .map(([k, n]) => {
      const [from_screen, to_screen] = k.split('\u0000');
      return { from_screen, to_screen, n };
    })
    .sort((a, b) => b.n - a.n);
}
