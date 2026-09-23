import { fmtInt } from '../ui/timeSeries';

/* ─────────────────────────────────────────────────────────────────────
 * What the User Behaviour page calls each metric, and how it explains it.
 *
 * The numbers come from adminApi (computeMetrics / computeTikkieMetrics);
 * this file only decides the words. Keyed by metric id, so a metric the
 * reader adds later still renders with the reader's own label.
 *
 *   label     — tile title
 *   num, den  — what the two counts are, in plain words
 *   describe  — the short line under the value
 *   info      — the tooltip and the detail view
 *   formula   — how it's calculated
 *   good      — which direction is good news: 'up', 'down', or null when
 *               a change is neither (a claim mix, time spent per visit)
 *   empty     — shown when there is nothing to measure yet
 * ───────────────────────────────────────────────────────────────────── */

const n = (v) => fmtInt(Number(v) || 0);
const of = (noun) => (r) => `${n(r.numerator)} of ${n(r.denominator)} ${noun}`;
const pctOf = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);

export const METRIC_COPY = {
  /* ── Standard and Bring Your Own venues ── */
  qr_scan_receipts: {
    label: 'Receipts scanned',
    num: 'Receipts scanned', den: 'Receipts printed',
    describe: of('printed receipts'),
    info: 'Printed cup receipts that a customer scanned at least once. A receipt nobody scanned still counts in the total.',
    formula: 'scanned receipts ÷ printed receipts',
    good: 'up',
    empty: 'No receipts were printed in this period.',
  },
  second_scan: {
    label: 'Second scan rate',
    num: 'Customers who scanned again', den: 'Receipts scanned',
    describe: (r) => `${n(r.numerator)} came back, from ${n(r.denominator)} scanned receipts`,
    info: 'Customers who came back and scanned a second receipt, measured against every receipt scanned in this period.',
    formula: 'customers with 2+ scans ÷ scanned receipts',
    good: 'up',
    empty: 'No receipts were scanned in this period.',
  },
  avg_second_scan: {
    label: 'Time to second scan',
    num: 'Returning customers measured',
    describe: (r) => `Average across ${n(r.numerator)} returning customers`,
    info: 'The average time between a customer’s first and second scan in this period. Shorter means the habit forms faster.',
    formula: 'average of (2nd scan − 1st scan) per customer',
    good: 'down',
    empty: 'Nobody scanned twice in this period, so there is nothing to average.',
  },
  cup_spent: {
    label: 'Cups spent',
    num: 'Cups spent on claims', den: 'Cups scanned in',
    describe: of('scanned cups'),
    info: 'Cups customers spent on claims, approved or waiting, against the cups they scanned in. Printed cups nobody scanned are left out.',
    formula: 'cups on approved and pending claims ÷ cups scanned in',
    good: 'up',
    empty: 'No cups were scanned in this period.',
  },
  rewards_claim: {
    label: 'Claim rate',
    num: 'Customers who claimed', den: 'Active users',
    describe: of('active users'),
    info: 'Active users who made at least one claim. It is measured against active users, not every profile: someone who only opened the app never had cups to claim with.',
    formula: 'customers with a claim ÷ active users',
    good: 'up',
    empty: 'There were no active users in this period.',
  },
  active_users: {
    label: 'Active users',
    num: 'Active users', den: 'Profiles',
    describe: of('profiles'),
    info: 'Profiles that collected a cup or left an email. The rest only opened the app, often from a shared or poster link, and can’t be reached.',
    formula: 'profiles with a cup or an email ÷ all profiles',
    good: 'up',
    empty: 'No profiles were created in this period.',
  },
  emails_active: {
    label: 'Email capture',
    num: 'Active users with an email', den: 'Active users',
    describe: of('active users'),
    info: 'Active users who left an email, so you can reach them. Visitors who never collected a cup are left out: they had no reason to leave one.',
    formula: 'active users with an email ÷ active users',
    good: 'up',
    empty: 'There were no active users in this period.',
  },
  emails_input: {
    label: 'Email capture, all profiles',
    num: 'Profiles with an email', den: 'Profiles',
    describe: of('profiles'),
    info: 'Profiles with an email, visitors included. Email capture, which counts active users only, is the better number to steer on.',
    formula: 'profiles with an email ÷ all profiles',
    good: 'up',
    empty: 'No profiles were created in this period.',
  },
  changed_rewards: {
    label: 'Visits with a reward pick',
    num: 'Visits with a reward pick', den: 'Visits',
    describe: of('visits'),
    info: 'Visits where the customer picked or switched the reward they are saving for.',
    formula: 'visits with a reward pick ÷ all visits',
    good: null,
    empty: 'No visits were recorded in this period.',
  },
  qr_scan_cups: {
    label: 'Cups scanned',
    num: 'Cups scanned in', den: 'Cups printed',
    describe: of('printed cups'),
    info: 'Printed cups that were scanned in, counted cup by cup instead of per receipt.',
    formula: 'cups scanned in ÷ cups printed',
    good: 'up',
    empty: 'No cups were printed in this period.',
  },
  third_scan: {
    label: 'Third scan rate',
    num: 'Customers with 3+ scans', den: 'Receipts scanned',
    describe: (r) => `${n(r.numerator)} came back twice, from ${n(r.denominator)} scanned receipts`,
    info: 'Customers who scanned a third receipt, measured against every receipt scanned in this period.',
    formula: 'customers with 3+ scans ÷ scanned receipts',
    good: 'up',
    empty: 'No receipts were scanned in this period.',
  },
  third_scan_returning: {
    label: 'Third scan, of returners',
    num: 'Customers with 3+ scans', den: 'Customers with 2+ scans',
    describe: of('returning customers'),
    info: 'Of the customers who came back for a second scan, the share who came back for a third.',
    formula: 'customers with 3+ scans ÷ customers with 2+ scans',
    good: 'up',
    empty: 'Nobody scanned twice in this period.',
  },
  rewards_share: {
    label: 'Claims for a reward',
    num: 'Reward claims', den: 'Claims',
    describe: of('claims'),
    info: 'Claims where the customer chose a reward (cashback or a counter voucher) instead of a refund or a donation.',
    formula: 'reward claims ÷ all claims',
    good: null,
    empty: 'No claims were made in this period.',
  },
  donation_share: {
    label: 'Claims donated',
    num: 'Donation claims', den: 'Claims',
    describe: of('claims'),
    info: 'Claims where the customer donated their cups.',
    formula: 'donation claims ÷ all claims',
    good: null,
    empty: 'No claims were made in this period.',
  },
  ignored_receipts: {
    label: 'Receipts never scanned',
    num: 'Receipts never scanned', den: 'Receipts printed',
    describe: of('printed receipts'),
    info: 'Printed receipts nobody scanned. Each one is a return the programme didn’t capture.',
    formula: 'unscanned receipts ÷ printed receipts',
    good: 'down',
    empty: 'No receipts were printed in this period.',
  },
  avg_session: {
    label: 'Time per visit',
    num: 'Visits measured',
    describe: (r) => `Average across ${n(r.numerator)} visits`,
    info: 'The average time between the first and last thing a customer did in one visit. Visits with a single action are left out.',
    formula: 'average of (last action − first action) per visit',
    good: null,
    empty: 'No visit had more than one action in this period.',
  },
  button_clicks: {
    label: 'Button taps',
    num: 'Taps on tracked buttons',
    describe: (r) => (r.breakdown?.length ? `Most tapped: ${r.breakdown[0].label}` : 'None recorded in this period'),
    info: 'How often customers tapped the app’s main buttons. “What customers tap” further down shows which ones.',
    formula: 'count of tracked button taps',
    good: null,
  },
  entry_source: {
    label: 'App opens',
    num: 'App opens',
    describe: (r) => (r.breakdown?.length ? `Most from: ${breakdownLabel('entry_source', r.breakdown[0])}` : 'None recorded in this period'),
    info: 'How often the app was opened, and where each visit came from: a cup receipt QR, a shared cup, a message or social post, another website, or directly. Opens from before this was tracked show as not tracked.',
    formula: 'count of app opens',
    good: 'up',
  },
  cookie_rejected: {
    label: 'Cookie rejections',
    num: 'Visitors who turned essential cookies off',
    describe: () => 'Visitors who couldn’t use the app',
    info: 'Visitors who turned essential cookies off. The app can’t run without them, so these visitors stop at the cookie screen. They are counted anonymously, so there is no rate to compare with.',
    formula: 'count of cookie rejections',
    good: 'down',
  },
  visitor_rate: {
    label: 'Visitors only',
    num: 'Visitors', den: 'Profiles',
    describe: of('profiles'),
    info: 'Profiles that never collected a cup or left an email, usually opened from a shared or poster link or an in-app browser. They make the raw profile count look bigger than it is.',
    formula: 'profiles with no cup and no email ÷ all profiles',
    good: 'down',
    empty: 'No profiles were created in this period.',
  },
  audience_split: {
    label: 'New profiles',
    num: 'Profiles created',
    describe: (r) => {
      const get = (k) => r.breakdown?.find(b => b.key === k)?.count || 0;
      return `${n(get('active'))} active users, ${n(get('visitor'))} visitors`;
    },
    info: 'Profiles created in this period, split into active users (collected a cup or left an email) and visitors (neither).',
    formula: 'count of profiles created',
    good: 'up',
  },
  last_screen: {
    label: 'Where visits end',
    num: 'Visits that ended there', den: 'Visits with screen data',
    describe: (r) => `${n(r.numerator)} of ${n(r.denominator)} visits (${pctOf(r.numerator, r.denominator)}%)`,
    info: 'The screen customers most often see last before they leave. A screen that ends many visits can point to a drop-off.',
    formula: 'most common last screen per visit',
    good: null,
    empty: 'No screen views were recorded in this period.',
  },
  impact_shares: {
    label: 'Customers who shared',
    num: 'Customers who shared', den: 'Profiles',
    describe: of('profiles'),
    info: 'Customers who shared a cup or their impact with someone else, against the profiles created in this period.',
    formula: 'customers who shared ÷ profiles',
    good: 'up',
    empty: 'No profiles were created in this period.',
  },
  inapp_redirect: {
    label: 'In-app browser prompts',
    num: 'Prompts shown',
    describe: (r) => {
      const opened = r.breakdown?.find(b => b.key === 'opened')?.count || 0;
      return `${pctOf(opened, r.numerator)}% switched to their own browser`;
    },
    info: 'Android in-app browsers (Instagram, Facebook, Telegram and similar) that opened a cup link. The app asks customers to switch to their normal browser so the cup lands on their real account.',
    formula: 'count of prompts shown',
    good: null,
    empty: 'No in-app browser opened a cup link in this period.',
  },

  /* ── Deferred Tikkie venues ── */
  tk_collect: {
    label: 'Links collected',
    num: 'Links collected', den: 'Links issued',
    describe: of('payout links'),
    info: 'Tikkie payout links whose money the customer collected by entering an IBAN, out of every link issued. Statuses refresh when a receipt is scanned again, so this runs a little behind Tikkie.',
    formula: 'collected links ÷ issued links',
    good: 'up',
    empty: 'No payout links were issued in this period.',
  },
  tk_email_capture: {
    label: 'Email capture',
    num: 'Emails captured', den: 'Receipts scanned',
    describe: (r) => `${n(r.numerator)} emails from ${n(r.denominator)} receipts`,
    info: 'How often a scanned receipt leads to someone you can email: a customer with an account, or an email left on the held-for-review screen.',
    formula: '(accounts + emails left on hold) ÷ receipts scanned',
    good: 'up',
    empty: 'No receipts were scanned in this period.',
  },
  tk_audience: {
    label: 'New profiles',
    num: 'Profiles created',
    describe: (r) => {
      const get = (k) => r.breakdown?.find(b => b.key === k)?.count || 0;
      return `${n(get('accounts'))} accounts, ${n(get('profiles'))} on one device`;
    },
    info: 'Every scanner gets a profile on their first scan. Accounts are profiles with a saved email, so the balance survives a lost phone. The rest live on one device only.',
    formula: 'count of profiles created',
    good: 'up',
  },
  tk_account_conv: {
    label: 'Account conversion',
    num: 'Accounts', den: 'Profiles',
    describe: of('profiles'),
    info: 'Profiles that saved an email and became a full account.',
    formula: 'profiles with an email ÷ all profiles',
    good: 'up',
    empty: 'No profiles were created in this period.',
  },
  tk_cookie_rejected: {
    label: 'Cookie rejections',
    num: 'Scanners who turned essential cookies off',
    describe: () => 'Scans stopped at the cookie screen',
    info: 'Scanners who turned essential cookies off. The cookie screen comes before the scan, so nothing was credited and the receipt still works: they can scan it again. Counted anonymously.',
    formula: 'count of cookie rejections',
    good: 'down',
  },
  tk_attached: {
    label: 'Refunds on a profile',
    num: 'Receipts on a profile', den: 'Receipts scanned',
    describe: of('receipts'),
    info: 'Receipts credited to a customer’s balance, so they show in that customer’s history. Every scan since the wallet launched is attached; a gap means older anonymous refunds.',
    formula: 'receipts on a profile ÷ receipts scanned',
    good: 'up',
    empty: 'No receipts were scanned in this period.',
  },
  tk_pending_resolved: {
    label: 'Held receipts confirmed',
    num: 'Confirmed by the bin', den: 'Scanned before confirmation',
    describe: of('held receipts'),
    info: 'Receipts scanned before the bin had confirmed them (the bin prints first), and how many the bin has confirmed since. A low rate means sessions are getting lost on the bin side.',
    formula: 'confirmed ÷ receipts scanned before confirmation',
    good: 'up',
    empty: 'No receipt was scanned before the bin confirmed it.',
  },
  tk_backup_share: {
    label: 'Backup code payouts',
    num: 'Payouts from backup codes', den: 'Receipts scanned',
    describe: of('receipts'),
    info: 'Payouts made from the bin’s reserved offline codes. Anything above zero means the bin was offline at some point.',
    formula: 'payouts from backup codes ÷ receipts scanned',
    good: 'down',
    empty: 'No receipts were scanned in this period.',
  },
  tk_expired: {
    label: 'Links expired',
    num: 'Links expired', den: 'Links issued',
    describe: of('payout links'),
    info: 'Payout links that expired before the customer entered an IBAN. That money was never collected.',
    formula: 'expired links ÷ issued links',
    good: 'down',
    empty: 'No payout links were issued in this period.',
  },
  tk_avg_payout: {
    label: 'Payout per receipt',
    num: 'Receipts scanned',
    describe: (r) => `Average across ${n(r.numerator)} receipts`,
    info: 'The average amount one scanned receipt pays out from the Tikkie cashback account.',
    formula: 'total credited ÷ receipts scanned',
    good: null,
    empty: 'No receipts were scanned in this period.',
  },
  tk_avg_cups: {
    label: 'Cups per receipt',
    num: 'Receipts scanned',
    describe: (r) => `Average across ${n(r.numerator)} receipts`,
    info: 'The average number of cups in one deposited batch.',
    formula: 'cups credited ÷ receipts scanned',
    good: null,
    empty: 'No receipts were scanned in this period.',
  },
};

