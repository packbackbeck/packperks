/* ─────────────────────────────────────────────────────────────────────
 * demoData.js — the showcase dataset behind "Demo numbers".
 *
 * When an org turns the toggle on (Settings → Feature flags), vendor
 * accounts see a fully-formed, healthy programme instead of whatever the
 * real tables hold. It exists for the pitch: a venue evaluating PackPerks
 * on day three has almost no data, and an empty dashboard says nothing
 * about how the system runs.
 *
 * The important design decision: this module fabricates ROWS, not
 * numbers. It returns the same shapes the Supabase queries return, and
 * adminApi swaps them in at the three fetch points. Every metric, chart,
 * cumulative series and "Inspect" drill-down downstream is then computed
 * by the real production code. That means the demo can't drift from the
 * real dashboard, and no number can contradict another — the totals add
 * up because they were actually added up.
 *
 * Everything is seeded from the org id, so the same store always shows
 * the same story across reloads, tabs and devices. No Math.random().
 * ───────────────────────────────────────────────────────────────────── */

const DAY = 24 * 60 * 60 * 1000;
const DAYS = 63;           // ~9 weeks of history — enough for weekly buckets
const HOUR = 60 * 60 * 1000;

/* ── Deterministic PRNG ──────────────────────────────────────────────
 * mulberry32: small, fast, good enough spread for synthetic data. Seeded
 * from the org id so a given store's demo never changes. */
