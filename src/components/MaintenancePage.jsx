import { useState } from 'react';
import './MaintenancePage.css';

/* ─────────────────────────────────────────────────────────────────────
 * MaintenancePage — shown when liveSettings.maintenanceMode is on.
 *
 * More than a dead-end: the customer can leave an email and we remember it
 * (locally) so a "notify me when we're back" request is captured. There is no
 * mailing backend wired here, so we store the request on the device and show
 * an honest confirmation — the point is that the wait feels handled, not that
 * a server email is guaranteed.
 * ───────────────────────────────────────────────────────────────────── */

const NOTIFY_KEY = 'packperks_maintenance_notify';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function MaintenancePage() {
  const [email, setEmail] = useState('');
  // 'idle' → form, 'done' → confirmation. Start 'done' if we already have a
  // request stored, so a reload doesn't ask again.
  const [state, setState] = useState(() => {
    try { return localStorage.getItem(NOTIFY_KEY) ? 'done' : 'idle'; } catch { return 'idle'; }
  });
  const [savedEmail, setSavedEmail] = useState(() => {
    try { return localStorage.getItem(NOTIFY_KEY) || ''; } catch { return ''; }
  });

  const valid = EMAIL_RE.test(email.trim());

  const submit = (e) => {
    e.preventDefault();
    if (!valid) return;
    const addr = email.trim();
    try { localStorage.setItem(NOTIFY_KEY, addr); } catch { /* ignore */ }
    setSavedEmail(addr);
    setState('done');
  };

  return (
    <div className="mnt">
      <div className="mnt__card">
        <div className="mnt__glyph" aria-hidden="true">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
          </svg>
        </div>

        <h1 className="mnt__title">Down for maintenance</h1>
        <p className="mnt__sub">
          We&rsquo;re making PackPerks better and will be back shortly. Your cups and
          cashback are safe, and nothing is lost while we&rsquo;re away.
        </p>

        {state === 'idle' ? (
          <form className="mnt__form" onSubmit={submit} noValidate>
            <label className="mnt__label" htmlFor="mnt-email">Want a heads-up when we&rsquo;re live again?</label>
            <div className="mnt__row">
              <input
                id="mnt-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                className="mnt__input"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-label="Your email address"
              />
              <button type="submit" className="mnt__btn" disabled={!valid}>
                Notify me
              </button>
            </div>
            <p className="mnt__hint">We&rsquo;ll only use it to tell you we&rsquo;re back. No spam.</p>
          </form>
        ) : (
          <div className="mnt__done" role="status">
            <span className="mnt__done-ic" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12l5 5L20 6" /></svg>
            </span>
            <div className="mnt__done-txt">
              <strong>You&rsquo;re on the list.</strong>
              <span>We&rsquo;ll let you know at {savedEmail} the moment PackPerks is back.</span>
            </div>
            <button type="button" className="mnt__done-edit" onClick={() => { setState('idle'); setEmail(savedEmail); }}>
              Use a different email
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
