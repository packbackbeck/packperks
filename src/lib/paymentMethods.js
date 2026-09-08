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

/* ─────────────────────────────────────────────────────────────────────
 * voucherGuideSteps — the "How does it work?" story, retold for a venue
 * that settles at the counter.
 *
 * The first steps of any guide are about collecting cups and are true
 * either way; only the LAST one differs, because the ending genuinely
 * changes: no receipt to photograph, no wait, no money sent. Rather than
 * keep a second full guide in sync, this swaps that final step and
 * leaves the rest of the venue's own guide alone.
 * ───────────────────────────────────────────────────────────────────── */
export const VOUCHER_FINAL_STEP = {
  title: 'Redeem it at the counter',
  body: 'Once it is unlocked, open your voucher and hand your phone to the staff. They slide to confirm, the cups leave your balance, and the drink is yours — no receipt, no waiting.',
  image: '/how-it-works/byo-4.png',
  bg: 'linear-gradient(165deg, #F1E6F8 0%, #E2D2F2 100%)',
  accent: '#7C4DBE',
  icon: 'cup',
};

export function voucherGuideSteps(steps) {
  if (!Array.isArray(steps) || steps.length === 0) return steps;
  // Keep the venue's own artwork rhythm: reuse the last step's image and
  // palette when it has one, so the swap doesn't stand out.
  const last = steps[steps.length - 1] || {};
  const swapped = {
    ...VOUCHER_FINAL_STEP,
    image: last.image || VOUCHER_FINAL_STEP.image,
    bg: last.bg || VOUCHER_FINAL_STEP.bg,
    accent: last.accent || VOUCHER_FINAL_STEP.accent,
  };
  return [...steps.slice(0, -1), swapped];
}
