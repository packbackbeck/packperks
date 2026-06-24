/**
 * Analytics / event tracking for PackPerks.
 *
 * Funnel-relevant events are persisted to the `client_events` table in
 * Supabase so the admin Stats dashboard can compute real funnel metrics
 * (dashboard completeness, user-stuck rate, test-time/uptime boundary).
 * Non-funnel UI events stay console-only to keep the table lean.
 *
 * All events carry an automatic `session_id` + `timestamp`, plus the
 * active org_id / user_id from setAnalyticsContext().
 */

import { supabase } from '../lib/supabase';

const SESSION_ID = crypto.randomUUID?.() || Math.random().toString(36).slice(2);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Module-level context set once the app resolves its org + user. Kept
// outside React so any caller (even non-component code) can track without
// prop-drilling the ids.
const _ctx = { orgId: null, userId: null };

/** Set the active org/user so subsequent track() calls are attributed. */
function setAnalyticsContext({ orgId, userId } = {}) {
  if (orgId !== undefined) _ctx.orgId = orgId || null;
  if (userId !== undefined) _ctx.userId = userId || null;
}

const EVENTS = {
  // ── Funnel events (persisted to client_events for Stats) ──
  APP_LOADED:             'app_loaded',
  SCAN_ATTEMPTED:         'scan_attempted',
  REWARD_SHOWN:           'reward_shown',
  REWARD_CLAIM_ATTEMPTED: 'reward_claim_attempted',
  REWARD_CLAIM_SUCCESS:   'reward_claim_success',
  // ── Behavioural events (persisted to client_events for User Behaviour) ──
  SCREEN_VIEW:            'screen_view',
  REWARD_SELECTED:        'reward_selected',
  DIRECT_REFUND_OPENED:   'direct_refund_opened',
  WITHDRAW_ALL_CUPS:      'withdraw_all_cups',
  TERMS_OPENED:           'terms_opened',
  SHARE_CUP:              'share_cup',
  // ── Button taps (persisted for User Behaviour → Button clicks) ──
  ADD_CUPS_OPENED:        'add_cups_opened',
  BALANCE_OPENED:         'balance_opened',
  ACCOUNT_OPENED:         'account_opened',
  HOWTO_OPENED:           'howto_opened',
  NAME_EDIT_OPENED:       'name_edit_opened',
  NAME_REGENERATED:       'name_regenerated',
  REWARD_CARD_OPENED:     'reward_card_opened',
  // ── UI events (console-only) ──
  CUP_ADDED:              'cup_added',
};

// These hit the database. The first block powers the System Health funnel;
// the second powers the User Behaviour page (screen drop-off, reward changes,
// button interactions, shares, and session time from event timestamps).
const PERSISTED = new Set([
  EVENTS.APP_LOADED,
  EVENTS.SCAN_ATTEMPTED,
  EVENTS.REWARD_SHOWN,
  EVENTS.REWARD_CLAIM_ATTEMPTED,
  EVENTS.REWARD_CLAIM_SUCCESS,
  EVENTS.SCREEN_VIEW,
  EVENTS.REWARD_SELECTED,
  EVENTS.DIRECT_REFUND_OPENED,
  EVENTS.WITHDRAW_ALL_CUPS,
  EVENTS.TERMS_OPENED,
  EVENTS.SHARE_CUP,
  EVENTS.ADD_CUPS_OPENED,
  EVENTS.BALANCE_OPENED,
  EVENTS.ACCOUNT_OPENED,
  EVENTS.HOWTO_OPENED,
  EVENTS.NAME_EDIT_OPENED,
  EVENTS.NAME_REGENERATED,
  EVENTS.REWARD_CARD_OPENED,
]);

/**
 * Track a named event. Funnel events are persisted; all are logged.
 * @param {string} eventName — one of the EVENTS constants
 * @param {Record<string, unknown>} [props] — optional metadata. `org_id`
 *        and `user_id` here override the module context for this event.
 */
function track(eventName, props = {}) {
  const payload = {
    event: eventName,
    session_id: SESSION_ID,
    timestamp: new Date().toISOString(),
    ...props,
  };

  // ── Dev console visibility ──
  console.log(
    `%c[PackPerks] %c${eventName}`,
    'color:#2D6A4F;font-weight:700',
    'color:#E86A10;font-weight:600',
    payload,
  );

  // ── Persist funnel events (fire-and-forget; never throws to caller) ──
  if (PERSISTED.has(eventName)) {
    const { org_id, user_id, ...rest } = props;
    const orgId = org_id || _ctx.orgId || null;
    const rawUid = user_id || _ctx.userId || null;
    const userId = typeof rawUid === 'string' && UUID_RE.test(rawUid) ? rawUid : null;
    try {
      supabase
        .from('client_events')
        .insert({
          org_id: orgId,
          user_id: userId,
          session_id: SESSION_ID,
          event: eventName,
          props: rest,
        })
        .then(({ error }) => {
          if (error) console.warn('client_events insert failed:', error.message);
        });
    } catch (e) {
      console.warn('client_events insert threw:', e);
    }
  }
}

export { EVENTS, track, setAnalyticsContext };
