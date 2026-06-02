import './RewardCard.css';
import cupIconWhite from '../assets/images/cup-icon-white.svg';

export default function RewardCard({ reward, cupCount, onSelect, onViewDetail }) {
  const isUnlocked = cupCount >= reward.cupsNeeded;
  const cupsRemaining = Math.max(0, reward.cupsNeeded - cupCount);
  const progress = Math.min(1, cupCount / reward.cupsNeeded);
  // Euro value of the reward, rounded — mirrors the featured card chip.
  const euroValue = Math.round(Number(reward.euros ?? reward.cupsNeeded * 1.25));

  // Build divider positions: one line after each cup slot except the last
  // Dividers sit at 1/n, 2/n, ... (n-1)/n of the track width
  const dividers = [];
  for (let i = 1; i < reward.cupsNeeded; i++) {
    dividers.push(
      <div
        key={i}
        className="reward-card__divider"
        style={{ left: `${(i / reward.cupsNeeded) * 100}%` }}
        aria-hidden="true"
      />
    );
  }

  return (
    <article
      className="reward-card"
      aria-label={`${reward.name} — ${isUnlocked ? 'Ready' : `${cupsRemaining} cups remaining`}`}
      onClick={() => onViewDetail?.(reward)}
      style={{ cursor: 'pointer' }}
    >
      <div className="reward-card__inner">
        <div className="reward-card__image-wrap" style={{ background: reward.bgColor || 'var(--bk-orange)' }}>
          <img
            src={reward.image}
            alt=""
            className={
              'reward-card__image' +
              (typeof reward.image === 'string' && /^https?:\/\//.test(reward.image)
                ? ' reward-card__image--uploaded'
                : '')
            }
            loading="lazy"
          />
        </div>
        <div className="reward-card__info">
          <h3 className="reward-card__name">{reward.name}</h3>
          {/* Chips row */}
          <div className="reward-card__chips">
            <span className="reward-card__chip reward-card__chip--cups">
              €{euroValue} for
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#502314" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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

      {/* Progress bar footer */}
      <div className="reward-card__progress">
        <div className="reward-card__progress-track">
          {/* Coloured fill */}
          <div
            className={`reward-card__progress-fill ${isUnlocked ? 'reward-card__progress-fill--green' : 'reward-card__progress-fill--orange'}`}
            style={{ width: `${isUnlocked ? 100 : Math.max(20, progress * 100)}%` }}
          >
            <span className="reward-card__cups-label">
              {isUnlocked ? 'Ready!' : `${cupsRemaining} cup${cupsRemaining !== 1 ? 's' : ''} left`}
            </span>
            <img src={cupIconWhite} alt="" className="reward-card__cups-icon" aria-hidden="true" />
          </div>
          {/* Step dividers — overlaid on top of the full track */}
          {dividers}
        </div>
      </div>
    </article>
  );
}
