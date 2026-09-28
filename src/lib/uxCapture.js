/* ─────────────────────────────────────────────────────────────────────
 * uxCapture — what a customer does inside a screen.
 *
 * The App knows which screen it is on; this knows where the thumb went.
 * Taps (with a position), how far the page was scrolled, which screen
 * ended the visit, and where the controls were while all that happened.
 * User analytics → User flow turns it into heatmaps, a button table and
 * a replay of one visit.
 *
 * CONSENT. Nothing is buffered, let alone sent, unless the customer
 * turned the Analytical cookie category on (`hasAnalyticsConsent`). The
 * same switch that gates client_events gates this, and turning it off
 * mid-visit stops it and throws the buffer away.
 *
 * WHAT IS NEVER RECORDED. No text anyone typed, no field contents, no
 * element contents beyond the visible name of a control, nothing from
 * inside a `[data-ppk-private]` subtree, and no pointer movement — a tap
 * is a position and the name of the button under it. Nothing leaves the
 * app except through `ux-ingest`, which checks it all again.
 *
 * WHAT IT COSTS. One delegated listener for taps, one throttled scroll
 * handler, and a flush every few seconds. Events batch; the last batch
 * leaves on `pagehide` as a beacon, so closing the tab still counts.
 *
 * Wiring: initUxCapture() once the org is known, uxScreen() on every
 * screen change, setUxUser() once the customer's row exists.
 * ───────────────────────────────────────────────────────────────────── */

import { supabase } from './supabase';
import { hasAnalyticsConsent } from './consent';
import { getEntryContext, getSessionId } from '../utils/analytics';
import {
  MAX_ELEMENTS, isPinned, isPrivate, keyFor, labelFor, pressableAncestor, pressableNodes,
} from './uxKeys';

const FLUSH_MS       = 5000;   // how often a non-empty buffer goes out
const FLUSH_AT       = 40;     // …or sooner, once this many are waiting
const MAX_BUFFER     = 400;    // a buffer that can't be sent stops growing
const SCROLL_MS      = 400;    // scroll sampling
const SCROLL_STEP    = 0.05;   // a new depth is worth a row every 5%
const LAYOUT_DELAY   = 700;    // let a screen settle before measuring it
const LAYOUT_SETTLE  = 3200;   // …and again, once its content has loaded
const RAGE_WINDOW_MS = 1200;   // three taps this close together…
const RAGE_RADIUS    = 44;     // …and this close on screen, is frustration
const RAGE_COUNT     = 3;
/* Session replay (rrweb). A recording is a copy of the screen, so it is
 * capped hard: a visit stops recording once it hits either limit and the
 * rest of the visit is still counted, just not filmed. */
const REPLAY_MAX_EVENTS = 2000;
const REPLAY_MAX_BYTES  = 600_000;
const REPLAY_FLUSH_MS   = 8000;
const REPLAY_FLUSH_AT   = 60;

const state = {
  on: false,
  orgId: null,
  mode: null,
  userId: null,
  config: null,        // null until ux-ingest answers
  pending: true,       // buffering while we wait for the answer
  seq: 0,
  buffer: [],
  layouts: [],
  screen: null,
  screenAt: 0,
  screenSeen: new Set(),
  screenViews: 0,
  layoutBest: {},      // screen → the most controls we have measured on it
  entry: null,
  scrollMax: 0,        // deepest scroll of this screen
  scrollSent: 0,
  sessionMaxScroll: 0,
  startedAt: 0,
  lastAt: 0,
  clicks: 0,
  rage: 0,
  dead: 0,
  firstTapMs: null,
  recent: [],          // the last few taps, for spotting a rage tap
  timer: null,
  layoutTimer: null,
  listeners: false,
  // rrweb
  rec: null,           // the recorder's stop() once it is running
  replay: [],          // events waiting to be sent
  replayCount: 0,      // how many this visit has recorded in total
  replayBytes: 0,
  replaySeq: 0,        // chunk number, so the player can order them
  replayTimer: null,
};

/* ── Small helpers ─────────────────────────────────────────────────── */

const clamp01 = (n) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : null);

/** mobile / tablet / desktop, by the width the app is actually drawn at. */
function deviceClass() {
  const w = window.innerWidth || 0;
  if (w < 768) return 'mobile';
  if (w < 1100) return 'tablet';
  return 'desktop';
}

function docHeight() {
  const d = document.documentElement;
  const b = document.body;
  return Math.max(
    d?.scrollHeight || 0, d?.offsetHeight || 0,
    b?.scrollHeight || 0, b?.offsetHeight || 0,
    window.innerHeight || 0,
  );
}

