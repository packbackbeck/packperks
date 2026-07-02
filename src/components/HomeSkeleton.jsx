import './HomeSkeleton.css';

/* ─────────────────────────────────────────────────────────────────────
 * HomeSkeleton — first-paint placeholder for the home screen.
 *
 * Mirrors the ACTUAL home layout — header lockup + cup tiles, big two-line
 * headline, subtext, the cup-progress bar, and the large featured-reward
 * card — so the perceived load reads as "your home is composing" rather
 * than a generic spinner.
 *
 * Colours: it sits on the app's own cream background and uses a soft,
 * neutral shimmer (translucent black over the cream) so it never promises
 * a specific palette and the real components pop cleanly into place. */
export default function HomeSkeleton() {
  return (
    <div className="hsk">
      {/* Header — brand lockup + the three round tiles */}
      <div className="hsk__topbar">
        <span className="hsk__shimmer hsk__shimmer--logo" />
        <div className="hsk__tiles">
          <span className="hsk__shimmer hsk__shimmer--tile" />
          <span className="hsk__shimmer hsk__shimmer--tile" />
          <span className="hsk__shimmer hsk__shimmer--tile" />
        </div>
      </div>

      {/* Hero headline + subtext */}
      <div className="hsk__hero">
        <span className="hsk__shimmer hsk__shimmer--h1" />
        <span className="hsk__shimmer hsk__shimmer--h1 hsk__shimmer--h1-short" />
        <span className="hsk__shimmer hsk__shimmer--sub" />
      </div>

      {/* Cup-progress bar */}
      <span className="hsk__shimmer hsk__shimmer--progress" />

      {/* Featured reward card */}
      <span className="hsk__shimmer hsk__shimmer--reward-card" />

      <p className="hsk__hint">Loading your cups…</p>
    </div>
  );
}