/* The three sections a metric can sit in. The ids are what the reader and
 * the saved arrangement use; the titles are what people read. */
export const GROUPS = [
  { id: 'primary', title: 'Primary', hint: 'Tiles at the top' },
  { id: 'secondary', title: 'Secondary', hint: 'Supporting numbers', desc: 'Supporting numbers. Click a tile to chart it.' },
  { id: 'optional', title: 'Optional', hint: 'App use and data quality', desc: 'App use and data-quality signals. Click a tile to chart it.' },
];
export const GROUP_TITLE = Object.fromEntries(GROUPS.map(g => [g.id, g.title]));

/* The order and home section of every metric, so the tiles can render as
 * placeholders before the first load. Mirrors the readers in adminApi. */
export const METRIC_ORDER = {
  standard: [
    ['qr_scan_receipts', 'primary'], ['second_scan', 'primary'], ['avg_second_scan', 'primary'],
    ['cup_spent', 'primary'], ['rewards_claim', 'primary'], ['active_users', 'primary'],
    ['emails_active', 'primary'],
    ['emails_input', 'secondary'], ['changed_rewards', 'secondary'], ['qr_scan_cups', 'secondary'],
    ['third_scan', 'secondary'], ['third_scan_returning', 'secondary'], ['rewards_share', 'secondary'],
    ['donation_share', 'secondary'],
    ['ignored_receipts', 'optional'], ['avg_session', 'optional'], ['button_clicks', 'optional'],
    ['entry_source', 'optional'], ['cookie_rejected', 'optional'], ['visitor_rate', 'optional'],
    ['audience_split', 'optional'], ['last_screen', 'optional'], ['impact_shares', 'optional'],
    ['inapp_redirect', 'optional'],
  ],
  tikkie: [
    ['tk_collect', 'primary'], ['tk_email_capture', 'primary'], ['tk_audience', 'primary'],
    ['tk_account_conv', 'primary'],
    ['tk_cookie_rejected', 'secondary'], ['tk_attached', 'secondary'], ['tk_pending_resolved', 'secondary'],
    ['tk_backup_share', 'secondary'], ['tk_expired', 'secondary'],
    ['tk_avg_payout', 'optional'], ['tk_avg_cups', 'optional'],
  ],
};

