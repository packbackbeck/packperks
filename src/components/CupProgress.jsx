import './CupProgress.css';
import cupIcon from '../assets/images/cup-icon.svg';

/* A single cup circle (filled / empty / nudged). */
function CupCircle({ filled, nudged, delay }) {
  return (
    <div
      className={[
        'cup-progress__cup',
        filled ? 'cup-progress__cup--filled' : 'cup-progress__cup--empty',
        nudged ? 'cup-progress__cup--nudge' : '',
      ].filter(Boolean).join(' ')}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="cup-progress__cup-icon-wrap">
        <img src={cupIcon} alt="" className="cup-progress__cup-img" aria-hidden="true" />
        {filled && (
          <svg className="cup-progress__cup-check" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M3 7L6 10L11 4" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
      {nudged && <div className="cup-progress__cup-ring" aria-hidden="true" />}
    </div>
  );
}

/* The end-goal star, appended to balance an odd two-row layout. Lights up
 * once every required cup is collected. */
function StarCircle({ lit, delay }) {
  return (
    <div
      className={`cup-progress__cup cup-progress__cup--star ${lit ? 'cup-progress__cup--star-lit' : ''}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="cup-progress__cup-icon-wrap">
        <svg className="cup-progress__star" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M12 2.6l2.85 5.77 6.37.93-4.61 4.49 1.09 6.35L12 17.02l-5.7 3.0 1.09-6.35L2.78 9.3l6.37-.93z"
            fill={lit ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  );
}

export default function CupProgress({ collected, target, nudgeCount = 0 }) {
  const t = Math.max(0, target || 0);
  const isComplete = t > 0 && collected >= t;
  const progress = t > 0 ? Math.min(1, collected / t) : 0;

  // Rule: rewards needing more than 5 cups render across two equal rows.
  const twoRow = t > 5;

  // One descriptor per required cup.
  const items = [];
  for (let i = 0; i < t; i++) {
    items.push({
      key: `cup-${i}`,
      type: 'cup',
      filled: i < collected,
      nudged: i >= collected && nudgeCount > 0 && i < collected + nudgeCount,
      delay: i * 50,
    });
  }
  // Odd count in two-row mode → append a star "end goal" so the two rows are
  // equal. It lights up when all cups are collected.
  if (twoRow && t % 2 === 1) {
    items.push({ key: 'star', type: 'star', lit: isComplete, delay: t * 50 });
  }

  const rows = twoRow
    ? [items.slice(0, Math.ceil(items.length / 2)), items.slice(Math.ceil(items.length / 2))]
    : [items];

  const renderItem = (it) =>
    it.type === 'star'
      ? <StarCircle key={it.key} lit={it.lit} delay={it.delay} />
      : <CupCircle key={it.key} filled={it.filled} nudged={it.nudged} delay={it.delay} />;

  const overflow = collected > t;

  return (
    <div className="cup-progress" role="progressbar" aria-valuenow={collected} aria-valuemin={0} aria-valuemax={t}>
      <div className={`cup-progress__track${isComplete ? ' cup-progress__track--complete' : ''}${twoRow ? ' cup-progress__track--tworow' : ''}`}>
        {/* Continuous fill bar only for the single-row layout. */}
        {!twoRow && (
          <div
            className={`cup-progress__fill${isComplete ? ' cup-progress__fill--complete' : ''}`}
            style={{ width: `${progress * 100}%` }}
          />
        )}
        <div className="cup-progress__rows">
          {rows.map((row, ri) => (
            <div key={ri} className={`cup-progress__cups-row${isComplete ? ' cup-progress__cups-row--complete' : ''}`}>
              {row.map(renderItem)}
            </div>
          ))}
        </div>
      </div>
      {overflow && (
        <p className="cup-progress__overflow">+{collected - t} more</p>
      )}
    </div>
  );
}
