import './InAppBrowserSheet.css';

/* ─────────────────────────────────────────────────────────────────────
 * InAppBrowserSheet — shown when an in-app browser (the webview inside
 * Instagram / Facebook / Telegram, etc.) opens a cup deeplink.
 *
 * In-app webviews don't share storage with the real browser, so a cup
 * claimed here strands in a throwaway account. We hold the claim and:
 *   • Android — offer a one-tap "Open in default browser" (an intent URL
 *     that reliably escapes the webview, carrying the unclaimed cup).
 *   • iOS — we can't force Safari, so we best-effort the open and, more
 *     importantly, guide the user to tap ••• → "Open in Safari".
 *
 * "Collect here anyway" is always present, so the cup is never lost and a
 * mis-detected normal browser is never blocked. Not casually dismissible —
 * both choices resolve the cup.
 * ───────────────────────────────────────────────────────────────────── */

export default function InAppBrowserSheet({ open, platform, redirecting, onOpenDefaultBrowser, onCollectHere }) {
  if (!open) return null;
  const isIos = platform === 'ios';

  return (
    <div className="iab-overlay" role="dialog" aria-modal="true" aria-labelledby="iab-title">
      <div className="iab-sheet">
        <div className="iab-sheet__grip" aria-hidden="true" />
        <div className="iab-sheet__icon">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="16" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><path d="M7 13h6M7 16h8" />
          </svg>
        </div>

        {!redirecting ? (
          <>
            <h2 className="iab-sheet__title" id="iab-title">
              {isIos ? 'Open in Safari to keep your cup' : 'Open in your browser'}
            </h2>
            <p className="iab-sheet__body">
              {isIos ? (
                <>You opened this inside an app's built-in browser, so this cup won't carry over to your normal browser. To keep it, tap the <strong>•••</strong> (or share) button and choose <strong>“Open in Safari”</strong>, or collect it here for now.</>
              ) : (
                <>You opened this inside an app's built-in browser. Open it in your default browser so your cup is saved to your phone, not lost when this window closes.</>
              )}
            </p>
            <button type="button" className="iab-sheet__cta" onClick={onOpenDefaultBrowser}>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
              </svg>
              {isIos ? 'Open in Safari' : 'Open in default browser'}
            </button>
            <button type="button" className="iab-sheet__secondary" onClick={onCollectHere}>
              Collect here anyway
            </button>
            <p className="iab-sheet__reassure">Your cup is safe either way.</p>
          </>
        ) : (
          <>
            <h2 className="iab-sheet__title" id="iab-title">
              {isIos ? 'Opening Safari…' : 'Opening your browser…'}
            </h2>
            <p className="iab-sheet__body">
              {isIos ? (
                <>If Safari didn't open, tap the <strong>•••</strong> (or share) button and choose <strong>“Open in Safari”</strong>, or collect your cup right here.</>
              ) : (
                <>We asked your phone to open this in your default browser. Nothing happened? You can still collect your cup right here.</>
              )}
            </p>
            <button type="button" className="iab-sheet__cta iab-sheet__cta--alt" onClick={onCollectHere}>
              Collect here anyway
            </button>
          </>
        )}
      </div>
    </div>
  );
}
