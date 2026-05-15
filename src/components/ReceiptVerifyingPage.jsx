import { useEffect, useState } from 'react';
import './ReceiptVerifyingPage.css';

/* "Analyzer" steps that cycle in the center of the progress ring. These
 * are intentionally mechanical-sounding so it looks like a dedicated
 * verification engine is doing the work. Cycle pace (~1.4s) is independent
 * of the actual edge-function latency; the ring fills lazily to 96% over
 * ~4.5s and holds there until App.jsx navigates away based on the result. */
const STEPS = [
  {
    label: 'Scanning receipt',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="5" y="3" width="14" height="18" rx="1.5" />
        <line x1="8" y1="8"  x2="16" y2="8" />
        <line x1="8" y1="12" x2="14" y2="12" />
        <line x1="8" y1="16" x2="12" y2="16" />
      </svg>
    ),
  },
  {
    label: 'Reading line items',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="7" />
        <line x1="20" y1="20" x2="16" y2="16" />
        <line x1="8" y1="11" x2="14" y2="11" />
      </svg>
    ),
  },
  {
    label: 'Verifying brand markers',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2 L20 6 V12 C20 17 16.5 20.5 12 22 C7.5 20.5 4 17 4 12 V6 Z" />
        <path d="M9 12 L11 14 L15 10" />
      </svg>
    ),
  },
  {
    label: 'Cross-checking menu',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 7 H20" />
        <path d="M4 12 H20" />
        <path d="M4 17 H14" />
        <circle cx="19" cy="17" r="2.5" />
      </svg>
    ),
  },
];

const STEP_INTERVAL_MS = 1400;

// Circular geometry
const SIZE = 184;
const STROKE = 10;
const R = (SIZE - STROKE) / 2;
const CIRC = 2 * Math.PI * R;
// Target final dashoffset = 4% of the circumference (leaves a sliver unfilled
// so the ring never visually reaches 100% before the actual result lands).
const FINAL_OFFSET = CIRC * 0.04;

export default function ReceiptVerifyingPage() {
  const [stepIdx, setStepIdx] = useState(0);
  // Drive the dashoffset from state so a CSS transition handles the easing.
  // Initial value = full circumference (empty ring). After mount we flip to
  // the final offset and the transition animates over 4.5s.
  const [dashOffset, setDashOffset] = useState(CIRC);

  useEffect(() => {
    // Kick off after first paint so the transition actually runs.
    const t = setTimeout(() => setDashOffset(FINAL_OFFSET), 30);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const id = setInterval(
      () => setStepIdx(i => (i + 1) % STEPS.length),
      STEP_INTERVAL_MS,
    );
    return () => clearInterval(id);
  }, []);

  const step = STEPS[stepIdx];

  return (
    <div className="rv-page">
      <div className="rv-page__glow" />

      <h1 className="rv-page__title">Verifying your receipt</h1>
      <p className="rv-page__subtitle">
        Hold tight — this usually takes a few seconds.
      </p>

      <div className="rv-ring-wrap" style={{ width: SIZE, height: SIZE }}>
        <svg className="rv-ring" width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
          {/* Background track */}
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            stroke="#F1EAE0"
            strokeWidth={STROKE}
            fill="none"
          />
          {/* Animated foreground arc — transition fires when dashOffset changes */}
          <circle
            className="rv-ring__fg"
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            stroke="url(#rvGrad)"
            strokeWidth={STROKE}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={CIRC}
            strokeDashoffset={dashOffset}
          />
          <defs>
            <linearGradient id="rvGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#FF7A2E" />
              <stop offset="100%" stopColor="#E24400" />
            </linearGradient>
          </defs>
        </svg>

        {/* Centre icon + label cycle on a fixed interval. Key change forces
            React to remount the element so the CSS enter animation restarts. */}
        <div className="rv-ring__center">
          <div key={stepIdx} className="rv-step-icon">{step.icon}</div>
          <div key={`l${stepIdx}`} className="rv-step-label">{step.label}…</div>
        </div>
      </div>
    </div>
  );
}
