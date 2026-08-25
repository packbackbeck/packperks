/* Printed bin-receipt copy, per org model.
 *
 * The same receipt is rendered three ways — the on-screen preview in
 * AdminCupQr, the mono canvas image for the Epson printer, and the ESC/POS
 * text fallback — so the wording lives here once instead of drifting across
 * all three.
 *
 *   'standard'  — deposit/BYO orgs: the QR opens the PackPerks app, where
 *                 the customer tracks returns and unlocks rewards.
 *   'tikkie'    — tikkie-only orgs: the QR pays out immediately via Tikkie.
 *                 There is no app, no account and no reward to unlock, so
 *                 every promise of one is removed.
 *
 * `icon` indexes the shapes drawFeatureIcon() knows: 0 = euro note,
 * 1 = gift box, 2 = bar chart.
 */
export const RECEIPT_COPY = {
  standard: {
    titleLines: ['GET YOUR REFUND', 'AND REWARDS'],
    lede: 'Use PackPerks to access your deposit, track returns, and unlock extra rewards.',
    ledeJsx: ['Use ', 'PackPerks', ' to access your deposit, track returns, and unlock extra rewards.'],
    features: [
      { icon: 0, emoji: '💸', lines: ['Access your', 'deposit'] },
      { icon: 1, emoji: '🎁', lines: ['Earn more from', 'repeat returns'] },
      { icon: 2, emoji: '🌍', lines: ['Keep track of', 'your progress'] },
    ],
    cta: 'Scan to start with PackPerks',
    assureLines: ['No app and no registration needed.', 'Fast and secure.'],
    note: 'You can still directly refund in the same app by clicking on the user icon top-right.',
    noteEscPos: ['You can still directly refund in the same', 'app by tapping the user icon top-right.'],
  },
  tikkie: {
    titleLines: ['GET YOUR', 'REFUND'],
    lede: 'Scan the QR code and your refund is paid out right away through Tikkie.',
    ledeJsx: ['Scan the QR code and your refund is paid out right away through ', 'Tikkie', '.'],
    features: [
      { icon: 0, emoji: '💸', lines: ['Paid out', 'via Tikkie'] },
      { icon: 2, emoji: '⚡', lines: ['Takes', 'seconds'] },
      { icon: 1, emoji: '🙌', lines: ['No app, no', 'account needed'] },
    ],
    cta: 'Scan to get your refund',
    assureLines: ['No app and no registration needed.', 'Fast and secure.'],
    // Deliberately empty: there is no app to open, so the standard receipt's
    // "refund in the app" line would send the customer nowhere.
    note: '',
    noteEscPos: [],
  },
};

export function getReceiptCopy(variant) {
  return RECEIPT_COPY[variant] || RECEIPT_COPY.standard;
}
