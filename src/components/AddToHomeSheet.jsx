import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  phoneKind, isIosChrome, canPromptInstall, onInstallPromptChange, promptInstall,
} from '../lib/addToHome';
import { getInAppBrowserKind, track, EVENTS } from '../utils/analytics';
import ppLogo from '../assets/images/packperks-logo.svg';
import './AddToHomeSheet.css';

/* ─────────────────────────────────────────────────────────────────────
 * Add to Home Screen — three steps, each with a small drawing of the
 * phone's own screen, the control to tap ringed in the venue's colour.
 *
 * The hard part on an iPhone is that Share is hidden: since iOS 26 Safari
 * keeps it behind ••• next to the address bar, and Add to Home Screen sits
 * below the fold of the share sheet. On Android it is Chrome's ⋮ menu.
 * Chrome on Android may also hand us its own install dialog
 * (lib/addToHome.js); then the sheet offers it as one tap.
 *
 * Opened from the home page (a tab under the cup progress) or the account
 * page (Help), whichever the venue chose in Master Settings.
 * ───────────────────────────────────────────────────────────────────── */

const HOST = typeof window !== 'undefined' ? window.location.host.replace(/^www\./, '') : 'perks.packback.network';
const ICON = '/apple-touch-icon.png';

/* ── the drawings ──────────────────────────────────────────────────
 * Each is cropped to just the part of the screen that matters, so the
 * sheet stays short. */

const Frame = ({ children, label, h }) => (
  <svg className="a2hs-art" viewBox={`0 0 300 ${h}`} role="img" aria-label={label}>
    <rect x="0.5" y="0.5" width="299" height={h - 1} rx="14" className="a2hs-art__bg" />
    {children}
  </svg>
);

const PageLines = ({ top = 12, w = 200 }) => (
  <g className="a2hs-art__page">
    <rect x="18" y={top} width={w * 0.6} height="9" rx="4.5" />
    <rect x="18" y={top + 16} width={w} height="6" rx="3" />
    <rect x="18" y={top + 28} width={w * 0.85} height="6" rx="3" />
  </g>
);

