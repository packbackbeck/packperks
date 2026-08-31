import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { getMyClaims, getMyPending, getSmartbinLocations } from '../lib/api';
import { readRefundAccount } from './TikkieOnlyPage';
import UserPage from './UserPage';
import Header from './Header';
import smartbinTop from '../assets/images/smartbin-top.png';
import './TikkieHomePage.css';

/* Redirect Refund home — the account view for a mode that, until now,
 * had no users at all.
 *
 * It reuses the REAL home-page chrome (the `.app` shell and the shared
 * <Header>, minus the add-cups and cup-balance tiles: cups go in the
 * smart bin, and there is no balance). Where the normal home shows
 * rewards, this shows the money:
 *
 *   • hero tile — total refunded, with the still-uncollected amount
 *   • "Ready to collect" — unclaimed Tikkie links, one tap away
 *   • "In process" — receipts scanned before the bin's confirmation
 *     reached us; the link appears (and the customer is emailed) the
 *     moment it does
 *   • history, and the smart-bin map (same style as the market map)
 *
 * Reached from /<slug>/ with no batch in the URL: either the customer
 * saved a refund for later (account in localStorage) or they typed the
 * URL — the empty state explains what to do. */

/* Where the map opens when there are no pins yet: the Netherlands. Real
 * pins come from smartbin_locations, managed on the dashboard's Smart
 * Bins page — the map fits itself around whatever is live. */
const NL_CENTER = [52.15, 5.3];
const NL_ZOOM = 7;

/* "Ready to collect" hygiene: once the customer has OPENED a link and 24
 * hours have passed, it leaves the list (they almost certainly claimed it;
 * Tikkie statuses lag) — but the refund stays in the history below. Opens
 * are only knowable client-side, so they live in localStorage. */
const OPENED_KEY = (orgId) => `packperks_tikkie_opened:${orgId}`;
const OPENED_TTL_MS = 24 * 60 * 60 * 1000;
function readOpened(orgId) {
  try { return JSON.parse(localStorage.getItem(OPENED_KEY(orgId)) || '{}'); } catch { return {}; }
}
function markOpened(orgId, claimId) {
  try {
    const m = readOpened(orgId);
    if (!m[claimId]) {
      m[claimId] = Date.now();
      localStorage.setItem(OPENED_KEY(orgId), JSON.stringify(m));
    }
  } catch { /* fine */ }
}

/* Count the hero total up to its new value instead of snapping.
 * Only ever animates UPWARD (a refund landing is the moment worth
 * celebrating); a correction downward just lands. Honours
 * prefers-reduced-motion, and never leaves a stale number on screen. */
function useCountUp(target, duration = 900) {
  const [shown, setShown] = useState(target);
  const fromRef = useRef(target);
  const rafRef = useRef(0);

  useEffect(() => {
    const from = fromRef.current;
    fromRef.current = target;
    const reduce = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce || target <= from) { setShown(target); return undefined; }

    const started = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - started) / duration);
      // easeOutCubic: quick off the mark, settles gently on the number.
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(from + (target - from) * eased);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else setShown(target);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  return shown;
}