/** A percentage of visits, decided once from the session id so a visit is
 *  either recorded from its first tap or not at all. */
function inSample(sessionId, percent) {
  if (percent >= 100) return true;
  let h = 2166136261;
  for (let i = 0; i < sessionId.length; i++) {
    h ^= sessionId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100) < percent;
}

/* Where this visit came from, in the same words the App opens breakdown
 * uses. Read once, at start, while the cup deeplink is still in the URL. */
const MSG_REF = /whatsapp|wa\.me|telegram|t\.me|t\.co|instagram|facebook|fb\.|messenger|twitter|x\.com|tiktok|line|snapchat|reddit|linkedin/;
function entryClass() {
  const p = getEntryContext();
  if (p.ref === 'share') return 'shared';
  if (p.deeplink) return 'receipt_qr';
  const ref = typeof p.referrer === 'string' ? p.referrer.toLowerCase() : '';
  if (ref && MSG_REF.test(ref)) return 'social';
  if (p.in_app === true) return 'in_app';
  if (ref) return 'website';
  return 'direct';
}

/* ── The buffer ────────────────────────────────────────────────────── */

function push(kind, extra = {}) {
  if (!state.on || !state.screen) return;
  if (state.buffer.length >= MAX_BUFFER) return;
  const now = Date.now();
  state.lastAt = now;
  state.buffer.push({
    kind,
    screen: state.screen,
    seq: state.seq++,
    t_ms: Math.max(0, now - state.screenAt),
    at: new Date(now).toISOString(),
    vw: window.innerWidth,
    vh: window.innerHeight,
    dh: docHeight(),
    ...extra,
  });
  if (state.buffer.length >= FLUSH_AT) flush();
}

function payload() {
  return {
    action: 'flush',
    org_id: state.orgId,
    session_id: getSessionId(),
    user_id: state.userId,
    mode: state.mode,
    device: deviceClass(),
    entry: state.entry || null,
    started_at: new Date(state.startedAt).toISOString(),
    duration_ms: Math.max(0, state.lastAt - state.startedAt),
    screens: state.screenViews,
    screen_list: [...state.screenSeen],
    clicks: state.clicks,
    rage: state.rage,
    dead: state.dead,
    max_scroll: state.sessionMaxScroll || null,
    first_tap_ms: state.firstTapMs,
    last_screen: state.screen,
    events: state.buffer,
    layouts: state.layouts,
  };
}

async function flush() {
  if (!state.on || state.pending) return;
  if (!state.buffer.length && !state.layouts.length) return;
  const body = payload();
  state.buffer = [];
  state.layouts = [];
  try {
    const { data, error } = await supabase.functions.invoke('ux-ingest', { body });
    // The venue turned capture off while this visit was running.
    if (!error && data && data.enabled === false) stopUxCapture();
  } catch {
    // A failed flush is a lost batch, never a broken app. The visit's
    // own counters are cumulative, so the next flush still adds up.
  }
}

/** The last batch, on a page that is going away. `sendBeacon` survives the
 *  unload that a fetch would not. */
