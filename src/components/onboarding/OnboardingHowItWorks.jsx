/* Screen 2 — how it works. Three steps on one screen as playful, colour-tinted
 * cards that alternate side (zig-zag) with large BYO illustrations, reusing the
 * existing artwork + per-step palette rather than inventing new icons. */

const STEPS = [
  {
    n: 1,
    image: '/how-it-works/byo-1.png',
    bg: 'linear-gradient(155deg, #FCEEE4 0%, #F7D6C1 100%)',
    accent: '#E07E4F',
    title: 'Bring your reusable cup',
    body: 'Bring your reusable cup and scan the QR code.',
  },
  {
    n: 2,
    image: '/how-it-works/byo-2.png',
    bg: 'linear-gradient(155deg, #EAF6EC 0%, #CFEAD5 100%)',
    accent: '#4FA167',
    title: 'Collect enough cups',
    body: 'Collect enough cups to unlock a reward.',
  },
  {
    n: 3,
    image: '/how-it-works/byo-5.png',
    bg: 'linear-gradient(155deg, #E7F6EF 0%, #CDEEDF 100%)',
    accent: '#3FA97C',
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

      <ol className="onb-how2">
        {STEPS.map((s, i) => (
          <li
            key={s.n}
            className={`onb-how2__card${i % 2 === 1 ? ' is-flip' : ''}`}
            style={{ '--card-bg': s.bg, '--card-accent': s.accent }}
          >
            <div className="onb-how2__art">
              <img src={s.image} alt="" aria-hidden="true" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
              <span className="onb-how2__num">{s.n}</span>
            </div>
            <div className="onb-how2__txt">
              <h2 className="onb-how2__title">{s.title}</h2>
              <p className="onb-how2__body">{s.body}</p>
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
