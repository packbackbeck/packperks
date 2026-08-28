import { useEffect, useRef, useState } from 'react';
import PrivacyPolicyView from './PrivacyPolicyView';
import packbackLogo from '../assets/images/packback-logo.svg';
import tikkieLogo from '../assets/images/tikkie-logo.svg';
import './TikkieOnlyPage.css';

/* Redirect Refund: the customer experience for a smart-bin receipt.
 *
 * The bin prints its QR immediately from its own session UUID (print-first),
 * so a scan lands in one of three worlds:
 *
 *   ready    - we know the batch: show the amount, explain how Tikkie works
 *              in one block (text left, phone mockup right), and offer TWO
 *              actions: open Tikkie now, or leave an email to save it for
 *              later (which creates a PackPerks account and goes straight
 *              to the refunds home). No auto-redirect.
 *   pending  - the bin's confirmation hasn't reached us yet (it printed
 *              offline). Short wait copy, an email field, and an OPTIONAL
 *              account toggle. Email without the toggle = a "mailo": we
 *              only mail them the link when it's ready. While the customer
 *              is on this screen we poll; the moment the bin's session
 *              lands the page switches to ready by itself.
 *   reopened - the receipt was opened before; warn instead of redirect.
 *
 * The offline BACKUP-cup path (?cups=) rides the same states and never
 * announces itself; the customer can't tell a fallback from the real thing.
 */

const FRIENDLY = {
  already_claimed: 'This receipt has already been used for a cashback.',
  batch_revoked:   'This receipt is no longer valid.',
  batch_expired:   'This receipt has expired.',
  batch_not_found: 'We couldn’t recognise this QR code. Please use the receipt printed by the bin.',
  invalid_batch:   'We couldn’t recognise this QR code. Please use the receipt printed by the bin.',
  wrong_mode:      'This QR code belongs to a different PackPerks programme.',
  // Backup-cup guards. Deliberately vague: the customer has no idea their
  // receipt came from the bin's offline fallback, and telling them would
  // only invite retries.
  backup_cooldown:  'This receipt was just used. Please wait a moment and scan again.',
  backup_daily_cap: 'We can’t process this receipt right now. Please ask a member of staff.',
};

const MAX_POLLS = 8;              // "minting in progress" retries (1.4s apart)
const PENDING_POLL_MS = 25000;    // pending screen checks for validation
const PENDING_POLL_MAX_MS = 30 * 60 * 1000;

/* Same device id the rest of PackPerks uses - one account per device. */
function deviceId() {
  try {
    let id = localStorage.getItem('packperks_device_id');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('packperks_device_id', id);
    }
    return id;
  } catch {
    return 'no-storage';
  }
}

const ACCOUNT_KEY = (orgId) => `packperks_refund_user:${orgId}`;

export function readRefundAccount(orgId) {
  try { return JSON.parse(localStorage.getItem(ACCOUNT_KEY(orgId)) || 'null'); } catch { return null; }
}
function storeRefundAccount(orgId, account) {
  try { localStorage.setItem(ACCOUNT_KEY(orgId), JSON.stringify(account)); } catch { /* fine */ }
}

/* One place for every edge-function call. Plain fetch on purpose:
 * supabase.functions.invoke serialises behind the client's auth lock, and
 * a single wedged request then hangs EVERY later call on the page — a
 * user hit exactly that as an endless "Saving…". This endpoint only needs
 * the anon key, so we skip the shared client entirely and enforce a real
 * abort timeout. Resolves to the parsed body, or null. */
const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bin-tikkie`;
const FN_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;
async function invokeBinTikkie(body, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(FN_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${FN_ANON}`,
        apikey: FN_ANON,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    return await resp.json().catch(() => null);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* ── The explainer: one block, text left, phone mockup right ── */
function TikkiePhone({ amount }) {
  return (
    <div className="tikkie-only__phone" aria-hidden="true">
      <div className="tikkie-only__phone-notch" />
      <div className="tikkie-only__phone-screen">
        <img className="tikkie-only__phone-logo" src={tikkieLogo} alt="" />
        <div className="tikkie-only__phone-amount">
          €{Number(amount ?? 0).toFixed(2)} for you!
        </div>
        <div className="tikkie-only__phone-field tikkie-only__phone-field--mono">NL00 ABCD 1020 3040</div>
        <div className="tikkie-only__phone-field">Last name</div>
        <div className="tikkie-only__phone-btn">Get paid</div>
      </div>
    </div>
  );
}

