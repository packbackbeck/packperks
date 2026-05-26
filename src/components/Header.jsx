import { useRef, useEffect } from 'react';
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
  if (org?.logo_url) {
    return <img src={org.logo_url} alt={altText} className="header__logo-bk" />;
  }
  if (!org || org.slug === 'burger-king' || org.slug === 'burgerking') {
    return <img src={burgerKingLogo} alt={altText} className="header__logo-bk" />;
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
export default function Header({ cupCount, onBadgeClick, onAddCup, org, design }) {
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
  const showBrand = sections.showBrandLogo !== false;
  const brandLabel = org?.name || 'Burger King';
  const showLockup = showPackback || showBrand;

  return (
    <header className="header" role="banner">
      {showLockup && (
        <div className="header__brands" aria-label={`PackBack × ${brandLabel}`}>
          {showPackback && (
            <img src={packbackLogo} alt="PackBack" className="header__logo-packback" />
          )}
          {showPackback && showBrand && <span className="header__x">x</span>}
          {showBrand && <OrgMark org={org} />}
        </div>
      )}

      <div className="header__tiles" role="group" aria-label="Account actions">
        {/* Tile 1 — Cup balance. Opens the profile / user-settings page. */}
        <button
          ref={cupTileRef}
          type="button"
          className="header__tile header__tile--cups"
          onClick={onBadgeClick}
          aria-label={`${cupCount} cups collected. Tap to open your profile.`}
        >
          <span className="header__tile-count">{cupCount}</span>
          <img src={cupIcon} alt="" className="header__tile-icon" aria-hidden="true" />
        </button>

        {/* Tile 2 — Plus button. Triggers the scan / add-more-cups flow. */}
        <button
          type="button"
          className="header__tile header__tile--add"
          onClick={onAddCup}
          aria-label="Add more cups"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>

        {/* Tile 3 — User avatar. Second visual entry to the same profile
            destination as tile 1. Two routes feel intentional (cup
            balance is the "rewards" entry, the user icon is the
            "account" entry) even though they land the same place. */}
        <button
          type="button"
          className="header__tile header__tile--user"
          onClick={onBadgeClick}
          aria-label="Open your profile"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </button>
      </div>
    </header>
  );
}
