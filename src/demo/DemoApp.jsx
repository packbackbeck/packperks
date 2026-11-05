import { useEffect, useMemo, useState } from 'react';
import { BRANDS, BRAND_LIST, brandForPath } from './brands';
import { makeT } from './i18n';
import { useDemoWallet } from './wallet';
import { useOrgRewards } from './useOrgRewards';
import { KitContext, cls, kitStyle } from './kit/kitCore';
import { useKitState } from './kit/useKitState';
import KfcApp from './kfc/KfcApp';
import McdApp from './mcd/McdApp';
import packbackLogo from '../assets/images/packback-logo.svg';
import './demo.css';

/* ─────────────────────────────────────────────────────────────────────
 * /demo — Packback inside a brand's own app, for sales conversations.
 *
 *   /demo            pick a demo
 *   /demo/kfc        the KFC app with Packback in it
 *   /demo/mcdonalds  the McDonald's app with Packback in it
 *
 * Client-only by design: no supabase client, no capture, no writes. The
 * points live in this browser (wallet.js); the only network call is a
 * read of the brand's live rewards (useOrgRewards.js). So nothing a demo
 * does can show up in the dashboard.
 *
 * On a laptop the app sits in a phone beside the demo controls. On a
 * phone it IS the page: full screen, nothing around it.
 * ───────────────────────────────────────────────────────────────────── */

function useHead(title) {
  useEffect(() => {
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

function Seg({ label, children }) {
  return <div className="ppd-seg" role="group" aria-label={label}>{children}</div>;
}

function LangSwitch({ lang, setLang, t }) {
  return (
    <Seg label={t('demoLanguage')}>
      {['nl', 'en'].map(l => (
        <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)}>{l.toUpperCase()}</button>
      ))}
    </Seg>
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

/* The left side: controls, not reading. */
function Panel({ brand, kit, t, lang, setLang }) {
  const { wallet } = kit;
  const q = lang === 'en' ? '?lang=en' : '';
  return (
    <aside className="ppd-panel">
      <a className="ppd-logo" href={`/demo${q}`}>
        <img src={packbackLogo} alt="Packback" /><span>{t('demo')}</span>
      </a>

      <Seg label="Demo">
        {BRAND_LIST.map(b => (
          <a key={b.key} href={`${b.path}${q}`} aria-pressed={b.key === brand.key}>{b.name}</a>
        ))}
      </Seg>

      <div className="ppd-balance">
        <span>{t('demoBalance')}</span>
        <b>{wallet.points}</b>
        <small>{t(wallet.points === 1 ? 'unitOne' : 'unit')} · {wallet.cups === 1 ? t('cupReturnedOne') : t('cupsReturned', { n: wallet.cups })}</small>
      </div>

      <button type="button" className="ppd-action is-primary" onClick={kit.earn}>{t('demoEarn')}</button>
      <p className="ppd-hint"><span aria-hidden="true">↻</span>{t('demoRefresh', { n: brand.pointsPerCup })}</p>

      <div className="ppd-row">
        <button type="button" className="ppd-action" onClick={wallet.reset}>{t('demoReset')}</button>
        <LangSwitch lang={lang} setLang={setLang} t={t} />
      </div>

      <p className="ppd-foot">
        <span className={cls('ppd-dot', kit.live && 'is-live')} />
        {kit.live ? `${t('demoLive')} · ` : ''}{t('demoNote')}
      </p>
    </aside>
  );
}

function BrandDemo({ brand, lang, setLang }) {
  const t = useMemo(() => makeT(lang, brand.strings), [lang, brand]);
  const wallet = useDemoWallet(brand.key, brand.pointsPerCup);
  const { rewards, live } = useOrgRewards(brand);
  const kit = useKitState({ brand, lang, t, wallet, rewards, live });
  const vp = useViewport();
  useHead(`Packback × ${brand.name}`);
  const App = brand.key === 'kfc' ? KfcApp : McdApp;

  const phone = (
    <Phone vp={vp} kit={brand.kit}>
      <KitContext.Provider value={kit}><App /></KitContext.Provider>
    </Phone>
  );

  // On a phone the demo is only the app.
  if (vp.device) return <div className="ppd ppd-is-device">{phone}</div>;

  return (
    <div className="ppd">
      <Panel brand={brand} kit={kit} t={t} lang={lang} setLang={setLang} />
      {phone}
    </div>
  );
}

function DemoIndex({ lang, setLang }) {
  const t = useMemo(() => makeT(lang), [lang]);
  useHead('Packback · demo');
  return (
    <div className="ppd ppd-index">
      <header>
        <img src={packbackLogo} alt="Packback" />
        <LangSwitch lang={lang} setLang={setLang} t={t} />
      </header>
      <h1>{t('demoPickTitle')}</h1>
      <div className="ppd-cards">
        {BRAND_LIST.map(b => (
          <a key={b.key} className={`ppd-card is-${b.key}`} href={`${b.path}${lang === 'en' ? '?lang=en' : ''}`}>
            <span className="ppd-card-logo">
              {b.key === 'kfc'
                ? <img src="/demo/kfc/kfc-wordmark-red.png" alt="KFC" />
                : <svg viewBox="0 0 272.7 238.5" aria-label="McDonald's"><path fill="#FFBC0D" d="m195.8 17.933c23.3 0 42.2 98.3 42.2 219.7h34c0-130.7-34.3-236.5-76.3-236.5-24 0-45.2 31.7-59.2 81.5-14-49.8-35.2-81.5-59-81.5-42 0-76.2 105.7-76.2 236.4h34c0-121.4 18.7-219.6 42-219.6s42.2 90.8 42.2 202.8h33.8c0-112 19-202.8 42.3-202.8" /></svg>}
            </span>
            <b>Packback × {b.name}</b>
            <span className="ppd-card-go">{t('demoOpen')} →</span>
          </a>
        ))}
      </div>
    </div>
  );
}

export default function DemoApp() {
  const [lang, setLang] = useLang();
  const brandKey = brandForPath(window.location.pathname);
  if (!brandKey) return <DemoIndex lang={lang} setLang={setLang} />;
  return <BrandDemo key={brandKey} brand={BRANDS[brandKey]} lang={lang} setLang={setLang} />;
}
