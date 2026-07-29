import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useRegion } from '../lib/RegionContext';
import { getFailureCopy } from '../admin/lib/aiVerdictLabels';
import './ActivityDetailModal.css';

/* Claim "phase" views. A single receipt claim shows up in Activity as up to
 * three taps — the submission, then an approved OR rejected verdict — and each
 * gets its own header, tone, and body so they no longer look identical:
 *   • submitted → in-review framing, NO payout link
 *   • approved  → green, keeps the collect-cashback link
 *   • rejected  → red, lists the reasons it wasn't approved, NO payout link */
const CLAIM_PHASE = {
  submitted: {
    title: 'Receipt sent for review', tone: 'amber', icon: 'send',
    sub: "We've got your receipt — our team is reviewing it now. We'll let you know as soon as there's a verdict.",
    statusLabel: 'In review by our team', statusColor: '#B8922A',
  },
  approved: {
    title: 'Cashback approved', tone: 'green', icon: 'check',
    sub: 'Nice one — your cashback is approved and ready to collect below.',
    statusLabel: 'Approved', statusColor: '#1A8737',
  },
  rejected: {
    title: 'Cashback not approved', tone: 'red', icon: 'cross',
    sub: "We couldn't approve this claim. Here's what to check before trying again:",
    statusLabel: 'Not approved', statusColor: '#C73E1D',
  },
};

const TYPE_META = {
  cup_added:       { title: 'Cup collected',     tone: 'green',  icon: 'plus',  statusLabel: 'Added to balance',   statusColor: '#1A8737' },
  reward_claimed:  { title: 'Reward claimed',    tone: 'amber',  icon: 'check', statusLabel: 'Submitted',          statusColor: '#B8922A' },
  // E.14.5: tone was 'red' but statusColor was green — make them agree (direct
  // refund = money out → red). Title 'Cup returned' → 'Cup collected' (D.7).
  cups_withdrawn:  { title: 'Direct refund',     tone: 'red',    icon: 'minus', statusLabel: 'Refund issued',      statusColor: '#C0392B' },
  cups_shared:     { title: 'Cup shared',        tone: 'blue',   icon: 'share', statusLabel: 'Sent via QR code',   statusColor: '#1E5BB8' },
  cups_donated:    { title: 'Cups donated',      tone: 'green',  icon: 'heart', statusLabel: 'Donated',            statusColor: '#1A8737' },
};

/* For a reward_claimed activity, look up the matching claim row and
 * translate its status into user-facing copy.
 *
 * Matching is keyed on TIMESTAMP PROXIMITY, not reward name, because the
 * user may have multiple claims for the same reward (one completed, one
 * pending). Activity history and the claim row are written nearly
 * simultaneously in the same Promise.all batch, so the closest claim in
 * time is the right one. We require <60s proximity to count as a match. */
function liveStatusForClaim(item, userClaims) {
  if (item.type !== 'reward_claimed' || !Array.isArray(userClaims) || userClaims.length === 0) return null;
  if (!item.createdAt) return null;

  const activityTime = new Date(item.createdAt).getTime();
  const candidates = userClaims.filter(c => c.type === 'cashback');
  if (candidates.length === 0) return null;

  // Pick the cashback claim whose created_at is closest to this activity entry,
  // within a 60-second window. Anything outside that window is not really
  // "this claim" — better to show nothing than a misleading status.
  let bestMatch = null;
  let bestDelta = Infinity;
  for (const c of candidates) {
    const delta = Math.abs(new Date(c.created_at).getTime() - activityTime);
    if (delta < bestDelta && delta < 60_000) {
      bestDelta = delta;
      bestMatch = c;
    }
  }
  if (!bestMatch) return null;

  const tikkieUrl = bestMatch.tikkie_url || null;
  const expired = bestMatch.tikkie_status === 'expired';

  switch (bestMatch.status) {
    case 'completed':
      // "Ready" only once an admin has minted the Tikkie link. A claim the AI
      // auto-passed (completed, but no link yet) is still under human review.
      if (tikkieUrl) {
        return bestMatch.tikkie_status === 'redeemed'
          ? { label: 'Collected', color: '#1A8737', tikkieUrl, expired }
          : { label: 'Ready to collect', color: '#1A8737', tikkieUrl, expired };
      }
      return { label: 'In review by our team', color: '#B8922A' };
    case 'failed':
      return { label: 'Not approved', color: '#C73E1D' };
    case 'pending':
    default:
      return { label: 'In review by our team', color: '#B8922A' };
  }
}

