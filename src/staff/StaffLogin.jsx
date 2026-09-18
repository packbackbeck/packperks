import { useState } from 'react';
import { ArrowLeft, Eye, EyeOff, Hourglass, MailCheck } from 'lucide-react';
import logo from '../assets/images/packperks-logo.svg';
import { errorText, signIn, signInWithToken, staffCall } from './staffApi';
import VenuePicker from './VenuePicker';

/* ─────────────────────────────────────────────────────────────────────
 * Signing in starts with the email. The staff-app function (lookup) says
 * what that address needs next:
 *   code      @packback.network: an emailed one-time code, never a password
 *             (code-venue first when they are on no list and there is a
 *             choice of venue)
 *   password  an account with a password (forgot → reset → reset-code)
 *   setup     added by a manager, or approved: an emailed code, then a
 *             new password
 *   request   on no list: pick a venue and ask. No code, no password until
 *             someone who runs the venue approves it (then: setup)
 *   pending / blocked / app_off   say so
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
        autoFocus
        required
      />
      <button type="button" className="st-pw__toggle" onClick={() => setShow(s => !s)} aria-label={show ? 'Hide password' : 'Show password'}>
        {show ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
      </button>
    </div>
  );
}

function CodeInput({ value, onChange }) {
  return (
    <label className="st-field">
      <span className="st-field__label">Code</span>
      <input
        className="st-input st-input--code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        placeholder="000000"
        value={value}
        onChange={e => onChange(e.target.value.replace(/\D/g, ''))}
        autoFocus
        required
      />
    </label>
  );
}

/* Steps that end with a message rather than a form. */
const MESSAGE_STEPS = new Set(['requested', 'pending', 'blocked', 'app_off']);
const CODE_STEPS = new Set(['code', 'setup-code', 'reset-code']);

