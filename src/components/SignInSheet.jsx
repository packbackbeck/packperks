import { useEffect, useRef, useState } from 'react';
import {
  sendMagicLink,
  signOutUser,
  getCurrentAuthEmail,
  requestRestoreOtp,
  verifyRestoreOtp,
  finaliseRestore,
  checkEmailSaveOrMerge,
  mergeByEmail,
  mergeGuard,
  changeAuthEmail,
} from '../lib/api';
import PrivacyPolicyView from './PrivacyPolicyView';
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
export default function SignInSheet({ open, onClose, onLinked, onVerified, onMergeHeld, requireVerification = true, savedEmail = null, onSaveEmailDirect, onMarketingConsent, privacyPolicy = null, __devStatus = null, __devEmail = null }) {
  /* Mode = which top-level flow the sheet is showing. The original
   * one-flow design grew to two:
   *   • 'save'    — link an email to back the current device up
   *                 (original magic-link flow)
   *   • 'restore' — recover an existing account on a new device
   *                 (OTP code entry + server-side merge)
   * Each mode has its own status machine (see `status` below). */
  const mergeFromSave = useRef(false); // true once we've routed Save → merge OTP
  const verifyingRef = useRef(false);  // C.7: blocks a double-submit of the code
  const statusRef = useRef('idle');    // C.7: live status, so a late catch can't clobber a success
  const [mergeOtherCount, setMergeOtherCount] = useState(0); // for the merge-offer prompt
  const [mode, setMode] = useState('save'); // 'save' | 'restore'
  // __devStatus/__devEmail: DEV-only, used solely by the screen-audit harness
  // (?__shot=…) to open the sheet directly in a given status for screenshots.
  const [status, setStatus] = useState(import.meta.env.DEV && __devStatus ? __devStatus : 'idle');
  const [email, setEmail] = useState(import.meta.env.DEV && __devEmail ? __devEmail : '');
  // Two consent boxes on the email form: privacy-policy acknowledgement
  // (required to continue) and a marketing opt-in (default on per product).
  const [marketingConsent, setMarketingConsent] = useState(true);
  const [privacyRead, setPrivacyRead] = useState(false);
  const [showPolicy, setShowPolicy] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [newEmail, setNewEmail] = useState(''); // for the change-email flow
  const [restoreResult, setRestoreResult] = useState(null); // { status, merged_balance? }
  const [mergeHeldMsg, setMergeHeldMsg] = useState(null); // weekly-limit "sent for review" copy
  const [error, setError] = useState(null);
  const [currentEmail, setCurrentEmail] = useState(import.meta.env.DEV && __devEmail ? __devEmail : null);
  const inputRef = useRef(null);
  const codeRef  = useRef(null);

  // When the sheet opens, find out whether the user is already signed
  // in so we render the right initial state.
  useEffect(() => {
    if (!open) return;
    // DEV screen-audit: honour the forced __devStatus, don't reset on open.
    if (import.meta.env.DEV && __devStatus) return;
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
    if (status === 'idle' || status === 'restore_email' || status === 'change_email') {
      t = setTimeout(() => inputRef.current?.focus(), 220);
    } else if (status === 'restore_code' || status === 'sent') {
      t = setTimeout(() => codeRef.current?.focus(), 220);
    }
    return () => t && clearTimeout(t);
  }, [open, status]);

  // C.7: keep statusRef in sync so the verify handlers can read the live status.
  useEffect(() => { statusRef.current = status; }, [status]);

  // Reset transient state when the sheet closes so the next open is clean.
  useEffect(() => {
    if (open) return;
    setOtpCode('');
    setNewEmail('');
    setRestoreResult(null);
    setError(null);
    // C.1: also reset `mode` — otherwise a reopen after the Restore flow lands
    // in (mode='restore', status='idle'), which no render branch handles, and
    // the popup goes blank/frozen (it's the gate for every cashback claim).
    // mergeFromSave is reset too so a later plain restore isn't mis-routed to
    // merge (this is also the close-side of C.8.2).
    setMode('save');
    mergeFromSave.current = false;
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

    // Record the marketing-email choice on submit — independent of email
    // verification. Service email is lawful without consent; marketing is what
    // the user has just explicitly opted into (or left unchecked).
    try { onMarketingConsent?.(marketingConsent); } catch { /* non-fatal */ }

    // No-verification mode: check first whether this email is already on
    // ANOTHER PackPerks account in the same org. If clean → save directly
    // (frictionless, same as before). If used → DON'T save; route to the
    // OTP verify + merge flow so we never create another duplicate.
    if (!requireVerification) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        setError("That email doesn't look quite right, try again.");
        setStatus('error');
        return;
      }
      setStatus('sending');
      try {
        const check = await checkEmailSaveOrMerge(email);
        if (check?.status === 'merge_required') {
          setMergeOtherCount(check.other_count || 1);
          setStatus('merge_offer');
        } else {
          // Server saved the email; sync local state.
          setCurrentEmail(email.trim());
          setStatus('savedDirect');
          // Best-effort: also notify the parent so its in-memory profile updates.
          try { await onSaveEmailDirect?.(email.trim()); } catch { /* server already saved */ }
        }
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
        ? "That email doesn't look quite right, try again."
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
    // C.7 fix 1: a fast double-Enter would fire verify twice; the second replays
    // an already-used code, fails, and its error wipes the success screen. This
    // in-flight guard makes the second submit a no-op.
    if (verifyingRef.current) return;
    verifyingRef.current = true;
    setError(null);
    setStatus('verifying');
    try {
      await verifyRestoreOtp(email, otpCode); // verifyOtp({ type: 'email' })
      setCurrentEmail(email.trim());
      setStatus('signedIn');
      onLinked?.();
      onVerified?.(); // may auto-continue a claim that was waiting on an email
    } catch (err) {
      // C.7 fix 2: never let a late failure erase a success that already landed.
      if (statusRef.current !== 'signedIn') {
        const code = err?.detail?.error || err?.message;
        const friendly =
          code === 'invalid_code'
            ? 'That code is 6 digits, check the email and try again.'
            : /expired/i.test(code || '')
              ? 'That code expired. Tap "Resend" below to get a fresh one.'
              : /invalid/i.test(code || '')
                ? "That code doesn't match. Double-check the email: 6 digits, no spaces."
                : (code || 'Something went wrong verifying the code.');
        setError(friendly);
        setStatus('sent');
      }
    } finally {
      verifyingRef.current = false;
    }
  }

  /* Change the email on the current account (keeps cups). Supabase emails a
   * confirmation link to the new address; the change applies when it's opened. */
  async function handleChangeEmail(e) {
    e.preventDefault();
    const email = newEmail.trim();
    if (!email) return;
    if (currentEmail && email.toLowerCase() === currentEmail.trim().toLowerCase()) {
      setError('That’s already your email on this account.');
      return;
    }
    setError(null);
    setStatus('change_sending');
    try {
      await changeAuthEmail(email);
      setStatus('change_sent');
    } catch (err) {
      setError(err.message === 'invalid_email'
        ? "That email doesn't look quite right, try again."
        : (err.message || 'Could not start the email change. Please try again.'));
      setStatus('change_email');
    }
  }

  async function handleSignOut() {
    try {
      await signOutUser();
      setCurrentEmail(null);
      setStatus('idle');
      // Notify the parent so it can refresh the user row (back to
      // anonymous device-only mode for any further reads).
      onLinked?.({ signedOut: true });
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
      setError("You're already signed in with this email on this device. Your cups are already here.");
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
          ? "That email doesn't look quite right, try again."
          : err.message || 'Something went wrong. Please try again.',
      );
      setStatus('restore_email');
    }
  }

  async function handleVerifyRestore(e) {
    e.preventDefault();
    if (otpCode.length !== 6) return;
    if (verifyingRef.current) return;   // C.7 fix 1: block a double-submit
    verifyingRef.current = true;
    setError(null);
    setStatus('restore_verifying');
    try {
      // Verify the code → real auth session. This IS the person (they control the
      // email), so restoring their own account always just works — no merge-limit
      // hold, no admin review. The parent's onLinked then consolidates ALL their
      // rows across every store under one auth-linked identity and merges any
      // duplicate per-store rows, so cross-store balances appear immediately and
      // no duplicate accounts are created.
      await verifyRestoreOtp(email, otpCode);
      setRestoreResult({ status: 'restored' });
      setCurrentEmail(email.trim());
      setStatus('restore_done');
      onLinked?.();
    } catch (err) {
      // C.7 fix 2: don't let a late failure erase a finished restore.
      if (statusRef.current !== 'restore_done') {
        const code = err?.detail?.error || err?.message;
        const friendly =
          code === 'invalid_code'
            ? 'That code is 6 digits, check the email and try again.'
            : code === 'otp_expired' || code === 'token_has_expired' || /expired/i.test(code || '')
              ? 'That code expired. Tap "Send a new code" below to get a fresh one.'
              : code === 'invalid_token' || /invalid/i.test(code || '')
                ? "That code doesn't match. Double-check the email: codes are 6 digits, no spaces."
                : code === 'update_failed' || code === 'survivor_update_failed' || code === 'merge_balance_failed'
                  ? "Looks like you're already signed in to this account on this device. Your cups should already be here. Pull to refresh to check."
                  : (code || 'Something went wrong verifying the code.');
        setError(friendly);
        setStatus('restore_code');
      }
    } finally {
      verifyingRef.current = false;
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
    mergeFromSave.current = false;
    setStatus('idle');
    setMode('save');
  }

  // From the "merge_offer" step (Save flow detected the email is already
  // on another account) — send the 6-digit code and switch into the
  // existing OTP-entry UI. On verify we'll call mergeByEmail (see
  // mergeFromSave above) instead of the pairwise finaliseRestore.
  async function handleSendMergeCode() {
    setError(null);
    setStatus('restore_sending');
    try {
      await requestRestoreOtp(email);
      mergeFromSave.current = true;
      setMode('restore');
      setStatus('restore_code');
    } catch (err) {
      setError(err?.message || 'Could not send the code. Please try again.');
      setStatus('merge_offer');
    }
  }

  if (!open) return null;

  return (
    <div className="signin-overlay" onClick={onClose}>
      <div className="signin-sheet" onClick={e => e.stopPropagation()}>
        <button className="signin-close" onClick={onClose} aria-label="Close">×</button>

        {/* Email is already on another account — offer to verify + merge */}
        {status === 'merge_offer' && (
          <div className="signin-state">
            <div className="signin-art">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 12l2 2 4-4" /><circle cx="12" cy="12" r="9" />
              </svg>
            </div>
            <h2 className="signin-title">This email already has cups</h2>
            <p className="signin-sub">
              <strong>{email}</strong> is already linked to {mergeOtherCount > 1 ? `${mergeOtherCount} other accounts` : 'another account'} on PackPerks.
              <br />To use it here, we'll send a 6-digit code to verify it's you, then combine the cups into one account.
            </p>
            {error && <p className="signin-error">{error}</p>}
            <button
              type="button"
              className="signin-btn signin-btn--primary"
              onClick={handleSendMergeCode}
              disabled={status === 'restore_sending'}
            >
              Send 6-digit code
            </button>
            <button
              type="button"
              className="signin-btn signin-btn--ghost"
              onClick={() => { setEmail(''); setError(null); setStatus('idle'); }}
            >
              Use a different email
            </button>
          </div>
        )}

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
              You can sign in from any device with this email. Your
              balance and history will be right there.
            </p>
            <button className="signin-btn signin-btn--primary" onClick={onClose}>
              Done
            </button>
            <button
              className="signin-btn signin-btn--ghost"
              onClick={() => { setNewEmail(''); setError(null); setStatus('change_email'); }}
            >
              Change email
            </button>
          </div>
        )}

        {/* Change the email on THIS account (keeps your cups). Supabase sends a
            confirmation to the new address; the change lands once it's opened. */}
        {(status === 'change_email' || status === 'change_sending') && (
          <form className="signin-state" onSubmit={handleChangeEmail}>
            <div className="signin-art">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
              </svg>
            </div>
            <h2 className="signin-title">Change your email</h2>
            <p className="signin-sub">
              Enter a new email for this account. We'll send a confirmation link to it.
              Your current email <strong>{currentEmail}</strong> stays active until you open it.
            </p>

            <label className="signin-label" htmlFor="change-email">New email</label>
            <input
              id="change-email"
              ref={inputRef}
              type="email"
              autoComplete="email"
              inputMode="email"
              className="signin-input"
              placeholder="new@example.com"
              value={newEmail}
              onChange={e => { setNewEmail(e.target.value); setError(null); }}
              disabled={status === 'change_sending'}
              required
            />

            {error && <p className="signin-error">{error}</p>}

            <button
              type="submit"
              className="signin-btn signin-btn--primary"
              disabled={status === 'change_sending' || !newEmail.trim()}
            >
              {status === 'change_sending' ? 'Sending…' : 'Send confirmation link'}
            </button>
            <button
              type="button"
              className="signin-btn signin-btn--ghost"
              onClick={() => { setError(null); setStatus('signedIn'); }}
            >
              Cancel
            </button>
          </form>
        )}

        {status === 'change_sent' && (
          <div className="signin-state">
            <div className="signin-art signin-art--sent">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
              </svg>
            </div>
            <h2 className="signin-title">Confirm the change</h2>
            <p className="signin-sub">
              We sent a confirmation link to <strong>{newEmail}</strong>. Open it to finish
              switching your email. Until then, <strong>{currentEmail}</strong> stays on your account.
            </p>
            <button className="signin-btn signin-btn--primary" onClick={onClose}>Done</button>
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
        {/* C.1 fix 2: draw the idle/save form whenever status is idle/sending/
            error REGARDLESS of mode, so a stray (mode='restore', status='idle')
            can never leave the popup blank. Restore uses its own restore_* statuses. */}
        {(status === 'idle' || status === 'sending' || status === 'error') && (
          <form className="signin-state" onSubmit={handleSubmit}>
            <div className="signin-art">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            </div>
            <h2 className="signin-title">Save your cups across devices</h2>
            <p className="signin-sub">
              {requireVerification
                ? <>Link your balance to an email so you can pick up where you left off, even after switching phones or clearing your browser.</>
                : <>Add an email to your balance so you can recover it later. No code needed. It's saved right away.</>}
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

            <label className="signin-consent">
              <input
                type="checkbox"
                className="signin-consent__box"
                checked={privacyRead}
                onChange={e => setPrivacyRead(e.target.checked)}
                disabled={status === 'sending'}
              />
              <span className="signin-consent__text">
                I have read the{' '}
                <button type="button" className="signin-link" onClick={() => setShowPolicy(true)}>Privacy Policy</button>.
              </span>
            </label>

            <label className="signin-consent">
              <input
                type="checkbox"
                className="signin-consent__box"
                checked={marketingConsent}
                onChange={e => setMarketingConsent(e.target.checked)}
                disabled={status === 'sending'}
              />
              <span className="signin-consent__text">Send me offers and reward updates.</span>
            </label>

            {error && <p className="signin-error">{error}</p>}

            <button
              type="submit"
              className="signin-btn signin-btn--primary"
              disabled={status === 'sending' || !email.trim() || !privacyRead}
            >
              {status === 'sending' ? 'Sending…' : 'Email me a 6-digit code'}
            </button>

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
              I lost my cups. Restore by email
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
              it below, codes expire after a few minutes.
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
                <>We didn't find an earlier balance under <strong>{currentEmail}</strong>, but you're now signed in. Any cups you collect from now on will be saved to this email.</>
              ) : (
                <>You're all set.</>
              )}
            </p>
            <button className="signin-btn signin-btn--primary" onClick={onClose}>
              Done
            </button>
          </div>
        )}

        {status === 'merge_held' && (
          <div className="signin-state">
            <div className="signin-art signin-art--pending">
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
            <h2 className="signin-title">Sent for review</h2>
            <p className="signin-sub">{mergeHeldMsg}</p>
            <button className="signin-btn signin-btn--primary" onClick={onClose}>
              Got it
            </button>
          </div>
        )}

        {showPolicy && <PrivacyPolicyView text={privacyPolicy} onClose={() => setShowPolicy(false)} />}
      </div>
    </div>
  );
}
