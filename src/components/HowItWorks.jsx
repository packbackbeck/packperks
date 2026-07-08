import { useEffect, useState, useMemo } from 'react';
import './HowItWorks.css';

/* ─────────────────────────────────────────────────────────────────────
 * "How it works" walkthrough.
 *
 * A full-screen, Instagram-Stories style guide: segmented progress bars
 * across the top, auto-advancing illustrated steps, tap the left/right of
 * the screen to go back/forward, and a clear call to action at the bottom.
 * Auto-play stops the moment the user taps, so they can read at their pace.
 *
 * Illustrations live in /public/how-it-works/step-N.png. Until those files
 * exist the large step icon shows as a graceful placeholder, so nothing
 * looks broken before the artwork is dropped in.
 * ───────────────────────────────────────────────────────────────────── */

const CupIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 4h14l-1.3 15.3a2.5 2.5 0 0 1-2.5 2.2H8.8a2.5 2.5 0 0 1-2.5-2.2L5 4z" />
    <path d="M4 8h16" /><path d="M10 12v4M14 12v4" />
  </svg>
);
const RewardIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="9" width="18" height="12" rx="1.6" /><path d="M3 13h18" /><path d="M12 9v12" />
    <path d="M12 9S10.6 4.5 8.2 5a2 2 0 0 0 .3 4z" /><path d="M12 9s1.4-4.5 3.8-4a2 2 0 0 1-.3 4z" />
  </svg>
);
const StoreIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 8h12l1 13H5L6 8z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" />
  </svg>
);
const ReceiptIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 3h12v18l-2.5-1.6L13 21l-2.5-1.6L8 21l-2-1.6V3z" /><path d="M9 8h6M9 12h6M9 16h3.5" />
  </svg>
);
const CashIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" /><path d="M15.2 9.2a3.6 3.6 0 1 0 0 5.6" /><path d="M7.6 11h5M7.6 13.4h5" />
  </svg>
);

/* Named icon set — admins pick one of these per guide step in App Design.
 * Keys are stable string ids stored in the config; values are the SVGs. */
export const GUIDE_ICONS = {
  cup:     CupIcon,
  reward:  RewardIcon,
  store:   StoreIcon,
  receipt: ReceiptIcon,
  cash:    CashIcon,
};
export const GUIDE_ICON_KEYS = Object.keys(GUIDE_ICONS);

const DEFAULT_STEPS = [
  {
    key: 'return',
    title: 'Return your cups',
    text: 'Bring your reusable cups back to any participating spot. Every cup you return adds to your balance.',
    image: '/how-it-works/step-1.png',
    bg: 'linear-gradient(165deg, #FDF1E6 0%, #F9DFCB 100%)',
    accent: '#E08A53',
    Icon: CupIcon,
  },
  {
    key: 'unlock',
    title: 'Unlock a reward',
    text: 'Collect enough cups to unlock a reward, then choose the product you want from the list.',
    image: '/how-it-works/step-2.png',
    bg: 'linear-gradient(165deg, #FCF2D6 0%, #F8E7B9 100%)',
    accent: '#E0A12B',
    Icon: RewardIcon,
  },
  {
    key: 'buy',
    title: 'Buy it in the store',
    text: (
      <>Buy that product at <strong>any</strong> supermarket or grocery store in <strong>the Netherlands</strong>, and keep the printed receipt.</>
    ),
    image: '/how-it-works/step-3.png',
    bg: 'linear-gradient(165deg, #E9F4E7 0%, #D6ECD8 100%)',
    accent: '#5FA044',
    Icon: StoreIcon,
  },
  {
    key: 'verify',
    title: 'Verify your purchase',
    text: 'Snap a photo of your receipt so we can confirm the purchase.',
    image: '/how-it-works/step-4.png',
    bg: 'linear-gradient(165deg, #E6EAFC 0%, #D2DBF8 100%)',
    accent: '#5468C8',
    Icon: ReceiptIcon,
  },
  {
    key: 'cashback',
    title: 'Get your cashback',
    text: 'Once it is verified, we send you a Tikkie link to collect your cashback — usually within a few days.',
    image: '/how-it-works/step-5.png',
    bg: 'linear-gradient(165deg, #ECF8F1 0%, #DAF1E6 100%)',
    accent: '#2EA785',
    Icon: CashIcon,
  },
];

