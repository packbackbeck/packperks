import { useState } from 'react';
import './ClaimPanel.css';

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
  function getSavedIban() {
    try {
      const p = JSON.parse(localStorage.getItem('packperks_user_profile') || '{}');
      return p.iban || '';
    } catch { return ''; }
  }

  const [iban, setIban] = useState(() => getSavedIban());
  const [error, setError] = useState('');

  const handleClaim = () => {
    onClaimAttempt?.();
    const trimmed = iban.trim().toUpperCase();
    if (!trimmed) {
      setError('Please enter your IBAN to continue.');
      return;
    }
    if (trimmed.length < 15) {
      setError('That IBAN looks too short. Double-check it?');
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

      <label className="claim-panel__label" htmlFor="iban-input">Type your IBAN here:</label>
      <input
        id="iban-input"
        className={`claim-panel__input ${error ? 'claim-panel__input--error' : ''}`}
        type="text"
        inputMode="text"
        autoComplete="off"
        spellCheck="false"
        placeholder="NL 00 BANK 102030 12345678"
        value={iban}
        onChange={(e) => { setIban(e.target.value); if (error) setError(''); }}
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
