import { useState, useEffect } from 'react';
import './DonateSheet.css';

export default function DonateSheet({ open, onClose, cupCount }) {
  // Default to full cup count
  const [amount, setAmount] = useState(cupCount || 1);

  // Update amount if cupCount changes while open
  useEffect(() => {
    if (open) {
      setAmount(cupCount || 1);
    }
  }, [open, cupCount]);

  if (!open) return null;

  const maxAmount = cupCount;
  const canIncrease = amount < maxAmount;
  const canDecrease = amount > 1;
  // Insufficient-balance guard. The donate flow has no server-side
  // enforcement (unlike share-cups), so this UI block is what stops a
  // user from "donating" a cup they don't have. Showing an explicit
  // empty state — rather than a disabled stepper — makes it obvious
  // *why* the action isn't available and what to do next.
  const hasNoCups = cupCount < 1;

  const handleDone = () => onClose(amount);   // deduct cups and go to success
  const handleCancel = () => onClose(0);       // no deduction

  return (
    <>
      <div className="ds__backdrop" onClick={handleCancel} aria-hidden="true" />

      <div className="ds__sheet" role="dialog" aria-modal="true" aria-label="Donate cups">
        <div className="ds__drag-handle" />

        {/* ── Empty-balance state ──
         * Shown when the user opens the sheet with 0 cups. No stepper,
         * no Donate CTA — just an explanation and a way out. This is
         * the only thing blocking a negative-balance "donation" since
         * the donate flow has no server-side check (unlike share-cups).
         */}
        {hasNoCups ? (
          <>
            <div className="ds__header">
              <h2 className="ds__title">You don't have any cups yet</h2>
              <p className="ds__desc">
                You need at least 1 cup in your balance before you can donate.
                Return a reusable cup at any participating Burger King to get started —
                then come back here to donate.
              </p>
            </div>

            <div className="ds__actions">
              <button className="ds__btn ds__btn--primary" onClick={handleCancel}>
                Got it
              </button>
            </div>
          </>
        ) : (
        <>
        {/* Header */}
        <div className="ds__header">
          <h2 className="ds__title">Donate to Plastic Soup Foundation</h2>
          <p className="ds__desc">
            Your return helps fund campaigns against plastic pollution. We work together to keep the oceans clean.
          </p>
        </div>

        {/* Visual / Image */}
        <div className="ds__visual-wrap">
          <div className="ds__visual">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#2D6A4F" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m12 10 2 4v3a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-3a8 8 0 1 0-16 0v3a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-3l2-4h4Z" />
              <path d="M4.82 7.9 8 10" />
              <path d="M15.18 7.9 12 10" />
              <path d="M16.93 10H20a2 2 0 0 1 0 4H2" />
            </svg>
          </div>
        </div>

        {/* Amount stepper */}
        <div className="ds__stepper">
          <button
            className="ds__stepper-btn"
            onClick={() => canDecrease && setAmount(a => a - 1)}
            disabled={!canDecrease}
            aria-label="Decrease cup count"
          >
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
              <path d="M4 10H16" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
            </svg>
          </button>
          <div className="ds__stepper-value">
            <span className="ds__stepper-number">{amount}</span>
            <span className="ds__stepper-label">cup{amount !== 1 ? 's' : ''}</span>
          </div>
          <button
            className="ds__stepper-btn"
            onClick={() => canIncrease && setAmount(a => a + 1)}
            disabled={!canIncrease}
            aria-label="Increase cup count"
          >
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
              <path d="M10 4V16M4 10H16" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* CTAs */}
        <div className="ds__actions">
          <button className="ds__btn ds__btn--primary" onClick={handleDone}>
            Donate {amount} cup{amount !== 1 ? 's' : ''}
          </button>
          <button className="ds__btn ds__btn--ghost" onClick={handleCancel}>
            Cancel
          </button>
        </div>
        </>
        )}
      </div>
    </>
  );
}