const STEP_DURATION = 6500;

/* Overlay custom step text (e.g. the BYO copy: [{title, body}, …]) onto the
 * built-in visual scaffolding (icons / gradients / art), so a group in a
 * different mode gets its own wording without needing bespoke artwork. */
function resolveSteps(custom) {
  if (!custom?.length) return DEFAULT_STEPS;
  return custom.map((s, i) => {
    const base = DEFAULT_STEPS[i % DEFAULT_STEPS.length];
    // Each field falls back to the built-in scaffolding when the admin
    // hasn't set it, so partially-edited steps still look complete.
    return {
      key:    s.key || `step-${i}`,
      title:  s.title,
      text:   s.body ?? s.text,
      image:  s.image || base.image,
      bg:     s.bg || base.bg,
      accent: s.accent || base.accent,
      Icon:   (s.icon && GUIDE_ICONS[s.icon]) || base.Icon,
    };
  });
}

export default function HowItWorks({ onClose, onComplete, steps: customSteps }) {
  const steps = useMemo(() => resolveSteps(customSteps), [customSteps]);
  const [index, setIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [auto, setAuto] = useState(true);
  const last = steps.length - 1;

  function goNext() {
    setAuto(false);
    if (index >= last) { onClose(); return; }
    setIndex(index + 1);
    setProgress(0);
  }
  function goPrev() {
    setAuto(false);
    if (index <= 0) { setProgress(0); return; }
    setIndex(index - 1);
    setProgress(0);
  }

  // Auto-fill the active bar while in auto-play.
  useEffect(() => {
    if (!auto) return undefined;
    const TICK = 50;
    const id = setInterval(() => {
      setProgress(p => Math.min(100, p + (100 * TICK) / STEP_DURATION));
    }, TICK);
    return () => clearInterval(id);
  }, [auto, index]);

  // When the active bar is full, move to the next step (or stop at the end).
  useEffect(() => {
    if (!auto || progress < 100) return undefined;
    const id = setTimeout(() => {
      if (index >= last) { setAuto(false); return; }
      setIndex(i => i + 1);
      setProgress(0);
    }, 150);
    return () => clearTimeout(id);
  }, [auto, progress, index, last]);

  // Keyboard: Escape closes, arrows navigate.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') goNext();
      else if (e.key === 'ArrowLeft') goPrev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // The user has "gone through all 5 pages" once they reach the final step
  // (whether by tapping or by auto-advance). That is what dismisses the
  // home-screen prompt for good.
  useEffect(() => {
    if (index >= last) onComplete?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  const step = steps[index];
  const Icon = step.Icon;

  return (
    <div className="hiw" style={{ background: step.bg }} role="dialog" aria-modal="true" aria-label="How it works">
      {/* Tap zones sit behind the content (which is click-through) so a tap
          anywhere on the left/right navigates, Stories-style. */}
      <button className="hiw__tap hiw__tap--prev" onClick={goPrev} aria-label="Previous step" tabIndex={-1} />
      <button className="hiw__tap hiw__tap--next" onClick={goNext} aria-label="Next step" tabIndex={-1} />

      <div className="hiw__bars">
        {steps.map((s, i) => (
          <div key={s.key} className="hiw__bar">
            <span
              className="hiw__bar-fill"
              style={{ width: i < index ? '100%' : i === index ? `${auto ? progress : 100}%` : '0%' }}
            />
          </div>
        ))}
      </div>

      <div className="hiw__head">
        <span className="hiw__brand">How it works</span>
        <button className="hiw__close" onClick={onClose} aria-label="Close">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div className="hiw__content">
        <div className="hiw__art">
          <div className="hiw__art-fallback"><Icon /></div>
          <img className="hiw__art-img" src={step.image} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        </div>
        <span className="hiw__chip" style={{ color: step.accent }}><Icon /></span>
        <h2 className="hiw__title">{step.title}</h2>
        <p className="hiw__text">{step.text}</p>
      </div>

      <div className="hiw__foot">
        <span className="hiw__count">{index + 1} of {steps.length}</span>
        <button className="hiw__cta" onClick={goNext}>
          {index >= last ? 'Got it' : 'Next'}
        </button>
      </div>
    </div>
  );
}