function TikkieExplainer({ amount }) {
  return (
    <div className="tikkie-only__explain">
      <div className="tikkie-only__explain-text">
        <h2>How you get your money</h2>
        <ul>
          <li>Your refund is paid through <strong>Tikkie</strong>.</li>
          <li>Enter your <strong>IBAN</strong> and last name.</li>
          <li>Visa and Mastercard are <strong>not</strong> supported.</li>
          <li>The money arrives within minutes.</li>
        </ul>
      </div>
      <TikkiePhone amount={amount} />
    </div>
  );
}

/* ── Email capture ──
 * variant "later"   (ready screen): privacy checkbox required, always
 *                   creates an account, then goes straight to the home.
 * variant "pending" (waiting screen): optional account toggle. Without it
 *                   we only store the email (a "mailo") and notify. */
function EmailSaveForm({ batchId, org, settings, variant, onSaved, onShowPolicy }) {
  const [email, setEmail] = useState('');
  const [consentOk, setConsentOk] = useState(false); // privacy (later) / account toggle (pending)
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const wantsAccount = variant === 'pending' ? consentOk : true;

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    if (variant !== 'pending' && !consentOk) return;
    setBusy(true);
    setErr(null);
    const data = await invokeBinTikkie({
      action: 'save_email',
      batch_id: batchId,
      email: email.trim(),
      device_id: deviceId(),
      org_id: org?.id || null,
      create_account: wantsAccount,
      privacy_accepted: wantsAccount,
      marketing_consent: false,
    });
    setBusy(false);
    if (data?.status === 'saved' || data?.status === 'saved_pending') {
      if (data.user_id && org?.id) {
        storeRefundAccount(org.id, { userId: data.user_id, email: email.trim() });
      }
      onSaved?.(email.trim(), data.user_id || null);
    } else {
      setErr(data?.error === 'invalid_email'
        ? 'That doesn’t look like an email address.'
        : 'We couldn’t save your email just now. Please try again.');
    }
  }

  const policyLink = (
    <button type="button" className="tikkie-only__policy-link" onClick={onShowPolicy}>
      Privacy Policy
    </button>
  );

  return (
    <form className="tikkie-only__form" onSubmit={submit}>
      <p className="tikkie-only__form-copy">
        {variant === 'pending'
          ? 'Leave your email and we’ll send you the link when it’s ready.'
          : 'Or save this refund for later. We’ll create a PackPerks account where you can collect it any time and see all your refunds.'}
      </p>
      <input
        type="email"
        inputMode="email"
        className="tikkie-only__input"
        placeholder="you@example.com"
        value={email}
        onChange={e => setEmail(e.target.value)}
        disabled={busy}
        required
      />
      <label className="tikkie-only__consent">
        <input
          type="checkbox"
          checked={consentOk}
          onChange={e => setConsentOk(e.target.checked)}
          disabled={busy}
        />
        <span>
          {variant === 'pending'
            ? <>Also create a PackPerks account for me. I accept the {policyLink}. <em>(optional)</em></>
            : <>I have read the {policyLink}.</>}
        </span>
      </label>
      {err && <p className="tikkie-only__form-err">{err}</p>}
      <button
        type="submit"
        className="tikkie-only__btn tikkie-only__btn--secondary"
        disabled={busy || !email.trim() || (variant !== 'pending' && !consentOk)}
      >
        {busy
          ? 'Saving…'
          : variant === 'pending' ? 'Email me when it’s ready' : 'Save for later'}
      </button>
    </form>
  );
}

