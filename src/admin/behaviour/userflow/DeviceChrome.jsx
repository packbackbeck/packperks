import { useEffect, useRef, useState } from 'react';
import { BatteryFull, Signal, Wifi } from 'lucide-react';
import './DeviceChrome.css';

/* ─────────────────────────────────────────────────────────────────────
 * A device, drawn around a screen of an exact size.
 *
 * The heatmap's embedded app and a replayed recording both sit in one of
 * these, so they share one rule for how big the phone is: it measures the
 * room its parent gives it and scales as one piece to fit, never past life
 * size. The parent must have a definite height (see the Heatmap notes in
 * CLAUDE.md): the device is placed absolutely, so its size is decided BY
 * that box and never feeds back into it.
 *
 * The bezel is added AROUND the screen, never taken out of it. It used to
 * be padding inside a 375px box, which left a 351px screen showing a 375px
 * app, and the right 24px of every screen was cut off.
 * ───────────────────────────────────────────────────────────────────── */

const BEZEL = { mobile: 12, tablet: 10, desktop: 10 };

export default function DeviceChrome({
  device = 'mobile', width, height, furniture = true, screenRef, screenClassName = '', children,
}) {
  const box = useRef(null);
  const [room, setRoom] = useState(null);

  const bezel = BEZEL[device] ?? BEZEL.mobile;
  const outer = { w: width + bezel * 2, h: height + bezel * 2 };
  // A box that has not been laid out yet, or has collapsed to nothing, is
  // not a room: scaling to it produced a device a few hundred pixels tall
  // that hung out of its card, so it is ignored until it is real.
  const usable = room && room.h > 120 && room.w > 120 ? room : null;
  const scale = usable
    ? Math.max(0.2, Math.min(1, usable.h / outer.h, usable.w / outer.w))
    : 0.7;

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

  const phone = device === 'mobile';

  return (
    <div
      ref={box}
      className={`ufs ufs--${device}${furniture ? '' : ' ufs--bare'}`}
      style={{ width: outer.w * scale, height: outer.h * scale }}
    >
      <div
        className="ufs__device"
        style={{ width: outer.w, height: outer.h, transform: `scale(${scale})` }}
      >
        <div className="ufs__bezel" style={{ padding: bezel }}>
          <div className={`ufs__screen ${screenClassName}`} ref={screenRef}>
            {children}
          </div>

          {phone && furniture && (
            <>
              <div className="ufs__status" style={{ top: bezel, left: bezel, right: bezel }}>
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
