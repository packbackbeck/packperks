import { useState } from 'react';
import { updatePassword } from './authApi';
import AuthLayout from './login/AuthLayout';
import {
  AuthHeading,
  Field,
  FormAlert,
  PasswordInput,
  PrimaryButton,
} from './login/formParts';
import { ArrowLeftIcon, CheckCircleIcon, LockKeyholeIcon } from './login/icons';
import './LoginPage.css';

/* ResetPasswordPage — shown when an admin opens a password-reset link.
 *
 * At this point supabase-js has already exchanged the recovery token for a
 * short-lived session (AuthContext flips `recovering` on). We collect a new
 * password, call updateUser, then sign the user out so they log in fresh with
 * the new password. `onFinish` performs the sign-out + clears the recovery
 * flag so AuthGate falls back to the normal login screen. Shares the sign-in
 * page's layout (./login/AuthLayout). */
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
    <AuthLayout>
      {done ? (
        <div className="pp-auth">
          <AuthHeading icon={<CheckCircleIcon size={20} />} tone="success" title="Password updated">
            Sign in with your new password to continue.
          </AuthHeading>
          <PrimaryButton type="button" onClick={() => onFinish?.()}>
            Continue to sign in
          </PrimaryButton>
        </div>
      ) : (
        <form className="pp-auth" onSubmit={handleSubmit}>
          <AuthHeading icon={<LockKeyholeIcon size={20} />} title="Set a new password">
            Choose a new password for your admin account.
          </AuthHeading>
          <div className="pp-auth__fields">
            <Field id="reset-password" label="New password">
              <PasswordInput
                id="reset-password"
                name="new-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                autoComplete="new-password"
                autoFocus
                required
                minLength={8}
                disabled={busy}
              />
            </Field>
            <Field id="reset-confirm" label="Confirm new password">
              <PasswordInput
                id="reset-confirm"
                name="confirm-password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                placeholder="Re-enter your new password"
                autoComplete="new-password"
                required
                minLength={8}
                disabled={busy}
              />
            </Field>
          </div>
          <FormAlert>{err}</FormAlert>
          <PrimaryButton
            busy={busy}
            busyLabel="Updating…"
            disabled={busy || password.length < 8 || password !== confirm}
          >
            Update password
          </PrimaryButton>
          <div className="pp-auth__row">
            <button type="button" className="pp-auth__link pp-auth__link--quiet" onClick={() => onFinish?.()}>
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
  if (m.includes('session') && m.includes('missing')) return 'This reset link has expired. Request a new one from the sign-in screen.';
  if (m.includes('same') && m.includes('password')) return 'Pick a password different from your current one.';
  if (m.includes('token') && m.includes('expired')) return 'This reset link has expired. Request a new one from the sign-in screen.';
  if (m.includes('rate limit')) return 'Too many tries — please wait a minute and try again.';
  return e?.message || 'Something went wrong. Please try again.';
}
