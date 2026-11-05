import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import QRCodeLib from 'qrcode';
import { nextReward, pointsFor, sortRewards } from '../brands';
import { euro } from '../i18n';
import packbackLogo from '../../assets/images/packback-logo.svg';
import DemoVoucher from './DemoVoucher';
import { CupSvg, StarSvg } from './icons';
import { cls, useKit } from './kitCore';
import './kit.css';

/* ─────────────────────────────────────────────────────────────────────
 * The Packback kit: the parts Packback adds to a brand's app.
 *
 * One set of components for every brand. Each brand app supplies its own
 * palette (brand.kit → --ppd-* variables) and places the parts where its
 * screens have room; the sheets, the voucher and the notices live in
 * <PackbackLayer/>, which every brand app renders inside its screen.
 * ───────────────────────────────────────────────────────────────────── */

function Qr({ value, className }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    QRCodeLib.toDataURL(value, { width: 240, margin: 0, color: { dark: '#1F1B16', light: '#FFFFFF' } })
      .then(setSrc).catch(() => {});
  }, [value]);
  return src ? <img className={className} src={src} alt="" /> : <span className={className} />;
}

/* ── Small parts the brand apps place themselves ── */

/** "Packback × <brand>", as the live app's header shows it. */
export function BrandRow({ logo, logoClass }) {
  return (
    <span className="ppd-brand">
      <img className="ppd-packback" src={packbackLogo} alt="Packback" />×<img className={logoClass} src={logo} alt="" />
    </span>
  );
}

/** The two tiles from the live app: return a cup, and the balance. */
export function Tiles() {
  const { wallet, t, openSheet } = useKit();
  return (
    <span className="ppd-tiles">
      <button type="button" className="ppd-tile is-add" aria-label={t('returnCup')} onClick={() => openSheet('scan')}>+</button>
      <button type="button" className="ppd-tile" aria-label={t('yourBalance')} onClick={() => openSheet('wallet')}>
        <b>{wallet.points}</b><small>{t('unitShort')}</small>
      </button>
    </span>
  );
}

/** A slot per cup of the next reward, then a star for the reward. Rewards
 * that need more than nine cups get two rows, filled top row first, as the
 * live app's CupProgress does. */
export function CupTrack() {
  const { wallet, rewards, fresh, freshKey, ppc } = useKit();
  const ref = useRef(null);
  const [fills, setFills] = useState([0, 0]);
  const byCost = [...rewards].sort((a, b) => pointsFor(a) - pointsFor(b));
  const goal = nextReward(rewards, wallet.points) || byCost[byCost.length - 1];
  const slots = goal?.cupsNeeded || 0;
  const have = Math.min(Math.floor(wallet.points / ppc), slots);
  const rowCount = slots + 1 > 10 ? 2 : 1;
  const perRow = Math.ceil((slots + 1) / rowCount);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      setFills([...el.querySelectorAll('.ppd-track-row')].map((row) => {
        const full = row.querySelectorAll('.ppd-slot.is-full:not(.is-star)');
        const last = full[full.length - 1];
        return last ? last.offsetLeft + last.offsetWidth + 10 : 0;
      }).concat([0, 0]).slice(0, 2));
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [have, slots]);

  if (!goal) return null;
  const items = [
    ...Array.from({ length: slots }, (_, i) => (
      <span key={`${goal.id}-${i}-${i === have - 1 ? freshKey : 0}`}
        className={cls('ppd-slot', i < have && 'is-full', fresh && i === have - 1 && 'is-new')}>
        <CupSvg />
      </span>
    )),
    <span key="star" className={cls('ppd-slot', 'is-star', wallet.points >= pointsFor(goal) && 'is-full')}><StarSvg /></span>,
  ];
  return (
    <div className={cls('ppd-track', rowCount === 2 && 'is-two')} ref={ref}
      role="img" aria-label={`${wallet.points} / ${pointsFor(goal)}`}>
      {Array.from({ length: rowCount }, (_, r) => (
        <div className="ppd-track-row" key={r}>
          <div className="ppd-fill" style={{ width: fills[r] }} />
          <div className="ppd-slots">{items.slice(r * perRow, (r + 1) * perRow)}</div>
        </div>
      ))}
    </div>
  );
}

