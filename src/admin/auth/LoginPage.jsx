import { useEffect, useState } from 'react';
import {
  signInWithEmail,
  signUpWithEmail,
  verifyEmailOtp,
  resendEmailOtp,
  sendPasswordReset,
} from './authApi';
import AuthLayout from './login/AuthLayout';
import {
  AuthHeading,
  Field,
  FormAlert,
  PasswordInput,
  PrimaryButton,
  TextInput,
} from './login/formParts';
import { ArrowLeftIcon, KeyIcon, LockIcon, MailCheckIcon } from './login/icons';
import '../ui/ui.css';
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

/* Seconds before another verification code can be requested. Supabase turns
 * down a second email to the same address inside a minute anyway. */
const RESEND_WAIT = 60;

/* Login / Signup page for admins.
 *
 * One UI, four modes:
 *   • 'signin'   — existing user enters email + password
 *   • 'signup'   — new user enters email + password; we send an OTP
 *   • 'verify'   — newly signed-up user enters the 6-digit OTP code
 *   • 'forgot'   — request a password reset email
 *
 * On successful sign-in / OTP verification the AuthContext sees the new
 * session and routes the user to the admin app. The layout (logo, animated
 * showcase panel) lives in ./login/AuthLayout. The email, password and code
 * inputs keep the same ids in every mode: login-email, login-password,
 * login-code. */
