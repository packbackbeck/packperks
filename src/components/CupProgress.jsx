import './CupProgress.css';

/* The bring-your-own cup glyph. An empty cup is a faint outline; a collected
 * cup is a solid (filled) cup with a checkmark carved into it. */
function CupGlyph({ filled }) {
  if (filled) {
    return (
      <svg className="cup-progress__cup-img" viewBox="0 0 33 32" fill="none" aria-hidden="true">
        <path
          fill="currentColor"
          d="M25.5322 5.43066C26.8636 5.43066 27.9922 6.48953 27.9922 7.85645V10.4746C27.9922 11.8415 26.8635 12.9004 25.5322 12.9004H24.9834L23.2803 26.3281C23.2094 26.8858 22.735 27.3037 22.1729 27.3037H10.0781C9.52317 27.3036 9.05289 26.896 8.97363 26.3467L7.03223 12.9004H6.71875C5.38753 12.9004 4.25879 11.8415 4.25879 10.4746V7.85645C4.25879 6.48952 5.38748 5.4307 6.71875 5.43066H25.5322ZM21.251 15.7393C20.9844 15.2539 20.3551 15.1679 19.9609 15.5547C19.8442 15.6693 19.731 15.7845 19.6172 15.8994L19.0498 16.4658L17.1582 18.3574L15.7285 19.7881C15.4937 20.0228 15.1432 20.3505 14.9385 20.5918L13.2764 18.9316L12.8525 18.5078C12.6327 18.2875 12.4638 18.1132 12.125 18.1152C11.9145 18.1162 11.7127 18.2 11.5635 18.3486C11.4922 18.421 11.4143 18.5337 11.3828 18.6309C11.3728 18.6619 11.3489 18.7506 11.335 18.7725V19.0449C11.3519 19.0697 11.3537 19.0947 11.3643 19.123C11.402 19.2226 11.4356 19.3179 11.5059 19.3994C11.661 19.579 11.836 19.7462 12.0039 19.9141L13.8164 21.7266C13.9963 21.9069 14.1746 22.0896 14.3584 22.2656C14.6892 22.5823 15.1662 22.5889 15.498 22.2705C15.6232 22.1503 15.7456 22.0273 15.8682 21.9043L16.5195 21.252L18.5635 19.207L20.2695 17.501L20.8291 16.9434C20.9367 16.8359 21.0441 16.7302 21.1475 16.6182C21.2558 16.5005 21.27 16.3813 21.3311 16.2598L21.335 16.252V15.9619L21.332 15.9551C21.3005 15.8892 21.2836 15.7987 21.251 15.7393Z"
        />
      </svg>
    );
  }
  return (
    <svg className="cup-progress__cup-img" viewBox="0 0 33 32" fill="none" aria-hidden="true">
      <path
        d="M25.5327 6.54688H6.71919C5.97702 6.54688 5.37537 7.1331 5.37537 7.85624V10.475C5.37537 11.1981 5.97702 11.7843 6.71919 11.7843H25.5327C26.2749 11.7843 26.8765 11.1981 26.8765 10.475V7.85624C26.8765 7.1331 26.2749 6.54688 25.5327 6.54688Z"
        stroke="currentColor" strokeWidth="2.23308" strokeLinecap="round" strokeLinejoin="round"
      />
      <path
        d="M8.06299 11.7843L10.0787 26.1873H22.1731L24.1889 11.7843"
        stroke="currentColor" strokeWidth="2.23308" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}

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
        <CupGlyph filled={filled} />
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

  // Two-row "snake" fill: the background progress fills the TOP row left→right
  // first, then the BOTTOM row left→right. Each segment tracks how many of that
  // row's cups are collected.
  const row0Cups = twoRow ? rows[0].filter(it => it.type === 'cup').length : 0;
  const row1Cups = twoRow ? rows[1].filter(it => it.type === 'cup').length : 0;
  const row0Fill = row0Cups ? Math.min(1, collected / row0Cups) : 0;
  const row1Fill = row1Cups ? Math.min(1, Math.max(0, collected - row0Cups) / row1Cups) : 0;
  // Collected cups per row — each one nudges the snake ~5px wider so the fill
  // sits comfortably past each cup rather than stopping right at its centre.
  const row0Done = Math.min(collected, row0Cups);
  const row1Done = Math.min(row1Cups, Math.max(0, collected - row0Cups));
  const snakeWidth = (fillFrac, doneCups) =>
    doneCups > 0 ? `min(100%, calc(${fillFrac * 100}% + ${doneCups * 5}px))` : '0%';

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
        {/* Two-row snake fill — top row fills first, then the bottom row. */}
        {twoRow && (
          <div className="cup-progress__snake" aria-hidden="true">
            <div
              className={`cup-progress__snake-seg cup-progress__snake-seg--top${isComplete ? ' cup-progress__snake-seg--complete' : ''}`}
              style={{ width: snakeWidth(row0Fill, row0Done) }}
            />
            <div
              className={`cup-progress__snake-seg cup-progress__snake-seg--bottom${isComplete ? ' cup-progress__snake-seg--complete' : ''}`}
              style={{ width: snakeWidth(row1Fill, row1Done) }}
            />
          </div>
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
