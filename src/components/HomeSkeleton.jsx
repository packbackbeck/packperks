import './HomeSkeleton.css';

/* ─────────────────────────────────────────────────────────────────────
 * HomeSkeleton — first-paint placeholder for the home screen (P-47).
 *
 * Replaces the previous bare "🥤 Loading your cups…" spinner. The
 * skeleton matches the actual home-screen layout (header chip, cup
 * progress block, featured reward card, goal section, share row) so
 * the perceived load is "your home is composing" rather than "we're
 * stuck". The shimmer is purely CSS — no JS animation cost.
 *
 * Each block uses neutral cream tones so it doesn't promise the user
 * a specific colour scheme — once the real components mount they pop
 * into place over the skeleton without a jarring colour swap. */
export default function HomeSkeleton() {
  return (
    <div className="hsk">
      {/* Header chip */}
      <div className="hsk__topbar">
        <span className="hsk__shimmer hsk__shimmer--logo" />
        <span className="hsk__shimmer hsk__shimmer--avatar" />
      </div>

      {/* Cup progress card */}
      <div className="hsk__card">
        <span className="hsk__shimmer hsk__shimmer--title" />
        <span className="hsk__shimmer hsk__shimmer--big" />
        <div className="hsk__cup-row">
          {[0, 1, 2, 3, 4, 5].map(i => (
            <span key={i} className="hsk__shimmer hsk__shimmer--cup" />
          ))}
        </div>
      </div>

      {/* Featured reward card */}
      <div className="hsk__reward">
        <span className="hsk__shimmer hsk__shimmer--reward-img" />
        <div className="hsk__reward-text">
          <span className="hsk__shimmer hsk__shimmer--line" />
          <span className="hsk__shimmer hsk__shimmer--line hsk__shimmer--line-short" />
          <span className="hsk__shimmer hsk__shimmer--btn" />
        </div>
      </div>

      {/* Goal section */}
      <div className="hsk__card hsk__card--short">
        <span className="hsk__shimmer hsk__shimmer--title" />
        <span className="hsk__shimmer hsk__shimmer--line" />
      </div>

      {/* Footer hint — softly identifies the brand without committing */}
      <p className="hsk__hint">Loading your cups…</p>
    </div>
  );
}
