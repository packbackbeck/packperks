import cupIcon from '../../assets/images/cup-icon.svg';

/* Screen 1 — value proposition. A dynamic product-marketing composition: a
 * central app preview with reward cards + confirmations floating around it at
 * different depths. The whole visual is decorative (aria-hidden) so screen
 * readers jump straight to the headline + CTA. */
export default function OnboardingValueProp({ onNext }) {
  return (
    <div className="onb-screen onb-value">
      <div className="onb-hero" aria-hidden="true">
        {/* Floating elements — gentle vertical drift / parallax, set in CSS. */}
        <span className="onb-float onb-float--cup">
          <img src={cupIcon} alt="" />
        </span>
        <span className="onb-float onb-float--added">
          <span className="onb-float__dot" /> +1 cup added
        </span>
        <span className="onb-float onb-float--cashback">
          <span className="onb-float__euro">€</span> €3.20 cashback
        </span>
        <span className="onb-float onb-float--approved">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
          Full cashback approved
        </span>
        <span className="onb-float onb-float--receipt">🧾 Receipt saved</span>

        {/* Central app preview — a stylised slice of the real market card. */}
        <div className="onb-hero__card">
          <div className="onb-hero__brand">
            <img src={cupIcon} alt="" className="onb-hero__brand-cup" />
            <span>PackPerks</span>
          </div>
          <div className="onb-hero__cups">
            {Array.from({ length: 8 }).map((_, i) => (
              <span key={i} className={`onb-hero__cup${i < 5 ? ' is-filled' : ''}`} />
            ))}
          </div>
          <div className="onb-hero__reward">
            <span className="onb-hero__reward-thumb">🥤</span>
            <div className="onb-hero__reward-txt">
              <strong>Verse muntthee</strong>
              <span>€3.20 for 8 cups</span>
            </div>
            <span className="onb-hero__reward-badge">Reward</span>
          </div>
        </div>
      </div>

      <div className="onb-screen__body">
        <h1 className="onb-screen__title">You already buy drinks. Why not earn them back?</h1>
        <p className="onb-screen__sub">Bring your own cup at cafés and earn full cashback on selected drinks and treats.</p>
      </div>

      <div className="onb-screen__foot">
        <button type="button" className="onb-btn onb-btn--primary" onClick={onNext}>
          Show me what I can earn
        </button>
        <p className="onb-screen__hint">Takes about 20 seconds. No account needed.</p>
      </div>
    </div>
  );
}
