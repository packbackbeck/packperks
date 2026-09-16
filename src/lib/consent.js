/* Cookie / storage consent (GDPR item 17/18).
 *
 * Granular categories (the source of truth):
 *   technical  — essential to run the app (device_id, balance, claims). Turning
 *                this OFF means the app can't run → treated as "rejected".
 *   analytical — behavioural analytics (client_events). Gated below.
 *   marketing  — permission to send reward offers/updates (server: users.marketing_consent).
 *
 * For backward-compatibility the derived LEVEL is also stored under the legacy
 * key, so existing consumers (ConsentGate, analytics) keep working:
 *   'all'       — technical + analytical
 *   'essential' — technical only
 *   'rejected'  — technical off (app blocked; nothing already earned is deleted)
 */

const KEY = 'packperks_cookie_consent';        // legacy derived level
const PREFS_KEY = 'packperks_cookie_prefs';     // granular {technical, marketing, analytical}

export const CONSENT = {
  ALL: 'all',
  ESSENTIAL: 'essential',
  REJECTED: 'rejected',
};

// What the Customize page starts from on a first visit. Only the essential
// category is on: optional categories need the customer to switch them on
// (a pre-ticked box is not consent under the GDPR).
export const DEFAULT_PREFS = { technical: true, marketing: false, analytical: false };

// A Marketing choice made in the cookie banner that the account hasn't
// recorded yet ('1' or '0'). The banner is usually answered before the
// customer's row exists, so App.jsx picks this up once it does.
const MARKETING_PENDING_KEY = 'packperks_marketing_choice_pending';

function levelFromPrefs(p) {
  if (!p || !p.technical) return CONSENT.REJECTED;
  return p.analytical ? CONSENT.ALL : CONSENT.ESSENTIAL;
}

export function getConsent() {
  try { return localStorage.getItem(KEY) || null; } catch { return null; }
}

/** The granular choice, or null if the user hasn't decided yet. */
export function getConsentPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
    // Legacy users who chose before granular existed: derive from the level.
    const level = getConsent();
    // The old banner never asked about offers, so it granted none.
    if (level === CONSENT.ALL) return { technical: true, marketing: false, analytical: true };
    if (level === CONSENT.ESSENTIAL) return { technical: true, marketing: false, analytical: false };
    if (level === CONSENT.REJECTED) return { technical: false, marketing: false, analytical: false };
    return null;
  } catch { return null; }
}

/** Persist the granular choice, derive + store the legacy level, and broadcast
 *  so the app (App.jsx) can record a changed marketing choice on the account. */
export function setConsentPrefs(prefs) {
  const before = getConsentPrefs();
  const clean = {
    technical: !!prefs?.technical,
    marketing: !!prefs?.marketing,
    analytical: !!prefs?.analytical,
  };
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(clean));
    localStorage.setItem(KEY, levelFromPrefs(clean));
    // Only a change made here counts. Re-saving the same choice must not
    // overwrite what the customer picked on the email form or in their profile.
    if ((before?.marketing ?? false) !== clean.marketing) {
      localStorage.setItem(MARKETING_PENDING_KEY, clean.marketing ? '1' : '0');
    }
  } catch { /* private mode */ }
  try {
    window.dispatchEvent(new CustomEvent('packperks:consent-changed', { detail: clean }));
  } catch { /* SSR / no window */ }
  return clean;
}

/** The banner's buttons, as granular prefs. "Accept all" covers what its page
 *  describes (essential cookies and analytics) and leaves the marketing choice
 *  as it was: offers are only ever switched on deliberately. */
export function setConsent(level) {
  if (level === CONSENT.ALL) {
    return setConsentPrefs({ technical: true, marketing: !!getConsentPrefs()?.marketing, analytical: true });
  }
  if (level === CONSENT.ESSENTIAL) return setConsentPrefs({ technical: true, marketing: false, analytical: false });
  return setConsentPrefs({ technical: false, marketing: false, analytical: false });
}

/** The banner's unrecorded marketing choice (true / false), or null. Reading
 *  it clears it. */
export function takePendingMarketingChoice() {
  try {
    const v = localStorage.getItem(MARKETING_PENDING_KEY);
    if (v === null) return null;
    localStorage.removeItem(MARKETING_PENDING_KEY);
    return v === '1';
  } catch { return null; }
}

export function clearConsent() {
  try { localStorage.removeItem(KEY); localStorage.removeItem(PREFS_KEY); } catch { /* ignore */ }
}

/** Behavioural analytics (client_events) are allowed only with the analytical
 *  category on (which requires technical too). */
export function hasAnalyticsConsent() {
  const p = getConsentPrefs();
  return !!(p && p.technical && p.analytical);
}

/* ─────────────────────────────────────────────────────────────────────
 * Rejection counter.
 *
 * A visitor who turns Technical off can't run the app, and — having
 * refused analytics along with it — can never be tracked through
 * client_events. We still want to know HOW OFTEN that happens, so a
 * full rejection writes one deliberately anonymous row: org and time,
 * nothing else. No session id, no device id, no user, no properties.
 * That is a count, not a profile, which is why it is allowed to exist
 * without consent. Fire-and-forget: a failure here must never be
 * allowed to break the blocked screen the visitor is about to see.
 * ───────────────────────────────────────────────────────────────────── */
export function recordConsentRejection(orgId = null) {
  try {
    if (window.__ppkRejectionLogged) return;   // once per page, not per re-render
    window.__ppkRejectionLogged = true;
    import('./supabase').then(({ supabase }) => {
      supabase.from('consent_rejections')
        .insert({ org_id: orgId || window.__ppkOrgId || null })
        .then(() => {}, () => {});
    }).catch(() => {});
  } catch { /* storage or network blocked — nothing to do */ }
}
