import './BottomActions.css';
import { track, EVENTS } from '../utils/analytics';

export default function BottomActions({ onAddCup, onWithdraw, cupCount, orgName }) {
  const brand = orgName || 'PackBack';
  const handleShare = async () => {
    track(EVENTS.SHARE_CUP);
    const shareData = {
      title: `PackPerks × ${brand}`,
      text: `I'm collecting reusable cups and earning free ${brand} rewards! Join me ♻️`,
      url: window.location.href,
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(shareData.url);
      }
    } catch {
      // user cancelled
    }
  };

  return (
    <section className="bottom-actions" aria-label="Cup actions">
      <div className="bottom-actions__row">
        <button className="bottom-actions__btn" type="button" onClick={handleShare}>
          {/* Heart icon */}
          <svg width="15" height="13" viewBox="0 0 15 13" fill="none" aria-hidden="true">
            <path d="M7.5 12.5L1.5 6.5C0 5 0 2.5 1.5 1.5C3 0.5 5 0.5 6.5 2L7.5 3L8.5 2C10 0.5 12 0.5 13.5 1.5C15 2.5 15 5 13.5 6.5L7.5 12.5Z" fill="#E24400"/>
          </svg>
          <span>Share your Cup</span>
        </button>
        <button className="bottom-actions__btn" type="button" onClick={onAddCup}>
          {/* Plus icon */}
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <line x1="10" y1="3" x2="10" y2="17" stroke="black" strokeWidth="2" strokeLinecap="round"/>
            <line x1="3" y1="10" x2="17" y2="10" stroke="black" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          <span>Add more cups</span>
        </button>
      </div>
      <button
        className="bottom-actions__withdraw"
        type="button"
        onClick={onWithdraw}
        disabled={cupCount === 0}
      >
        {/* Minus icon */}
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <line x1="3" y1="10" x2="17" y2="10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
        </svg>
        <span>Withdraw all Cups</span>
      </button>
    </section>
  );
}
