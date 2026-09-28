import { useCallback, useEffect, useRef, useState } from 'react';
import { measureControls } from '../../../lib/uxKeys';
import DeviceChrome from './DeviceChrome';

/* ─────────────────────────────────────────────────────────────────────
 * The customer's screen, for real.
 *
 * Not a drawing of it and not a screenshot of it: this embeds the actual
 * customer app at `/<slug>/?uxpreview=<screen>`, which is the same
 * read-only boot Client app's iframe has always used — no auth, no
 * account, no writes, nothing tracked, no cookie banner — put on the
 * screen the heat belongs to. So the layout, the type, the icons, the
 * illustrations and the venue's own colours are not approximated; they
 * are the app.
 *
 * The phone is the phone: a 375 × 812 device viewport with the page
 * scrolling INSIDE it exactly as it scrolls on a phone. DeviceChrome
 * measures the room it has been given and scales it as one piece to fill
 * it — the app is never asked to lay out at a width it was not designed
 * for. The overlay scrolls with it, so heat drawn at a fraction of the page stays
 * on the thing it was measured against.
 *
 * `onGeometry` reports the rendered page height once the app has settled,
 * which is what the overlays size themselves against, and `onControls`
 * reports where every named control ended up — measured out of the live
 * document, in its own page pixels. That is what a tap is put back onto:
 * the control it hit, wherever it is on THIS render, rather than a
 * fraction of whatever height the page happened to be on the visit it was
 * recorded in.
 * ───────────────────────────────────────────────────────────────────── */

const DEVICE = {
  mobile: { w: 375, h: 812 },
  tablet: { w: 834, h: 1024 },
  desktop: { w: 1280, h: 800 },
};

export default function ScreenFrame({
  slug, screen, device = 'mobile', children, scrollTo = null, onGeometry, onControls, note,
}) {
  const frame = useRef(null);
  const scroller = useRef(null);
  const [pageHeight, setPageHeight] = useState(null);
  const [failed, setFailed] = useState(false);

  const dev = DEVICE[device] || DEVICE.mobile;

  /* The embedded app lays out, loads its images and settles; the page it
   * ends up being is what the overlay has to match. Re-measured for a
   * while after load rather than once, because reward images arriving
   * change the length. */
  const measure = useCallback(() => {
    const el = frame.current;
    try {
      const doc = el?.contentDocument;
      if (!doc?.body) return;
      const h = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight, dev.h);
      setPageHeight((prev) => (prev && Math.abs(prev - h) < 4 ? prev : h));
      if (onControls) {
        // The same keys the customer app wrote onto each tap (lib/uxKeys),
        // so a tap and a control cannot disagree about what they are called.
        onControls(measureControls(doc, el.contentWindow));
      }
    } catch {
      // Cross-origin would land here; this app is always same-origin.
      setFailed(true);
    }
  }, [dev.h, onControls]);

  // A different screen is a different page: forget the old one's height
  // while rendering, so the overlay is never sized against the last one.
  const key = `${slug}|${screen}|${device}`;
  const [shownKey, setShownKey] = useState(key);
  if (shownKey !== key) {
    setShownKey(key);
    setPageHeight(null);
    setFailed(false);
  }

  useEffect(() => {
    if (pageHeight != null) onGeometry?.({ pageHeight, viewportHeight: dev.h, width: dev.w });
  }, [pageHeight, dev.h, dev.w, onGeometry]);

  useEffect(() => {
    const t = [200, 600, 1200, 2400, 4000].map(ms => setTimeout(measure, ms));
    return () => t.forEach(clearTimeout);
  }, [measure, slug, screen]);

  /* Follow a replay down the page. */
  useEffect(() => {
    if (scrollTo == null || !scroller.current || !pageHeight) return;
    const max = Math.max(0, pageHeight - dev.h);
    scroller.current.scrollTo({ top: scrollTo * max, behavior: 'smooth' });
  }, [scrollTo, pageHeight, dev.h]);

  const src = slug ? `/${slug}/?uxpreview=${encodeURIComponent(screen || 'home')}` : null;

  return (
    <DeviceChrome device={device} width={dev.w} height={dev.h} screenRef={scroller}>
      {src && !failed ? (
        <iframe
          ref={frame}
          className="ufs__app"
          title="The customer app"
          src={src}
          style={{ width: dev.w, height: pageHeight || dev.h }}
          onLoad={measure}
          scrolling="no"
          tabIndex={-1}
        />
      ) : (
        <p className="ufs__note">{note || 'This venue’s app could not be loaded here.'}</p>
      )}

      {/* Overlays are laid over the WHOLE page and scroll with it. */}
      <div className="ufs__over" style={{ width: dev.w, height: pageHeight || dev.h }}>
        {children}
      </div>
    </DeviceChrome>
  );
}