/** "Nog 20 punten tot Big Mac". */
export function NextNote({ className }) {
  const { wallet, rewards, t, amount } = useKit();
  const n = nextReward(rewards, wallet.points);
  return (
    <div className={cls('ppd-note', className)}>
      <span className="ppd-note-cup"><CupSvg /></span>
      {n ? <span>{t('toGo', { n: amount(pointsFor(n) - wallet.points) })} <b>{n.name}</b></span> : <span>{t('allIn')}</span>}
    </div>
  );
}

export function RewardCard({ reward }) {
  const { wallet, rewards, t, lang, openReward } = useKit();
  const cost = pointsFor(reward);
  const can = wallet.points >= cost;
  const almost = nextReward(rewards, wallet.points)?.id === reward.id;
  return (
    <article className="ppd-reward">
      <div className="img">
        <img src={reward.image} alt="" loading="lazy" style={{ transform: `scale(${reward.imageScale || 1})` }} />
        {almost && <span className="ppd-tag">{t('almost')}</span>}
      </div>
      <h4>{reward.name}</h4>
      <span className="ppd-price">{euro(lang, reward.euros)} · {cost} {t('unitShort')}</span>
      <button type="button" className={cls('ppd-go', can && 'is-ready')} onClick={() => openReward(reward)}>
        {!can && <i style={{ width: `${Math.max(0, Math.min(100, (wallet.points / cost) * 100))}%` }} />}
        <span>{can ? t('redeem') : `${wallet.points}/${cost}`}</span>
      </button>
    </article>
  );
}

/** Every reward, smart-sorted, as a horizontal rail or a two-column grid. */
export function RewardList({ layout = 'rail' }) {
  const { wallet, rewards } = useKit();
  return (
    <div className={cls('ppd-rewards', layout === 'grid' ? 'is-grid' : 'is-rail')}>
      {sortRewards(rewards, wallet.points).map(r => <RewardCard key={r.id} reward={r} />)}
    </div>
  );
}

/* ── Sheets, the voucher and notices ── */

function ago(at, t) {
  const m = Math.round((Date.now() - at) / 60000);
  return m < 1 ? t('justNow') : t('minutesAgo', { n: m });
}

function Sheet({ open, onClose, children }) {
  return (
    <div className={cls('ppd-sheet-wrap', open && 'is-open')} aria-hidden={!open}>
      <div className="ppd-sheet-dim" onClick={onClose} />
      <div className="ppd-sheet" role="dialog" aria-modal="true">
        <div className="ppd-grab" />
        {children}
      </div>
    </div>
  );
}

function WalletBody() {
  const { wallet, t, openSheet, closeSheet, goRewards } = useKit();
  return (
    <>
      <img className="ppd-sheet-logo" src={packbackLogo} alt="Packback" />
      <div className="ppd-big"><b>{wallet.points}</b><span>{t(wallet.points === 1 ? 'unitOne' : 'unit')}</span></div>
      <NextNote className="is-center" />
      <CupTrack />
      <div className="ppd-steps">
        <div><b>1</b>{t('step1')}</div>
        <div><b>2</b>{t('step2')}</div>
        <div><b>3</b>{t('step3')}</div>
      </div>
      <div className="ppd-btn-row">
        <button type="button" className="ppd-btn is-dark" onClick={() => openSheet('scan')}>{t('returnCup')}</button>
        <button type="button" className="ppd-btn" onClick={goRewards}>{t('rewards')}</button>
      </div>
      {wallet.activity.length > 0 && (
        <div className="ppd-activity">
          <h5>{t('activity')}</h5>
          {wallet.activity.slice(0, 4).map((a, i) => (
            <div className="row" key={`${a.at}-${i}`}>
              <span>{a.kind === 'cup' ? t('cupBack') : a.name}<small>{ago(a.at, t)}</small></span>
              <b className={a.points > 0 ? 'is-plus' : 'is-minus'}>{a.points > 0 ? '+' : '−'}{Math.abs(a.points)} {t('unitShort')}</b>
            </div>
          ))}
        </div>
      )}
      <button type="button" className="ppd-close" onClick={closeSheet}>{t('close')}</button>
    </>
  );
}

