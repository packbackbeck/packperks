import dashboardShot from '../../../assets/images/login/dashboard.webp';
import phoneShot from '../../../assets/images/login/phone.webp';

/* The product on the sign-in panel: the admin dashboard in a browser window,
 * with the customer app on a phone in front of it. Both are screenshots of
 * the dev build showing demo numbers only, no real customer data. The
 * dashboard shot is 1600×1376 CSS px at 2x, cut in the gap below the second
 * row of cards; the phone shot is the venue home at 390×844, 2x.
 *
 * The panel is hidden below 1024px. There the <source> swaps in a 1×1 GIF so
 * phones never download the screenshots. */

const BELOW_LG = '(max-width: 1023.98px)';
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

export default function ProductShowcase() {
  return (
    <div className="pp-showcase">
      <div className="pp-showcase__browser">
        <div className="pp-showcase__bar">
          <span className="pp-showcase__dot" />
          <span className="pp-showcase__dot" />
          <span className="pp-showcase__dot" />
          <span className="pp-showcase__url">perks.packback.network/admin</span>
        </div>
        <picture>
          <source media={BELOW_LG} srcSet={BLANK} />
          <img
            className="pp-showcase__shot"
            src={dashboardShot}
            alt=""
            width="2240"
            height="1926"
            decoding="async"
            draggable="false"
          />
        </picture>
      </div>

      <div className="pp-showcase__phone">
        <div className="pp-showcase__device">
          <div className="pp-showcase__screen">
            <div className="pp-showcase__status">
              <span className="pp-showcase__time">9:41</span>
              <span className="pp-showcase__island" />
              <span className="pp-showcase__sys">
                <SignalGlyph />
                <WifiGlyph />
                <BatteryGlyph />
              </span>
            </div>
            <picture>
              <source media={BELOW_LG} srcSet={BLANK} />
              <img
                className="pp-showcase__app"
                src={phoneShot}
                alt=""
                width="780"
                height="1688"
                decoding="async"
                draggable="false"
              />
            </picture>
          </div>
        </div>
      </div>
    </div>
  );
}

function SignalGlyph() {
  return (
    <svg viewBox="0 0 18 12" aria-hidden="true" focusable="false">
      <rect x="0" y="8" width="3" height="4" rx="1" />
      <rect x="5" y="5.5" width="3" height="6.5" rx="1" />
      <rect x="10" y="3" width="3" height="9" rx="1" />
      <rect x="15" y="0" width="3" height="12" rx="1" />
    </svg>
  );
}

function WifiGlyph() {
  return (
    <svg viewBox="0 0 16 12" aria-hidden="true" focusable="false">
      <path d="M8 2.2c2.3 0 4.4.9 6 2.4l1.2-1.3A10.4 10.4 0 0 0 8 .4C5.2.4 2.7 1.5.8 3.3L2 4.6a8.6 8.6 0 0 1 6-2.4Z" />
      <path d="M8 5.8c1.3 0 2.5.5 3.4 1.3l1.2-1.3A6.8 6.8 0 0 0 8 4c-1.8 0-3.4.7-4.6 1.8l1.2 1.3c.9-.8 2.1-1.3 3.4-1.3Z" />
      <path d="M8 9.3c.4 0 .8.2 1.1.4L8 11.6 6.9 9.7c.3-.2.7-.4 1.1-.4Z" />
    </svg>
  );
}

function BatteryGlyph() {
  return (
    <svg viewBox="0 0 27 13" aria-hidden="true" focusable="false">
      <rect x="0.5" y="0.5" width="22" height="12" rx="3.6" fill="none" stroke="currentColor" opacity="0.4" />
      <rect x="2" y="2" width="19" height="9" rx="2.2" />
      <path d="M24.5 4.5v4c.8-.3 1.4-1.1 1.4-2s-.6-1.7-1.4-2Z" opacity="0.45" />
    </svg>
  );
}
