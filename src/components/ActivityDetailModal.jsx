import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import './ActivityDetailModal.css';

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
          : { label: 'Ready — collect via Tikkie', color: '#1A8737', tikkieUrl, expired };
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
  return null;
}

export default function ActivityDetailModal({ item, profile, userClaims, onClose }) {
  const cardRef = useRef(null);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose?.(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!item) return null;
  const meta = TYPE_META[item.type] || { title: 'Activity', tone: 'gray', icon: 'plus', statusLabel: 'Recorded', statusColor: '#1A8737' };
  const refId = makeRefId(item.type, item.time);

  // For reward_claimed, the live claim status overrides the default
  // "Submitted" label so the user sees real updates from admin review.
  const liveStatus = liveStatusForClaim(item, userClaims);
  const statusLabel = liveStatus?.label || meta.statusLabel;
  const statusColor = liveStatus?.color || meta.statusColor;

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
    const text = `${meta.title} — ${item.label} (${item.time}) · Ref ${refId}`;
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
          <p className="adm-sub">{item.label}</p>

          <div className="adm-dashed" />

          <div className="adm-row"><span className="adm-row__label">Reference</span><span className="adm-row__val">{refId}</span></div>
          <div className="adm-row"><span className="adm-row__label">When</span><span className="adm-row__val">{item.time}</span></div>
          <div className="adm-row"><span className="adm-row__label">Type</span><span className="adm-row__val">{item.type.replace(/_/g, ' ')}</span></div>
          {profile?.displayName && <div className="adm-row"><span className="adm-row__label">Account</span><span className="adm-row__val">{profile.displayName}</span></div>}
          {profile?.email && <div className="adm-row"><span className="adm-row__label">Email</span><span className="adm-row__val">{profile.email}</span></div>}

          <div className="adm-dashed" />

          <div className="adm-row"><span className="adm-row__label">Status</span><span className="adm-row__val" style={{ color: statusColor }}>{statusLabel}</span></div>
        </div>

        {/* Persistent Tikkie CTA — stays available from the activity record
            forever, even after the pending block is gone and even if the link
            has expired (kept outside the card so it isn't captured in the PDF). */}
        {liveStatus?.tikkieUrl && (
          <div className="adm-collect-wrap">
            <a className="adm-collect" href={liveStatus.tikkieUrl} target="_blank" rel="noopener noreferrer">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
              </svg>
              Collect via Tikkie
            </a>
            {liveStatus.expired && (
              <p className="adm-collect-note">If this link no longer opens, it may have expired — contact us and we’ll reissue it.</p>
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