function ScanBody() {
  const { t, earn, closeSheet } = useKit();
  return (
    <>
      <img className="ppd-sheet-logo" src={packbackLogo} alt="Packback" />
      <h4>{t('returnCup')}</h4>
      <p>{t('scanBin')}</p>
      <div className="ppd-scan">
        <div className="ppd-scan-qr"><Qr value="packperks:bin:demo" /></div>
        <i /><i /><i /><i /><span className="line" />
      </div>
      <button type="button" className="ppd-btn" onClick={earn}>{t('simulate')}</button>
      <button type="button" className="ppd-close" onClick={closeSheet}>{t('cancel')}</button>
    </>
  );
}

function DoneBody() {
  const { wallet, rewards, t, ppc, amount, openSheet, closeSheet, goRewards } = useKit();
  const unlocked = rewards.filter(r => pointsFor(r) === wallet.points);
  return (
    <>
      <div className="ppd-done-badge"><CupSvg /></div>
      <div className="ppd-plus">+{amount(ppc)}</div>
      <p>{unlocked.length ? t('unlocked', { name: unlocked.map(r => r.name).join(' / ') }) : t('thanks')}</p>
      <CupTrack />
      <div className="ppd-btn-row">
        <button type="button" className="ppd-btn is-ghost" onClick={() => openSheet('scan')}>{t('another')}</button>
        <button type="button" className="ppd-btn" onClick={goRewards}>{t('rewards')}</button>
      </div>
      <button type="button" className="ppd-close" onClick={closeSheet}>{t('close')}</button>
    </>
  );
}

function RedeemBody({ reward }) {
  const { wallet, t, lang, amount, openVoucher, closeSheet } = useKit();
  const cost = pointsFor(reward);
  return (
    <>
      <img className="ppd-sheet-logo" src={packbackLogo} alt="Packback" />
      <h4>{reward.name}</h4>
      <p>{reward.desc?.[lang] || ''}</p>
      <div className="ppd-redeem-img"><img src={reward.image} alt="" style={{ transform: `scale(${reward.imageScale || 1})` }} /></div>
      <div className="ppd-chips">
        <span>{t('worth', { v: euro(lang, reward.euros) })}</span>
        <span className="is-cost">{amount(cost)}</span>
      </div>
      <p className="ppd-after">{t('leftAfter', { n: amount(wallet.points - cost) })}</p>
      <button type="button" className="ppd-btn" onClick={() => openVoucher(reward)}>{t('redeem')}</button>
      <button type="button" className="ppd-close" onClick={closeSheet}>{t('cancel')}</button>
    </>
  );
}

/** Rendered by every brand app inside its screen, above everything else. */
export function PackbackLayer({ appIcon }) {
  const kit = useKit();
  const { sheet, closeSheet, voucher, closeVoucher, toastMsg, wallet, t, ppc, amount, openSheet } = kit;
  const [notice, setNotice] = useState(false);

  // Greet the cup this page load returned.
  useEffect(() => {
    if (!wallet.earnedOnLoad) return undefined;
    const show = setTimeout(() => setNotice(true), 650);
    const hide = setTimeout(() => setNotice(false), 4800);
    return () => { clearTimeout(show); clearTimeout(hide); };
  }, [wallet.earnedOnLoad]);

  const redeemReward = sheet?.mode === 'redeem' ? sheet.reward : null;
  return (
    <>
      <button type="button" className={cls('ppd-notice', notice && 'is-on')}
        onClick={() => { setNotice(false); openSheet('wallet'); }}>
        <span className="ppd-notice-icon">{appIcon || <CupSvg />}</span>
        <span className="ppd-notice-text">
          <b>{t('earnedTitle')}</b>
          <span>{t('earnedBody', { n: amount(ppc) })}</span>
        </span>
        <span className="ppd-notice-plus">+{ppc}</span>
      </button>

      <Sheet open={!!sheet} onClose={closeSheet}>
        {sheet?.mode === 'wallet' && <WalletBody />}
        {sheet?.mode === 'scan' && <ScanBody />}
        {sheet?.mode === 'done' && <DoneBody />}
        {redeemReward && <RedeemBody reward={redeemReward} />}
      </Sheet>

      {voucher && <DemoVoucher reward={voucher} onClose={closeVoucher} />}

      <div className={cls('ppd-toast', toastMsg && 'is-on')} role="status" aria-live="polite">{toastMsg}</div>
    </>
  );
}
