import { useEffect, useRef, useState } from 'react';
import {
  sendMagicLink,
  signOutThisDevice,
  requestRestoreOtp,
  verifyRestoreOtp,
  finaliseRestore,
  checkEmailSaveOrMerge,
  mergeByEmail,
  mergeGuard,
  changeAuthEmail,
} from '../lib/api';
import PrivacyPolicyView from './PrivacyPolicyView';
import GoogleSignIn, { GoogleMark } from './GoogleSignIn';
import { getAuthInfo, switchGoogleAccount } from '../lib/oauth';
import './SignInSheet.css';

/* ─────────────────────────────────────────────────────────────────────
 * SignInSheet — the "Save your cups" sheet: sign in, or manage the account.
 *
 * The user app is anonymous by default (device_id only). This sheet
 * lets a customer optionally bind their balance to an email so they
 * can recover it on a new phone or after clearing cookies.
 *
 * States:
 *   • idle       — Google, or an email; one opt-in box, one policy line
 *   • sending    — spinner inside the button
 *   • sent       — enter the 6-digit code
 *   • signedIn   — the account: change email (or Google account), sign out
 *   • confirm_signout — "Sign out on this phone?"
 *   • error      — inline error message
 *
 * Every successful sign-in closes the sheet (onVerified): the customer is
 * back where they were, or carried on into the claim or refund that asked
 * for the email. There is no "you're signed in" screen to dismiss.
 *
 * Magic-link flow:
 *   1. User types email → tap "Send link" → sendMagicLink() fires
 *   2. Sheet flips to "sent" state with check-your-inbox copy
 *   3. User taps the email link → Supabase redirects them back here
 *      → onAuthStateChange in App.jsx picks up the SIGNED_IN event
 *      → that triggers a getOrCreateUser refresh which links the
 *      auth.users.id onto our existing PackPerks users row.
 *
 * If the user is already signed in (auth session exists), we show the
 * account instead of the form. Signing out (here, or Data & privacy →
 * Sign out, which opens this sheet at confirm_signout) ends the login and
 * forgets the device (signOutThisDevice), so the phone really is signed out.
 *
 * Google is the second door into the same account (lib/oauth.js). It sits
 * above the email field, on the restore screen, and next to the code when
 * an email already has cups, because Google proves the address just as a
 * code does. It leaves the app and comes back; App.jsx carries on from
 * there with no screen of its own (a claim or refund that was waiting
 * continues), and reopens this sheet only when Google came back with an
 * error (`oauthReturn.error`). Both doors lead to one login: Supabase links
 * an email login and a Google login with the same verified address
 * automatically.
 */
