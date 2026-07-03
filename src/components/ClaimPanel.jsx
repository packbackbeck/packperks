import { useState } from 'react';
import './ClaimPanel.css';
import { validateIban, getSavedIban } from '../utils/iban';

export default function ClaimPanel({
  isUnlocked,
  cupsRemaining,
  cupsCollected,
  cupsNeeded,
  rewardName,
  claimed,
  savedIban: savedIbanProp,
  onClaim,
  onClaimAttempt,
  onResetClaim,
  onOpenTerms,
  onOpenRefund,
}) {
  // Source-of-truth for "is there a saved IBAN" is the profile passed from
  // App.jsx (Supabase-backed). Fall back to the legacy localStorage key for
  // older sessions that never wrote to Supabase.
  const savedIban = (savedIbanProp || getSavedIban() || '').replace(/\s/g, '').toUpperCase();
  const [iban, setIban] = useState(savedIban);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(!savedIban);

  const isPreFilled = !!savedIban && iban === savedIban;

  const handleClaim = () => {
    onClaimAttempt?.();
    const trimmed = iban.trim().toUpperCase();
    if (!trimmed) {
      setError('Please enter your IBAN to continue.');
      return;
    }
    if (!validateIban(trimmed)) {
      setError('This IBAN is invalid. Please double-check the number.');
      return;
    }
    setError('');
    onClaim(trimmed);
  };

  const progress = cupsNeeded > 0 ? Math.min(1, cupsCollected / cupsNeeded) : 0;

  // ── Success state ──
  if (claimed) {
    return (
      <section className="claim-panel" aria-label="Claim result">
        <div className="claim-panel__success">
          <span className="claim-panel__success-icon" aria-hidden="true">🎉</span>
          <h3 className="claim-panel__success-title">Reward claimed!</h3>
          <p className="claim-panel__success-desc">
            Your <strong>{rewardName}</strong> voucher is on its way.
            Cashback will arrive in your account within 1 to 2 business days.
          </p>
          <button className="claim-panel__reset-btn" onClick={onResetClaim}>
            Claim another reward
          </button>
        </div>
      </section>
    );
  }

  // ── Locked state ──
  if (!isUnlocked) {
    return (
      <section className="claim-panel" aria-label="Reward progress">
        <h3 className="claim-panel__title">Almost there!</h3>
        <p className="claim-panel__desc">
          Return <strong>{cupsRemaining} more cup{cupsRemaining !== 1 ? 's' : ''}</strong> to unlock
          your <strong>{rewardName}</strong>. Keep going!
        </p>

        <div className="claim-panel__progress-hint">
          <div
            className="claim-panel__progress-bar"
            role="progressbar"
            aria-valuenow={cupsCollected}
            aria-valuemin={0}
            aria-valuemax={cupsNeeded}
            aria-label={`${cupsCollected} of ${cupsNeeded} cups collected`}
          >
            <div
              className="claim-panel__progress-fill"
              style={{ width: `${Math.max(4, progress * 100)}%` }}
            />
          </div>
        </div>

        <button
          className="claim-panel__btn claim-panel__btn--disabled"
          type="button"
          disabled
          aria-disabled="true"
        >
          <span className="claim-panel__btn-icon" aria-hidden="true">🔒</span>
          Return {cupsRemaining} more cup{cupsRemaining !== 1 ? 's' : ''} to claim
        </button>

        <div className="claim-panel__links">
          <button className="claim-panel__link" type="button" onClick={onOpenTerms}>Read the voucher terms</button>
          <button className="claim-panel__link" type="button" onClick={onOpenRefund}>Get the direct refund</button>
        </div>
      </section>
    );
  }

  // ── Unlocked state ──
  // If the user already has a saved IBAN AND they haven't asked to edit it,
  // we show a compact "Using saved IBAN ending in XXXX" summary and a single
  // "Continue" button that proceeds straight to the receipt photo step. No
  // typing required, but they can still tap "Use a different IBAN" to switch.
  const showSavedSummary = savedIban && !editing;
  const last4 = savedIban.slice(-4);

  return (
    <section className="claim-panel" aria-label="Claim reward">
      <h3 className="claim-panel__title">Unlock your reward</h3>
      <p className="claim-panel__desc">
        {showSavedSummary
          ? 'Confirm your saved bank account, then snap a quick photo of your purchase receipt.'
          : 'You will receive your cashback after you return enough cups, scan your purchase receipt, and enter your IBAN.'}
      </p>

      {/* Payout + retention transparency at the point of IBAN collection
          (GDPR item 43): why we need it, when we pay, how long we keep it. */}
      <p className="claim-panel__payout-note">
        Your IBAN is used only to send this cashback. Payouts arrive within
        <strong> 1 to 2 business days</strong>. We keep your IBAN only until the
        payout is confirmed, then delete it — keeping just the last 4 digits on
        your payment record.
      </p>

      {showSavedSummary ? (
        <>
          <div className="claim-panel__saved-row">
            <div className="claim-panel__saved-iban">
              <span className="claim-panel__saved-eyebrow">Saved bank account</span>
              <span className="claim-panel__saved-value">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="5" width="20" height="14" rx="2"/>
                  <line x1="2" y1="10" x2="22" y2="10"/>
                </svg>
                ··· {last4}
              </span>
            </div>
            <button
              className="claim-panel__saved-edit"
              type="button"
              onClick={() => setEditing(true)}
            >
              Use a different IBAN
            </button>
          </div>

          <button className="claim-panel__btn" type="button" onClick={handleClaim}>
            <span className="claim-panel__btn-icon" aria-hidden="true">💰</span>
            Continue to receipt
          </button>
        </>
      ) : (
        <>
          <div className="claim-panel__iban-label-row">
            <label className="claim-panel__label" htmlFor="iban-input">Your IBAN</label>
            {isPreFilled && (
              <span className="claim-panel__iban-saved">
                <svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 10L8 14L16 6"/>
                </svg>
                Saved
              </span>
            )}
          </div>
          <input
            id="iban-input"
            className={`claim-panel__input ${error ? 'claim-panel__input--error' : isPreFilled ? 'claim-panel__input--saved' : ''}`}
            type="text"
            inputMode="text"
            autoComplete="off"
            spellCheck="false"
            placeholder="NL 00 BANK 1020 3012 3456 78"
            value={iban}
            onChange={(e) => { setIban(e.target.value.toUpperCase()); if (error) setError(''); }}
            aria-describedby={error ? 'iban-error' : undefined}
            aria-invalid={!!error}
          />
          {error && <p className="claim-panel__error" id="iban-error" role="alert">{error}</p>}

          <button className="claim-panel__btn" type="button" onClick={handleClaim}>
            <span className="claim-panel__btn-icon" aria-hidden="true">💰</span>
            Claim cashback
          </button>
        </>
      )}

      <div className="claim-panel__links">
        <button className="claim-panel__link" type="button" onClick={onOpenTerms}>Read the voucher terms</button>
        <button className="claim-panel__link" type="button" onClick={onOpenRefund}>Get the direct refund</button>
      </div>
    </section>
  );
}
