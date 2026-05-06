import { useState } from 'react';
import './DirectRefundSheet.css';

const RATE_DIRECT = 1.00;   // €1.00 per cup
const RATE_REWARD = 1.25;   // €1.25 per cup (cashback)

function IbanStep({ cupCount, onConfirm, onBack }) {
  const [iban, setIban] = useState('');
  const [error, setError] = useState('');
  const total = (cupCount * RATE_DIRECT).toFixed(2);

  const handleConfirm = () => {
    const trimmed = iban.trim().toUpperCase();
    if (!trimmed) { setError('Please enter your IBAN.'); return; }
    if (trimmed.replace(/\s/g, '').length < 15) { setError('That IBAN looks too short. Double-check it?'); return; }
    setError('');
    onConfirm(trimmed);
  };

  return (
    <div className="drs__step">
      <button className="drs__back" onClick={onBack} aria-label="Back">
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
          <path d="M13 4L7 10L13 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        Back
      </button>

      <h2 className="drs__title">Where do we send it?</h2>
      <p className="drs__desc">
        We'll deposit <strong>€{total}</strong> for your {cupCount} cup{cupCount !== 1 ? 's' : ''} to your bank account within 3 business days.
      </p>

      <div className="drs__iban-wrap">
        <label className="drs__iban-label" htmlFor="drs-iban">Your IBAN</label>
        <input
          id="drs-iban"
          className={`drs__iban-input${error ? ' drs__iban-input--error' : ''}`}
          type="text"
          inputMode="text"
          autoComplete="off"
          spellCheck="false"
          placeholder="NL 00 BANK 1020 3012 3456 78"
          value={iban}
          onChange={(e) => { setIban(e.target.value); if (error) setError(''); }}
          autoFocus
        />
        {error && <span className="drs__iban-error" role="alert">{error}</span>}
      </div>

      <button className="drs__btn drs__btn--confirm" onClick={handleConfirm}>
        Confirm — send €{total}
      </button>
    </div>
  );
}

export default function DirectRefundSheet({ open, onClose, cupCount, onConfirm }) {
  const [step, setStep] = useState(1); // 1 = warning, 2 = iban

  if (!open) return null;

  const directTotal  = (cupCount * RATE_DIRECT).toFixed(2);
  const rewardTotal  = (cupCount * RATE_REWARD).toFixed(2);
  const difference   = (cupCount * (RATE_REWARD - RATE_DIRECT)).toFixed(2);

  const handleClose = () => { setStep(1); onClose(); };
  const handleProceedToIban = () => setStep(2);
  const handleConfirmIban = (iban) => { setStep(1); onConfirm(iban); };

  return (
    <>
      {/* Backdrop */}
      <div className="drs__backdrop" onClick={handleClose} aria-hidden="true" />

      <div className="drs__sheet" role="dialog" aria-modal="true" aria-label="Direct refund">
        <div className="drs__drag-handle" />

        {step === 1 ? (
          <div className="drs__step">
            {/* Warning header */}
            <div className="drs__warning-badge">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
              You're leaving money on the table
            </div>

            <h2 className="drs__title">Are you sure?</h2>
            <p className="drs__desc">
              Choosing a food reward gives you <strong>25% more value</strong> per cup than a direct cash refund.
            </p>

            {/* Big number comparison */}
            <div className="drs__compare">
              <div className="drs__compare-option">
                <span className="drs__compare-label">Direct refund</span>
                <span className="drs__compare-amount drs__compare-amount--base">€{directTotal}</span>
                <span className="drs__compare-rate">€1.00 per cup</span>
              </div>
              <div className="drs__compare-vs">vs</div>
              <div className="drs__compare-option drs__compare-option--highlight">
                <span className="drs__compare-label">Reward cashback</span>
                <span className="drs__compare-amount drs__compare-amount--reward">€{rewardTotal}</span>
                <span className="drs__compare-rate">€1.25 per cup</span>
              </div>
            </div>

            {/* Difference pill */}
            <div className="drs__diff-pill">
              You'd miss out on <strong>€{difference}</strong> by choosing the direct refund
            </div>

            {/* CTAs */}
            <div className="drs__actions">
              <button className="drs__btn drs__btn--primary" onClick={handleClose}>
                🏆 Higher reward
              </button>
              <button className="drs__btn drs__btn--ghost" onClick={handleProceedToIban}>
                I want base refund
              </button>
            </div>
          </div>
        ) : (
          <IbanStep
            cupCount={cupCount}
            onConfirm={handleConfirmIban}
            onBack={() => setStep(1)}
          />
        )}
      </div>
    </>
  );
}
