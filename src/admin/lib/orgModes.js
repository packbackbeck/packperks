/* The three CUSTOMER APPS a venue can run. Since ways in and out
 * (lib/flowModes.js) these are storage and plumbing, not what a person
 * reads: the dashboard names a venue by its ways. The labels below are only
 * for the few places that must say which app runs (the wallet or the
 * rewards). The old names, kept here for the code keys:
 *
 *   Deposit Rewards  ('standard', group copy mode 'deposit')
 *       The full customer app: cup balance, rewards, direct refunds,
 *       receipt claims.
 *   Bring Your Own   (group copy mode 'byo')
 *       Customers bring their own cup and scan the counter QR. Always
 *       lives in a group.
 *   Deferred Tikkie  ('tikkie_only')
 *       Smart-bin refunds. Scanning a bin receipt adds its refund to the
 *       customer's wallet; they collect the whole balance later as one
 *       Tikkie link. No rewards.
 *
 * The code keys are storage and stay as they are. Anything a person reads
 * uses the three names above — older labels ("Redirect Refund", "Direct
 * refund only", "Rewards only") described flows that no longer exist.
 *
 * tikkie_only is stored on the org's own published config
 * (published:<orgId>.settings.mode); byo/deposit live on the group.
 */
export const ORG_MODE_TIKKIE_ONLY = 'tikkie_only';

export const ORG_MODE_META = {
  standard: {
    key: 'standard',
    label: 'Rewards',
    short: 'R',
    blurb: 'The rewards app: cups build up toward a reward (Reward Cashback or Reward Slider Voucher).',
  },
  byo: {
    key: 'byo',
    label: 'Rewards · BYO group',
    short: 'BYO',
    blurb: 'The rewards app, in a BYO group: customers bring their own cup and the copy speaks to that.',
  },
  tikkie_only: {
    key: ORG_MODE_TIKKIE_ONLY,
    label: 'Deferred Refund',
    short: 'DR',
    blurb: 'The wallet app: each return adds money to a wallet, collected later as one Tikkie link. No rewards.',
  },
};

/* Resolve the org's EFFECTIVE mode from the two places a mode can live:
 * the org's own published settings (tikkie_only) and its group's config
 * (byo / deposit). This is the one to use for chrome (top bar, sidebar,
 * settings shape) — activeOrgMode alone misses grouped BYO orgs. */
/* A venue with no mode anywhere takes its group's default. A group with no
 * mode set is Bring Your Own (see normalizeMode), and OrgContext already
 * resolves that before it reaches here, so `groupMode` is only null for a
 * venue that has no group at all — which is Deposit Rewards. */
export function resolveEffectiveMode(orgMode, groupMode) {
  if (orgMode === ORG_MODE_TIKKIE_ONLY) return ORG_MODE_TIKKIE_ONLY;
  if (groupMode === 'byo') return 'byo';
  return 'standard';
}

/* Admin pages that still make sense for a tikkie-only org. Everything else
 * (rewards, claims review, users, analytics…) is hidden from the sidebar,
 * blocked in the router AND filtered from the command palette. */
export const TIKKIE_ONLY_PAGES = new Set([
  'overview',     // Dashboard — wallet credits, Tikkie payouts, donations
  'cupqr',        // Dynamic QR code — mints the same batches the bin does
  'tikkielog',    // the payout log
  'donations',    // wallet balances given to the charity partner
  'backupcups',   // the bin's offline fallback codes + outage alarm
  'smartbins',    // the bin locations behind the customer map
  'emailtemplates', // the automated customer emails
  // Deferred Tikkie has a real user base (profiles + accounts), so the
  // audience pages are back — each one adapts itself to this mode.
  'users',        // refund profiles + accounts
  'behaviour',    // tikkie funnel metrics (links, collect rate, audience)
  'stats',        // System Health — org-scoped ops events, mode-agnostic
  'reports',      // Reports & alerts + the automated email reports
  'settings',     // rate config + org profile + team
  'org',          // legacy alias that redirects to settings
  'organizations',// org switcher / management (PackPerks staff)
  'history',      // audit log
  'support',      // support inbox
]);

