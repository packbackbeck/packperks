import { useEffect, useState } from 'react';
import { track, EVENTS } from '../../utils/analytics';
import { getOnboarding } from '../../lib/onboarding';
import OnboardingValueProp from './OnboardingValueProp';
import OnboardingHowItWorks from './OnboardingHowItWorks';
import OnboardingPersonalise from './OnboardingPersonalise';
import OnboardingProcessing from './OnboardingProcessing';
import './Onboarding.css';

/* ─────────────────────────────────────────────────────────────────────
 * Onboarding — a self-contained, full-screen 4-state flow:
 *   0 value proposition · 1 how it works · 2 personalisation · 3 processing
 *
 * It owns only its own state; it does NOT decide when it appears. The parent
 * mounts it and passes onComplete(answers); onClose is optional (the secret
 * re-open uses it so the sheet can be dismissed). Answers are seeded from any
 * saved run so re-opening resumes, and kept across back/forward moves.
 * ───────────────────────────────────────────────────────────────────── */

const STEP_NAMES = ['value', 'how', 'personalise', 'processing'];

export default function Onboarding({ onComplete, onClose }) {
  const saved = getOnboarding();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState(() => ({
    drinkPreferences: saved?.drinkPreferences || [],
    country: saved?.country || null,
    city: saved?.city || null,
  }));

  const go = (i) => setStep(Math.max(0, Math.min(STEP_NAMES.length - 1, i)));
  // Accepts an object patch or a function of the current answers (so rapid
  // multi-select taps compose off the latest state, not a stale render).
  const patch = (p) => setAnswers(a => ({ ...a, ...(typeof p === 'function' ? p(a) : p) }));

  const advance = () => {
    track(EVENTS.ONB_CTA, { screen: STEP_NAMES[step] });
    go(step + 1);
  };
  const back = () => go(step - 1);

  const finish = () => {
    track(EVENTS.ONB_COMPLETED, {
      country: answers.country,
      city: answers.city,
      drinks: answers.drinkPreferences,
    });
    onComplete?.(answers);
  };

  // Log each screen view.
  useEffect(() => { track(EVENTS.ONB_SCREEN_VIEWED, { screen: STEP_NAMES[step] }); }, [step]);

  // Lock the page behind the full-screen flow.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Esc closes only if the parent opted in (onClose provided).
  useEffect(() => {
    if (!onClose) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const isQuizStep = step < 3;

  return (
    <div className="onb" role="dialog" aria-modal="true" aria-label="Welcome to PackPerks">
      <div className="onb__frame">
        {isQuizStep && (
          <div className="onb__top">
            {step > 0 ? (
              <button type="button" className="onb__icon-btn" onClick={back} aria-label="Go back">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
              </button>
            ) : (
              <span className="onb__icon-btn onb__icon-btn--ghost" aria-hidden="true" />
            )}

            <div className="onb__progress" role="group" aria-label={`Step ${step + 1} of 3`}>
              {[0, 1, 2].map(i => (
                <span key={i} className={`onb__dot${i === step ? ' is-active' : ''}${i < step ? ' is-done' : ''}`} />
              ))}
            </div>

            {onClose ? (
              <button type="button" className="onb__icon-btn" onClick={onClose} aria-label="Close">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            ) : (
              <span className="onb__icon-btn onb__icon-btn--ghost" aria-hidden="true" />
            )}
          </div>
        )}

        <div className="onb__screen" key={step}>
          {step === 0 && <OnboardingValueProp onNext={advance} />}
          {step === 1 && <OnboardingHowItWorks onNext={advance} />}
          {step === 2 && <OnboardingPersonalise answers={answers} onPatch={patch} onSubmit={advance} />}
          {step === 3 && <OnboardingProcessing answers={answers} onDone={finish} />}
        </div>
      </div>
    </div>
  );
}
