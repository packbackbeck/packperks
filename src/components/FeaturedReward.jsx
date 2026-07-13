import { useState } from 'react';
import './FeaturedReward.css';
import zigzagImg from '../assets/images/zigzag.svg';
import cashbackIcon from '../assets/images/cashback-icon.png';
import { rewardImageStyle } from '../utils/imageTransform';

export default function FeaturedReward({
  reward,
  isUnlocked,
  cupsRemaining,
  cupsCollected,
  claimed,
  onClaim,
  onClaimAttempt,
  budgetBlocked = false,
  onBudgetBlocked,
  onResetClaim,
  onOpenTerms,
  onOpenRefund,
  onViewDetail,
  onNudge,
  onAddCup,
  onExplain,
}) {
  const [nudgeVisible, setNudgeVisible] = useState(false);
  const isComplete = cupsCollected >= reward.cupsNeeded;
  const cashbackAmount = reward.euros?.toFixed(2) ?? (reward.cupsNeeded * 1.25).toFixed(2);

  const handleClaim = () => {
    if (!isUnlocked) {
      // Not enough cups yet: open the "how it works" stories so the user
      // learns how to collect them. Still nudge the progress bar underneath.
      onExplain?.();
      setNudgeVisible(true);
      onNudge?.(cupsRemaining);
      return;
    }
    onClaimAttempt?.();
    // Rewards paused for this org (budget cap reached) — explain via popup,
    // never reveal the amount.
    if (budgetBlocked) { onBudgetBlocked?.(); return; }
    setNudgeVisible(false);
    onClaim();
  };

  return (
    <section className="featured-reward" aria-labelledby="featured-reward-title">
      {/* ── Top: Gradient card with reward info ── */}
      <div
        className={`featured-reward__top${isComplete ? ' featured-reward__top--complete' : ''}`}
        onClick={onViewDetail}
        style={{ cursor: 'pointer' }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && onViewDetail?.()}
        aria-label={`View details for ${reward.name}`}
      >
        {/* Progress gradient */}
        <div
          className={`featured-reward__gradient${isComplete ? ' featured-reward__gradient--complete' : ''}`}
          style={{ width: `${Math.min(100, (cupsCollected / reward.cupsNeeded) * 100)}%` }}
          role="progressbar"
          aria-valuenow={cupsCollected}
          aria-valuemin={0}
          aria-valuemax={reward.cupsNeeded}
          aria-label={`${cupsCollected} of ${reward.cupsNeeded} cups collected`}
        />
        <div className="featured-reward__content">
          <div className="featured-reward__image-wrap" style={{ background: reward.bgColor || 'var(--pb-orange)' }}>
            <img
              src={reward.image}
              alt={reward.name}
              className={
                'featured-reward__image' +
                (typeof reward.image === 'string' && /^https?:\/\//.test(reward.image)
                  ? ' featured-reward__image--uploaded'
                  : '')
              }
              style={rewardImageStyle(reward)}
            />
          </div>
          <div className="featured-reward__info">
            <h2 id="featured-reward-title" className="featured-reward__name">
              {reward.displayLines
                ? reward.displayLines.map((line, i) => (
                    <span key={i}>{i > 0 && <br />}{line}</span>
                  ))
                : reward.name
              }
            </h2>
            <div className="featured-reward__tags">
              {/* Hide the "FREE" tag — the value chip already says what the
                  reward is worth. Other custom tags still render. */}
              {(reward.tags || []).filter(t => t && t.toUpperCase() !== 'FREE').map(tag => (
                <span key={tag} className="featured-reward__tag">{tag}</span>
              ))}
              <span className="featured-reward__tag featured-reward__tag--cups">
                €{cashbackAmount} for
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M18 8h1a4 4 0 0 1 0 8h-1"/>
                  <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/>
                  <line x1="6" y1="1" x2="6" y2="4"/>
                  <line x1="10" y1="1" x2="10" y2="4"/>
                  <line x1="14" y1="1" x2="14" y2="4"/>
                </svg>
                {reward.cupsNeeded} cups
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Bottom: White claim panel ── */}
      <div className="featured-reward__bottom">
        {/* Decorative zigzag connector */}
        <img src={zigzagImg} alt="" className="featured-reward__zigzag" aria-hidden="true" />

        {claimed ? (
          /* ── Success state ── */
          <div className="featured-reward__success">
            <span className="featured-reward__success-icon">🎉</span>
            <h3 className="featured-reward__success-title">Reward claimed!</h3>
            <p className="featured-reward__success-desc">
              Your <strong>{reward.name}</strong> cashback is on its way.
              We'll send you a Tikkie link to collect it once your receipt is approved.
            </p>
            <button className="featured-reward__success-btn" onClick={onResetClaim}>
              Claim another reward
            </button>
          </div>
        ) : (
          /* ── Claim form ── */
          <div className="featured-reward__claim">
            <div className="featured-reward__claim-info">
              <h3 className="featured-reward__claim-title">Unlock your reward via cashback</h3>
              <p className="featured-reward__claim-desc">
                {isUnlocked
                  ? 'Scan your receipt and we\'ll send you a Tikkie link to collect your cashback. '
                  : <>Collect cups to earn cashback. Keep your purchase receipt. You'll need it to claim.</>}
                <button className="featured-reward__info-link" onClick={onOpenTerms}>Read the cashback terms</button>
                {onOpenRefund && (
                  <><span style={{ margin: '0 4px' }}>or</span>
                  <button className="featured-reward__info-link" onClick={onOpenRefund}>Get the direct refund</button></>
                )}
              </p>
            </div>

            {isUnlocked && !budgetBlocked && (
              <p className="featured-reward__payout-note">
                Once your receipt is approved, we'll send you a <strong>Tikkie link</strong> to collect your cashback, usually within a few days.
              </p>
            )}

            <button
              className={`featured-reward__claim-btn ${(!isUnlocked || (isUnlocked && budgetBlocked)) ? 'featured-reward__claim-btn--locked' : ''}`}
              type="button"
              onClick={handleClaim}
              aria-label={isUnlocked && budgetBlocked ? 'Rewards paused, try again later' : `Get €${cashbackAmount} cashback`}
            >
              {isUnlocked && budgetBlocked ? (
                'Rewards paused'
              ) : (
                <>
                  <img src={cashbackIcon} alt="" className="featured-reward__claim-btn-icon" aria-hidden="true" />
                  Get €{cashbackAmount} cashback
                </>
              )}
            </button>

            {nudgeVisible && !isUnlocked && (
              <>
                <p className="featured-reward__nudge" role="alert">
                  Collect {cupsRemaining} more cup{cupsRemaining !== 1 ? 's' : ''} to unlock your cashback.
                </p>
                {/* Direct-action follow-up. Shows AFTER the user taps the
                    locked CTA, so it's not visual noise on first paint —
                    it appears exactly when "what do I do next?" is the
                    question on the user's mind. Highlighted (orange,
                    pulsing) to draw the eye away from the disabled CTA. */}
                {onAddCup && (
                  <button
                    type="button"
                    className="featured-reward__add-cups-btn"
                    onClick={onAddCup}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                    Add more cups
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
