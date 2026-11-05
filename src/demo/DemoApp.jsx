import { useEffect, useMemo, useState } from 'react';
import { BRANDS, BRAND_LIST, brandForPath } from './brands';
import { makeT } from './i18n';
import { useDemoWallet } from './wallet';
import { useOrgRewards } from './useOrgRewards';
import { KitContext, cls, kitStyle } from './kit/kitCore';
import { useKitState } from './kit/useKitState';
import KfcApp from './kfc/KfcApp';
import McdApp from './mcd/McdApp';
import ppWordmark from '../assets/images/packperks-wordmark.svg';
import './demo.css';

/* ─────────────────────────────────────────────────────────────────────
 * /demo — PackPerks inside a brand's own app, for sales conversations.
 *
 *   /demo            pick a demo
 *   /demo/kfc        the KFC app with PackPerks in it
 *   /demo/mcdonalds  the McDonald's app with PackPerks in it
 *
 * Client-only by design: no supabase client, no capture, no writes. The
 * points live in this browser (wallet.js); the only network call is a
 * read of the brand's live rewards (useOrgRewards.js). So nothing a demo
 * does can show up in the dashboard.
 *
 * On a laptop the app sits in a phone beside a short explanation; on a
 * phone it fills the screen, like the real app would.
 * ───────────────────────────────────────────────────────────────────── */

// The apps' own typefaces: Roboto and Mukta for KFC, Figtree standing in
// for McDonald's Speedee. Loaded on /demo only, never by the customer app.
const FONTS_HREF = 'https://fonts.googleapis.com/css2?family=Anton&family=Figtree:wght@400..900&family=Mukta:wght@600;700&family=Roboto:wght@100..900&display=swap';

function useHead(title) {
  useEffect(() => {
    if (!document.getElementById('ppd-fonts')) {
      const link = document.createElement('link');
      link.id = 'ppd-fonts';
      link.rel = 'stylesheet';
      link.href = FONTS_HREF;
      document.head.appendChild(link);
    }
    if (!document.querySelector('meta[name="robots"]')) {
      const meta = document.createElement('meta');
      meta.name = 'robots';
      meta.content = 'noindex, nofollow';
      document.head.appendChild(meta);
    }
  }, []);
  useEffect(() => { document.title = title; }, [title]);
}

function useLang() {
  const [lang, setLangState] = useState(() => {
    const q = new URLSearchParams(window.location.search).get('lang');
    if (q === 'en' || q === 'nl') return q;
    try { return localStorage.getItem('ppdemo:lang') === 'en' ? 'en' : 'nl'; } catch { return 'nl'; }
  });
  const setLang = (l) => {
    setLangState(l);
    try { localStorage.setItem('ppdemo:lang', l); } catch { /* ignore */ }
  };
  return [lang, setLang];
}

/* A real phone gets the app full-screen; anything wider gets the frame. */
function useViewport() {
  const read = () => ({ w: window.innerWidth, h: window.innerHeight, device: window.innerWidth <= 600 });
  const [vp, setVp] = useState(read);
  useEffect(() => {
    const on = () => setVp(read());
    window.addEventListener('resize', on);
    window.addEventListener('orientationchange', on);
    return () => { window.removeEventListener('resize', on); window.removeEventListener('orientationchange', on); };
  }, []);
  return vp;
}

function LangSwitch({ lang, setLang, t }) {
  return (
    <div className="ppd-seg" role="group" aria-label={t('demoLanguage')}>
      {['nl', 'en'].map(l => (
        <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)}>{l.toUpperCase()}</button>
      ))}
    </div>
  );
}

/* The phone: 393 × 852 points, like an iPhone 15. */
function Phone({ vp, kit, children }) {
  if (vp.device) {
    const s = vp.w / 393;
    return (
      <div className="ppd-device">
        <div className="ppd-screen is-device" style={{ ...kitStyle(kit), height: vp.h / s, transform: `scale(${s})` }}>
          <div className="ppd-screen-inner">{children}</div>
        </div>
      </div>
    );
  }
  const s = Math.max(0.5, Math.min(1, (vp.h - 40) / 876, (vp.w - 32) / 417));
  return (
    <div className="ppd-phone-box" style={{ width: 417 * s, height: 876 * s }}>
      <div className="ppd-phone" style={{ transform: `scale(${s})` }}>
        <div className="ppd-screen" style={kitStyle(kit)}>
          <div className="ppd-screen-inner">{children}</div>
          <div className="ppd-island" />
          <div className="ppd-statusbar">
            <span className="ppd-sb-time">18:06</span>
            <img className="ppd-sb-arrow" src="/demo/shared/sb-arrow-black.png" alt="" />
            <img className="ppd-sb-right" src="/demo/shared/sb-right.png" alt="" />
          </div>
          <div className="ppd-home-indicator" />
        </div>
      </div>
    </div>
  );
}

