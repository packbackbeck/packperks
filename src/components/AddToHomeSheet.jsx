import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  phoneKind, isIosChrome, canPromptInstall, onInstallPromptChange, promptInstall,
} from '../lib/addToHome';
import { getInAppBrowserKind, track, EVENTS } from '../utils/analytics';
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

/* ── the drawings ─────────────────────────────────────────────────── */

const Frame = ({ children, label }) => (
  <svg className="a2hs-art" viewBox="0 0 300 150" role="img" aria-label={label}>
    <rect x="0.5" y="0.5" width="299" height="149" rx="16" className="a2hs-art__bg" />
    {children}
  </svg>
);

// faint page content behind a browser bar
const PageLines = ({ top = 18 }) => (
  <g className="a2hs-art__page">
    <rect x="20" y={top} width="120" height="10" rx="5" />
    <rect x="20" y={top + 18} width="200" height="7" rx="3.5" />
    <rect x="20" y={top + 32} width="170" height="7" rx="3.5" />
  </g>
);

const ShareGlyph = ({ x, y, s = 1, className = 'a2hs-art__ink' }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`} className={className} fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M-5 -1 H-7 V9 H7 V-1 H5" />
    <path d="M0 4 V-9 M-4 -5 L0 -9 L4 -5" />
  </g>
);

const PlusSquare = ({ x, y }) => (
  <g transform={`translate(${x} ${y})`} className="a2hs-art__ink" fill="none" strokeWidth="1.8" strokeLinecap="round">
    <rect x="-8" y="-8" width="16" height="16" rx="4" />
    <path d="M0 -4 V4 M-4 0 H4" />
  </g>
);

function IosMenu() {
  // Safari (iOS 26+): the compact bar at the bottom, ••• opened to Share.
  return (
    <Frame label="Safari's bar at the bottom of the screen, with the ••• button opened and Share highlighted">
      <PageLines top={16} />
      <g className="a2hs-art__card">
        <rect x="150" y="18" width="132" height="76" rx="14" />
      </g>
      <rect x="156" y="24" width="120" height="30" rx="9" className="a2hs-hl-fill" />
      <ShareGlyph x={172} y={40} className="a2hs-hl-ink" />
      <text x="186" y="44" className="a2hs-art__t a2hs-art__t--strong a2hs-hl-text">Share</text>
      <line x1="162" y1="60" x2="276" y2="60" className="a2hs-art__rule" />
      <text x="166" y="80" className="a2hs-art__t">Add Bookmark</text>
      {/* the bar */}
      <g className="a2hs-art__glass">
        <circle cx="34" cy="122" r="17" />
        <rect x="58" y="105" width="190" height="34" rx="17" />
        <circle cx="266" cy="122" r="17" />
      </g>
      <path d="M37 115 L30 122 L37 129" className="a2hs-art__ink" fill="none" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <text x="153" y="126" textAnchor="middle" className="a2hs-art__t a2hs-art__t--url">{HOST}</text>
      <g className="a2hs-art__ink-fill">
        <circle cx="259" cy="122" r="2" /><circle cx="266" cy="122" r="2" /><circle cx="273" cy="122" r="2" />
      </g>
      <circle cx="266" cy="122" r="21" className="a2hs-hl-ring" />
    </Frame>
  );
}

function IosChromeShare() {
  // Chrome on iPhone: Share sits in the address bar at the top.
  return (
    <Frame label="Chrome's address bar on iPhone with the Share button highlighted">
      <g className="a2hs-art__glass">
        <rect x="16" y="16" width="268" height="36" rx="18" />
      </g>
      <text x="40" y="39" className="a2hs-art__t a2hs-art__t--url">{HOST}</text>
      <ShareGlyph x={260} y={35} />
      <circle cx="260" cy="34" r="19" className="a2hs-hl-ring" />
      <PageLines top={74} />
    </Frame>
  );
}

function IosShareSheet() {
  return (
    <Frame label="The share sheet list, with Add to Home Screen highlighted">
      <g className="a2hs-art__apps">
        {[34, 78, 122, 166].map(x => <rect key={x} x={x - 16} y="12" width="32" height="32" rx="9" />)}
      </g>
      <g className="a2hs-art__card">
        <rect x="14" y="54" width="272" height="88" rx="14" />
      </g>
      <text x="30" y="74" className="a2hs-art__t">Copy</text>
      <line x1="26" y1="83" x2="274" y2="83" className="a2hs-art__rule" />
      <rect x="18" y="86" width="264" height="30" rx="9" className="a2hs-hl-fill" />
      <text x="30" y="106" className="a2hs-art__t a2hs-art__t--strong a2hs-hl-text">Add to Home Screen</text>
      <PlusSquare x={262} y={101} />
      <line x1="26" y1="119" x2="274" y2="119" className="a2hs-art__rule" />
      <text x="30" y="136" className="a2hs-art__t a2hs-art__t--faint">Find on Page</text>
    </Frame>
  );
}

function IosAdd() {
  return (
    <Frame label="The Add to Home Screen screen with the Add button highlighted">
      <text x="22" y="30" className="a2hs-art__t a2hs-art__t--ios-blue">Cancel</text>
      <text x="150" y="30" textAnchor="middle" className="a2hs-art__t a2hs-art__t--strong">Add to Home Screen</text>
      <text x="278" y="30" textAnchor="end" className="a2hs-art__t a2hs-art__t--ios-blue a2hs-art__t--strong">Add</text>
      <rect x="244" y="12" width="42" height="26" rx="13" className="a2hs-hl-ring" />
      <g className="a2hs-art__card">
        <rect x="14" y="48" width="272" height="94" rx="14" />
      </g>
      <image href={ICON} x="26" y="58" width="40" height="40" style={{ clipPath: 'inset(0 round 10px)' }} />
      <text x="78" y="74" className="a2hs-art__t a2hs-art__t--strong">PackPerks</text>
      <text x="78" y="90" className="a2hs-art__t a2hs-art__t--faint">{HOST}</text>
      <line x1="26" y1="108" x2="274" y2="108" className="a2hs-art__rule" />
      <text x="26" y="130" className="a2hs-art__t">Open as Web App</text>
      <rect x="236" y="117" width="38" height="22" rx="11" className="a2hs-art__switch" />
      <circle cx="263" cy="128" r="9" fill="#fff" />
    </Frame>
  );
}

function AndroidMenuButton() {
  return (
    <Frame label="Chrome's address bar on Android with the ⋮ menu button highlighted">
      <g className="a2hs-art__glass">
        <rect x="14" y="16" width="210" height="36" rx="18" />
        <rect x="234" y="22" width="22" height="22" rx="5" />
      </g>
      <text x="34" y="39" className="a2hs-art__t a2hs-art__t--url">{HOST}</text>
      <text x="245" y="38" textAnchor="middle" className="a2hs-art__t a2hs-art__t--tiny">1</text>
      <g className="a2hs-art__ink-fill">
        <circle cx="276" cy="27" r="2.2" /><circle cx="276" cy="34" r="2.2" /><circle cx="276" cy="41" r="2.2" />
      </g>
      <circle cx="276" cy="34" r="16" className="a2hs-hl-ring" />
      <PageLines top={74} />
    </Frame>
  );
}

function AndroidMenu() {
  return (
    <Frame label="Chrome's menu with Add to Home screen highlighted">
      <PageLines top={18} />
      <g className="a2hs-art__card">
        <rect x="96" y="10" width="190" height="132" rx="12" />
      </g>
      <text x="112" y="34" className="a2hs-art__t">New tab</text>
      <text x="112" y="62" className="a2hs-art__t">History</text>
      <rect x="100" y="74" width="182" height="32" rx="8" className="a2hs-hl-fill" />
      <g transform="translate(116 90)" className="a2hs-hl-ink" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="-5" y="-8" width="10" height="16" rx="2" /><path d="M8 -2 L8 4 M5 1 L11 1" />
      </g>
      <text x="132" y="95" className="a2hs-art__t a2hs-art__t--strong a2hs-hl-text">Add to Home screen</text>
      <text x="112" y="128" className="a2hs-art__t a2hs-art__t--faint">Settings</text>
    </Frame>
  );
}

function AndroidInstall() {
  return (
    <Frame label="The install dialog with the Install button highlighted">
      <g className="a2hs-art__card">
        <rect x="34" y="14" width="232" height="124" rx="18" />
      </g>
      <text x="54" y="42" className="a2hs-art__t a2hs-art__t--strong">Install app</text>
      <image href={ICON} x="54" y="56" width="34" height="34" style={{ clipPath: 'inset(0 round 9px)' }} />
      <text x="98" y="71" className="a2hs-art__t a2hs-art__t--strong">PackPerks</text>
      <text x="98" y="86" className="a2hs-art__t a2hs-art__t--faint">{HOST}</text>
      <text x="166" y="122" textAnchor="middle" className="a2hs-art__t a2hs-art__t--md-blue">Cancel</text>
      <text x="228" y="122" textAnchor="middle" className="a2hs-art__t a2hs-art__t--md-blue a2hs-art__t--strong">Install</text>
      <rect x="200" y="104" width="56" height="26" rx="13" className="a2hs-hl-ring" />
    </Frame>
  );
}

/* ── the steps ────────────────────────────────────────────────────── */

function stepsFor(kind) {
  if (kind === 'android') {
    return [
      { art: <AndroidMenuButton />, title: <>Tap <b>⋮</b> at the top right</> },
      { art: <AndroidMenu />, title: <>Tap <b>Add to Home screen</b></>, note: 'Some phones say Install app.' },
      { art: <AndroidInstall />, title: <>Tap <b>Install</b></> },
    ];
  }
  const chrome = isIosChrome();
  return [
    chrome
      ? { art: <IosChromeShare />, title: <>Tap <b>Share</b> in the address bar</> }
      : { art: <IosMenu />, title: <>Tap <b>•••</b>, then <b>Share</b></>, note: 'No ••• at the bottom? Tap the Share button.' },
    { art: <IosShareSheet />, title: <>Scroll down, tap <b>Add to Home Screen</b></> },
    { art: <IosAdd />, title: <>Tap <b>Add</b></> },
  ];
}

export default function AddToHomeSheet({ onClose }) {
  const detected = phoneKind();
  const [kind, setKind] = useState(detected === 'android' ? 'android' : 'ios');
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
          <img src={ICON} alt="" className="a2hs-head__icon" />
          <h2 className="a2hs-head__title" id="a2hs-title">Add to your Home Screen</h2>
          <button type="button" className="a2hs-close" onClick={onClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </header>

        <div className="a2hs-tabs" role="tablist" aria-label="Phone">
          {[['ios', 'iPhone'], ['android', 'Android']].map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={kind === k}
              className={`a2hs-tab-btn${kind === k ? ' a2hs-tab-btn--on' : ''}`}
              onClick={() => setKind(k)}
              data-ppk={`a2hs-tab-${k}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="a2hs-body">
          {inApp && (
            <p className="a2hs-inapp">
              {inApp === 'ios'
                ? <>First open this page in <b>Safari</b>: tap <b>•••</b> or the share button, then <b>Open in Safari</b>.</>
                : <>First open this page in <b>Chrome</b>: tap <b>⋮</b>, then <b>Open in Chrome</b>.</>}
            </p>
          )}
          <ol className="a2hs-steps" key={kind}>
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
