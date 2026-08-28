import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { getMyClaims } from '../lib/api';
import { readRefundAccount } from './TikkieOnlyPage';
import UserPage from './UserPage';
import packbackLogo from '../assets/images/packback-logo.svg';
import './TikkieHomePage.css';

/* Redirect Refund home — the account view for a mode that, until now,
 * had no users at all.
 *
 * It deliberately mirrors the shape of the normal store home (hero tile,
 * activity, map) but swaps the vocabulary: no rewards, no cup goals. The
 * hero is the money — total refunded, with the still-uncollected amount
 * as the small number — because for this audience the product IS the
 * refund. History is the claim list, and the map shows where the smart
 * bins stand (static pins for now; there is exactly one live bin).
 *
 * Reached from /<slug>/ with no batch in the URL: either the customer
 * saved a refund for later (account in localStorage) or they typed the
 * URL — the empty state explains what to do. */

/* The live bin(s). Hardcoded on purpose: bins are provisioned by hand in
 * smartbin_keys and there is no admin UI for coordinates yet. */
const BIN_LOCATIONS = [
  { name: 'Titaan Smart Bin', area: 'RAI Amsterdam', lat: 52.3411, lng: 4.8887 },
];

function fmtWhen(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function BinMap() {
  const mapRef = useRef(null);
  const elRef = useRef(null);

  useEffect(() => {
    if (!elRef.current || mapRef.current) return;
    const map = L.map(elRef.current, {
      center: [BIN_LOCATIONS[0].lat, BIN_LOCATIONS[0].lng],
      zoom: 13,
      zoomControl: false,
      attributionControl: false,
      scrollWheelZoom: false,
      dragging: true,
    });
    // Same tile set as the BYO market map (StoresPage). OSM directly:
    // Carto's keyless CDN now stamps "API KEY REQUIRED" over the tiles.
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);
    BIN_LOCATIONS.forEach(b => {
      const icon = L.divIcon({
        className: 'tikkie-home__pin',
        html: `<div class="tikkie-home__pin-dot">♻︎</div>`,
        iconSize: [34, 34],
        iconAnchor: [17, 17],
      });
      L.marker([b.lat, b.lng], { icon })
        .addTo(map)
        .bindPopup(`<strong>${b.name}</strong><br>${b.area}`);
    });
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  return <div ref={elRef} className="tikkie-home__map" aria-label="Smart bin locations" />;
}

export default function TikkieHomePage({ org, settings = {} }) {
  const account = useMemo(() => readRefundAccount(org?.id), [org?.id]);
  const [claims, setClaims] = useState([]);
  const [loading, setLoading] = useState(!!account);
  const [showAccount, setShowAccount] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!account?.userId) { setLoading(false); return undefined; }
    getMyClaims([account.userId])
      .then(rows => { if (alive) setClaims(rows || []); })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [account?.userId]);

  const totals = useMemo(() => {
    const done = claims.filter(c => c.status === 'completed');
    const total = done.reduce((s, c) => s + Number(c.payout_amount || 0), 0);
    const open = done.filter(c => c.tikkie_url && c.tikkie_status !== 'redeemed');
    const available = open.reduce((s, c) => s + Number(c.payout_amount || 0), 0);
    return { total, available, openClaims: open };
  }, [claims]);

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
    <div className="tikkie-home">
      <header className="tikkie-home__head">
        <img className="tikkie-home__logo" src={org?.logo_url || packbackLogo} alt={org?.name || 'PackBack'} />
        <button
          type="button"
          className="tikkie-home__user"
          onClick={() => setShowAccount(true)}
          aria-label="My account"
        >
          {(account?.email || '?').charAt(0).toUpperCase()}
        </button>
      </header>

      {/* ── The hero is the money ── */}
      <section className="tikkie-home__hero">
        <span className="tikkie-home__hero-label">Total refunded</span>
        <div className="tikkie-home__hero-amount">€{totals.total.toFixed(2)}</div>
        <div className="tikkie-home__hero-sub">
          {totals.available > 0 ? (
            <>
              <span className="tikkie-home__hero-dot" aria-hidden="true" />
              €{totals.available.toFixed(2)} still to collect
            </>
          ) : account ? (
            'Everything collected — nice.'
          ) : (
            'Scan a receipt from the smart bin to start.'
          )}
        </div>
      </section>

      {/* Uncollected refunds go first: actionable beats archival. */}
      {totals.openClaims.length > 0 && (
        <section className="tikkie-home__section">
          <h2 className="tikkie-home__section-title">Ready to collect</h2>
          {totals.openClaims.map(c => (
            <a key={c.id} className="tikkie-home__open" href={c.tikkie_url}>
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
        <BinMap />
        <p className="tikkie-home__map-note">
          {BIN_LOCATIONS[0].name} · {BIN_LOCATIONS[0].area}
        </p>
      </section>

      <p className="tikkie-home__foot">Powered by PackPerks</p>
    </div>
  );
}