function Controls({ brand, kit, t, lang, setLang, compact }) {
  const other = BRAND_LIST.find(b => b.key !== brand.key);
  const { wallet } = kit;
  return (
    <div className={cls('ppd-controls', compact && 'is-compact')}>
      <div className="ppd-balance">
        <span>{t('demoBalance')}</span>
        <b>{wallet.points} {t('unit')}</b>
        <small>{wallet.cups === 1 ? t('cupReturnedOne') : t('cupsReturned', { n: wallet.cups })}</small>
      </div>
      <div className="ppd-actions">
        <button type="button" className="ppd-action is-primary" onClick={kit.earn}>{t('demoEarn')}</button>
        <button type="button" className="ppd-action" onClick={wallet.reset}>{t('demoReset')}</button>
      </div>
      <div className="ppd-row">
        <span>{t('demoLanguage')}</span>
        <LangSwitch lang={lang} setLang={setLang} t={t} />
      </div>
      <a className="ppd-other" href={`${other.path}${lang === 'en' ? '?lang=en' : ''}`}>
        <span>{t('demoOther')}</span><b>PackPerks × {other.name}</b><i aria-hidden="true">→</i>
      </a>
      <p className="ppd-foot">
        {t('demoNote')} <span className={cls('ppd-dot', kit.live && 'is-live')} />{kit.live ? t('demoLive') : t('demoBundled')}
      </p>
    </div>
  );
}

function BrandDemo({ brand, lang, setLang }) {
  const t = useMemo(() => makeT(lang), [lang]);
  const wallet = useDemoWallet(brand.key);
  const { rewards, live } = useOrgRewards(brand);
  const kit = useKitState({ brand, lang, t, wallet, rewards, live });
  const vp = useViewport();
  const [panelOpen, setPanelOpen] = useState(false);
  useHead(`${t('demoTitle', { brand: brand.name })} · demo`);
  const App = brand.key === 'kfc' ? KfcApp : McdApp;

  const phone = (
    <Phone vp={vp} kit={brand.kit}>
      <KitContext.Provider value={kit}><App /></KitContext.Provider>
    </Phone>
  );

  if (vp.device) {
    return (
      <div className="ppd ppd-is-device">
        {phone}
        <button type="button" className="ppd-fab" onClick={() => setPanelOpen(true)} aria-label="Demo">
          <img src="/demo/shared/packperks-mark.svg" alt="" />
        </button>
        <div className={cls('ppd-drawer', panelOpen && 'is-open')} onClick={() => setPanelOpen(false)}>
          <div className="ppd-drawer-card" onClick={e => e.stopPropagation()}>
            <h2>{t('demoTitle', { brand: brand.name })}</h2>
            <p>{t('demoRefresh')}</p>
            <Controls brand={brand} kit={kit} t={t} lang={lang} setLang={setLang} compact />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ppd">
      <aside className="ppd-panel">
        <a className="ppd-logo" href="/demo"><img src={ppWordmark} alt="PackPerks" /><span>demo</span></a>
        <h1>{t('demoTitle', { brand: brand.name })}</h1>
        <p className="ppd-lead">{t('demoLead', { brand: brand.name })}</p>
        <p className="ppd-refresh"><span aria-hidden="true">↻</span>{t('demoRefresh')}</p>
        <Controls brand={brand} kit={kit} t={t} lang={lang} setLang={setLang} />
      </aside>
      {phone}
    </div>
  );
}

function DemoIndex({ lang, setLang }) {
  const t = useMemo(() => makeT(lang), [lang]);
  useHead('PackPerks · demo');
  return (
    <div className="ppd ppd-index">
      <header>
        <img src={ppWordmark} alt="PackPerks" />
        <LangSwitch lang={lang} setLang={setLang} t={t} />
      </header>
      <h1>{t('demoPickTitle')}</h1>
      <p className="ppd-lead">{t('demoPickLead')}</p>
      <div className="ppd-cards">
        {BRAND_LIST.map(b => (
          <a key={b.key} className={`ppd-card is-${b.key}`} href={`${b.path}${lang === 'en' ? '?lang=en' : ''}`}>
            <span className="ppd-card-logo">
              {b.key === 'kfc'
                ? <img src="/demo/kfc/kfc-wordmark-red.png" alt="KFC" />
                : <svg viewBox="0 0 272.7 238.5" aria-label="McDonald's"><path fill="#FFBC0D" d="m195.8 17.933c23.3 0 42.2 98.3 42.2 219.7h34c0-130.7-34.3-236.5-76.3-236.5-24 0-45.2 31.7-59.2 81.5-14-49.8-35.2-81.5-59-81.5-42 0-76.2 105.7-76.2 236.4h34c0-121.4 18.7-219.6 42-219.6s42.2 90.8 42.2 202.8h33.8c0-112 19-202.8 42.3-202.8" /></svg>}
            </span>
            <b>PackPerks × {b.name}</b>
            <span className="ppd-card-go">{t('demoOpen')} →</span>
          </a>
        ))}
      </div>
      <p className="ppd-foot">{t('demoNote')}</p>
    </div>
  );
}

export default function DemoApp() {
  const [lang, setLang] = useLang();
  const brandKey = brandForPath(window.location.pathname);
  if (!brandKey) return <DemoIndex lang={lang} setLang={setLang} />;
  return <BrandDemo key={brandKey} brand={BRANDS[brandKey]} lang={lang} setLang={setLang} />;
}
