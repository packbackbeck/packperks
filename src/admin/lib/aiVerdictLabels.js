/* ─────────────────────────────────────────────────────────────────────
 * aiVerdictLabels — single source of truth for human-readable labels
 * attached to the `ai_failure_checks` codes emitted by the
 * verify-receipt edge function.
 *
 * Used by:
 *   • admin claim detail panel (src/admin/claims/ClaimDetailPanel.jsx)
 *     — renders chips for each failed/passed check
 *   • user-facing rejected page (src/components/ReceiptRejectedPage.jsx)
 *     — picks the headline copy from the first failed check
 *
 * Keeping the map in one place means the admin and user surfaces stay
 * in lockstep when we add new checks (today's example: the
 * `is_newer_than_cup_return` guard added alongside this module).
 *
 * Brand-aware labels: `is_authentic_burger_king` is currently named
 * after the original BK pilot org, but the check itself just verifies
 * "matches the active org's brand". Pass `partnerBrand` (the org's
 * `partner_brand_name`) to get a brand-correct label instead of "BK".
 * ───────────────────────────────────────────────────────────────────── */

/* Manual-review threshold: if confidence is below this AND no check
 * outright failed, surface a "needs human eyes" pill. Admin can still
 * approve, but we don't auto-trust. Tuned conservatively higher than
 * the 0.5 used inside the edge function (which is the auto-FAIL
 * floor) and lower than 0.92 (the auto-APPROVE ceiling). */
export const AI_MANUAL_REVIEW_CONFIDENCE = 0.6;

/* All known failure codes. Keep ordered roughly by severity — the
 * user-facing page picks the first failed code from this list for its
 * headline so the most "actionable" failure surfaces first. */
const FAILURE_INFO = {
  is_receipt: {
    short: 'Not a receipt',
    long:  'Not a receipt',
    icon:  '🧾',
    title:    "We couldn't read a receipt in your photo",
    hint:     'Make sure the receipt is fully visible, in focus, and not cropped.',
    nextStep: 'Re-take the photo straight-on, with the whole receipt inside the frame.',
  },
  is_authentic_burger_king: {
    short: 'Wrong brand',
    long:  'Wrong brand',
    icon:  '🏷️',
    title:    "We couldn't confirm this is a {brand} receipt",
    hint:     'We look for the brand logo, brand-specific menu items, and a real printed total.',
    nextStep: 'Upload a receipt from a participating {brand} location only.',
  },
  contains_required_item: {
    short: 'Wrong item',
    long:  'Wrong item',
    icon:  '🍔',
    title:    "Your reward item isn't on this receipt",
    hint:     "The receipt has to include the menu item you're claiming a cashback for.",
    nextStep: 'Buy the reward item and upload the new receipt from that purchase.',
  },
  is_newer_than_cup_return: {
    short: 'Too old',
    long:  'Receipt too old',
    icon:  '🕒',
    title:    'This receipt is older than your cup return',
    hint:     'The receipt must be dated AFTER you returned your cups, not before.',
    nextStep: 'Buy the reward item now (after returning your cups) and upload that new receipt.',
  },
  duplicate_receipt: {
    short: 'Duplicate',
    long:  'Already used',
    icon:  '🔁',
    title:    'This receipt has already been used',
    hint:     'Each receipt can only be claimed once.',
    nextStep: 'Buy the reward item again and upload the new receipt.',
  },
  /* Inappropriate-image code is intentionally vague in the user-facing
   * copy. We do NOT want to surface category labels ("nsfw", "violence")
   * to the customer — partly because that's the right behaviour for any
   * moderation flow, partly because false positives feel less bad when
   * the message is neutral. Admin UI sees the real category. */
  inappropriate_image: {
    short: 'Image hidden',
    long:  'Image hidden by moderation',
    icon:  '🛡️',
    title:    "This image couldn't be processed",
    hint:     'Please upload a clear photo of your receipt.',
    nextStep: 'Re-take a photo of the printed receipt itself and try again.',
  },
};

/* Labels for the positive form ("Is a receipt", "Contains reward
 * item", etc.) used in the admin panel's pass/fail list. We don't
 * surface these to end users — the user-facing rejected page focuses
 * on what FAILED, not what passed. */
const PASS_LABELS = {
  is_receipt:               'Is a receipt',
  is_authentic_burger_king: 'Real {brand} receipt',
  contains_required_item:   'Contains reward item',
  is_newer_than_cup_return: 'Dated after cup return',
  duplicate_receipt:        'Not a duplicate',
  inappropriate_image:      'Safe image',
};

function substituteBrand(s, partnerBrand) {
  if (!s.includes('{brand}')) return s;
  return s.replaceAll('{brand}', partnerBrand || 'partner');
}

/* Human-readable failure label for an admin chip or a CSV export.
 *   getFailureLabel('is_authentic_burger_king', { partnerBrand: 'KFC' })
 *     → 'Wrong brand'   (or you can call getFailureLabel with .long for
 *                        explicit "Wrong brand (expected KFC)"). */
export function getFailureLabel(code, opts = {}) {
  const info = FAILURE_INFO[code];
  if (!info) return code;
  if (code === 'is_authentic_burger_king' && opts.partnerBrand) {
    return `Wrong brand (expected ${opts.partnerBrand})`;
  }
  return opts.long ? info.long : info.short;
}

/* Positive-form label, e.g. "Real KFC receipt". Used by admin to show
 * the checklist of what the AI verified. */
export function getPassLabel(code, opts = {}) {
  const tmpl = PASS_LABELS[code];
  if (!tmpl) return code;
  return substituteBrand(tmpl, opts.partnerBrand);
}

/* Full "what went wrong + what to do next" copy block for the
 * user-facing rejected page. Returns { icon, title, hint, nextStep }
 * with the {brand} placeholders already substituted. */
export function getFailureCopy(code, opts = {}) {
  const info = FAILURE_INFO[code];
  if (!info) {
    return {
      icon:  '⚠️',
      title: "We couldn't verify your receipt",
      hint:  'Please try again with a clearer photo.',
      nextStep: 'Re-take the photo or contact support.',
    };
  }
  return {
    icon:     info.icon,
    title:    substituteBrand(info.title,    opts.partnerBrand),
    hint:     substituteBrand(info.hint,     opts.partnerBrand),
    nextStep: substituteBrand(info.nextStep, opts.partnerBrand),
  };
}

/* Full list of supported failure codes — useful for tests, defaults,
 * and the admin's "label every check" rendering. Order matches the
 * keys in FAILURE_INFO above so the most-actionable codes lead. */
export const ALL_FAILURE_CODES = Object.keys(FAILURE_INFO);
