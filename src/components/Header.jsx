import { useRef, useEffect } from 'react';
import { track, EVENTS } from '../utils/analytics';
import './Header.css';
import packbackLogo from '../assets/images/packback-logo.png';
import burgerKingLogo from '../assets/images/burger-king-logo.png';
import cupIcon from '../assets/images/cup-icon.svg';

/* Resolve the partner brand-mark on the right side of the "PackBack ×
 * ___" lockup. Resolution order:
 *   1. org.logo_url — uploaded / pasted in the onboarding wizard
 *   2. Bundled BK logo for the seed BK org (slug 'burger-king')
 *   3. Coloured initial chip using org.brand_color + first letter
 * Falls back gracefully when `org` is null (very brief bootstrap
 * window before App.jsx resolves the active org from the URL slug). */
function OrgMark({ org }) {
  const altText = org?.name || 'Organisation';
  // Per-org logo width (set in admin org settings). Height auto-scales so
  // the logo keeps its aspect ratio; null → the CSS default size.
  const logoStyle = org?.logo_width ? { width: `${org.logo_width}px`, height: 'auto' } : undefined;
  if (org?.logo_url) {
    return <img src={org.logo_url} alt={altText} className="header__logo-bk" style={logoStyle} />;
  }
  // D.8: only a GENUINE Burger King org gets the bundled BK logo. Previously
  // `!org` (the brief bootstrap window before the org resolves) also hit this
  // branch, so EVERY brand flashed the Burger King logo on load.
  if (org && (org.slug === 'burger-king' || org.slug === 'burgerking')) {
    return <img src={burgerKingLogo} alt={altText} className="header__logo-bk" style={logoStyle} />;
  }
  if (!org) {
    // Neutral mark during startup — never a competitor's logo.
    return <img src={packbackLogo} alt="PackBack" className="header__logo-bk" style={logoStyle} />;
  }
  const letter = (org?.name || '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <span
      className="header__logo-chip"
      style={{ background: org?.brand_color || '#FD6F46' }}
      aria-label={altText}
    >
      {letter}
    </span>
  );
}

/* Header — three-tile cluster in the top-right replaced the single
 * "My Cups: N" pill so the most common follow-up actions sit one tap
 * away:
 *
 *   ┌──────┐ ┌──────┐ ┌──────┐
 *   │ 🥤 N │ │  +   │ │  👤  │
 *   └──────┘ └──────┘ └──────┘
 *     ↓        ↓        ↓
 *   profile  scan QR  profile
 *
 * Both the cup-count and the user-icon tiles open the profile page
 * (per the design brief) — they're two visual entry points to the
 * same destination. The middle tile triggers the add-more-cups scan
 * flow without taking the user off the home screen first. */
export default function Header({ cupCount, onBadgeClick, onAddCup, org, design, claimStatus, showAdd = true, showCups = true }) {
  const cupTileRef = useRef(null);
  const prevCount = useRef(cupCount);

  useEffect(() => {
    if (cupCount !== prevCount.current) {
      cupTileRef.current?.classList.remove('header__tile--bump');
      void cupTileRef.current?.offsetWidth;
      cupTileRef.current?.classList.add('header__tile--bump');
      prevCount.current = cupCount;
    }
  }, [cupCount]);

  const sections = design?.sections || {};
  const showPackback = sections.showPackbackLogo !== false;
  // Only pair a partner mark when there's a GENUINE distinct partner org.
  // Before an org resolves (null), OrgMark falls back to the PackBack logo,
  // which rendered "PackBack × PackBack" on the null/bootstrap screen — show a
  // single PackBack mark instead.
  const hasPartner = sections.showBrandLogo !== false && !!org;
  const brandLabel = org?.partner_brand_name || org?.name || 'the restaurant';
  const showLockup = showPackback || hasPartner;

  return (
    <header className="header" role="banner">
      {showLockup && (
        <div className="header__brands" aria-label={hasPartner ? `PackBack × ${brandLabel}` : 'PackBack'}>
          {showPackback && (
            <img src={packbackLogo} alt="PackBack" className="header__logo-packback" />
          )}
          {showPackback && hasPartner && <span className="header__x">x</span>}
          {hasPartner && <OrgMark org={org} />}
        </div>
      )}

      <div className="header__tiles" role="group" aria-label="Account actions">
        {/* Tile 1 — Plus button. Triggers the scan / add-more-cups flow.
            Hidden on the Redirect Refund home: cups go in the smart bin,
            not through an in-app scan. */}
        {showAdd && <button
          type="button"
          className="header__tile header__tile--add"
          onClick={() => { track(EVENTS.ADD_CUPS_OPENED); onAddCup?.(); }}
          aria-label="Add more cups"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>}

        {/* Tile 2 — Cup balance. Opens the profile / user-settings page.
            Hidden on the Redirect Refund home: there is no cup balance. */}
        {showCups && <button
          ref={cupTileRef}
          type="button"
          className="header__tile header__tile--cups"
          onClick={() => { track(EVENTS.BALANCE_OPENED); onBadgeClick?.(); }}
          aria-label={`${cupCount} cups collected. Tap to open your profile.`}
        >
          <span className="header__tile-count">{cupCount}</span>
          <img src={cupIcon} alt="" className="header__tile-icon" aria-hidden="true" />
        </button>}

        {/* Tile 3 — User avatar. Second visual entry to the same profile
            destination as tile 1. Two routes feel intentional (cup
            balance is the "rewards" entry, the user icon is the
            "account" entry) even though they land the same place. */}
        <button
          type="button"
          className="header__tile header__tile--user"
          onClick={() => { track(EVENTS.ACCOUNT_OPENED); onBadgeClick?.(); }}
          aria-label={claimStatus === 'ready'
            ? 'Cashback ready to collect, open your profile'
            : claimStatus === 'pending'
              ? 'Cashback claim in review, open your profile'
              : 'Open your profile'}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
          {/* Claim-status indicator: yellow timer while in review, green "!"
              once an admin approves and the Tikkie link is ready. */}
          {claimStatus && (
            <span className={`header__tile-badge header__tile-badge--${claimStatus}`} aria-hidden="true">
              {claimStatus === 'ready' ? (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="6" x2="12" y2="13" /><line x1="12" y1="17.5" x2="12" y2="17.6" />
                </svg>
              ) : (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" /><polyline points="12 8 12 12 15 13.5" />
                </svg>
              )}
            </span>
          )}
        </button>
      </div>
    </header>
  );
}
