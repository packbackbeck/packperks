import { getFailureCopy, ALL_FAILURE_CODES } from '../admin/lib/aiVerdictLabels';
import './ReceiptRejectedPage.css';

/* ─────────────────────────────────────────────────────────────────────
 * ReceiptRejectedPage — user-facing screen shown after the
 * verify-receipt edge fn returns `status: 'failed'`.
 *
 * The page has three jobs:
 *   1. Tell the user WHAT went wrong — friendly title + emoji driven
 *      by the first failed check from the shared label module.
 *   2. Tell them WHAT TO DO NEXT — concrete next-step copy that maps
 *      to the failure (re-take, buy the item, try a different receipt).
 *   3. Reassure them their CUPS ARE SAFE — the edge function never
 *      deducts cups on failure (see App.jsx handleReceiptSubmit, where
 *      the deduction only happens when status !== 'failed'). The
 *      banner under the title makes that explicit so users don't
 *      panic about "lost" cups.
 *
 * Two CTAs at the bottom:
 *   • "Try a different receipt" → returns to ReceiptPage
 *   • "Get help"                → opens a mailto: with the claim ID
 *                                  pre-filled in the subject so support
 *                                  can pull it up immediately
 *
 * ─────────────────────────────────────────────────────────────────────
 */

const SUPPORT_EMAIL = 'support@packback.network';

export default function ReceiptRejectedPage({
  failureChecks = [],
  skippedChecks = [],
  reason,
  requiredItem,
  isSystemError = false,
  claimId,
  partnerBrand,
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
          Something went wrong on our side. Please try again in a moment.
        </p>
        <CupsSafeBanner />
        <div className="rj-actions">
          <button className="rj-actions__primary" onClick={onTryAgain}>
            Try again
          </button>
          <button className="rj-actions__secondary" onClick={onClose}>
            Back to home
          </button>
        </div>
        <SupportLink claimId={claimId} reason="system_error" />
      </div>
    );
  }

  // ── Variant B: AI evaluated and rejected (the normal case) ──
  // Resolve the first KNOWN failure code (one that exists in the
  // shared label module). That drives the headline, hint, and next-
  // step copy. If the only failures are unknown codes we fall back to
  // a generic "couldn't verify" message inside getFailureCopy().
  const primaryCode = failureChecks.find(c => ALL_FAILURE_CODES.includes(c)) || failureChecks[0];
  const copy = getFailureCopy(primaryCode, { partnerBrand });

  // ── Variant B.5: image was hidden by content moderation ──
  // We deliberately do NOT show the detailed "what we checked" rows
  // or the AI's freeform reason here. The user sees a neutral
  // "couldn't be processed" message + how to fix it, nothing about
  // moderation categories. Surfacing the real category would be a bad
  // UX for false positives and pointless legitimate friction
  // otherwise.
  if (primaryCode === 'inappropriate_image') {
    return (
      <div className="rj-page">
        <div className="rj-page__icon-wrap">
          <span className="rj-page__icon" role="img" aria-hidden="true">{copy.icon}</span>
        </div>
        <h1 className="rj-page__title">{copy.title}</h1>
        <p className="rj-page__hint">{copy.hint}</p>
        <CupsSafeBanner />
        <div className="rj-next">
          <span className="rj-next__label">What to do next</span>
          <span className="rj-next__text">{copy.nextStep}</span>
        </div>
        <div className="rj-actions">
          <button className="rj-actions__primary" onClick={onTryAgain}>
            Upload a different photo
          </button>
          <button className="rj-actions__secondary" onClick={onClose}>
            Back to home
          </button>
        </div>
        <SupportLink claimId={claimId} reason="inappropriate_image" />
      </div>
    );
  }

  // Only show checks that actually ran (not in skippedChecks).
  // is_receipt is intentionally omitted from the visible list because
  // when it fails the headline already says "We couldn't read a
  // receipt" — a duplicate row adds noise.
  const VISIBLE_CHECKS = [
    { key: 'is_authentic_burger_king',  label: partnerBrand ? `It's a real ${partnerBrand} receipt` : "It's a real partner receipt" },
    { key: 'contains_required_item',    label: requiredItem ? `Contains "${requiredItem}"` : 'Contains your reward item' },
    { key: 'is_newer_than_cup_return',  label: 'Dated after your cup return' },
  ];
  const visibleChecks = VISIBLE_CHECKS
    .filter(c => !skippedChecks.includes(c.key))
    .map(c => ({ ...c, passed: !failureChecks.includes(c.key) }));

  return (
    <div className="rj-page">
      <div className="rj-page__icon-wrap">
        <span className="rj-page__icon" role="img" aria-hidden="true">{copy.icon}</span>
      </div>

      <h1 className="rj-page__title">{copy.title}</h1>
      <p className="rj-page__hint">{copy.hint}</p>

      <CupsSafeBanner />

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

      {/* What to do next — actionable copy specific to the failure */}
      <div className="rj-next">
        <span className="rj-next__label">What to do next</span>
        <span className="rj-next__text">{copy.nextStep}</span>
      </div>

      {cleanedReason && (
        <div className="rj-reason">
          <span className="rj-reason__label">Why</span>
          <span className="rj-reason__text">{cleanedReason}</span>
        </div>
      )}

      <div className="rj-actions">
        <button className="rj-actions__primary" onClick={onTryAgain}>
          Try a different receipt
        </button>
        <button className="rj-actions__secondary" onClick={onClose}>
          Back to home
        </button>
      </div>

      <SupportLink claimId={claimId} reason={primaryCode} />
    </div>
  );
}

/* ── Cups-safe reassurance banner ──
 * Inserted between the headline and any per-check detail so the user
 * sees the "you didn't lose anything" message before they read the
 * fine print. Backed by the actual claim flow — see App.jsx where
 * setCupCount() only runs on non-failed verifyReceipt results. */
function CupsSafeBanner() {
  return (
    <div className="rj-cups-safe">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <path d="M9 12l2 2 4-4" />
      </svg>
      <span>Your cups are safe. We didn't spend any of them on this claim.</span>
    </div>
  );
}

/* ── Support link ──
 * Opens the user's mail client with a pre-filled subject containing
 * the claim ID and short failure code so the support inbox can route
 * the message without a back-and-forth. Falls back to a plain link
 * with no claim metadata if we somehow lost the id. */
function SupportLink({ claimId, reason }) {
  const subject = claimId
    ? `Help with receipt claim ${claimId}${reason ? ` (${reason})` : ''}`
    : 'Help with receipt claim';
  const body = claimId
    ? `Hi PackBack team,\n\nI need help with my receipt claim.\n\nClaim ID: ${claimId}\nReason shown: ${reason || 'unknown'}\n\nWhat happened: \n\nThanks!`
    : 'Hi PackBack team,\n\nI need help with my receipt claim.\n\nWhat happened: \n\nThanks!';
  const href = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return (
    <a className="rj-help" href={href}>
      Still stuck? Get help
    </a>
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
