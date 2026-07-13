/* Screen 2 — how it works. Three steps on one screen, reusing the existing BYO
 * how-it-works illustrations (public/how-it-works/byo-*.png) so the visual
 * language matches the rest of the app rather than inventing new icons. The
 * flow reads top → bottom, connected by a vertical rail. */

const STEPS = [
  {
    n: 1,
    image: '/how-it-works/byo-1.png',
    bg: 'linear-gradient(165deg, #FBEDE4 0%, #F6D8C6 100%)',
    title: 'Bring your reusable cup',
    body: 'Bring your reusable cup and scan the QR code.',
  },
  {
    n: 2,
    image: '/how-it-works/byo-2.png',
    bg: 'linear-gradient(165deg, #EAF6EC 0%, #D6ECD9 100%)',
    title: 'Collect enough cups',
    body: 'Collect enough cups to unlock a reward.',
  },
  {
    n: 3,
    image: '/how-it-works/byo-5.png',
    bg: 'linear-gradient(165deg, #EAF7EF 0%, #D8F0E4 100%)',
    title: 'Buy it and get cashback',
    body: 'Buy the rewarded item and get full cashback.',
  },
];

export default function OnboardingHowItWorks({ onNext }) {
  return (
    <div className="onb-screen onb-how">
      <div className="onb-screen__body">
        <h1 className="onb-screen__title">How you earn it</h1>
      </div>

      <ol className="onb-how__steps">
        {STEPS.map((s) => (
          <li key={s.n} className="onb-how__step">
            <div className="onb-how__thumb" style={{ background: s.bg }}>
              <img src={s.image} alt="" aria-hidden="true" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
              <span className="onb-how__num">{s.n}</span>
            </div>
            <div className="onb-how__txt">
              <h2 className="onb-how__step-title">{s.title}</h2>
              <p className="onb-how__step-body">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="onb-screen__foot">
        <button type="button" className="onb-btn onb-btn--primary" onClick={onNext}>
          Personalise my rewards
        </button>
      </div>
    </div>
  );
}