function flushBeacon() {
  if (!state.on || state.pending || !state.buffer.length) return;
  const body = payload();
  state.buffer = [];
  state.layouts = [];
  try {
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ux-ingest`;
    const blob = new Blob([JSON.stringify(body)], { type: 'application/json' });
    if (navigator.sendBeacon?.(url, blob)) return;
  } catch { /* fall through */ }
  flush();
}

/* ── Session replay ────────────────────────────────────────────────────
 * rrweb records the DOM and every change to it, and the dashboard replays
 * that in an iframe — the actual visit, not a re-enactment of it over a
 * sample screen. It is loaded only when a venue has replay on and this
 * visit is being recorded, so a customer who is not filmed never downloads
 * the recorder.
 *
 * What it must never film. `maskAllInputs` replaces every field's value
 * with asterisks before it leaves the page, so nothing anyone types is
 * recorded. `[data-ppk-private]` — the block that shows a name, an email
 * and a device — is blocked outright, and its text is masked as well, so
 * neither the characters nor their shape survive. No canvas (the QR code),
 * no fonts, and the whole thing only ever runs behind the Analytical
 * cookie the customer turned on.
 * ─────────────────────────────────────────────────────────────────────── */

const PRIVATE_SELECTOR = '[data-ppk-private]';

async function startReplay() {
  if (state.rec || !state.on || !state.config?.replay) return;
  try {
    const [{ record }, { pack }] = await Promise.all([
      import('rrweb'),
      import('@rrweb/packer/pack'),
    ]);
    if (!state.on || !state.config?.replay) return;   // turned off while loading
    state.rec = record({
      /* Packed before it leaves the browser. A snapshot of this app is
       * three quarters of a megabyte of JSON, most of it the stylesheet
       * inlined so the recording stays self-contained and still renders
       * after the next deploy changes every asset name. Packed it is a
       * fraction of that on the customer's connection; the player unpacks
       * it again.
       *
       * Then base64. rrweb's packer deflates to a BINARY string, and a
       * deflate stream is full of NUL bytes — which `jsonb` refuses
       * outright ("unsupported Unicode escape sequence"), so every chunk
       * came back 500 until this was here. Base64 gives back about a
       * third of what deflate saved and is still several times smaller
       * than the raw snapshot. */
      packFn: (event) => btoa(pack(event)),
      emit(event) {
        if (!state.on) return;
        if (state.replayCount >= REPLAY_MAX_EVENTS || state.replayBytes >= REPLAY_MAX_BYTES) {
          stopReplay();
          return;
        }
        state.replayCount += 1;
        state.replay.push(event);
        // Rough, and deliberately so: the point is a ceiling, not a metric.
        state.replayBytes += JSON.stringify(event).length;
        if (state.replay.length >= REPLAY_FLUSH_AT) flushReplay();
      },
      maskAllInputs: true,
      maskTextSelector: PRIVATE_SELECTOR,
      blockSelector: PRIVATE_SELECTOR,
      recordCanvas: false,
      collectFonts: false,
      sampling: { scroll: 150, media: 800, input: 'last' },
    }) || null;
    if (state.rec && !state.replayTimer) {
      state.replayTimer = setInterval(flushReplay, REPLAY_FLUSH_MS);
    }
  } catch (e) {
    // No recorder is a missing nicety, never a broken app — but a silent
    // one is how you end up staring at an empty table, so say so in dev.
    if (import.meta.env.DEV) console.warn('[ux] the recorder did not start:', e);
    state.rec = null;
  }
}

function stopReplay() {
  try { state.rec?.(); } catch { /* already stopped */ }
  state.rec = null;
  if (state.replayTimer) { clearInterval(state.replayTimer); state.replayTimer = null; }
}

/* Its own call, not part of the event flush: one chunk can be a hundred
 * kilobytes, which is far past what a beacon will carry. */
async function flushReplay() {
  if (!state.on || state.pending || !state.replay.length) return;
  const events = state.replay;
  state.replay = [];
  const body = {
    action: 'replay',
    org_id: state.orgId,
    session_id: getSessionId(),
    user_id: state.userId,
    seq: state.replaySeq++,
    events,
  };
  /* Plain fetch, for the same reason tikkieWallet uses it:
   * supabase.functions.invoke queues behind the client's auth lock, and
   * with a signed-in customer it sends the request with credentials, which
   * a wildcard CORS origin refuses outright — a chunk simply never
   * arrived. A recording chunk is also the largest thing this app uploads,
   * and it has no business waiting on an auth refresh. */
  try {
    const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ux-ingest`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify(body),
      keepalive: false,
    });
    // A chunk that does not arrive leaves a gap in one replay and nothing
    // else, but a silent one is how you end up staring at an empty table.
    if (import.meta.env.DEV && !resp.ok) {
      console.warn('[ux] replay chunk', body.seq, 'refused:', resp.status, await resp.clone().text());
    }
  } catch (e) {
    // A lost chunk leaves a gap in one replay, nothing more.
    if (import.meta.env.DEV) console.warn('[ux] replay chunk failed:', e);
  }
}

/* ── Listeners ─────────────────────────────────────────────────────── */

