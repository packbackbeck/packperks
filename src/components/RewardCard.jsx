import './RewardCard.css';
import cupIconWhite from '../assets/images/cup-icon-white.svg';
import { rewardImageStyle } from '../utils/imageTransform';
import { track, EVENTS } from '../utils/analytics';

// Tag label colour: white by default, switching to dark only when the
// background is very light or yellowish (where white would be unreadable).
function contrastText(hex) {
  if (typeof hex !== 'string') return '#2A2A2A';
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (h.length !== 6 || /[^0-9a-f]/i.test(h)) return '#2A2A2A';
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const tooLight = luminance > 0.72;
  const yellowish = r > 190 && g > 170 && b < 150;
  return (tooLight || yellowish) ? '#2A2A2A' : '#FFFFFF';
}

export default function RewardCard({ reward, cupCount, onSelect, onViewDetail }) {
  const isUnlocked = cupCount >= reward.cupsNeeded;
  const cupsRemaining = Math.max(0, reward.cupsNeeded - cupCount);
  const progress = Math.min(1, cupCount / reward.cupsNeeded);
  // Full euro value of the reward (no rounding — show the real price).
  const euroValue = Number(reward.euros ?? reward.cupsNeeded * 1.25).toFixed(2);

  // On the list card we surface a single product tag (FREE is implied by the
  // value chip). The price chip is a separate element and always shows.
  const visibleTags = (reward.tags || []).filter(t => t && t.toUpperCase() !== 'FREE').slice(0, 1);

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
      aria-label={`${reward.name}, ${isUnlocked ? 'Ready' : `${cupsRemaining} cups remaining`}`}
      onClick={() => { track(EVENTS.REWARD_CARD_OPENED, { reward_id: reward.id }); onViewDetail?.(reward); }}
      style={{ cursor: 'pointer' }}
    >
      <div className="reward-card__inner">
        <div className="reward-card__image-wrap" style={{ background: reward.bgColor || 'var(--pb-orange)' }}>
          <img
            src={reward.image}
            alt=""
            className={
              'reward-card__image' +
              (typeof reward.image === 'string' && /^https?:\/\//.test(reward.image)
                ? ' reward-card__image--uploaded'
                : '')
            }
            style={rewardImageStyle(reward)}
            loading="lazy"
          />
        </div>
        <div className="reward-card__info">
          <h3 className="reward-card__name">{reward.name}</h3>
          {/* Tags and the price/value chip are intentionally separate blocks
              with their own styles. Only one tag is shown in the list. */}
          <div className="reward-card__meta">
            {visibleTags.length > 0 && (
              <div className="reward-card__tags">
                {visibleTags.map(tag => (
                  <span
                    key={tag}
                    className="reward-card__tag"
                    style={{ background: reward.bgColor || '#E9E9E9', color: contrastText(reward.bgColor) }}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
            <div className="reward-card__price">
              <span className="reward-card__price-chip">
                €{euroValue} for
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
