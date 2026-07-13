import { createPortal } from 'react-dom';
import { useState } from 'react';
import './CookieConsent.css';
import { getConsentPrefs, DEFAULT_PREFS } from '../lib/consent';

/* ─────────────────────────────────────────────────────────────────────
 * CookieConsent — first-run consent (GDPR items 17/18), two pages:
 *
 *   Page 1 (main):  Accept all · Essential only · Customize · policy link.
 *   Page 2 (customize): three toggles — Technical, Analytical, Marketing —
 *                  defaulting to ON, plus a single "Save" CTA. Unchecking
 *                  Technical (or all of them) means the app can't run → the
 *                  choice resolves to "rejected" and the blocked screen shows.
 *
 * The choice is stored granularly (lib/consent) and its effects are real:
 * analytics (client_events) are only written when Analytical is on, and
 * Marketing is synced to users.marketing_consent server-side (App.jsx).
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

function ToggleRow({ id, title, desc, checked, onChange }) {
  return (
    <div className="cc-toggle">
      <label className="cc-toggle__label" htmlFor={id}>
        <span className="cc-toggle__title">{title}</span>
        <span className="cc-toggle__desc">{desc}</span>
      </label>
      <label className="cc-switch" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          className="cc-switch__input"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="cc-switch__track" aria-hidden="true"><span className="cc-switch__thumb" /></span>
      </label>
    </div>
  );
}

export default function CookieConsent({ onChoose, onCustomize, onPolicy }) {
  const [page, setPage] = useState('main');           // 'main' | 'customize'
  const init = getConsentPrefs() || DEFAULT_PREFS;    // default: all ON
  const [technical, setTechnical] = useState(init.technical);
  const [analytical, setAnalytical] = useState(init.analytical);
  const [marketing, setMarketing] = useState(init.marketing);

  return createPortal(
    <div className="cc-overlay" role="dialog" aria-modal="true" aria-label="Cookie choices">
      <div className="cc-sheet">
        {page === 'main' ? (
          <>
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
              <button className="cc-btn cc-btn--secondary" onClick={() => setPage('customize')}>
                Customize
              </button>
            </div>
            {onPolicy && (
              <button type="button" className="cc-policy-link" onClick={onPolicy}>
                Read our privacy &amp; cookie policy
              </button>
            )}
          </>
        ) : (
          <>
            <div className="cc-head cc-head--sub">
              <button type="button" className="cc-back" onClick={() => setPage('main')} aria-label="Back">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
              </button>
              <h2 className="cc-title">Your cookie choices</h2>
            </div>
            <p className="cc-text">
              Choose what PackPerks may use. You can change this any time. Turning
              everything off means the app can’t run.
            </p>

            <div className="cc-toggles">
              <ToggleRow
                id="cc-technical"
                title="Technical"
                desc="Essential — keeps you signed in and remembers your cups and claims."
                checked={technical}
                onChange={setTechnical}
              />
              <ToggleRow
                id="cc-analytical"
                title="Analytical"
                desc="Anonymous usage stats that help us improve the app."
                checked={analytical}
                onChange={setAnalytical}
              />
              <ToggleRow
                id="cc-marketing"
                title="Marketing"
                desc="Occasional offers and updates about your rewards."
                checked={marketing}
                onChange={setMarketing}
              />
            </div>

            <div className="cc-actions">
              <button
                className="cc-btn cc-btn--primary"
                onClick={() => onCustomize({ technical, marketing, analytical })}
              >
                Save
              </button>
            </div>
            {onPolicy && (
              <button type="button" className="cc-policy-link" onClick={onPolicy}>
                Read our privacy &amp; cookie policy
              </button>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

/* Shown after Reject / all-off: essential cookies are required, so the app is
 * blocked until the user picks something that keeps Technical on. Their existing
 * cups stay safe. */
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