function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < String(str || 'packperks').length; i++) {
    h ^= String(str).charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* A weekday-shaped multiplier: quiet weekends, a Thursday peak. Gives the
 * daily charts a believable rhythm instead of straight-line noise. */
const WEEKDAY_WEIGHT = [0.62, 1.05, 1.0, 1.08, 1.18, 1.12, 0.7]; // Sun…Sat

const REWARD_IDS = ['rw-flat-white', 'rw-latte', 'rw-cappuccino', 'rw-filter', 'rw-cold-brew', 'rw-tea'];
const DEVICES = ['iPhone', 'Android', 'iPad', 'Desktop'];
const DEVICE_WEIGHT = [0.58, 0.33, 0.04, 0.05];
const SCREENS = ['home', 'rewards', 'account', 'howto', 'impact'];
const CLICK_EVENTS = [
  ['reward_card_opened', 0.24], ['reward_selected', 0.18], ['balance_opened', 0.15],
  ['howto_opened', 0.11], ['reward_claim_attempted', 0.1], ['account_opened', 0.08],
  ['add_cups_opened', 0.06], ['share_cup', 0.04], ['name_edit_opened', 0.02], ['terms_opened', 0.02],
];

/** Pick from a weighted list. `weights` need not sum to exactly 1. */
function weightedPick(rand, items, weights) {
  const total = weights.reduce((s, w) => s + w, 0);
  let r = rand() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

/* ─────────────────────────────────────────────────────────────────────
 * The generator. One pass builds a consistent world: customers arrive,
 * scan receipts, come back, spend cups on rewards. Every downstream table
 * is derived from those same events, so the numbers reconcile.
 * ───────────────────────────────────────────────────────────────────── */
function generate(orgId) {
  const rand = mulberry32(hashSeed(orgId));
  const now = Date.now();
  // Anchor to the start of the current hour so repeated reads inside a
  // session produce identical timestamps (and identical bucket edges).
  const end = Math.floor(now / HOUR) * HOUR;
  const start = end - DAYS * DAY;

  const users = [];
  const balances = [];
  const claims = [];
  const scans = [];
  const cups = [];
  const cupActivity = [];      // activity_history rows, type 'cup_added'
  const activity = [];         // activity_history rows, all types (recent list)
  const clientEvents = [];
  const consentRejections = [];
  const sysEvents = [];

  let seq = 0;
  const id = (p) => `${p}-${(seq++).toString(36).padStart(5, '0')}`;

  /* Customers arrive across the window, accelerating slightly — a store
   * that is growing rather than flat. */
  const TOTAL_USERS = 380 + Math.floor(rand() * 70);
  for (let i = 0; i < TOTAL_USERS; i++) {
    // Skew arrivals toward the recent end: sqrt bias on a uniform draw.
    const frac = Math.pow(rand(), 0.72);
    const createdAt = start + frac * (end - start);
    users.push({
      id: id('u'),
      identity_id: null,
      display_name: null,        // never invent a person; the UI shows the fallback
      email: rand() < 0.46 ? `customer${i}@example.com` : null,
      device: weightedPick(rand, DEVICES, DEVICE_WEIGHT),
      selected_reward_id: rand() < 0.55 ? REWARD_IDS[Math.floor(rand() * REWARD_IDS.length)] : null,
      created_at: new Date(createdAt).toISOString(),
      updated_at: new Date(createdAt).toISOString(),   // bumped below by activity
      _createdMs: createdAt,
      _visits: [],
      _cups: 0,
    });
  }

  /* Visits. Each customer returns a few times; a healthy tail comes back
   * many times. The repeat distribution is what drives retention, the
   * second/third-scan funnel and "avg time to second scan". */
  for (const u of users) {
    const roll = rand();
    // ~34% one-and-done, ~40% two or three, ~26% a real regular.
    const visits = roll < 0.34 ? 1 : roll < 0.74 ? 2 + Math.floor(rand() * 2) : 4 + Math.floor(rand() * 6);
    let t = u._createdMs;
    for (let v = 0; v < visits; v++) {
      if (t > end) break;
      u._visits.push(t);
      // Gap to the next visit: mostly 2–9 days, occasionally same week.
      t += (1.5 + rand() * 7.5) * DAY;
    }
    u.updated_at = new Date(u._visits[u._visits.length - 1] || u._createdMs).toISOString();
  }

  /* One receipt (batch) per visit: cups minted, then scanned. A slice of
   * batches is never scanned at all — that is the "ignored receipts"
   * metric, and it has to be real for the number to mean anything. */
  const allVisits = [];
  for (const u of users) for (const t of u._visits) allVisits.push({ u, t });
  allVisits.sort((a, b) => a.t - b.t);

  for (const { u, t } of allVisits) {
    // Weekday rhythm: shift a visit off the quietest days rather than
    // dropping it, so the daily chart has shape without losing volume.
    const dow = new Date(t).getDay();
    const visitAt = WEEKDAY_WEIGHT[dow] < 0.8 && rand() < 0.5 ? t + DAY : t;
    if (visitAt > end) continue;
    // Business hours, weighted toward the lunch peak.
    const hour = 8 + Math.floor(Math.pow(rand(), 0.8) * 11);
    const at = new Date(visitAt).setHours(hour, Math.floor(rand() * 60), 0, 0);
    if (at > end || at < start) continue;

    const batchId = id('b');
    const nCups = 1 + Math.floor(rand() * 3);
    const cupIds = [];
    for (let c = 0; c < nCups; c++) cupIds.push(id('c'));

    // 4.5% of receipts are printed but never scanned.
    const scanned = rand() > 0.045;

    for (const cid of cupIds) {
      cups.push({
        id: cid,
        batch_id: batchId,
        org_id: orgId,
        status: scanned ? 'activated' : 'pending',
        source: 'qr',
        created_at: new Date(at - 90 * 1000).toISOString(),
      });
    }

    // Every generated batch is logged as a QR-generation attempt.
    sysEvents.push({
      event_type: 'qr_generation',
      status: rand() < 0.988 ? 'success' : 'failure',
      count: nCups,
      created_at: new Date(at - 95 * 1000).toISOString(),
    });

    if (!scanned) continue;

    /* The scan itself. Overwhelmingly clean; the small failure tail is
     * expected rejections (an already-claimed re-scan), never a server
     * fault — that is what keeps "critical errors" at zero and uptime
     * at 100 while the success rate still isn't a suspicious 100.00%. */
    const dup = rand() < 0.021;
    const expired = !dup && rand() < 0.019;
    const scanId = id('s');
    if (expired) {
      scans.push({
        id: scanId,
        user_id: u.id,
        org_id: orgId,
        status: 'failed',
        error_code: 'batch_expired',
        error_message: 'This receipt has expired',
        cups_awarded: 0,
        requested_cup_ids: cupIds,
        activated_cup_ids: [],
        batch_id: batchId,
        source: 'qr',
        scanned_at: new Date(at).toISOString(),
      });
      clientEvents.push({
        event: 'scan_attempted', session_id: id('sess'), user_id: u.id,
        created_at: new Date(at - 2000).toISOString(), props: { scan_id: scanId },
      });
      for (const cid of cupIds) {
        const c = cups.find(x => x.id === cid);
        if (c) c.status = 'pending';
      }
      continue;
    }
    scans.push({
      id: scanId,
      user_id: u.id,
      org_id: orgId,
      status: 'success',
      error_code: null,
      error_message: null,
      cups_awarded: nCups,
      requested_cup_ids: cupIds,
      activated_cup_ids: cupIds,
      batch_id: batchId,
      source: 'qr',
      scanned_at: new Date(at).toISOString(),
    });
    clientEvents.push({
      event: 'scan_attempted', session_id: id('sess'), user_id: u.id,
      created_at: new Date(at - 2000).toISOString(), props: { scan_id: scanId },
    });

    if (dup) {
      // A duplicate re-scan of the same receipt, correctly refused.
      const dupId = id('s');
      scans.push({
        id: dupId,
        user_id: u.id,
        org_id: orgId,
        status: 'failed',
        error_code: 'already_claimed',
        error_message: 'Cups already claimed',
        cups_awarded: 0,
        requested_cup_ids: cupIds,
        activated_cup_ids: [],
        batch_id: batchId,
        source: 'qr',
        scanned_at: new Date(at + 40 * 1000).toISOString(),
      });
      clientEvents.push({
        event: 'scan_attempted', session_id: id('sess'), user_id: u.id,
        created_at: new Date(at + 38 * 1000).toISOString(), props: { scan_id: dupId },
      });
    }

    u._cups += nCups;
    for (const cid of cupIds) {
      cupActivity.push({ id: id('a'), type: 'cup_added', user_id: u.id, created_at: new Date(at).toISOString(), _cup: cid });
    }
    activity.push({ id: id('a'), type: 'cup_added', created_at: new Date(at).toISOString() });

    /* App session around the visit: the funnel events the User Behaviour
     * page reads. One session per scan plus browse-only sessions below. */
    const sess = id('sess');
    clientEvents.push({ event: 'app_loaded', session_id: sess, user_id: u.id, created_at: new Date(at - 60 * 1000).toISOString(), props: {} });
    const screens = 1 + Math.floor(rand() * 3);
    for (let s = 0; s < screens; s++) {
      clientEvents.push({
        event: 'screen_view', session_id: sess, user_id: u.id,
        created_at: new Date(at - 55 * 1000 + s * 6000).toISOString(),
        props: { screen: SCREENS[Math.floor(rand() * SCREENS.length)] },
      });
    }
    const clicks = 1 + Math.floor(rand() * 3);
    for (let c = 0; c < clicks; c++) {
      const ev = weightedPick(rand, CLICK_EVENTS.map(x => x[0]), CLICK_EVENTS.map(x => x[1]));
      clientEvents.push({ event: ev, session_id: sess, user_id: u.id, created_at: new Date(at - 40 * 1000 + c * 4000).toISOString(), props: {} });
    }
  }

  /* Redemptions. A customer with enough cups spends them; the reward mix
   * is deliberately uneven so "most-claimed reward" has a real winner. */
  for (const u of users) {
    let spendable = u._cups;
    const visits = u._visits.filter(t => t <= end);
    if (!visits.length) continue;
    // Regulars redeem more than once.
    const attempts = spendable >= 12 ? 2 + Math.floor(rand() * 2) : spendable >= 6 ? 1 : rand() < 0.45 ? 1 : 0;
    for (let a = 0; a < attempts; a++) {
      const cost = 4 + Math.floor(rand() * 3);
      if (spendable < cost) break;
      spendable -= cost;
      const at = visits[Math.min(visits.length - 1, a + 1)] || visits[visits.length - 1];
      const when = Math.min(end, at + rand() * 2 * DAY);
      const isDonation = rand() < 0.11;
      // Small pending tail — a queue that is being worked, not neglected.
      const status = rand() < 0.965 ? 'completed' : 'pending';
      claims.push({
        id: id('cl'),
        user_id: u.id,
        type: isDonation ? 'donation' : 'cashback',
        reward_id: isDonation ? null : weightedPick(rand, REWARD_IDS, [0.3, 0.22, 0.17, 0.13, 0.11, 0.07]),
        cups_redeemed: cost,
        payout_amount: isDonation ? 0 : +(cost * 0.45).toFixed(2),
        status,
        created_at: new Date(when).toISOString(),
      });
      activity.push({ id: id('a'), type: isDonation ? 'donation' : 'reward_claimed', created_at: new Date(when).toISOString() });
    }
    balances.push({ user_id: u.id, balance: Math.max(0, spendable), lifetime_cups: u._cups });
  }

  /* Browse-only sessions: people who opened the app and never scanned.
   * Without these, "visitor → customer" conversion is a meaningless 100%. */
  const browseSessions = Math.floor(allVisits.length * 0.38);
  for (let i = 0; i < browseSessions; i++) {
    const at = start + rand() * (end - start);
    const sess = id('sess');
    clientEvents.push({ event: 'app_loaded', session_id: sess, user_id: null, created_at: new Date(at).toISOString(), props: {} });
    clientEvents.push({
      event: 'screen_view', session_id: sess, user_id: null,
      created_at: new Date(at + 4000).toISOString(), props: { screen: rand() < 0.7 ? 'home' : 'rewards' },
    });
    if (rand() < 0.34) {
      clientEvents.push({ event: 'reward_card_opened', session_id: sess, user_id: null, created_at: new Date(at + 9000).toISOString(), props: {} });
    }
    // The Android in-app-browser prompt, and what people chose.
    if (rand() < 0.16) {
      clientEvents.push({ event: 'inapp_prompt_shown', session_id: sess, user_id: null, created_at: new Date(at + 2000).toISOString(), props: {} });
      const pick = rand();
      if (pick < 0.62) clientEvents.push({ event: 'open_in_default_browser', session_id: sess, user_id: null, created_at: new Date(at + 5000).toISOString(), props: {} });
      else if (pick < 0.9) clientEvents.push({ event: 'collect_here_anyway', session_id: sess, user_id: null, created_at: new Date(at + 5000).toISOString(), props: {} });
    }
  }

  /* Cookie refusals — anonymous by design (org + timestamp only). */
  const rejections = Math.floor(browseSessions * 0.09);
  for (let i = 0; i < rejections; i++) {
    consentRejections.push({ id: id('r'), org_id: orgId, created_at: new Date(start + rand() * (end - start)).toISOString() });
  }

  // Newest first, matching the `order('created_at', desc)` the real query uses.
  activity.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));   // newest first, like the real query
  scans.sort((a, b) => (a.scanned_at < b.scanned_at ? -1 : 1));      // oldest first, like the real query

  return {
    // Strip the bookkeeping fields the generator used; a consumer should
    // see exactly the columns the real `users` select returns.
    users: users.map((u) => ({
      id: u.id, identity_id: u.identity_id, display_name: u.display_name,
      email: u.email, device: u.device, selected_reward_id: u.selected_reward_id,
      created_at: u.created_at, updated_at: u.updated_at,
    })),
    balances,
    claims,
    scans,
    cups,
    cupActivity: cupActivity.map((a) => ({ id: a.id, type: a.type, user_id: a.user_id, created_at: a.created_at })),
    activity,
    clientEvents,
    consentRejections,
    sysEvents,
    window: { start, end },
  };
}

