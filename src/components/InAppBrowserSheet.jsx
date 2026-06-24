import './InAppBrowserSheet.css';

/* ─────────────────────────────────────────────────────────────────────
 * InAppBrowserSheet — shown only when an Android in-app browser (e.g. the
 * webview inside Instagram / Facebook / Telegram) opens a cup deeplink.
 *
 * In-app webviews don't share storage with the real browser, so a cup
 * claimed here strands in a throwaway account. We hold the claim and offer
 * to reopen the (still-unclaimed) link in the phone's default browser,
 * where it claims onto the user's real account. "Collect here anyway" is
 * always available, so the cup is never lost and a mis-detected normal
 * browser is never blocked. Deliberately not dismissible — both choices
 * resolve the cup.
 * ───────────────────────────────────────────────────────────────────── */

export default function InAppBrowserSheet({ open, redirecting, onOpenDefaultBrowser, onCollectHere }) {
  if (!open) return null;

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
            <h2 className="iab-sheet__title" id="iab-title">Open in your browser</h2>
            <p className="iab-sheet__body">
              You opened this inside an app's built-in browser. Open it in your
              default browser so your cup is saved to your phone — not lost when
              this window closes.
            </p>
            <button type="button" className="iab-sheet__cta" onClick={onOpenDefaultBrowser}>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
              </svg>
              Open in default browser
            </button>
            <button type="button" className="iab-sheet__secondary" onClick={onCollectHere}>
              Collect here anyway
            </button>
            <p className="iab-sheet__reassure">Your cup is safe either way.</p>
          </>
        ) : (
          <>
            <h2 className="iab-sheet__title" id="iab-title">Opening your browser…</h2>
            <p className="iab-sheet__body">
              We asked your phone to open this in your default browser. Nothing
              happened? You can still collect your cup right here.
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
