import { forwardRef } from 'react';

/* ─────────────────────────────────────────────────────────────────────
 * PhoneFrame — a fully vector (CSS + SVG) iPhone shell around the mockup
 * screen. `framed` toggles between the phone shell and a plain rounded
 * card. The forwarded ref is the node captured for PNG export, so the
 * exported image includes the bezel + status bar when framed.
 * ───────────────────────────────────────────────────────────────────── */

function StatusBar() {
  return (
    <div className="mockup-phone__status" aria-hidden="true">
      <span className="mockup-phone__time">9:41</span>
      <span className="mockup-phone__status-right">
        {/* signal */}
        <svg width="17" height="11" viewBox="0 0 17 11" fill="currentColor" aria-hidden="true">
          <rect x="0" y="7" width="3" height="4" rx="1" />
          <rect x="4.5" y="5" width="3" height="6" rx="1" />
          <rect x="9" y="2.5" width="3" height="8.5" rx="1" />
          <rect x="13.5" y="0" width="3" height="11" rx="1" />
        </svg>
        {/* wifi */}
        <svg width="16" height="11" viewBox="0 0 16 12" fill="currentColor" aria-hidden="true">
          <path d="M8 2.2c2.6 0 5 1 6.8 2.7l-1.4 1.5A7.5 7.5 0 0 0 8 4.3 7.5 7.5 0 0 0 2.6 6.4L1.2 4.9A9.6 9.6 0 0 1 8 2.2Z" />
          <path d="M8 6c1.5 0 2.9.6 3.9 1.6l-1.5 1.5A3.4 3.4 0 0 0 8 8.1c-.9 0-1.8.4-2.4 1L4.1 7.6A5.5 5.5 0 0 1 8 6Z" />
          <circle cx="8" cy="10.4" r="1.4" />
        </svg>
        {/* battery */}
        <svg width="26" height="12" viewBox="0 0 26 12" fill="none" aria-hidden="true">
          <rect x="0.5" y="0.9" width="21" height="10" rx="2.6" stroke="currentColor" opacity="0.4" />
          <rect x="2" y="2.4" width="16" height="7" rx="1.4" fill="currentColor" />
          <rect x="23" y="4" width="1.8" height="4" rx="0.9" fill="currentColor" opacity="0.5" />
        </svg>
      </span>
    </div>
  );
}

const PhoneFrame = forwardRef(function PhoneFrame({ framed, children, bg }, ref) {
  if (!framed) {
    return (
      <div className="mockup-plain" ref={ref} style={bg ? { background: bg } : undefined}>
        {children}
      </div>
    );
  }
  return (
    <div className="mockup-phone" ref={ref}>
      <div className="mockup-phone__frame">
        {/* Titanium side buttons */}
        <span className="mockup-phone__btn mockup-phone__btn--silent" aria-hidden="true" />
        <span className="mockup-phone__btn mockup-phone__btn--volup" aria-hidden="true" />
        <span className="mockup-phone__btn mockup-phone__btn--voldown" aria-hidden="true" />
        <span className="mockup-phone__btn mockup-phone__btn--power" aria-hidden="true" />
        <div className="mockup-phone__screen" style={bg ? { background: bg } : undefined}>
          <div className="mockup-phone__notch" aria-hidden="true" />
          <StatusBar />
          <div className="mockup-phone__content">{children}</div>
          <div className="mockup-phone__homebar" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
});

export default PhoneFrame;
