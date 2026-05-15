import { useEffect, useRef, useState } from 'react';
import { sendMagicLink, signOutUser, getCurrentAuthEmail } from '../lib/api';
import './SignInSheet.css';

/* ─────────────────────────────────────────────────────────────────────
 * SignInSheet — modal sheet for "Save your cups across devices".
 *
 * The user app is anonymous by default (device_id only). This sheet
 * lets a customer optionally bind their balance to an email so they
 * can recover it on a new phone or after clearing cookies.
 *
 * States:
 *   • idle       — email input + "Send link" button
 *   • sending    — spinner inside the button
 *   • sent       — confirmation card with "open mail app" CTA
 *   • signedIn   — banner saying "Signed in as foo@bar" + Sign out
 *   • error      — inline error message
 *
 * Magic-link flow:
 *   1. User types email → tap "Send link" → sendMagicLink() fires
 *   2. Sheet flips to "sent" state with check-your-inbox copy
 *   3. User taps the email link → Supabase redirects them back here
 *      → onAuthStateChange in App.jsx picks up the SIGNED_IN event
 *      → that triggers a getOrCreateUser refresh which links the
 *      auth.users.id onto our existing PackPerks users row.
 *
 * If the user is already signed in (auth session exists), we show a
 * compact banner with the email + a Sign out action instead of the
 * form. This is the only place in the user app where signing out is
 * exposed — outside the sheet there's no reason for them to do it.
 */
export default function SignInSheet({ open, onClose, onLinked }) {
  const [status, setStatus] = useState('idle'); // 'idle' | 'sending' | 'sent' | 'signedIn' | 'error'
  const [email, setEmail] = useState('');
  const [error, setError] = useState(null);
  const [currentEmail, setCurrentEmail] = useState(null);
  const inputRef = useRef(null);

  // When the sheet opens, find out whether the user is already signed
  // in so we render the right initial state.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getCurrentAuthEmail().then(e => {
      if (cancelled) return;
      if (e) { setCurrentEmail(e); setStatus('signedIn'); }
      else   { setCurrentEmail(null); setStatus('idle'); }
    });
    return () => { cancelled = true; };
  }, [open]);

  // Auto-focus the email input when the sheet shows the form.
  useEffect(() => {
    if (open && status === 'idle') {
      // tiny delay so the slide-in animation settles before focus.
      const t = setTimeout(() => inputRef.current?.focus(), 220);
      return () => clearTimeout(t);
    }
  }, [open, status]);

  // Lock body scroll while sheet is open (matches other sheets in app).
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!email.trim()) return;
    setError(null);
    setStatus('sending');
    try {
      await sendMagicLink(email);
      setStatus('sent');
    } catch (err) {
      setError(err.message === 'invalid_email'
        ? "That email doesn't look quite right — try again."
        : err.message || 'Something went wrong. Please try again.');
      setStatus('error');
    }
  }

  async function handleSignOut() {
    try {
      await signOutUser();
      setCurrentEmail(null);
      setStatus('idle');
      // Notify the parent so it can refresh the user row (back to
      // anonymous device-only mode for any further reads).
      onLinked?.();
    } catch (err) {
      setError(err.message);
      setStatus('error');
    }
  }

  if (!open) return null;

  return (
    <div className="signin-overlay" onClick={onClose}>
      <div className="signin-sheet" onClick={e => e.stopPropagation()}>
        <button className="signin-close" onClick={onClose} aria-label="Close">×</button>

        {/* Already signed in */}
        {status === 'signedIn' && (
          <div className="signin-state">
            <div className="signin-art signin-art--ok">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </div>
            <h2 className="signin-title">You're all set</h2>
            <p className="signin-sub">
              Your cups are backed up to <strong>{currentEmail}</strong>.
              You can sign in from any device with this email — your
              balance and history will be right there.
            </p>
            <button className="signin-btn signin-btn--ghost" onClick={handleSignOut}>
              Sign out of this device
            </button>
          </div>
        )}

        {/* "Check your inbox" confirmation */}
        {status === 'sent' && (
          <div className="signin-state">
            <div className="signin-art signin-art--sent">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
              </svg>
            </div>
            <h2 className="signin-title">Check your inbox</h2>
            <p className="signin-sub">
              We just sent a one-tap sign-in link to
              <br /><strong>{email}</strong>.
              <br />Open it on this device to finish linking your cups.
            </p>
            <button
              className="signin-btn signin-btn--ghost"
              onClick={() => { setStatus('idle'); setEmail(''); }}
            >
              Use a different email
            </button>
          </div>
        )}

        {/* Idle form (or error variant of it) */}
        {(status === 'idle' || status === 'sending' || status === 'error') && (
          <form className="signin-state" onSubmit={handleSubmit}>
            <div className="signin-art">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            </div>
            <h2 className="signin-title">Save your cups across devices</h2>
            <p className="signin-sub">
              Link your balance to an email so you can pick up where you
              left off — even after switching phones or clearing your browser.
            </p>

            <label className="signin-label" htmlFor="signin-email">Email</label>
            <input
              id="signin-email"
              ref={inputRef}
              type="email"
              autoComplete="email"
              inputMode="email"
              className="signin-input"
              placeholder="you@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              disabled={status === 'sending'}
              required
            />

            {error && <p className="signin-error">{error}</p>}

            <button
              type="submit"
              className="signin-btn signin-btn--primary"
              disabled={status === 'sending' || !email.trim()}
            >
              {status === 'sending' ? 'Sending…' : 'Send me a sign-in link'}
            </button>

            <p className="signin-fine">
              We'll only use this address to sign you in. No marketing,
              ever.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
