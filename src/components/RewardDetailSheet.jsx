import './RewardDetailSheet.css';
import { rewardImageStyle } from '../utils/imageTransform';

const CupIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8h1a4 4 0 0 1 0 8h-1"/>
    <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/>
    <line x1="6" y1="1" x2="6" y2="4"/>
    <line x1="10" y1="1" x2="10" y2="4"/>
    <line x1="14" y1="1" x2="14" y2="4"/>
  </svg>
);

const LeafIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 22L12 12"/>
    <path d="M16 8c0 0-2 8-14 14 0 0 4-12 14-14z"/>
  </svg>
);

const InfoIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <line x1="12" y1="8" x2="12" y2="12"/>
    <line x1="12" y1="16" x2="12.01" y2="16"/>
  </svg>
);

export default function RewardDetailSheet({ reward, isSelected, cupCount, onPick, onClaim, onClose, orgName, budgetBlocked = false, onBudgetBlocked }) {
  if (!reward) return null;

  const isUnlocked = cupCount >= reward.cupsNeeded;
  const cupsRemaining = Math.max(0, reward.cupsNeeded - cupCount);
  const brand = orgName || 'the restaurant';

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className="rds-backdrop" onClick={handleBackdropClick} role="dialog" aria-modal="true" aria-label={reward.name}>
      <div className="rds-sheet">

        {/* ── Close button ── */}
        <button className="rds-close" onClick={onClose} aria-label="Close">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>

        {/* ── Hero image ── */}
        <div className="rds-image-wrap" style={{ background: reward.bgColor || 'var(--bk-orange)' }}>
          <img
            src={reward.image}
            alt={reward.name}
            className={
              'rds-image' +
              (typeof reward.image === 'string' && /^https?:\/\//.test(reward.image)
                ? ' rds-image--uploaded'
                : '')
            }
            style={rewardImageStyle(reward)}
          />
        </div>

        {/* ── Scrollable body ── */}
        <div className="rds-body">

          {/* Name + price row */}
          <div className="rds-title-row">
            <h2 className="rds-name">{reward.name}</h2>
            <span className="rds-euros">€{reward.euros?.toFixed(2)}</span>
          </div>

          {/* Chips: dynamic tags + cups cost */}
          <div className="rds-chips">
            {(reward.tags || []).map(tag => (
              tag === 'PLANT-BASED'
                ? <span key={tag} className="rds-chip rds-chip--plant"><LeafIcon /> Plant-based</span>
                : <span key={tag} className="rds-chip rds-chip--free">{tag}</span>
            ))}
            <span className="rds-chip rds-chip--cups">
              <CupIcon /> {reward.cupsNeeded} cups
            </span>
          </div>

          {/* Description */}
          <p className="rds-desc">{reward.description}</p>

          {/* How to claim — shown before collecting so users know about
              the receipt requirement up front, not as a surprise at
              claim time. */}
          <div className="rds-how-to-claim">
            <h3 className="rds-section-title">How to claim</h3>
            <ol className="rds-steps">
              <li className="rds-step">
                <span className="rds-step__num">1</span>
                <span className="rds-step__text">
                  Collect <strong>{reward.cupsNeeded} cup{reward.cupsNeeded !== 1 ? 's' : ''}</strong> to unlock this reward by returning your reusable cups at {brand}.
                </span>
              </li>
              <li className="rds-step">
                <span className="rds-step__num">2</span>
                <span className="rds-step__text">
                  Buy your <strong>{reward.name}</strong> at any supermarket or grocery store in the Netherlands, and keep the printed receipt. <em>Keep it; it can't be added later.</em>
                </span>
              </li>
              <li className="rds-step">
                <span className="rds-step__num">3</span>
                <span className="rds-step__text">
                  Enter your IBAN and upload a <strong>photo of the receipt</strong> to verify your purchase.
                </span>
              </li>
              <li className="rds-step">
                <span className="rds-step__num">4</span>
                <span className="rds-step__text">
                  Once verified, you receive <strong>€{reward.euros?.toFixed(2)} cashback</strong> in your account within <strong>1 to 2 business days</strong>.
                </span>
              </li>
            </ol>
            <div className="rds-receipt-tip">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
              Keep the printed store receipt that lists your item. It is required for cashback, and it is not the same as your cup-return ticket.
            </div>
          </div>

          {/* Nutrition table */}
          <div className="rds-section">
            <h3 className="rds-section-title">Nutritional info <span className="rds-section-note">(per serving)</span></h3>
            <div className="rds-nutrition">
              {reward.nutrition?.map((n) => (
                <div key={n.label} className="rds-nutrition-row">
                  <span className="rds-nutrition-label">{n.label}</span>
                  <span className="rds-nutrition-value">{n.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Allergy info */}
          <div className="rds-allergy">
            <InfoIcon />
            <p className="rds-allergy-text">{reward.allergyInfo}</p>
          </div>

        </div>

        {/* ── CTA footer ── */}
        <div className="rds-footer">
          {isSelected ? (
            /* Already selected — show locked/unlocked cashback CTA */
            <button
              className={`rds-btn rds-btn--primary ${(!isUnlocked || budgetBlocked) ? 'rds-btn--locked' : ''}`}
              onClick={!isUnlocked ? undefined : (budgetBlocked ? onBudgetBlocked : onClaim)}
              disabled={!isUnlocked}
            >
              {!isUnlocked
                ? `${cupsRemaining} more cup${cupsRemaining !== 1 ? 's' : ''} needed`
                : budgetBlocked
                  ? 'Rewards paused'
                  : 'Get cashback'}
            </button>
          ) : (
            <>
              <button className="rds-btn rds-btn--primary" onClick={() => { onPick(reward.id); onClose(); }}>
                Choose this reward
              </button>
            </>
          )}
          <button className="rds-btn rds-btn--outline" onClick={onClose}>
            Back
          </button>
        </div>

      </div>
    </div>
  );
}
