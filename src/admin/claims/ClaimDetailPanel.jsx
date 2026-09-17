import { useEffect, useState } from 'react';
import { Check, CloudAlert, EyeOff, FileText, Maximize2, RotateCcw, Star, TriangleAlert, X } from 'lucide-react';
import { getReceiptSignedUrl, hideClaimImage, unhideClaimImage } from '../lib/adminApi';
import PiiMask from '../shared/PiiMask';
import ClaimStatusPills, { isPayoutActionable } from '../shared/ClaimStatusPills';
import PermissionGate from '../auth/PermissionGate';
import { useAuth, hasPermission } from '../auth/AuthContext';
import { logAction } from '../auth/actionLog';
import { useOrg } from '../context/OrgContext';
import {
  getPassLabel,
  getFailureLabel,
  ALL_FAILURE_CODES,
  AI_MANUAL_REVIEW_CONFIDENCE,
} from '../lib/aiVerdictLabels';
import { Lightbox } from '../shared/opsTable';
import { Badge, Button, EmptyState, Field, Modal } from '../ui';
// Reuse the styles defined for the receipts page — they cover
// .rc-detail, .rc-ai-panel, .rc-criteria, etc.
import '../receipts/AdminReceiptCheck.css';
import { useAdminMoney } from '../lib/adminMoney';

/* ─────────────────────────────────────────────────────────────────────
 * ClaimDetailPanel — single-claim review surface used by the Claims
 * tab when the admin switches to "Review" view mode. Functionally
 * identical to the old AdminReceiptCheck right pane:
 *
 *   • Receipt photo (signed URL, click to enlarge in a lightbox)
 *   • Claim metadata: claimant, payout, dates, cup count
 *   • "Approved/Rejected by …" stamp (when status != pending)
 *   • Embedded AI check (3 checks with confidence)
 *   • Approve / Reject buttons (gated by claim.approve permission)
 *
 * Approve/Reject call the parent-provided `onApprove(id)` / `onFail(id)`
 * which contain the audit-log + state-merge logic.
 * ───────────────────────────────────────────────────────────────────── */

function formatDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/* Minimum confidence at which we treat the AI's individual check
 * verdicts as trustworthy enough to surface as "pass". Below this we
 * force the panel into a "needs manual review" state regardless of
 * whether all three boolean checks came back true — the previous UI
 * could show "All checks passed" + "0% confident" at the same time,
 * which was a serious operational trust failure.
 *
 * 50% is the conservative middle ground: anything above is at least
 * "more likely than not" correct. For a higher-stakes deployment this
 * could be tuned to 70-80%. */
const AI_CONFIDENCE_PASS_THRESHOLD = 0.50;

/* The receipt rules an admin ticks off before deciding. Order = severity, so
 * the customer's rejected screen leads with the most actionable failure. The
 * moderation-only `inappropriate_image` code is intentionally excluded — it's
 * handled by the hide-image flow, not a manual pass/fail. */
const REVIEW_CRITERIA = [
  'is_receipt',
  'is_authentic_burger_king',
  'contains_required_item',
  'price_mismatch',
  'is_newer_than_cup_return',
  'within_claim_window',
  'duplicate_receipt',
];

/* Seed the per-criteria marks from whatever the AI already decided, so the admin
 * usually only has to flip the one or two rows they disagree with. `true` = pass.
 * A null/absent AI boolean is treated as "pass" unless the code is in the AI's
 * failure list. */
function seedCriteriaMarks(claim) {
  const failed = claim?.ai_failure_checks || [];
  const boolFor = {
    is_receipt: claim?.ai_is_receipt,
    is_authentic_burger_king: claim?.ai_is_burger_king,
    contains_required_item: claim?.ai_contains_required_item,
  };
  const marks = {};
  for (const code of REVIEW_CRITERIA) {
    if (code in boolFor && boolFor[code] === false) marks[code] = false;
    else marks[code] = !failed.includes(code);
  }
  return marks;
}

