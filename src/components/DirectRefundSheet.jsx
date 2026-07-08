import './DirectRefundSheet.css';

export default function DirectRefundSheet({ open, onClose, cupCount, onConfirm, refundRate = 1.00, cashbackRate = 1.25 }) {
  if (!open) return null;

  const directTotal = (cupCount * refundRate).toFixed(2);
  const rewardTotal = (cupCount * cashbackRate).toFixed(2);
  const difference  = (cupCount * (cashbackRate - refundRate)).toFixed(2);

  const handleClose = () => { onClose(); };
  const handleConfirm = () => { onConfirm(); };

  return (
    <>
      {/* Backdrop */}
      <div className="drs__backdrop" onClick={handleClose} aria-hidden="true" />

      <div className="drs__sheet" role="dialog" aria-modal="true" aria-label="Direct refund">
        <div className="drs__drag-handle" />

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
              <span className="drs__compare-rate">€{refundRate.toFixed(2)} per cup</span>
            </div>
            <div className="drs__compare-vs">vs</div>
            <div className="drs__compare-option drs__compare-option--highlight">
              <span className="drs__compare-label">Reward cashback</span>
              <span className="drs__compare-amount drs__compare-amount--reward">€{rewardTotal}</span>
              <span className="drs__compare-rate">€{cashbackRate.toFixed(2)} per cup</span>
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
            <button className="drs__btn drs__btn--ghost" onClick={handleConfirm}>
              I want base refund
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