/* Screen ids the customer app logs (App.jsx `page`), as people say them. */
const SCREEN_NAMES = {
  home: 'Home',
  'cup-scan': 'Cup scan',
  'cup-scan-error': 'Scan error',
  'cup-scan-success': 'Cups added',
  'donate-success': 'Donation done',
  receipt: 'Receipt upload',
  'refund-success': 'Refund done',
  rejected: 'Claim rejected',
  stores: 'Stores',
  success: 'Claim sent',
  user: 'Account',
  account: 'Account',
  verifying: 'Checking receipt',
  voucher: 'Voucher',
  rewards: 'Rewards',
  howto: 'How it works',
  impact: 'Impact',
  unknown: 'Unknown screen',
  // Deferred Tikkie is one page with sheets over it, and TikkieHomePage
  // reports whichever sheet is on top as the screen — a sheet is a screen
  // to the person looking at it (src/lib/uxCapture.js).
  'scan-camera': 'Camera scanner',
  'activity-detail': 'Activity detail',
  'privacy-policy': 'Privacy policy',
  login: 'Sign in',
  'popup-redeem': 'Collect sheet',
  'popup-credited': 'Refund added',
  'popup-donate': 'Donate sheet',
  'popup-donated': 'Donation done',
  'popup-pending': 'Held for review',
  'popup-limit': 'Limit reached',
  'popup-claimed': 'Already claimed',
  'popup-error': 'Scan error',
};
export const ERROR_SCREENS = new Set(['cup-scan-error', 'rejected']);

