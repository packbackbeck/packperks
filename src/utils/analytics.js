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
  // ── In-app browser redirect (Android) ──
  INAPP_PROMPT_SHOWN:     'inapp_prompt_shown',
  OPEN_IN_DEFAULT_BROWSER:'open_in_default_browser',
  COLLECT_HERE_ANYWAY:    'collect_here_anyway',
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
  EVENTS.INAPP_PROMPT_SHOWN,
  EVENTS.OPEN_IN_DEFAULT_BROWSER,
  EVENTS.COLLECT_HERE_ANYWAY,
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

/**
 * Capture how this visit arrived, for attributing accounts that end up with
 * 0 cups. Attached to the APP_LOADED event so the admin can tell, per user,
 * whether they came from a shared link, an in-app browser, a cup deeplink,
 * or a bare URL (e.g. a circulating poster QR).
 *
 *   deeplink   'batch' | 'cups' | null  — was a cup attached to the URL?
 *   ref        e.g. 'share'             — tag we add to shared links
 *   referrer   hostname of document.referrer (null for QR/camera/direct)
 *   in_app     true for known in-app webviews (FB/IG/Line/WeChat/Android wv)
 *   standalone true if launched from an installed PWA
 */
function getEntryContext() {
  if (typeof window === 'undefined') return {};
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  const sp = new URLSearchParams(window.location.search);
  let referrer = null;
  try { if (document.referrer) referrer = new URL(document.referrer).hostname; } catch { /* leave referrer null */ }
  return {
    deeplink: sp.get('batch') ? 'batch' : (sp.get('cups') ? 'cups' : null),
    ref: sp.get('ref') || null,
    referrer,
    in_app: /FBAN|FBAV|Instagram|Line\/|MicroMessenger|Twitter|TikTok|; wv\)|GSA\//i.test(ua),
    standalone: !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches),
  };
}

/**
 * True only for Android in-app webviews — where localStorage isn't shared
 * with the user's real browser, so a claimed cup strands in a throwaway
 * account. Keyed off the Android System WebView marker ("; wv)"), which
 * backs in-app browsers (Instagram, Facebook, Telegram, …). Normal Chrome,
 * Samsung Internet, and Chrome Custom Tabs do NOT include it, so real
 * browsers are never matched. iOS is intentionally excluded for now (its
 * in-app browsers can't be force-redirected to Safari, and detection of
 * WhatsApp/Telegram there is unreliable).
 */
function isAndroidInAppBrowser() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (!/Android/i.test(ua)) return false;
  return /;\s*wv\)/i.test(ua) || /FBAN|FBAV|Instagram|Line\/|MicroMessenger|GSA\//i.test(ua);
}

// iOS in-app browsers we can ACTUALLY detect from the UA (Facebook,
// Instagram, Line, WeChat, the Google app, TikTok, Snapchat, Pinterest).
// WhatsApp / Telegram / plain SFSafariViewController look like Safari and
// are intentionally NOT matched — so normal Safari/Chrome iOS users never
// trip this. We can't force-open Safari on iOS, so the sheet only guides.
function isIosInAppBrowser() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (!/iPhone|iPad|iPod/i.test(ua)) return false;
  return /FBAN|FBAV|Instagram|Line\/|MicroMessenger|GSA\/|musical_ly|Bytedance|Snapchat|Pinterest/i.test(ua);
}

/** 'android' | 'ios' | null — which in-app webview (if any) we're inside. */
function getInAppBrowserKind() {
  if (isAndroidInAppBrowser()) return 'android';
  if (isIosInAppBrowser()) return 'ios';
  return null;
}

export { EVENTS, track, setAnalyticsContext, getEntryContext, isAndroidInAppBrowser, getInAppBrowserKind };
