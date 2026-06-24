import { useEffect, useRef, useState } from 'react';
import {
  sendMagicLink,
  signOutUser,
  getCurrentAuthEmail,
  requestRestoreOtp,
  verifyRestoreOtp,
  finaliseRestore,
} from '../lib/api';
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
export default function SignInSheet({ open, onClose, onLinked, requireVerification = true, savedEmail = null, onSaveEmailDirect }) {
  /* Mode = which top-level flow the sheet is showing. The original
   * one-flow design grew to two:
   *   • 'save'    — link an email to back the current device up
   *                 (original magic-link flow)
   *   • 'restore' — recover an existing account on a new device
   *                 (OTP code entry + server-side merge)
   * Each mode has its own status machine (see `status` below). */
  const [mode, setMode] = useState('save'); // 'save' | 'restore'
  const [status, setStatus] = useState('idle'); // see comments per-mode below
  const [email, setEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [restoreResult, setRestoreResult] = useState(null); // { status, merged_balance? }
  const [error, setError] = useState(null);
  const [currentEmail, setCurrentEmail] = useState(null);
  const inputRef = useRef(null);
  const codeRef  = useRef(null);

  // When the sheet opens, find out whether the user is already signed
  // in so we render the right initial state.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // No-verification mode: the email lives on the user row, there's no auth
    // session to read. Show the saved email (if any) without an OTP round-trip.
    if (!requireVerification) {
      if (savedEmail) { setCurrentEmail(savedEmail); setStatus('savedDirect'); }
      else { setCurrentEmail(null); setStatus('idle'); }
      return () => { cancelled = true; };
    }
    getCurrentAuthEmail().then(e => {
      if (cancelled) return;
      if (e) { setCurrentEmail(e); setStatus('signedIn'); }
      else   { setCurrentEmail(null); setStatus('idle'); }
    });
    return () => { cancelled = true; };
  }, [open, requireVerification, savedEmail]);

  // Auto-focus the email input (save mode or first step of restore)
  // or the OTP input (restore code-entry step) when the sheet opens.
  useEffect(() => {
    if (!open) return;
    let t;
    if (status === 'idle' || status === 'restore_email') {
      t = setTimeout(() => inputRef.current?.focus(), 220);
    } else if (status === 'restore_code' || status === 'sent') {
      t = setTimeout(() => codeRef.current?.focus(), 220);
    }
    return () => t && clearTimeout(t);
  }, [open, status]);

  // Reset transient state when the sheet closes so the next open is clean.
  useEffect(() => {
    if (open) return;
    setOtpCode('');
    setRestoreResult(null);
    setError(null);
  }, [open]);

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

    // No-verification mode: store the email straight onto the user row.
    if (!requireVerification) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        setError("That email doesn't look quite right — try again.");
        setStatus('error');
        return;
      }
      setStatus('sending');
      try {
        await onSaveEmailDirect?.(email.trim());
        setCurrentEmail(email.trim());
        setStatus('savedDirect');
      } catch (err) {
        setError(err?.message || 'Could not save your email. Please try again.');
        setStatus('error');
      }
      return;
    }

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

  /* Verify the 6-digit code from the "save" email. Our Supabase email
   * template sends a code (+ link); on a phone the link often opens in a
   * different browser and loses the device session, so typing the code
   * in-place is the reliable path. verifyOtp(type:'email') signs them in
   * right here; App.jsx's SIGNED_IN handler then links the auth user onto
   * this device's PackPerks row. */
  async function handleVerifySaveCode(e) {
    e.preventDefault();
    if (otpCode.length !== 6) return;
    setError(null);
    setStatus('verifying');
    try {
      await verifyRestoreOtp(email, otpCode); // verifyOtp({ type: 'email' })
      setCurrentEmail(email.trim());
      setStatus('signedIn');
      onLinked?.();
    } catch (err) {
      const code = err?.detail?.error || err?.message;
      const friendly =
        code === 'invalid_code'
          ? 'That code is 6 digits — check the email and try again.'
          : /expired/i.test(code || '')
            ? 'That code expired. Tap "Resend" below to get a fresh one.'
            : /invalid/i.test(code || '')
              ? "That code doesn't match. Double-check the email — 6 digits, no spaces."
              : (code || 'Something went wrong verifying the code.');
      setError(friendly);
      setStatus('sent');
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

  /* ── Restore-by-email flow ────────────────────────────────────────────
   * Three steps the user walks through:
   *   1. Type the email they used previously → requestRestoreOtp fires.
   *   2. Type the 6-digit code from email → verifyRestoreOtp creates
   *      an auth session.
   *   3. We immediately call finaliseRestore, which hits the edge
   *      function to merge their device row into their email row.
   *      The result tells us whether anything was actually merged so
   *      we can show the right confirmation copy. */
  async function handleRequestRestore(e) {
    e.preventDefault();
    if (!email.trim()) return;
    setError(null);
    // Already signed in to this exact email? There's nothing to restore —
    // say so plainly instead of letting the merge return a vague error.
    if (currentEmail && currentEmail.trim().toLowerCase() === email.trim().toLowerCase()) {
      setError("You're already signed in with this email on this device — your cups are already here.");
      setStatus('restore_email');
      return;
    }
    setStatus('restore_sending');
    try {
      await requestRestoreOtp(email);
      setStatus('restore_code');
    } catch (err) {
      setError(
        err.message === 'invalid_email'
          ? "That email doesn't look quite right — try again."
          : err.message || 'Something went wrong. Please try again.',
      );
      setStatus('restore_email');
    }
  }

  async function handleVerifyRestore(e) {
    e.preventDefault();
    if (otpCode.length !== 6) return;
    setError(null);
    setStatus('restore_verifying');
    try {
      await verifyRestoreOtp(email, otpCode);
      // Auth session is now in place. Ask the edge function to merge.
      const result = await finaliseRestore();
      setRestoreResult(result);
      setCurrentEmail(email.trim());
      setStatus('restore_done');
      // Tell the parent to re-pull the user row — App.jsx then refreshes
      // cup count / history with the merged state.
      onLinked?.();
    } catch (err) {
      const code = err?.detail?.error || err?.message;
      const friendly =
        code === 'invalid_code'
          ? 'That code is 6 digits — check the email and try again.'
          : code === 'otp_expired' || code === 'token_has_expired' || /expired/i.test(code || '')
            ? 'That code expired. Tap "Send a new code" below to get a fresh one.'
            : code === 'invalid_token' || /invalid/i.test(code || '')
              ? "That code doesn't match. Double-check the email — codes are 6 digits, no spaces."
              : code === 'update_failed' || code === 'survivor_update_failed' || code === 'merge_balance_failed'
                ? "Looks like you're already signed in to this account on this device — your cups should already be here. Pull to refresh to check."
                : (code || 'Something went wrong verifying the code.');
      setError(friendly);
      setStatus('restore_code');
    }
  }

  function switchToRestore() {
    setError(null);
    setStatus('restore_email');
    setMode('restore');
  }

  function switchToSave() {
    setError(null);
    setOtpCode('');
    setRestoreResult(null);
    setStatus('idle');
    setMode('save');
  }

  if (!open) return null;

  return (
    <div className="signin-overlay" onClick={onClose}>
      <div className="signin-sheet" onClick={e => e.stopPropagation()}>
        <button className="signin-close" onClick={onClose} aria-label="Close">×</button>

        {/* Email saved without verification (verification toggle is off) */}
        {status === 'savedDirect' && (
          <div className="signin-state">
            <div className="signin-art signin-art--ok">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </div>
            <h2 className="signin-title">Email saved</h2>
            <p className="signin-sub">
              Your balance is linked to <strong>{currentEmail}</strong>. You can update it any time.
            </p>
            <button
              className="signin-btn signin-btn--ghost"
              onClick={() => { setEmail(''); setError(null); setStatus('idle'); }}
            >
              Change email
            </button>
          </div>
        )}

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

        {/* "Check your inbox" — enter the 6-digit code (or tap the link). */}
        {(status === 'sent' || status === 'verifying') && (
          <form className="signin-state" onSubmit={handleVerifySaveCode}>
            <div className="signin-art signin-art--sent">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
              </svg>
            </div>
            <h2 className="signin-title">Check your inbox</h2>
            <p className="signin-sub">
              We sent a 6-digit code to <strong>{email}</strong>.
              <br />Enter it below to finish linking your cups.
            </p>

            <label className="signin-label" htmlFor="save-code">6-digit code</label>
            <input
              id="save-code"
              ref={codeRef}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              className="signin-input signin-input--code"
              placeholder="123456"
              value={otpCode}
              onChange={e => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              disabled={status === 'verifying'}
              required
            />

            {error && <p className="signin-error">{error}</p>}

            <button
              type="submit"
              className="signin-btn signin-btn--primary"
              disabled={status === 'verifying' || otpCode.length !== 6}
            >
              {status === 'verifying' ? 'Verifying…' : 'Verify code'}
            </button>

            <p className="signin-fine">
              On a computer you can also just tap the sign-in link in the email.
            </p>

            <button
              type="button"
              className="signin-btn signin-btn--ghost"
              onClick={() => { setStatus('idle'); setEmail(''); setOtpCode(''); setError(null); }}
            >
              Use a different email
            </button>
          </form>
        )}

        {/* Idle form (or error variant of it) — "save" mode only */}
        {mode === 'save' && (status === 'idle' || status === 'sending' || status === 'error') && (
          <form className="signin-state" onSubmit={handleSubmit}>
            <div className="signin-art">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            </div>
            <h2 className="signin-title">Save your cups across devices</h2>
            <p className="signin-sub">
              {requireVerification
                ? <>Link your balance to an email so you can pick up where you left off — even after switching phones or clearing your browser.</>
                : <>Add an email to your balance so you can recover it later. No code needed — it's saved right away.</>}
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
              {requireVerification
                ? (status === 'sending' ? 'Sending…' : 'Send me a sign-in link')
                : (status === 'sending' ? 'Saving…' : 'Save email')}
            </button>

            <p className="signin-fine">
              We'll only use this address to sign you in. No marketing,
              ever.
            </p>

            {/* Restore entry — sits at the bottom so the primary CTA
                stays "Save", but lost-my-cups users can find their way
                in without us inventing a separate route. */}
            <div className="signin-divider">
              <span className="signin-divider__rule" />
              <span className="signin-divider__label">Already used PackPerks?</span>
              <span className="signin-divider__rule" />
            </div>
            <button
              type="button"
              className="signin-btn signin-btn--ghost"
              onClick={switchToRestore}
            >
              I lost my cups — restore by email
            </button>
          </form>
        )}

        {/* ── Restore: step 1 — ask for email ── */}
        {mode === 'restore' && (status === 'restore_email' || status === 'restore_sending') && (
          <form className="signin-state" onSubmit={handleRequestRestore}>
            <div className="signin-art">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 4v6h6" />
                <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
              </svg>
            </div>
            <h2 className="signin-title">Restore your cups</h2>
            <p className="signin-sub">
              Enter the email you used before. We'll send a 6-digit code
              to confirm it's you, then bring your cup balance back to
              this device.
            </p>

            <label className="signin-label" htmlFor="restore-email">Email</label>
            <input
              id="restore-email"
              ref={inputRef}
              type="email"
              autoComplete="email"
              inputMode="email"
              className="signin-input"
              placeholder="you@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              disabled={status === 'restore_sending'}
              required
            />

            {error && <p className="signin-error">{error}</p>}

            <button
              type="submit"
              className="signin-btn signin-btn--primary"
              disabled={status === 'restore_sending' || !email.trim()}
            >
              {status === 'restore_sending' ? 'Sending…' : 'Send 6-digit code'}
            </button>
            <button
              type="button"
              className="signin-btn signin-btn--ghost"
              onClick={switchToSave}
            >
              Back to sign-in
            </button>
          </form>
        )}

        {/* ── Restore: step 2 — verify the code + merge ── */}
        {mode === 'restore' && (status === 'restore_code' || status === 'restore_verifying') && (
          <form className="signin-state" onSubmit={handleVerifyRestore}>
            <div className="signin-art signin-art--sent">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
              </svg>
            </div>
            <h2 className="signin-title">Enter your code</h2>
            <p className="signin-sub">
              We sent a 6-digit code to <strong>{email}</strong>. Type
              it below — codes expire after a few minutes.
            </p>

            <label className="signin-label" htmlFor="restore-code">6-digit code</label>
            <input
              id="restore-code"
              ref={codeRef}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              className="signin-input signin-input--code"
              placeholder="123456"
              value={otpCode}
              onChange={e => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              disabled={status === 'restore_verifying'}
              required
            />

            {error && <p className="signin-error">{error}</p>}

            <button
              type="submit"
              className="signin-btn signin-btn--primary"
              disabled={status === 'restore_verifying' || otpCode.length !== 6}
            >
              {status === 'restore_verifying' ? 'Restoring…' : 'Restore my cups'}
            </button>
            <button
              type="button"
              className="signin-btn signin-btn--ghost"
              onClick={() => {
                // Restart from step 1 — resends a new code.
                setOtpCode('');
                setError(null);
                setStatus('restore_email');
              }}
              disabled={status === 'restore_verifying'}
            >
              Send a new code
            </button>
          </form>
        )}

        {/* ── Restore: step 3 — done ── */}
        {mode === 'restore' && status === 'restore_done' && (
          <div className="signin-state">
            <div className="signin-art signin-art--ok">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </div>
            <h2 className="signin-title">
              {restoreResult?.status === 'merged'
                ? 'Welcome back!'
                : restoreResult?.status === 'no_prior_history'
                  ? "You're signed in"
                  : 'Cups restored'}
            </h2>
            <p className="signin-sub">
              {restoreResult?.status === 'merged' ? (
                <>
                  Your previous balance has been merged into this device.
                  You now have <strong>{restoreResult.merged_balance} cup{restoreResult.merged_balance === 1 ? '' : 's'}</strong> total.
                </>
              ) : restoreResult?.status === 'repointed' ? (
                <>Your previous cup balance is now available on this device.</>
              ) : restoreResult?.status === 'linked' ? (
                <>This device is now backed up to <strong>{currentEmail}</strong>.</>
              ) : restoreResult?.status === 'no_prior_history' ? (
                <>We didn't find an earlier balance under <strong>{currentEmail}</strong>, but you're now signed in — any cups you collect from now on will be saved to this email.</>
              ) : (
                <>You're all set.</>
              )}
            </p>
            <button className="signin-btn signin-btn--primary" onClick={onClose}>
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
