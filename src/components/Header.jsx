import { useRef, useEffect } from 'react';
import './Header.css';
import packbackLogo from '../assets/images/packback-logo.png';
import burgerKingLogo from '../assets/images/burger-king-logo.png';
import cupIcon from '../assets/images/cup-icon.svg';

export default function Header({ cupCount, onBadgeClick }) {
  const badgeRef = useRef(null);
  const prevCount = useRef(cupCount);

  useEffect(() => {
    if (cupCount !== prevCount.current) {
      badgeRef.current?.classList.remove('header__badge--bump');
      void badgeRef.current?.offsetWidth;
      badgeRef.current?.classList.add('header__badge--bump');
      prevCount.current = cupCount;
    }
  }, [cupCount]);

  return (
    <header className="header" role="banner">
      <div className="header__brands" aria-label="PackBack × Burger King">
        <img src={packbackLogo} alt="PackBack" className="header__logo-packback" />
        <span className="header__x">x</span>
        <img src={burgerKingLogo} alt="Burger King" className="header__logo-bk" />
      </div>
      <button
        className="header__badge"
        ref={badgeRef}
        role="status"
        aria-label={`My Cups: ${cupCount}. Tap to view profile.`}
        onClick={onBadgeClick}
        style={{ cursor: 'pointer' }}
      >
        <span className="header__badge-text">My Cups: {cupCount}</span>
        <img src={cupIcon} alt="" className="header__badge-icon" aria-hidden="true" />
      </button>
    </header>
  );
}
