import './ClaimStatusPills.css';

/* ─────────────────────────────────────────────────────────────────────
 * ClaimStatusPills — three-pill status display for a claim.
 *
 * The legacy `status` column (`pending | completed | failed`) collapsed
 * three different lifecycle states into one badge. The external review
 * called this out as a "trust failure": "Completed" could mean AI
 * passed, human approved, OR cashback sent — three very different
 * states from an audit / customer support point of view.
 *
 * This component renders three discrete pills derived from the claim
 * row:
 *
 *   1. Validation — AI verdict on the receipt
 *        passed | failed | uncertain | skipped (direct refund)
 *
 *   2. Review     — human decision
 *        pending | approved | rejected
 *
 *   3. Payout     — money state
 *        not_queued | queued | sent | failed | refunded
 *
 * Compact mode (default) shows three small badges side by side. Verbose
 * mode adds labels for the detail panel. */

const VALIDATION = {
  passed:     { label: 'AI passed',    tone: 'pass' },
  uncertain:  { label: 'AI uncertain', tone: 'warn' },
  failed:     { label: 'AI failed',    tone: 'fail' },
  skipped:    { label: 'No AI check',  tone: 'muted' },
  pending:    { label: 'Not checked',  tone: 'muted' },
};
const REVIEW = {
  pending:    { label: 'Pending',  tone: 'warn' },
  approved:   { label: 'Approved', tone: 'pass' },
  rejected:   { label: 'Rejected', tone: 'fail' },
};
const PAYOUT = {
  not_queued: { label: '—',        tone: 'muted' },
  queued:     { label: 'Queued',   tone: 'warn' },
  sent:       { label: 'Paid',     tone: 'pass' },
  failed:     { label: 'Failed',   tone: 'fail' },
  refunded:   { label: 'Refunded', tone: 'muted' },
};

/* Derive the validation pill from the claim's AI fields. We mirror the
 * 50% confidence threshold used by ClaimDetailPanel + AdminClaims so
 * the three surfaces tell the admin the same story. */
function deriveValidation(claim) {
  if (claim.type === 'direct_refund') return 'skipped';
  if (!claim.verified_at) return 'pending';
  const conf = claim.ai_confidence ?? 0;
  const failed = (claim.ai_failure_checks || []).length > 0;
  if (failed) return 'failed';
  return conf >= 0.50 ? 'passed' : 'uncertain';
}

function deriveReview(claim) {
  if (claim.status === 'completed') return 'approved';
  if (claim.status === 'failed')    return 'rejected';
  return 'pending';
}

/* B3/B4: ONE rule for payout truth, so the payout pill and the detail panel's
 * action gate can't disagree. A completed (approved) claim is 'sent' only when a
 * real Tikkie payout link exists; a saved payout_status='failed' or a recorded
 * mint error is 'failed' (retryable); otherwise it's still 'queued'. Direct
 * refunds are paid via Tikkie just like cashback — no "paid at claim time"
 * shortcut (that was a pre-Tikkie leftover). */
function derivePayout(claim) {
  if (claim.status === 'pending' || claim.status === 'failed') return 'not_queued';
  if (claim.payout_status === 'refunded') return 'refunded';
  if (claim.tikkie_url && claim.tikkie_status !== 'failed') return 'sent';
  if (claim.payout_status === 'failed' || claim.tikkie_last_error) return 'failed';
  return claim.payout_status || 'queued';
}

/* Shared payout predicates (B4) — imported by ClaimDetailPanel so its Approve/
 * retry gate reads the exact same truth as this pill. */
export function isClaimPaid(claim) {
  const p = derivePayout(claim);
  return p === 'sent' || p === 'refunded';
}
export function isPayoutActionable(claim) {
  if (claim.status === 'pending') return true;                  // awaiting review
  if (claim.status === 'completed') return !isClaimPaid(claim); // approved but not yet paid, or failed → retry
  return false;                                                 // rejected: nothing to do
}

/* Single-kind helper exported so the Claims table can render the
 * three pills as their own discrete columns instead of one combined
 * cluster. Each call returns just the pill markup for one kind. */
export function ClaimStatusPill({ kind, claim }) {
  let key;
  let meta;
  if (kind === 'validation') {
    key = deriveValidation(claim);
    meta = VALIDATION[key];
  } else if (kind === 'review') {
    key = deriveReview(claim);
    meta = REVIEW[key];
  } else if (kind === 'payout') {
    key = derivePayout(claim);
    meta = PAYOUT[key];
  }
  if (!meta) return <span className="csp__pill csp__pill--muted">—</span>;
  return (
    <span className={`csp__pill csp__pill--${meta.tone}`} title={`${kind}: ${key}`}>
      {meta.label}
    </span>
  );
}

export default function ClaimStatusPills({ claim, verbose = false, className = '' }) {
  const validation = deriveValidation(claim);
  const review     = deriveReview(claim);
  const payout     = derivePayout(claim);

  const items = [
    { kind: 'validation', label: 'Validation', meta: VALIDATION[validation] },
    { kind: 'review',     label: 'Review',     meta: REVIEW[review] },
    { kind: 'payout',     label: 'Payout',     meta: PAYOUT[payout] },
  ];

  return (
    <div className={`csp ${verbose ? 'csp--verbose' : ''} ${className}`}>
      {items.map(it => (
        <div key={it.kind} className={`csp__col csp__col--${it.kind}`}>
          {verbose && <span className="csp__label">{it.label}</span>}
          <span className={`csp__pill csp__pill--${it.meta.tone}`}>
            {it.meta.label}
          </span>
        </div>
      ))}
    </div>
  );
}
