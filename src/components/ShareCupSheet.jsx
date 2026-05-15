import { useState, useEffect } from 'react';
import QRCodeLib from 'qrcode';
import { shareCups } from '../lib/api';
import './ShareCupSheet.css';

// Same URL the smart-bin QR points at. The receiver's camera opens this
// → App.jsx detects the ?cups= param → activates the cups for them.
// When running on localhost, point at the local origin so the demo loop
// works without re-deploying to Vercel for every share.
const PROD_URL = 'https://packperks-v1.vercel.app/';
const APP_URL = (() => {
  if (typeof window === 'undefined') return PROD_URL;
  const origin = window.location.origin;
  return origin.startsWith('http://localhost') || origin.startsWith('http://127.')
    ? origin + '/'
    : PROD_URL;
})();

/* Two-phase sheet:
 *
 *   Phase 1 — "choose": stepper for amount, no server side-effect yet.
 *             "Cancel" closes with no changes.
 *
 *   Phase 2 — "qr":     after clicking "Share", we call the share-cups
 *             edge function which mints fresh cup UUIDs and decrements
 *             the sender's balance atomically. The returned UUIDs become
 *             the QR payload. Sender can't "undo" from here because the
 *             receiver may already have scanned.
 */
export default function ShareCupSheet({ open, onClose, cupCount, userId }) {
  const [phase, setPhase] = useState('choose'); // 'choose' | 'qr'
  const [amount, setAmount] = useState(1);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState(null);
  const [shareResult, setShareResult] = useState(null); // { cup_ids, newBalance }
  const [qrDataUrl, setQrDataUrl] = useState('');

  // Reset on close/open so the next open starts at "choose"
  useEffect(() => {
    if (open) {
      setPhase('choose');
      setAmount(1);
      setError(null);
      setShareResult(null);
      setQrDataUrl('');
      setSharing(false);
    }
  }, [open]);

  // Once we have real cup UUIDs, render the QR.
  useEffect(() => {
    if (!shareResult?.cup_ids?.length) return;
    // Use the batch_id form so the QR stays compact regardless of how
    // many cups are in the share (max-cup-share is 10 so it's a wash,
    // but consistency with the admin batch QR is nice).
    const url = shareResult.batch_id
      ? `${APP_URL}?batch=${shareResult.batch_id}`
      : `${APP_URL}?cups=${shareResult.cup_ids.join(',')}`;
    QRCodeLib.toDataURL(url, {
      width: 220,
      margin: 2,
      color: { dark: '#1D1D1D', light: '#FFFFFF' },
    }).then(setQrDataUrl).catch(() => {});
  }, [shareResult]);

  // P-46: live countdown to expires_at so the sender knows how long
  // the QR is good for. Updates every minute — the precision the
  // user actually cares about ("expires in 23h 14m" not "23h 14m 7s").
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (phase !== 'qr' || !shareResult?.expires_at) return;
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, [phase, shareResult?.expires_at]);
  const expiryLabel = (() => {
    if (!shareResult?.expires_at) return null;
    const ms = new Date(shareResult.expires_at).getTime() - now;
    if (ms <= 0) return 'Expired — ask sender to generate a fresh QR';
    const hours = Math.floor(ms / 3_600_000);
    const mins  = Math.floor((ms % 3_600_000) / 60_000);
    if (hours >= 1) return `Expires in ${hours}h ${mins}m`;
    return `Expires in ${mins} minute${mins === 1 ? '' : 's'}`;
  })();

  if (!open) return null;

  const maxAmount = Math.min(cupCount, 10);
  const canIncrease = amount < maxAmount;
  const canDecrease = amount > 1;

  async function handleShare() {
    if (!userId) {
      setError('No user session — please reload the app.');
      return;
    }
    setSharing(true);
    setError(null);
    try {
      const res = await shareCups(userId, amount);
      setShareResult(res);
      setPhase('qr');
    } catch (err) {
      console.error('share-cups failed:', err);
      setError(err?.message || 'Could not generate share QR. Please try again.');
    } finally {
      setSharing(false);
    }
  }

  function handleDone() {
    // Notify parent of the actual cup count that was shared so it can
    // refresh the local balance + history. Server already decremented
    // server-side; parent should NOT also decrement.
    onClose({ cupsShared: shareResult?.count || 0, newBalance: shareResult?.newBalance });
  }

  function handleCancel() {
    onClose({ cupsShared: 0 });
  }

  return (
    <>
      <div className="scs__backdrop" onClick={phase === 'choose' ? handleCancel : undefined} aria-hidden="true" />

      <div className="scs__sheet" role="dialog" aria-modal="true" aria-label="Share cups">
        <div className="scs__drag-handle" />

        {phase === 'choose' && (
          <>
            <div className="scs__header">
              <h2 className="scs__title">Share your cup</h2>
              <p className="scs__desc">
                A friend scans your QR — they receive your cups, you lose them from your balance.
              </p>
            </div>

            <div className="scs__stepper">
              <button
                className="scs__stepper-btn"
                onClick={() => canDecrease && setAmount(a => a - 1)}
                disabled={!canDecrease}
                aria-label="Decrease cup count"
              >
                <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                  <path d="M4 10H16" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
                </svg>
              </button>
              <div className="scs__stepper-value">
                <span className="scs__stepper-number">{amount}</span>
                <span className="scs__stepper-label">cup{amount !== 1 ? 's' : ''}</span>
              </div>
              <button
                className="scs__stepper-btn"
                onClick={() => canIncrease && setAmount(a => a + 1)}
                disabled={!canIncrease}
                aria-label="Increase cup count"
              >
                <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                  <path d="M10 4V16M4 10H16" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
                </svg>
              </button>
            </div>

            <div className="scs__notice">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <span>
                <strong>{amount} cup{amount !== 1 ? 's' : ''}</strong> will be removed from your balance once you tap Share.
              </span>
            </div>

            {error && <p className="scs__error">{error}</p>}

            <div className="scs__actions">
              <button
                className="scs__btn scs__btn--primary"
                onClick={handleShare}
                disabled={sharing}
              >
                {sharing ? 'Generating QR…' : `Share ${amount} cup${amount !== 1 ? 's' : ''}`}
              </button>
              <button className="scs__btn scs__btn--ghost" onClick={handleCancel}>
                Cancel
              </button>
            </div>
          </>
        )}

        {phase === 'qr' && shareResult && (
          <>
            <div className="scs__header">
              <h2 className="scs__title">Show this QR to your friend</h2>
              <p className="scs__desc">
                The first person to scan claims your {shareResult.count} cup{shareResult.count !== 1 ? 's' : ''}.
                Once scanned, the QR can't be used again.
              </p>
            </div>

            <div className="scs__qr-wrap">
              <div className="scs__qr-frame">
                {qrDataUrl
                  ? <img src={qrDataUrl} alt="Share QR code" width="220" height="220" />
                  : <div className="scs__qr-loading" />}
              </div>
              <p className="scs__qr-hint">Friend scans with their camera app</p>
              {expiryLabel && (
                <p className={`scs__expiry${expiryLabel.startsWith('Expired') ? ' scs__expiry--past' : ''}`}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                  {expiryLabel}
                </p>
              )}
            </div>

            <div className="scs__notice scs__notice--success">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 12L9 17L20 6"/>
              </svg>
              <span>
                {shareResult.count} cup{shareResult.count !== 1 ? 's' : ''} removed from your balance.
                New balance: <strong>{shareResult.newBalance}</strong>.
              </span>
            </div>

            <div className="scs__actions">
              <button className="scs__btn scs__btn--primary" onClick={handleDone}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
