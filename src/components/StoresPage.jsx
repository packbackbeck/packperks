import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import cupIcon from '../assets/images/cup-icon.svg';
import packperksLogo from '../assets/images/packperks-logo.svg';
import { getGlobalImpact } from '../lib/api';
import { GRAMS_PER_CUP, pickComparison, formatGrams } from '../lib/impact';
import './StoresPage.css';

/* ─────────────────────────────────────────────────────────────────────
 * StoresPage — Phase 3 multi-venue home for a store group.
 *
 * This is the "main" page for a grouped customer: it is NOT a sub-page,
 * so it has no back button — you enter individual stores from here, and
 * each store carries its own "‹ See all stores" link back.
 *
 *   • A "Nearby now" hero for the store you're in (big logo, cups,
 *     featured product).
 *   • "Other stores in your group": the one you have the most cups at
 *     first, then alphabetical. Each shows cups + a featured product.
 *   • A list ⇄ map toggle. The map plots stores from their locations
 *     (precise when coordinates exist, otherwise a tidy layout).
 *
 * Balances are per-store by design, so each card shows its own count.
 * ───────────────────────────────────────────────────────────────────── */

function StoreMark({ store, variant }) {
  const cls = `stores2__mark${variant ? ` stores2__mark--${variant}` : ''}`;
  if (store?.logo_url) {
    return <img className={`${cls} stores2__mark--img`} src={store.logo_url} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />;
  }
  return (
    <span className={cls} style={{ background: store?.brand_color || 'var(--bk-green, #1A8737)' }}>
      {(store?.name || 'S').charAt(0).toUpperCase()}
    </span>
  );
}

function Cups({ n, tone }) {
  return (
    <span className={`stores2__cups${tone ? ` stores2__cups--${tone}` : ''}`}>
      <img src={cupIcon} alt="" className="stores2__cups-icon" aria-hidden="true" />
      <strong>{n}</strong> {n === 1 ? 'cup' : 'cups'}
    </span>
  );
}

/* Auto-cycling reward thumbnail: slides left to the next reward image every
 * 3s and loops. Falls back to a single image (or nothing) gracefully. */
function RewardThumb({ rewards, fallback, delay = 0 }) {
  const imgs = ((rewards && rewards.length) ? rewards.map(r => r.image) : (fallback ? [fallback] : [])).filter(Boolean);
  const [i, setI] = useState(0);
  useEffect(() => {
    setI(0);
    if (imgs.length <= 1) return undefined;
    // Stagger each card's cycle so they don't all flip in unison — the
    // further down the list, the larger the offset.
    let intervalId;
    const startId = setTimeout(() => {
      intervalId = setInterval(() => setI(x => (x + 1) % imgs.length), 3000);
    }, delay);
    return () => { clearTimeout(startId); if (intervalId) clearInterval(intervalId); };
  }, [imgs.length, delay]);
  if (imgs.length === 0) return null;
  return (
    <div className="stores2__thumb">
      <div className="stores2__thumb-track" style={{ transform: `translateX(-${i * 100}%)` }}>
        {imgs.map((src, idx) => (
          <img key={idx} className="stores2__thumb-slide" src={src} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
        ))}
      </div>
    </div>
  );
}

/* Hero featured reward carousel. Each reward is ONE self-contained block
 * (image + name together) so the picture and its label always move as a
 * single unit — never separately. A viewport clips a horizontal track of
 * those blocks that slides one step at a time and loops seamlessly (a clone
 * of the first block is appended; when we land on it the track snaps back to
 * the start with the transition off, so the loop has no visible rewind). */
const HERO_DWELL_MS = 5000;   // how long each reward stays on screen
const HERO_SLIDE_MS = 700;    // slide transition duration

