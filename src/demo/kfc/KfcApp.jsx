import { useEffect, useMemo, useRef, useState } from 'react';
import { BrandRow, CupTrack, NextNote, PackbackLayer, RewardList, Tiles } from '../kit/Kit';
import { CupSvg } from '../kit/icons';
import { cls, useKit } from '../kit/kitCore';
import { useBaselines } from '../useBaselines';
import { nextReward, pointsFor } from '../brands';
import KfcVoucher from './KfcVoucher';
import './kfc.css';

/* ─────────────────────────────────────────────────────────────────────
 * The KFC Netherlands app with Packback in it.
 *
 * Home and Profile are matched to screenshots of the real app (every
 * position below is in iOS points on a 393 × 852 screen, read off them;
 * the images are crops of the same screenshots), except that the Doritos
 * banner is half its height so the Packback card fits on the first screen.
 * Every label follows the demo's language. Deals is a concept in
 * the app's style. Packback adds three things: the card on Home, the
 * points section on Deals, and a black Packback button on Profile.
 * KFC NL has no points programme, so these points are Packback's.
 * ───────────────────────────────────────────────────────────────────── */

const A = '/demo/kfc';
const TABS = ['home', 'locations', 'order', 'deals', 'more'];
const TAB_LEFT = [0.1, 78.7, 157.3, 235.9, 314.5];
const ICON_LEFT = [23.756, 23.966, 24.176, 23.96, 24.17];
// Tabs that are not in the demo are drawn grey, so nobody expects them to work.
const TAB_OFF = new Set(['locations', 'order', 'more']);

// Concept deals (not from the app): what the Deals tab offers besides Packback.
const COUPONS = [
  { id: 'wings', cat: 'kip', art: 'wing', title: { nl: 'Wings Wednesday', en: 'Wings Wednesday' },
    desc: { nl: '20 Hot Wings voor €10', en: '20 Hot Wings for €10' }, meta: { nl: 'Alleen op woensdag', en: 'Wednesdays only' }, price: { nl: '€10,00', en: '€10.00' } },
  { id: 'bucket', cat: 'menus', art: 'bucket', title: { nl: 'Bucket voor 2', en: 'Bucket for 2' },
    desc: { nl: '8 stuks kip, 2 friet en 2 drankjes', en: '8 pieces of chicken, 2 fries and 2 drinks' }, meta: { nl: 't/m 30 nov', en: 'Until 30 Nov' }, price: { nl: '€19,99', en: '€19.99' } },
  { id: 'zinger', cat: 'kip', art: 'type', words: { nl: ['2 VOOR', '€7'], en: ['2 FOR', '€7'] }, title: { nl: '2 Zinger Burgers', en: '2 Zinger Burgers' },
    desc: { nl: 'Twee Zinger Burgers voor één prijs', en: 'Two Zinger Burgers for one price' }, meta: { nl: 't/m 30 nov', en: 'Until 30 Nov' }, price: { nl: '€7,00', en: '€7.00' } },
  { id: 'loaded', cat: 'snacks', art: 'bag', title: { nl: 'Loaded + drankje', en: 'Loaded + drink' },
    desc: { nl: 'Doritos Loaded Bag + regular drankje', en: 'Doritos Loaded Bag + regular drink' }, meta: { nl: 'Nieuw', en: 'New' }, price: { nl: '€6,49', en: '€6.49' } },
];

function Bucket() {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <clipPath id="kfa-bucket-clip"><path d="M17 30 H83 L76 92 Q50 97 24 92 Z" /></clipPath>
        <radialGradient id="kfa-crumb" cx=".4" cy=".35" r=".7">
          <stop offset="0" stopColor="#F2B05A" /><stop offset=".55" stopColor="#D9822F" /><stop offset="1" stopColor="#A7561B" />
        </radialGradient>
      </defs>
      <ellipse cx="36" cy="27" rx="15" ry="11" fill="url(#kfa-crumb)" />
      <ellipse cx="62" cy="25" rx="16" ry="12" fill="url(#kfa-crumb)" />
      <ellipse cx="50" cy="20" rx="12" ry="10" fill="url(#kfa-crumb)" />
      <g clipPath="url(#kfa-bucket-clip)">
        <rect x="0" y="0" width="100" height="100" fill="#fff" />
        {[17, 35, 56, 74].map(x => <rect key={x} x={x} y="0" width="9" height="100" fill="#E4002B" />)}
      </g>
      <rect x="14" y="27" width="72" height="7" rx="2" fill="#fff" />
      <rect x="37" y="46" width="26" height="26" rx="2" fill="#fff" />
      <image href={`${A}/colonel.png`} x="38" y="47" width="24" height="24" />
    </svg>
  );
}

