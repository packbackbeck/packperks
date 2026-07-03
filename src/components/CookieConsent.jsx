import { createPortal } from 'react-dom';
import './CookieConsent.css';

/* ─────────────────────────────────────────────────────────────────────
 * CookieConsent — first-run consent choice (GDPR items 17/18).
 *
 * Three choices:
 *   • Accept all    — essential + behavioural analytics
 *   • Essential only — only what's needed to run the app
 *   • Reject         — declines; the app is then blocked (essential cookies
 *                      are required to function). Nothing already earned is
 *                      ever deleted.
 *
 * Styled to match PackPerks: a soft cream bottom-sheet with a little cookie
 * mark. No dark patterns — "Accept all" and "Essential only" carry equal
 * weight, and "Reject" is always available.
 * ───────────────────────────────────────────────────────────────────── */

function CookieMark() {
  return (
    <svg viewBox="0 0 48 48" width="40" height="40" aria-hidden="true">
      <circle cx="24" cy="24" r="20" fill="#E9C48B" stroke="#C99A54" strokeWidth="2" />
      <circle cx="17" cy="18" r="2.6" fill="#7A4A22" />
      <circle cx="30" cy="16" r="2.1" fill="#7A4A22" />
      <circle cx="33" cy="27" r="2.6" fill="#7A4A22" />
      <circle cx="20" cy="30" r="2.2" fill="#7A4A22" />
      <circle cx="26" cy="23" r="1.7" fill="#7A4A22" />
    </svg>
  );
}

export default function CookieConsent({ onChoose, onPolicy }) {
  return createPortal(
    <div className="cc-overlay" role="dialog" aria-modal="true" aria-label="Cookie choices">
      <div className="cc-sheet">
        <div className="cc-head">
          <span className="cc-mark"><CookieMark /></span>
          <h2 className="cc-title">A quick cookie choice</h2>
        </div>
        <p className="cc-text">
          We use <strong>essential</strong> cookies to run PackPerks — to register your
          account, remember your cup balance, and keep track of your reward claims.
          With your consent we also use <strong>analytics</strong> to understand how the
          app is used. No ads, no third-party trackers.
        </p>
        <div className="cc-actions">
          <button className="cc-btn cc-btn--primary" onClick={() => onChoose('all')}>
            Accept all
          </button>
          <button className="cc-btn cc-btn--secondary" onClick={() => onChoose('essential')}>
            Essential only
          </button>
          <button className="cc-btn cc-btn--ghost" onClick={() => onChoose('rejected')}>
            Reject
          </button>
        </div>
        {onPolicy && (
          <button type="button" className="cc-policy-link" onClick={onPolicy}>
            Read our privacy &amp; cookie policy
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}

/* Shown after "Reject": essential cookies are required, so the app is blocked
 * until the user picks Essential-only or Accept-all. Their existing cups stay
 * safe in the system. */
export function CookieBlocked({ onReconsider }) {
  return createPortal(
    <div className="cc-blocked">
      <div className="cc-blocked__card">
        <span className="cc-mark"><CookieMark /></span>
        <h2 className="cc-blocked__title">PackPerks needs essential cookies</h2>
        <p className="cc-blocked__text">
          We can’t register your account or remember your cups without essential cookies.
          Any cups you’ve already collected are safe and stay in your account.
        </p>
        <button type="button" className="cc-btn cc-btn--primary" onClick={onReconsider}>
          Change my cookie choice
        </button>
      </div>
    </div>,
    document.body,
  );
}