function HeroFeatured({ rewards, fallbackImage, fallbackName }) {
  const items = (rewards && rewards.length)
    ? rewards
    : ((fallbackImage || fallbackName) ? [{ name: fallbackName || '', image: fallbackImage || '' }] : []);
  const many = items.length > 1;
  const [i, setI] = useState(0);
  const [anim, setAnim] = useState(true);

  // Advance one step every dwell period.
  useEffect(() => {
    setI(0); setAnim(true);
    if (!many) return undefined;
    const id = setInterval(() => setI(x => x + 1), HERO_DWELL_MS);
    return () => clearInterval(id);
  }, [items.length, many]);

  // Seamless wrap: once we've slid onto the appended clone, jump back to 0
  // with the animation disabled, then re-enable it on the next frame.
  useEffect(() => {
    if (!many) return undefined;
    if (i === items.length) {
      const t = setTimeout(() => { setAnim(false); setI(0); }, HERO_SLIDE_MS + 20);
      return () => clearTimeout(t);
    }
    if (!anim) {
      const r = requestAnimationFrame(() => setAnim(true));
      return () => cancelAnimationFrame(r);
    }
    return undefined;
  }, [i, items.length, many, anim]);

  if (items.length === 0) return null;
  const slides = many ? [...items, items[0]] : items;

  return (
    <div className="stores2__hero-featured-viewport">
      <div
        className="stores2__hero-featured-track"
        style={{
          transform: `translateX(-${i * 100}%)`,
          transition: anim ? `transform ${HERO_SLIDE_MS}ms cubic-bezier(0.4, 0, 0.2, 1)` : 'none',
        }}
      >
        {slides.map((it, idx) => (
          <div key={idx} className="stores2__hero-featured">
            {it.image
              ? <img className="stores2__hero-featured-img" src={it.image} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
              : null}
            <span className="stores2__hero-featured-name">{it.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/* Real map via Leaflet + OpenStreetMap tiles (free, no API key). Plots a
 * marker at each store's actual coordinates; the marker popup shows the
 * store name, address and cups, with a button to open that store. */
function MapView({ stores, highlightId, onSelectStore }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const onSelectRef = useRef(onSelectStore);
  onSelectRef.current = onSelectStore;

  const withCoords = stores.filter(s => s.location?.lat != null && s.location?.lng != null);
  // Stable signature so markers only rebuild when the data really changes.
  const sig = withCoords
    .map(s => `${s.id}:${s.location.lat},${s.location.lng}:${s.balance}:${s.id === highlightId}`)
    .join('|');

  // Create the map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return undefined;
    const map = L.map(containerRef.current, { zoomControl: true, scrollWheelZoom: false });
    // CARTO "Voyager" — a soft, friendly, simplified basemap (free, no key).
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      maxZoom: 20,
    }).addTo(map);
    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);
    map.setView([52.13, 5.29], 7); // Netherlands, until markers fit
    map.on('popupopen', (e) => {
      const btn = e.popup.getElement()?.querySelector('.stores2__popup-btn');
      if (btn) btn.onclick = () => {
        const st = stores.find(x => x.id === btn.dataset.id);
        if (st) onSelectRef.current?.(st);
      };
    });
    setTimeout(() => map.invalidateSize(), 80);
    return () => { map.remove(); mapRef.current = null; layerRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // (Re)draw markers when the store data changes.
  useEffect(() => {
    const map = mapRef.current, layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const pts = [];
    withCoords.forEach(s => {
      const isTop = s.id === highlightId;
      const label = (s.name || 'S').charAt(0).toUpperCase();
      const icon = L.divIcon({
        className: 'stores2__leaflet-icon',
        html: `<span class="stores2__leaflet-pin${isTop ? ' is-current' : ''}" style="background:${s.brand_color || '#1A8737'}">${escapeHtml(label)}</span>`,
        iconSize: [38, 38], iconAnchor: [19, 19], popupAnchor: [0, -18],
      });
      const marker = L.marker([s.location.lat, s.location.lng], { icon }).addTo(layer);
      const n = s.balance || 0;
      // Reward image for the thumbnail: featured first, else the first live
      // reward that has an image.
      const rewardImg = s.featured?.image || (s.rewards || []).find(r => r.image)?.image || '';
      const featuredName = s.featured?.name || '';
      const logoMark = s.logo_url
        ? `<img class="stores2__popcard-logo" src="${escapeHtml(s.logo_url)}" alt="" />`
        : `<span class="stores2__popcard-logo stores2__popcard-logo--letter" style="background:${escapeHtml(s.brand_color || '#1A8737')}">${escapeHtml((s.name || 'S').charAt(0).toUpperCase())}</span>`;
      // Popup mirrors the list-view store card: logo, cups, featured item.
      marker.bindPopup(
        `<div class="stores2__popcard">
           <div class="stores2__popcard-top">
             ${logoMark}
             <div class="stores2__popcard-info">
               <strong class="stores2__popcard-name">${escapeHtml(s.name)}</strong>
               <span class="stores2__popcard-cups"><img src="${cupIcon}" alt="" class="stores2__popcard-cupicon" /><b>${n}</b> ${n === 1 ? 'cup' : 'cups'}</span>
             </div>
             ${rewardImg ? `<img class="stores2__popcard-thumb" src="${escapeHtml(rewardImg)}" alt="" />` : ''}
           </div>
           ${featuredName ? `<span class="stores2__popcard-tag">🎁 ${escapeHtml(featuredName)}</span>` : ''}
           <button type="button" class="stores2__popup-btn" data-id="${escapeHtml(s.id)}">Open store</button>
         </div>`,
      );
      pts.push([s.location.lat, s.location.lng]);
    });
    if (pts.length === 1) map.setView(pts[0], 15);
    else if (pts.length > 1) map.fitBounds(pts, { padding: [50, 50], maxZoom: 14 });
    setTimeout(() => map.invalidateSize(), 80);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, highlightId]);

  return (
    <div className="stores2__map">
      <div ref={containerRef} className="stores2__map-canvas" />
      {withCoords.length === 0 && (
        <p className="stores2__map-hint">No store locations set yet — add an address in each store’s settings to place it on the map.</p>
      )}
    </div>
  );
}

/* Plastic-avoided impact of bringing your own cup: what you saved + what
 * the whole PackPerks community saved, with a tangible comparison. */
function StoresImpact({ personalCups }) {
  const [communityCups, setCommunityCups] = useState(null);
  useEffect(() => {
    let alive = true;
    getGlobalImpact().then(r => { if (alive) setCommunityCups(r?.totalLifetimeCups || 0); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const personalG = (personalCups || 0) * GRAMS_PER_CUP;
  const communityG = (communityCups || 0) * GRAMS_PER_CUP;
  const LeafIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" /><path d="M2 21c0-3 1.85-5.36 5.08-6" />
    </svg>
  );
  return (
    <div className="stores2__impact">
      <span className="stores2__impact-title">Plastic saved by bringing your own cup</span>
      <div className="stores2__impact-squares">
        <div className="stores2__impact-sq">
          <span className="stores2__impact-icon"><LeafIcon /></span>
          <span className="stores2__impact-val">{formatGrams(personalG)}</span>
          <span className="stores2__impact-cap">you’ve avoided</span>
        </div>
        <div className="stores2__impact-sq stores2__impact-sq--community">
          <span className="stores2__impact-icon"><LeafIcon /></span>
          <span className="stores2__impact-val">{communityCups == null ? '…' : formatGrams(communityG)}</span>
          <span className="stores2__impact-cap">by all PackPerks users together</span>
        </div>
      </div>
      <p className="stores2__impact-compare">
        {personalCups > 0
          ? <>That’s {pickComparison(personalCups)}.</>
          : 'Bring your cup and scan to start saving plastic.'}
      </p>
    </div>
  );
}

const DEFAULT_INTRO = 'Bring your own cup, scan the QR at the counter, and earn cashback rewards — your cups are saved separately at each participating store.';

export default function StoresPage({
  group,
  intro,
  stores = [],
  personalCups = 0,
  onSelectStore,
  onOpenAccount,
  onOpenGuide,
}) {
  const [view, setView] = useState('list');

  // The store you have the most cups at leads; the rest follow alphabetically.
  const sorted = useMemo(
    () => [...stores].sort((a, b) => (b.balance || 0) - (a.balance || 0) || (a.name || '').localeCompare(b.name || '')),
    [stores],
  );
  const hero = sorted[0] || null;
  const others = sorted.slice(1);

  return (
    <div className="stores2">
      {/* Top bar — platform brand + account, centred. No back button: this
          is the hub. The intro sits below at full width so it reads clearly. */}
      <header className="stores2__topbar">
        <img src={packperksLogo} alt="PackPerks" className="stores2__brand-logo" />
        <div className="stores2__topbar-actions">
          <button type="button" className="stores2__iconbtn" onClick={onOpenGuide} aria-label="How it works">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" /><path d="M9.1 9a3 3 0 0 1 5.82 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </button>
          <button type="button" className="stores2__iconbtn" onClick={onOpenAccount} aria-label="Your account">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
            </svg>
          </button>
        </div>
      </header>

      {/* System explanation — full-width, editable per group (storesIntro). */}
      <p className="stores2__intro">{intro || DEFAULT_INTRO}</p>

      {/* View toggle */}
      <div className="stores2__viewtoggle" role="radiogroup" aria-label="View">
        <button type="button" role="radio" aria-checked={view === 'list'} className={`stores2__viewopt ${view === 'list' ? 'is-on' : ''}`} onClick={() => setView('list')}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg>
          List
        </button>
        <button type="button" role="radio" aria-checked={view === 'map'} className={`stores2__viewopt ${view === 'map' ? 'is-on' : ''}`} onClick={() => setView('map')}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" /><line x1="8" y1="2" x2="8" y2="18" /><line x1="16" y1="6" x2="16" y2="22" /></svg>
          Map
        </button>
      </div>

      {view === 'map' ? (
        <MapView stores={stores} highlightId={hero?.id} onSelectStore={onSelectStore} />
      ) : (
        <>
          {/* Lead store — where you have the most cups */}
          {hero && (
            <button type="button" className="stores2__hero" onClick={() => onSelectStore?.(hero)}>
              <div className="stores2__hero-logo" style={{ background: hero.brand_color || 'var(--bk-green, #1A8737)' }}>
                {hero.logo_url
                  ? <img className="stores2__hero-logo-img" src={hero.logo_url} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
                  : <span className="stores2__hero-logo-letter">{(hero.name || 'S').charAt(0).toUpperCase()}</span>}
              </div>
              <div className="stores2__hero-body">
                <span className="stores2__hero-name">{hero.name}</span>
                <Cups n={hero.balance || 0} tone="brand" />
                {(hero.rewards?.length || hero.featured) && (
                  <HeroFeatured
                    rewards={hero.rewards}
                    fallbackImage={hero.featured?.image}
                    fallbackName={hero.featured?.name}
                  />
                )}
              </div>
              <svg className="stores2__hero-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18" /></svg>
            </button>
          )}

          {/* Other stores */}
          {others.length > 0 && (
            <ul className="stores2__list">
              {others.map((s, idx) => (
                <li key={s.id}>
                  <button type="button" className="stores2__card" onClick={() => onSelectStore?.(s)}>
                    <StoreMark store={s} />
                    <div className="stores2__card-body">
                      <span className="stores2__card-name">{s.name}</span>
                      <Cups n={s.balance || 0} />
                      {s.featured && (
                        <span className="stores2__tag">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 12 20 22 4 22 4 12" /><rect x="2" y="7" width="20" height="5" /><line x1="12" y1="22" x2="12" y2="7" /><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" /><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" /></svg>
                          {s.featured.name}
                        </span>
                      )}
                    </div>
                    <RewardThumb rewards={s.rewards} fallback={s.featured?.image} delay={(idx + 1) * 450} />
                    <svg className="stores2__card-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18" /></svg>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Plastic-avoided impact (list view only) */}
          <StoresImpact personalCups={personalCups} />
        </>
      )}
    </div>
  );
}