function CouponArt({ deal, lang }) {
  if (deal.art === 'wing') return <div className="kfa-art kfa-art-photo" style={{ backgroundImage: `url(${A}/deal-wing.jpg)` }} />;
  if (deal.art === 'bag') return <div className="kfa-art kfa-art-photo" style={{ backgroundImage: `url(${A}/deal-doritos-bag.jpg)`, backgroundSize: '190% auto', backgroundPosition: '62% 78%' }} />;
  if (deal.art === 'bucket') return <div className="kfa-art"><Bucket /></div>;
  const [lbl, big] = deal.words[lang];
  return (
    <div className="kfa-art kfa-art-type">
      <span className="kfa-notches"><i /><i /><i /></span>
      <b className="kfa-lbl">{lbl}</b><b className="kfa-big">{big}</b>
    </div>
  );
}

function Header({ onProfile, back, onBack }) {
  return (
    <>
      {back && <button type="button" className="kfa-hit" aria-label="Back" style={{ left: 12, top: 56, width: 40, height: 46 }} onClick={onBack} />}
      {back && <img className="kfa-px" src={`${A}/icon-back-red.png`} alt="" style={{ left: 22.578, top: 64.752, width: 16.188, height: 28.542 }} />}
      <img className="kfa-px" src={`${A}/kfc-wordmark-red.png`} alt="KFC" style={{ left: 166.566, top: 68.586, width: 60.066, height: 21.3 }} />
      {onProfile && <button type="button" className="kfa-hit" aria-label="Profile" style={{ left: 344, top: 56, width: 42, height: 46 }} onClick={onProfile} />}
      <img className="kfa-px" src={`${A}/icon-profile-red.png`} alt="" style={{ left: 351.876, top: 62.622, width: 25.986, height: 33.228 }} />
    </>
  );
}

