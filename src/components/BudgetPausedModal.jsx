import './BudgetPausedModal.css';

/* Shown when an org's reward budget cap is reached. It deliberately never
 * mentions money or a cap — to the customer it reads as "we're busy, try
 * later". Only admins see the budget figures. */
const DEFAULT_TITLE = 'Rewards are paused for a moment';
const DEFAULT_BODY =
  "We're handling a high number of reward claims right now, so claiming is briefly unavailable. Please try again a little later.";

export default function BudgetPausedModal({ open, onClose, title, body }) {
  if (!open) return null;
  const heading = (title && title.trim()) || DEFAULT_TITLE;
  const message = (body && body.trim()) || DEFAULT_BODY;

  return (
    <div className="bpm-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="bpm-title">
      <div className="bpm-card" onClick={(e) => e.stopPropagation()}>
        <div className="bpm-icon" aria-hidden="true">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <line x1="12" y1="7.5" x2="12" y2="12.5" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>

        <h2 id="bpm-title" className="bpm-title">{heading}</h2>

        <p className="bpm-body">{message}</p>

        <p className="bpm-reassure">
          Your cups are safe and stay on your balance.
        </p>

        <button className="bpm-btn" type="button" onClick={onClose}>
          Got it
        </button>
      </div>
    </div>
  );
}
