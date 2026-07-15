import { useRef, useState } from 'react';
import { track, EVENTS } from '../../utils/analytics';
import { DRINK_OPTIONS, MAX_DRINKS, COUNTRIES, CITIES } from '../../lib/onboarding';

/* Screen 3 — personalisation. Three questions: drinks (optional, up to 3),
 * country (required), then city (required, revealed only after a country is
 * chosen). The primary CTA names the chosen city. All selections live in the
 * parent's answers object so moving back/forward never loses them. */
export default function OnboardingPersonalise({ answers, onPatch, onSubmit }) {
  const { drinkPreferences, country, city } = answers;
  const [limitHint, setLimitHint] = useState(false);
  const revealRef = useRef(null);

  const toggleDrink = (key) => {
    const selecting = !drinkPreferences.includes(key);
    if (selecting && drinkPreferences.length >= MAX_DRINKS) {
      setLimitHint(true);               // 4th pick — light inline feedback, no modal
      return;
    }
    setLimitHint(false);
    // Functional update so fast taps compose off the latest state and the
    // max-3 cap always holds, regardless of render timing.
    onPatch(a => a.drinkPreferences.includes(key)
      ? { drinkPreferences: a.drinkPreferences.filter(d => d !== key) }
      : (a.drinkPreferences.length >= MAX_DRINKS ? {} : { drinkPreferences: [...a.drinkPreferences, key] }));
  };

  const selectCountry = (key) => {
    if (key === country) return;
    onPatch({ country: key, city: null });   // country change clears the city
    track(EVENTS.ONB_COUNTRY, { country: key });
    // Bring the freshly-revealed city list into view (after it starts opening).
    setTimeout(() => revealRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 140);
  };

  const selectCity = (c) => {
    onPatch({ city: c });
    track(EVENTS.ONB_CITY, { city: c, country });
  };

  const cities = country ? CITIES[country] : [];
  const canContinue = !!country && !!city;
  const ctaLabel = (city && city !== 'Other city') ? `Find rewards in ${city}` : 'Create my reward list';

  return (
    <div className="onb-screen onb-personalise">
      <div className="onb-screen__body onb-screen__body--scroll">
        <h1 className="onb-screen__title">Let’s find rewards you would actually use</h1>
        <p className="onb-screen__sub">We’ll prioritise matching cafés and reward items.</p>

        {/* Q1 — drinks (optional, up to 3) */}
        <fieldset className="onb-q">
          <legend className="onb-q__label">
            What do you usually order?
            <span className="onb-q__hint">Choose up to 3</span>
          </legend>
          <div className="onb-chips">
            {DRINK_OPTIONS.map(d => {
              const on = drinkPreferences.includes(d.key);
              return (
                <button
                  key={d.key}
                  type="button"
                  className={`onb-chip${on ? ' is-on' : ''}`}
                  aria-pressed={on}
                  onClick={() => toggleDrink(d.key)}
                >
                  <span className="onb-chip__emoji" aria-hidden="true">{d.emoji}</span>
                  <span className="onb-chip__label">{d.label}</span>
                  {on && <span className="onb-chip__check" aria-hidden="true">✓</span>}
                </button>
              );
            })}
          </div>
          <span className={`onb-q__limit${limitHint ? ' is-shown' : ''}`} role="status" aria-live="polite">
            That’s 3 already, tap one to swap.
          </span>
        </fieldset>

        {/* Q2 — country (required) */}
        <fieldset className="onb-q">
          <legend className="onb-q__label">Where will you use PackPerks?</legend>
          <div className="onb-countries">
            {COUNTRIES.map(c => {
              const on = country === c.key;
              return (
                <button key={c.key} type="button" className={`onb-country${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => selectCountry(c.key)}>
                  <span className="onb-country__flag" aria-hidden="true">{c.emoji}</span>
                  <span className="onb-country__name">{c.label}</span>
                  <span className="onb-country__check" aria-hidden="true">✓</span>
                </button>
              );
            })}
          </div>
        </fieldset>

        {/* Q3 — city, revealed once a country exists (smooth height + opacity) */}
        <div ref={revealRef} className={`onb-reveal${country ? ' is-open' : ''}`}>
          <div className="onb-reveal__inner">
            {country && (
              <fieldset className="onb-q">
                <legend className="onb-q__label">Which city should we prioritise?</legend>
                <div className="onb-chips onb-chips--cities">
                  {cities.map(c => {
                    const on = city === c;
                    return (
                      <button key={c} type="button" className={`onb-chip onb-chip--city${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => selectCity(c)}>
                        <span className="onb-chip__label">{c}</span>
                        {on && <span className="onb-chip__check" aria-hidden="true">✓</span>}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            )}
          </div>
        </div>
      </div>

      <div className="onb-screen__foot">
        <button type="button" className="onb-btn onb-btn--primary" disabled={!canContinue} onClick={onSubmit}>
          {ctaLabel}
        </button>
      </div>
    </div>
  );
}