export default function TikkieOnlyPage({ org, batchId, cupIds = [], settings = {} }) {
  // working | ready | pending | reopened | saved | error
  const [phase, setPhase] = useState('working');
  const [error, setError] = useState(null);
  const [payout, setPayout] = useState(null);   // { cups, amount, url, tikkieStatus, batchId }
  const [savedEmail, setSavedEmail] = useState(null);
  const [showPolicy, setShowPolicy] = useState(false);
  const pollsRef = useRef(0);
  const startedRef = useRef(false);

  const applyPayout = (data) => {
    setPayout({
      cups: data.cups,
      amount: data.amount,
      url: data.url,
      tikkieStatus: data.tikkie_status || null,
      batchId: data.batch_id || batchId || null,
    });
  };

  useEffect(() => {
    // StrictMode double-mount guard. NOTE: no companion "cancelled" cleanup -
    // the ref survives StrictMode's unmount/remount cycle, so a cleanup flag
    // would strand the ONE running redeem() with nowhere to deliver its
    // result. Post-unmount setState is a no-op in React 18.
    if (startedRef.current) return;
    startedRef.current = true;

    const hasBackup = cupIds.length > 0;
    if (!batchId && !hasBackup) {
      setError(FRIENDLY.batch_not_found);
      setPhase('error');
      return;
    }

    async function redeem() {
      const data = await invokeBinTikkie(
        hasBackup
          ? { cup_ids: cupIds, device_id: deviceId() }
          : { batch_id: batchId, device_id: deviceId() },
      );

      if (data?.url) {
        applyPayout(data);
        // Opened before -> warn. First time -> show the choice, never
        // auto-redirect: the explainer and the save-for-later option are
        // the whole reason this page exists.
        setPhase(data.status === 'exists' ? 'reopened' : 'ready');
        return;
      }
      if (data?.status === 'pending_validation') {
        // Print-first: the bin's confirmation hasn't reached us yet.
        setPhase('pending');
        return;
      }
      if (data?.status === 'in_progress') {
        if (pollsRef.current++ < MAX_POLLS) {
          setTimeout(redeem, 1400);
          return;
        }
      }
      setError(FRIENDLY[data?.error] || 'We couldn’t create your cashback link right now. Please scan the QR code again in a moment.');
      setPhase('error');
    }

    redeem();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchId, cupIds.join(',')]);

  /* While the customer waits (pending, or the mailo "all set" screen),
   * quietly ask the server whether the bin's confirmation has landed.
   * The `check` action is read-only with its own generous rate bucket;
   * the ONE real scan call happens only when check says it's time. The
   * page then switches to ready on its own. */
  useEffect(() => {
    if ((phase !== 'pending' && phase !== 'saved') || !batchId) return undefined;
    let stop = false;
    let timer = null;
    const startedAt = Date.now();
    async function tick() {
      if (stop || Date.now() - startedAt > PENDING_POLL_MAX_MS) return;
      const data = await invokeBinTikkie({ action: 'check', batch_id: batchId });
      if (stop) return;
      if (data?.url) {
        applyPayout(data);
        setPhase('ready');
        return;
      }
      if (data?.status === 'validated') {
        const minted = await invokeBinTikkie({ batch_id: batchId, device_id: deviceId() });
        if (stop) return;
        if (minted?.url) {
          applyPayout(minted);
          setPhase('ready');
          return;
        }
      }
      timer = setTimeout(tick, PENDING_POLL_MS);
    }
    timer = setTimeout(tick, PENDING_POLL_MS);
    return () => { stop = true; if (timer) clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, batchId]);

  const brandColor = org?.brand_color || '#1A8737';
  const goHome = () => { window.location.href = `/${org?.slug || ''}/`; };

  /* Account created -> straight to the refunds home. Email only -> the
   * "all set" confirmation (and the poll keeps watching). */
  const handleSaved = (email, userId) => {
    if (userId) { goHome(); return; }
    setSavedEmail(email);
    setPhase('saved');
  };

  const saveBatchId = payout?.batchId || batchId || (cupIds && cupIds[0]) || '';

  return (
    <div className="tikkie-only">
      <div className="tikkie-only__inner">
        <div className="tikkie-only__logos">
          <img className="tikkie-only__logo" src={org?.logo_url || packbackLogo} alt={org?.name || 'PackBack'} />
          <svg className="tikkie-only__link-arrows" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="13 6 19 12 13 18" />
          </svg>
          <img className="tikkie-only__tikkie-logo" src={tikkieLogo} alt="Tikkie" />
        </div>

        {phase === 'working' && (
          <>
            <div className="tikkie-only__spinner" style={{ borderTopColor: brandColor }} aria-hidden="true" />
            <h1 className="tikkie-only__title">One sec…</h1>
            <p className="tikkie-only__sub">We’re checking your receipt.</p>
          </>
        )}

        {phase === 'ready' && (
          <>
            <div className="tikkie-only__payout">
              <div className="tikkie-only__amount">
                €{Number(payout?.amount ?? 0).toFixed(2)}
              </div>
              {payout?.cups != null && (
                <div className="tikkie-only__cups">
                  for {payout.cups} cup{payout.cups === 1 ? '' : 's'} returned
                </div>
              )}
            </div>

            <TikkieExplainer amount={payout?.amount} />

            {payout?.url && (
              <a className="tikkie-only__btn" href={payout.url}>Open Tikkie</a>
            )}

            <div className="tikkie-only__or" aria-hidden="true"><span>or</span></div>

            <EmailSaveForm
              batchId={saveBatchId}
              org={org}
              settings={settings}
              variant="later"
              onSaved={handleSaved}
              onShowPolicy={() => setShowPolicy(true)}
            />
          </>
        )}

        {phase === 'pending' && (
          <>
            <div className="tikkie-only__pending-icon" aria-hidden="true">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <polyline points="12 7 12 12 15.5 14" />
              </svg>
            </div>
            <h1 className="tikkie-only__title">We’re checking your receipt</h1>
            <p className="tikkie-only__sub">
              This can take up to <strong>30 minutes</strong>. You don’t have to wait here.
            </p>
            <EmailSaveForm
              batchId={saveBatchId}
              org={org}
              settings={settings}
              variant="pending"
              onSaved={handleSaved}
              onShowPolicy={() => setShowPolicy(true)}
            />
          </>
        )}

        {phase === 'saved' && (
          <>
            <div className="tikkie-only__check" aria-hidden="true">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h1 className="tikkie-only__title">You’re all set</h1>
            <p className="tikkie-only__sub">
              We’ll email <strong>{savedEmail}</strong> as soon as your refund is ready.
              You can close this page.
            </p>
          </>
        )}

        {phase === 'reopened' && (
          <>
            <div className="tikkie-only__warn-icon" aria-hidden="true">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>
            <h1 className="tikkie-only__title">
              {payout?.tikkieStatus === 'redeemed'
                ? 'Already collected'
                : 'You’ve opened this receipt before'}
            </h1>
            <p className="tikkie-only__sub">
              {payout?.tikkieStatus === 'redeemed' ? (
                <>This cashback has already been collected, so the link below won’t pay out again.</>
              ) : payout?.tikkieStatus === 'expired' ? (
                <>This cashback link has expired, so it can no longer be collected.</>
              ) : (
                <>This receipt was scanned before, so its Tikkie link has most likely been used already.</>
              )}
            </p>
            <div className="tikkie-only__note">
              <strong>Already entered your bank details? The money is on its way.</strong> Don’t enter
              them again: a cashback link only pays out once.
            </div>
            {payout?.amount != null && (
              <p className="tikkie-only__sub tikkie-only__sub--small">
                This receipt was worth €{Number(payout.amount).toFixed(2)}
                {payout?.cups != null && <> for {payout.cups} cup{payout.cups === 1 ? '' : 's'}</>}.
              </p>
            )}
            {payout?.url && (
              <a className="tikkie-only__btn tikkie-only__btn--muted" href={payout.url}>
                Open the link anyway
              </a>
            )}
          </>
        )}

        {phase === 'error' && (
          <>
            <div className="tikkie-only__err-icon" aria-hidden="true">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <h1 className="tikkie-only__title">Sorry!</h1>
            <p className="tikkie-only__sub">{error}</p>
          </>
        )}

        <p className="tikkie-only__foot">Powered by PackPerks</p>
      </div>

      {showPolicy && (
        <PrivacyPolicyView
          text={settings?.privacyPolicyText}
          onClose={() => setShowPolicy(false)}
        />
      )}
    </div>
  );
}
