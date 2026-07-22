import { ALL_FAILURE_CODES } from '../admin/lib/aiVerdictLabels';
import './ReceiptRejectedPage.css';

/* ─────────────────────────────────────────────────────────────────────
 * ReceiptRejectedPage — the single "not accepted" outcome of the receipt
 * check (the other outcome is the green success screen). Instead of exposing
 * the AI's reasoning, we show a plain pass/fail checklist of what a valid
 * receipt needs. The check never deducts cups on failure, which is what the
 * "cups are safe" block promises.
 * ───────────────────────────────────────────────────────────────────── */

const SUPPORT_EMAIL = 'info@packback.network';

export default function ReceiptRejectedPage({
  failureChecks = [],
  requiredItem,
  isSystemError = false,
  claimId,
  onTryAgain,
  onClose,
}) {
  // Technical failure on our side — a short retry, no receipt checklist.
  if (isSystemError) {
    return (
      <RejectShell
        tone="warn"
        title="Something went wrong"
        message="This was a problem on our side, not with your receipt. Give it a moment and try again."
        primaryLabel="Try again"
        onTryAgain={onTryAgain} onClose={onClose} claimId={claimId} supportReason="system_error"
      />
    );
  }

  const primaryCode = failureChecks.find(c => ALL_FAILURE_CODES.includes(c)) || failureChecks[0];

  // Moderation hid the image — stay neutral, no checklist.
  if (primaryCode === 'inappropriate_image') {
    return (
      <RejectShell
        tone="reject"
        title="We couldn't accept this photo"
        message="Re-take a clear photo of the printed receipt itself, then try again."
        primaryLabel="Upload a different photo"
        onTryAgain={onTryAgain} onClose={onClose} claimId={claimId} supportReason="inappropriate_image"
      />
    );
  }

  // Normal rejection — a pass/fail checklist of the receipt requirements.
  const item = requiredItem || 'the reward item';
  const CHECKLIST = [
    { codes: ['is_receipt', 'is_authentic_burger_king'], label: 'A real printed store receipt' },
    { codes: ['contains_required_item'], label: `Lists ${item}` },
    { codes: ['is_newer_than_cup_return'], label: 'Dated after your cup return' },
    { codes: ['duplicate_receipt'], label: 'Not claimed before' },
  ];
  // The AI checks the criteria one at a time and STOPS at the first failure,
  // so anything AFTER the failing check was never evaluated. Show those as
  // pending (empty) rather than a misleading green pass: passed → failed →
  // pending, in list order.
  let stopped = false;
  const checks = CHECKLIST.map((c) => {
    if (stopped) return { label: c.label, status: 'pending' };
    if (c.codes.some((code) => failureChecks.includes(code))) {
      stopped = true;
      return { label: c.label, status: 'failed' };
    }
    return { label: c.label, status: 'passed' };
  });

  return (
    <RejectShell
      tone="reject"
      title="This isn't a valid receipt"
      checks={checks}
      primaryLabel="Try a different receipt"
      onTryAgain={onTryAgain} onClose={onClose} claimId={claimId} supportReason={primaryCode}
    />
  );
}

/* ── Shared shell: badge + (checklist or message) + cups-safe + actions. ── */
function RejectShell({ tone, title, checks, message, primaryLabel, onTryAgain, onClose, claimId, supportReason }) {
  return (
    <div className="rj">
      <div className="rj__scroll">
        <div className="rj__hero">
          <div className={`rj__badge rj__badge--${tone}`} aria-hidden="true">
            {tone === 'warn' ? (
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            ) : (
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round">
                <line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" />
              </svg>
            )}
          </div>
          <h1 className="rj__title">{title}</h1>
        </div>

        {checks && checks.length > 0 && (
          <ul className="rj__checklist">
            {checks.map(c => (
              <li key={c.label} className={`rj__check rj__check--${c.status === 'passed' ? 'yes' : c.status === 'failed' ? 'no' : 'pending'}`}>
                <span className="rj__check-mark" aria-hidden="true">
                  {c.status === 'passed' ? (
                    <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M4 10L8 14L16 6" /></svg>
                  ) : c.status === 'failed' ? (
                    <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="5" y1="5" x2="15" y2="15" /><line x1="15" y1="5" x2="5" y2="15" /></svg>
                  ) : null /* pending — empty circle, not yet checked */}
                </span>
                <span className="rj__check-label">{c.label}</span>
              </li>
            ))}
          </ul>
        )}

        {message && <p className="rj__message">{message}</p>}

        <div className="rj__safe">
          <span className="rj__safe-ic" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" />
            </svg>
          </span>
          <span className="rj__safe-txt"><strong>Your cups are safe.</strong> Nothing was spent on this claim.</span>
        </div>
      </div>

      <div className="rj__actions">
        <button type="button" className="rj__btn rj__btn--primary" onClick={onTryAgain}>{primaryLabel}</button>
        <button type="button" className="rj__btn rj__btn--white" onClick={onClose}>Back to home</button>
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
    ? `Hi PackPerks team,\n\nI need help with my receipt claim.\n\nClaim ID: ${claimId}\nReason shown: ${reason || 'unknown'}\n\nWhat happened: \n\nThanks!`
    : 'Hi PackPerks team,\n\nI need help with my receipt claim.\n\nWhat happened: \n\nThanks!';
  const href = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return (
    <a className="rj__help" href={href}>
      Still stuck? Get help
    </a>
  );
}