function makeRefId(type, time) {
  const seed = (type + '|' + time).split('').reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0);
  const hex = Math.abs(seed).toString(36).toUpperCase().slice(0, 6).padStart(6, '0');
  return 'PP-' + hex;
}

function ToneIcon({ icon }) {
  if (icon === 'plus')  return <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><line x1="10" y1="4" x2="10" y2="16" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/><line x1="4" y1="10" x2="16" y2="10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg>;
  if (icon === 'check') return <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M4 10L8 14L16 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>;
  if (icon === 'minus') return <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><line x1="4" y1="10" x2="16" y2="10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg>;
  if (icon === 'share') return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/><line x1="15.4" y1="6.5" x2="8.6" y2="10.5"/></svg>;
  if (icon === 'heart') return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>;
  if (icon === 'send')  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>;
  if (icon === 'cross') return <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M6 6L14 14M14 6L6 14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg>;
  return null;
}

export default function ActivityDetailModal({ item, profile, userClaims, onClose }) {
  const cardRef = useRef(null);
  const { collectLabel } = useRegion();

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose?.(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!item) return null;

  // Which claim "phase" was tapped (set by UserPage): submitted / approved /
  // rejected. When present it fully re-skins the modal (title, tone, body).
  const phase = item._view || null;
  const phaseMeta = phase ? CLAIM_PHASE[phase] : null;
  const baseMeta = TYPE_META[item.type] || { title: 'Activity', tone: 'gray', icon: 'plus', statusLabel: 'Recorded', statusColor: '#1A8737' };
  const meta = phaseMeta ? { ...baseMeta, ...phaseMeta } : baseMeta;
  const refId = makeRefId(item.type, item.time);

  // For reward_claimed, the live claim status can refine the label (e.g.
  // "Collected" vs "Ready to collect") and carries the payout link.
  const liveStatus = liveStatusForClaim(item, userClaims);
  // Status line: submitted/rejected phases keep their fixed framing (never leak
  // a later verdict); the approved phase may upgrade to the live "Collected"
  // label. Non-claim activities fall back to the live/meta status as before.
  const statusLabel = phase === 'approved'
    ? (liveStatus?.label || meta.statusLabel)
    : (phaseMeta ? meta.statusLabel : (liveStatus?.label || meta.statusLabel));
  const statusColor = phase === 'approved'
    ? (liveStatus?.color || meta.statusColor)
    : (phaseMeta ? meta.statusColor : (liveStatus?.color || meta.statusColor));

  // The payout link is shown ONLY for the approved verdict (and for legacy
  // non-phase reward_claimed taps) — never on the submission or a rejection.
  const showCollect = (phase === 'approved' || !phaseMeta) && !!liveStatus?.tikkieUrl;
  // Rejection reasons, mapped from the claim's failure codes to friendly copy.
  const failureCodes = phase === 'rejected' ? (item._failureCodes || []) : [];

  function handleDownloadPdf() {
    const html = cardRef.current?.outerHTML || '';
    const w = window.open('', '_blank', 'width=420,height=720');
    if (!w) return;
    w.document.write(`<!doctype html><html><head><title>PackPerks · ${meta.title}</title>
      <style>
        body { margin:0; padding:24px; background:#FFF8F1; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        .adm-card { background:#fff; border-radius:18px; padding:24px; box-shadow:0 2px 12px rgba(0,0,0,.06); max-width:360px; margin:0 auto; }
        .adm-row { display:flex; justify-content:space-between; padding:8px 0; font-size:13px; }
        .adm-row__label { color:#7A7166; } .adm-row__val { font-weight:600; color:#1A1A1A; }
        .adm-title { font-size:18px; font-weight:800; margin:0 0 4px; }
        .adm-sub { font-size:12px; color:#7A7166; margin:0 0 18px; }
        .adm-dashed { border-top:1.5px dashed #E0DDD8; margin:14px 0; }
        @media print { body { background:#fff; } }
      </style></head><body>${html}</body></html>`);
    w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 200);
  }

  async function handleShare() {
    const text = `${meta.title}: ${item.label} (${item.time}) · Ref ${refId}`;
    if (navigator.share) {
      try { await navigator.share({ title: 'PackPerks Activity', text }); return; } catch {}
    }
    try {
      await navigator.clipboard.writeText(text);
      alert('Activity copied to clipboard');
    } catch {
      alert(text);
    }
  }

  return createPortal(
    <div className="adm-overlay" onClick={onClose}>
      <div className="adm-modal" onClick={e => e.stopPropagation()}>
        <button className="adm-close" onClick={onClose} aria-label="Close">×</button>

        <div ref={cardRef} className="adm-card">
          <div className={`adm-icon adm-icon--${meta.tone}`}>
            <ToneIcon icon={meta.icon} />
          </div>
          <h2 className="adm-title">{meta.title}</h2>
          <p className="adm-sub">{phaseMeta ? phaseMeta.sub : item.label}</p>

          <div className="adm-dashed" />

          <div className="adm-row"><span className="adm-row__label">Reference</span><span className="adm-row__val">{refId}</span></div>
          <div className="adm-row"><span className="adm-row__label">When</span><span className="adm-row__val">{item.time}</span></div>
          <div className="adm-row"><span className="adm-row__label">Type</span><span className="adm-row__val">{item.type.replace(/_/g, ' ')}</span></div>
          {profile?.displayName && <div className="adm-row"><span className="adm-row__label">Account</span><span className="adm-row__val">{profile.displayName}</span></div>}
          {profile?.email && <div className="adm-row"><span className="adm-row__label">Email</span><span className="adm-row__val">{profile.email}</span></div>}

          <div className="adm-dashed" />

          <div className="adm-row"><span className="adm-row__label">Status</span><span className="adm-row__val" style={{ color: statusColor }}>{statusLabel}</span></div>
        </div>

        {/* Rejection reasons — only on a "not approved" verdict. Mapped from the
            claim's failure codes to friendly, actionable copy. */}
        {phase === 'rejected' && (
          <div className="adm-reasons">
            <span className="adm-reasons__title">Why it wasn’t approved</span>
            {failureCodes.length > 0 ? (
              failureCodes.map(code => {
                const info = getFailureCopy(code);
                return (
                  <div key={code} className="adm-reason">
                    <span className="adm-reason__icon" aria-hidden>{info.icon}</span>
                    <span className="adm-reason__body">
                      <span className="adm-reason__title">{info.title}</span>
                      <span className="adm-reason__hint">{info.hint}</span>
                      {info.nextStep && <span className="adm-reason__next">{info.nextStep}</span>}
                    </span>
                  </div>
                );
              })
            ) : (
              <p className="adm-reason__hint">
                Our team couldn’t verify this receipt. Please try again with a clear photo of the full printed receipt, or contact support.
              </p>
            )}
          </div>
        )}

        {/* Persistent Tikkie CTA — approved verdict only. Kept outside the card
            so it isn't captured in the PDF; stays available even if the link
            has since expired. */}
        {showCollect && (
          <div className="adm-collect-wrap">
            <a className="adm-collect" href={liveStatus.tikkieUrl} target="_blank" rel="noopener noreferrer">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
              </svg>
              {collectLabel || 'Collect your cashback'}
            </a>
            {liveStatus.expired && (
              <p className="adm-collect-note">If this link no longer opens, it may have expired. Contact us and we’ll reissue it.</p>
            )}
          </div>
        )}

        <div className="adm-actions">
          <button className="adm-btn adm-btn--ghost" onClick={handleDownloadPdf}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Download PDF
          </button>
          <button className="adm-btn adm-btn--primary" onClick={handleShare}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
              <line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/><line x1="15.4" y1="6.5" x2="8.6" y2="10.5"/>
            </svg>
            Share
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
