/* Cookie / storage consent (GDPR item 17/18).
 *
 * Three levels:
 *   'all'       — essential + non-essential behavioural analytics (client_events)
 *   'essential' — only what's needed to run the app (device_id, balance, claims)
 *   'rejected'  — user declined; the app is blocked (essential cookies are
 *                 required to function). Data already earned is NEVER deleted.
 *
 * The choice itself is stored in localStorage (an essential cookie). Behavioural
 * analytics are gated on `hasAnalyticsConsent()` — see src/utils/analytics.js.
 */

const KEY = 'packperks_cookie_consent';

export const CONSENT = {
  ALL: 'all',
  ESSENTIAL: 'essential',
  REJECTED: 'rejected',
};

export function getConsent() {
  try { return localStorage.getItem(KEY) || null; } catch { return null; }
}

export function setConsent(level) {
  try { localStorage.setItem(KEY, level); } catch { /* private mode */ }
}

export function clearConsent() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** Behavioural analytics (client_events) are allowed only with "Accept all". */
export function hasAnalyticsConsent() {
  return getConsent() === CONSENT.ALL;
}
