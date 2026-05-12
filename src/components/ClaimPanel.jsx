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
  onClaim,
  onClaimAttempt,
  onResetClaim,
  onOpenTerms,
  onOpenRefund,
}) {
  const [iban, setIban] = useState(() => getSavedIban());
  const [error, setError] = useState('');

  const savedIban = getSavedIban();
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
            Cashback will arrive in your account within 3 business days.
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
  return (
    <section className="claim-panel" aria-label="Claim reward">
      <h3 className="claim-panel__title">Unlock your reward</h3>
      <p className="claim-panel__desc">
        You will receive your cashback after you return enough cups, scan your purchase receipt, and enter your IBAN.
      </p>

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

      <div className="claim-panel__links">
        <button className="claim-panel__link" type="button" onClick={onOpenTerms}>Read the voucher terms</button>
        <button className="claim-panel__link" type="button" onClick={onOpenRefund}>Get the direct refund</button>
      </div>
    </section>
  );
}
