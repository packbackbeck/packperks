import { useKit } from '../kit/kitCore';
import { useBrandVoucher } from '../kit/useBrandVoucher';

/* ─────────────────────────────────────────────────────────────────────
 * A Packback reward as KFC's own app deal.
 *
 * Built from the KFC Nederland app's deal cards (App Store screenshots,
 * Nov 2026): a red art block with the bucket's white stripes along its
 * top, the deal's name in red condensed capitals, "Geldig" in grey, and
 * a red button. Below it, the QR the self-order kiosk scans, the code to
 * type in instead, and Done. No staff, no slider.
 * ───────────────────────────────────────────────────────────────────── */

const A = '/demo/kfc';

export default function KfcVoucher({ reward, onClose }) {
  const { t } = useKit();
  const v = useBrandVoucher(reward, { digits: 8 });
  const code = `${v.code.slice(0, 4)} ${v.code.slice(4)}`;

  return (
    <div className="kfv" role="dialog" aria-modal="true" aria-label={reward.name}>
      <header className="kfv-head">
        <button type="button" className="kfv-back" aria-label={t('back')} onClick={onClose}>
          <img src={`${A}/icon-back-red.png`} alt="" />
        </button>
        <img className="kfv-mark" src={`${A}/kfc-wordmark-red.png`} alt="KFC" />
      </header>

      <div className="kfv-scroll">
        <article className="kfv-card">
          <div className="kfv-art">
            <span className="kfv-stripes"><i /><i /><i /><i /></span>
            <img src={reward.image} alt="" style={{ transform: `scale(${reward.imageScale || 1})` }} />
            <span className="kfv-badge">{t('vFree')}</span>
          </div>
          <div className="kfv-info">
            <h2>{reward.name}<br />{t('vFor', { n: v.costText })}</h2>
            <span className="kfv-valid">{t('vValid', { t: v.clock })}</span>
          </div>
        </article>

        <p className="kfv-scan">{t('vScan')}</p>
        <div className="kfv-qr">{v.qr ? <img src={v.qr} alt="" /> : <span />}</div>
        <p className="kfv-or">{t('vOrCode')}</p>
        <div className="kfv-code">{code}</div>
        <p className="kfv-note">{t('vNote', { n: v.costText })}</p>
      </div>

      <div className="kfv-foot">
        <button type="button" className="kfv-btn" onClick={v.finish}>{t('done')}</button>
      </div>

      {v.doneAt && (
        <div className="kfv-done">
          <div className="kfv-done-art"><img src={reward.image} alt="" /></div>
          <b>{t('redeemed')}</b>
          <span className="kfv-done-what">{reward.name}</span>
          <span className="kfv-done-when">
            {v.doneAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · −{v.costText}
          </span>
          <span className="kfv-done-enjoy">{t('enjoy')}</span>
          <button type="button" className="kfv-btn" onClick={onClose}>{t('back')}</button>
        </div>
      )}
    </div>
  );
}
