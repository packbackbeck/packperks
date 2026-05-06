import './CupProgress.css';
import cupIcon from '../assets/images/cup-icon.svg';

export default function CupProgress({ collected, target, nudgeCount = 0 }) {
  const displayTarget = Math.min(target, 8);
  const filledCount = Math.min(collected, displayTarget);
  const progress = Math.min(1, collected / target);
  const isComplete = progress >= 1;

  const cups = [];
  for (let i = 0; i < displayTarget; i++) {
    const isFilled = i < filledCount;
    // Nudge: highlight the next `nudgeCount` empty cups after the filled ones
    const isNudged = !isFilled && nudgeCount > 0 && i < filledCount + nudgeCount;

    cups.push(
      <div
        key={i}
        className={[
          'cup-progress__cup',
          isFilled ? 'cup-progress__cup--filled' : 'cup-progress__cup--empty',
          isNudged ? 'cup-progress__cup--nudge' : '',
        ].filter(Boolean).join(' ')}
        style={{ animationDelay: `${i * 60}ms` }}
      >
        <div className="cup-progress__cup-icon-wrap">
          <img src={cupIcon} alt="" className="cup-progress__cup-img" aria-hidden="true" />
          {isFilled && (
            <svg className="cup-progress__cup-check" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M3 7L6 10L11 4" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
        </div>
        {isNudged && <div className="cup-progress__cup-ring" aria-hidden="true" />}
      </div>
    );
    if (i < displayTarget - 1) {
      cups.push(
        <div
          key={`dot-${i}`}
          className={`cup-progress__dot ${i < filledCount - 1 ? 'cup-progress__dot--active' : ''}`}
          aria-hidden="true"
        />
      );
    }
  }

  const overflow = collected > displayTarget;

  return (
    <div className="cup-progress" role="progressbar" aria-valuenow={collected} aria-valuemin={0} aria-valuemax={target}>
      <div className={`cup-progress__track${isComplete ? ' cup-progress__track--complete' : ''}`}>
        {/* Progress bar fill */}
        <div
          className={`cup-progress__fill${isComplete ? ' cup-progress__fill--complete' : ''}`}
          style={{ width: `${progress * 100}%` }}
        />
        {/* Cup icons sit above the fill */}
        <div className={`cup-progress__cups-row${isComplete ? ' cup-progress__cups-row--complete' : ''}`}>
          {cups}
        </div>
      </div>
      {overflow && (
        <p className="cup-progress__overflow">+{collected - displayTarget} more</p>
      )}
    </div>
  );
}