/* One generated world per org, kept for the tab's lifetime. Generating is
 * cheap but not free, and every page that asks must see the same data. */
const CACHE = new Map();

export function demoWorld(orgId) {
  const key = String(orgId || 'default');
  if (!CACHE.has(key)) CACHE.set(key, generate(key));
  return CACHE.get(key);
}

/** Drop the cache — used when the demo toggle flips, so the next read rebuilds. */
export function resetDemoWorld() { CACHE.clear(); UX_CACHE.clear(); }

/* ── Range helper: the real queries filter server-side, so the demo has
 *    to apply the same window itself. ── */
function inRange(iso, fromTs, toTs) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return false;
  if (fromTs != null && t < new Date(fromTs).getTime()) return false;
  if (toTs != null && t > new Date(toTs).getTime()) return false;
  return true;
}

/** Rows for getAdminStats — the Overview page. */
export function demoAdminStatsRows(orgId) {
  const w = demoWorld(orgId);
  return {
    users: w.users,
    balances: w.balances,
    claims: w.claims,
    scans: w.scans,
    recentActivity: w.activity.slice(0, 20),
    cupActivity: w.cupActivity,
  };
}

/** Rows for getStatsMetrics — the System Health page (range-filtered). */
export function demoHealthRows(orgId, fromTs, toTs) {
  const w = demoWorld(orgId);
  return {
    scans: w.scans.filter(s => inRange(s.scanned_at, fromTs, toTs)),
    cups: w.cups,
    sysEvents: w.sysEvents.filter(e => inRange(e.created_at, fromTs, toTs)),
    cliEvents: w.clientEvents.filter(e => inRange(e.created_at, fromTs, toTs)),
  };
}

