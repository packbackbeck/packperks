import { useEffect, useState } from 'react';
import { isAppPreview } from './isPreview';

/* ─────────────────────────────────────────────────────────────────────
 * The dashboard's unpublished draft, shown in the real app.
 *
 * Client app previews a Deferred Tikkie venue by embedding the wallet
 * itself (`/<slug>/?uxpreview=home`), which loads what is PUBLISHED. To
 * show the draft instead — colours, logos, which sections show and in
 * what order — the dashboard posts the draft's settings into the frame,
 * and the page renders with them laid over its own.
 *
 * Only ever in a preview (isAppPreview), only from the page that framed
 * it, only from this origin. A preview is read-only already, so the most
 * a message can do is change how that one preview looks.
 * ───────────────────────────────────────────────────────────────────── */

export const DRAFT_MESSAGE = 'ppk-draft-preview';

export function useDraftPreview() {
  const [draft, setDraft] = useState(null);
  useEffect(() => {
    if (!isAppPreview() || window.parent === window) return undefined;
    const origin = window.location.origin;
    const onMessage = (e) => {
      if (e.origin !== origin || e.source !== window.parent) return;
      const s = e.data?.type === DRAFT_MESSAGE ? e.data.settings : null;
      if (s && typeof s === 'object') setDraft(s);
    };
    window.addEventListener('message', onMessage);
    // Ask for it: the dashboard may have sent the draft before this page
    // was listening.
    window.parent.postMessage({ type: `${DRAFT_MESSAGE}:ready` }, origin);
    return () => window.removeEventListener('message', onMessage);
  }, []);
  return draft;
}
