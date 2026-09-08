/* ─────────────────────────────────────────────────────────────────────
 * paymentMethods — how a venue settles a reward with the customer.
 *
 * One list, shared by the customer app and both admin surfaces (the org's
 * own Settings and the group-wide default), so the label a venue picks is
 * the label everyone sees.
 *
 *   tikkie  — the region's payout provider. The customer uploads a
 *             receipt, it is checked, and money is sent afterwards.
 *   voucher — the slider voucher. Settled face to face at the till: no
 *             receipt, no check, no payout at all.
 *
 * A venue with nothing set inherits its group's choice; a group with
 * nothing set falls back to DEFAULT_PAYMENT_METHOD.
 * ───────────────────────────────────────────────────────────────────── */

export const DEFAULT_PAYMENT_METHOD = 'tikkie';

export const PAYMENT_METHODS = [
  {
    key: 'tikkie',
    label: 'Cashback after review',
    short: 'Cashback',
    blurb: 'The customer buys the reward, uploads a photo of the receipt, and the payout is sent once it is approved.',
    detail: 'Needs a payout provider for the region and an email address from the customer. Claims arrive in the dashboard for review.',
  },
  {
    key: 'voucher',
    label: 'Slider voucher',
    short: 'Slider voucher',
    blurb: 'The customer shows a live voucher card and a staff member slides to confirm. The cups leave the balance on the spot.',
    detail: 'No receipt, no automated check, no payout link, and no email needed. Redemptions are recorded in Claims as settled at the counter.',
  },
];

export const PAYMENT_METHOD_META = Object.fromEntries(PAYMENT_METHODS.map(m => [m.key, m]));

/** Normalise anything stored to a key we know. */
export function normalizePaymentMethod(v) {
  return PAYMENT_METHOD_META[v] ? v : null;
}

/** org setting → group setting → platform default. */
export function resolvePaymentMethod(orgMethod, groupMethod) {
  return normalizePaymentMethod(orgMethod)
    || normalizePaymentMethod(groupMethod)
    || DEFAULT_PAYMENT_METHOD;
}
