import { useEffect, useRef, useState } from 'react';
import QRCodeLib from 'qrcode';
import SlideToConfirm from '../../components/SlideToConfirm';
import { pointsFor } from '../brands';
import { euro } from '../i18n';
import { CupSvg } from './icons';
import { useKit } from './kitCore';
import '../../components/VoucherPage.css';

/* ─────────────────────────────────────────────────────────────────────
 * The PackPerks slider voucher (Packback's counter voucher), as a demo.
 *
 * Same card, same stylesheet and the same SlideToConfirm as the real
 * VoucherPage (src/components), so a demo shows exactly what a customer
 * would hold up at the counter. The one difference is what the slide
 * does: VoucherPage calls redeem_voucher, this takes the points off the
 * demo wallet in this browser. The brand's colours go in through the
 * same --pb-* variables the customer app sets from Client app → Colours.
 * ───────────────────────────────────────────────────────────────────── */

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* The card's tilt: copied from VoucherPage, which keeps it private. One
 * rAF loop eases toward the pointer (or a slow idle sway) and writes the
 * custom properties straight to the element. */
function useTilt(ref) {
  const target = useRef({ x: 0, y: 0 });
  const src = useRef('idle');
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const onMove = (e) => {
      const r = el.getBoundingClientRect();
      src.current = 'pointer';
      target.current = {
        x: clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1),
        y: -clamp(((e.clientY - r.top) / r.height) * 2 - 1, -1, 1),
      };
    };
    const onLeave = () => { src.current = 'idle'; };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const t0 = performance.now();
    let cur = { x: 0, y: 0 };
    let raf = 0;
    const frame = (now) => {
      if (src.current === 'idle' && !reduced) {
        const t = (now - t0) / 1000;
        target.current = { x: Math.sin(t * 0.34) * 0.34, y: Math.sin(t * 0.23 + 1.2) * 0.26 };
      }
      cur = { x: cur.x + (target.current.x - cur.x) * 0.12, y: cur.y + (target.current.y - cur.y) * 0.12 };
      const node = ref.current;
      if (node) {
        node.style.setProperty('--rx', `${(cur.y * 7).toFixed(2)}deg`);
        node.style.setProperty('--ry', `${(cur.x * 9).toFixed(2)}deg`);
        node.style.setProperty('--px', `${(50 + cur.x * 38).toFixed(1)}%`);
        node.style.setProperty('--py', `${(50 - cur.y * 38).toFixed(1)}%`);
        node.style.setProperty('--sx', `${(-cur.x * 16).toFixed(1)}px`);
        node.style.setProperty('--sy', `${(cur.y * 16 + 14).toFixed(1)}px`);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      cancelAnimationFrame(raf);
    };
  }, [ref]);
}

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function DemoVoucher({ reward, onClose }) {
  const { brand, wallet, t, lang, amount } = useKit();
  const cardRef = useRef(null);
  useTilt(cardRef);
  const clock = useClock();
  const [qr, setQr] = useState(null);
  const [staffStep, setStaffStep] = useState(false);
  const [progress, setProgress] = useState(0);
  const [doneAt, setDoneAt] = useState(null);
  const cost = pointsFor(reward);
  const v = brand.kit.voucher;

  useEffect(() => {
    QRCodeLib.toDataURL(`packperks:voucher:demo:${reward.id}`, { width: 280, margin: 1, color: { dark: '#1F1B16', light: '#FFFFFF' } })
      .then(setQr).catch(() => {});
  }, [reward.id]);

  function handleComplete() {
    try { navigator.vibrate?.([12, 40, 24]); } catch { /* not supported */ }
    wallet.redeem(reward);
    setDoneAt(new Date());
  }

  return (
    <div className="hv ppd-hv" style={{
      '--vp': progress, '--pb-brown': v.brown, '--pb-orange': v.orange, '--pb-cream': v.cream, '--black': v.black,
    }}>
      <div className="hv__bg" aria-hidden="true">
        <span className="hv__wash hv__wash--l" />
        <span className="hv__wash hv__wash--r" />
        <span className="hv__lattice" />
        <svg className="hv__rosette" viewBox="0 0 400 400" preserveAspectRatio="xMidYMid meet">
          <g className="hv__rosette-spin">
            {[52, 78, 104, 130, 156, 182].map(r => <circle key={r} cx="200" cy="200" r={r} />)}
            {Array.from({ length: 24 }, (_, i) => {
              const a = (i * Math.PI * 2) / 24;
              return <line key={i} x1={200 + Math.cos(a) * 52} y1={200 + Math.sin(a) * 52} x2={200 + Math.cos(a) * 182} y2={200 + Math.sin(a) * 182} />;
            })}
          </g>
          <circle className="hv__rosette-hub" cx="200" cy="200" r="30" />
        </svg>
        <svg className="hv__arcs" viewBox="0 0 400 200" preserveAspectRatio="none">
          {[0, 1, 2, 3].map(i => <path key={i} d={`M0 ${40 + i * 22} Q200 ${-40 + i * 22} 400 ${40 + i * 22}`} />)}
        </svg>
        <svg className="hv__arcs hv__arcs--b" viewBox="0 0 400 200" preserveAspectRatio="none">
          {[0, 1, 2, 3].map(i => <path key={i} d={`M0 ${160 - i * 22} Q200 ${240 - i * 22} 400 ${160 - i * 22}`} />)}
        </svg>
        <span className="hv__grain" />
      </div>

      <header className="hv__bar">
        <button type="button" className="hv__close" onClick={onClose} aria-label={t('close')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        <span className="hv__clock">{clock}</span>
      </header>

      <main className="hv__body">
        <div className="hv__stage">
          <div className="hv__card" ref={cardRef}>
            <div className="hv__row">
              <div className="hv__tile ppd-hv-tile">
                <img className="hv__img" src={reward.image} alt="" style={{ transform: `scale(${reward.imageScale || 1})` }} />
              </div>
              <div className="hv__meta">
                <span className="hv__eyebrow">{brand.name}</span>
                <h1 className="hv__name">{reward.name}</h1>
                <div className="hv__amount">{euro(lang, reward.euros)}</div>
              </div>
            </div>
            <div className="hv__qr-wrap">
              {qr ? <img className="hv__qr" src={qr} alt="" /> : <div className="hv__qr" />}
            </div>
            <div className="hv__holder">
              <div className="hv__who">
                <span className="hv__avatar ppd-hv-avatar">B</span>
                <span className="hv__holder-name">Beke</span>
              </div>
              <span className="hv__balance"><strong>{wallet.points}</strong> {t(wallet.points === 1 ? 'unitOne' : 'unit')}</span>
            </div>
            <span className="hv__foil" aria-hidden="true" />
            <span className="hv__glare" aria-hidden="true" />
            <span className="hv__edge" aria-hidden="true" />
          </div>
        </div>

        {!staffStep ? (
          <button type="button" className="hv__cta" onClick={() => setStaffStep(true)}>{t('showStaff')}</button>
        ) : (
          <div className="hv__staff">
            <p className="hv__staff-note" dangerouslySetInnerHTML={{ __html: t('staffNote', { n: amount(cost) }) }} />
            <SlideToConfirm label={doneAt ? t('redeeming') : t('slide')} color={v.brown}
              disabled={!!doneAt} onProgress={setProgress} onComplete={handleComplete} />
          </div>
        )}
      </main>

      {doneAt && (
        <div className="ppd-hv-done" onClick={onClose}>
          <div className="ppd-hv-check"><CupSvg /></div>
          <b>{t('redeemed')}</b>
          <span className="ppd-hv-what">{reward.name}</span>
          <span className="ppd-hv-when">
            {doneAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · −{cost} {t('unitShort')}
          </span>
          <span className="ppd-hv-enjoy">{t('enjoy')}</span>
          <button type="button" className="ppd-btn">{t('done')}</button>
        </div>
      )}
    </div>
  );
}