export function screenName(id) {
  if (!id) return 'Unknown screen';
  if (SCREEN_NAMES[id]) return SCREEN_NAMES[id];
  const s = String(id).replace(/[-_]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* Breakdown rows: the reader's labels, reworded where they read as code. */
const BREAKDOWN_LABELS = {
  entry_source: {
    'Untracked (pre-update)': 'Not tracked (older visits)',
    'Shared cups (in-app)': 'Shared cup',
    'Cup receipt QR': 'Cup receipt QR',
    'Messaging / social': 'Message or social post',
    'In-app browser': 'In-app browser',
    'Other website': 'Another website',
    'Direct / poster QR': 'Direct or poster QR',
  },
  audience_split: { active: 'Active users', visitor: 'Visitors' },
  tk_audience: { accounts: 'Accounts', profiles: 'On one device' },
  inapp_redirect: {
    opened: 'Switched to their browser',
    collected: 'Stayed in the in-app browser',
    pending: 'No choice yet',
  },
};

export function breakdownLabel(metricId, row) {
  const map = BREAKDOWN_LABELS[metricId];
  return (map && (map[row.key] || map[row.label])) || row.label;
}

/* The breakdown cards under the tiles. `sub` takes the period as it reads
 * in a sentence ("in the last 30 days"). */
export const BREAKDOWNS = {
  button_clicks: { title: 'What customers tap', noun: 'taps', sub: (p) => `Taps on the app’s main buttons ${p}` },
  entry_source: { title: 'How customers arrive', noun: 'visits', sub: (p) => `Where each app open came from ${p}` },
  audience_split: { title: 'Active users and visitors', noun: 'profiles', sub: (p) => `Profiles created ${p}, by whether they became active` },
  inapp_redirect: { title: 'In-app browser prompts', noun: 'prompts', sub: (p) => `What customers did ${p} when a cup link opened inside another app` },
  tk_audience: { title: 'Accounts and device-only profiles', noun: 'profiles', sub: (p) => `Profiles created ${p}, by whether they saved an email` },
};
