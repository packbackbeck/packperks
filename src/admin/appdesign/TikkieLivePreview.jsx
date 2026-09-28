import { useCallback, useEffect, useRef } from 'react';
import DeviceChrome from '../behaviour/userflow/DeviceChrome';
import { DRAFT_MESSAGE } from '../../lib/draftPreview';

/* ─────────────────────────────────────────────────────────────────────
 * A Deferred Tikkie venue's app, with the draft on it.
 *
 * The hand-built phone next to the other modes draws the rewards app,
 * which this venue does not run. This is the wallet itself —
 * `/<slug>/?uxpreview=home`, the same read-only boot the heatmap uses, on
 * its sample wallet — with the draft's settings posted into it
 * (lib/draftPreview), so colours, logos, hidden sections and the order
 * all show before anything is published.
 *
 * It scrolls and it can be tapped: a preview writes nothing, opens no
 * camera and records nothing.
 * ───────────────────────────────────────────────────────────────────── */

export default function TikkieLivePreview({ slug, settings }) {
  const frame = useRef(null);
  const latest = useRef(settings);

  const send = useCallback(() => {
    const win = frame.current?.contentWindow;
    if (!win) return;
    try {
      // A plain copy: the draft is JSON already, and postMessage refuses
      // anything that is not cloneable.
      win.postMessage({ type: DRAFT_MESSAGE, settings: JSON.parse(JSON.stringify(latest.current || {})) }, window.location.origin);
    } catch { /* the frame is between pages */ }
  }, []);

  useEffect(() => {
    latest.current = settings;
    send();
  }, [settings, send]);

  /* The page asks once it is listening; answer with the draft. */
  useEffect(() => {
    const onMessage = (e) => {
      if (e.origin !== window.location.origin || e.source !== frame.current?.contentWindow) return;
      if (e.data?.type === `${DRAFT_MESSAGE}:ready`) send();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [send]);

  if (!slug) {
    return <p className="dz-tkp__note">This venue has no address yet, so there is nothing to preview.</p>;
  }
  return (
    <div className="dz-tkp">
      <DeviceChrome device="mobile" width={375} height={812}>
        <iframe
          ref={frame}
          className="dz-tkp__app"
          title="Preview of the customer app"
          src={`/${slug}/?uxpreview=home`}
          onLoad={send}
        />
      </DeviceChrome>
    </div>
  );
}
