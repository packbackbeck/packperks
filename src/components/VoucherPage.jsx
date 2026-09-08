import { useEffect, useMemo, useRef, useState } from 'react';
import QRCodeLib from 'qrcode';
import { useMoney } from '../lib/RegionContext';
import { animalForProfile } from '../lib/animals';
import { redeemVoucher } from '../lib/api';
import SlideToConfirm from './SlideToConfirm';
import './VoucherPage.css';

/* ─────────────────────────────────────────────────────────────────────
 * VoucherPage — the counter-voucher way of settling a reward.
 *
 * No receipt, no AI check, no payout link. The customer holds this
 * screen up; the staff member presses the button, slides, and the cups
 * come off the balance right there — one atomic RPC (redeem_voucher).
 * When the slide lands we hand straight back to the home screen, where
 * the receipt popup opens on top.
 *
 * The card is a physical object: it tilts with the phone (gyroscope on
 * mobile, pointer on desktop, a slow idle sway when there's neither), a
 * foil sheen and a glare move across it, and its shadow moves the other
 * way. That is what a screenshot can't do — and it's why staff can trust
 * what they're looking at. Behind it, the background stays quiet: fine
 * hairlines, a few long rules, and rings that drift.
 * ───────────────────────────────────────────────────────────────────── */

/* iOS 13+ only hands out orientation data after an explicit request that
 * must run inside a user gesture. App calls this from the tap that opens
 * the voucher; everywhere else it's a no-op that resolves true. */
let motionGranted = null;
export async function requestMotionPermission() {
  try {
    const DOE = window.DeviceOrientationEvent;
    if (DOE && typeof DOE.requestPermission === 'function') {
      const res = await DOE.requestPermission();
      motionGranted = res === 'granted';
    } else {
      motionGranted = true;
    }
  } catch {
    motionGranted = false;
  }
  return motionGranted;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* Tilt as a pair in [-1, 1]. Gyroscope first; pointer while the mouse is
 * over the card; otherwise a slow figure-of-eight so the foil still lives. */
function useTilt(ref) {
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const srcRef = useRef('idle');      // 'gyro' | 'pointer' | 'idle'
  const rafRef = useRef(0);
  const baseRef = useRef(null);       // the resting orientation, so "flat" is wherever the phone started

  useEffect(() => {
    let last = 0;
    const onOrient = (e) => {
      if (e.beta == null || e.gamma == null) return;
      const now = performance.now();
      if (now - last < 16) return;    // ~60fps cap
      last = now;
      if (!baseRef.current) baseRef.current = { beta: e.beta, gamma: e.gamma };
      const b = clamp((e.beta - baseRef.current.beta) / 28, -1, 1);
      const g = clamp((e.gamma - baseRef.current.gamma) / 28, -1, 1);
      srcRef.current = 'gyro';
      setTilt({ x: g, y: -b });
    };
    window.addEventListener('deviceorientation', onOrient, true);

    const el = ref.current;
    const onMove = (e) => {
      if (srcRef.current === 'gyro') return;
      const r = el.getBoundingClientRect();
      srcRef.current = 'pointer';
      setTilt({
        x: clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1),
        y: clamp(((e.clientY - r.top) / r.height) * 2 - 1, -1, 1) * -1,
      });
    };
    const onLeave = () => { if (srcRef.current === 'pointer') srcRef.current = 'idle'; };
    el?.addEventListener('pointermove', onMove);
    el?.addEventListener('pointerleave', onLeave);

    const t0 = performance.now();
    const idle = (now) => {
      if (srcRef.current === 'idle') {
        const t = (now - t0) / 1000;
        setTilt({ x: Math.sin(t * 0.55) * 0.45, y: Math.sin(t * 0.38 + 1.2) * 0.35 });
      }
      rafRef.current = requestAnimationFrame(idle);
    };
    rafRef.current = requestAnimationFrame(idle);

    return () => {
      window.removeEventListener('deviceorientation', onOrient, true);
      el?.removeEventListener('pointermove', onMove);
      el?.removeEventListener('pointerleave', onLeave);
      cancelAnimationFrame(rafRef.current);
    };
  }, [ref]);

  return tilt;
}

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const AVATAR_KEY = 'packperks_profile_avatar';

