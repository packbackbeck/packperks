import { useEffect, useMemo, useState } from 'react';
import QRCodeLib from 'qrcode';
import { pointsFor } from '../brands';
import { useKit } from './kitCore';

/* ─────────────────────────────────────────────────────────────────────
 * What a brand's own voucher needs, whatever it looks like: the QR, a
 * short code to type in, ten minutes on the clock, and Done.
 *
 * At KFC and McDonald's a reward is redeemed at the self-order kiosk:
 * the customer scans the QR there and taps Done. There is no kiosk in a
 * demo, so Done is what takes the points off the demo wallet in this
 * browser. Nothing is sent anywhere.
 * ───────────────────────────────────────────────────────────────────── */

const VALID_SECONDS = 10 * 60;

/** A stable code per reward, `digits` long. Looks real, means nothing. */
function codeFor(id, digits) {
  let h = 2166136261;
  for (const c of String(id)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return String(Math.abs(h)).padStart(digits, '7').slice(-digits);
}

export function useBrandVoucher(reward, { digits = 4 } = {}) {
  const { wallet, amount } = useKit();
  const [qr, setQr] = useState(null);
  const [left, setLeft] = useState(VALID_SECONDS);
  const [doneAt, setDoneAt] = useState(null);
  const code = useMemo(() => codeFor(reward.id, digits), [reward.id, digits]);
  const cost = pointsFor(reward);

  useEffect(() => {
    QRCodeLib.toDataURL(`packback:voucher:demo:${reward.id}:${code}`, { width: 360, margin: 0, color: { dark: '#000000', light: '#FFFFFF' } })
      .then(setQr).catch(() => {});
  }, [reward.id, code]);

  useEffect(() => {
    if (doneAt) return undefined;
    const id = setInterval(() => setLeft(s => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [doneAt]);

  const finish = () => {
    if (doneAt) return;
    try { navigator.vibrate?.([12, 40, 24]); } catch { /* not supported */ }
    wallet.redeem(reward);
    setDoneAt(new Date());
  };

  const clock = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
  return { qr, code, clock, cost, costText: amount(cost), doneAt, finish };
}
