import { useState } from 'react';
import { updatePassword } from './authApi';
import packperksLogo from '../../assets/images/packperks-logo.svg';
import './LoginPage.css';

/* ResetPasswordPage — shown when an admin opens a password-reset link.
 *
 * At this point supabase-js has already exchanged the recovery token for a
 * short-lived session (AuthContext flips `recovering` on). We collect a new
 * password, call updateUser, then sign the user out so they log in fresh with
 * the new password. `onFinish` performs the sign-out + clears the recovery
 * flag so AuthGate falls back to the normal login screen. */
export default function ResetPasswordPage({ onFinish }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm]   = useState('');
  const [busy, setBusy]         = useState(false);
  const [err, setErr]           = useState(null);
  const [done, setDone]         = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setErr(null);
    if (password.length < 8) { setErr('Pick a password with at least 8 characters.'); return; }
    if (password !== confirm) { setErr('Those passwords don’t match.'); return; }
    setBusy(true);
    try {
      await updatePassword(password);
      setDone(true);
    } catch (e) {
      setErr(friendlyError(e));
    } finally { setBusy(false); }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-card__brand">
          <img src={packperksLogo} alt="PackPerks" className="auth-card__logo" />
          <p className="auth-card__sub">Admin Console</p>
        </div>

        {done ? (
          <div className="auth-form">
            <div className="auth-locked" style={{ borderColor: '#CDEBD6', background: '#F1FBF4', color: '#1A8737' }}>
              <CheckIcon />
              <div>
                <strong>Password updated</strong>
                <span>Sign in with your new password to continue.</span>
              </div>
            </div>
            <button type="button" className="auth-btn auth-btn--primary" onClick={() => onFinish?.()}>
              Continue to sign in
            </button>
          </div>
        ) : (
          <form className="auth-form" onSubmit={handleSubmit}>
            <p className="auth-info auth-info--block">
              Choose a new password for your admin account.
            </p>
            <label className="auth-field">
              <span>New password</span>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                autoComplete="new-password"
                required
                minLength={8}
                disabled={busy}
              />
            </label>
            <label className="auth-field">
              <span>Confirm new password</span>
              <input
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                placeholder="Re-enter your new password"
                autoComplete="new-password"
                required
                minLength={8}
                disabled={busy}
              />
            </label>
            {err && <p className="auth-err">{err}</p>}
            <button
              type="submit"
              className="auth-btn auth-btn--primary"
              disabled={busy || password.length < 8 || password !== confirm}
            >
              {busy ? 'Updating…' : 'Update password'}
            </button>
            <button type="button" className="auth-link auth-link--back" onClick={() => onFinish?.()}>
              ← Back to sign in
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function friendlyError(e) {
  const m = (e?.message || '').toLowerCase();
  if (m.includes('session') && m.includes('missing')) return 'This reset link has expired. Request a new one from the sign-in screen.';
  if (m.includes('same') && m.includes('password')) return 'Pick a password different from your current one.';
  if (m.includes('token') && m.includes('expired')) return 'This reset link has expired. Request a new one from the sign-in screen.';
  if (m.includes('rate limit')) return 'Too many tries — please wait a minute and try again.';
  return e?.message || 'Something went wrong. Please try again.';
}

function CheckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8 12.5l2.5 2.5L16 9.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
