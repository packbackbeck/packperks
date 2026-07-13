import { useEffect, useState } from 'react';
import { drinkPhrase } from '../../lib/onboarding';

const STATUS = ['Matching your favourite drinks', 'Finding participating cafés', 'Ranking rewards for you'];

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

/* Screen 4 — processing transition. A short (~1.2–2s) beat where café + reward
 * cards assemble into a stack, visually handing off to the market page, then a
 * brief "ready" flash before the completion callback fires. No fake percentage,
 * no AI language; honours reduced-motion by shortening the beat. */
export default function OnboardingProcessing({ answers, onDone }) {
  const [statusIdx, setStatusIdx] = useState(0);
  const [ready, setReady] = useState(false);

  const drinks = drinkPhrase(answers?.drinkPreferences);
  const cityLabel = answers?.city && answers.city !== 'Other city' ? answers.city : 'your area';
  const sub = drinks ? `Finding ${drinks} rewards in ${cityLabel}...` : `Finding rewards in ${cityLabel}...`;

  useEffect(() => {
    const build = prefersReducedMotion() ? 700 : 1600;
    const step = build / STATUS.length;
    const timers = [];
    STATUS.forEach((_, i) => { if (i > 0) timers.push(setTimeout(() => setStatusIdx(i), step * i)); });
    timers.push(setTimeout(() => setReady(true), build));
    timers.push(setTimeout(() => onDone?.(), build + 550));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="onb-screen onb-processing">
      <div className="onb-processing__stage" aria-hidden="true">
        <div className={`onb-stack${ready ? ' is-ready' : ''}`}>
          <span className="onb-stack__card onb-stack__card--c3" />
          <span className="onb-stack__card onb-stack__card--c2" />
          <span className="onb-stack__card onb-stack__card--c1">
            <span className="onb-stack__thumb">🥤</span>
            <span className="onb-stack__lines"><i /><i /></span>
          </span>
          <span className={`onb-stack__check${ready ? ' is-shown' : ''}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
          </span>
        </div>
      </div>

      <div className="onb-processing__txt" role="status" aria-live="polite">
        <h1 className="onb-screen__title onb-processing__title">
          {ready ? 'Your collection is ready' : 'Building your café collection'}
        </h1>
        {!ready && <p className="onb-screen__sub">{sub}</p>}
        {!ready && (
          <ul className="onb-processing__status">
            {STATUS.map((s, i) => (
              <li key={i} className={`onb-processing__status-item${i <= statusIdx ? ' is-active' : ''}${i < statusIdx ? ' is-done' : ''}`}>
                <span className="onb-processing__status-dot" />
                {s}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
