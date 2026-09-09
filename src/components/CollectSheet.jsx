import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import QRCodeLib from 'qrcode';
import { useMoney, useRegion } from '../lib/RegionContext';
import SlideToConfirm from './SlideToConfirm';
import './CollectSheet.css';

/* ─────────────────────────────────────────────────────────────────────
 * CollectSheet — collecting an approved cashback in a region that has no
 * hosted provider page.
 *
 * The Netherlands hands the customer off to Tikkie's own site. Regions
 * whose payoutStyle is 'direct' (today: AE) have no such page — the
 * provider isn't chosen yet — so this is ours: the amount, a QR their
 * bank app would read, and a slide to send it on.
 *
 * IMPORTANT: this moves no money. Until a UAE provider is wired into
 * payments.js there is nothing to call, so the slide is a presentation of
 * the flow, not the flow itself. It deliberately says the cashback is on
 * its way rather than claiming it has landed.
 * ───────────────────────────────────────────────────────────────────── */

function Zigzag({ color }) {
  // The torn-ticket edge the reward card uses, redrawn here so the panel
  // reads as one voucher rather than two stacked boxes.
  return (
    <svg className="collect__zigzag" viewBox="0 0 320 12" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0 0 L0 6 Q8 12 16 6 T32 6 T48 6 T64 6 T80 6 T96 6 T112 6 T128 6 T144 6 T160 6 T176 6 T192 6 T208 6 T224 6 T240 6 T256 6 T272 6 T288 6 T304 6 T320 6 L320 0 Z" fill={color} />
    </svg>
  );
}

export default function CollectSheet({ amount, rewardName, reference, brandColor, onClose }) {
  const money = useMoney();
  const { currency } = useRegion();
  const [qr, setQr] = useState(null);
  const [sent, setSent] = useState(false);

  /* The org's own primary, as applied to :root by applyDesignColors — so a
   * NYUAD collect screen is violet and a La Place one is green, with no
   * per-org wiring here. Falls back to the PackPerks brown token. */
  const primary = brandColor || 'var(--pb-brown, #502314)';

  // The QR carries the payout reference a provider would settle against —
  // never an amount or an account, so a photo of this screen leaks nothing.
  const payload = useMemo(
    () => `packperks:payout:${reference || 'demo'}`,
    [reference],
  );

  useEffect(() => {
    QRCodeLib.toDataURL(payload, {
      width: 260, margin: 1,
      color: { dark: '#1F1B16', light: '#FFFFFF' },
    }).then(setQr).catch(() => {});
  }, [payload]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return createPortal((
    <div className="collect" role="dialog" aria-modal="true" aria-label="Collect your cashback">
      <div className="collect__backdrop" onClick={onClose} />
      <div className="collect__card">
        <button type="button" className="collect__close" onClick={onClose} aria-label="Close">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        <div className="collect__head" style={{ background: primary }}>
          <span className="collect__eyebrow">{sent ? 'On its way' : 'Your cashback'}</span>
          <div className="collect__amount">{money(amount)}</div>
          {rewardName && <span className="collect__reward">for your {rewardName}</span>}
        </div>
        <Zigzag color={primary} />

        {sent ? (
          <div className="collect__done">
            <div className="collect__tick" style={{ background: primary }} aria-hidden="true">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h2 className="collect__done-title">Sent to your account</h2>
            <p className="collect__done-sub">
              {money(amount)} is on its way, usually within minutes. We'll email you
              once your bank confirms it.
            </p>
            <button type="button" className="collect__btn" style={{ background: primary }} onClick={onClose}>
              Done
            </button>
          </div>
        ) : (
          <div className="collect__body">
            <div className="collect__qr-wrap">
              {qr
                ? <img className="collect__qr" src={qr} alt="Payout reference QR code" />
                : <div className="collect__qr collect__qr--empty" />}
            </div>
            <p className="collect__qr-note">Scan with your banking app</p>

            <div className="collect__or"><span>or</span></div>

            <SlideToConfirm
              label="Slide to send to my account"
              color={primary}
              onComplete={() => setSent(true)}
            />
            <p className="collect__fine">
              Paid in {currency}. We never ask for your card details.
            </p>
          </div>
        )}
      </div>
    </div>
  ), document.body);
}
