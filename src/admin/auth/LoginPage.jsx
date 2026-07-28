import { useState } from 'react';
import {
  signInWithEmail,
  signUpWithEmail,
  verifyEmailOtp,
  resendEmailOtp,
  sendPasswordReset,
} from './authApi';
import packperksLogo from '../../assets/images/packperks-logo.svg';
import './LoginPage.css';

/* Admin self-registration is restricted to the internal team domain. Anyone
 * with a @packback.network address can create an admin account; everyone
 * else is turned away here (and again server-side in bootstrap-admin). */
const ADMIN_EMAIL_DOMAIN = 'packback.network';
function isPackbackEmail(email) {
  const at = String(email).lastIndexOf('@');
  if (at < 0) return false;
  return email.slice(at + 1).trim().toLowerCase().replace(/\.$/, '') === ADMIN_EMAIL_DOMAIN;
}

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
    if (!isPackbackEmail(email)) {
      setErr(`Admin accounts are limited to @${ADMIN_EMAIL_DOMAIN} email addresses.`);
      setBusy(false); return;
    }
    if (password.length < 8) {
      setErr('Pick a password with at least 8 characters.'); setBusy(false); return;
    }
    try {
      await signUpWithEmail(email.trim(), password);
      setMode('verify');
      // Supabase project is configured with Email OTP length = 6 digits,
      // so {{ .Token }} in the signup-confirmation email is a clean
      // 6-digit numeric code. (If that setting is ever flipped back to
      // the default alphanumeric token, also relax the verify input
      // below — see the comment there.)
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
            <label className="auth-field">
              <span>Work email</span>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@packback.network" autoComplete="email" required disabled={busy} />
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
            <div className="auth-locked">
              <LockIcon />
              <div>
                <strong>Restricted to the PackPerks team</strong>
                <span>Only <b>@{ADMIN_EMAIL_DOMAIN}</b> email addresses can register for admin access.</span>
              </div>
            </div>
            <label className="auth-field">
              <span>Work email</span>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder={`you@${ADMIN_EMAIL_DOMAIN}`} autoComplete="email" required disabled={busy} />
            </label>
            <label className="auth-field">
              <span>Choose a password</span>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters" autoComplete="new-password" required minLength={8} disabled={busy} />
            </label>
            {err && <p className="auth-err">{err}</p>}
            {info && <p className="auth-info">{info}</p>}
            <button type="submit" className="auth-btn auth-btn--primary" disabled={busy || !isPackbackEmail(email)}>
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
              {/* Supabase project has "Email OTP" enabled with length=6,
               * so {{ .Token }} emits a 6-digit numeric code. We strip
               * any non-digit characters on paste — that way users
               * pasting from formatted emails (e.g. "123 456" or
               * "123-456") still land on a clean numeric value. If the
               * Supabase OTP setting is ever flipped back to the default
               * alphanumeric token, swap inputMode to "text", drop the
               * digit-only filter, and relax the length check below. */}
              <input
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={otp}
                onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
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
  return e?.message || 'Something went wrong. Please try again.';
}

function LockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="10.5" width="16" height="10" rx="2.2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M7.5 10.5V7.8a4.5 4.5 0 0 1 9 0v2.7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}
