import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import packbackLogo from '../assets/images/packback-logo.svg';
import tikkieLogo from '../assets/images/tikkie-logo.svg';
import './TikkieOnlyPage.css';

/* Redirect Refund: the customer experience for a smart-bin receipt.
 *
 * The bin prints its QR immediately from its own session UUID (print-first),
 * so a scan lands in one of three worlds:
 *
 *   ready    — we know the batch: show the amount, explain how Tikkie
 *              works (IBAN + last name, no cards), and offer TWO actions:
 *              open Tikkie now, or leave an email to save it for later
 *              (which creates a PackPerks account for managing refunds).
 *              No auto-redirect: the choice is the point.
 *   pending  — the bin's confirmation hasn't reached us yet (it printed
 *              offline). Ask for ~30 minutes of patience, and offer the
 *              same email capture so we can send the link once it's ready.
 *   reopened — the receipt was opened before; warn instead of redirect.
 *
 * The offline BACKUP-cup path (?cups=) rides the same states and never
 * announces itself — the customer can't tell a fallback from the real
 * thing, by design. */

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

const MAX_POLLS = 8;

/* Same device id the rest of PackPerks uses — one account per device. */
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

/* ── How Tikkie works — the explainer that is the point of this page ── */
function TikkieSteps() {
  return (
    <div className="tikkie-only__steps">
      <div className="tikkie-only__step">
        <span className="tikkie-only__step-num">1</span>
        <img className="tikkie-only__step-logo" src={tikkieLogo} alt="Tikkie" />
        <p>Your refund is paid through <strong>Tikkie</strong></p>
      </div>
      <div className="tikkie-only__step">
        <span className="tikkie-only__step-num">2</span>
        <div className="tikkie-only__iban" aria-hidden="true">NL00 ABCD 1020 3040</div>
        <p>Enter your <strong>IBAN</strong> and last name</p>
        <p className="tikkie-only__step-warn">Visa and Mastercard are not supported</p>
      </div>
      <div className="tikkie-only__step">
        <span className="tikkie-only__step-num">3</span>
        <svg className="tikkie-only__step-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <polyline points="12 7 12 12 15.5 14" />
        </svg>
        <p>Money arrives <strong>within minutes</strong></p>
      </div>
    </div>
  );
}

/* ── Email capture — shared by "save for later" and the pending screen ── */
function EmailSaveForm({ batchId, cupIds, org, settings, variant, onSaved }) {
  const [email, setEmail] = useState('');
  const [privacyOk, setPrivacyOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const privacyUrl = settings?.privacyUrl || 'https://packperks.nl/privacy';

  async function submit(e) {
    e.preventDefault();
    if (busy || !privacyOk) return;
    setBusy(true);
    setErr(null);
    let data = null;
    try {
      const res = await supabase.functions.invoke('bin-tikkie', {
        body: {
          action: 'save_email',
          batch_id: batchId || (cupIds && cupIds[0]) || '',
          email: email.trim(),
          device_id: deviceId(),
          privacy_accepted: true,
          marketing_consent: false,
        },
      });
      data = res.data;
      if (!data && res.error?.context?.json) {
        data = await res.error.context.json().catch(() => null);
      }
    } catch { data = null; }
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

  return (
    <form className="tikkie-only__form" onSubmit={submit}>
      <p className="tikkie-only__form-copy">
        {variant === 'pending'
          ? 'Leave your email and we’ll send you the link the moment it’s ready. We’ll also create a PackPerks account for you to manage your refunds.'
          : 'We’ll create a PackPerks account for you — collect this refund whenever suits you, and see all your refunds in one place.'}
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
          checked={privacyOk}
          onChange={e => setPrivacyOk(e.target.checked)}
          disabled={busy}
        />
        <span>
          I have read the{' '}
          <a href={privacyUrl} target="_blank" rel="noopener noreferrer">Privacy Policy</a>.
        </span>
      </label>
      {err && <p className="tikkie-only__form-err">{err}</p>}
      <button
        type="submit"
        className="tikkie-only__btn tikkie-only__btn--secondary"
        disabled={busy || !email.trim() || !privacyOk}
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
  const [payout, setPayout] = useState(null);   // { cups, amount, url, tikkieStatus }
  const [savedEmail, setSavedEmail] = useState(null);
  const pollsRef = useRef(0);
  const startedRef = useRef(false);

  useEffect(() => {
    // StrictMode double-mount guard. NOTE: no companion "cancelled" cleanup —
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
      let data = null;
      try {
        const res = await supabase.functions.invoke('bin-tikkie', {
          body: hasBackup
            ? { cup_ids: cupIds, device_id: deviceId() }
            : { batch_id: batchId, device_id: deviceId() },
        });
        data = res.data;
        if (!data && res.error?.context?.json) {
          data = await res.error.context.json().catch(() => null);
        }
      } catch {
        data = null;
      }

      if (data?.url) {
        setPayout({
          cups: data.cups,
          amount: data.amount,
          url: data.url,
          tikkieStatus: data.tikkie_status || null,
        });
        // Opened before → warn. First time → show the choice, never
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

  const brandColor = org?.brand_color || '#1A8737';
  const goHome = () => { window.location.href = `/${org?.slug || ''}/`; };

  return (
    <div className="tikkie-only">
      <div className="tikkie-only__card">
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

            <TikkieSteps />

            {payout?.url && (
              <a className="tikkie-only__btn" href={payout.url}>Open Tikkie</a>
            )}

            <div className="tikkie-only__or" aria-hidden="true"><span>or</span></div>

            <EmailSaveForm
              batchId={batchId}
              cupIds={cupIds}
              org={org}
              settings={settings}
              variant="later"
              onSaved={(email) => { setSavedEmail(email); setPhase('saved'); }}
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
              Please give it up to <strong>30 minutes</strong> — your cup return is still being
              confirmed. You can scan the receipt again later, or leave your email below and
              we’ll do the waiting for you.
            </p>
            <EmailSaveForm
              batchId={batchId}
              cupIds={cupIds}
              org={org}
              settings={settings}
              variant="pending"
              onSaved={(email) => { setSavedEmail(email); setPhase('saved'); }}
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
              We’ve saved this refund to <strong>{savedEmail}</strong> and created your PackPerks
              account. You can collect it any time from your refunds page
              {payout?.url ? ' — or open Tikkie right now.' : '.'}
            </p>
            {payout?.url && (
              <a className="tikkie-only__btn" href={payout.url}>Open Tikkie</a>
            )}
            <button type="button" className="tikkie-only__btn tikkie-only__btn--secondary" onClick={goHome}>
              Go to my refunds
            </button>
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
    </div>
  );
}
