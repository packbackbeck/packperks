import './IbanInfoSheet.css';

// Lucide "turtle" — same glyph the DonateSheet uses, for a consistent look.
const TurtleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m12 10 2 4v3a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-3a8 8 0 1 0-16 0v3a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-3l2-4h4Z" />
    <path d="M4.82 7.9 8 10" />
    <path d="M15.18 7.9 12 10" />
    <path d="M16.93 10H20a2 2 0 0 1 0 4H2" />
  </svg>
);

/**
 * "What is IBAN?" explainer — a bottom-sheet shown from the claim UI (next to
 * "Read the voucher terms"). Explains what an IBAN is, that cashback needs one,
 * and offers donating instead. `onDonate` is null when donations are disabled.
 */
export default function IbanInfoSheet({ open, onClose, onDonate }) {
  if (!open) return null;
  return (
    <div
      className="ibaninfo"
      role="dialog"
      aria-modal="true"
      aria-label="What is IBAN?"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="ibaninfo__card">
        <div className="ibaninfo__body">
          <h3 className="ibaninfo__title">What is IBAN?</h3>
          <p className="ibaninfo__text">
            <strong>IBAN</strong> (International Bank Account Number) is your bank
            account number, used across Europe to send and receive money. It looks
            like <span className="ibaninfo__example">NL91 ABNA 0417 1643 00</span>.
          </p>
          <p className="ibaninfo__text">
            PackPerks pays cashback by bank transfer, so we can only send your
            reward to an <strong>IBAN bank account</strong>.
          </p>
          <p className="ibaninfo__text">
            No IBAN? You can still put your cups to good use —
            <strong> donate them to a good cause</strong> instead of taking cashback.
          </p>
        </div>
        <div className="ibaninfo__footer">
          {onDonate && (
            <button className="ibaninfo__btn ibaninfo__btn--donate" onClick={() => { onClose(); onDonate(); }}>
              <TurtleIcon /> Donate my cups
            </button>
          )}
          <button className="ibaninfo__btn ibaninfo__btn--outline" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