const ShareGlyph = ({ x, y, s = 1, className = 'a2hs-art__ink' }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`} className={className} fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M-5 -1 H-7 V9 H7 V-1 H5" />
    <path d="M0 4 V-9 M-4 -5 L0 -9 L4 -5" />
  </g>
);

const PlusSquare = ({ x, y, className = 'a2hs-art__ink' }) => (
  <g transform={`translate(${x} ${y})`} className={className} fill="none" strokeWidth="1.8" strokeLinecap="round">
    <rect x="-8" y="-8" width="16" height="16" rx="4" />
    <path d="M0 -4 V4 M-4 0 H4" />
  </g>
);

function IosMenu() {
  // Safari (iOS 26+): the compact bar at the bottom, ••• opened to Share.
  return (
    <Frame h={104} label="Safari's bar at the bottom, with ••• opened and Share highlighted">
      <PageLines top={12} w={110} />
      <g className="a2hs-art__card"><rect x="150" y="8" width="134" height="56" rx="13" /></g>
      <rect x="155" y="12" width="124" height="27" rx="8" className="a2hs-hl-fill" />
      <ShareGlyph x={171} y={26} className="a2hs-hl-ink" />
      <text x="186" y="30" className="a2hs-art__t a2hs-art__t--strong a2hs-hl-text">Share</text>
      <text x="165" y="56" className="a2hs-art__t a2hs-art__t--faint">Add Bookmark</text>
      <g className="a2hs-art__glass">
        <circle cx="32" cy="84" r="14" />
        <rect x="54" y="70" width="190" height="28" rx="14" />
        <circle cx="266" cy="84" r="14" />
      </g>
      <path d="M35 78 L29 84 L35 90" className="a2hs-art__ink" fill="none" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <text x="149" y="88" textAnchor="middle" className="a2hs-art__t a2hs-art__t--url">{HOST}</text>
      <g className="a2hs-art__ink-fill">
        <circle cx="260" cy="84" r="1.8" /><circle cx="266" cy="84" r="1.8" /><circle cx="272" cy="84" r="1.8" />
      </g>
      <circle cx="266" cy="84" r="17.5" className="a2hs-hl-ring" />
    </Frame>
  );
}

function IosChromeShare() {
  // Chrome on iPhone: Share sits in the address bar at the top.
  return (
    <Frame h={58} label="Chrome's address bar on iPhone with the Share button highlighted">
      <g className="a2hs-art__glass"><rect x="14" y="11" width="272" height="36" rx="18" /></g>
      <text x="36" y="33" className="a2hs-art__t a2hs-art__t--url">{HOST}</text>
      <ShareGlyph x={262} y={30} />
      <circle cx="262" cy="29" r="17" className="a2hs-hl-ring" />
    </Frame>
  );
}

function IosViewMore() {
  // iOS 26+ share sheet: a row of round actions, the last one View More.
  const btn = (x, label, glyph, hl) => (
    <g key={label}>
      <circle cx={x} cy="34" r="22" className={hl ? 'a2hs-art__round a2hs-art__round--hl' : 'a2hs-art__round'} />
      {glyph}
      <text x={x} y="76" textAnchor="middle" className={`a2hs-art__t a2hs-art__t--small${hl ? ' a2hs-art__t--strong a2hs-hl-text' : ''}`}>{label}</text>
    </g>
  );
  const ink = { className: 'a2hs-art__ink', fill: 'none', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };
  return (
    <Frame h={90} label="The share sheet's row of actions with View More highlighted">
      {btn(45, 'Copy', <g {...ink}><rect x="38" y="26" width="11" height="14" rx="2" /><path d="M43 26 V23 H54 V35 H49" /></g>)}
      {btn(115, 'Reading List', <g {...ink}><path d="M104 29 H126 M104 35 H126 M104 41 H118" /></g>)}
      {btn(185, 'Bookmark', <g {...ink}><path d="M185 23 L188.4 30 L196 30.8 L190.3 35.8 L192 43.3 L185 39.4 L178 43.3 L179.7 35.8 L174 30.8 L181.6 30 Z" /></g>)}
      {btn(255, 'View More', <path d="M245 30 L255 40 L265 30" className="a2hs-hl-ink" fill="none" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />, true)}
      <circle cx="255" cy="34" r="26.5" className="a2hs-hl-ring" />
    </Frame>
  );
}

function IosShareList() {
  return (
    <Frame h={96} label="The share sheet list with Add to Home Screen highlighted">
      <g className="a2hs-art__card"><rect x="14" y="8" width="272" height="80" rx="13" /></g>
      <text x="30" y="28" className="a2hs-art__t a2hs-art__t--faint">Print</text>
      <line x1="26" y1="37" x2="274" y2="37" className="a2hs-art__rule" />
      <rect x="18" y="40" width="264" height="28" rx="8" className="a2hs-hl-fill" />
      <PlusSquare x={38} y={54} className="a2hs-hl-ink" />
      <text x="56" y="58" className="a2hs-art__t a2hs-art__t--strong a2hs-hl-text">Add to Home Screen</text>
      <text x="56" y="83" className="a2hs-art__t a2hs-art__t--faint">Add to Quick Note</text>
    </Frame>
  );
}

function IosAdd() {
  return (
    <Frame h={100} label="The Add to Home Screen screen with the Add button highlighted">
      <text x="20" y="25" className="a2hs-art__t a2hs-art__t--ios-blue">Cancel</text>
      <text x="150" y="25" textAnchor="middle" className="a2hs-art__t a2hs-art__t--strong">Add to Home Screen</text>
      <text x="280" y="25" textAnchor="end" className="a2hs-art__t a2hs-art__t--ios-blue a2hs-art__t--strong">Add</text>
      <rect x="246" y="8" width="42" height="25" rx="12.5" className="a2hs-hl-ring" />
      <g className="a2hs-art__card"><rect x="14" y="40" width="272" height="52" rx="13" /></g>
      <image href={ICON} x="24" y="48" width="36" height="36" style={{ clipPath: 'inset(0 round 9px)' }} />
      <text x="70" y="63" className="a2hs-art__t a2hs-art__t--strong">PackPerks</text>
      <text x="70" y="79" className="a2hs-art__t a2hs-art__t--faint">{HOST}</text>
    </Frame>
  );
}

function AndroidMenuButton() {
  return (
    <Frame h={58} label="Chrome's address bar on Android with the ⋮ menu button highlighted">
      <g className="a2hs-art__glass">
        <rect x="14" y="11" width="212" height="36" rx="18" />
        <rect x="236" y="18" width="22" height="22" rx="5" />
      </g>
      <text x="34" y="33" className="a2hs-art__t a2hs-art__t--url">{HOST}</text>
      <text x="247" y="33" textAnchor="middle" className="a2hs-art__t a2hs-art__t--tiny">1</text>
      <g className="a2hs-art__ink-fill">
        <circle cx="277" cy="22" r="2.1" /><circle cx="277" cy="29" r="2.1" /><circle cx="277" cy="36" r="2.1" />
      </g>
      <circle cx="277" cy="29" r="15" className="a2hs-hl-ring" />
    </Frame>
  );
}

function AndroidMenu() {
  return (
    <Frame h={92} label="Chrome's menu with Add to Home screen highlighted">
      <PageLines top={12} w={70} />
      <g className="a2hs-art__card"><rect x="96" y="6" width="190" height="80" rx="12" /></g>
      <text x="112" y="26" className="a2hs-art__t a2hs-art__t--faint">New tab</text>
      <text x="112" y="47" className="a2hs-art__t a2hs-art__t--faint">History</text>
      <rect x="100" y="54" width="182" height="28" rx="8" className="a2hs-hl-fill" />
      <g transform="translate(116 68)" className="a2hs-hl-ink" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="-5" y="-8" width="10" height="16" rx="2" /><path d="M8 -2 L8 4 M5 1 L11 1" />
      </g>
      <text x="132" y="73" className="a2hs-art__t a2hs-art__t--strong a2hs-hl-text">Add to Home screen</text>
    </Frame>
  );
}

function AndroidInstall() {
  return (
    <Frame h={96} label="The install dialog with the Install button highlighted">
      <g className="a2hs-art__card"><rect x="34" y="8" width="232" height="80" rx="16" /></g>
      <image href={ICON} x="50" y="18" width="30" height="30" style={{ clipPath: 'inset(0 round 15px)' }} />
      <text x="90" y="31" className="a2hs-art__t a2hs-art__t--strong">PackPerks</text>
      <text x="90" y="45" className="a2hs-art__t a2hs-art__t--faint">{HOST}</text>
      <text x="166" y="74" textAnchor="middle" className="a2hs-art__t a2hs-art__t--md-blue">Cancel</text>
      <text x="228" y="74" textAnchor="middle" className="a2hs-art__t a2hs-art__t--md-blue a2hs-art__t--strong">Install</text>
      <rect x="200" y="57" width="56" height="25" rx="12.5" className="a2hs-hl-ring" />
    </Frame>
  );
}

/* ── the steps ──────────────────────────────────────────────────────
 * Only the visitor's own phone: Android gets Chrome's steps, everything
 * else (iPhone, iPad, and a laptop opening the preview) the iPhone ones.
 * Since iOS 26 the share sheet keeps Add to Home Screen behind View More. */

function stepsFor(kind) {
  if (kind === 'android') {
    return [
      { art: <AndroidMenuButton />, title: <>Tap <b>⋮</b> at the top right</> },
      { art: <AndroidMenu />, title: <>Tap <b>Add to Home screen</b></>, note: 'Some phones say Install app.' },
      { art: <AndroidInstall />, title: <>Tap <b>Install</b></> },
    ];
  }
  return [
    isIosChrome()
      ? { art: <IosChromeShare />, title: <>Tap <b>Share</b> in the address bar</> }
      : { art: <IosMenu />, title: <>Tap <b>•••</b>, then <b>Share</b></>, note: 'No ••• at the bottom? Tap the Share button.' },
    { art: <IosViewMore />, title: <>Tap <b>View More</b></> },
    { art: <IosShareList />, title: <>Scroll down, tap <b>Add to Home Screen</b></> },
    { art: <IosAdd />, title: <>Tap <b>Add</b></> },
  ];
}

export default function AddToHomeSheet({ onClose }) {
  const detected = phoneKind();
  const kind = detected === 'android' ? 'android' : 'ios';
  const [canInstall, setCanInstall] = useState(canPromptInstall);
  const inApp = getInAppBrowserKind();

  useEffect(() => onInstallPromptChange(() => setCanInstall(canPromptInstall())), []);

  useEffect(() => {
    track(EVENTS.ADD_TO_HOME_OPENED, { platform: detected });
    function onKey(e) { if (e.key === 'Escape') onClose?.(); }
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose, detected]);

  async function install() {
    const outcome = await promptInstall();
    if (outcome === 'accepted') {
      track(EVENTS.ADD_TO_HOME_INSTALLED, { platform: 'android' });
      onClose?.();
    }
  }

  const steps = stepsFor(kind);
  const oneTap = kind === 'android' && canInstall;

  return createPortal(
    <div className="a2hs-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="a2hs-title">
      <div className="a2hs-sheet" onClick={(e) => e.stopPropagation()}>
        <header className="a2hs-head">
          <img src={ppLogo} alt="PackPerks" className="a2hs-head__logo" />
          <button type="button" className="a2hs-close" onClick={onClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </header>
        <h2 className="a2hs-title" id="a2hs-title">Add to your Home Screen</h2>

        <div className="a2hs-body">
          {inApp && (
            <p className="a2hs-inapp">
              {inApp === 'ios'
                ? <>First open this page in <b>Safari</b>: tap <b>•••</b> or the share button, then <b>Open in Safari</b>.</>
                : <>First open this page in <b>Chrome</b>: tap <b>⋮</b>, then <b>Open in Chrome</b>.</>}
            </p>
          )}
          <ol className="a2hs-steps">
            {steps.map((s, i) => (
              <li key={i} className="a2hs-step" style={{ animationDelay: `${i * 60}ms` }}>
                <div className="a2hs-step__head">
                  <span className="a2hs-step__n">{i + 1}</span>
                  <span className="a2hs-step__title">{s.title}</span>
                </div>
                {s.art}
                {s.note && <p className="a2hs-step__note">{s.note}</p>}
              </li>
            ))}
          </ol>
        </div>

        <div className="a2hs-actions">
          {oneTap && (
            <button type="button" className="a2hs-btn a2hs-btn--primary" onClick={install} data-ppk="a2hs-install">
              Add to Home Screen
            </button>
          )}
          <button
            type="button"
            className={`a2hs-btn ${oneTap ? 'a2hs-btn--secondary' : 'a2hs-btn--primary'}`}
            onClick={onClose}
            data-ppk="a2hs-done"
          >
            Got it
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
