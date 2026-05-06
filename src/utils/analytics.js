/**
 * Analytics / event tracking stub for PackPerks Phase 1.
 *
 * In production, replace the body of `track()` with your real analytics
 * provider (Mixpanel, Amplitude, PostHog, GA4, etc.).
 *
 * All events include an automatic `timestamp` and `session_id`.
 */

const SESSION_ID = crypto.randomUUID?.() || Math.random().toString(36).slice(2);

const EVENTS = {
  REWARD_SELECTED:       'reward_selected',
  CUP_ADDED:             'cup_added',
  REWARD_CLAIM_ATTEMPTED:'reward_claim_attempted',
  REWARD_CLAIM_SUCCESS:  'reward_claim_success',
  DIRECT_REFUND_OPENED:  'direct_refund_opened',
  WITHDRAW_ALL_CUPS:     'withdraw_all_cups',
  TERMS_OPENED:          'terms_opened',
  SHARE_CUP:             'share_cup',
};

/**
 * Track a named event with optional properties.
 * @param {string} eventName — one of the EVENTS constants
 * @param {Record<string, unknown>} [props] — arbitrary event metadata
 */
function track(eventName, props = {}) {
  const payload = {
    event: eventName,
    session_id: SESSION_ID,
    timestamp: new Date().toISOString(),
    ...props,
  };

  // ── Stub: log to console ──
  // Replace with: analytics.track(eventName, payload);
  console.log(
    `%c[PackPerks] %c${eventName}`,
    'color:#2D6A4F;font-weight:700',
    'color:#E86A10;font-weight:600',
    payload,
  );
}

export { EVENTS, track };
