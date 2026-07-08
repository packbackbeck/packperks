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
  const handleClaim = () => {
    onClaimAttempt?.();
    onClaim();
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
            Your <strong>{rewardName}</strong> cashback is on its way.
            We'll send you a Tikkie link to collect it once your receipt is approved.
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
          <button className="claim-panel__link" type="button" onClick={onOpenTerms}>Read the cashback terms</button>
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
        Snap a quick photo of your purchase receipt to claim. Once it's approved,
        we'll send you a Tikkie link to collect your cashback.
      </p>

      {/* Payout transparency at claim time: how you get paid and when. */}
      <p className="claim-panel__payout-note">
        We'll review your receipt and send you a <strong>Tikkie link</strong> to
        collect your cashback — usually within a few days.
      </p>

      <button className="claim-panel__btn" type="button" onClick={handleClaim}>
        <span className="claim-panel__btn-icon" aria-hidden="true">💰</span>
        Claim cashback
      </button>

      <div className="claim-panel__links">
        <button className="claim-panel__link" type="button" onClick={onOpenTerms}>Read the cashback terms</button>
        <button className="claim-panel__link" type="button" onClick={onOpenRefund}>Get the direct refund</button>
      </div>
    </section>
  );
}
