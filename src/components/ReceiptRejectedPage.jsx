import './ReceiptRejectedPage.css';

/* Human-readable labels for each check the edge function reports. Order
 * matters — the first failed check is shown most prominently. */
const CHECK_INFO = {
  is_receipt: {
    icon: '🧾',
    title: "We couldn't read a receipt in your photo",
    hint: 'Make sure the receipt is clearly visible, not cropped or blurry.',
  },
  is_authentic_burger_king: {
    icon: '👑',
    title: "We couldn't confirm this is a Burger King receipt",
    hint: 'We look for the BK logo, BK menu items, and printed totals on a real receipt.',
  },
  contains_required_item: {
    icon: '🍔',
    title: "Your reward item isn't on this receipt",
    hint: "The receipt needs to include the menu item you're claiming a cashback for.",
  },
  duplicate_receipt: {
    icon: '🔁',
    title: 'This receipt has already been used',
    hint: 'Each receipt can only be used for one cashback claim.',
  },
};

/* The "what we checked" list shows only meaningful checks for the user.
 * is_receipt is intentionally omitted: when it fails, the headline already
 * says "We couldn't read a receipt" — a duplicate row adds noise. The two
 * remaining checks are only shown when they actually ran. */
const CHECK_ORDER = [
  { key: 'is_authentic_burger_king',   label: "It's a real Burger King receipt" },
  { key: 'contains_required_item',     label: 'Contains your reward item' }, // overridden below if requiredItem set
];

export default function ReceiptRejectedPage({
  failureChecks = [],
  skippedChecks = [],
  reason,
  requiredItem,
  isSystemError = false,
  onTryAgain,
  onClose,
}) {
  const cleanedReason = stripInternalPrefix(reason);

  // ── Variant A: hard system error (network down, function returned a
  //   non-2xx, etc). We do NOT show the 3 check rows because we don't
  //   know how any check went — they were never evaluated. ──
  if (isSystemError) {
    return (
      <div className="rj-page">
        <div className="rj-page__icon-wrap">
          <span className="rj-page__icon" role="img" aria-hidden="true">⚠️</span>
        </div>
        <h1 className="rj-page__title">We couldn't verify your receipt</h1>
        <p className="rj-page__hint">
          Something went wrong on our side. Your cups have not been used —
          please try again in a moment.
        </p>
        <div className="rj-actions">
          <button className="rj-actions__primary" onClick={onTryAgain}>
            Try again
          </button>
          <button className="rj-actions__secondary" onClick={onClose}>
            Back to home
          </button>
        </div>
      </div>
    );
  }

  // ── Variant B: AI evaluated and rejected (the normal case) ──
  // First failing check determines the headline copy.
  const primary = failureChecks.find(k => CHECK_INFO[k]) || failureChecks[0];
  const info = CHECK_INFO[primary] || {
    icon: '⚠️',
    title: "We couldn't verify your receipt",
    hint: 'Please try again with a clearer photo.',
  };

  // Only show checks that actually ran (not in skippedChecks).
  const visibleChecks = CHECK_ORDER
    .filter(c => !skippedChecks.includes(c.key))
    .map(c => ({
      ...c,
      passed: !failureChecks.includes(c.key),
      label: c.key === 'contains_required_item' && requiredItem
        ? `Contains "${requiredItem}"`
        : c.label,
    }));

  return (
    <div className="rj-page">
      <div className="rj-page__icon-wrap">
        <span className="rj-page__icon" role="img" aria-hidden="true">{info.icon}</span>
      </div>

      <h1 className="rj-page__title">{info.title}</h1>
      <p className="rj-page__hint">{info.hint}</p>

      {visibleChecks.length > 0 && (
        <div className="rj-checks">
          <div className="rj-checks__title">What we checked</div>
          {visibleChecks.map(c => (
            <Check key={c.key} passed={c.passed} label={c.label} />
          ))}
          {skippedChecks.length > 0 && (
            <div className="rj-checks__skipped">
              {skippedChecks.length === 1
                ? '1 further check was skipped because the previous one failed.'
                : `${skippedChecks.length} further checks were skipped because an earlier one failed.`}
            </div>
          )}
        </div>
      )}

      {cleanedReason && (
        <div className="rj-reason">
          <span className="rj-reason__label">Why</span>
          <span className="rj-reason__text">{cleanedReason}</span>
        </div>
      )}

      <div className="rj-actions">
        <button className="rj-actions__primary" onClick={onTryAgain}>
          Try another photo
        </button>
        <button className="rj-actions__secondary" onClick={onClose}>
          Back to home
        </button>
      </div>
    </div>
  );
}

/* The server summary looks like "Failed: is_receipt, is_authentic_burger_king.
 * Image is a selfie of a person...". The "Failed: <internal_keys>." prefix
 * is for admin debugging — strip it for end-users so we don't leak
 * implementation details (and don't make the failure feel mechanical). */
function stripInternalPrefix(raw) {
  if (!raw) return null;
  return raw.replace(/^Failed:[^.]*\.\s*/, '').trim() || null;
}

function Check({ passed, label }) {
  return (
    <div className={`rj-check rj-check--${passed ? 'pass' : 'fail'}`}>
      <span className="rj-check__dot">
        {passed ? (
          <svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 10L8 14L16 6"/>
          </svg>
        ) : (
          <svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="5" x2="15" y2="15"/>
            <line x1="15" y1="5" x2="5" y2="15"/>
          </svg>
        )}
      </span>
      <span className="rj-check__label">{label}</span>
    </div>
  );
}
