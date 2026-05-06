import { useMemo, useState, useEffect } from 'react';
import QRCodeLib from 'qrcode';
import './ShareCupSheet.css';

/* Generate a stable share token per session+amount combo */
function makeShareUrl(amount) {
  const token = [
    Date.now().toString(36).toUpperCase(),
    Math.random().toString(36).slice(2, 7).toUpperCase(),
  ].join('-');
  return `https://packperks.nl/claim-cup?token=${token}&cups=${amount}`;
}

export default function ShareCupSheet({ open, onClose, cupCount }) {
  const [amount, setAmount] = useState(1);
  const [qrDataUrl, setQrDataUrl] = useState('');

  // Generate a new QR URL every time amount changes
  const shareUrl = useMemo(() => makeShareUrl(amount), [amount]);

  // Render QR to PNG data URL (works offline, no React version issues)
  useEffect(() => {
    if (!open) return;
    QRCodeLib.toDataURL(shareUrl, {
      width: 192,
      margin: 2,
      color: { dark: '#1D1D1D', light: '#FFFFFF' },
    }).then(setQrDataUrl).catch(() => {});
  }, [shareUrl, open]);

  if (!open) return null;

  const maxAmount = Math.min(cupCount, 10);
  const canIncrease = amount < maxAmount;
  const canDecrease = amount > 1;

  const handleDone = () => onClose(amount);   // deduct cups
  const handleCancel = () => onClose(0);       // no deduction

  return (
    <>
      <div className="scs__backdrop" onClick={handleCancel} aria-hidden="true" />

      <div className="scs__sheet" role="dialog" aria-modal="true" aria-label="Share cups">
        <div className="scs__drag-handle" />

        {/* Header */}
        <div className="scs__header">
          <h2 className="scs__title">Share your cup</h2>
          <p className="scs__desc">
            Let a friend scan this QR code — they'll receive your cups and can use them to claim their own reward.
          </p>
        </div>

        {/* Amount stepper */}
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

        {/* QR Code */}
        <div className="scs__qr-wrap">
          <div className="scs__qr-frame">
            {qrDataUrl
              ? <img src={qrDataUrl} alt="Share QR code" width="192" height="192" />
              : <div className="scs__qr-loading" />}
          </div>
          <p className="scs__qr-hint">Friend scans with their camera app</p>
        </div>

        {/* Deduction notice */}
        <div className="scs__notice">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span>
            <strong>{amount} cup{amount !== 1 ? 's' : ''}</strong> will be removed from your balance
            when you close this screen
          </span>
        </div>

        {/* CTAs */}
        <div className="scs__actions">
          <button className="scs__btn scs__btn--primary" onClick={handleDone}>
            Done — share {amount} cup{amount !== 1 ? 's' : ''}
          </button>
          <button className="scs__btn scs__btn--ghost" onClick={handleCancel}>
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}
