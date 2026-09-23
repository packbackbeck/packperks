import { useCallback, useEffect, useRef, useState } from 'react';
import { BatteryFull, Signal, Wifi } from 'lucide-react';

/* ─────────────────────────────────────────────────────────────────────
 * The customer's screen, for real.
 *
 * Not a drawing of it and not a screenshot of it: this embeds the actual
 * customer app at `/<slug>/?uxpreview=<screen>`, which is the same
 * read-only boot Design & copy's iframe has always used — no auth, no
 * account, no writes, nothing tracked, no cookie banner — put on the
 * screen the heat belongs to. So the layout, the type, the icons, the
 * illustrations and the venue's own colours are not approximated; they
 * are the app.
 *
 * The phone is the phone: a 375 × 812 device viewport with the page
 * scrolling INSIDE it exactly as it scrolls on a phone. It measures the
 * room it has been given and scales itself as one piece to fill it — the
 * app is never asked to lay out at a width it was not designed for. The
 * overlay scrolls with it, so heat drawn at a fraction of the page stays
 * on the thing it was measured against.
 *
 * `onGeometry` reports the rendered page height once the app has settled,
 * which is what the overlays size themselves against.
 * ───────────────────────────────────────────────────────────────────── */

const DEVICE = {
  mobile: { w: 375, h: 812 },
  tablet: { w: 834, h: 1024 },
  desktop: { w: 1280, h: 800 },
};

export default function ScreenFrame({
  slug, screen, device = 'mobile', children, scrollTo = null, onGeometry, note,
}) {
  const box = useRef(null);
  const frame = useRef(null);
  const scroller = useRef(null);
  const [pageHeight, setPageHeight] = useState(null);
  const [failed, setFailed] = useState(false);
  const [room, setRoom] = useState(null);

  const dev = DEVICE[device] || DEVICE.mobile;
  // As big as the room allows, never bigger than life size. A box that has
  // not been laid out yet, or has collapsed to nothing, is not a room:
  // scaling to it produced a device a few hundred pixels tall that hung
  // out of its card, so it is ignored until it is real.
  const usable = room && room.h > 120 && room.w > 120 ? room : null;
  const scale = usable
    ? Math.max(0.25, Math.min(1, Math.min(usable.h / dev.h, usable.w / dev.w)))
    : 0.7;

  /* The room is whatever the card gives us, so the phone grows with the
   * window instead of being sized by a number someone guessed. */
  useEffect(() => {
    const el = box.current?.parentElement;
    if (!el) return undefined;
    const read = () => {
      const r = el.getBoundingClientRect();
      setRoom(prev => (prev && Math.abs(prev.h - r.height) < 2 && Math.abs(prev.w - r.width) < 2
        ? prev
        : { w: r.width, h: r.height }));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
    } catch {
      // Cross-origin would land here; this app is always same-origin.
      setFailed(true);
    }
  }, [dev.h]);

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
    if (pageHeight != null) onGeometry?.({ pageHeight, viewportHeight: dev.h, width: dev.w, scale });
  }, [pageHeight, dev.h, dev.w, scale, onGeometry]);

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
  const phone = device === 'mobile';

  return (
    <div
      ref={box}
      className={`ufs ufs--${device}`}
      style={{ width: dev.w * scale, height: dev.h * scale }}
    >
      <div
        className="ufs__device"
        style={{ width: dev.w, height: dev.h, transform: `scale(${scale})` }}
      >
        <div className="ufs__bezel">
          <div className="ufs__screen" ref={scroller}>
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
          </div>

          {phone && (
            <>
              <div className="ufs__status">
                <span className="ufs__time">9:41</span>
                <span className="ufs__island" />
                <span className="ufs__icons">
                  <Signal size={13} strokeWidth={2.6} aria-hidden="true" />
                  <Wifi size={13} strokeWidth={2.6} aria-hidden="true" />
                  <BatteryFull size={17} strokeWidth={2} aria-hidden="true" />
                </span>
              </div>
              <span className="ufs__homebar" />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