function onPointerDown(e) {
  if (!state.on || e.button > 0) return;
  const t = e.target;
  if (!t || t.nodeType !== 1) return;

  const cx = e.clientX || 0;
  const cy = e.clientY || 0;
  const vw = window.innerWidth || 1;
  const dh = docHeight() || 1;

  const el = pressableAncestor(t);
  const secret = !el || isPrivate(el);

  /* A sheet, a modal, the cookie banner: pinned to the viewport, so the
   * scroll position behind it is not part of where the finger landed.
   * Adding it is what smeared every popup screen down the page. */
  const pinned = el ? isPinned(el) : false;
  const pageY = pinned ? cy : cy + (window.scrollY || 0);
  const x = clamp01(cx / vw);
  const y = clamp01(pageY / dh);
  const yv = clamp01(cy / (window.innerHeight || 1));

  /* Where in the control's OWN box the finger landed. This is what makes a
   * tap replayable: the page can be any height on any visit, but "38% across
   * and 60% down the Collect button" is the same place every time. */
  let ox = null;
  let oy = null;
  if (el && !secret) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      ox = clamp01((cx - r.left) / r.width);
      oy = clamp01((cy - r.top) / r.height);
    }
  }

  // Three taps in one spot in a second and a bit: something did not react.
  const now = Date.now();
  state.recent = state.recent.filter(r => now - r.t < RAGE_WINDOW_MS);
  state.recent.push({ t: now, x: e.clientX || 0, y: e.clientY || 0 });
  const near = state.recent.filter(r => Math.hypot(r.x - (e.clientX || 0), r.y - (e.clientY || 0)) < RAGE_RADIUS);
  const raging = near.length >= RAGE_COUNT;

  const kind = raging ? 'rage' : el ? 'click' : 'dead';
  if (kind === 'rage') state.rage += 1;
  else if (kind === 'dead') state.dead += 1;
  state.clicks += 1;
  if (state.firstTapMs == null) state.firstTapMs = Math.max(0, now - state.startedAt);

  push(kind, {
    x, y, yv,
    ox, oy,
    // Page pixels as they were measured, so a reader can rescale rather
    // than inherit a ratio baked against one visit's page height.
    px: Math.round(cx + (window.scrollX || 0)),
    py: Math.round(pageY),
    pinned,
    target: el && !secret ? keyFor(el) : null,
    label: el && !secret ? labelFor(el) : null,
  });
}

let scrollTick = 0;
function onScroll() {
  if (!state.on) return;
  const now = Date.now();
  if (now - scrollTick < SCROLL_MS) return;
  scrollTick = now;
  const dh = docHeight();
  const vh = window.innerHeight || 1;
  const max = Math.max(1, dh - vh);
  const depth = clamp01(((window.scrollY || 0) + vh) / Math.max(vh, dh));
  const reach = clamp01((window.scrollY || 0) / max);
  const d = Math.max(depth ?? 0, reach ?? 0);
  if (d > state.scrollMax) state.scrollMax = d;
  if (d > state.sessionMaxScroll) state.sessionMaxScroll = d;
  if (state.scrollMax - state.scrollSent >= SCROLL_STEP) {
    state.scrollSent = state.scrollMax;
    push('scroll', { depth: state.scrollMax });
  }
}

function onHide() {
  if (!state.on) return;
  if (document.visibilityState === 'hidden') {
    push('leave', { depth: state.scrollMax || null });
    flushBeacon();
    flushReplay();
  }
}

function onConsentChange() {
  if (hasAnalyticsConsent()) return;
  stopUxCapture();
}

function addListeners() {
  if (state.listeners) return;
  state.listeners = true;
  document.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true });
  window.addEventListener('scroll', onScroll, { passive: true });
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', onHide);
  window.addEventListener('packperks:consent-changed', onConsentChange);
}

function removeListeners() {
  if (!state.listeners) return;
  state.listeners = false;
  document.removeEventListener('pointerdown', onPointerDown, { capture: true });
  window.removeEventListener('scroll', onScroll);
  document.removeEventListener('visibilitychange', onHide);
  window.removeEventListener('pagehide', onHide);
  window.removeEventListener('packperks:consent-changed', onConsentChange);
}

/* ── Screen snapshot ───────────────────────────────────────────────── */

