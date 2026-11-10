import { useKit } from '../kit/kitCore';
import { useBrandVoucher } from '../kit/useBrandVoucher';

/* ─────────────────────────────────────────────────────────────────────
 * A Packback reward as a MyMcDonald's coupon.
 *
 * Built from the McDonald's app's coupon screen (App Store, "Claim je
 * Coupons"): white, a back chevron, the product large in the middle, the
 * name in heavy type, then the code: a QR for the kiosk and the 4-digit
 * code to type in instead, as MyMcDonald's Rewards does, with ten
 * minutes on it. A yellow button at the bottom says Done. No staff, no
 * slider.
 * ───────────────────────────────────────────────────────────────────── */

function Chevron() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}

function Clock() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
    </svg>
  );
}

export default function McdVoucher({ reward, onClose }) {
  const { t } = useKit();
  const v = useBrandVoucher(reward, { digits: 4 });

  return (
    <div className="mcv" role="dialog" aria-modal="true" aria-label={reward.name}>
      <header className="mcv-head">
        <button type="button" className="mcv-back" aria-label={t('back')} onClick={onClose}><Chevron /></button>
      </header>

      <div className="mcv-scroll">
        <div className="mcv-art"><img src={reward.image} alt="" style={{ transform: `scale(${reward.imageScale || 1})` }} /></div>
        <h1 className="mcv-name">{reward.name}</h1>
        <p className="mcv-cost">{v.costText}</p>

        <section className="mcv-code">
          <p className="mcv-scan">{t('vScan')}</p>
          <div className="mcv-qr">{v.qr ? <img src={v.qr} alt="" /> : <span />}</div>
          <p className="mcv-or">{t('vOrCode')}</p>
          <div className="mcv-digits">{v.code.split('').map((d, i) => <span key={i}>{d}</span>)}</div>
          <p className="mcv-valid"><Clock />{t('vValid', { t: v.clock })}</p>
        </section>
        <p className="mcv-note">{t('vNote', { n: v.costText })}</p>
      </div>

      <div className="mcv-foot">
        <button type="button" className="mcv-btn" onClick={v.finish}>{t('done')}</button>
      </div>

      {v.doneAt && (
        <div className="mcv-done">
          <div className="mcv-done-art"><img src={reward.image} alt="" /></div>
          <b>{t('redeemed')}</b>
          <span className="mcv-done-what">{reward.name}</span>
          <span className="mcv-done-when">
            {v.doneAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · −{v.costText}
          </span>
          <span className="mcv-done-enjoy">{t('enjoy')}</span>
          <button type="button" className="mcv-btn" onClick={onClose}>{t('back')}</button>
        </div>
      )}
    </div>
  );
}
