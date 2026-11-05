import { useEffect, useRef, useState } from 'react';
import { BrandRow, CupTrack, NextNote, PackbackLayer, RewardList, Tiles } from '../kit/Kit';
import { CupSvg } from '../kit/icons';
import { cls, useKit } from '../kit/kitCore';
import './mcd.css';

/* ─────────────────────────────────────────────────────────────────────
 * The McDonald's app (Netherlands) with Packback in it.
 *
 * Built after the current global McDonald's app as its App Store pages
 * show it: the MyM header, heavy dark headings, white cards with a thin
 * border, flat product art and yellow round buttons. Speedee (the
 * brand's typeface) isn't free to use, so Figtree stands in. Product
 * images are McDonald's own (mcdonalds.com/nl).
 *
 * Packback: a card on Home, cups earning MyMcDonald's Rewards points on
 * the Rewards tab, a nudge on Deals and a row in More.
 * ───────────────────────────────────────────────────────────────────── */

const ARCHES = 'm195.8 17.933c23.3 0 42.2 98.3 42.2 219.7h34c0-130.7-34.3-236.5-76.3-236.5-24 0-45.2 31.7-59.2 81.5-14-49.8-35.2-81.5-59-81.5-42 0-76.2 105.7-76.2 236.4h34c0-121.4 18.7-219.6 42-219.6s42.2 90.8 42.2 202.8h33.8c0-112 19-202.8 42.3-202.8';
const img = (name) => `https://s7d1.scene7.com/is/image/mcdonalds/${name}:nutrition-calculator-tile?fmt=png-alpha`;
const ARCHES_URL = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 272.7 238.5"><path fill="#FFBC0D" d="${ARCHES}"/></svg>`)}`;

export function Arches({ className }) {
  return <svg className={className} viewBox="0 0 272.7 238.5" aria-hidden="true"><path fill="#FFBC0D" d={ARCHES} /></svg>;
}

const ICONS = {
  home: <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1v-9.5Z" />,
  deals: <><path d="M4 7.5A1.5 1.5 0 0 1 5.5 6h13A1.5 1.5 0 0 1 20 7.5V10a2 2 0 0 0 0 4v2.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 16.5V14a2 2 0 0 0 0-4V7.5Z" /><path d="M10 9.5h.01M14 14.5h.01M14.5 9.5l-5 5" /></>,
  order: <><path d="M5.5 8h13l-1 12.5h-11L5.5 8Z" /><path d="M9 8V6.5a3 3 0 0 1 6 0V8" /></>,
  rewards: <><path d="M4.5 10h15v10h-15z" /><path d="M3.5 7h17v3h-17zM12 7v13" /><path d="M12 7c-1.8 0-4-.7-4-2.3C8 3.6 9 3 10 3.4 11.2 3.9 12 7 12 7Zm0 0c1.8 0 4-.7 4-2.3 0-1.1-1-1.7-2-1.3-1.2.5-2 3.6-2 3.6Z" /></>,
  more: <path d="M5 7h14M5 12h14M5 17h14" />,
  qr: <><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z" /><path d="M14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z" /></>,
  chevron: <path d="m9 6 6 6-6 6" />,
  arrow: <path d="M5 12h13m-5-5 5 5-5 5" />,
  store: <><path d="M4 9.5 5.5 4h13L20 9.5" /><path d="M4 9.5h16v.5a2.7 2.7 0 0 1-5.3 0 2.7 2.7 0 0 1-5.4 0A2.7 2.7 0 0 1 4 10v-.5ZM5.5 13v7h13v-7" /></>,
  sliders: <path d="M4 7h10m4 0h2M4 17h4m4 0h8M16 5v4M10 15v4" />,
  help: <><circle cx="12" cy="12" r="8.5" /><path d="M9.8 9.5a2.3 2.3 0 0 1 4.4.9c0 1.6-2.2 2-2.2 3.4M12 16.6h.01" /></>,
  doc: <><path d="M7 3.5h7l4 4V20.5H7z" /><path d="M14 3.5v4h4M9.5 12h6M9.5 15.5h6" /></>,
  out: <><path d="M14 4h4.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H14" /><path d="M10 8l-4 4 4 4M6 12h9" /></>,
};

