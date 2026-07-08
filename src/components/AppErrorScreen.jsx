import { useState } from 'react';
import './AppErrorScreen.css';

/* ─────────────────────────────────────────────────────────────────────
 * AppErrorScreen — friendly first-run error screen.
 *
 * Shown by App.jsx when the initial Supabase bootstrap fails — e.g. on
 * a brand-new database that's missing the schema, when the project is
 * paused, or when the user's network is flaky on a fresh device.
 *
 * The old version was a developer message ("Database not set up yet,
 * run the SQL migration in your Supabase project, then reload"). That
 * leaked product internals at customers and was demoralising at the
 * exact moment we want to look polished.
 *
 * The new screen reads like something a real consumer product would
 * show: a calm headline, a single primary action (Retry), and an
 * optional collapsed "Details" disclosure for an admin / engineer
 * watching over the user's shoulder. */
export default function AppErrorScreen({ error }) {
  const [showDetails, setShowDetails] = useState(false);
  // We try to detect the most common variants and tailor the copy.
  // Anything that doesn't match falls through to a generic message.
  const detail = typeof error === 'string' ? error : (error?.message || '');
  const isMissingTable    = /relation .* does not exist|table.*not.*found|column.*does not exist/i.test(detail);
  const isNetwork         = /fetch|network|failed to fetch|connection/i.test(detail);
  const isPaused          = /paused|inactive|project is paused/i.test(detail);

  let headline = "We're having trouble loading your cups";
  let body = "Something on our end is taking longer than expected. Give it a moment and try again — your balance is safe.";
  if (isMissingTable) {
    headline = "We're getting things ready";
    body = "PackPerks is being set up for the first time on this device. Please check back in a few minutes.";
  } else if (isPaused) {
    headline = "PackPerks is taking a quick break";
    body = "Our service is temporarily idle. It should be back online shortly — thanks for your patience.";
  } else if (isNetwork) {
    headline = "Can't reach the PackPerks service";
    body = "Looks like a network hiccup. Check your connection and tap retry below.";
  }

  return (
    <div className="app-err">
      <div className="app-err__card">
        <div className="app-err__art" aria-hidden>
          <span className="app-err__art-ring app-err__art-ring--1" />
          <span className="app-err__art-ring app-err__art-ring--2" />
          <span className="app-err__art-glyph">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8h1a4 4 0 0 1 0 8h-1" />
              <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" />
              <line x1="6" y1="1" x2="6" y2="4" />
              <line x1="10" y1="1" x2="10" y2="4" />
              <line x1="14" y1="1" x2="14" y2="4" />
            </svg>
          </span>
        </div>

        <h1 className="app-err__title">{headline}</h1>
        <p className="app-err__body">{body}</p>

        <button
          type="button"
          className="app-err__retry"
          onClick={() => window.location.reload()}
        >
          Try again
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </button>

        <a className="app-err__support" href="mailto:info@packback.network?subject=PackPerks%20-%20can't%20load%20app">
          Still stuck? Email support
        </a>

        {/* Hidden technical details — useful when an engineer is
         *  helping a customer over the shoulder. Disclosure stays
         *  collapsed by default so consumers don't see noise. */}
        {detail && (
          <div className="app-err__details">
            <button
              type="button"
              className="app-err__details-toggle"
              onClick={() => setShowDetails(s => !s)}
              aria-expanded={showDetails}
            >
              {showDetails ? 'Hide details' : 'Show details'}
            </button>
            {showDetails && (
              <pre className="app-err__details-pre">{detail}</pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
