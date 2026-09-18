import { useState } from 'react';
import { ArrowLeft, Eye, EyeOff } from 'lucide-react';
import logo from '../assets/images/packperks-logo.svg';
import { errorText, signIn, staffCall } from './staffApi';

/* ─────────────────────────────────────────────────────────────────────
 * Sign in with email and password. A code by email is used only to create
 * the account and to set a new password.
 *   signin → (create) signup → signup-code → signed in
 *          → (forgot) reset → reset-code → signin
 * ───────────────────────────────────────────────────────────────────── */

function PasswordInput({ value, onChange, autoComplete, id, placeholder }) {
  const [show, setShow] = useState(false);
  return (
    <div className="st-pw">
      <input
        id={id}
        className="st-input"
        type={show ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        autoComplete={autoComplete}
        placeholder={placeholder}
        required
      />
      <button type="button" className="st-pw__toggle" onClick={() => setShow(s => !s)} aria-label={show ? 'Hide password' : 'Show password'}>
        {show ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
      </button>
    </div>
  );
}

const HEAD = {
  signin: { title: 'Sign in', sub: 'Make cup QR codes for your customers.' },
  signup: { title: 'Create your account', sub: 'Use the email address your manager added.' },
  'signup-code': { title: 'Check your email', sub: null },
  reset: { title: 'Forgot your password?', sub: 'We send a code to your email so you can set a new one.' },
  'reset-code': { title: 'Set a new password', sub: null },
};

export default function StaffLogin({ notice, onNoticeSeen }) {
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [venue, setVenue] = useState(null);
  const [resendAt, setResendAt] = useState(0);

  const head = HEAD[mode];
  const cleanEmail = email.trim().toLowerCase();

  function go(next) {
    setMode(next);
    setError(null);
    setInfo(null);
    setCode('');
    setPassword('');
    onNoticeSeen?.();
  }

  async function run(fn) {
    setBusy(true);
    setError(null);
    try { await fn(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }

  const submit = (e) => {
    e.preventDefault();
    if (busy) return;
    if (mode === 'signin') {
      run(() => signIn(cleanEmail, password));
    } else if (mode === 'signup') {
      run(async () => {
        const res = await staffCall('signup_request', { email: cleanEmail });
        setVenue(res.venue || null);
        setResendAt(Date.now() + 60_000);
        setMode('signup-code');
      });
    } else if (mode === 'signup-code') {
      run(async () => {
        const res = await staffCall('signup_verify', { email: cleanEmail, code, password, name });
        if (res.existing_login) setInfo('Your email already had a PackPerks login. It now uses this password.');
        await signIn(cleanEmail, password);
      });
    } else if (mode === 'reset') {
      run(async () => {
        await staffCall('reset_request', { email: cleanEmail });
        setResendAt(Date.now() + 60_000);
        setMode('reset-code');
      });
    } else if (mode === 'reset-code') {
      run(async () => {
        await staffCall('reset_verify', { email: cleanEmail, code, password });
        setMode('signin');
        setCode('');
        setPassword('');
        setInfo('Password changed. Sign in with your new password.');
      });
    }
  };

  function resend() {
    if (Date.now() < resendAt) {
      setError(null);
      setInfo('A code is on its way. You can ask for a new one after a minute.');
      return;
    }
    run(async () => {
      await staffCall(mode === 'signup-code' ? 'signup_request' : 'reset_request', { email: cleanEmail });
      setResendAt(Date.now() + 60_000);
      setInfo('A new code is on its way.');
    });
  }

  const codeStep = mode === 'signup-code' || mode === 'reset-code';

  return (
    <div className="st-login">
      <header className="st-brand">
        <img src={logo} alt="PackPerks" className="st-brand__logo" />
        <span className="st-brand__rule" aria-hidden="true" />
        <span className="st-brand__app">Staff</span>
      </header>

      <main className="st-login__card">
        <div className="st-login__head" key={mode}>
          <h1 className="st-login__title">{head.title}</h1>
          <p className="st-login__sub">
            {codeStep
              ? <>We sent a 6-digit code to <b>{cleanEmail}</b>{mode === 'signup-code' && venue ? <> for <b>{venue}</b></> : null}.</>
              : head.sub}
          </p>
        </div>

        {notice && mode === 'signin' && <p className="st-alert" role="alert">{notice}</p>}

        <form className="st-form" onSubmit={submit} noValidate={false}>
          {!codeStep && (
            <label className="st-field">
              <span className="st-field__label">Email</span>
              <input
                className="st-input"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                placeholder="you@work.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />
            </label>
          )}

          {codeStep && (
            <label className="st-field">
              <span className="st-field__label">Code</span>
              <input
                className="st-input st-input--code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                placeholder="000000"
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                autoFocus
                required
              />
            </label>
          )}

          {mode === 'signup-code' && (
            <label className="st-field">
              <span className="st-field__label">Your name</span>
              <input
                className="st-input"
                autoComplete="name"
                placeholder="How colleagues know you"
                value={name}
                maxLength={60}
                onChange={e => setName(e.target.value)}
              />
            </label>
          )}

          {(mode === 'signin' || codeStep) && (
            <div className="st-field">
              <div className="st-field__labelrow">
                <label className="st-field__label" htmlFor="st-password">
                  {mode === 'signin' ? 'Password' : mode === 'signup-code' ? 'Choose a password' : 'New password'}
                </label>
                {mode === 'signin' && (
                  <button type="button" className="st-link" onClick={() => go('reset')}>Forgot password?</button>
                )}
              </div>
              <PasswordInput
                id="st-password"
                value={password}
                onChange={setPassword}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                placeholder={mode === 'signin' ? 'Your password' : 'At least 8 characters'}
              />
            </div>
          )}

          {error && <p className="st-alert" role="alert">{error}</p>}
          {info && !error && <p className="st-note" role="status">{info}</p>}

          <button
            type="submit"
            className="st-btn st-btn--primary st-btn--big"
            disabled={busy || (codeStep && (code.length !== 6 || password.length < 8))}
          >
            {busy ? <span className="st-spin st-spin--light" /> : null}
            {mode === 'signin' && (busy ? 'Signing in…' : 'Sign in')}
            {(mode === 'signup' || mode === 'reset') && (busy ? 'Sending…' : 'Send code')}
            {mode === 'signup-code' && (busy ? 'Creating…' : 'Create account')}
            {mode === 'reset-code' && (busy ? 'Saving…' : 'Save password')}
          </button>
        </form>

        <div className="st-login__foot">
          {mode === 'signin' && (
            <p>New here? <button type="button" className="st-link st-link--strong" onClick={() => go('signup')}>Create an account</button></p>
          )}
          {codeStep && (
            <p>
              No email?{' '}
              <button type="button" className="st-link st-link--strong" onClick={resend} disabled={busy}>Send it again</button>
            </p>
          )}
          {mode !== 'signin' && (
            <button type="button" className="st-link" onClick={() => go('signin')}>
              <ArrowLeft size={14} aria-hidden="true" /> Back to sign in
            </button>
          )}
        </div>
      </main>

      <p className="st-login__legal">PackPerks by PackBack</p>
    </div>
  );
}