/* ── The three programme models a new org can be created as ──────────
 *
 * These are the plain-language choices PackPerks staff actually make in
 * the onboarding wizard. Each maps onto the storage the rest of the
 * system already reads:
 *
 *   deposit     → group copy mode 'deposit' (copyPresets.js). Full app.
 *   byo         → group copy mode 'byo'. REQUIRES a group: byo-mint
 *                 rejects any org whose group config isn't mode 'byo'
 *                 (`not_grouped` / `not_byo`), so a groupless BYO org
 *                 physically cannot mint a cup.
 *   tikkie_only → org-level settings.mode = 'tikkie_only'. Never grouped:
 *                 there is no app, no market hub and no shared profile
 *                 to belong to.
 *
 * `group` is the rule the wizard enforces at the group step.
 */
export const ORG_MODELS = {
  deposit: {
    key: 'deposit',
    label: 'Deposit · Rewards',
    tagline: 'SmartBin Receipt QR → Reward',
    customer: 'Customers drop their packaging in the SmartBin, scan the printed receipt, and choose: cash out straight away, or save cups toward a menu reward.',
    dashboard: 'The whole dashboard — rewards, claims review, users, cup scans and analytics.',
    group: 'optional',
    steps: { rewards: true, copy: true, features: true },
    defaults: {
      cashbackRatePerCup: 1.25,
      refundRatePerCup: 1.00,
      featureCupSharing: true,
      featureDonations: true,
      featureDirectRefunds: true,
    },
  },
  byo: {
    key: 'byo',
    label: 'BYO · Rewards',
    tagline: 'Static QR tent or Staff App → Reward',
    customer: 'Customers bring a reusable cup, scan the QR on the counter, and collect cups toward a reward. No deposit and no direct cash-out.',
    dashboard: 'Rewards, claims review, users and the BYO QR codes page.',
    group: 'required',
    steps: { rewards: true, copy: true, features: true },
    defaults: {
      cashbackRatePerCup: 1.25,
      refundRatePerCup: 1.00,
      featureCupSharing: true,
      featureDonations: true,
      // Rewards are the whole point here — cashing out would bypass them.
      featureDirectRefunds: false,
    },
  },
  tikkie_only: {
    key: 'tikkie_only',
    label: 'Deposit · Deferred Refund',
    tagline: 'SmartBin Receipt QR → Deferred Refund',
    customer: 'Customers drop their packaging in the SmartBin and scan the printed receipt. The refund goes into their wallet, and they collect the whole balance whenever they like as one Tikkie link. No account is needed to start; adding an email keeps the balance safe on a new phone.',
    dashboard: 'The Receipt Generator, the Tikkie payout log, backup cups, bin locations, customer emails, customers, behaviour, system health and reports. No rewards pages.',
    group: 'never',
    steps: { rewards: false, copy: false, features: false },
    defaults: {
      // Per-cup payout. Starts low and deliberately conservative — this is
      // real money leaving the venue's Tikkie cashback account per cup.
      cashbackRatePerCup: 0.10,
      refundRatePerCup: 0.10,
      featureCupSharing: false,
      featureDonations: false,
      featureDirectRefunds: false,
    },
  },
};

export const ORG_MODEL_ORDER = ['deposit', 'byo', 'tikkie_only'];

/* Settings keys that only describe app / reward / cup-balance machinery.
 * A tikkie-only org runs none of it, so these are stripped on publish —
 * otherwise the published config keeps advertising rewards, donations and
 * sharing that mode can't deliver. */
const TIKKIE_ONLY_STRIP_KEYS = [
  'cashbackRatePerCup',            // one rate only: refundRatePerCup
  'heroHeadline', 'heroSubtext',
  'donationRecipient', 'donationDescription',
  'maxCupsPerScan', 'maxCupsToShare', 'receiptMaxAgeDays',
  // featureDonations is NOT stripped: Donation is a way out the wallet has
  // too, and stripping it left the switch impossible to turn off.
  'featureCupSharing', 'featureDirectRefunds',
  'maxHoldBalance', 'holdCapMessage',
  'maxCupsPerDay', 'dailyCapMessage',
  'balanceResetDays', 'resetWarningMessage',
  'budgetPausedTitle', 'budgetPausedBody',
  'rewardExpiryMonths',            // no rewards to expire in this mode
];

export function stripSettingsForMode(settings) {
  if (!settings || settings.mode !== ORG_MODE_TIKKIE_ONLY) return settings;
  const out = { ...settings };
  for (const k of TIKKIE_ONLY_STRIP_KEYS) delete out[k];
  return out;
}