export default function SignInSheet({ open, onClose, onLinked, onVerified, onMergeHeld, requireVerification = true, savedEmail = null, onSaveEmailDirect, marketingConsent: savedMarketingConsent = false, onMarketingConsent, privacyPolicy = null, pendingAction = null, oauthReturn = null, startAt = null, __devStatus = null, __devEmail = null, __devProviders = null }) {
  // How THIS session signed in ('google' | 'email'). It decides what the
  // signed-in screen offers: a Google login's address belongs to Google, so
  // it can't be changed here; the way to another address is to sign out.
  // (__devProviders: DEV screen audits only, like __devStatus below.)
  const [method, setMethod] = useState(() => (
    import.meta.env.DEV && __devProviders ? (__devProviders.includes('google') ? 'google' : 'email') : null
  ));
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
  const [mode, setMode] = useState('save'); // 'save' | 'restore'
  // __devStatus/__devEmail: DEV-only, used solely by the screen-audit harness
  // (?__shot=…) to open the sheet directly in a given status for screenshots.
  const [status, setStatus] = useState(import.meta.env.DEV && __devStatus ? __devStatus : 'idle');
  const [email, setEmail] = useState(import.meta.env.DEV && __devEmail ? __devEmail : '');
  // One box on the form: the marketing opt-in. It has to be a deliberate
  // tick (GDPR), so it starts from the account's saved choice — unticked for
  // anyone who hasn't opted in. Starting unticked for someone who had would
  // silently withdraw their consent on submit. It applies to Google too: a
  // tick made before tapping Google travels in the round trip's intent.
  // The privacy policy is a line under the buttons, not a box to tick:
  // reading a notice is not a consent, and the box only added a step.
  const [marketingConsent, setMarketingConsent] = useState(!!savedMarketingConsent);
  const [showPolicy, setShowPolicy] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [newEmail, setNewEmail] = useState(''); // for the change-email flow
  // No-verification venues: the idle form doubles as "Change email".
  const [changing, setChanging] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  // Opened straight at the sign-out question (Data & privacy → Sign out):
  // "Stay signed in" then closes instead of showing the account.
  const signOutOnly = startAt === 'signout';
  const [mergeHeldMsg, setMergeHeldMsg] = useState(null); // weekly-limit "sent for review" copy
  const [error, setError] = useState(null);
  const [currentEmail, setCurrentEmail] = useState(import.meta.env.DEV && __devEmail ? __devEmail : null);
  const inputRef = useRef(null);
  const codeRef  = useRef(null);

  // When the sheet opens, find out whether the user is already signed
  // in so we render the right initial state.
  // Each opening starts the marketing box from the saved choice (adjusted
  // while rendering, the way React recommends for state that follows a prop).
  const [seededForOpen, setSeededForOpen] = useState(open);
  if (open !== seededForOpen) {
    setSeededForOpen(open);
    if (open) setMarketingConsent(!!savedMarketingConsent);
  }

  useEffect(() => {
    if (!open) return;
    // DEV screen-audit: honour the forced __devStatus, don't reset on open.
    if (import.meta.env.DEV && __devStatus) return;
    let cancelled = false;
    // A login is a login wherever the venue stands on codes, so the session
    // is read first: signed in (with a code or with Google) shows the
    // account. Without one, a venue that asks for no code keeps the email
    // on the user row, so show that (if any) without an OTP round-trip.
    getAuthInfo().then(({ email: e, method: m }) => {
      if (cancelled) return;
      setMethod(m);
      if (e) { setCurrentEmail(e); setStatus(signOutOnly ? 'confirm_signout' : 'signedIn'); return; }
      if (!requireVerification && savedEmail) { setCurrentEmail(savedEmail); setStatus('savedDirect'); return; }
      setCurrentEmail(null);
      setStatus('idle');
      // Google sent them back without a session: say why, on the form
      // they can try again from.
      if (oauthReturn?.error) setError(oauthReturn.error);
    });
    return () => { cancelled = true; };
  }, [open, requireVerification, savedEmail, oauthReturn, signOutOnly]);

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
    setChanging(false);
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
    if (currentEmail && email.trim().toLowerCase() === currentEmail.trim().toLowerCase()) {
      setError('That’s already your email.');
      setStatus('error');
      return;
    }

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
          setStatus('merge_offer');
        } else {
          // Server saved the email; sync local state.
          setCurrentEmail(email.trim());
          setChanging(false);
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
      setError('That’s already your email.');
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

  /* Sign out on this phone: end the login, forget the device, and boot
   * again as a new visitor. The cups stay with the account. */
  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    await signOutThisDevice();
    window.location.reload();
  }

  /* A Google login's address is Google's: the way to another one is to sign
   * out and pick a different account. switchGoogleAccount forgets the device
   * first, so the next account can't be matched to this one's row. */
  function handleSwitchGoogle() {
    if (signingOut) return;
    setSigningOut(true);
    switchGoogleAccount({ kind: 'rewards', pending: pendingAction })
      // Google unavailable: already signed out, so boot as a visitor.
      .catch(() => window.location.reload());
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
      setCurrentEmail(email.trim());
      setStatus('signedIn');
      onLinked?.();
      onVerified?.(); // straight back to the app, like every other sign-in
    } catch (err) {
      // C.7 fix 2: don't let a late failure erase a finished restore.
      if (statusRef.current !== 'signedIn') {
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

  function switchToSave() {
    setError(null);
    setOtpCode('');
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

  const mailIcon = (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  );
  const policyLine = (
    <p className="signin-fine">
      By continuing you confirm you’ve read our{' '}
      <span className="signin-nowrap"><button type="button" className="signin-link" onClick={() => setShowPolicy(true)}>Privacy Policy</button>.</span>
    </p>
  );

  return (
    <div className="signin-overlay" onClick={onClose}>
      <div className="signin-sheet" onClick={e => e.stopPropagation()}>
        <button className="signin-close" onClick={onClose} aria-label="Close">×</button>

        {/* Email is already on another account — verify it's theirs, then
            combine the cups. Google proves the address just as well. */}
        {status === 'merge_offer' && (
          <div className="signin-state">
            <h2 className="signin-title">This email already has cups</h2>
            <p className="signin-sub">
              Confirm <strong>{email}</strong> is yours and we’ll combine the cups into one account.
            </p>
            {error && <p className="signin-error">{error}</p>}
            <div className="signin-actions">
              <button
                type="button"
                className="signin-btn signin-btn--primary"
                onClick={handleSendMergeCode}
                disabled={status === 'restore_sending'}
              >
                Email me a code
              </button>
              <GoogleSignIn
                intent={{ kind: 'rewards', pending: pendingAction, marketing: marketingConsent }}
                showPolicyNote={false}
                divider={null}
                disabled={status === 'restore_sending'}
              />
              <button
                type="button"
                className="signin-btn signin-btn--secondary"
                onClick={() => { setEmail(''); setError(null); setStatus('idle'); }}
              >
                Use a different email
              </button>
            </div>
          </div>
        )}

        {/* Email saved without verification (the venue doesn't ask for a
            code), so there is no login to sign out of. */}
        {status === 'savedDirect' && (
          <div className="signin-state">
            <h2 className="signin-title">Your email</h2>
            <p className="signin-sub"><strong>{currentEmail}</strong></p>
            <div className="signin-actions">
              <button
                className="signin-btn signin-btn--secondary"
                onClick={() => { setEmail(''); setError(null); setChanging(true); setStatus('idle'); }}
              >
                Change email
              </button>
            </div>
          </div>
        )}

        {/* Signed in. The rules, in one place:
              signed in with Google → the address is Google's. No "Change
                email": the way to another address is "Use a different
                Google account" (sign out, pick another) or "Sign out".
              signed in with a code → "Change email" (confirmed by a link to
                the new address) and "Sign out". Google is never offered as
                a way to change an email: it signs in, it doesn't edit. */}
        {status === 'signedIn' && (() => {
          const viaGoogle = method === 'google';
          return (
            <div className="signin-state">
              <div className={`signin-art ${viaGoogle ? 'signin-art--google' : 'signin-art--ok'}`}>
                {viaGoogle ? <GoogleMark size={28} /> : (
                  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                )}
              </div>
              <h2 className="signin-title">{viaGoogle ? 'Signed in with Google' : 'Signed in'}</h2>
              <p className="signin-sub"><strong>{currentEmail}</strong></p>
              {error && <p className="signin-error">{error}</p>}
              <div className="signin-actions">
                {viaGoogle ? (
                  <button className="signin-btn signin-btn--secondary" onClick={handleSwitchGoogle} disabled={signingOut}>
                    Use a different Google account
                  </button>
                ) : (
                  <button
                    className="signin-btn signin-btn--secondary"
                    onClick={() => { setNewEmail(''); setError(null); setStatus('change_email'); }}
                  >
                    Change email
                  </button>
                )}
                <button className="signin-btn signin-btn--secondary" onClick={() => setStatus('confirm_signout')} disabled={signingOut}>
                  Sign out
                </button>
              </div>
            </div>
          );
        })()}

        {/* Sign out on this phone. The cups stay with the account. */}
        {status === 'confirm_signout' && (
          <div className="signin-state">
            <h2 className="signin-title">Sign out on this phone?</h2>
            <p className="signin-sub">
              Your cups stay saved to <strong>{currentEmail}</strong>. Sign in again to see them.
            </p>
            <div className="signin-actions">
              <button className="signin-btn signin-btn--primary" onClick={handleSignOut} disabled={signingOut}>
                {signingOut ? 'Signing out…' : 'Sign out'}
              </button>
              <button
                className="signin-btn signin-btn--secondary"
                onClick={signOutOnly ? onClose : () => setStatus('signedIn')}
                disabled={signingOut}
              >
                Stay signed in
              </button>
            </div>
          </div>
        )}

        {/* Change the email on THIS account (keeps your cups). Supabase sends a
            confirmation to the new address; the change lands once it's opened. */}
        {(status === 'change_email' || status === 'change_sending') && (
          <form className="signin-state" onSubmit={handleChangeEmail}>
            <h2 className="signin-title">Change your email</h2>
            <p className="signin-sub">We’ll send a link to the new address to confirm it.</p>
            <div className="signin-actions">
              <input
                id="change-email"
                ref={inputRef}
                type="email"
                autoComplete="email"
                inputMode="email"
                aria-label="New email"
                className="signin-input"
                placeholder="New email address"
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
                className="signin-btn signin-btn--secondary"
                onClick={() => { setError(null); setStatus('signedIn'); }}
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {status === 'change_sent' && (
          <div className="signin-state">
            <div className="signin-art signin-art--sent">{mailIcon}</div>
            <h2 className="signin-title">Check your inbox</h2>
            <p className="signin-sub">
              Open the link we sent to <strong>{newEmail}</strong> to finish the change.
            </p>
            <div className="signin-actions">
              <button className="signin-btn signin-btn--primary" onClick={onClose}>Done</button>
            </div>
          </div>
        )}

        {/* Enter the 6-digit code (or tap the link in the email). */}
        {(status === 'sent' || status === 'verifying') && (
          <form className="signin-state" onSubmit={handleVerifySaveCode}>
            <div className="signin-art signin-art--sent">{mailIcon}</div>
            <h2 className="signin-title">Enter the code</h2>
            <p className="signin-sub">Sent to <strong>{email}</strong></p>
            <div className="signin-actions">
              <input
                id="save-code"
                ref={codeRef}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                aria-label="6-digit code"
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
                {status === 'verifying' ? 'Checking…' : 'Continue'}
              </button>
              <button
                type="button"
                className="signin-btn signin-btn--secondary"
                onClick={() => { setStatus('idle'); setEmail(''); setOtpCode(''); setError(null); }}
              >
                Use a different email
              </button>
            </div>
          </form>
        )}

        {/* The form: Google, or an email. New and returning customers use the
            same one: an address that already has cups signs in to them (or,
            where no code is asked for, offers to combine them), so there is
            no separate "restore" path to choose.
            C.1 fix 2: draw it whenever status is idle/sending/error REGARDLESS
            of mode, so a stray (mode='restore', status='idle') can never leave
            the popup blank. Restore uses its own restore_* statuses. */}
        {(status === 'idle' || status === 'sending' || status === 'error') && (
          <form className="signin-state" onSubmit={handleSubmit}>
            <h2 className="signin-title">{changing ? 'Change your email' : 'Save your cups'}</h2>
            <div className="signin-actions">
              {/* Google signs in; it never changes an email. */}
              {!changing && (
                <GoogleSignIn
                  intent={{ kind: 'rewards', pending: pendingAction, marketing: marketingConsent }}
                  showPolicyNote={false}
                  divider="or"
                  disabled={status === 'sending'}
                />
              )}
              <input
                id="signin-email"
                ref={inputRef}
                type="email"
                autoComplete="email"
                inputMode="email"
                aria-label="Email"
                className="signin-input"
                placeholder={changing ? 'New email address' : 'Email address'}
                value={email}
                onChange={e => { setEmail(e.target.value); if (error) { setError(null); setStatus('idle'); } }}
                disabled={status === 'sending'}
                required
              />
              {error && <p className="signin-error">{error}</p>}
              <button
                type="submit"
                className="signin-btn signin-btn--primary"
                disabled={status === 'sending' || !email.trim()}
              >
                {status === 'sending' ? 'Sending…' : changing ? 'Save new email' : 'Continue with email'}
              </button>
              {changing && (
                <button
                  type="button"
                  className="signin-btn signin-btn--secondary"
                  onClick={() => { setChanging(false); setError(null); setStatus('savedDirect'); }}
                >
                  Cancel
                </button>
              )}
            </div>
            {!changing && (
              <label className="signin-consent">
                <input
                  type="checkbox"
                  className="signin-consent__box"
                  checked={marketingConsent}
                  onChange={e => setMarketingConsent(e.target.checked)}
                  disabled={status === 'sending'}
                />
                <span className="signin-consent__text">Send me offers and reward updates</span>
              </label>
            )}
            {!changing && policyLine}
          </form>
        )}

        {/* ── Restore: ask for the email again (from "Send a new code") ── */}
        {mode === 'restore' && (status === 'restore_email' || status === 'restore_sending') && (
          <form className="signin-state" onSubmit={handleRequestRestore}>
            <h2 className="signin-title">Get a new code</h2>
            <div className="signin-actions">
              <input
                id="restore-email"
                ref={inputRef}
                type="email"
                autoComplete="email"
                inputMode="email"
                aria-label="Email"
                className="signin-input"
                placeholder="Email address"
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
                {status === 'restore_sending' ? 'Sending…' : 'Email me a code'}
              </button>
              <button
                type="button"
                className="signin-btn signin-btn--secondary"
                onClick={switchToSave}
              >
                Back
              </button>
            </div>
          </form>
        )}

        {/* ── Restore: verify the code, then the account comes to this phone ── */}
        {mode === 'restore' && (status === 'restore_code' || status === 'restore_verifying') && (
          <form className="signin-state" onSubmit={handleVerifyRestore}>
            <div className="signin-art signin-art--sent">{mailIcon}</div>
            <h2 className="signin-title">Enter the code</h2>
            <p className="signin-sub">Sent to <strong>{email}</strong></p>
            <div className="signin-actions">
              <input
                id="restore-code"
                ref={codeRef}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                aria-label="6-digit code"
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
                {status === 'restore_verifying' ? 'Checking…' : 'Continue'}
              </button>
              <button
                type="button"
                className="signin-btn signin-btn--secondary"
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
            </div>
          </form>
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
            <div className="signin-actions">
              <button className="signin-btn signin-btn--primary" onClick={onClose}>
                Got it
              </button>
            </div>
          </div>
        )}

        {showPolicy && <PrivacyPolicyView text={privacyPolicy} onClose={() => setShowPolicy(false)} />}
      </div>
    </div>
  );
}