function fmtWhen(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/* "You are here" marker for the locate button - same pulsing dot as the
 * BYO market map. */
const userDotIcon = L.divIcon({
  className: 'tikkie-home__userdot-icon',
  html: '<span class="tikkie-home__userdot"></span>',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

/* Popup text is venue data from our own dashboard, but it still goes
 * through innerHTML — escape it rather than trust it. */
function esc(v) {
  return String(v ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
}

function BinMap({ bins }) {
  const mapRef = useRef(null);
  const elRef = useRef(null);
  const layerRef = useRef(null);
  const userMarkerRef = useRef(null);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    if (!elRef.current || mapRef.current) return;
    // Same interaction model as the BYO market map: +/- zoom controls,
    // draggable, pinch-zoom on touch (scroll-wheel zoom stays off so the
    // page can still be scrolled past the map).
    const map = L.map(elRef.current, {
      center: NL_CENTER,
      zoom: NL_ZOOM,
      zoomControl: true,
      attributionControl: false,
      scrollWheelZoom: false,
      dragging: true,
    });
    /* Exactly the layer the BYO market map uses: OSM "Humanitarian" — soft
       pastel, calm labels, free and keyless. */
    L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', {
      subdomains: 'ab',
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap · HOT',
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; layerRef.current = null; };
  }, []);

  /* Re-pin whenever the location list changes, and frame the map around
   * every bin (one bin → a close view; a national network → the country). */
  useEffect(() => {
    const map = mapRef.current, layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    if (!bins.length) { map.setView(NL_CENTER, NL_ZOOM); return; }
    const icon = L.divIcon({
      className: 'tikkie-home__pin',
      html: '<div class="tikkie-home__pin-dot">♻︎</div>',
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });
    bins.forEach(b => {
      L.marker([b.lat, b.lng], { icon })
        .addTo(layer)
        .bindPopup(`<strong>${esc(b.name)}</strong>${b.address ? `<br>${esc(b.address)}` : ''}`);
    });
    if (bins.length === 1) map.setView([bins[0].lat, bins[0].lng], 14);
    else map.fitBounds(bins.map(b => [b.lat, b.lng]), { padding: [18, 18], maxZoom: 13 });
  }, [bins]);

  /* Locate: drop the pulsing you-are-here dot and frame the map on the
   * customer plus the nearest bin, like the market map does. */
  const handleLocate = () => {
    if (locating || typeof navigator === 'undefined' || !navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const map = mapRef.current;
        if (!map) return;
        const loc = [pos.coords.latitude, pos.coords.longitude];
        if (userMarkerRef.current) userMarkerRef.current.setLatLng(loc);
        else userMarkerRef.current = L.marker(loc, { icon: userDotIcon, interactive: false }).addTo(map);
        // Frame the customer together with their nearest bin.
        let nearest = null, best = Infinity;
        for (const b of bins) {
          const d = (b.lat - loc[0]) ** 2 + (b.lng - loc[1]) ** 2;
          if (d < best) { best = d; nearest = b; }
        }
        if (nearest) {
          map.fitBounds([loc, [nearest.lat, nearest.lng]], { padding: [50, 50], maxZoom: 16, animate: true });
        } else {
          map.setView(loc, 14, { animate: true });
        }
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  };

  return (
    <div className="tikkie-home__map-wrap">
      <div ref={elRef} className="tikkie-home__map" aria-label="Smart bin locations" />
      <button
        type="button"
        className="tikkie-home__locate"
        onClick={handleLocate}
        disabled={locating}
        aria-label="Find my location"
      >
        {locating ? (
          <span className="tikkie-home__locate-spinner" aria-hidden="true" />
        ) : (
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="7" />
            <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
            <line x1="12" y1="1.6" x2="12" y2="4.4" /><line x1="12" y1="19.6" x2="12" y2="22.4" />
            <line x1="1.6" y1="12" x2="4.4" y2="12" /><line x1="19.6" y1="12" x2="22.4" y2="12" />
          </svg>
        )}
      </button>
    </div>
  );
}

/* Dev-only sample data: /t3/?demo=full renders the populated home with no
 * account or network (DEV gate strips it from production behaviour). */
const HOME_DEMO_PARAM = import.meta.env.DEV ? new URLSearchParams(window.location.search).get('demo') : null;
const HOME_DEMO = HOME_DEMO_PARAM === 'empty'
  ? { account: null, claims: [], pending: [] }
  : HOME_DEMO_PARAM === 'full'
  ? {
      account: { userId: 'demo', email: 'anna@example.com' },
      claims: [
        { id: 'd1', status: 'completed', payout_amount: 0.4, cups_redeemed: 4, tikkie_url: 'https://tikkie.me/pay/demo', tikkie_status: 'created', created_at: new Date(Date.now() - 2 * 864e5).toISOString() },
        { id: 'd2', status: 'completed', payout_amount: 0.3, cups_redeemed: 3, tikkie_url: 'https://tikkie.me/pay/demo', tikkie_status: 'redeemed', created_at: new Date(Date.now() - 6 * 864e5).toISOString() },
        { id: 'd3', status: 'completed', payout_amount: 0.2, cups_redeemed: 2, tikkie_url: 'https://tikkie.me/pay/demo', tikkie_status: 'redeemed', created_at: new Date(Date.now() - 12 * 864e5).toISOString() },
      ],
      pending: [{ batch_id: 'demo-pend', first_seen: new Date(Date.now() - 36e5).toISOString(), resolved_at: null }],
    }
  : null;

export default function TikkieHomePage({ org, settings = {} }) {
  const account = useMemo(() => HOME_DEMO ? HOME_DEMO.account : readRefundAccount(org?.id), [org?.id]);
  const [claims, setClaims] = useState(HOME_DEMO ? HOME_DEMO.claims : []);
  const [bins, setBins] = useState([]);
  const [pending, setPending] = useState(HOME_DEMO ? HOME_DEMO.pending : []);
  const [loading, setLoading] = useState(HOME_DEMO ? false : !!account);
  const [showAccount, setShowAccount] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!org?.id) return undefined;
    getSmartbinLocations(org.id)
      .then(rows => { if (alive) setBins(rows || []); })
      .catch(() => {});
    return () => { alive = false; };
  }, [org?.id]);

  useEffect(() => {
    let alive = true;
    if (HOME_DEMO) return undefined;
    if (!account?.userId) { setLoading(false); return undefined; }
    Promise.all([
      getMyClaims([account.userId]).catch(() => []),
      getMyPending([account.userId]).catch(() => []),
    ])
      .then(([rows, pend]) => {
        if (!alive) return;
        setClaims(rows || []);
        // "In process": scanned, but the bin's confirmation hasn't reached
        // us — no link yet. Resolved rows graduate into claims, so only
        // the unresolved ones show here.
        setPending((pend || []).filter(p => !p.resolved_at));
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [account?.userId]);

  const [openedMap, setOpenedMap] = useState(() => readOpened(org?.id));

  const totals = useMemo(() => {
    const done = claims.filter(c => c.status === 'completed');
    const total = done.reduce((s, c) => s + Number(c.payout_amount || 0), 0);
    const open = done.filter(c =>
      c.tikkie_url &&
      c.tikkie_status !== 'redeemed' &&
      // Opened over 24h ago → delisted here, kept in the history below.
      !(openedMap[c.id] && Date.now() - openedMap[c.id] > OPENED_TTL_MS)
    );
    const available = open.reduce((s, c) => s + Number(c.payout_amount || 0), 0);
    return { total, available, openClaims: open };
  }, [claims, openedMap]);

  // The hero number animates up as refunds land.
  const animatedTotal = useCountUp(totals.total);

  const history = useMemo(
    () => [...claims].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)),
    [claims],
  );

  if (showAccount) {
    return (
      <UserPage
        tikkieOnly
        profile={{ displayName: account?.email?.split('@')[0] || 'My account', email: account?.email || '' }}
        onSaveProfile={() => {}}
        cupCount={0}
        history={[]}
        userClaims={claims}
        authEmail={account?.email || null}
        isVisitor={!account}
        showActivity={false}
        showImpact={false}
        storeName={org?.name}
        onClose={() => setShowAccount(false)}
      />
    );
  }

  return (
    <div className="app tikkie-home">
      {/* The REAL home header — brand lockup + the account tile. The
          add-cups and cup-balance tiles are hidden: no balance here. */}
      <Header
        cupCount={0}
        onBadgeClick={() => setShowAccount(true)}
        onAddCup={() => {}}
        org={org}
        design={null}
        claimStatus={totals.openClaims.length > 0 ? 'ready' : null}
        showAdd={false}
        showCups={false}
      />

      {/* ── The hero is the money: figures left, the machine that pays
           them on the right. The photo is a white-background render, so
           `multiply` drops its background into the tile instead of
           needing a cut-out. ── */}
      <section className="tikkie-home__hero">
        <div className="tikkie-home__hero-copy">
          <span className="tikkie-home__hero-label">Total refunded</span>
          <div className="tikkie-home__hero-amount">€{animatedTotal.toFixed(2)}</div>
          <div className="tikkie-home__hero-sub">
            {totals.available > 0 ? (
              <>
                <span className="tikkie-home__hero-dot" aria-hidden="true" />
                €{totals.available.toFixed(2)} still to collect
              </>
            ) : account ? (
              'Everything collected. Nice.'
            ) : (
              'Scan a receipt from the smart bin to start.'
            )}
          </div>
        </div>
        <img className="tikkie-home__hero-art" src={smartbinTop} alt="" aria-hidden="true" />
      </section>

      {/* Uncollected refunds go first: actionable beats archival. */}
      {totals.openClaims.length > 0 && (
        <section className="tikkie-home__section">
          <h2 className="tikkie-home__section-title">Ready to collect</h2>
          {totals.openClaims.map(c => (
            <a
              key={c.id}
              className="tikkie-home__open"
              href={c.tikkie_url}
              onClick={() => { markOpened(org?.id, c.id); setOpenedMap(readOpened(org?.id)); }}
            >
              <div>
                <div className="tikkie-home__open-amount">€{Number(c.payout_amount || 0).toFixed(2)}</div>
                <div className="tikkie-home__open-meta">
                  {c.cups_redeemed} cup{c.cups_redeemed === 1 ? '' : 's'} · {fmtWhen(c.created_at)}
                </div>
              </div>
              <span className="tikkie-home__open-cta">Open Tikkie</span>
            </a>
          ))}
        </section>
      )}

      {/* ── In process: scanned, waiting for the bin's confirmation.
           The link is generated the moment it arrives, and we email
           the customer — nothing for them to do here but wait. ── */}
      {pending.length > 0 && (
        <section className="tikkie-home__section">
          <h2 className="tikkie-home__section-title">In process</h2>
          {pending.map(p => (
            <div key={p.batch_id} className="tikkie-home__pending">
              <span className="tikkie-home__pending-clock" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" />
                  <polyline points="12 7 12 12 15.5 14" />
                </svg>
              </span>
              <div className="tikkie-home__pending-main">
                <span className="tikkie-home__pending-title">Receipt scanned {fmtWhen(p.first_seen)}</span>
                <span className="tikkie-home__pending-note">We’ll email you when your link is ready.</span>
              </div>
              <span className="tikkie-home__row-status">In process</span>
            </div>
          ))}
        </section>
      )}

      {/* ── History — same visual rhythm as the store account activity ── */}
      <section className="tikkie-home__section">
        <h2 className="tikkie-home__section-title">Your refunds</h2>
        {loading ? (
          <div className="tikkie-home__empty">Loading…</div>
        ) : history.length === 0 ? (
          <div className="tikkie-home__empty">
            {account
              ? 'No refunds yet. Return your cups at a smart bin and scan the receipt.'
              : 'Return your cups at a smart bin, scan the printed receipt, and choose “save for later” to see your refunds here.'}
          </div>
        ) : (
          <ul className="tikkie-home__history">
            {history.map(c => {
              const collected = c.tikkie_status === 'redeemed';
              return (
                <li key={c.id} className="tikkie-home__row">
                  <span className={`tikkie-home__row-icon${collected ? ' tikkie-home__row-icon--done' : ''}`} aria-hidden="true">
                    {collected ? '✓' : '€'}
                  </span>
                  <div className="tikkie-home__row-main">
                    <span className="tikkie-home__row-title">
                      {c.cups_redeemed} cup{c.cups_redeemed === 1 ? '' : 's'} returned
                    </span>
                    <span className="tikkie-home__row-date">{fmtWhen(c.created_at)}</span>
                  </div>
                  <div className="tikkie-home__row-right">
                    <span className="tikkie-home__row-amount">€{Number(c.payout_amount || 0).toFixed(2)}</span>
                    <span className={`tikkie-home__row-status${collected ? ' tikkie-home__row-status--done' : ''}`}>
                      {collected ? 'Collected' : 'Ready'}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── Where the bins are ── */}
      <section className="tikkie-home__section">
        <h2 className="tikkie-home__section-title">Smart bins near you</h2>
        <BinMap bins={bins} />
        <p className="tikkie-home__map-note">
          {bins.length
            ? `${bins.length} smart bin${bins.length === 1 ? '' : 's'} · tap a pin for the address`
            : 'Bin locations are on their way.'}
        </p>
      </section>

      <p className="tikkie-home__foot">Powered by PackPerks</p>
    </div>
  );
}
