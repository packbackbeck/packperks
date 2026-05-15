import { useState } from 'react';
import {
  signInWithEmail,
  signUpWithEmail,
  signInWithGoogle,
  verifyEmailOtp,
  resendEmailOtp,
  sendPasswordReset,
} from './authApi';
import packperksLogo from '../../assets/images/packperks-logo.svg';
import './LoginPage.css';

/* Login / Signup page for admins.
 *
 * One UI, three modes:
 *   • 'signin'   — existing user enters email + password (or Google)
 *   • 'signup'   — new user enters email + password; we send an OTP
 *   • 'verify'   — newly signed-up user enters the 6-digit OTP code
 *   • 'forgot'   — request a password reset email
 *
 * On successful sign-in / OTP verification the AuthContext sees the new
 * session and routes the user to the admin app. */
export default function LoginPage() {
  const [mode, setMode]         = useState('signin');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp]           = useState('');
  const [busy, setBusy]         = useState(false);
  const [err, setErr]           = useState(null);
  const [info, setInfo]         = useState(null);

  async function handleSignIn(e) {
    e.preventDefault();
    setErr(null); setInfo(null); setBusy(true);
    try {
      await signInWithEmail(email.trim(), password);
      // AuthContext picks up the new session.
    } catch (e) {
      setErr(friendlyError(e));
    } finally { setBusy(false); }
  }

  async function handleSignUp(e) {
    e.preventDefault();
    setErr(null); setInfo(null); setBusy(true);
    if (password.length < 8) {
      setErr('Pick a password with at least 8 characters.'); setBusy(false); return;
    }
    try {
      await signUpWithEmail(email.trim(), password);
      setMode('verify');
      setInfo(`We sent a 6-digit code to ${email.trim()}. Enter it below to confirm your email.`);
    } catch (e) {
      setErr(friendlyError(e));
    } finally { setBusy(false); }
  }

  async function handleVerify(e) {
    e.preventDefault();
    setErr(null); setBusy(true);
    try {
      await verifyEmailOtp(email.trim(), otp.trim());
      // AuthContext picks up the session.
    } catch (e) {
      setErr(friendlyError(e));
    } finally { setBusy(false); }
  }

  async function handleResend() {
    setErr(null); setBusy(true);
    try {
      await resendEmailOtp(email.trim());
      setInfo('Sent another code — check your inbox.');
    } catch (e) {
      setErr(friendlyError(e));
    } finally { setBusy(false); }
  }

  async function handleForgot(e) {
    e.preventDefault();
    setErr(null); setInfo(null); setBusy(true);
    try {
      await sendPasswordReset(email.trim());
      setInfo(`If an account exists for ${email.trim()}, we just sent a password-reset link.`);
    } catch (e) {
      setErr(friendlyError(e));
    } finally { setBusy(false); }
  }

  async function handleGoogle() {
    setErr(null); setBusy(true);
    try { await signInWithGoogle(); }
    catch (e) { setErr(friendlyError(e)); setBusy(false); }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-card__brand">
          <img src={packperksLogo} alt="PackPerks" className="auth-card__logo" />
          <p className="auth-card__sub">Admin Console</p>
        </div>

        {mode !== 'verify' && (
          <div className="auth-tabs">
            <button
              type="button"
              className={`auth-tabs__btn${mode === 'signin' ? ' auth-tabs__btn--active' : ''}`}
              onClick={() => { setMode('signin'); setErr(null); setInfo(null); }}
              disabled={busy}
            >
              Sign in
            </button>
            <button
              type="button"
              className={`auth-tabs__btn${mode === 'signup' ? ' auth-tabs__btn--active' : ''}`}
              onClick={() => { setMode('signup'); setErr(null); setInfo(null); }}
              disabled={busy}
            >
              Create account
            </button>
          </div>
        )}

        {mode === 'signin' && (
          <form className="auth-form" onSubmit={handleSignIn}>
            <button type="button" className="auth-btn auth-btn--google" onClick={handleGoogle} disabled={busy}>
              <GoogleIcon /> Continue with Google
            </button>
            <div className="auth-divider"><span>or</span></div>
            <label className="auth-field">
              <span>Work email</span>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@burgerking.nl" autoComplete="email" required disabled={busy} />
            </label>
            <label className="auth-field">
              <span>Password</span>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters" autoComplete="current-password" required disabled={busy} />
            </label>
            {err && <p className="auth-err">{err}</p>}
            {info && <p className="auth-info">{info}</p>}
            <button type="submit" className="auth-btn auth-btn--primary" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
            <button type="button" className="auth-link" onClick={() => { setMode('forgot'); setErr(null); setInfo(null); }}>
              Forgot password?
            </button>
          </form>
        )}

        {mode === 'signup' && (
          <form className="auth-form" onSubmit={handleSignUp}>
            <button type="button" className="auth-btn auth-btn--google" onClick={handleGoogle} disabled={busy}>
              <GoogleIcon /> Sign up with Google
            </button>
            <div className="auth-divider"><span>or use email</span></div>
            <label className="auth-field">
              <span>Work email</span>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@burgerking.nl" autoComplete="email" required disabled={busy} />
            </label>
            <label className="auth-field">
              <span>Choose a password</span>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters" autoComplete="new-password" required minLength={8} disabled={busy} />
            </label>
            {err && <p className="auth-err">{err}</p>}
            {info && <p className="auth-info">{info}</p>}
            <button type="submit" className="auth-btn auth-btn--primary" disabled={busy}>
              {busy ? 'Creating account…' : 'Create account'}
            </button>
            <p className="auth-fineprint">
              We'll send a verification code to confirm it's really you.
              By creating an account you agree to the staff data policy.
            </p>
          </form>
        )}

        {mode === 'verify' && (
          <form className="auth-form" onSubmit={handleVerify}>
            <p className="auth-info auth-info--block">{info}</p>
            <label className="auth-field">
              <span>Verification code</span>
              <input
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={otp}
                onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
                placeholder="123456"
                autoComplete="one-time-code"
                required
                disabled={busy}
                className="auth-otp"
              />
            </label>
            {err && <p className="auth-err">{err}</p>}
            <button type="submit" className="auth-btn auth-btn--primary" disabled={busy || otp.length !== 6}>
              {busy ? 'Verifying…' : 'Verify & sign in'}
            </button>
            <div className="auth-resend">
              <span>Didn't get the code?</span>
              <button type="button" className="auth-link" onClick={handleResend} disabled={busy}>
                Resend
              </button>
            </div>
            <button type="button" className="auth-link auth-link--back" onClick={() => { setMode('signup'); setErr(null); setInfo(null); }}>
              ← Back
            </button>
          </form>
        )}

        {mode === 'forgot' && (
          <form className="auth-form" onSubmit={handleForgot}>
            <p className="auth-info auth-info--block">
              Enter your email and we'll send you a link to reset your password.
            </p>
            <label className="auth-field">
              <span>Work email</span>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@burgerking.nl" autoComplete="email" required disabled={busy} />
            </label>
            {err && <p className="auth-err">{err}</p>}
            {info && <p className="auth-info">{info}</p>}
            <button type="submit" className="auth-btn auth-btn--primary" disabled={busy}>
              {busy ? 'Sending…' : 'Send reset link'}
            </button>
            <button type="button" className="auth-link auth-link--back" onClick={() => { setMode('signin'); setErr(null); setInfo(null); }}>
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
  if (m.includes('invalid login') || m.includes('invalid_credentials')) return 'That email and password don\'t match. Try again or reset your password.';
  if (m.includes('user already registered')) return 'That email is already registered — sign in instead.';
  if (m.includes('email not confirmed') || m.includes('not confirmed')) return 'Confirm your email first. Check your inbox for the verification code.';
  if (m.includes('token has expired') || m.includes('expired')) return 'That code has expired — request a new one.';
  if (m.includes('rate limit')) return 'Too many tries — please wait a minute and try again.';
  if (m.includes('provider is not enabled')) return 'Google sign-in isn\'t configured for this project yet. Use email + password instead.';
  return e?.message || 'Something went wrong. Please try again.';
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 5.8 29.5 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/>
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16.1 19 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.8 29.5 5 24 5 16 5 9.2 9.5 6.3 14.7z"/>
      <path fill="#4CAF50" d="M24 44c5.4 0 10.3-2 14-5.3l-6.5-5.3c-2 1.5-4.6 2.5-7.5 2.5-5.2 0-9.6-3.3-11.2-8L6.2 32.8C9.1 38.8 16 44 24 44z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.4l6.5 5.3c-.4.3 7-5.1 7-14.7 0-1.3-.1-2.4-.4-3.5z"/>
    </svg>
  );
}