function Icon({ name, className }) {
  return (
    <svg className={cls('mca-icon', className)} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[name]}</svg>
  );
}

function Header({ right }) {
  return (
    <header className="mca-header">
      <span className="mca-logo"><span>My</span><Arches /></span>
      {right}
    </header>
  );
}

export default function McdApp() {
  const kit = useKit();
  const { t, lang, wallet, toast, goRewardsRef, openSheet } = kit;
  const [view, setView] = useState('home');
  const scrolls = useRef({});
  const notInDemo = () => toast(t('notInDemo'));
  const tabs = t('mcdTabs');

  useEffect(() => {
    goRewardsRef.current = () => {
      setView('rewards');
      requestAnimationFrame(() => scrolls.current.rewards?.scrollTo({ top: 0, behavior: 'smooth' }));
    };
  }, [goRewardsRef]);

  const go = (name) => {
    if (name === 'order') { notInDemo(); return; }
    if (name === view) scrolls.current[name]?.scrollTo({ top: 0, behavior: 'smooth' });
    setView(name);
  };

  const view_ = (name, children, right) => (
    <section className={cls('mca-view', view === name && 'is-on')}>
      <Header right={right} />
      <div className="mca-scroll" ref={el => { scrolls.current[name] = el; }}>
        {children}
        <div className="mca-end" />
      </div>
    </section>
  );

  const codeBtn = (
    <button type="button" className="mca-code" onClick={notInDemo}>
      <Icon name="qr" />{t('mcdCode')}
    </button>
  );

  return (
    <div className="mca" lang={lang}>
      {/* ── Home ── */}
      {view_('home', (
        <>
          <h1 className="mca-hello">{t('mcdHello')}</h1>

          <article className="ppd-kit mca-pp">
            <div className="mca-pp-row">
              <BrandRow logo={ARCHES_URL} logoClass="mca-pp-arches" />
              <Tiles />
            </div>
            <div className="mca-pp-title">{t('ppHeadMcd')}</div>
            <CupTrack />
            <NextNote />
          </article>

          <h2 className="mca-h2">{t('mcdNews')}</h2>
          <article className="mca-card mca-news" onClick={notInDemo}>
            <div className="mca-news-art"><img src={img('gui_nl_main_frites_medium')} alt="" /></div>
            <div className="mca-news-text">
              <div>
                <h3>{t('mcdFryday')}</h3>
                <p>{t('mcdFrydaySub')}</p>
              </div>
              <span className="mca-round"><Icon name="arrow" /></span>
            </div>
          </article>

          <div className="mca-h2-row">
            <h2 className="mca-h2">{t('mcdDeals')}</h2>
            <button type="button" className="mca-link" onClick={() => go('deals')}>{t('mcdSeeAll')}</button>
          </div>
          <div className="mca-rail">
            {[['nuggets_chicken_6', t('mcdDeal1')], ['ngk_gui_nl_main_app_mcchicken', t('mcdDeal2')], ['gui_nl_main_mcflurrymm', t('mcdDeal3')]].map(([pic, title]) => (
              <article key={pic} className="mca-card mca-deal-sm" onClick={notInDemo}>
                <div className="mca-deal-art"><img src={img(pic)} alt="" /></div>
                <h3>{title}</h3>
              </article>
            ))}
          </div>
        </>
      ), codeBtn)}

      {/* ── Deals ── */}
      {view_('deals', (
        <>
          <h1 className="mca-h1">{t('mcdDeals')}</h1>
          <button type="button" className="ppd-kit mca-nudge" onClick={() => go('rewards')}>
            <span className="mca-nudge-cup"><CupSvg /></span>
            <span className="mca-nudge-text"><b>{t('ppHeadMcd')}</b><span>{t('perCup', { n: kit.amount(kit.ppc) })}</span></span>
            <span className="mca-nudge-pts">{wallet.points} {t('unitShort')}</span>
          </button>
          {[['nuggets_chicken_6', t('mcdDeal1')], ['ngk_gui_nl_main_app_mcchicken', t('mcdDeal2')], ['gui_nl_main_mcflurrymm', t('mcdDeal3')]].map(([pic, title]) => (
            <article key={pic} className="mca-card mca-deal" onClick={notInDemo}>
              <div className="mca-deal-art is-big"><img src={img(pic)} alt="" /></div>
              <h3>{title}</h3>
            </article>
          ))}
        </>
      ))}

      {/* ── Rewards: MyM points from cups are spent here ── */}
      {view_('rewards', (
        <>
          <h1 className="mca-h1">Rewards</h1>
          <p className="mca-sub">{t('mcdRewardsSub')}</p>
          <article className="ppd-kit mca-pp mca-pp-balance">
            <div className="mca-pp-row">
              <BrandRow logo={ARCHES_URL} logoClass="mca-pp-arches" />
              <Tiles />
            </div>
            <div className="mca-pp-big"><b>{wallet.points}</b><span>{t('unit')}</span></div>
            <CupTrack />
            <NextNote />
            <button type="button" className="ppd-btn mca-pp-btn" onClick={() => openSheet('scan')}>{t('returnCup')}</button>
          </article>
          <h2 className="mca-h2">{t('mcdSwap')}</h2>
          <div className="ppd-kit mca-rewards"><RewardList layout="grid" /></div>
        </>
      ))}

      {/* ── More ── */}
      {view_('more', (
        <>
          <h1 className="mca-h1">{t('mcdMore')}</h1>
          <button type="button" className="mca-card mca-me" onClick={notInDemo}>
            <span className="mca-avatar">B</span>
            <span className="mca-me-text"><b>Beke</b><span>{t('mcdAccount')}</span></span>
            <Icon name="chevron" className="mca-chev" />
          </button>
          <div className="mca-card mca-list">
            <button type="button" className="mca-row is-pp" onClick={() => openSheet('wallet')}>
              <span className="mca-row-cup"><CupSvg /></span>
              <span className="mca-row-text"><b>{t('mcdPointsRow')}</b><span>{wallet.cups === 1 ? t('cupReturnedOne') : t('cupsReturned', { n: wallet.cups })}</span></span>
              <span className="mca-row-pts">{wallet.points} {t('unitShort')}</span>
              <Icon name="chevron" className="mca-chev" />
            </button>
            {[['store', t('mcdRestaurants')], ['sliders', t('mcdPrefs')], ['help', t('mcdHelp')], ['doc', t('mcdLegal')], ['out', t('mcdLogout')]].map(([icon, label]) => (
              <button key={icon} type="button" className="mca-row" onClick={notInDemo}>
                <Icon name={icon} className="mca-row-icon" />
                <span className="mca-row-text"><b>{label}</b></span>
                <Icon name="chevron" className="mca-chev" />
              </button>
            ))}
          </div>
        </>
      ))}

      {/* ── Tab bar ── */}
      <nav className="mca-tabbar">
        {['home', 'deals', 'order', 'rewards', 'more'].map(name => (
          <button key={name} type="button" className={cls('mca-tab', view === name && 'is-on', name === 'order' && 'is-order')}
            aria-current={view === name ? 'page' : undefined} onClick={() => go(name)}>
            <span className="mca-tab-icon">
              <Icon name={name} />
              {name === 'rewards' && wallet.points > 0 && <i className="mca-tab-dot" />}
            </span>
            <span className="mca-tab-label">{tabs[name]}</span>
          </button>
        ))}
      </nav>

      <PackbackLayer />
    </div>
  );
}