export default function LoginPage() {
  const [mode, setMode]         = useState('signin');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp]           = useState('');
  const [busy, setBusy]         = useState(false);
  const [err, setErr]           = useState(null);
  const [info, setInfo]         = useState(null);
  const [resendIn, setResendIn] = useState(0);

  // Count the resend wait down, one second at a time.
  useEffect(() => {
    if (resendIn <= 0) return undefined;
    const timer = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  function switchMode(next) {
    setMode(next); setErr(null); setInfo(null);
  }

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
      // Supabase project is configured with Email OTP length = 6 digits,
      // so {{ .Token }} in the signup-confirmation email is a clean
      // 6-digit numeric code. (If that setting is ever flipped back to
      // the default alphanumeric token, also relax the verify input
      // below — see the comment there.) The verify screen itself says
      // where the code went, so `info` stays empty until a resend.
      setMode('verify');
      setResendIn(RESEND_WAIT);
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
      setResendIn(RESEND_WAIT);
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
    <AuthLayout>
      {mode === 'signin' && (
        <form className="pp-auth" onSubmit={handleSignIn}>
          <AuthHeading title="Sign in">
            Manage rewards, review claims and follow the cups coming back to
            every venue. Sign in with your work email.
          </AuthHeading>
          <div className="pp-auth__fields">
            <Field id="login-email" label="Work email">
              <TextInput
                id="login-email"
                name="email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@packback.network"
                autoComplete="email"
                autoFocus
                required
                disabled={busy}
              />
            </Field>
            <Field
              id="login-password"
              label="Password"
              action={(
                <button type="button" className="pp-auth__link pp-auth__link--small" onClick={() => switchMode('forgot')}>
                  Forgot password?
                </button>
              )}
            >
              <PasswordInput
                id="login-password"
                name="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Your password"
                autoComplete="current-password"
                required
                disabled={busy}
              />
            </Field>
          </div>
          <FormAlert>{err}</FormAlert>
          <FormAlert tone="success">{info}</FormAlert>
          <PrimaryButton busy={busy} busyLabel="Signing in…" disabled={busy}>
            Sign in
          </PrimaryButton>
          <p className="pp-auth__switch">
            New to the PackBack team?{' '}
            <button type="button" className="pp-auth__link" onClick={() => switchMode('signup')} disabled={busy}>
              Create an account
            </button>
          </p>
        </form>
      )}

      {mode === 'signup' && (
        <form className="pp-auth" onSubmit={handleSignUp}>
          <AuthHeading title="Create account">
            Admin accounts are for the PackBack team. We’ll email you a 6-digit
            code to confirm it’s really you.
          </AuthHeading>
          <div className="pp-auth__fields">
            <Field
              id="login-email"
              label="Work email"
              hint={<><LockIcon size={12} /> Only <b>@{ADMIN_EMAIL_DOMAIN}</b> addresses can register.</>}
            >
              <TextInput
                id="login-email"
                name="email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder={`you@${ADMIN_EMAIL_DOMAIN}`}
                autoComplete="email"
                aria-describedby="login-email-hint"
                autoFocus
                required
                disabled={busy}
              />
            </Field>
            <Field id="login-password" label="Choose a password">
              <PasswordInput
                id="login-password"
                name="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                autoComplete="new-password"
                required
                minLength={8}
                disabled={busy}
              />
            </Field>
          </div>
          <FormAlert>{err}</FormAlert>
          <FormAlert tone="success">{info}</FormAlert>
          <PrimaryButton busy={busy} busyLabel="Creating account…" disabled={busy || !isPackbackEmail(email)}>
            Create account
          </PrimaryButton>
          <p className="pp-auth__fine">
            By creating an account you agree to the staff data policy.
          </p>
          <p className="pp-auth__switch">
            Already have an account?{' '}
            <button type="button" className="pp-auth__link" onClick={() => switchMode('signin')} disabled={busy}>
              Sign in
            </button>
          </p>
        </form>
      )}

      {mode === 'verify' && (
        <form className="pp-auth" onSubmit={handleVerify}>
          <AuthHeading icon={<MailCheckIcon size={20} />} tone="success" title="Check your email">
            We sent a 6-digit code to <b>{email.trim()}</b>. Enter it below to
            confirm your address.
          </AuthHeading>
          <div className="pp-auth__fields">
            <Field id="login-code" label="Verification code" hint="Not arrived after a minute? Check your spam folder.">
              {/* Supabase project has "Email OTP" enabled with length=6,
               * so {{ .Token }} emits a 6-digit numeric code. We strip
               * any non-digit characters on paste — that way users
               * pasting from formatted emails (e.g. "123 456" or
               * "123-456") still land on a clean numeric value. If the
               * Supabase OTP setting is ever flipped back to the default
               * alphanumeric token, swap inputMode to "text", drop the
               * digit-only filter, and relax the length check below. */}
              <TextInput
                code
                id="login-code"
                name="code"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={otp}
                onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                autoComplete="one-time-code"
                aria-describedby="login-code-hint"
                autoFocus
                required
                disabled={busy}
              />
            </Field>
          </div>
          <FormAlert>{err}</FormAlert>
          <FormAlert tone="success">{info}</FormAlert>
          <PrimaryButton busy={busy} busyLabel="Verifying…" disabled={busy || otp.length !== 6}>
            Verify &amp; sign in
          </PrimaryButton>
          <div className="pp-auth__row">
            <button type="button" className="pp-auth__link pp-auth__link--quiet" onClick={() => switchMode('signup')}>
              <ArrowLeftIcon size={14} /> Different address
            </button>
            <button type="button" className="pp-auth__link" onClick={handleResend} disabled={busy || resendIn > 0}>
              {resendIn > 0 ? `Resend in ${resendIn}s` : 'Send a new code'}
            </button>
          </div>
        </form>
      )}

      {mode === 'forgot' && (
        <form className="pp-auth" onSubmit={handleForgot}>
          <AuthHeading icon={<KeyIcon size={20} />} title="Reset your password">
            Enter your work email and we’ll send you a link to choose a new
            password.
          </AuthHeading>
          <div className="pp-auth__fields">
            <Field id="login-email" label="Work email">
              <TextInput
                id="login-email"
                name="email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@company.com"
                autoComplete="email"
                autoFocus
                required
                disabled={busy}
              />
            </Field>
          </div>
          <FormAlert>{err}</FormAlert>
          <FormAlert tone="success">{info}</FormAlert>
          <PrimaryButton busy={busy} busyLabel="Sending…" disabled={busy}>
            Send reset link
          </PrimaryButton>
          <div className="pp-auth__row">
            <button type="button" className="pp-auth__link pp-auth__link--quiet" onClick={() => switchMode('signin')}>
              <ArrowLeftIcon size={14} /> Back to sign in
            </button>
          </div>
        </form>
      )}
    </AuthLayout>
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