function AiVerdictPanel({ claim }) {
  const { money } = useAdminMoney();
  const { activeOrg } = useOrg();
  const partnerBrand = activeOrg?.partner_brand_name || activeOrg?.name;

  if (!claim || !claim.verified_at) {
    return (
      <div className="rc-ai-panel rc-ai-panel--empty">
        <div className="rc-ai-panel__header">
          <span className="rc-ai-panel__title">AI check</span>
          <span className="rc-ai-panel__empty">Not verified yet</span>
        </div>
      </div>
    );
  }
  // The "core three" checks are tracked as booleans on the claim row
  // for fast filtering. Post-AI guards (duplicate_receipt,
  // is_newer_than_cup_return) don't have their own boolean column —
  // they only appear inside `ai_failure_checks`, so we synthesise rows
  // for them below.
  const coreChecks = [
    { key: 'is_receipt',               passed: claim.ai_is_receipt },
    { key: 'is_authentic_burger_king', passed: claim.ai_is_burger_king },
    { key: 'contains_required_item',   passed: claim.ai_contains_required_item },
  ];
  const failedChecks = claim.ai_failure_checks || [];
  const isDuplicate    = failedChecks.includes('duplicate_receipt');
  const isOldReceipt   = failedChecks.includes('is_newer_than_cup_return');
  // Anything not in the core three is treated as a "post-AI guard"
  // failure and rendered as its own chip. This way new guard codes
  // automatically render correctly without needing per-code wiring.
  const extraFailures = failedChecks.filter(c => !coreChecks.some(cc => cc.key === c));
  const confidence = claim.ai_confidence ?? 0;
  const rawAllPassed = coreChecks.every(c => c.passed) && extraFailures.length === 0;

  // Effective verdict gates the "all passed" optimism on the model's
  // own confidence. If Claude is < 50% sure but happened to emit all
  // three `true`s, we treat the whole verdict as "uncertain" — the
  // admin must look at the photo and decide.
  //
  // Manual-review pill: bumped to AI_MANUAL_REVIEW_CONFIDENCE so even
  // "kinda confident" verdicts get a "needs eyes" nudge.
  const lowConfidence       = confidence < AI_CONFIDENCE_PASS_THRESHOLD;
  const needsManualReview   = confidence < AI_MANUAL_REVIEW_CONFIDENCE && rawAllPassed;
  const allPassed = rawAllPassed && !lowConfidence;
  const tone = allPassed ? 'pass' : (needsManualReview ? 'uncertain' : 'fail');

  return (
    <div className={`rc-ai-panel rc-ai-panel--${tone}`}>
      <div className="rc-ai-panel__header">
        <span className="rc-ai-panel__title">AI check</span>
        <div className="rc-ai-panel__header-right">
          {needsManualReview && (
            <Badge tone="warning">Manual review needed</Badge>
          )}
          <span className={`rc-ai-panel__confidence${lowConfidence ? ' rc-ai-panel__confidence--low' : ''}`}>
            {(confidence * 100).toFixed(0)}% confident
          </span>
        </div>
      </div>

      {needsManualReview && (
        <div className="ot-callout">
          <TriangleAlert size={15} aria-hidden="true" />
          <span>
            <strong>Needs manual review.</strong> The model marked every check as a pass
            but is only {(confidence * 100).toFixed(0)}% sure. Confirm against the receipt below before approving.
          </span>
        </div>
      )}
      <div className="rc-ai-panel__checks">
        {coreChecks.map(c => (
          <div key={c.key} className={`rc-ai-check rc-ai-check--${c.passed ? 'pass' : 'fail'}`}>
            <span className="rc-ai-check__dot">{c.passed ? <Check size={11} strokeWidth={2.8} /> : <X size={11} strokeWidth={2.8} />}</span>
            <span className="rc-ai-check__label">
              {getPassLabel(c.key, { partnerBrand })}
              {!c.passed && (
                <span className="rc-ai-check__code"> · {getFailureLabel(c.key, { partnerBrand })}</span>
              )}
            </span>
          </div>
        ))}
        {/* Post-AI guard failures (duplicate, older-than-cups, future
             codes). Always render as fail since they only appear in
             ai_failure_checks when they tripped. */}
        {extraFailures.map(code => (
          <div key={code} className="rc-ai-check rc-ai-check--fail">
            <span className="rc-ai-check__dot"><X size={11} strokeWidth={2.8} /></span>
            <span className="rc-ai-check__label">
              {getPassLabel(code, { partnerBrand })}
              <span className="rc-ai-check__code"> · {getFailureLabel(code, { partnerBrand })}</span>
            </span>
          </div>
        ))}
      </div>
      {(claim.ai_required_item || claim.extracted_total_eur != null || claim.extracted_receipt_id) && (
        <div className="rc-ai-panel__rows">
          {claim.ai_required_item && (
            <div className="rc-ai-panel__row">
              <span className="rc-ai-panel__row-label">Required item</span>
              <span className="rc-ai-panel__row-val">{claim.ai_required_item}</span>
            </div>
          )}
          {claim.extracted_total_eur != null && (
            <div className="rc-ai-panel__row">
              <span className="rc-ai-panel__row-label">Receipt total</span>
              <span className="rc-ai-panel__row-val">{money(Number(claim.extracted_total_eur))}</span>
            </div>
          )}
          {claim.extracted_receipt_id && (
            <div className="rc-ai-panel__row">
              <span className="rc-ai-panel__row-label">Receipt #</span>
              <span className="rc-ai-panel__row-val rc-ai-panel__row-val--mono">{claim.extracted_receipt_id}</span>
            </div>
          )}
        </div>
      )}
      {claim.ai_reason && (
        <div className="rc-ai-panel__reason">
          <span className="rc-ai-panel__reason-label">Why</span>
          <span className="rc-ai-panel__reason-text">{claim.ai_reason}</span>
        </div>
      )}
      {claim.ai_verdict?.items?.length > 0 && (
        <details className="rc-ai-panel__items">
          <summary>Extracted line items ({claim.ai_verdict.items.length})</summary>
          <ul>
            {claim.ai_verdict.items.map((it, i) => (
              <li key={i}>
                {it.qty}× {it.name}
                {it.price_eur != null && ` — ${money(Number(it.price_eur))}`}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export default function ClaimDetailPanel({ claim, onApprove, onFail, onFlag, onClaimUpdate, updating }) {
  const { money } = useAdminMoney();
  const { profile } = useAuth();
  const canHideImage = hasPermission(profile?.role, 'claim.hide_image');
  const [lightbox, setLightbox] = useState(false);
  const [signedUrl, setSignedUrl] = useState(null);
  /* Hide-image modal (admin-side moderation). Mirrors the decision-
   * modal pattern below: one piece of state opens the dialog, the
   * dialog itself takes the reason input. */
  const [hideModal, setHideModal] = useState(false);
  const [hideBusy, setHideBusy] = useState(false);
  /* Decision modal — opened by Approve/Reject. Lives at this level so
   * the same modal handles both flows (different copy + required-reason
   * rule). `kind: 'approve' | 'reject' | null`. */
  const [decision, setDecision] = useState(null);
  /* Track photo-load lifecycle separately from the URL so we can
   * differentiate three states:
   *   • 'idle'    — no receipt expected (direct refund) or no path set
   *   • 'loading' — path is set, sign URL hasn't resolved yet
   *   • 'ready'   — signed URL or legacy inline URL available
   *   • 'failed'  — sign URL returned null (RLS, missing object, network)
   * The Approve button is gated on photo evidence being viewable. */
  const [photoStatus, setPhotoStatus] = useState('idle');

  useEffect(() => {
    let cancelled = false;
    setSignedUrl(null);

    // Legacy inline data-URL receipts (older rows) — count as ready
    // immediately, no signed URL needed.
    if (claim?.receipt_photo_url && !claim?.receipt_photo_path) {
      setPhotoStatus('ready');
      return;
    }
    if (!claim?.receipt_photo_path) {
      setPhotoStatus('idle');
      return;
    }

    setPhotoStatus('loading');
    getReceiptSignedUrl(claim.receipt_photo_path)
      .then(u => {
        if (cancelled) return;
        if (u) { setSignedUrl(u); setPhotoStatus('ready'); }
        else   { setPhotoStatus('failed'); }
      })
      .catch(() => { if (!cancelled) setPhotoStatus('failed'); });
    return () => { cancelled = true; };
  }, [claim?.id, claim?.receipt_photo_path, claim?.receipt_photo_url]);

  function retryPhoto() {
    if (!claim?.receipt_photo_path) return;
    setSignedUrl(null);
    setPhotoStatus('loading');
    getReceiptSignedUrl(claim.receipt_photo_path)
      .then(u => {
        if (u) { setSignedUrl(u); setPhotoStatus('ready'); }
        else   { setPhotoStatus('failed'); }
      })
      .catch(() => setPhotoStatus('failed'));
  }

  const photoSrc = signedUrl || claim?.receipt_photo_url || null;

  if (!claim) {
    return (
      <div className="ot-panel ot-panel--empty rc-detail rc-detail--empty">
        <EmptyState icon={FileText} title="No claim selected">
          Select a claim on the left to review it.
        </EmptyState>
      </div>
    );
  }

  // B4: use the SAME payout-truth rule as the status pill — a claim is
  // actionable while pending, or approved-but-not-yet-paid (mint pending or
  // failed → retry). Keeps the panel and the pill from ever disagreeing.
  const canAct = isPayoutActionable(claim);

  // B7: a cashback payout needs a VIEWABLE receipt. "No receipt at all" is worse
  // than "still loading", so gate Approve on one positive rule that covers both.
  const receiptViewable = claim.type !== 'cashback'
    || (!!claim.receipt_photo_path && photoStatus === 'ready');

  return (
    <div className="ot-panel rc-detail">
      <div className="ot-panel__head rc-detail__header">
        <div className="ot-panel__titles">
          <h2 className="ot-panel__title">Claim review</h2>
          <p className="ot-panel__id">{claim.id?.slice(0, 8)}…</p>
        </div>
        <ClaimStatusPills claim={claim} />
      </div>

      {/* Receipt photo (or a "hidden" placeholder when an admin or
          the AI moderator has flagged the image as inappropriate /
          PII / etc. The user-side upload is left untouched — only the
          admin view is suppressed). */}
      <div className="rc-detail__photo-wrap">
        {claim.image_hidden ? (
          <HiddenImageTile
            reason={claim.image_hidden_reason}
            hiddenBy={claim.image_hidden_by}
            hiddenAt={claim.image_hidden_at}
            canUnhide={canHideImage}
            busy={hideBusy}
            onUnhide={async () => {
              setHideBusy(true);
              try {
                const updated = await unhideClaimImage(claim.id);
                logAction({
                  action: 'claim.unhide_image',
                  targetType: 'claim',
                  targetId: claim.id,
                });
                onClaimUpdate?.(updated);
              } catch (e) {
                console.error('unhide failed:', e);
              } finally {
                setHideBusy(false);
              }
            }}
          />
        ) : photoSrc ? (
          <>
            <img
              src={photoSrc}
              alt="Receipt"
              className="rc-detail__photo"
              onClick={() => setLightbox(true)}
              title="Click to enlarge"
            />
            <div className="rc-detail__photo-hint">
              <Maximize2 size={11} aria-hidden="true" />
              Click to enlarge
            </div>
            {canHideImage && (
              <button
                type="button"
                className="rc-detail__photo-hide"
                onClick={() => setHideModal(true)}
                title="Hide this image from admin reviewers"
              >
                <EyeOff size={12} aria-hidden="true" />
                Hide image
              </button>
            )}
          </>
        ) : (
          <div className={`rc-detail__photo-empty${photoStatus === 'failed' ? ' rc-detail__photo-empty--failed' : ''}`}>
            {photoStatus === 'failed' ? (
              <>
                <span className="rc-detail__photo-icon"><CloudAlert size={20} aria-hidden="true" /></span>
                <span className="rc-detail__photo-title">Photo couldn't load</span>
                <span className="rc-detail__photo-sub">
                  The receipt is in storage but couldn't be fetched. Approving without seeing the receipt is disabled.
                </span>
                <Button variant="outline" size="sm" icon={RotateCcw} className="rc-detail__photo-retry" onClick={retryPhoto}>
                  Retry image
                </Button>
              </>
            ) : (
              <>
                <span className="rc-detail__photo-icon"><FileText size={20} aria-hidden="true" /></span>
                <span className="rc-detail__photo-title">{photoStatus === 'loading' ? 'Loading photo…' : 'No receipt photo'}</span>
                {!claim.receipt_photo_path && claim.type !== 'cashback' && (
                  <span className="rc-detail__photo-sub">Direct refund — no receipt expected</span>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <div className="rc-detail__body">
        <AiVerdictPanel claim={claim} />

        <div className="rc-detail__rows">
          <p className="ot-panel__label">Claimant</p>
          <div className="ot-kv">
            <div className="ot-kv__row">
              <span className="ot-kv__label">Name</span>
              <span className="ot-kv__val">{claim.user?.display_name || 'Unknown'}</span>
            </div>
            {claim.user?.email && (
              <div className="ot-kv__row">
                <span className="ot-kv__label">Email</span>
                <span className="ot-kv__val ot-kv__val--muted">
                  <PiiMask type="email" value={claim.user.email} targetType="claim" targetId={claim.id} inline />
                </span>
              </div>
            )}
            <div className="ot-kv__row">
              <span className="ot-kv__label">Payout method</span>
              <span className="ot-kv__val">Tikkie link</span>
            </div>
            {claim.notify_email && (
              <div className="ot-kv__row">
                <span className="ot-kv__label">Notify via</span>
                <span className="ot-kv__val ot-kv__val--muted">
                  Email
                </span>
              </div>
            )}
            {claim.tikkie_url && (
              <div className="ot-kv__row">
                <span className="ot-kv__label">Tikkie link</span>
                <span className="ot-kv__val ot-kv__val--mono">
                  <a href={claim.tikkie_url} target="_blank" rel="noopener noreferrer" className="rc-detail__link">
                    {claim.tikkie_url.replace('https://', '')}
                  </a>
                </span>
              </div>
            )}
          </div>

          <p className="ot-panel__label rc-detail__label-gap">Claim</p>
          <div className="ot-kv">
            <div className="ot-kv__row">
              <span className="ot-kv__label">Type</span>
              <span className="ot-kv__val rc-detail__capital">{claim.type?.replace('_', ' ')}</span>
            </div>
            <div className="ot-kv__row">
              <span className="ot-kv__label">Cups spent</span>
              <span className="ot-kv__val ot-kv__val--strong">{claim.cups_redeemed ?? '—'}</span>
            </div>
            <div className="ot-kv__row">
              <span className="ot-kv__label">Payout</span>
              <span className="ot-kv__val ot-kv__val--money">{money(claim.payout_amount || 0)}</span>
            </div>
            <div className="ot-kv__row">
              <span className="ot-kv__label">Submitted</span>
              <span className="ot-kv__val ot-kv__val--muted">{formatDate(claim.created_at)}</span>
            </div>

            {claim.approver && (
              <div className="ot-kv__row">
                <span className="ot-kv__label">
                  {claim.status === 'completed' ? 'Approved by' : 'Decided by'}
                </span>
                <span className="ot-kv__val">
                  {claim.approver.display_name || claim.approver.email.split('@')[0]}
                  {claim.approved_at && (
                    <span className="ot-kv__meta">
                      · {new Date(claim.approved_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </span>
              </div>
            )}
          </div>

          <button
            type="button"
            className={`rc-flag${claim.flagged ? ' rc-flag--on' : ''}`}
            aria-pressed={!!claim.flagged}
            onClick={() => onFlag?.(claim.id, !claim.flagged)}
          >
            <Star size={14} fill={claim.flagged ? 'currentColor' : 'none'} aria-hidden="true" />
            {claim.flagged ? 'Marked for a second look · click to clear' : 'Mark for a second look'}
          </button>
        </div>

        {claim.type === 'voucher' && (
          <p className="ot-callout ot-callout--info rc-detail__voucher">
            Settled at the counter: a staff member slid to confirm on the customer's phone and the cups
            left the balance there and then. No receipt, no AI check, no payout — nothing to review.
          </p>
        )}
      </div>

      {canAct && (
        <div className="rc-detail__actions">
          {/* Approve is gated when a receipt is expected but isn't viewable.
           * For cashback claims with no photo loaded (loading or failed),
           * we hard-disable Approve — the admin needs evidence to sign off
           * on a payout. Reject stays available either way. */}
          {claim.type === 'cashback' && !receiptViewable && (
            <p className="ot-callout rc-detail__actions-warn">
              <TriangleAlert size={15} aria-hidden="true" />
              <span>
                {!claim.receipt_photo_path
                  ? 'Approve disabled — no receipt was attached to this cashback claim.'
                  : photoStatus === 'failed'
                    ? 'Approve disabled — the receipt photo failed to load. Use Retry image above, or reject if it can\'t be recovered.'
                    : 'Approve will unlock once the receipt photo finishes loading.'}
              </span>
            </p>
          )}
          <p className="rc-detail__actions-hint">Check the receipt matches the claim before approving.</p>
          <div className="rc-detail__btns">
            <PermissionGate action="claim.approve">
              <Button
                variant="danger-ghost"
                icon={X}
                className="rc-detail__btn--reject"
                disabled={updating}
                onClick={() => setDecision('reject')}
              >
                Reject
              </Button>
            </PermissionGate>
            <PermissionGate action="claim.approve">
              <Button
                variant="primary"
                icon={Check}
                disabled={updating || (claim.type === 'cashback' && !receiptViewable)}
                onClick={() => setDecision('approve')}
              >
                Approve & pay
              </Button>
            </PermissionGate>
          </div>
        </div>
      )}

      {decision && (
        <DecisionModal
          kind={decision}
          claim={claim}
          updating={updating}
          onCancel={() => setDecision(null)}
          onConfirm={(reason, failedChecks) => {
            // Hand the reason + per-criteria verdict back to the parent via the
            // onApprove/onFail signatures; AdminClaims accepts (id, reason, failedChecks).
            if (decision === 'approve') onApprove(claim.id, reason, failedChecks);
            else onFail(claim.id, reason, failedChecks);
            setDecision(null);
          }}
        />
      )}

      <Lightbox
        src={lightbox && photoSrc && !claim.image_hidden ? photoSrc : null}
        alt="Receipt enlarged"
        onClose={() => setLightbox(false)}
      />

      {hideModal && (
        <HideImageModal
          busy={hideBusy}
          onCancel={() => setHideModal(false)}
          onConfirm={async (reason) => {
            setHideBusy(true);
            try {
              const updated = await hideClaimImage(claim.id, reason);
              logAction({
                action: 'claim.hide_image',
                targetType: 'claim',
                targetId: claim.id,
                metadata: { reason: reason || null },
              });
              onClaimUpdate?.(updated);
              setHideModal(false);
            } catch (e) {
              console.error('hide failed:', e);
            } finally {
              setHideBusy(false);
            }
          }}
        />
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 * HiddenImageTile — neutral placeholder rendered in place of the
 * receipt photo when claim.image_hidden = true.
 *
 * Two flavours:
 *   • AI-flagged (image_hidden_by === null) → red "Hidden by content
 *     moderation" tone. Surfaces the moderation category from
 *     image_hidden_reason so an admin can see why without exposing
 *     the image.
 *   • Admin-hidden → amber "Hidden by admin" tone. Surfaces the
 *     freeform reason the admin typed.
 *
 * Both variants offer an Unhide button gated by `canUnhide` (the
 * `claim.hide_image` permission). Reverting goes through
 * unhideClaimImage in adminApi.
 * ───────────────────────────────────────────────────────────────────── */
function HiddenImageTile({ reason, hiddenBy, hiddenAt, canUnhide, busy, onUnhide }) {
  const isAiHidden = !hiddenBy;
  const category = (reason || '').replace(/^ai_/, '').replace(/^admin:\s*/, '');
  const formatted = hiddenAt
    ? new Date(hiddenAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div className={`rc-detail__hidden ${isAiHidden ? 'rc-detail__hidden--ai' : 'rc-detail__hidden--admin'}`}>
      <div className="rc-detail__hidden-icon">
        <EyeOff size={22} aria-hidden="true" />
      </div>
      <div className="rc-detail__hidden-title">
        {isAiHidden ? 'Hidden — inappropriate' : 'Image hidden by admin'}
      </div>
      <div className="rc-detail__hidden-sub">
        {isAiHidden
          ? `Auto-flagged by content moderation${category ? ` (${category})` : ''}.`
          : `Reason: ${category || 'not provided'}`}
        {formatted && <span className="rc-detail__hidden-date"> · {formatted}</span>}
      </div>
      <p className="rc-detail__hidden-help">
        The user's own copy of this upload is still visible to them.
        Approval requires reviewable evidence — consider rejecting this claim.
      </p>
      {canUnhide && (
        <Button
          variant="outline"
          size="sm"
          className="rc-detail__hidden-unhide"
          onClick={onUnhide}
          disabled={busy}
        >
          {busy ? 'Working…' : 'Unhide image'}
        </Button>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 * HideImageModal — confirm dialog with an optional reason field.
 *
 * Hiding a receipt is reversible (we keep the storage object and a
 * full audit trail) so we don't require a reason, but we strongly
 * encourage one — the placeholder lists what we're looking for so the
 * admin doesn't have to think too hard.
 * ───────────────────────────────────────────────────────────────────── */
function HideImageModal({ busy, onCancel, onConfirm }) {
  const [reason, setReason] = useState('');
  return (
    <Modal
      open
      onClose={onCancel}
      title="Hide this image?"
      subtitle="Every admin who reviews this claim sees a “hidden” placeholder instead. The customer’s own copy isn’t affected, and you can unhide it later from this panel."
      icon={EyeOff}
      iconTone="rose"
      footer={(
        <>
          <Button variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant="danger" icon={EyeOff} onClick={() => onConfirm(reason.trim())} disabled={busy}>
            {busy ? 'Hiding…' : 'Hide image'}
          </Button>
        </>
      )}
    >
      <Field label={<>Reason <span className="rc-optional">(optional but recommended)</span></>} htmlFor="hide-reason">
        <textarea
          id="hide-reason"
          className="ui-textarea"
          rows={3}
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="e.g. credit card number visible, PII in frame, AI moderator missed NSFW content"
          disabled={busy}
        />
      </Field>
    </Modal>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 * DecisionModal — confirm + required-reason dialog for Approve / Reject.
 *
 * Both directions go through the same modal because the workflow shape
 * is identical: confirm intent, write a reason, get it into the audit
 * log via AdminClaims.handleStatusUpdate. The asymmetry is in the
 * required-reason rule:
 *
 *   • Reject: reason required (≥3 chars). The customer doesn't see it
 *     directly but ops needs to know why for repeat-claim handling.
 *   • Approve: reason optional. Most approvals are routine; only the
 *     borderline cases benefit from a note. We still pass through
 *     whatever the admin types so the audit log captures it.
 *
 * Reason gets persisted to claim.rejection_note (existing column) and
 * to the actionLog row written by AdminClaims. */
function DecisionModal({ kind, claim, updating, onCancel, onConfirm }) {
  const { money } = useAdminMoney();
  const { activeOrg } = useOrg();
  const partnerBrand = activeOrg?.partner_brand_name || activeOrg?.name;
  const [reason, setReason] = useState('');
  const isReject = kind === 'reject';
  // Per-criteria pass/fail marks, seeded from the AI verdict. The customer sees
  // the ones marked "No" on their rejected screen, so rejecting requires at
  // least one failed criterion (you can't reject a receipt that passes them all).
  const [marks, setMarks] = useState(() => seedCriteriaMarks(claim));
  const setMark = (code, pass) => setMarks(m => ({ ...m, [code]: pass }));
  const failedCodes = REVIEW_CRITERIA.filter(c => marks[c] === false);
  // Reason is now optional on reject too; we still require at least one failed
  // criterion so the customer sees a concrete reason on their rejected screen.
  const canSubmit = isReject
    ? (failedCodes.length > 0)
    : true;

  /* Detect human override against the AI check and surface it before
   * the admin commits. Two override directions (false-positive vs
   * false-negative) each get their own warning so the admin understands
   * which way they're going against the model. */
  const aiFailedChecks = claim?.ai_failure_checks || [];
  const aiAllPassed = claim?.verified_at && aiFailedChecks.length === 0;
  const aiAnyFailed = claim?.verified_at && aiFailedChecks.length > 0;
  const aiConfident = (claim?.ai_confidence ?? 0) >= 0.50;
  const overridingPass = aiConfident && aiAllPassed && isReject;   // AI said OK, you're rejecting
  const overridingFail = aiConfident && aiAnyFailed && !isReject;  // AI said NO, you're approving

  return (
    <Modal
      open
      onClose={onCancel}
      title={isReject ? 'Reject this claim?' : 'Approve this claim?'}
      subtitle={isReject
        ? <>The customer's {claim?.cups_redeemed ?? 0} cup{(claim?.cups_redeemed ?? 0) === 1 ? '' : 's'} stay reserved — they can submit another receipt. No payout will be sent.</>
        : <>This marks the claim as paid and releases {money(claim?.payout_amount || 0)} to {claim?.user?.display_name || 'the customer'}.</>}
      icon={isReject ? X : Check}
      iconTone={isReject ? 'rose' : 'emerald'}
      footer={(
        <>
          <Button variant="outline" onClick={onCancel} disabled={updating}>
            Cancel
          </Button>
          <Button
            variant={isReject ? 'danger' : 'primary'}
            icon={isReject ? X : Check}
            onClick={() => onConfirm(reason.trim(), failedCodes)}
            disabled={!canSubmit || updating}
            title={!canSubmit ? 'Mark at least one failed criterion and add a reason' : ''}
          >
            {updating
              ? (isReject ? 'Rejecting…' : 'Approving…')
              : (isReject ? 'Reject claim' : 'Approve & pay')}
          </Button>
        </>
      )}
    >
      {(overridingPass || overridingFail) && (
        <p className="ot-callout">
          <TriangleAlert size={15} aria-hidden="true" />
          <span>
            <strong>Overriding the AI.</strong> {overridingPass
              ? 'The model passed every check at ' + Math.round((claim.ai_confidence || 0) * 100) + '% confidence. Your rejection will be logged as a human override.'
              : 'The model failed at least one check at ' + Math.round((claim.ai_confidence || 0) * 100) + '% confidence. Your approval will be logged as a human override.'}
          </span>
        </p>
      )}

      <div className="rc-criteria">
        <div className="rc-criteria__head">
          <span className="rc-criteria__title">Receipt criteria</span>
          <span className="rc-criteria__hint">
            {isReject
              ? 'Mark every rule Yes or No. The ones you mark “No” are shown to the customer.'
              : 'Confirm each rule reads Yes before releasing the payout.'}
          </span>
        </div>
        {REVIEW_CRITERIA.map(code => {
          const pass = marks[code] !== false;
          return (
            <div key={code} className={`rc-criterion${pass ? '' : ' rc-criterion--failed'}`}>
              <span className="rc-criterion__label">
                {pass
                  ? getPassLabel(code, { partnerBrand })
                  : getFailureLabel(code, { partnerBrand, long: true })}
              </span>
              <div className="rc-criterion__toggle" role="group" aria-label={code}>
                <button
                  type="button"
                  className={`rc-criterion__opt rc-criterion__opt--yes${pass ? ' is-on' : ''}`}
                  aria-pressed={pass}
                  onClick={() => setMark(code, true)}
                >Yes</button>
                <button
                  type="button"
                  className={`rc-criterion__opt rc-criterion__opt--no${!pass ? ' is-on' : ''}`}
                  aria-pressed={!pass}
                  onClick={() => setMark(code, false)}
                >No</button>
              </div>
            </div>
          );
        })}
        {isReject && failedCodes.length === 0 && (
          <p className="rc-criteria__warn">Mark at least one criterion “No” to reject this receipt.</p>
        )}
      </div>

      <Field
        label={isReject ? 'Reason (optional)' : (overridingFail ? 'Reason for overriding AI (recommended)' : 'Note (optional)')}
        htmlFor="rc-decision-reason"
      >
        <input
          id="rc-decision-reason"
          className="ui-input"
          placeholder={isReject
            ? 'e.g. Receipt date is older than 30 days'
            : 'e.g. AI low-confidence but checked manually — looks legit'}
          value={reason}
          onChange={e => setReason(e.target.value)}
          autoFocus
        />
      </Field>
    </Modal>
  );
}