export default function KfcApp() {
  const kit = useKit();
  const { t, lang, wallet, rewards, toast, goRewardsRef } = kit;
  const rootRef = useRef(null);
  const dealsScroll = useRef(null);
  const homeScroll = useRef(null);
  const [root, setRoot] = useState('home');
  const [pushed, setPushed] = useState(false);
  const [filter, setFilter] = useState('all');
  const notInDemo = () => toast(t('notInDemo'));

  useBaselines(rootRef, [lang]);

  // "Rewards" anywhere in the PackPerks parts lands on Deals → Points.
  useEffect(() => {
    goRewardsRef.current = () => {
      setPushed(false);
      setRoot('deals');
      setFilter('pp');
      requestAnimationFrame(() => dealsScroll.current?.scrollTo({ top: 0, behavior: 'smooth' }));
    };
  }, [goRewardsRef]);

  const tab = (name) => {
    if (name !== 'home' && name !== 'deals') { notInDemo(); return; }
    if (name === root) (name === 'home' ? homeScroll : dealsScroll).current?.scrollTo({ top: 0, behavior: 'smooth' });
    setRoot(name);
  };

  const chips = t('kfcChips');
  // A goal of ten cups or more gets a two-row track, 44pt taller: News moves down with it.
  const goal = nextReward(rewards, wallet.points) || [...rewards].sort((a, b) => pointsFor(b) - pointsFor(a))[0];
  const ppShift = (goal?.cupsNeeded || 0) + 1 > 10 ? 234 : 190;
  const coupons = useMemo(() => COUPONS.filter(d => filter === 'all' || d.cat === filter), [filter]);

  return (
    <div className="kfa" ref={rootRef} lang={lang} style={{ '--kfa-pp-h': `${ppShift}px` }}>
      {/* ── HOME: matched to the screenshot, with the Packback card added ── */}
      <section className={cls('kfa-view', root === 'home' && 'is-root', root === 'home' && pushed && 'is-covered')}>
        <div className="kfa-home-scroll" ref={homeScroll}>
          <div className="kfa-home-canvas" data-origin>
            <div className="kfa-t kfa-roboto kfa-greet" data-bl="141.86">{t('kfcHi')}</div>
            <div className="kfa-t kfa-roboto kfa-welcome" data-bl="166.14" dangerouslySetInnerHTML={{ __html: t('kfcWelcome') }} />
            {/* Half the screenshot's 320pt: the top of the artwork, with the
                button redrawn on it so its label can be Dutch or English. */}
            <div className="kfa-banner" style={{ top: 234.726, height: 160.176 }}>
              <img src={`${A}/banner-doritos.jpg`} alt="Doritos Loaded Bag" style={{ width: 393.198, height: 320.352 }} />
            </div>
            <button type="button" className="kfa-hit kfa-order-btn" onClick={notInDemo} aria-label={t('kfcOrderNow')} />
            <div className="kfa-t kfa-bold kfa-order-label" data-bl="370.2">{t('kfcOrderNow')}</div>

            <article className="ppd-kit kfa-pp-home">
              <div className="kfa-pp-row">
                <BrandRow logo={`${A}/kfc-wordmark-red.png`} logoClass="kfa-pp-kfc" />
                <Tiles />
              </div>
              <div className="kfa-pp-title">{t('ppHead')}</div>
              <CupTrack />
              <NextNote />
            </article>

            {/* Its own origin: the text inside keeps the screenshot's coordinates. */}
            <div className="kfa-below" data-origin>
              <div className="kfa-t kfa-bold kfa-news-title" data-bl="621.53">{t('kfcNews')}</div>
              <button type="button" className="kfa-hit" aria-label={t('kfcViewAll')} style={{ left: 296, top: 600, width: 82, height: 30 }} onClick={notInDemo} />
              <div className="kfa-t kfa-bold kfa-view-all" data-bl="621.53">{t('kfcViewAll')}</div>
              <div className="kfa-news-card"><img src={`${A}/news-wings.jpg`} alt="Wings Wednesday" /></div>
              <div className="kfa-badge" />
              <div className="kfa-t kfa-roboto kfa-badge-label" data-bl="677.0">1/4</div>
            </div>
          </div>
        </div>
        <div className="kfa-header-bg"><Header onProfile={() => setPushed(true)} /></div>
      </section>

      {/* ── DEALS: a concept in the app's style, with Packback points ── */}
      <section className={cls('kfa-view', root === 'deals' && 'is-root', root === 'deals' && pushed && 'is-covered',
        filter === 'pp' && 'is-pp-only', filter !== 'all' && filter !== 'pp' && 'is-cat')}>
        <div className="kfa-scroll" ref={dealsScroll}>
          <div className="kfa-deals-intro">
            <h2>Deals</h2>
            <p>{t('kfcDealsIntro')}</p>
          </div>
          <div className="kfa-chips" role="group">
            {['all', 'pp', 'kip', 'menus', 'snacks'].map(id => (
              <button key={id} type="button" className="kfa-chip" aria-pressed={filter === id} onClick={() => setFilter(id)}>
                {id === 'pp' && <span className="kfa-chip-mark"><CupSvg /></span>}
                {chips[id]}
              </button>
            ))}
          </div>

          <section className="ppd-kit kfa-pp-deals">
            <div className="kfa-pp-row">
              <h3>{t('kfcWithPoints')}</h3>
              <Tiles />
            </div>
            <CupTrack />
            <NextNote />
            <div className="kfa-pp-rewards"><RewardList layout={filter === 'pp' ? 'grid' : 'rail'} /></div>
          </section>

          <div className="kfa-std">
            <div className="kfa-sec"><h3>{t('kfcWeekDeal')}</h3><span>{t('kfcDaysLeft')}</span></div>
            <article className="kfa-feature">
              <div className="kfa-feature-art"><span className="kfa-pill">{t('kfcAppDeal')}</span></div>
              <div className="kfa-feature-body">
                <h4>Doritos Loaded Bag</h4>
                <p>{t('kfcFeatDesc')}</p>
                <div className="kfa-price-row">
                  <div className="kfa-price" dangerouslySetInnerHTML={{ __html: t('kfcFeatPrice') }} />
                  <button type="button" className="kfa-cta" onClick={notInDemo}>{t('kfcActivateDeal')}</button>
                </div>
              </div>
            </article>
            <div className="kfa-sec"><h3>{t('kfcAllDeals')}</h3><span>{coupons.length} deals</span></div>
            <div className="kfa-coupons">
              {coupons.map(d => (
                <article key={d.id} className="kfa-coupon">
                  <CouponArt deal={d} lang={lang} />
                  <span className="kfa-perf" />
                  <div className="kfa-coupon-body">
                    <h4>{d.title[lang]}</h4>
                    <p>{d.desc[lang]}</p>
                    <div className="kfa-coupon-foot">
                      <div><div className="kfa-price">{d.price[lang]}</div><small>{d.meta[lang]}</small></div>
                      <button type="button" className="kfa-mini" onClick={notInDemo}>{t('kfcActivate')}</button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
          <p className="kfa-fine" dangerouslySetInnerHTML={{ __html: t('kfcFine') }} />
          <div className="kfa-scroll-end" />
        </div>
        <div className="kfa-header-bg"><Header onProfile={() => setPushed(true)} /></div>
      </section>

      {/* ── TAB BAR ── */}
      <nav className="kfa-tabbar" data-origin>
        {TABS.map((name, i) => (
          <button key={name} type="button" className={cls('kfa-hit', 'kfa-tab', TAB_OFF.has(name) && 'is-off')} style={{ left: TAB_LEFT[i] }}
            aria-label={t('kfcTabs')[name]} aria-current={root === name ? 'page' : undefined} onClick={() => tab(name)}>
            <img alt="" src={`${A}/tab-${name}-${root === name ? 'red' : 'black'}.png`}
              style={{ left: ICON_LEFT[i], width: i === 0 ? 31.098 : 30.672, height: 31.098 }} />
          </button>
        ))}
        {TABS.map((name, i) => (
          <div key={name} className={cls('kfa-t', 'kfa-roboto', 'kfa-tab-label', TAB_OFF.has(name) && 'is-off')} data-bl="49.3" style={{ left: TAB_LEFT[i], right: 'auto', width: 78.6 }}>{t('kfcTabs')[name]}</div>
        ))}
      </nav>

      {/* ── PROFILE: matched to the screenshot, with a third black button ── */}
      <section className={cls('kfa-view', 'kfa-push', pushed && 'is-open')}>
        <div className="kfa-profile-scroll">
          <div className="kfa-profile-canvas" data-origin>
            <Header back onBack={() => setPushed(false)} />
            <img className="kfa-px" src={`${A}/colonel.png`} alt="" style={{ left: 146.544, top: 158.472, width: 103.518, height: 103.518 }} />
            <div className="kfa-t kfa-roboto kfa-name" data-bl="352.73">Beke</div>
            <div className="kfa-t kfa-roboto kfa-phone-no" data-bl="374.03">31612345678</div>

            <button type="button" className="kfa-hit kfa-red-btn" style={{ left: 100.96, top: 423.87, width: 191.27, height: 41.75 }} onClick={notInDemo} />
            <div className="kfa-t kfa-roboto kfa-btn-label" data-bl="450.7">{t('kfcUpdate')}</div>

            <div className="kfa-rg kfa-rg-l">
              <button type="button" className="kfa-hit kfa-ring" aria-label={t('kfcHistory')} style={{ left: 70.17 }} onClick={notInDemo} />
              <img className="kfa-px" src={`${A}/icon-history-white.png`} alt="" style={{ left: 78.81, top: 526.11, width: 60.066, height: 59.214 }} />
              <div className="kfa-t kfa-roboto kfa-ring-label" data-bl="617.9" style={{ left: 48.63 }}>{t('kfcHistory')}</div>
            </div>
            <div className="kfa-rg kfa-rg-r">
              <button type="button" className="kfa-hit kfa-ring" aria-label={t('kfcInbox')} style={{ left: 246.45 }} onClick={notInDemo} />
              <img className="kfa-px" src={`${A}/icon-inbox-white.png`} alt="" style={{ left: 254.748, top: 526.11, width: 60.918, height: 59.214 }} />
              <div className="kfa-t kfa-roboto kfa-ring-label" data-bl="617.9" style={{ left: 225.2 }}>{t('kfcInbox')}</div>
            </div>
            <div className="kfa-rg">
              <button type="button" className="kfa-hit kfa-ring" aria-label="Packback" style={{ left: 158.25 }} onClick={() => kit.openSheet('wallet')} />
              <span className="kfa-ring-cup"><CupSvg /></span>
              <span className="kfa-bubble">{wallet.points}</span>
              <div className="kfa-t kfa-roboto kfa-ring-label" data-bl="617.9" style={{ left: 136.5 }}>Packback</div>
            </div>

            <button type="button" className="kfa-hit kfa-red-btn" style={{ left: 126.5, top: 678.2, width: 140.2, height: 41.3 }} onClick={notInDemo} />
            <div className="kfa-t kfa-roboto kfa-btn-label is-sm" data-bl="705.0">{t('kfcLogout')}</div>
            <button type="button" className="kfa-hit" aria-label={t('kfcPrivacy')} style={{ left: 112, top: 728, width: 168, height: 28 }} onClick={notInDemo} />
            <div className="kfa-t kfa-roboto kfa-link" data-bl="747.6">{t('kfcPrivacy')}</div>
            <button type="button" className="kfa-hit" aria-label={t('kfcDelete')} style={{ left: 112, top: 762, width: 168, height: 26 }} onClick={notInDemo} />
            <div className="kfa-t kfa-roboto kfa-link" data-bl="779.1">{t('kfcDelete')}</div>
          </div>
        </div>
      </section>

      <PackbackLayer Voucher={KfcVoucher} />
    </div>
  );
}
