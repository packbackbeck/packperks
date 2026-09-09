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
export function resetDemoWorld() { CACHE.clear(); }

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
