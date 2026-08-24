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
