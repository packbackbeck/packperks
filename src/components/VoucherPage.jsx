import { useEffect, useMemo, useState } from 'react';
import QRCodeLib from 'qrcode';
import { useMoney } from '../lib/RegionContext';
import { redeemVoucher } from '../lib/api';
import SlideToConfirm from './SlideToConfirm';
import ActivityDetailModal from './ActivityDetailModal';
import './VoucherPage.css';

/* ─────────────────────────────────────────────────────────────────────
 * VoucherPage — the counter-voucher way of settling a reward.
 *
 * No receipt, no AI check, no payout link. The customer holds this
 * screen up; the staff member presses the button, slides, and the cups
 * come off the balance right there. One atomic RPC (redeem_voucher)
 * does the taking and the recording, then the same receipt popup the
 * activity list uses shows what just happened.
 *
 * The background is alive on purpose: a screenshot can't move, so a
 * moving voucher is one that's really open on a phone right now. It
 * also answers the slide — the further staff drag, the more it glows.
 * ───────────────────────────────────────────────────────────────────── */

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function VoucherPage({ reward, org, userId, profile, onDone, onBack }) {
  const money = useMoney();
  const clock = useClock();
  const [qr, setQr] = useState(null);
  const [staffStep, setStaffStep] = useState(false);   // after "Show this to the staff"
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [receipt, setReceipt] = useState(null);         // { item, claim } once redeemed

  const cups = reward?.cupsNeeded || 0;
  const amount = Number(reward?.euros ?? 0);

  // The QR is a reference, not a secret: who and what, so a scanner-based
  // till could reconcile it later. No amount, no account.
  const payload = useMemo(
    () => `packperks:voucher:${userId || 'anon'}:${reward?.id || ''}`,
    [userId, reward?.id],
  );
  useEffect(() => {
    QRCodeLib.toDataURL(payload, { width: 300, margin: 1, color: { dark: '#1F1B16', light: '#FFFFFF' } })
      .then(setQr).catch(() => {});
  }, [payload]);

  // The page owns the viewport while open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  async function handleComplete() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try { navigator.vibrate?.([12, 40, 24]); } catch { /* not supported */ }
    try {
      const res = await redeemVoucher(userId, {
        orgId: org?.id,
        rewardId: reward.id,
        cups,
        amount,
        label: `Redeemed: ${reward.name}`,
      });
      const at = res?.redeemed_at || new Date().toISOString();
      const claim = {
        id: res?.claim_id,
        type: 'voucher',
        status: 'completed',
        reward_id: reward.id,
        cups_redeemed: cups,
        payout_amount: amount,
        created_at: at,
        approved_at: at,
        rewardName: reward.name,
      };
      const item = {
        type: 'reward_claimed',
        _view: 'redeemed',
        label: `Redeemed: ${reward.name}`,
        rewardName: reward.name,
        createdAt: at,
        time: new Date(at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
        storeName: org?.partner_brand_name || org?.name || null,
      };
      setReceipt({ item, claim, newBalance: res?.new_balance });
    } catch (e) {
      const msg = String(e?.message || e?.details || '');
      setError(
        /insufficient_cups|no_balance/.test(msg)
          ? 'Not enough cups on this balance for this reward.'
          : /reward_budget_exceeded/.test(msg)
            ? 'Rewards are paused at this venue right now.'
            : 'Could not redeem just now. Please try again.',
      );
      setBusy(false);
    }
  }

  const primary = 'var(--pb-brown, #502314)';

  return (
    <div className="voucher" style={{ '--vp': progress }}>
      {/* ── The living background ── */}
      <div className="voucher__sky" aria-hidden="true">
        <span className="voucher__blob voucher__blob--a" />
        <span className="voucher__blob voucher__blob--b" />
        <span className="voucher__blob voucher__blob--c" />
        <span className="voucher__blob voucher__blob--d" />
        <span className="voucher__sweep" />
        <span className="voucher__glow" />
        <span className="voucher__grain" />
      </div>

      {/* ── Chrome ── */}
      <header className="voucher__bar">
        <button type="button" className="voucher__close" onClick={receipt ? onDone : onBack} aria-label="Close">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        <span className="voucher__clock" aria-live="off">{clock}</span>
      </header>

      {/* ── The reward ── */}
      <main className="voucher__body">
        <div className="voucher__tile" style={{ background: reward?.bgColor || primary }}>
          {reward?.image && <img className="voucher__img" src={reward.image} alt="" />}
        </div>
        <h1 className="voucher__name">{reward?.name}</h1>
        <div className="voucher__amount">{money(amount)}</div>

        <div className="voucher__qr-card">
          {qr ? <img className="voucher__qr" src={qr} alt="Voucher code" /> : <div className="voucher__qr" />}
        </div>

        {!staffStep ? (
          <button type="button" className="voucher__cta" onClick={() => setStaffStep(true)}>
            Show this to the staff at the counter
          </button>
        ) : (
          <div className="voucher__staff">
            <p className="voucher__staff-note">
              Sliding takes <strong>{cups} cup{cups === 1 ? '' : 's'}</strong> from this balance.
            </p>
            <SlideToConfirm
              label={busy ? 'Redeeming…' : 'Slide to redeem'}
              color={primary}
              disabled={busy}
              onProgress={setProgress}
              onComplete={handleComplete}
            />
            {error && <p className="voucher__err">{error}</p>}
            {!busy && (
              <button type="button" className="voucher__cancel" onClick={() => { setStaffStep(false); setProgress(0); }}>
                Not now
              </button>
            )}
          </div>
        )}
      </main>

      {/* ── The receipt: the same popup Activity opens ── */}
      {receipt && (
        <ActivityDetailModal
          item={receipt.item}
          profile={profile}
          userClaims={[receipt.claim]}
          onClose={() => onDone?.(receipt)}
        />
      )}
    </div>
  );
}