/** Rows for fetchBehaviourRows — the User Behaviour page. */
export function demoBehaviourRows(orgId) {
  const w = demoWorld(orgId);
  return {
    cups: w.cups,
    scans: w.scans,
    claims: w.claims,
    users: w.users,
    ev: w.clientEvents,
    rej: w.consentRejections,
  };
}

/* ─────────────────────────────────────────────────────────────────────
 * UX capture — the demo's taps, scrolls and screen flow.
 *
 * Same rule as everything above: fabricate ROWS (ux_sessions, ux_events,
 * ux_layouts as migration 061 shapes them) and let the real aggregates in
 * uxAggregate.js count them. So the demo heatmap is a real heatmap of
 * invented visits, not a drawing of one, and the tiles beside it add up
 * to the same visits.
 *
 * The screen graph is per mode, because the modes are different apps: a
 * Deposit Rewards venue has a market, rewards and a scanner; a Deferred
 * Tikkie wallet is one page with sheets over it.
 * ───────────────────────────────────────────────────────────────────── */

/* A screen: where its controls sit (fractions of the page, as the tracker
 * records them) and what customers open next. `weight` is how much traffic
 * starts there; `exit` is how often a visit ends on it. */
const UX_SCREENS = {
  standard: [
    { id: 'home', weight: 0.62, exit: 0.28, scroll: 0.72, next: [['rewards', 0.34], ['cup-scan', 0.26], ['user', 0.14], ['howto', 0.1], ['impact', 0.08], ['stores', 0.08]],
      els: [
        { k: 'ppk:header-account', l: 'Account', x: 0.82, y: 0.03, w: 0.12, h: 0.03 },
        { k: 'ppk:balance-card', l: 'Cup balance', x: 0.06, y: 0.1, w: 0.88, h: 0.12 },
        { k: 'ppk:add-cups', l: 'Add more cups', x: 0.06, y: 0.25, w: 0.88, h: 0.06 },
        { k: 'ppk:reward-card-1', l: 'Flat white', x: 0.06, y: 0.36, w: 0.42, h: 0.14 },
        { k: 'ppk:reward-card-2', l: 'Latte', x: 0.52, y: 0.36, w: 0.42, h: 0.14 },
        { k: 'ppk:reward-card-3', l: 'Cold brew', x: 0.06, y: 0.53, w: 0.42, h: 0.14 },
        { k: 'ppk:reward-card-4', l: 'Filter coffee', x: 0.52, y: 0.53, w: 0.42, h: 0.14 },
        { k: 'ppk:how-it-works', l: 'How it works', x: 0.06, y: 0.72, w: 0.88, h: 0.05 },
        { k: 'ppk:share-impact', l: 'Share your impact', x: 0.06, y: 0.8, w: 0.88, h: 0.05 },
        { k: 'ppk:terms', l: 'Terms', x: 0.34, y: 0.93, w: 0.32, h: 0.03 },
      ] },
    { id: 'rewards', weight: 0.06, exit: 0.16, scroll: 0.56, next: [['receipt', 0.36], ['home', 0.4], ['voucher', 0.12], ['user', 0.12]],
      els: [
        { k: 'ppk:reward-back', l: 'Back', x: 0.04, y: 0.03, w: 0.12, h: 0.04 },
        { k: 'ppk:reward-hero', l: 'Reward image', x: 0.06, y: 0.1, w: 0.88, h: 0.24 },
        { k: 'ppk:reward-claim', l: 'Get cashback', x: 0.06, y: 0.42, w: 0.88, h: 0.07 },
        { k: 'ppk:reward-switch', l: 'Save for this one', x: 0.06, y: 0.52, w: 0.88, h: 0.06 },
        { k: 'ppk:reward-terms', l: 'Reward terms', x: 0.3, y: 0.66, w: 0.4, h: 0.04 },
      ] },
    { id: 'cup-scan', weight: 0.14, exit: 0.1, scroll: 0.2, next: [['cup-scan-success', 0.68], ['cup-scan-error', 0.14], ['home', 0.18]],
      els: [
        { k: 'ppk:scan-close', l: 'Close', x: 0.85, y: 0.04, w: 0.1, h: 0.04 },
        { k: 'ppk:scan-frame', l: 'Camera', x: 0.12, y: 0.24, w: 0.76, h: 0.42 },
        { k: 'ppk:scan-torch', l: 'Torch', x: 0.44, y: 0.76, w: 0.12, h: 0.06 },
      ] },
    { id: 'cup-scan-success', weight: 0, exit: 0.34, scroll: 0.3, next: [['home', 0.72], ['rewards', 0.28]],
      els: [
        { k: 'ppk:scan-done', l: 'Nice', x: 0.06, y: 0.62, w: 0.88, h: 0.07 },
        { k: 'ppk:scan-again', l: 'Scan another', x: 0.06, y: 0.72, w: 0.88, h: 0.06 },
      ] },
    { id: 'cup-scan-error', weight: 0, exit: 0.52, scroll: 0.25, next: [['cup-scan', 0.5], ['home', 0.5]],
      els: [
        { k: 'ppk:scan-retry', l: 'Try again', x: 0.06, y: 0.6, w: 0.88, h: 0.07 },
        { k: 'ppk:scan-close-2', l: 'Close', x: 0.06, y: 0.7, w: 0.88, h: 0.06 },
      ] },
    { id: 'receipt', weight: 0.02, exit: 0.3, scroll: 0.68, next: [['verifying', 0.7], ['home', 0.3]],
      els: [
        { k: 'ppk:receipt-upload', l: 'Upload receipt', x: 0.06, y: 0.3, w: 0.88, h: 0.16 },
        { k: 'ppk:receipt-email', l: 'Email', x: 0.06, y: 0.52, w: 0.88, h: 0.06 },
        { k: 'ppk:receipt-consent', l: 'Privacy consent', x: 0.06, y: 0.62, w: 0.06, h: 0.03 },
        { k: 'ppk:receipt-submit', l: 'Send claim', x: 0.06, y: 0.72, w: 0.88, h: 0.07 },
      ] },
    { id: 'verifying', weight: 0, exit: 0.2, scroll: 0.1, next: [['success', 0.82], ['rejected', 0.18]], els: [] },
    { id: 'success', weight: 0, exit: 0.58, scroll: 0.3, next: [['home', 1]],
      els: [{ k: 'ppk:success-done', l: 'Done', x: 0.06, y: 0.66, w: 0.88, h: 0.07 }] },
    { id: 'rejected', weight: 0, exit: 0.62, scroll: 0.35, next: [['home', 1]],
      els: [{ k: 'ppk:rejected-back', l: 'Back to home', x: 0.06, y: 0.66, w: 0.88, h: 0.07 }] },
    { id: 'user', weight: 0.08, exit: 0.42, scroll: 0.8, next: [['home', 0.72], ['impact', 0.28]],
      els: [
        { k: 'ppk:account-name', l: 'Edit name', x: 0.06, y: 0.14, w: 0.88, h: 0.06 },
        { k: 'ppk:account-email', l: 'Save your balance', x: 0.06, y: 0.24, w: 0.88, h: 0.06 },
        { k: 'ppk:account-history', l: 'Activity', x: 0.06, y: 0.36, w: 0.88, h: 0.2 },
        { k: 'ppk:account-refund', l: 'Direct refund', x: 0.06, y: 0.62, w: 0.88, h: 0.06 },
        { k: 'ppk:account-delete', l: 'Delete my account', x: 0.24, y: 0.88, w: 0.52, h: 0.04 },
      ] },
    { id: 'howto', weight: 0.04, exit: 0.44, scroll: 0.88, next: [['home', 1]],
      els: [
        { k: 'ppk:howto-step-1', l: 'Step 1', x: 0.06, y: 0.16, w: 0.88, h: 0.12 },
        { k: 'ppk:howto-step-2', l: 'Step 2', x: 0.06, y: 0.32, w: 0.88, h: 0.12 },
        { k: 'ppk:howto-close', l: 'Got it', x: 0.06, y: 0.74, w: 0.88, h: 0.07 },
      ] },
    { id: 'impact', weight: 0.02, exit: 0.5, scroll: 0.64, next: [['home', 1]],
      els: [
        { k: 'ppk:impact-share', l: 'Share', x: 0.06, y: 0.5, w: 0.88, h: 0.07 },
        { k: 'ppk:impact-close', l: 'Close', x: 0.06, y: 0.6, w: 0.88, h: 0.06 },
      ] },
    { id: 'stores', weight: 0.02, exit: 0.46, scroll: 0.7, next: [['home', 1]],
      els: [
        { k: 'ppk:store-card-1', l: 'Cartouche', x: 0.06, y: 0.2, w: 0.88, h: 0.1 },
        { k: 'ppk:store-card-2', l: 'La Place', x: 0.06, y: 0.33, w: 0.88, h: 0.1 },
        { k: 'ppk:store-request', l: 'Request it', x: 0.06, y: 0.6, w: 0.88, h: 0.06 },
      ] },
    { id: 'voucher', weight: 0, exit: 0.66, scroll: 0.2, next: [['home', 1]],
      els: [{ k: 'ppk:voucher-slide', l: 'Slide to redeem', x: 0.06, y: 0.6, w: 0.88, h: 0.08 }] },
  ],
  tikkie: [
    { id: 'home', weight: 0.86, exit: 0.42, scroll: 0.66, next: [['popup-redeem', 0.3], ['activity-detail', 0.2], ['account', 0.14], ['popup-donate', 0.12], ['impact', 0.1], ['scan-camera', 0.08], ['privacy-policy', 0.06]],
      els: [
        { k: 'ppk:wallet-tile', l: 'What you are owed', x: 0.06, y: 0.12, w: 0.88, h: 0.16 },
        { k: 'ppk:wallet-collect', l: 'Collect', x: 0.06, y: 0.31, w: 0.42, h: 0.06 },
        { k: 'ppk:wallet-donate', l: 'Donate', x: 0.52, y: 0.31, w: 0.42, h: 0.06 },
        { k: 'ppk:activity-row-1', l: 'Activity row', x: 0.06, y: 0.44, w: 0.88, h: 0.07 },
        { k: 'ppk:activity-row-2', l: 'Activity row', x: 0.06, y: 0.53, w: 0.88, h: 0.07 },
        { k: 'ppk:activity-row-3', l: 'Activity row', x: 0.06, y: 0.62, w: 0.88, h: 0.07 },
        { k: 'ppk:wallet-howpaid', l: 'How you get paid', x: 0.06, y: 0.74, w: 0.88, h: 0.1 },
        { k: 'ppk:wallet-bins', l: 'Where the bins are', x: 0.06, y: 0.87, w: 0.88, h: 0.06 },
      ] },
    { id: 'popup-redeem', weight: 0, exit: 0.3, scroll: 0.2, next: [['home', 1]],
      els: [
        { k: 'ppk:redeem-confirm', l: 'Get my money', x: 0.08, y: 0.62, w: 0.84, h: 0.07 },
        { k: 'ppk:redeem-cancel', l: 'Not now', x: 0.08, y: 0.72, w: 0.84, h: 0.05 },
      ] },
    { id: 'popup-credited', weight: 0, exit: 0.36, scroll: 0.15, next: [['home', 1]],
      els: [{ k: 'ppk:credited-ok', l: 'Nice', x: 0.08, y: 0.66, w: 0.84, h: 0.07 }] },
    { id: 'popup-donate', weight: 0, exit: 0.26, scroll: 0.2, next: [['home', 0.7], ['popup-donated', 0.3]],
      els: [
        { k: 'ppk:donate-slider', l: 'How much', x: 0.08, y: 0.5, w: 0.84, h: 0.05 },
        { k: 'ppk:donate-confirm', l: 'Donate', x: 0.08, y: 0.62, w: 0.84, h: 0.07 },
        { k: 'ppk:donate-cancel', l: 'Cancel', x: 0.08, y: 0.72, w: 0.84, h: 0.05 },
      ] },
    { id: 'popup-donated', weight: 0, exit: 0.6, scroll: 0.15, next: [['home', 1]],
      els: [{ k: 'ppk:donated-ok', l: 'Thanks', x: 0.08, y: 0.66, w: 0.84, h: 0.07 }] },
    { id: 'activity-detail', weight: 0, exit: 0.22, scroll: 0.45, next: [['home', 0.82], ['popup-redeem', 0.18]],
      els: [
        { k: 'ppk:activity-open-link', l: 'Open Tikkie link', x: 0.08, y: 0.56, w: 0.84, h: 0.07 },
        { k: 'ppk:activity-close', l: 'Close', x: 0.08, y: 0.66, w: 0.84, h: 0.05 },
      ] },
    { id: 'account', weight: 0.06, exit: 0.44, scroll: 0.74, next: [['home', 0.86], ['login', 0.14]],
      els: [
        { k: 'ppk:account-email', l: 'Save your balance', x: 0.06, y: 0.2, w: 0.88, h: 0.06 },
        { k: 'ppk:account-name', l: 'Edit name', x: 0.06, y: 0.3, w: 0.88, h: 0.06 },
        { k: 'ppk:account-close', l: 'Close', x: 0.06, y: 0.68, w: 0.88, h: 0.06 },
      ] },
    { id: 'login', weight: 0.04, exit: 0.5, scroll: 0.25, next: [['home', 1]],
      els: [
        { k: 'ppk:login-email', l: 'Email', x: 0.08, y: 0.4, w: 0.84, h: 0.06 },
        { k: 'ppk:login-send', l: 'Send code', x: 0.08, y: 0.5, w: 0.84, h: 0.07 },
      ] },
    { id: 'impact', weight: 0.02, exit: 0.54, scroll: 0.6, next: [['home', 1]],
      els: [{ k: 'ppk:impact-close', l: 'Close', x: 0.08, y: 0.62, w: 0.84, h: 0.06 }] },
    { id: 'scan-camera', weight: 0.02, exit: 0.3, scroll: 0.1, next: [['popup-credited', 0.66], ['home', 0.34]],
      els: [{ k: 'ppk:scan-close', l: 'Close', x: 0.85, y: 0.05, w: 0.1, h: 0.04 }] },
    { id: 'privacy-policy', weight: 0, exit: 0.6, scroll: 0.9, next: [['home', 1]],
      els: [{ k: 'ppk:policy-close', l: 'Close', x: 0.08, y: 0.9, w: 0.84, h: 0.05 }] },
  ],
};

