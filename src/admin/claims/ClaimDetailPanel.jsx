import { useEffect, useState } from 'react';
import { getReceiptSignedUrl, hideClaimImage, unhideClaimImage } from '../lib/adminApi';
import PiiMask from '../shared/PiiMask';
import ClaimStatusPills from '../shared/ClaimStatusPills';
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
// Reuse the existing styles defined for the receipts page — they cover
// .rc-detail, .rc-status, .rc-ai-panel, .rc-lightbox, etc.
import '../receipts/AdminReceiptCheck.css';

/* ─────────────────────────────────────────────────────────────────────
 * ClaimDetailPanel — single-claim review surface used by the Claims
 * tab when the admin switches to "Review" view mode. Functionally
 * identical to the old AdminReceiptCheck right pane:
 *
 *   • Receipt photo (signed URL, click to enlarge in a lightbox)
 *   • Claim metadata: claimant, IBAN, payout, dates, cup count
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

function AiVerdictPanel({ claim }) {
  const { activeOrg } = useOrg();
  const partnerBrand = activeOrg?.partner_brand_name || activeOrg?.name;

  if (!claim || !claim.verified_at) {
    return (
      <div className="rc-ai-panel rc-ai-panel--empty">
        <span className="rc-ai-panel__title">AI check</span>
        <span className="rc-ai-panel__empty">Not verified yet</span>
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
            <span className="rc-ai-panel__pill rc-ai-panel__pill--review">
              Manual review needed
            </span>
          )}
          <span className={`rc-ai-panel__confidence${lowConfidence ? ' rc-ai-panel__confidence--low' : ''}`}>
            {(confidence * 100).toFixed(0)}% confident
          </span>
        </div>
      </div>

      {needsManualReview && (
        <div className="rc-ai-panel__override">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>
            <strong>Needs manual review.</strong> The model marked every check as a pass
            but is only {(confidence * 100).toFixed(0)}% sure. Confirm against the receipt below before approving.
          </span>
        </div>
      )}
      <div className="rc-ai-panel__checks">
        {coreChecks.map(c => (
          <div key={c.key} className={`rc-ai-check rc-ai-check--${c.passed ? 'pass' : 'fail'}`}>
            <span className="rc-ai-check__dot">{c.passed ? '✓' : '✕'}</span>
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
            <span className="rc-ai-check__dot">✕</span>
            <span className="rc-ai-check__label">
              {getPassLabel(code, { partnerBrand })}
              <span className="rc-ai-check__code"> · {getFailureLabel(code, { partnerBrand })}</span>
            </span>
          </div>
        ))}
      </div>
      {claim.ai_required_item && (
        <div className="rc-ai-panel__row">
          <span className="rc-ai-panel__row-label">Required item</span>
          <span className="rc-ai-panel__row-val">{claim.ai_required_item}</span>
        </div>
      )}
      {claim.extracted_total_eur != null && (
        <div className="rc-ai-panel__row">
          <span className="rc-ai-panel__row-label">Receipt total</span>
          <span className="rc-ai-panel__row-val">€{Number(claim.extracted_total_eur).toFixed(2)}</span>
        </div>
      )}
      {claim.extracted_receipt_id && (
        <div className="rc-ai-panel__row">
          <span className="rc-ai-panel__row-label">Receipt #</span>
          <span className="rc-ai-panel__row-val rc-ai-panel__row-val--mono">{claim.extracted_receipt_id}</span>
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
                {it.price_eur != null && ` — €${Number(it.price_eur).toFixed(2)}`}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export default function ClaimDetailPanel({ claim, onApprove, onFail, onClaimUpdate, updating }) {
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
      <div className="rc-detail rc-detail--empty">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#C8C4BC" strokeWidth="1.5">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
        <p>Select a claim on the left to review.</p>
      </div>
    );
  }

  const canAct = claim.status === 'pending';

  return (
    <div className="rc-detail">
      <div className="rc-detail__header">
        <div>
          <div className="rc-detail__title">Claim review</div>
          <div className="rc-detail__id">{claim.id?.slice(0, 8)}…</div>
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
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>
              </svg>
              Click to enlarge
            </div>
            {canHideImage && (
              <button
                type="button"
                className="rc-detail__photo-hide"
                onClick={() => setHideModal(true)}
                title="Hide this image from admin reviewers"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                  <line x1="1" y1="1" x2="23" y2="23"/>
                </svg>
                Hide image
              </button>
            )}
          </>
        ) : (
          <div className="rc-detail__photo-empty">
            {photoStatus === 'failed' ? (
              <>
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="1.5">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                <span style={{ color: '#DC2626' }}>Photo couldn't load</span>
                <span className="rc-detail__photo-sub">
                  The receipt is in storage but couldn't be fetched. Approving without seeing the receipt is disabled.
                </span>
                <button
                  type="button"
                  className="rc-detail__photo-retry"
                  onClick={retryPhoto}
                >
                  Retry image
                </button>
              </>
            ) : (
              <>
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#C8C4BC" strokeWidth="1.5">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                </svg>
                <span>{photoStatus === 'loading' ? 'Loading photo…' : 'No receipt photo'}</span>
                {!claim.receipt_photo_path && claim.type !== 'cashback' && (
                  <span className="rc-detail__photo-sub">Direct refund — no receipt expected</span>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <AiVerdictPanel claim={claim} />

      <div className="rc-detail__rows">
        <div className="rc-detail__section-label">Claimant</div>
        <div className="rc-detail__row">
          <span className="rc-detail__row-label">Name</span>
          <span className="rc-detail__row-val">{claim.user?.display_name || 'Unknown'}</span>
        </div>
        {claim.user?.email && (
          <div className="rc-detail__row">
            <span className="rc-detail__row-label">Email</span>
            <span className="rc-detail__row-val rc-detail__row-val--muted">
              <PiiMask type="email" value={claim.user.email} targetType="claim" targetId={claim.id} inline />
            </span>
          </div>
        )}
        <div className="rc-detail__row">
          <span className="rc-detail__row-label">IBAN</span>
          <span className="rc-detail__row-val rc-detail__row-val--mono">
            {claim.iban
              ? <PiiMask type="iban" value={claim.iban} targetType="claim" targetId={claim.id} />
              : <span style={{ color: '#B8B2A8' }}>—</span>}
          </span>
        </div>

        <div className="rc-detail__section-label" style={{ marginTop: 10 }}>Claim</div>
        <div className="rc-detail__row">
          <span className="rc-detail__row-label">Type</span>
          <span className="rc-detail__row-val" style={{ textTransform: 'capitalize' }}>{claim.type?.replace('_', ' ')}</span>
        </div>
        <div className="rc-detail__row">
          <span className="rc-detail__row-label">Cups spent</span>
          <span className="rc-detail__row-val rc-detail__row-val--bold">{claim.cups_redeemed ?? '—'}</span>
        </div>
        <div className="rc-detail__row">
          <span className="rc-detail__row-label">Payout</span>
          <span className="rc-detail__row-val rc-detail__row-val--green">€{(claim.payout_amount || 0).toFixed(2)}</span>
        </div>
        <div className="rc-detail__row">
          <span className="rc-detail__row-label">Submitted</span>
          <span className="rc-detail__row-val rc-detail__row-val--muted">{formatDate(claim.created_at)}</span>
        </div>

        {claim.approver && (
          <div className="rc-detail__row">
            <span className="rc-detail__row-label">
              {claim.status === 'completed' ? 'Approved by' : 'Decided by'}
            </span>
            <span className="rc-detail__row-val">
              {claim.approver.display_name || claim.approver.email.split('@')[0]}
              {claim.approved_at && (
                <span style={{ color: '#9E9A93', fontWeight: 400, marginLeft: 6 }}>
                  · {new Date(claim.approved_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </span>
          </div>
        )}
      </div>

      {canAct && (
        <div className="rc-detail__actions">
          {/* Approve is gated when a receipt is expected but isn't viewable.
           * For cashback claims with no photo loaded (loading or failed),
           * we hard-disable Approve — the admin needs evidence to sign off
           * on a payout. Reject stays available either way. */}
          {claim.type === 'cashback' && claim.receipt_photo_path && photoStatus !== 'ready' && (
            <p className="rc-detail__actions-warn">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              {photoStatus === 'failed'
                ? 'Approve disabled — the receipt photo failed to load. Use Retry image above, or reject if it can\'t be recovered.'
                : 'Approve will unlock once the receipt photo finishes loading.'}
            </p>
          )}
          <p className="rc-detail__actions-hint">Verify the receipt matches the claim before approving.</p>
          <div className="rc-detail__btns">
            <PermissionGate action="claim.approve">
              <button
                className="rc-detail__btn rc-detail__btn--approve"
                disabled={
                  updating ||
                  (claim.type === 'cashback' && claim.receipt_photo_path && photoStatus !== 'ready')
                }
                onClick={() => setDecision('approve')}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                Approve & Pay
              </button>
            </PermissionGate>
            <PermissionGate action="claim.approve">
              <button
                className="rc-detail__btn rc-detail__btn--fail"
                disabled={updating}
                onClick={() => setDecision('reject')}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                Reject
              </button>
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
          onConfirm={(reason) => {
            // Hand the reason back to the parent via the existing onApprove/onFail
            // signatures; AdminClaims has been updated to accept (id, reason).
            if (decision === 'approve') onApprove(claim.id, reason);
            else onFail(claim.id, reason);
            setDecision(null);
          }}
        />
      )}

      {lightbox && photoSrc && !claim.image_hidden && (
        <div className="rc-lightbox" onClick={() => setLightbox(false)}>
          <button className="rc-lightbox__close" onClick={e => { e.stopPropagation(); setLightbox(false); }}>×</button>
          <img src={photoSrc} alt="Receipt enlarged" className="rc-lightbox__img" onClick={e => e.stopPropagation()} />
        </div>
      )}

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
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
          <line x1="1" y1="1" x2="23" y2="23"/>
        </svg>
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
        <button
          type="button"
          className="rc-detail__hidden-unhide"
          onClick={onUnhide}
          disabled={busy}
        >
          {busy ? 'Working…' : 'Unhide image'}
        </button>
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
    <div className="rc-decision-backdrop" onClick={onCancel}>
      <div className="rc-decision-modal" onClick={e => e.stopPropagation()}>
        <h3 className="rc-decision-modal__title">Hide this image?</h3>
        <p className="rc-decision-modal__sub">
          The image will be replaced with a "hidden" placeholder for every admin
          who reviews this claim. The user's own copy is not affected. You can
          unhide later from this same panel.
        </p>
        <label className="rc-decision-modal__label" htmlFor="hide-reason">
          Reason <span style={{ color: '#9E9A93', fontWeight: 400 }}>(optional but recommended)</span>
        </label>
        <textarea
          id="hide-reason"
          className="rc-decision-modal__textarea"
          rows={3}
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="e.g. credit card number visible, PII in frame, AI moderator missed NSFW content"
          disabled={busy}
        />
        <div className="rc-decision-modal__actions">
          <button className="rc-decision-modal__cancel" onClick={onCancel} disabled={busy}>Cancel</button>
          <button
            className="rc-decision-modal__confirm rc-decision-modal__confirm--reject"
            onClick={() => onConfirm(reason.trim())}
            disabled={busy}
          >
            {busy ? 'Hiding…' : 'Hide image'}
          </button>
        </div>
      </div>
    </div>
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
  const [reason, setReason] = useState('');
  const isReject = kind === 'reject';
  const canSubmit = isReject ? reason.trim().length >= 3 : true;

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
    <div className="admin-publish-overlay" onClick={onCancel}>
      <div className="admin-publish-modal" onClick={e => e.stopPropagation()}>
        <div className="admin-publish-modal__header">
          <div
            className="admin-publish-modal__icon"
            style={isReject
              ? { background: 'rgba(220,38,38,0.10)',  color: '#DC2626' }
              : { background: 'rgba(22,163,74,0.12)', color: '#16A34A' }}
          >
            {isReject ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </div>
          <div>
            <h3 className="admin-publish-modal__title">
              {isReject ? 'Reject this claim?' : 'Approve this claim?'}
            </h3>
            <p className="admin-publish-modal__sub">
              {isReject
                ? <>The customer's {claim?.cups_redeemed ?? 0} cup{(claim?.cups_redeemed ?? 0) === 1 ? '' : 's'} stay reserved — they can submit another receipt. No payout will be sent.</>
                : <>This will mark the claim as paid and release €{(claim?.payout_amount || 0).toFixed(2)} to {claim?.user?.display_name || 'the customer'}.</>
              }
            </p>
          </div>
        </div>

        {(overridingPass || overridingFail) && (
          <div className="rc-detail__actions-warn" style={{ margin: '0 0 14px' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>
              <strong>Overriding the AI.</strong> {overridingPass
                ? 'The model passed every check at ' + Math.round((claim.ai_confidence || 0) * 100) + '% confidence. Your rejection will be logged as a human override.'
                : 'The model failed at least one check at ' + Math.round((claim.ai_confidence || 0) * 100) + '% confidence. Your approval will be logged as a human override.'}
            </span>
          </div>
        )}

        <label className="admin-publish-modal__label">
          {isReject ? 'Reason (required)' : (overridingFail ? 'Reason for overriding AI (recommended)' : 'Note (optional)')}
        </label>
        <input
          className="admin-publish-modal__input"
          placeholder={isReject
            ? 'e.g. Receipt date is older than 30 days'
            : 'e.g. AI low-confidence but checked manually — looks legit'}
          value={reason}
          onChange={e => setReason(e.target.value)}
          autoFocus
        />

        <div className="admin-publish-modal__actions">
          <button className="admin-publish-modal__cancel" onClick={onCancel} disabled={updating}>
            Cancel
          </button>
          <button
            className="admin-publish-modal__confirm"
            onClick={() => onConfirm(reason.trim())}
            disabled={!canSubmit || updating}
            style={isReject ? { background: '#DC2626' } : { background: '#16A34A' }}
            title={!canSubmit ? 'Please describe why you\'re rejecting this claim' : ''}
          >
            {updating
              ? (isReject ? 'Rejecting…' : 'Approving…')
              : (isReject ? 'Reject claim →' : 'Approve & pay →')}
          </button>
        </div>
      </div>
    </div>
  );
}
