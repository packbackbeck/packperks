import { useState } from 'react';
import { startGoogleSignIn, useGoogleAvailable } from '../lib/oauth';
import './GoogleSignIn.css';

/* ─────────────────────────────────────────────────────────────────────
 * "Continue with Google", above an email form.
 *
 * One block for every sign-in surface in the customer app (the rewards
 * apps' SignInSheet, and Deferred Tikkie's Save-your-balance card, email
 * sheet and log-in sheet), so they all look and behave alike:
 *
 *   [ G  Continue with Google ]
 *   By continuing you confirm you've read the Privacy Policy.
 *   ──────── or use your email ────────
 *
 * Renders nothing until Google is switched on for the project, so the
 * divider never introduces an email form that has no alternative.
 *
 * The button follows Google's branding rules: the four-colour G, unaltered,
 * on white with a grey outline, and the words "Continue with Google".
 * Tapping it leaves the app, so it says so while the browser is on its way.
 * ───────────────────────────────────────────────────────────────────── */

export function GoogleMark({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

export default function GoogleSignIn({
  intent,
  onShowPolicy,
  divider = 'or use your email',
  disabled = false,
  showPolicyNote = true,
}) {
  const available = useGoogleAvailable();
  const [state, setState] = useState('idle'); // idle | leaving | failed

  if (!available) return null;

  async function go() {
    if (state === 'leaving' || disabled) return;
    setState('leaving');
    try {
      await startGoogleSignIn(intent);
      // The browser is navigating away now; stay in "leaving".
    } catch {
      setState('failed');
    }
  }

  return (
    <div className="ppk-gsi">
      <button
        type="button"
        className="ppk-gsi__btn"
        onClick={go}
        disabled={disabled || state === 'leaving'}
        aria-busy={state === 'leaving'}
      >
        <GoogleMark />
        <span>{state === 'leaving' ? 'Opening Google…' : 'Continue with Google'}</span>
      </button>
      {state === 'failed' && (
        <p className="ppk-gsi__error" role="alert">
          Google sign-in isn’t available right now. Use your email below instead.
        </p>
      )}
      {showPolicyNote && (
        <p className="ppk-gsi__note">
          By continuing you confirm you’ve read the{' '}
          <span className="ppk-gsi__nowrap">
            {onShowPolicy
              ? <button type="button" className="ppk-gsi__link" onClick={onShowPolicy}>Privacy Policy</button>
              : 'Privacy Policy'}.
          </span>
        </p>
      )}
      {divider && (
        <div className="ppk-gsi__or" role="separator">
          <span className="ppk-gsi__rule" />
          <span className="ppk-gsi__orlabel">{divider}</span>
          <span className="ppk-gsi__rule" />
        </div>
      )}
    </div>
  );
}