export default function StaffLogin({ notice, onNoticeSeen }) {
  const [mode, setMode] = useState('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [venue, setVenue] = useState(null);      // { id, name, logo_url }
  const [venues, setVenues] = useState([]);
  const [orgId, setOrgId] = useState(null);
  const [resendAt, setResendAt] = useState(0);

  const cleanEmail = email.trim().toLowerCase();
  const venueName = venue?.name || venues.find(v => v.id === orgId)?.name || null;

  function go(next) {
    setMode(next);
    setError(null);
    setInfo(null);
    setCode('');
    setPassword('');
  }

  function restart() {
    go('email');
    setVenue(null);
    setVenues([]);
    setOrgId(null);
  }

  async function run(fn) {
    setBusy(true);
    setError(null);
    try { await fn(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }

  async function sendLoginCode(org) {
    const res = await staffCall('code_request', { email: cleanEmail, ...(org ? { org_id: org } : {}) });
    if (!venue && res.venue) setVenue(v => v || { name: res.venue });
    setResendAt(Date.now() + 60_000);
    go('code');
  }

  const submit = (e) => {
    e.preventDefault();
    if (busy) return;
    onNoticeSeen?.();
    if (mode === 'email') {
      run(async () => {
        const res = await staffCall('lookup', { email: cleanEmail });
        setVenue(res.venue || null);
        setVenues(res.venues || []);
        const only = res.venues?.length === 1 ? res.venues[0].id : null;
        setOrgId(only);
        if (res.next === 'code') {
          if (res.venue || only) await sendLoginCode(only);
          else go('code-venue');
        } else {
          go(res.next);
        }
      });
    } else if (mode === 'password') {
      run(() => signIn(cleanEmail, password));
    } else if (mode === 'code-venue') {
      run(() => sendLoginCode(orgId));
    } else if (mode === 'code') {
      run(async () => {
        const res = await staffCall('code_verify', { email: cleanEmail, code });
        await signInWithToken(res.token_hash);
      });
    } else if (mode === 'setup') {
      run(async () => {
        await staffCall('signup_request', { email: cleanEmail });
        setResendAt(Date.now() + 60_000);
        go('setup-code');
      });
    } else if (mode === 'setup-code') {
      run(async () => {
        const res = await staffCall('signup_verify', { email: cleanEmail, code, password, name });
        if (res.existing_login) setInfo('Your email already had a PackPerks login. It now uses this password.');
        await signIn(cleanEmail, password);
      });
    } else if (mode === 'request') {
      run(async () => {
        const res = await staffCall('request_access', { email: cleanEmail, org_id: orgId, name });
        setVenue(res.venue || null);
        go('requested');
      });
    } else if (mode === 'reset') {
      run(async () => {
        await staffCall('reset_request', { email: cleanEmail });
        setResendAt(Date.now() + 60_000);
        go('reset-code');
      });
    } else if (mode === 'reset-code') {
      run(async () => {
        await staffCall('reset_verify', { email: cleanEmail, code, password });
        go('password');
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
      if (mode === 'code') await staffCall('code_request', { email: cleanEmail, ...(orgId ? { org_id: orgId } : {}) });
      else if (mode === 'setup-code') await staffCall('signup_request', { email: cleanEmail });
      else await staffCall('reset_request', { email: cleanEmail });
      setResendAt(Date.now() + 60_000);
      setInfo('A new code is on its way.');
    });
  }

  const at = venueName ? <> for <b>{venueName}</b></> : null;
  const HEAD = {
    email: ['Sign in', <>Make cup QR codes for your customers. Start with your work email.</>],
    password: ['Welcome back', null],
    code: ['Check your email', <>We emailed you a 6-digit code{at}. It signs you in, no password needed.</>],
    'code-venue': ['Where do you work?', <>PackBack addresses sign in with a code. Pick the venue to open.</>],
    setup: ['Set up your account', <>{venueName ? <>You're on the staff list at <b>{venueName}</b>. </> : null}We email you a code, then you choose a password.</>],
    'setup-code': ['Choose a password', <>We emailed you a 6-digit code{at}.</>],
    request: ['Ask for access', <>This email is not on a staff list yet. Pick your venue and we ask the people who run it to let you in.</>],
    requested: ['Request sent', <>We asked the people who run <b>{venueName || 'the venue'}</b> to let you in. Once they approve it, we email <b>{cleanEmail}</b>. Then come back here, enter your email and choose a password.</>],
    pending: ['Waiting for approval', <><b>{cleanEmail}</b> asked to join <b>{venueName || 'a venue'}</b>. Once someone who runs it approves the request, we email you and you can sign in here.</>],
    blocked: ['Account paused', <>The staff account for <b>{cleanEmail}</b> is paused. Ask your manager to turn it back on.</>],
    app_off: ['Staff app is off', <>The staff app is not switched on for {venueName ? <b>{venueName}</b> : 'any venue'} right now.</>],
    reset: ['Forgot your password?', <>We email you a code so you can set a new one.</>],
    'reset-code': ['Set a new password', <>We emailed you a 6-digit code.</>],
  };
  const [title, sub] = HEAD[mode];
  const isMessage = MESSAGE_STEPS.has(mode);
  const isCode = CODE_STEPS.has(mode);
  const needsPassword = mode === 'password' || mode === 'setup-code' || mode === 'reset-code';
  const disabled = busy
    || (mode === 'email' && !cleanEmail)
    || (isCode && code.length !== 6)
    || (needsPassword && mode !== 'password' && password.length < 8)
    || (mode === 'password' && !password)
    || ((mode === 'request' || mode === 'code-venue') && !orgId);
  const BUTTON = {
    email: ['Continue', 'Checking…'],
    password: ['Sign in', 'Signing in…'],
    code: ['Sign in', 'Signing in…'],
    'code-venue': ['Send code', 'Sending…'],
    setup: ['Send code', 'Sending…'],
    'setup-code': ['Create account', 'Creating…'],
    request: ['Ask for access', 'Sending…'],
    reset: ['Send code', 'Sending…'],
    'reset-code': ['Save password', 'Saving…'],
  };

  return (
    <div className="st-login">
      <header className="st-brand">
        <img src={logo} alt="PackPerks" className="st-brand__logo" />
        <span className="st-brand__rule" aria-hidden="true" />
        <span className="st-brand__app">Staff</span>
      </header>

      <main className="st-login__card">
        {isMessage && (
          <div className="st-wait">
            {venue?.logo_url && mode !== 'blocked' && mode !== 'app_off'
              ? <img src={venue.logo_url} alt={venue.name} className="st-wait__logo" />
              : <span className="st-wait__icon">{mode === 'requested' ? <MailCheck size={24} aria-hidden="true" /> : <Hourglass size={24} aria-hidden="true" />}</span>}
          </div>
        )}

        <div className="st-login__head" key={mode}>
          <h1 className="st-login__title">{title}</h1>
          {sub && <p className="st-login__sub">{sub}</p>}
        </div>

        {notice && mode === 'email' && <p className="st-alert" role="alert">{notice}</p>}

        {mode !== 'email' && !isMessage && (
          <p className="st-emailchip">
            <span>{cleanEmail}</span>
            <button type="button" className="st-link" onClick={restart}>Change</button>
          </p>
        )}

        {!isMessage && (
          <form className="st-form" onSubmit={submit}>
            {mode === 'email' && (
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
                  autoFocus
                  required
                />
              </label>
            )}

            {(mode === 'request' || mode === 'code-venue') && (
              <VenuePicker venues={venues} value={orgId} onChange={setOrgId} disabled={busy} />
            )}

            {(mode === 'request' || mode === 'setup-code') && (
              <label className="st-field">
                <span className="st-field__label">Your name</span>
                <input
                  className="st-input"
                  autoComplete="name"
                  placeholder={mode === 'request' ? 'So they know who is asking' : 'How colleagues know you'}
                  value={name}
                  maxLength={60}
                  onChange={e => setName(e.target.value)}
                />
              </label>
            )}

            {isCode && <CodeInput value={code} onChange={setCode} />}

            {needsPassword && (
              <div className="st-field">
                <div className="st-field__labelrow">
                  <label className="st-field__label" htmlFor="st-password">
                    {mode === 'password' ? 'Password' : mode === 'setup-code' ? 'Choose a password' : 'New password'}
                  </label>
                  {mode === 'password' && (
                    <button type="button" className="st-link" onClick={() => go('reset')}>Forgot password?</button>
                  )}
                </div>
                <PasswordInput
                  id="st-password"
                  value={password}
                  onChange={setPassword}
                  autoComplete={mode === 'password' ? 'current-password' : 'new-password'}
                  placeholder={mode === 'password' ? 'Your password' : 'At least 8 characters'}
                />
              </div>
            )}

            {error && <p className="st-alert" role="alert">{error}</p>}
            {info && !error && <p className="st-note" role="status">{info}</p>}

            <button type="submit" className="st-btn st-btn--primary st-btn--big" disabled={disabled}>
              {busy ? <span className="st-spin st-spin--light" /> : null}
              {BUTTON[mode][busy ? 1 : 0]}
            </button>
          </form>
        )}

        {isMessage && (
          <button type="button" className="st-btn st-btn--quiet st-btn--big" onClick={restart}>
            <ArrowLeft size={16} aria-hidden="true" /> Back to sign in
          </button>
        )}

        {isCode && (
          <div className="st-login__foot">
            <p>
              No email?{' '}
              <button type="button" className="st-link st-link--strong" onClick={resend} disabled={busy}>Send it again</button>
            </p>
          </div>
        )}
      </main>

      <p className="st-login__legal">PackPerks by PackBack</p>
    </div>
  );
}
