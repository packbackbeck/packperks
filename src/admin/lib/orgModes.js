/* Org-level operating mode (distinct from the GROUP copy mode in
 * copyPresets.js — deposit/byo stay group concepts).
 *
 *   • null / 'standard' — the full PackPerks app: rewards, accounts,
 *     receipts, claims. Every existing org.
 *   • 'tikkie_only'     — smart-bin cashback. The customer app never
 *     boots: scanning a bin receipt QR shows a tiny redirect page that
 *     turns the batch straight into a Tikkie link. No account, no
 *     rewards, no balance. The dashboard collapses to the Receipt
 *     Generator + a Tikkie payout log.
 *
 * Stored on the org's published config: published:<orgId>.settings.mode.
 */
export const ORG_MODE_TIKKIE_ONLY = 'tikkie_only';

export const ORG_MODE_META = {
  standard: {
    key: 'standard',
    label: 'Standard app',
    blurb: 'The full customer app: rewards, cup balance, accounts and receipt claims.',
  },
  tikkie_only: {
    key: ORG_MODE_TIKKIE_ONLY,
    label: 'Tikkie only (smart bin)',
    blurb: 'Scanning a bin receipt QR goes straight to a Tikkie cashback link. No accounts, no rewards — the dashboard shows only the Receipt Generator and the payout log.',
  },
};

/* Admin pages that still make sense for a tikkie-only org. Everything else
 * (rewards, claims review, users, analytics…) is hidden from the sidebar,
 * blocked in the router AND filtered from the command palette. */
export const TIKKIE_ONLY_PAGES = new Set([
  'cupqr',        // Receipt Generator — mints the same batches the bin does
  'tikkielog',    // the payout log
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
    label: 'Direct refund + rewards',
    tagline: 'The full SmartBin programme',
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
    label: 'Rewards only',
    tagline: 'Bring your own cup',
    customer: 'Customers bring a reusable cup, scan the QR on the counter, and collect cups toward a reward. No deposit and no direct cash-out.',
    dashboard: 'Rewards, claims review, users and the BYO QR codes page.',
    group: 'required',
    steps: { rewards: true, copy: true, features: true },
    defaults: {
      cashbackRatePerCup: 1.25,
      refundRatePerCup: 1.00,
      featureCupSharing: true,
      featureDonations: true,
      // "Rewards only" is the whole point — cashing out would bypass it.
      featureDirectRefunds: false,
    },
  },
  tikkie_only: {
    key: 'tikkie_only',
    label: 'Direct refund only',
    tagline: 'Smart bin → Tikkie',
    customer: 'Scanning the bin receipt goes straight to a Tikkie cashback link. No app, no account, no rewards — the customer never sees a PackPerks screen beyond a one-second redirect.',
    dashboard: 'Just two pages: the Receipt Generator and the Tikkie payouts log.',
    group: 'never',
    steps: { rewards: false, copy: false, features: false },
    defaults: {
      // Per-cup payout. Each Tikkie mint carries a transaction fee, so this
      // starts low and deliberately conservative.
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
  'featureCupSharing', 'featureDonations', 'featureDirectRefunds',
  'maxHoldBalance', 'holdCapMessage',
  'maxCupsPerDay', 'dailyCapMessage',
  'balanceResetDays', 'resetWarningMessage',
  'budgetPausedTitle', 'budgetPausedBody',
];

export function stripSettingsForMode(settings) {
  if (!settings || settings.mode !== ORG_MODE_TIKKIE_ONLY) return settings;
  const out = { ...settings };
  for (const k of TIKKIE_ONLY_STRIP_KEYS) delete out[k];
  return out;
}
