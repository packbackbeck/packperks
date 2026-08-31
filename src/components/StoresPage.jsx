import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import cupIcon from '../assets/images/cup-icon.svg';
import packperksLogo from '../assets/images/packperks-wordmark.svg';
import { getGlobalImpact, submitStoreRequest } from '../lib/api';
import { scoreStore } from '../lib/onboarding';
import { supabase } from '../lib/supabase';
import { CO2_GRAMS_PER_CUP, NETWORK_BASE_CUPS, pickComparison, formatCo2 } from '../lib/impact';
import { getNotYetStores } from '../lib/notYetStores';
import { getRegion } from '../lib/regions';
import { detectImageBg, useImageBg } from '../lib/imageBg';
import PendingClaims from './PendingClaims';
import { getCollectedMap, markClaimCollected } from '../lib/collectedClaims';
import './StoresPage.css';

// Great-circle distance in km between two {lat,lng} points (Haversine). Used to
// sort venues by how close they are to the customer when "Nearby" is on.
function distanceKm(a, b) {
  if (!a || !b || a.lat == null || b.lat == null || a.lng == null || b.lng == null) return Infinity;
  const R = 6371, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// "You are here" marker for the map's locate button — a pulsing blue dot.
const userDotIcon = L.divIcon({
  className: 'stores2__userdot-icon',
  html: '<span class="stores2__userdot"></span>',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

const LockIcon = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

// A tasteful, distinct brand colour per venue when none is set, derived
// deterministically from the name so it's stable across renders.
const BRAND_PALETTE = ['#E88E63', '#5FA96E', '#7C86D6', '#E0A12B', '#57C08D', '#D97E9B', '#4FA3C7', '#B06CC9', '#E0714E', '#3FA98C', '#C08A3E', '#6C8AE0'];
function colorForName(name) {
  const s = String(name || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return BRAND_PALETTE[h % BRAND_PALETTE.length];
}
function truncName(name, n = 15) {
  const s = String(name || '').trim();
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
}

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
  const bg = store?.brand_color || 'var(--pb-green, #1A8737)';
  if (store?.logo_url) {
    // Brand-coloured tile with a diagonal light→dark sheen (works on any hue)
    // and the logo tinted white — mirrors the hero logo panel.
    return (
      <span className={`${cls} stores2__mark--brand`} style={{ background: bg }}>
        <img className="stores2__mark-img" src={store.logo_url} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
      </span>
    );
  }
  return (
    <span className={cls} style={{ background: bg }}>
      {(store?.name || 'S').charAt(0).toUpperCase()}
    </span>
  );
}

/* Coming-soon venue mark. If the logo has a transparent background it's tinted
 * white on the venue colour; an opaque logo shows in its own colours, filling
 * the tile with no gaps. Letter monogram when there's no logo. */
function NotYetMark({ store }) {
  const bg = useImageBg(store.logo_url);
  if (!store.logo_url) {
    return (
      <span className="stores2__mark stores2__mark--notyet" style={{ background: store.color, color: '#fff' }} aria-hidden="true">
        {(store.name || 'S').charAt(0).toUpperCase()}
      </span>
    );
  }
  const state = bg === 'opaque' ? 'is-opaque' : 'is-transparent';
  return (
    <span className={`stores2__mark stores2__mark--notyet stores2__mark--brand ${state}`} style={{ background: store.color }} aria-hidden="true">
      <img className="stores2__mark-img" src={store.logo_url} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
    </span>
  );
}

function Cups({ n, tone }) {
  return (
    <span className={`stores2__cups${tone ? ` stores2__cups--${tone}` : ''}`}>
      <svg className="stores2__cups-icon" viewBox="0 0 33 32" fill="currentColor" aria-hidden="true">
        <path d="M25.5327 6.54688H6.71919C5.97702 6.54688 5.37537 7.1331 5.37537 7.85624V10.475C5.37537 11.1981 5.97702 11.7843 6.71919 11.7843H25.5327C26.2749 11.7843 26.8765 11.1981 26.8765 10.475V7.85624C26.8765 7.1331 26.2749 6.54688 25.5327 6.54688Z" />
        <path d="M8.06299 11.7843L10.0787 26.1873H22.1731L24.1889 11.7843Z" />
      </svg>
      <strong>{n}</strong>
    </span>
  );
}

/* City chip shown next to the cups count. City only — no country. */
function LocationChip({ city }) {
  if (!city) return null;
  return (
    <span className="stores2__loc">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="2.6" />
      </svg>
      {city}
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

/* Not-yet (coming-soon) map popup — mirrors the list-view request card exactly:
 * a progress-fill "Request" button that becomes a disabled "Requested" once
 * this device has voted, and the "{count}/{threshold} · N to go" (or "Coming
 * soon") vote tally. Shared so the map box matches the list box 1:1. */
function notYetPopupHtml(s, count, threshold, done) {
  const c = Math.max(0, Number(count) || 0);
  const t = Math.max(1, Number(threshold) || 10);
  const pct = Math.min(100, Math.round((c / t) * 100));
  const reached = c >= t;
  const countLine = reached
    ? '<span class="stores2__request-count stores2__request-count--soon">Coming soon</span>'
    : c > 0
      ? `<span class="stores2__request-count">${c}/${t} · ${t - c} to go</span>`
      : '';
  return `<div class="stores2__popcard stores2__popcard--notyet">
      <div class="stores2__popcard-top">
        <span class="stores2__popcard-logo stores2__popcard-logo--letter stores2__popcard-logo--notyet">${escapeHtml((s.name || 'S').charAt(0).toUpperCase())}</span>
        <div class="stores2__popcard-info">
          <strong class="stores2__popcard-name">${escapeHtml(s.name)}</strong>
          <span class="stores2__popcard-notyet">Not available yet</span>
        </div>
      </div>
      <div class="stores2__notyet-cta">
        <button type="button" class="stores2__request-btn stores2__popup-request${done ? ' is-done' : ''}" data-id="${escapeHtml(s.id)}" data-name="${escapeHtml(s.name)}" data-area="${escapeHtml(s.area || '')}" data-count="${c}" data-threshold="${t}"${done ? ' disabled' : ''}>
          <span class="stores2__request-fill" style="width:${pct}%"></span>
          <span class="stores2__request-label">${done ? 'Requested' : 'Request'}</span>
        </button>
        ${countLine}
      </div>
    </div>`;
}

/* Real map via Leaflet + OpenStreetMap tiles (free, no API key). Plots a
 * marker at each store's actual coordinates; the marker popup shows the
 * store name, address and cups, with a button to open that store. */
function MapView({ stores, notYetStores = [], highlightId, onSelectStore, onRequestStore, requested = new Set(), reqCounts = {}, notYetThreshold = 10, userLoc = null, onLocate, focus = null, nearbyActive = false }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const userMarkerRef = useRef(null);
  const [locating, setLocating] = useState(false);
  const fitSigRef = useRef(null); // only refit the map when the geography changes
  // The customer's onboarding region { lat, lng, zoom }. The map opens focused
  // here (rather than fitting every marker), so a NL user lands on NL — but
  // every region's venues are still plotted and reachable by panning.
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const onSelectRef = useRef(onSelectStore);
  onSelectRef.current = onSelectStore;
  const onRequestRef = useRef(onRequestStore);
  onRequestRef.current = onRequestStore;

  const withCoords = stores.filter(s => s.location?.lat != null && s.location?.lng != null);
  const notYetCoords = notYetStores.filter(s => s.location?.lat != null && s.location?.lng != null);
  // Stable signature so markers only rebuild when the data really changes.
  const sig = [
    ...withCoords.map(s => `${s.id}:${s.location.lat},${s.location.lng}:${s.balance}:${s.id === highlightId}`),
    ...notYetCoords.map(s => `n:${s.id}:${s.location.lat},${s.location.lng}`),
  ].join('|');
  // Vote state (requested + count + threshold) for the not-yet popups. When
  // this changes — a vote in the list OR the map, or the count RPC resolving —
  // the popups rebuild so the map box stays in sync with the list box.
  const notYetStateSig = notYetCoords
    .map(s => `${s.id}:${requested.has(s.id || s.name) ? 1 : 0}:${reqCounts[s.name] || 0}`)
    .join('|') + `|t${notYetThreshold}`;

  // Detect whether each not-yet logo has a transparent background so the pin
  // can render it white (transparent) or in its own colours (opaque).
  const [logoBg, setLogoBg] = useState({});
  const notYetLogos = notYetCoords.map(s => s.logo_url).filter(Boolean);
  const notYetLogosKey = [...new Set(notYetLogos)].join('|');
  useEffect(() => {
    const urls = [...new Set(notYetLogos)];
    if (!urls.length) return undefined;
    let alive = true;
    Promise.all(urls.map(u => detectImageBg(u).then(bg => [u, bg]))).then(pairs => {
      if (alive) setLogoBg(prev => ({ ...prev, ...Object.fromEntries(pairs) }));
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notYetLogosKey]);
  const logoBgSig = notYetCoords.map(s => `${s.id}:${logoBg[s.logo_url] || ''}`).join('|');

  // Create the map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return undefined;
    const map = L.map(containerRef.current, { zoomControl: true, scrollWheelZoom: false });
    // CARTO "Voyager" — a soft, friendly, simplified basemap (free, no key).
    /* Basemap: OSM "Humanitarian" — soft pastel palette, calm labels, and
       (unlike Carto's keyless CDN, which now stamps "API KEY REQUIRED"
       across every tile) free with no key. The Redirect Refund bin map
       uses the same layer so both maps read as one product. */
    L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', {
      subdomains: 'ab',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · HOT',
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);
    const f0 = focusRef.current;
    map.setView(f0 ? [f0.lat, f0.lng] : [52.13, 5.29], f0 ? f0.zoom : 7); // open on the customer's region
    map.on('popupopen', (e) => {
      const root = e.popup.getElement();
      const btn = root?.querySelector('.stores2__popup-btn');
      if (btn) btn.onclick = () => {
        const st = stores.find(x => x.id === btn.dataset.id);
        if (st) onSelectRef.current?.(st);
      };
      const req = root?.querySelector('.stores2__popup-request');
      if (req && !req.classList.contains('is-done') && !req.disabled) req.onclick = () => {
        const store = { id: req.dataset.id, name: req.dataset.name, area: req.dataset.area };
        onRequestRef.current?.(store);
        // Reflect the vote in this popup AND on reopen: one vote only, with the
        // count/progress bumped — mirroring the list card's "Requested" state.
        const newCount = (Number(req.dataset.count) || 0) + 1;
        const threshold = Number(req.dataset.threshold) || 10;
        e.popup.setContent(notYetPopupHtml(store, newCount, threshold, true));
      };
    });
    setTimeout(() => map.invalidateSize(), 80);
    return () => { map.remove(); mapRef.current = null; layerRef.current = null; userMarkerRef.current = null; };
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
      const letter = (s.name || 'S').charAt(0).toUpperCase();
      const pinInner = s.logo_url
        ? `<img class="stores2__leaflet-logo" src="${escapeHtml(s.logo_url)}" alt="" />`
        : escapeHtml(letter);
      const icon = L.divIcon({
        className: 'stores2__leaflet-icon',
        html: `<div class="stores2__pinwrap"><span class="stores2__leaflet-pin${isTop ? ' is-current' : ''}" style="background:${s.brand_color || '#1A8737'}">${pinInner}</span><span class="stores2__pinlabel">${escapeHtml(truncName(s.name))}</span></div>`,
        iconSize: [112, 56], iconAnchor: [56, 19], popupAnchor: [0, -18],
      });
      // Participating stores sit ABOVE the not-yet placeholders.
      const marker = L.marker([s.location.lat, s.location.lng], { icon, zIndexOffset: 600 }).addTo(layer);
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
    // Not-yet (non-participating) venues — muted, locked pins so the map reads
    // as a real, dense network without implying these are live yet.
    notYetCoords.forEach(s => {
      const color = s.color || colorForName(s.name);
      const inner = s.logo_url
        ? `<img class="stores2__leaflet-logo" src="${escapeHtml(s.logo_url)}" alt="" />`
        : escapeHtml((s.name || 'S').charAt(0).toUpperCase());
      const logoState = s.logo_url ? (logoBg[s.logo_url] === 'opaque' ? 'is-opaque' : 'is-transparent') : '';
      const icon = L.divIcon({
        className: 'stores2__leaflet-icon',
        html: `<div class="stores2__pinwrap stores2__pinwrap--notyet"><span class="stores2__leaflet-pin stores2__leaflet-pin--notyet ${logoState}" style="background:${color}">${inner}</span><span class="stores2__pinlabel stores2__pinlabel--notyet">${escapeHtml(truncName(s.name))}</span></div>`,
        iconSize: [104, 52], iconAnchor: [52, 16], popupAnchor: [0, -14],
      });
      const marker = L.marker([s.location.lat, s.location.lng], { icon, zIndexOffset: 0 }).addTo(layer);
      // Popup mirrors the list-view request card: vote count + "N to go" and a
      // once-only Request button (already-voted → disabled "Requested"). State
      // comes from the shared `requested` set + `reqCounts`, so map ↔ list stay
      // in sync.
      marker.bindPopup(notYetPopupHtml(s, reqCounts[s.name] || 0, notYetThreshold, requested.has(s.id || s.name)));
      pts.push([s.location.lat, s.location.lng]);
    });
    // Only (re)fit the map when the geography actually changed — NOT on a
    // vote/state-only rebuild, or the map would jump every time someone votes.
    if (sig !== fitSigRef.current) {
      fitSigRef.current = sig;
      const f = focusRef.current;
      if (f) {
        // Multi-regional: stay zoomed on the customer's region (other regions'
        // pins remain on the map, a pan away), instead of fitting the world.
        map.setView([f.lat, f.lng], f.zoom);
      } else if (pts.length === 1) map.setView(pts[0], 15);
      else if (pts.length > 1) map.fitBounds(pts, { padding: [50, 50], maxZoom: 14 });
    }
    setTimeout(() => map.invalidateSize(), 80);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, highlightId, logoBgSig, notYetStateSig]);

  // Add or move the "you are here" marker on the CURRENT map. hasLayer() guards
  // against a stale marker left on a torn-down map (dev StrictMode remount).
  const showUserMarker = (loc) => {
    const map = mapRef.current;
    if (!map || !loc || loc.lat == null) return;
    if (userMarkerRef.current && map.hasLayer(userMarkerRef.current)) {
      userMarkerRef.current.setLatLng([loc.lat, loc.lng]);
    } else {
      userMarkerRef.current = L.marker([loc.lat, loc.lng], { icon: userDotIcon, zIndexOffset: 1000, interactive: false, keyboard: false }).addTo(map);
    }
  };

  // Keep the marker in sync with the shared user location (set by this button or
  // by "Nearby"). Placed, not auto-centred.
  useEffect(() => {
    if (userLoc && userLoc.lat != null) showUserMarker(userLoc);
    else if (userMarkerRef.current && mapRef.current?.hasLayer(userMarkerRef.current)) {
      mapRef.current.removeLayer(userMarkerRef.current);
      userMarkerRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userLoc]);

  // Frame the map on the user AND the nearest venue, so "where am I" always
  // shows at least one place they can actually collect at (not an empty patch of
  // map). Falls back to a plain recentre if there are no venues with coordinates.
  const focusUserWithNearest = (loc) => {
    const map = mapRef.current;
    if (!map || !loc || loc.lat == null) return;
    map.invalidateSize(); // ensure fitBounds computes against the real size
    showUserMarker(loc);
    let nearest = null, best = Infinity;
    [...withCoords, ...notYetCoords].forEach((s) => {
      const d = distanceKm(loc, s.location);
      if (d < best) { best = d; nearest = s; }
    });
    if (nearest) {
      map.fitBounds(
        [[loc.lat, loc.lng], [nearest.location.lat, nearest.location.lng]],
        { padding: [70, 70], maxZoom: 16, animate: true },
      );
    } else {
      map.setView([loc.lat, loc.lng], 15, { animate: true });
    }
  };

  // Locate button: get the user's position (asking permission if needed), drop
  // the marker, and frame the map on them + their nearest venue.
  const handleLocate = async () => {
    setLocating(true);
    let loc = null;
    try { loc = await onLocate?.(); } catch { /* denied / unavailable */ }
    setLocating(false);
    if (loc && loc.lat != null) focusUserWithNearest(loc);
  };

  // "Nearby" (the toolbar toggle) should also frame the map on the user + the
  // closest venue — not just re-sort the list. Fires when it's switched on and
  // a location is available (also on a fresh map mount while already active).
  useEffect(() => {
    if (nearbyActive && userLoc && userLoc.lat != null) focusUserWithNearest(userLoc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nearbyActive, userLoc]);

  return (
    <div className="stores2__map">
      <div ref={containerRef} className="stores2__map-canvas" />
      {onLocate && (
        <button
          type="button"
          className={`stores2__locate${locating ? ' is-locating' : ''}`}
          onClick={handleLocate}
          disabled={locating}
          aria-label="Find my location"
        >
          {locating ? (
            <span className="stores2__locate-spinner" aria-hidden="true" />
          ) : (
            <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="7" />
              <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
              <line x1="12" y1="1.6" x2="12" y2="4.4" /><line x1="12" y1="19.6" x2="12" y2="22.4" />
              <line x1="1.6" y1="12" x2="4.4" y2="12" /><line x1="19.6" y1="12" x2="22.4" y2="12" />
            </svg>
          )}
        </button>
      )}
      {withCoords.length === 0 && notYetCoords.length === 0 && (
        <p className="stores2__map-hint">No store locations to show yet.</p>
      )}
    </div>
  );
}

/* Plastic-avoided impact of bringing your own cup: what you saved + what
 * the whole PackPerks community saved, with a tangible comparison. */
function StoresImpact({ personalCups }) {
  const [communityCups, setCommunityCups] = useState(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    getGlobalImpact().then(r => { if (alive) setCommunityCups(r?.totalLifetimeCups || 0); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  // Impact is shown as CO₂e avoided (72 g / cup). The collective figure is the
  // whole Packback network's returned cups (base) PLUS every cup returned
  // through PackPerks, so it's meaningful from day one.
  const personalCo2 = (personalCups || 0) * CO2_GRAMS_PER_CUP;
  const communityTotalCups = NETWORK_BASE_CUPS + (communityCups || 0);
  const communityCo2 = communityTotalCups * CO2_GRAMS_PER_CUP;
  // Personal square → a leaf (your own footprint). Community square → a
  // group/people glyph (everyone on PackPerks together).
  const LeafIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" /><path d="M2 21c0-3 1.85-5.36 5.08-6" />
    </svg>
  );
  const GroupIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
  return (
    <>
      {/* Fade the list into the background at the bottom so the floating
          impact bar clearly stands out above the scrolling cards. */}
      <div className="stores2__impact-fade" aria-hidden="true" />
    <div className={`stores2__impact stores2__impact--floating${open ? ' is-open' : ''}`}>
      {/* Anchored to the bottom of the viewport; the panel sits ABOVE the bar
          so expanding reveals it upwards. When open the bar's number is hidden
          (the panel already shows it) — only the chevron handle remains. */}
      <div className="stores2__impact-panel">
        <div className="stores2__impact-panel-inner">
          <div className="stores2__impact-panel-pad">
            <div className="stores2__impact-squares">
              <div className="stores2__impact-sq">
                <span className="stores2__impact-icon"><LeafIcon /></span>
                <span className="stores2__impact-val">{formatCo2(personalCo2)}</span>
                <span className="stores2__impact-cap">CO₂ you’ve avoided</span>
              </div>
              <div className="stores2__impact-sq stores2__impact-sq--community">
                <span className="stores2__impact-icon"><GroupIcon /></span>
                <span className="stores2__impact-val">{formatCo2(communityCo2)}</span>
                <span className="stores2__impact-cap">CO₂ across the whole Packback network</span>
              </div>
            </div>
            <p className="stores2__impact-compare">
              {personalCups > 0
                ? <>That’s {pickComparison(personalCups)}.</>
                : 'Bring your cup and scan to start cutting CO₂.'}
            </p>
          </div>
        </div>
      </div>
      {/* Folded: one compact bar with the community total. Tap to expand the
          panel above it (chevron points up when folded, down when open). When
          open the icon + number hide (the panel repeats them) — chevron stays. */}
      <button type="button" className="stores2__impact-bar" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-label={open ? 'Hide impact detail' : 'Show impact detail'}>
        <span className="stores2__impact-bar-icon"><GroupIcon /></span>
        <span className="stores2__impact-bar-text"><strong>{formatCo2(communityCo2)}</strong> CO₂ avoided together</span>
        <svg className="stores2__impact-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="18 15 12 9 6 15" /></svg>
      </button>
    </div>
    </>
  );
}

const DEFAULT_INTRO = 'PackPerks pays you back for reusing your cup. Collect cups at the cafés below and turn them into real cashback, no deposit, no catch.';

/* Pull the city from a free-form area string ("De Pijp, Amsterdam" → "Amsterdam"). */
function cityFromArea(area) {
  const parts = String(area || '').split(',').map(s => s.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

export default function StoresPage({
  group,
  intro,
  stores = [],
  personalCups = 0,
  region = 'NL',
  showNotYet = true,
  notYetStores = null,
  notYetThreshold = 10,
  userClaims = [],
  onboardingPrefs = null,
  onSelectStore,
  onOpenAccount,
  onOpenGuide,
  onScanCup,
  onRequestStore,
}) {
  const [view, setView] = useState('list');
  const [query, setQuery] = useState('');
  // While the search field is focused, collapse the Nearby + Map buttons to
  // icon-only so the field has room to breathe.
  const [searchFocused, setSearchFocused] = useState(false);

  // ── Cashback claims in progress (showcased at the top of the market) ──
  // Enrich each claim with its reward's name/image by searching across every
  // store in the group (claims can be from any venue). PendingClaims filters to
  // the active ones (in review / ready to collect) itself.
  const enrichedClaims = useMemo(() => (userClaims || []).map((c) => {
    let reward = null;
    for (const st of stores) {
      const r = (st.rewards || []).find((rr) => rr.id === c.reward_id);
      if (r) { reward = r; break; }
    }
    return { ...c, rewardName: reward?.name || 'Cashback reward', rewardImage: reward?.image || null, rewardBg: reward?.bgColor || null };
  }), [userClaims, stores]);
  const [collectedClaims, setCollectedClaims] = useState(() => getCollectedMap());
  const handleCollectClaim = (claim) => {
    if (!claim?.id) return;
    markClaimCollected(claim.id);
    setCollectedClaims({ ...getCollectedMap() });
  };

  // ── "Nearby" sort: one tap sorts venues by distance to the customer (asks
  // for location permission), a second tap turns it back off. ──
  const [nearby, setNearby] = useState(false);
  const [userLoc, setUserLoc] = useState(null);
  const [locating, setLocating] = useState(false);
  const requestLocation = () => new Promise((resolve) => {
    if (userLoc) { resolve(userLoc); return; }
    if (typeof navigator === 'undefined' || !navigator.geolocation) { resolve(null); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => { setLocating(false); const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude }; setUserLoc(loc); resolve(loc); },
      () => { setLocating(false); resolve(null); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  });
  const toggleNearby = async () => {
    if (nearby) { setNearby(false); return; }
    const loc = await requestLocation();
    if (loc) setNearby(true);
  };
  // Vendors this device has already requested — persisted so a page refresh
  // can't let the same person vote for the same venue again.
  const [requested, setRequested] = useState(() => {
    try {
      const a = JSON.parse(localStorage.getItem('packperks_requested_vendors') || '[]');
      return new Set(Array.isArray(a) ? a : []);
    } catch { return new Set(); }
  });
  // How many customers have tapped "Request it" per coming-soon venue (name →
  // count), read from an aggregate RPC so it works for anonymous visitors.
  const [reqCounts, setReqCounts] = useState({});
  useEffect(() => {
    let alive = true;
    supabase.rpc('vendor_request_counts', { p_region: region })
      .then(({ data }) => {
        if (!alive || !Array.isArray(data)) return;
        const m = {};
        data.forEach(r => { if (r.name) m[r.name] = Number(r.count) || 0; });
        setReqCounts(m);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [region]);

  const q = query.trim().toLowerCase();
  const matchQ = (s) => !q || `${s.name || ''} ${s.area || ''}`.toLowerCase().includes(q);

  // Fixed order: most cups first, then alphabetical.
  const cmpCupsThenName = (a, b) =>
    (b.balance || 0) - (a.balance || 0) || (a.name || '').localeCompare(b.name || '');
  // Onboarding match score (0 without prefs), applied before the cups/name
  // order so cafés matching the customer's city + drinks float to the top.
  const cmpByPrefs = (a, b) => (scoreStore(b, onboardingPrefs) - scoreStore(a, onboardingPrefs));
  // Region-first: the customer's onboarding region (the `region` prop) floats
  // to the top; other regions' venues still list below. (No-op while every
  // vendor shares one region.)
  const cmpByRegion = (a, b) =>
    ((a.region === region ? 0 : 1) - (b.region === region ? 0 : 1));

  // Participating stores — filtered by search. Ordered by distance to the
  // customer when "Nearby" is on (venues without coordinates fall to the end),
  // otherwise the customer's region → onboarding match → cups-first / A→Z.
  const sortedStores = useMemo(() => {
    const list = stores.filter(matchQ);
    if (nearby && userLoc) {
      return list.slice().sort((a, b) =>
        (distanceKm(userLoc, a.location) - distanceKm(userLoc, b.location)) || cmpCupsThenName(a, b));
    }
    return list.slice().sort((a, b) => cmpByRegion(a, b) || cmpByPrefs(a, b) || cmpCupsThenName(a, b));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stores, q, nearby, userLoc, onboardingPrefs, region]);

  // "Coming soon" venues — admin-edited list from the group config when present,
  // otherwise the curated region defaults. Each gets a stable brand colour.
  const notYet = useMemo(() => {
    if (!showNotYet) return [];
    const src = (Array.isArray(notYetStores) && notYetStores.length) ? notYetStores : getNotYetStores(region);
    return src.map((v) => ({
      // E.14.9: derive the id from a STABLE name-slug, not the list index —
      // otherwise reordering the list reassigned the saved "Requested" state
      // (persisted by id in localStorage) to whichever venue now sits in that slot.
      id: v.id || `notyet-${v.region || region}-${(v.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}`,
      name: v.name,
      area: v.area,
      location: { lat: v.lat, lng: v.lng, city: v.city || null },
      color: v.color || colorForName(v.name),
      logo_url: v.logo_url || null,
      // Curated drink tags → let the onboarding prefs float matching venues up.
      tags: Array.isArray(v.tags) ? v.tags : [],
      region: v.region || region,   // which region this coming-soon venue belongs to
      notYet: true,
      balance: 0,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [region, showNotYet, notYetStores]);
  const filteredNotYet = useMemo(() => {
    const list = notYet.filter(matchQ);
    if (nearby && userLoc) {
      return list.slice().sort((a, b) =>
        (distanceKm(userLoc, a.location) - distanceKm(userLoc, b.location)) || (a.name || '').localeCompare(b.name || ''));
    }
    // Customer's chosen region first, then other regions; prefs + A→Z within.
    return list.slice().sort((a, b) => cmpByRegion(a, b) || cmpByPrefs(a, b) || (a.name || '').localeCompare(b.name || ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notYet, q, nearby, userLoc, onboardingPrefs, region]);

  // The lead "hero" (your top store) only fits the default, unsearched view.
  const showHero = !q;
  const hero = showHero ? sortedStores[0] || null : null;
  const others = hero ? sortedStores.slice(1) : sortedStores;
  const topId = (stores.slice().sort((a, b) => (b.balance || 0) - (a.balance || 0))[0] || {}).id;

  const handleRequest = (s) => {
    const key = s.id || s.name;
    if (requested.has(key)) return;
    setRequested(prev => {
      const n = new Set(prev); n.add(key);
      try { localStorage.setItem('packperks_requested_vendors', JSON.stringify([...n])); } catch { /* quota / private mode */ }
      return n;
    });
    // Optimistically count this tap so the progress bar moves immediately.
    setReqCounts(prev => ({ ...prev, [s.name]: (prev[s.name] || 0) + 1 }));
    onRequestStore?.(s);
  };
  const isRequested = (s) => requested.has(s.id || s.name);
  const noResults = q && sortedStores.length === 0 && filteredNotYet.length === 0;

  return (
    <div className="stores2">
      {/* Top bar — platform brand + account, centred. No back button: this
          is the hub. The intro sits below at full width so it reads clearly. */}
      <header className="stores2__topbar">
        <img src={packperksLogo} alt="PackPerks" className="stores2__brand-logo" />
        <div className="stores2__topbar-actions">
          {onScanCup && (
            <button type="button" className="stores2__iconbtn stores2__iconbtn--scan" onClick={onScanCup} aria-label="Scan a cup QR">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          )}
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

      {/* Newcomer-focused headline + value prop — this is the entry page for
          first-time users, so it sells the reward, not just "browse stores". */}
      <div className="stores2__intro-block">
        <h1 className="stores2__headline">Earn real <span className="stores2__headline-accent">cashback</span> for reusing your cup</h1>
        <p className="stores2__intro">{intro || DEFAULT_INTRO}</p>
      </div>

      {/* Cashback claims in progress — showcased here so customers can track and
          collect them from the market too, not only their profile. Renders
          nothing when there are no active claims. */}
      <div className="stores2__claims">
        <PendingClaims claims={enrichedClaims} collectedMap={collectedClaims} onCollect={handleCollectClaim} />
      </div>

      {/* Search + view switch — filters both the list and the map at once.
          Stores are always ordered by your cups first, then alphabetically,
          so there are no sort controls — just a rectangular Map/List toggle. */}
      <div className={`stores2__filterbar${searchFocused ? ' is-searching' : ''}`}>
        <div className={`stores2__search${q ? ' is-filled' : ''}`}>
          <svg className="stores2__search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
          <input
            type="text"
            className="stores2__search-input"
            placeholder="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            aria-label="Search stores"
          />
          {query && (
            <button type="button" className="stores2__search-clear" onClick={() => setQuery('')} aria-label="Clear search">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          )}
        </div>
        <button
          type="button"
          className={`stores2__nearbybtn${nearby ? ' is-active' : ''}`}
          onClick={toggleNearby}
          disabled={locating && !nearby}
          aria-pressed={nearby}
          aria-label={nearby ? 'Turn off nearby sorting' : 'Sort venues by nearest to me'}
          title={nearby ? 'Sorted by nearest, tap to turn off' : 'Sort by nearest to me'}
        >
          {locating && !nearby ? (
            <span className="stores2__nearby-spinner" aria-hidden="true" />
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="7" />
              <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
              <line x1="12" y1="1.6" x2="12" y2="4.4" /><line x1="12" y1="19.6" x2="12" y2="22.4" />
              <line x1="1.6" y1="12" x2="4.4" y2="12" /><line x1="19.6" y1="12" x2="22.4" y2="12" />
            </svg>
          )}
          <span className="stores2__nearby-label">Nearby</span>
        </button>
        <button
          type="button"
          className="stores2__mapbtn"
          onClick={() => setView(view === 'map' ? 'list' : 'map')}
          aria-pressed={view === 'map'}
        >
          {view === 'map' ? (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg>
              <span className="stores2__mapbtn-label">List view</span>
            </>
          ) : (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" /><line x1="8" y1="2" x2="8" y2="18" /><line x1="16" y1="6" x2="16" y2="22" /></svg>
              <span className="stores2__mapbtn-label">Map view</span>
            </>
          )}
        </button>
      </div>

      {view === 'map' ? (
        <MapView
          stores={sortedStores}
          notYetStores={filteredNotYet}
          highlightId={topId}
          onSelectStore={onSelectStore}
          onRequestStore={handleRequest}
          requested={requested}
          reqCounts={reqCounts}
          notYetThreshold={notYetThreshold}
          userLoc={userLoc}
          onLocate={requestLocation}
          focus={getRegion(region).map}
          nearbyActive={nearby}
        />
      ) : (
        <>
          {/* Lead store — where you have the most cups (default view only) */}
          {hero && (
            <button type="button" className="stores2__hero" onClick={() => onSelectStore?.(hero)}>
              <div className="stores2__hero-logo" style={{ background: hero.brand_color || 'var(--pb-green, #1A8737)' }}>
                {hero.logo_url
                  ? <img className="stores2__hero-logo-img" src={hero.logo_url} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
                  : <span className="stores2__hero-logo-letter">{(hero.name || 'S').charAt(0).toUpperCase()}</span>}
              </div>
              <div className="stores2__hero-body">
                <span className="stores2__hero-name">{hero.name}</span>
                <div className="stores2__chips">
                  <Cups n={hero.balance || 0} tone="brand" />
                  <LocationChip city={hero.location?.city} />
                </div>
                {(hero.rewards?.length || hero.featured) && (
                  <HeroFeatured
                    rewards={hero.rewards}
                    fallbackImage={hero.featured?.image}
                    fallbackName={hero.featured?.name}
                  />
                )}
              </div>
            </button>
          )}

          {/* One unified list — participating stores first (cups, then A→Z),
              then the curated coming-soon venues (alphabetical). */}
          {(others.length > 0 || filteredNotYet.length > 0) && (
            <ul className="stores2__list">
              {others.map((s, idx) => (
                <li key={s.id}>
                  <button type="button" className="stores2__card" onClick={() => onSelectStore?.(s)}>
                    <StoreMark store={s} />
                    <div className="stores2__card-body">
                      <span className="stores2__card-name">{s.name}</span>
                      <div className="stores2__chips">
                        <Cups n={s.balance || 0} />
                        <LocationChip city={s.location?.city} />
                      </div>
                    </div>
                    <RewardThumb rewards={s.rewards} fallback={s.featured?.image} delay={(idx + 1) * 450} />
                  </button>
                </li>
              ))}
              {filteredNotYet.map((s) => {
                const threshold = Math.max(1, Number(notYetThreshold) || 10);
                const count = reqCounts[s.name] || 0;
                const reached = count >= threshold;
                const pct = Math.min(100, Math.round((count / threshold) * 100));
                const done = isRequested(s);
                const city = cityFromArea(s.area);
                return (
                  <li key={s.id}>
                    <div className="stores2__card stores2__card--notyet">
                      <NotYetMark store={s} />
                      <div className="stores2__card-body">
                        <span className="stores2__card-name">{s.name}</span>
                        <div className="stores2__notyet-meta">
                          <span className="stores2__notyet-status"><LockIcon /> Not available yet</span>
                          {city && <LocationChip city={city} />}
                        </div>
                      </div>
                      <div className="stores2__notyet-cta">
                        {/* The request goal fills the button background (grey → black). */}
                        <button
                          type="button"
                          className={`stores2__request-btn${done ? ' is-done' : ''}`}
                          onClick={() => handleRequest(s)}
                          disabled={done}
                        >
                          <span className="stores2__request-fill" style={{ width: `${pct}%` }} aria-hidden="true" />
                          <span className="stores2__request-label">{done ? 'Requested' : 'Request'}</span>
                        </button>
                        {reached
                          ? <span className="stores2__request-count stores2__request-count--soon">Coming soon</span>
                          : count > 0
                            ? <span className="stores2__request-count">{count}/{threshold} · {threshold - count} to go</span>
                            : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {noResults && <p className="stores2__noresults">No stores match “{query}” yet.</p>}

          {/* Haven't found your store? A free-text request that lands on the
              admin Future vendors page. Emphasised when a search found nothing. */}
          <StoreRequestForm region={region} suggested={noResults ? query : ''} emphasized={noResults} />

          {/* Plastic-avoided impact — a fixed floating bar (list view only). The
              spacer reserves scroll clearance so the last card clears the bar. */}
          {!q && <div className="stores2__impact-spacer" aria-hidden="true" />}
          {!q && <StoresImpact personalCups={personalCups} />}
        </>
      )}
    </div>
  );
}

/* "Haven't found your store?" — one free-text field + Request. The request
 * lands in `store_requests` (always, regardless of cookie consent) and shows on
 * the admin Future vendors page. When a search finds nothing, this is
 * emphasised and pre-filled with what the customer searched for. */
function StoreRequestForm({ region = 'NL', suggested = '', emphasized = false }) {
  const [name, setName] = useState('');
  const [state, setState] = useState('idle');   // idle | sending | done
  const editedRef = useRef(false);

  // Mirror the failed search term into the field while the customer hasn't
  // typed here directly. (An earlier "only when empty" version froze at the
  // first few letters that stopped matching, so the field showed just those.)
  // Reset once the search clears, so the next no-results search mirrors again.
  useEffect(() => {
    if (emphasized && !editedRef.current) setName(suggested);
    if (!suggested) editedRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emphasized, suggested]);

  const submit = async (e) => {
    e?.preventDefault();
    const clean = name.trim();
    if (!clean || state === 'sending') return;
    setState('sending');
    await submitStoreRequest(clean, { region });
    setState('done');
  };

  if (state === 'done') {
    return (
      <section className={`stores2__reqform is-done${emphasized ? ' is-emph' : ''}`}>
        <span className="stores2__reqform-check" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
        </span>
        <div className="stores2__reqform-donetxt">
          <strong>Thanks, request received</strong>
          <span>We’ll look into bringing this spot to PackPerks.</span>
        </div>
      </section>
    );
  }

  return (
    <section className={`stores2__reqform${emphasized ? ' is-emph' : ''}`}>
      <div className="stores2__reqform-head">
        <h3 className="stores2__reqform-title">Haven’t found your store?</h3>
        <p className="stores2__reqform-sub">Tell us the café or shop you’d like to see, and we’ll look into it.</p>
      </div>
      <form className="stores2__reqform-row" onSubmit={submit}>
        <input
          type="text"
          className="stores2__reqform-input"
          placeholder="Store name and city"
          value={name}
          onChange={(e) => { editedRef.current = true; setName(e.target.value); }}
          maxLength={200}
          aria-label="Store you’d like to see on PackPerks"
        />
        <button
          type="submit"
          className="stores2__reqform-btn"
          disabled={!name.trim() || state === 'sending'}
        >
          {state === 'sending' ? 'Sending…' : 'Request'}
        </button>
      </form>
    </section>
  );
}