/* How the demo's screens are painted.
 *
 * The real thing measures each piece's colour, corner and type size off
 * the live DOM (src/lib/uxCapture.js). The demo has no DOM, so it derives
 * a plausible look from what the control IS — a primary action, a card, a
 * quiet link — in the PackPerks palette. Same element shape as capture
 * produces, so ScreenPaint cannot tell the two apart.
 */
const UX_PALETTE = {
  page: '#FFF6F0',
  card: '#FFFFFF',
  ink: '#241A16',
  muted: '#7A6B63',
  accent: '#E2552B',
  accentInk: '#FFFFFF',
  deep: '#8C3A1E',
  line: '#EDDFD6',
};

const PRIMARY_RE = /collect|redeem|claim|confirm|donate|submit|send|add-cups|done|ok|choose|get-my/;
const CARD_RE    = /card|row|tile|reward|store|activity|balance|wallet|hero|step|howpaid|bins|history|frame|image|map/;
const QUIET_RE   = /close|back|cancel|terms|policy|delete|torch|slider|filter/;

function uxPaint(el) {
  const k = `${el.k} ${el.l || ''}`.toLowerCase();
  const wide = (el.w || 0) > 0.5;
  if (PRIMARY_RE.test(k) && wide) {
    return { t: 'btn', bg: UX_PALETTE.accent, fg: UX_PALETTE.accentInk, br: 0.075, fs: 0.042, fw: '700', ta: 'center' };
  }
  if (CARD_RE.test(k)) {
    return { t: 'btn', bg: UX_PALETTE.card, fg: UX_PALETTE.ink, br: 0.05, fs: 0.036, fw: '600', bw: 0.003, bc: UX_PALETTE.line };
  }
  if (QUIET_RE.test(k)) {
    return { t: 'btn', bg: null, fg: UX_PALETTE.muted, br: 0.02, fs: 0.033, fw: '500', ta: 'center' };
  }
  return { t: 'btn', bg: UX_PALETTE.card, fg: UX_PALETTE.deep, br: 0.06, fs: 0.038, fw: '600', bw: 0.003, bc: UX_PALETTE.line, ta: 'center' };
}

