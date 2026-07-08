import { getFailureCopy, getFailureLabel, ALL_FAILURE_CODES } from '../admin/lib/aiVerdictLabels';
import './ReceiptRejectedPage.css';

/* ─────────────────────────────────────────────────────────────────────
 * ReceiptRejectedPage — user-facing screen shown after the verify-receipt
 * edge fn returns `status: 'failed'`.
 *
 * Information hierarchy (top → bottom):
 *   1. Main verdict     — a soft badge + short, direct headline.
 *   2. Why              — the reason, plus small chips for the failed checks.
 *   3. Your cups safe    — a calm green reassurance strip.
 *   4. What to do next   — the single concrete action.
 *   5. CTA               — primary "try again", a WHITE "Back to home", help.
 *
 * The edge function never deducts cups on failure (App.jsx
 * handleReceiptSubmit only deducts when status !== 'failed'), which is what
 * the cups-safe strip promises.
 * ───────────────────────────────────────────────────────────────────── */

const SUPPORT_EMAIL = 'info@packback.network';

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

  // ── Variant A: hard system error (network down, non-2xx, etc). ──
  if (isSystemError) {
    return (
      <Shell
        icon="⚠️"
        tone="warn"
        title="Something went wrong"
        why="This was a problem on our side — not with your receipt."
        nextStep="Give it a moment and try again. If it keeps failing, get in touch and we'll sort it out."
        primaryLabel="Try again"
        onTryAgain={onTryAgain}
        onClose={onClose}
        claimId={claimId}
        supportReason="system_error"
      />
    );
  }

  const primaryCode = failureChecks.find(c => ALL_FAILURE_CODES.includes(c)) || failureChecks[0];
  const copy = getFailureCopy(primaryCode, { partnerBrand });

  // ── Variant B: image hidden by content moderation. Neutral only. ──
  if (primaryCode === 'inappropriate_image') {
    return (
      <Shell
        icon={copy.icon}
        tone="warn"
        title={copy.title}
        why={copy.hint}
        nextStep={copy.nextStep}
        primaryLabel="Upload a different photo"
        onTryAgain={onTryAgain}
        onClose={onClose}
        claimId={claimId}
        supportReason="inappropriate_image"
      />
    );
  }

  // ── Variant C: AI evaluated and rejected (the normal case) ──
  // The failed checks become compact chips under the reason. (is_receipt is
  // omitted — when it fails the headline already says it's not a receipt.)
  const failedChips = failureChecks
    .filter(c => c !== 'is_receipt' && !skippedChecks.includes(c) && ALL_FAILURE_CODES.includes(c))
    .map(c => getFailureLabel(c, { partnerBrand }));

  return (
    <Shell
      icon={copy.icon}
      tone="reject"
      title={copy.title}
      why={cleanedReason || copy.hint}
      chips={failedChips}
      nextStep={copy.nextStep}
      primaryLabel="Try a different receipt"
      onTryAgain={onTryAgain}
      onClose={onClose}
      claimId={claimId}
      supportReason={primaryCode}
    />
  );
}

/* ── Shared page shell — renders the fixed 5-step hierarchy. ── */
function Shell({ icon, tone, title, why, chips = [], nextStep, primaryLabel, onTryAgain, onClose, claimId, supportReason }) {
  return (
    <div className="rj">
      <div className="rj__scroll">
        {/* 1. Main verdict */}
        <div className="rj__hero">
          <div className={`rj__badge rj__badge--${tone}`}>
            <span role="img" aria-hidden="true">{icon}</span>
          </div>
          <h1 className="rj__title">{title}</h1>
        </div>

        {/* 2. Why */}
        {(why || chips.length > 0) && (
          <section className="rj__card">
            <span className="rj__eyebrow">Why</span>
            {why && <p className="rj__lead">{why}</p>}
            {chips.length > 0 && (
              <div className="rj__chips">
                {chips.map(label => (
                  <span key={label} className="rj__chip">
                    <svg width="10" height="10" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" aria-hidden="true">
                      <line x1="5" y1="5" x2="15" y2="15" /><line x1="15" y1="5" x2="5" y2="15" />
                    </svg>
                    {label}
                  </span>
                ))}
              </div>
            )}
          </section>
        )}

        {/* 3. Your cups are safe */}
        <div className="rj__safe">
          <span className="rj__safe-ic">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" />
            </svg>
          </span>
          <span className="rj__safe-txt"><strong>Your cups are safe.</strong> Nothing was spent on this claim.</span>
        </div>

        {/* 4. What to do next */}
        {nextStep && (
          <section className="rj__card">
            <span className="rj__eyebrow">What to do next</span>
            <p className="rj__lead">{nextStep}</p>
          </section>
        )}
      </div>

      {/* 5. CTA */}
      <div className="rj__actions">
        <button type="button" className="rj__btn rj__btn--primary" onClick={onTryAgain}>
          {primaryLabel}
        </button>
        <button type="button" className="rj__btn rj__btn--white" onClick={onClose}>
          Back to home
        </button>
        <SupportLink claimId={claimId} reason={supportReason} />
      </div>
    </div>
  );
}

/* ── Support link ── opens the mail client with the claim id + failure code. */
function SupportLink({ claimId, reason }) {
  const subject = claimId
    ? `Help with receipt claim ${claimId}${reason ? ` (${reason})` : ''}`
    : 'Help with receipt claim';
  const body = claimId
    ? `Hi PackBack team,\n\nI need help with my receipt claim.\n\nClaim ID: ${claimId}\nReason shown: ${reason || 'unknown'}\n\nWhat happened: \n\nThanks!`
    : 'Hi PackBack team,\n\nI need help with my receipt claim.\n\nWhat happened: \n\nThanks!';
  const href = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return (
    <a className="rj__help" href={href}>
      Still stuck? Get help
    </a>
  );
}

/* The server summary looks like "Failed: is_receipt, ...". The "Failed: <keys>."
 * prefix is admin-only debug — strip it so end-users don't see it. */
function stripInternalPrefix(raw) {
  if (!raw) return null;
  return raw.replace(/^Failed:[^.]*\.\s*/, '').trim() || null;
}
