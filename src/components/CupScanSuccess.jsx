import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import './CupScanSuccess.css';

function formatDate(d = new Date()) {
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
function formatTime(d = new Date()) {
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

// How long the success popup stays before it gracefully bows out to home.
const AUTO_DISMISS_MS = 5000;
// Matches the exit-transition duration in CupScanSuccess.css.
const FADE_MS = 400;

export default function CupScanSuccess({ cupsAdded, newTotal, onAddMore, onHome }) {
  const now = new Date();
  const scanId = 'CUP-' + Date.now().toString(36).toUpperCase().slice(-5);

  const [leaving, setLeaving] = useState(false);
  const navigatedRef = useRef(false);

  // Fade the screen out, then navigate exactly once (guards against the
  // auto-dismiss timer and a manual tap both firing).
  const leaveTo = useCallback((dest) => {
    if (navigatedRef.current) return;
    navigatedRef.current = true;
    setLeaving(true);
    setTimeout(() => dest(), FADE_MS);
  }, []);

  const goReward = useCallback(() => leaveTo(onHome), [leaveTo, onHome]);
  const goAddMore = useCallback(() => leaveTo(onAddMore), [leaveTo, onAddMore]);

  // Auto-dismiss → smoothly transition to the home screen after 5s.
  useEffect(() => {
    const t = setTimeout(() => leaveTo(onHome), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [leaveTo, onHome]);

  return createPortal(
    <div
      className={`css-overlay${leaving ? ' css-overlay--leaving' : ''}`}
      onClick={goReward}
      role="dialog"
      aria-modal="true"
      aria-label="Cup added"
    >
      <div className="css-sheet" onClick={(e) => e.stopPropagation()}>
      {/* Green glow */}
      <div className="css-page__glow" />

      {/* Animated checkmark */}
      <div className="css-page__check-wrap">
        <svg className="css-page__check-svg" viewBox="0 0 80 80" fill="none">
          <circle cx="40" cy="40" r="38" fill="#1A8737" opacity="0.15" />
          <circle cx="40" cy="40" r="30" fill="#1A8737" />
          <path
            className="css-page__check-path"
            d="M24 40L35 51L56 29"
            stroke="white"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      {/* Title */}
      <div className="css-page__text">
        <h1 className="css-page__title">Cup added! ♻️</h1>
        <p className="css-page__subtitle">Your return has been registered.</p>
      </div>

      {/* Info card */}
      <div className="css-card">
        {/* Big cup count */}
        <div className="css-card__count-row">
          <span className="css-card__count">+{cupsAdded}</span>
          <span className="css-card__count-label">cup{cupsAdded !== 1 ? 's' : ''} added</span>
        </div>

        <div className="css-card__dashed" />

        {/* Receipt details */}
        <div className="css-card__rows">
          <div className="css-card__row">
            <span className="css-card__label">Scan ID</span>
            <span className="css-card__value">{scanId}</span>
          </div>
          <div className="css-card__row">
            <span className="css-card__label">Date</span>
            <span className="css-card__value">{formatDate(now)}</span>
          </div>
          <div className="css-card__row">
            <span className="css-card__label">Time</span>
            <span className="css-card__value">{formatTime(now)}</span>
          </div>
          <div className="css-card__row">
            <span className="css-card__label">Cups added</span>
            <span className="css-card__value css-card__value--green">+{cupsAdded}</span>
          </div>
        </div>

        <div className="css-card__dashed" />

        <div className="css-card__row">
          <span className="css-card__label css-card__label--total">Total cups</span>
          <span className="css-card__value css-card__value--bold">{newTotal}</span>
        </div>
      </div>

      {/* CTAs */}
      <div className="css-page__actions">
        <button className="css-page__btn css-page__btn--primary" onClick={goReward}>
          {/* gift / reward icon */}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 12 20 22 4 22 4 12"/>
            <rect x="2" y="7" width="20" height="5"/>
            <line x1="12" y1="22" x2="12" y2="7"/>
            <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/>
            <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>
          </svg>
          Select reward
        </button>
        <button className="css-page__btn css-page__btn--outline" onClick={goAddMore}>
          {/* cup icon */}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8h1a4 4 0 0 1 0 8h-1"/>
            <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/>
            <line x1="6" y1="1" x2="6" y2="4"/>
            <line x1="10" y1="1" x2="10" y2="4"/>
            <line x1="14" y1="1" x2="14" y2="4"/>
          </svg>
          Add more cups
        </button>
      </div>
      </div>
    </div>,
    document.body,
  );
}