/* A heading and a line of copy above the controls, so a demo screen reads
 * as a screen rather than a column of buttons. The two modes are two
 * different apps, so their home screens do not say the same thing. */
const UX_HEADINGS = {
  standard: { home: ['Return your cup.', 'Collect cups, unlock a reward.'] },
  tikkie: { home: ['Your refunds.', 'Collect them whenever you like.'] },
};

function uxChrome(screen, modeKey) {
  const [title, sub] = UX_HEADINGS[modeKey]?.[screen]
    || [screenTitle(screen), modeKey === 'tikkie' ? 'Your refunds, in one place.' : 'Collect cups, unlock a reward.'];
  return [
    { k: `${screen}:title`, l: title, t: 'text', x: 0.06, y: 0.035, w: 0.72, h: 0.028,
      bg: null, fg: UX_PALETTE.ink, br: 0, fs: 0.068, fw: '800' },
    { k: `${screen}:sub`, l: sub, t: 'text', x: 0.06, y: 0.068, w: 0.8, h: 0.022,
      bg: null, fg: UX_PALETTE.muted, br: 0, fs: 0.036, fw: '500' },
  ];
}

function screenTitle(id) {
  const words = String(id).replace(/^popup-/, '').replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const UX_DEVICES = ['mobile', 'tablet', 'desktop'];
const UX_DEVICE_WEIGHT = [0.83, 0.06, 0.11];
const UX_ENTRIES = ['receipt_qr', 'direct', 'shared', 'social', 'website', 'in_app'];
const UX_ENTRY_WEIGHT = [0.46, 0.24, 0.12, 0.09, 0.05, 0.04];

/* A normal-ish draw around a centre, clipped — thumbs land near a button,
 * not exactly on its middle. */
function jitter(rand, centre, spread) {
  const g = (rand() + rand() + rand() - 1.5) / 1.5;   // −1…1, bunched at 0
  return Math.min(1, Math.max(0, centre + g * spread));
}

function generateUx(orgId, modeKey) {
  const rand = mulberry32(hashSeed(`${orgId}:ux:${modeKey}`));
  const now = Date.now();
  const end = Math.floor(now / HOUR) * HOUR;
  const start = end - DAYS * DAY;
  const screens = UX_SCREENS[modeKey] || UX_SCREENS.standard;
  const byId = new Map(screens.map(s => [s.id, s]));
  const entries = screens.filter(s => s.weight > 0);

  const sessions = [];
  const events = [];
  const layouts = [];

  // One layout row per screen and device: the screen the heat lies on.
  for (const s of screens) {
    if (!s.els.length) continue;
    const painted = [
      ...uxChrome(s.id, modeKey),
      ...s.els.map(e => ({ k: e.k, l: e.l, x: e.x, y: e.y, w: e.w, h: e.h, ...uxPaint(e) })),
    ];
    for (const device of UX_DEVICES) {
      layouts.push({
        org_id: orgId, screen: s.id, device, elements: painted,
        page: UX_PALETTE.page,
        vw: device === 'mobile' ? 390 : device === 'tablet' ? 834 : 1440,
        vh: device === 'mobile' ? 780 : device === 'tablet' ? 1024 : 900,
        dh: device === 'mobile' ? 1560 : device === 'tablet' ? 1500 : 1300,
        seen: 1, updated_at: new Date(end).toISOString(),
      });
    }
  }

  const TOTAL = 520 + Math.floor(rand() * 180);
  for (let i = 0; i < TOTAL; i++) {
    // Skewed toward the recent end, then nudged by the weekday rhythm the
    // rest of the demo uses, so the daily lines have the same shape.
    let startMs = start + Math.pow(rand(), 0.7) * (end - start);
    if (rand() > WEEKDAY_WEIGHT[new Date(startMs).getDay()] / 1.18) {
      startMs = start + Math.pow(rand(), 0.7) * (end - start);
    }
    const sessionId = `demo-${modeKey}-${i.toString(36).padStart(4, '0')}`;
    const device = weightedPick(rand, UX_DEVICES, UX_DEVICE_WEIGHT);
    const vw = device === 'mobile' ? 390 : device === 'tablet' ? 834 : 1440;
    const vh = device === 'mobile' ? 780 : device === 'tablet' ? 1024 : 900;

    let t = startMs;
    let seq = 0;
    let screen = weightedPick(rand, entries.map(s => s.id), entries.map(s => s.weight));
    let clicks = 0; let rage = 0; let dead = 0; let views = 0;
    let firstTapMs = null; let maxScroll = 0;
    const seen = new Set();
    const hops = 1 + Math.floor(Math.pow(rand(), 1.6) * 5);

    for (let h = 0; h < hops; h++) {
      const def = byId.get(screen);
      if (!def) break;
      const dh = Math.round(vh * (1 + (def.scroll || 0.3) * 1.4));
      const screenAt = t;
      seen.add(screen);
      views += 1;
      events.push({
        org_id: orgId, session_id: sessionId, user_id: null, seq: seq++, kind: 'view',
        screen, target: null, label: null, x: null, y: null, yv: null,
        vw, vh, dh, depth: 0, t_ms: 0, at: new Date(t).toISOString(),
      });

      // Reading the screen: how far down this visit got.
      const reach = Math.min(1, (def.scroll || 0.3) * (0.4 + rand() * 0.9));
      if (reach > 0.08) {
        const stepsDown = 1 + Math.floor(reach * 5);
        for (let s = 1; s <= stepsDown; s++) {
          t += 700 + rand() * 2600;
          const depth = Math.min(1, (reach * s) / stepsDown);
          if (depth > maxScroll) maxScroll = depth;
          events.push({
            org_id: orgId, session_id: sessionId, user_id: null, seq: seq++, kind: 'scroll',
            screen, target: null, label: null, x: null, y: null, yv: null,
            vw, vh, dh, depth, t_ms: Math.round(t - screenAt), at: new Date(t).toISOString(),
          });
        }
      }

      // Taps. Most land on a control; a few land on nothing, and now and
      // then a control does not react and the thumb goes again.
      const taps = def.els.length ? Math.floor(rand() * 3) + (h === hops - 1 ? 0 : 1) : 0;
      for (let c = 0; c < taps; c++) {
        t += 900 + rand() * 5200;
        const onControl = def.els.length && rand() > 0.14;
        const el = onControl ? def.els[Math.floor(Math.pow(rand(), 1.7) * def.els.length)] : null;
        const x = el ? jitter(rand, el.x + el.w / 2, Math.max(0.03, el.w * 0.32)) : jitter(rand, 0.5, 0.3);
        const y = el ? jitter(rand, el.y + el.h / 2, Math.max(0.015, el.h * 0.4)) : jitter(rand, 0.45, 0.26);
        const raging = !!el && rand() < 0.035;
        const kind = raging ? 'rage' : el ? 'click' : 'dead';
        clicks += 1;
        if (kind === 'rage') rage += 1;
        if (kind === 'dead') dead += 1;
        if (firstTapMs == null) firstTapMs = Math.round(t - startMs);
        events.push({
          org_id: orgId, session_id: sessionId, user_id: null, seq: seq++, kind,
          screen, target: el ? el.k : null, label: el ? el.l : null,
          x, y, yv: Math.min(1, y * 1.4), vw, vh, dh,
          depth: null, t_ms: Math.round(t - screenAt), at: new Date(t).toISOString(),
        });
      }

      t += 600 + rand() * 4000;
      if (rand() < (def.exit || 0.3) || h === hops - 1 || !def.next?.length) break;
      screen = weightedPick(rand, def.next.map(n => n[0]), def.next.map(n => n[1]));
    }

    events.push({
      org_id: orgId, session_id: sessionId, user_id: null, seq: seq++, kind: 'leave',
      screen, target: null, label: null, x: null, y: null, yv: null,
      vw, vh, dh: Math.round(vh * 1.6), depth: maxScroll || null,
      t_ms: null, at: new Date(t).toISOString(),
    });

    sessions.push({
      session_id: sessionId, org_id: orgId, user_id: null,
      mode: modeKey === 'tikkie' ? 'tikkie_only' : 'standard',
      device, entry: weightedPick(rand, UX_ENTRIES, UX_ENTRY_WEIGHT),
      started_at: new Date(startMs).toISOString(),
      last_at: new Date(t).toISOString(),
      duration_ms: Math.max(0, Math.round(t - startMs)),
      screens: views, screen_list: [...seen],
      clicks, rage, dead,
      max_scroll: maxScroll || null,
      first_tap_ms: firstTapMs,
      last_screen: screen,
      replay: true,
      events: seq,
      created_at: new Date(startMs).toISOString(),
    });
  }

  return { sessions, events, layouts, window: { start, end } };
}

const UX_CACHE = new Map();

/** Rows for the User flow readers — the demo's own visits. */
export function demoUxRows(orgId, modeKey = 'standard') {
  const key = `${orgId || 'default'}:${modeKey}`;
  if (!UX_CACHE.has(key)) UX_CACHE.set(key, generateUx(String(orgId || 'default'), modeKey));
  return UX_CACHE.get(key);
}