/* Labels a screen is allowed to keep. A control's own name describes the
 * screen; a customer's details describe the customer, and a layout row is
 * shared across every visit to that screen — so anything that looks
 * personal is masked before it can get there. Belt and braces with
 * `[data-ppk-private]`, which the app puts on the blocks that show a name,
 * an email or a device. */
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
const IBAN_RE  = /\b[A-Z]{2}\d{2}[A-Z0-9]{8,26}\b/g;
const LONGNUM  = /\d{4,}/g;
function safeText(v, max = 60) {
  const t = String(v || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t
    .replace(EMAIL_RE, '•••')
    .replace(IBAN_RE, '•••')
    .replace(LONGNUM, (m) => '•'.repeat(Math.min(6, m.length)))
    .slice(0, max);
}

/* Where the controls were, as fractions of the page.
 *
 * This is the ONLY thing a snapshot stores. The heatmap draws its heat
 * over the venue's actual app, embedded read-only (userflow/ScreenFrame),
 * so there is nothing to rebuild the screen's appearance from and nothing
 * to store about how it looked. What is still needed is the geometry of
 * the controls, for the "Controls" view: which button is where, so taps
 * can be attributed to it and the ones nobody uses can be shown cold.
 *
 * One snapshot per screen per visit; the fullest one wins. */
function snapshotLayout() {
  if (!state.on || !state.config?.layouts || !state.screen) return;
  const screen = state.screen;
  const vw = window.innerWidth || 1;
  const dh = docHeight() || 1;
  const scrollY = window.scrollY || 0;
  const elements = [];

  for (const el of pressableNodes()) {
    if (elements.length >= MAX_ELEMENTS) break;
    if (isPrivate(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) continue;
    if (r.top + scrollY > dh) continue;
    elements.push({
      k: keyFor(el),
      l: safeText(labelFor(el)),
      x: clamp01(r.left / vw),
      y: clamp01((r.top + scrollY) / dh),
      w: clamp01(r.width / vw),
      h: clamp01(r.height / dh),
    });
  }

  // A screen that is still loading (rewards, activity, a map) has more
  // controls a moment later. The fullest measurement of the visit wins, so
  // a half-built screen never replaces a complete one on the server.
  if (elements.length <= (state.layoutBest[screen] || 0)) return;
  state.layoutBest[screen] = elements.length;
  const row = { screen, device: deviceClass(), elements, vw, vh: window.innerHeight, dh };
  const at = state.layouts.findIndex(l => l.screen === screen);
  if (at >= 0) state.layouts[at] = row;
  else state.layouts.push(row);
}

/* ── The API the app uses ──────────────────────────────────────────── */

/**
 * Start capturing for this venue. Safe to call more than once; a second
 * call only updates the org and mode.
 *
 * @param {{orgId: string, mode?: string, entry?: string}} opts
 */
export function initUxCapture({ orgId, mode = null, entry = null } = {}) {
  if (typeof window === 'undefined' || !orgId) return;
  state.orgId = orgId;
  state.mode = mode;
  if (state.on || !hasAnalyticsConsent()) return;
  state.entry = entry || entryClass();

  state.on = true;
  state.pending = true;
  state.startedAt = Date.now();
  state.lastAt = state.startedAt;
  addListeners();

  // What this venue actually wants captured. Until it answers, events are
  // buffered and nothing is sent.
  supabase.functions.invoke('ux-ingest', { body: { action: 'config', org_id: orgId } })
    .then(({ data, error }) => {
      if (error || !data || data.enabled === false) { stopUxCapture(); return; }
      if (!inSample(getSessionId(), Number(data.sample) || 100)) { stopUxCapture(); return; }
      state.config = data;
      state.pending = false;
      if (!state.timer) state.timer = setInterval(flush, FLUSH_MS);
      if (data.replay) startReplay();
      // The app is already on a screen by the time this answers, and that
      // first view is the one the whole flow hangs off.
      if (state.screen && !state.buffer.some(e => e.kind === 'view')) {
        state.screenAt = Date.now();
        state.screenViews += 1;
        push('view', { depth: 0 });
        scheduleLayout();
      }
      flush();
    })
    .catch(() => stopUxCapture());
}

/** Stop, and drop whatever has not been sent. */
export function stopUxCapture() {
  state.on = false;
  state.pending = true;
  state.buffer = [];
  state.layouts = [];
  stopReplay();
  state.replay = [];
  if (state.timer) { clearInterval(state.timer); state.timer = null; }
  if (state.layoutTimer) { clearTimeout(state.layoutTimer); state.layoutTimer = null; }
  removeListeners();
}

/** The customer's row id, once the app knows it. */
export function setUxUser(userId) {
  state.userId = typeof userId === 'string' ? userId : null;
}

function scheduleLayout() {
  if (state.layoutTimer) clearTimeout(state.layoutTimer);
  state.layoutTimer = setTimeout(() => {
    snapshotLayout();
    state.layoutTimer = setTimeout(snapshotLayout, LAYOUT_SETTLE);
  }, LAYOUT_DELAY);
}

/**
 * The screen the customer is now on. Every tap, scroll and dwell that
 * follows belongs to it. Deferred Tikkie has one page and many sheets, so
 * it calls this with the sheet that is open — a sheet is a screen to the
 * person looking at it.
 */
export function uxScreen(screen) {
  if (!screen || screen === state.screen) return;
  state.screen = String(screen).slice(0, 64);
  state.screenAt = Date.now();
  state.scrollMax = 0;
  state.scrollSent = 0;
  state.screenSeen.add(state.screen);
  // Before capture starts the screen is only remembered; initUxCapture
  // emits the first view once the venue's settings have come back.
  if (!state.on) return;
  state.screenViews += 1;
  push('view', { depth: 0 });
  scheduleLayout();
}

/** For the dashboard's own preview of what a venue captures. */
export function uxCaptureState() {
  return { on: state.on, pending: state.pending, config: state.config, screen: state.screen };
}
