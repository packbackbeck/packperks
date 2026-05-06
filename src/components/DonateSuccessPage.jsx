import { useEffect } from 'react';
import './DonateSuccessPage.css';

export default function DonateSuccessPage({ amount, onClose }) {
  // 72g CO2 per cup
  const co2Reduced = amount * 72;

  // Auto-scroll to top when page opens
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="donate-success">
      <button className="donate-success__close" onClick={onClose} aria-label="Close">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>

      <div className="donate-success__content">
        <div className="donate-success__logo">
          PLASTIC<br />
          SOUP<span className="donate-success__logo-sub">FOUNDATION</span>
        </div>

        <h1 className="donate-success__title">
          {amount === 1 ? 'This cup' : `These ${amount} cups`} did not become waste
        </h1>
      </div>

      <div className="donate-success__bottom">
        <p className="donate-success__text">
          Your return helps fund Plastic<br />
          Soup Foundation's campaigns<br />
          against plastic pollution.
        </p>

        <div className="donate-success__stats">
          <div className="donate-success__stat-card">
            <span className="donate-success__stat-label">You reduced</span>
            <span className="donate-success__stat-value">-{co2Reduced}g CO<sub>2</sub></span>
          </div>
          <div className="donate-success__stat-card">
            <span className="donate-success__stat-label">Total today</span>
            <span className="donate-success__stat-value">-618 TCO<sub>2</sub></span>
          </div>
        </div>
      </div>
    </div>
  );
}
