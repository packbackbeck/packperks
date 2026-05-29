import './CupClaimErrorPage.css';

/* CupClaimErrorPage — fires when a QR scan reaches the server but the
 * cups can't be claimed.
 *
 * Branches on the `code` from the claim-cups edge function so each
 * failure mode gets its own copy + recommended action. The previous
 * version showed a single generic "couldn't add cups" message, which
 * made an "already used" QR look the same as an "invalid" QR — but
 * those are completely different situations from the customer's point
 * of view:
 *
 *   • already_claimed   — someone got there first. Don't try again,
 *                         it's a dead receipt.
 *   • batch_not_found   — the QR points at a batch the server doesn't
 *                         have. Either misprinted or the receipt is
 *                         expired/fake.
 *   • no_cups_claimed   — overlap of the two above when the function
 *                         returns 409; we treat it as "already used"
 *                         unless we have a more specific signal.
 *   • no_cups / too_many
 *                       — programmer error in the QR payload itself.
 *   • db_error / unknown
 *                       — fallback: be honest, suggest support.
 */

function buildCopy(brand) {
  return {
  already_claimed: {
    emoji: '🔁',
    title: 'Someone already used this QR',
    body: "Every cup QR can only be claimed once — looks like another customer scanned this receipt first.",
    hint: "If you printed this receipt yourself, ask the smart bin for a fresh one. If a friend shared it with you, ask them to share again.",
    primary: 'Scan a different QR',
  },
  no_cups_claimed: {
    emoji: '🔁',
    title: 'These cups were already claimed',
    body: "Each cup token can only be added to one customer's balance. The cups on this receipt have already been claimed.",
    hint: "Check your activity — if this was an earlier scan of yours, the cups are already in your balance.",
    primary: 'Check my activity',
  },
  batch_not_found: {
    emoji: '❌',
    title: "This QR isn't valid",
    body: `The server doesn't recognise this receipt. It might be misprinted, expired, or not from a participating ${brand}.`,
    hint: "Try scanning a different receipt — make sure it's from a participating restaurant and the QR is fully in frame.",
    primary: 'Scan a different QR',
  },
  batch_expired: {
    emoji: '⏰',
    title: 'This receipt has expired',
    body: "This QR receipt is past its claim window. Receipts can only be redeemed for a limited time after they're printed.",
    hint: "Ask the smart bin for a fresh receipt, or use one from a more recent visit.",
    primary: 'Scan a different QR',
  },
  batch_revoked: {
    emoji: '🚫',
    title: "This QR has been cancelled",
    body: "An admin marked this batch as no longer valid — usually because the receipt was misprinted or reissued.",
    hint: `Ask ${brand} staff for a replacement receipt. Your other cups are unaffected.`,
    primary: 'Back to home',
  },
  invalid_uuid: {
    emoji: '❌',
    title: "We couldn't read this QR",
    body: "Part of the code came through scrambled. This sometimes happens when the QR is partly hidden, smudged, or photographed at an angle.",
    hint: "Hold the receipt flat, in good light, and try again.",
    primary: 'Try again',
  },
  no_cups: {
    emoji: '❌',
    title: 'This QR is empty',
    body: "The QR code didn't contain any cup tokens. That shouldn't normally happen — it might be a test QR.",
    hint: `Ask the staff at ${brand} for a fresh receipt with cup tokens.`,
    primary: 'Back to home',
  },
  too_many: {
    emoji: '❌',
    title: "That's a lot of cups",
    body: "This QR claims more cups than we allow in a single scan. We cap each scan to prevent fraud.",
    hint: "If this is a legitimate receipt, contact support and we'll process it manually.",
    primary: 'Back to home',
  },
  db_error: {
    emoji: '⚠️',
    title: 'Something went wrong on our end',
    body: "We couldn't process this scan right now — it's not your fault. Your balance is safe.",
    hint: 'Wait a moment and try the scan again. If it keeps failing, we want to hear about it.',
    primary: 'Try again',
  },
  unknown: {
    emoji: '⚠️',
    title: "We couldn't add these cups",
    body: null, // fall back to server-supplied reason
    hint: "Try scanning a different QR. If this keeps happening, contact support.",
    primary: 'Scan another QR',
  },
  };
}

export default function CupClaimErrorPage({
  code = 'unknown',
  reason,
  alreadyClaimed = [],
  onTryAgain,
  onClose,
  orgName,
}) {
  const COPY = buildCopy(orgName || 'the restaurant');
  const copy = COPY[code] || COPY.unknown;
  // The body falls back to the server-supplied human reason if we don't
  // have a canned variant — this preserves any specific text the edge
  // function wanted to surface without us having to enumerate it.
  const body = copy.body || reason || "The QR code is invalid or its cup tokens don't exist anymore.";

  return (
    <div className="cce-page">
      <div className="cce-page__icon-wrap">
        <span className="cce-page__icon" role="img" aria-hidden="true">
          {copy.emoji}
        </span>
      </div>

      <h1 className="cce-page__title">{copy.title}</h1>
      <p className="cce-page__hint">{body}</p>
      {copy.hint && (
        <p className="cce-page__hint cce-page__hint--secondary">{copy.hint}</p>
      )}

      {alreadyClaimed.length > 0 && (
        <details className="cce-page__details">
          <summary>
            {alreadyClaimed.length === 1
              ? '1 cup token (technical detail)'
              : `${alreadyClaimed.length} cup tokens (technical detail)`}
          </summary>
          <ul>
            {alreadyClaimed.map(id => <li key={id}>{id}</li>)}
          </ul>
        </details>
      )}

      <div className="cce-page__actions">
        <button className="cce-page__primary" onClick={onTryAgain}>
          {copy.primary}
        </button>
        <button className="cce-page__secondary" onClick={onClose}>
          Back to home
        </button>
      </div>
    </div>
  );
}
