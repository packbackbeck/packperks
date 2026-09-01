import { useState } from 'react';
import { loginRequest, loginVerify, storeProfile } from '../../lib/tikkieWallet';
import tikkieClaimShot from '../../assets/images/tikkie-claim-screen.png';
import './tikkie.css';

/* ─────────────────────────────────────────────────────────────────────
 * Shared Redirect Refund pieces: the Tikkie explainer, the bottom-sheet
 * shell every popup uses, and the email-code login sheet. Extracted from
 * the retired redirect page (archived in src/archive/) — the wallet home
 * is their only consumer now.
 * ───────────────────────────────────────────────────────────────────── */

/* ── What Tikkie is + how to use it. One block, text left, the real
   Tikkie page right. ── */
export function TikkieExplainer() {
  return (
    <div className="tk-explain">
      <div className="tk-explain__text">
        <p className="tk-explain__lead">
          Your refund is via <strong>Tikkie</strong>. Tikkie is a secure, fast way to get money
          straight into your bank account.
        </p>
        <p className="tk-explain__q">Don’t have Tikkie yet?</p>
        <ul>
          <li>Click <strong>Open Tikkie</strong></li>
          <li>Enter your <strong>IBAN</strong> and last name</li>
          <li>The money arrives within minutes</li>
        </ul>
      </div>
      <img className="tk-explain__shot" src={tikkieClaimShot} alt="The Tikkie payout page" />
    </div>
  );
}

/* ── The bottom-sheet shell: backdrop + card sliding up from below. ── */
export function Sheet({ onClose, label, children }) {
  return (
    <div className="tk-sheet" role="dialog" aria-modal="true" aria-label={label}>
      <div className="tk-sheet__backdrop" onClick={onClose} />
      <div className="tk-sheet__card">
        {onClose && (
          <button type="button" className="tk-sheet__close" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
        {children}
      </div>
    </div>
  );
}

/* ── Log in with a one-time email code. Two steps: email → code.
 * `startAtCode` skips ahead when the server already sent one (an email
 * that belongs to another device's profile). Success stores the profile
 * for this device and hands it back. ── */
export function LoginSheet({ org, batchId, initialEmail = '', startAtCode = false, onClose, onLoggedIn }) {
  const [step, setStep] = useState(startAtCode ? 'code' : 'email');
  const [email, setEmailVal] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function requestCode(e) {
    e?.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr(null);
    const data = await loginRequest(org?.id, email.trim());
    setBusy(false);
    if (data?.status === 'code_sent') { setStep('code'); setCode(''); return; }
    setErr(data?.error === 'no_account'
      ? 'We couldn’t find an account with this email.'
      : data?.error === 'rate_limited'
        ? 'Too many codes requested. Please try again in a while.'
        : 'We couldn’t send the code just now. Please try again.');
  }

  async function verify(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr(null);
    const data = await loginVerify(org?.id, email.trim(), code.trim(), batchId);
    setBusy(false);
    if (data?.status === 'ok' && data.user_id) {
      const profile = { userId: data.user_id, email: data.email || email.trim() };
      if (org?.id) storeProfile(org.id, profile);
      onLoggedIn?.(profile);
      return;
    }
    setErr(data?.error === 'code_expired'
      ? 'That code has expired. Request a new one.'
      : data?.error === 'too_many_attempts'
        ? 'Too many tries. Request a new code.'
        : 'That code isn’t right. Please check the email and try again.');
  }

  return (
    <Sheet onClose={onClose} label="Log in">
      {step === 'email' ? (
        <form onSubmit={requestCode}>
          <h2 className="tk-sheet__title">Log in</h2>
          <p className="tk-sheet__sub">
            Enter the email of your PackPerks account and we’ll send you a one-time code.
          </p>
          <input
            type="email"
            inputMode="email"
            className="tk-input"
            placeholder="you@example.com"
            value={email}
            onChange={e => setEmailVal(e.target.value)}
            disabled={busy}
            autoFocus
            required
          />
          {err && <p className="tk-err">{err}</p>}
          <button type="submit" className="tk-btn tk-btn--primary tk-btn--full" disabled={busy || !email.trim()}>
            {busy ? 'Sending…' : 'Send code'}
          </button>
        </form>
      ) : (
        <form onSubmit={verify}>
          <h2 className="tk-sheet__title">Enter your code</h2>
          <p className="tk-sheet__sub">
            We’ve emailed a 6-digit code to <strong>{email}</strong>. It expires in 10 minutes.
          </p>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            className="tk-input tk-input--code"
            placeholder="000000"
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
            disabled={busy}
            autoFocus
            required
          />
          {err && <p className="tk-err">{err}</p>}
          <button type="submit" className="tk-btn tk-btn--primary tk-btn--full" disabled={busy || code.length !== 6}>
            {busy ? 'Checking…' : 'Log in'}
          </button>
          <button type="button" className="tk-link tk-link--center" onClick={requestCode} disabled={busy}>
            Send a new code
          </button>
        </form>
      )}
    </Sheet>
  );
}