export default function VoucherPage({ reward, org, userId, profile, cupCount = 0, onDone, onBack }) {
  const money = useMoney();
  const clock = useClock();
  const cardRef = useRef(null);
  const tilt = useTilt(cardRef);
  const [qr, setQr] = useState(null);
  const [staffStep, setStaffStep] = useState(false);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const cups = reward?.cupsNeeded || 0;
  const amount = Number(reward?.euros ?? 0);
  const animal = useMemo(() => animalForProfile(profile), [profile]);
  // The same photo the profile page uses, if this device has one set.
  const avatarUrl = useMemo(() => {
    try { return localStorage.getItem(AVATAR_KEY) || null; } catch { return null; }
  }, []);

  // A reference, not a secret: who and what. No amount, no account.
  const payload = useMemo(
    () => `packperks:voucher:${userId || 'anon'}:${reward?.id || ''}`,
    [userId, reward?.id],
  );
  useEffect(() => {
    QRCodeLib.toDataURL(payload, { width: 280, margin: 1, color: { dark: '#1F1B16', light: '#FFFFFF' } })
      .then(setQr).catch(() => {});
  }, [payload]);

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
        orgId: org?.id, rewardId: reward.id, cups, amount, label: `Redeemed: ${reward.name}`,
      });
      const at = res?.redeemed_at || new Date().toISOString();
      const claim = {
        id: res?.claim_id, type: 'voucher', status: 'completed', reward_id: reward.id,
        cups_redeemed: cups, payout_amount: amount, created_at: at, approved_at: at, rewardName: reward.name,
      };
      const item = {
        type: 'reward_claimed', _view: 'redeemed', label: `Redeemed: ${reward.name}`,
        rewardName: reward.name, createdAt: at,
        time: new Date(at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
        storeName: org?.partner_brand_name || org?.name || null,
      };
      onDone?.({ item, claim, newBalance: res?.new_balance });
    } catch (e) {
      const msg = String(e?.message || e?.details || '');
      setError(
        /insufficient_cups|no_balance/.test(msg) ? 'Not enough cups on this balance for this reward.'
          : /reward_budget_exceeded/.test(msg) ? 'Rewards are paused at this venue right now.'
            : 'Could not redeem just now. Please try again.',
      );
      setBusy(false);
    }
  }

  const primary = 'var(--pb-brown, #502314)';
  // Tilt → card rotation, sheen position, glare position, shadow offset.
  const style = {
    '--vp': progress,
    '--rx': `${(tilt.y * 9).toFixed(2)}deg`,
    '--ry': `${(tilt.x * 11).toFixed(2)}deg`,
    '--px': `${(50 + tilt.x * 40).toFixed(1)}%`,
    '--py': `${(50 - tilt.y * 40).toFixed(1)}%`,
    '--sx': `${(-tilt.x * 22).toFixed(1)}px`,
    '--sy': `${(tilt.y * 22 + 18).toFixed(1)}px`,
  };

  return (
    <div className="hv" style={style}>
      {/* ── Quiet background: hairlines, rules, drifting rings ── */}
      <div className="hv__bg" aria-hidden="true">
        {/* Symmetrical, printed-security feel: a centred rosette of rings and
            spokes, a mirrored pair of arcs top and bottom, a crosshatch
            lattice, and two colour washes. Only the rosette turns. */}
        <span className="hv__wash hv__wash--l" />
        <span className="hv__wash hv__wash--r" />
        <span className="hv__lattice" />
        <svg className="hv__rosette" viewBox="0 0 400 400" preserveAspectRatio="xMidYMid meet">
          <g className="hv__rosette-spin">
            {[52, 78, 104, 130, 156, 182].map(r => <circle key={r} cx="200" cy="200" r={r} />)}
            {Array.from({ length: 24 }, (_, i) => {
              const a = (i * Math.PI * 2) / 24;
              return (
                <line
                  key={i}
                  x1={200 + Math.cos(a) * 52} y1={200 + Math.sin(a) * 52}
                  x2={200 + Math.cos(a) * 182} y2={200 + Math.sin(a) * 182}
                />
              );
            })}
          </g>
          <circle className="hv__rosette-hub" cx="200" cy="200" r="30" />
        </svg>
        <svg className="hv__arcs" viewBox="0 0 400 200" preserveAspectRatio="none">
          {[0, 1, 2, 3].map(i => (
            <path key={i} d={`M0 ${40 + i * 22} Q200 ${-40 + i * 22} 400 ${40 + i * 22}`} />
          ))}
        </svg>
        <svg className="hv__arcs hv__arcs--b" viewBox="0 0 400 200" preserveAspectRatio="none">
          {[0, 1, 2, 3].map(i => (
            <path key={i} d={`M0 ${160 - i * 22} Q200 ${240 - i * 22} 400 ${160 - i * 22}`} />
          ))}
        </svg>
        <span className="hv__grain" />
      </div>

      <header className="hv__bar">
        <button type="button" className="hv__close" onClick={onBack} aria-label="Close">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        <span className="hv__clock">{clock}</span>
      </header>

      <main className="hv__body">
        {/* ── The card ── */}
        <div className="hv__stage">
          <div className="hv__card" ref={cardRef}>
            <div className="hv__row">
              <div className="hv__tile">
                {reward?.image && <img className="hv__img" src={reward.image} alt="" />}
              </div>
              <div className="hv__meta">
                <span className="hv__eyebrow">{org?.partner_brand_name || org?.name}</span>
                <h1 className="hv__name">{reward?.name}</h1>
                <div className="hv__amount">{money(amount)}</div>
              </div>
            </div>
            <div className="hv__qr-wrap">
              {qr ? <img className="hv__qr" src={qr} alt="Voucher code" /> : <div className="hv__qr" />}
            </div>

            {/* Whose voucher it is, and what it leaves behind — so staff can
                match the phone to the person in front of them. */}
            <div className="hv__holder">
              <div className="hv__who">
                <span className="hv__avatar" style={avatarUrl ? undefined : { background: animal.bg }}>
                  {avatarUrl
                    ? <img className="hv__avatar-img" src={avatarUrl} alt="" />
                    : <span aria-hidden="true">{animal.emoji}</span>}
                </span>
                <span className="hv__holder-name">{profile?.displayName || 'PackPerks member'}</span>
              </div>
              <span className="hv__balance">
                <strong>{cupCount}</strong> cup{cupCount === 1 ? '' : 's'}
              </span>
            </div>
            <span className="hv__foil" aria-hidden="true" />
            <span className="hv__glare" aria-hidden="true" />
            <span className="hv__edge" aria-hidden="true" />
          </div>
        </div>

        {!staffStep ? (
          <button type="button" className="hv__cta" onClick={() => setStaffStep(true)}>
            Show this to the staff at the counter
          </button>
        ) : (
          <div className="hv__staff">
            <p className="hv__staff-note">
              Sliding takes <strong>{cups} cup{cups === 1 ? '' : 's'}</strong> from this balance.
            </p>
            <SlideToConfirm
              label={busy ? 'Redeeming…' : 'Slide to redeem'}
              color={primary}
              disabled={busy}
              onProgress={setProgress}
              onComplete={handleComplete}
            />
            {error && <p className="hv__err">{error}</p>}
          </div>
        )}
      </main>
    </div>
  );
}
