import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { getSmartbinLocations } from '../lib/api';
import {
  readStoredProfile, storeProfile, fetchWallet, scanBatch,
  scanBackupCups, redeemWallet, setEmail, savePendingEmail, checkBatch,
} from '../lib/tikkieWallet';
import { animalForProfile } from '../lib/animals';
import { TikkieExplainer, Sheet, LoginSheet } from './tikkie/TikkieBits';
import PrivacyPolicyView from './PrivacyPolicyView';
import UserPage from './UserPage';
import Header from './Header';
import smartbinTop from '../assets/images/smartbin-top.png';
import './TikkieHomePage.css';

/* ─────────────────────────────────────────────────────────────────────
 * TikkieHomePage — the WHOLE Redirect Refund experience (wallet model).
 *
 * Scanning a receipt lands here. After the cookie choice, the scan
 * credits the receipt's value to this device's wallet — the first scan
 * is what creates the profile (adjective+animal identity, like every
 * other mode). No Tikkie link exists per return: the customer collects
 * in bulk by tapping the orange tile → "Open Tikkie", which mints ONE
 * link for the whole available balance.
 *
 * Everything that used to be the redirect page is now a popup on this
 * screen: credited, already-claimed, held-for-review, errors, and the
 * redeem sheet with the Tikkie explainer.
 * ───────────────────────────────────────────────────────────────────── */

const NL_CENTER = [52.15, 5.3];
const NL_ZOOM = 7;

const SCAN_ERRORS = {
  batch_revoked:   'This receipt is no longer valid.',
  batch_expired:   'This receipt has expired.',
  batch_not_found: 'We couldn’t recognise this QR code. Please use the receipt printed by the bin.',
  invalid_batch:   'We couldn’t recognise this QR code. Please use the receipt printed by the bin.',
  wrong_mode:      'This QR code belongs to a different PackPerks programme.',
  backup_cooldown:  'This receipt was just used. Please wait a moment and scan again.',
  backup_daily_cap: 'We can’t process this receipt right now. Please ask a member of staff.',
  missing_device:  'Your browser is blocking storage, which we need to keep your balance. Please turn off private mode and scan again.',
};

/* Dev-only sample states for design review (?demo=…). */
const DEMO = import.meta.env.DEV ? new URLSearchParams(window.location.search).get('demo') : null;
const DEMO_WALLET = {
  profile: { user_id: 'demo', name: 'Perky Otter', animal_index: 5, email: null },
  balance: 0.9,
  history: [
    { id: 'd1', kind: 'return', cups: 4, amount: 0.4, created_at: new Date(Date.now() - 2 * 864e5).toISOString() },
    { id: 'd2', kind: 'return', cups: 3, amount: 0.3, created_at: new Date(Date.now() - 6 * 864e5).toISOString() },
    { id: 'd3', kind: 'payout', cups: 5, amount: 0.5, created_at: new Date(Date.now() - 9 * 864e5).toISOString(), redeemed: true },
    { id: 'd4', kind: 'return', cups: 2, amount: 0.2, created_at: new Date(Date.now() - 12 * 864e5).toISOString() },
  ],
  outstanding: null,
};

function fmtWhen(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/* Count the balance up smoothly when it increases; corrections just land.
 * Honours prefers-reduced-motion. */
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

/* ── Map (unchanged from v1: OSM HOT, zoom, locate) ── */
const userDotIcon = L.divIcon({
  className: 'tikkie-home__userdot-icon',
  html: '<span class="tikkie-home__userdot"></span>',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

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
    const map = L.map(elRef.current, {
      center: NL_CENTER, zoom: NL_ZOOM,
      zoomControl: true, attributionControl: false, scrollWheelZoom: false, dragging: true,
    });
    L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', {
      subdomains: 'ab', maxZoom: 19, attribution: '&copy; OpenStreetMap · HOT',
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; layerRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current, layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    if (!bins.length) { map.setView(NL_CENTER, NL_ZOOM); return; }
    const icon = L.divIcon({
      className: 'tikkie-home__pin',
      html: '<div class="tikkie-home__pin-dot">♻︎</div>',
      iconSize: [24, 24], iconAnchor: [12, 12],
    });
    bins.forEach(b => {
      L.marker([b.lat, b.lng], { icon })
        .addTo(layer)
        .bindPopup(`<strong>${esc(b.name)}</strong>${b.address ? `<br>${esc(b.address)}` : ''}`);
    });
    if (bins.length === 1) map.setView([bins[0].lat, bins[0].lng], 14);
    else map.fitBounds(bins.map(b => [b.lat, b.lng]), { padding: [18, 18], maxZoom: 13 });
  }, [bins]);

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
        let nearest = null, best = Infinity;
        for (const b of bins) {
          const d = (b.lat - loc[0]) ** 2 + (b.lng - loc[1]) ** 2;
          if (d < best) { best = d; nearest = b; }
        }
        if (nearest) map.fitBounds([loc, [nearest.lat, nearest.lng]], { padding: [50, 50], maxZoom: 16, animate: true });
        else map.setView(loc, 14, { animate: true });
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  };

  return (
    <div className="tikkie-home__map-wrap">
      <div ref={elRef} className="tikkie-home__map" aria-label="Smart bin locations" />
      <button type="button" className="tikkie-home__locate" onClick={handleLocate} disabled={locating} aria-label="Find my location">
        {locating ? <span className="tikkie-home__locate-spinner" aria-hidden="true" /> : (
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

/* ── The email section: save the balance to an address. Same consent
   pattern as the sign-in sheet (privacy required, marketing optional). ── */
function EmailSection({ org, onSaved, onVerifyNeeded, onShowPolicy }) {
  const [email, setEmailVal] = useState('');
  const [privacyOk, setPrivacyOk] = useState(false);
  const [marketing, setMarketing] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function submit(e) {
    e.preventDefault();
    if (busy || !privacyOk) return;
    setBusy(true);
    setErr(null);
    const data = await setEmail(org?.id, email.trim(), marketing);
    setBusy(false);
    if (data?.status === 'saved') { onSaved?.(data.profile); return; }
    if (data?.status === 'verify_required') { onVerifyNeeded?.(email.trim()); return; }
    setErr(data?.error === 'invalid_email'
      ? 'That doesn’t look like an email address.'
      : 'We couldn’t save your email just now. Please try again.');
  }

  return (
    <section className="tikkie-home__section">
      <h2 className="tikkie-home__section-title">Save your balance</h2>
      <form className="tikkie-home__emailcard" onSubmit={submit}>
        <p className="tikkie-home__emailcopy">
          Add your email to keep your balance safe and get back to it from any device.
        </p>
        <input
          type="email"
          inputMode="email"
          className="tk-input"
          placeholder="you@example.com"
          value={email}
          onChange={e => setEmailVal(e.target.value)}
          disabled={busy}
          required
        />
        <label className="tk-consent">
          <input type="checkbox" checked={privacyOk} onChange={e => setPrivacyOk(e.target.checked)} disabled={busy} />
          <span>I have read the <button type="button" className="tk-link" onClick={onShowPolicy}>Privacy Policy</button>.</span>
        </label>
        <label className="tk-consent">
          <input type="checkbox" checked={marketing} onChange={e => setMarketing(e.target.checked)} disabled={busy} />
          <span>Send me offers and updates.</span>
        </label>
        {err && <p className="tk-err">{err}</p>}
        <button type="submit" className="tk-btn tk-btn--primary tk-btn--full" disabled={busy || !email.trim() || !privacyOk}>
          {busy ? 'Saving…' : 'Save my balance'}
        </button>
      </form>
    </section>
  );
}

export default function TikkieHomePage({ org, settings = {}, batchId = '', cupIds = [], consentReady = true }) {
  const [profile, setProfile] = useState(() => {
    if (DEMO && DEMO !== 'empty') return DEMO_WALLET.profile;
    if (DEMO) return null;
    const stored = readStoredProfile(org?.id);
    return stored?.userId
      ? { user_id: stored.userId, name: stored.name || null, animal_index: stored.animalIndex ?? null, email: stored.email || null }
      : null;
  });
  const [balance, setBalance] = useState(DEMO && DEMO !== 'empty' ? DEMO_WALLET.balance : 0);
  const [history, setHistory] = useState(DEMO && DEMO !== 'empty' ? DEMO_WALLET.history : []);
  const [outstanding, setOutstanding] = useState(null);
  const [bins, setBins] = useState([]);
  const [popup, setPopup] = useState(() => {
    if (DEMO === 'credited') return { type: 'credited', amount: 0.4, cups: 4 };
    if (DEMO === 'claimed') return { type: 'claimed', yours: false };
    if (DEMO === 'pending') return { type: 'pending' };
    if (DEMO === 'redeem') return { type: 'redeem' };
    return null;
  });
  const [login, setLogin] = useState(null);
  const [showPolicy, setShowPolicy] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [redeeming, setRedeeming] = useState(false);
  const scanStartedRef = useRef(false);

  const shownBalance = useCountUp(balance);
  const animal = useMemo(
    () => animalForProfile({ displayName: profile?.name, animalIndex: profile?.animal_index }),
    [profile],
  );

  const applyWallet = useCallback((data) => {
    if (!data) return;
    if (data.profile) {
      setProfile(data.profile);
      storeProfile(org?.id, { userId: data.profile.user_id, email: data.profile.email, name: data.profile.name });
    }
    setBalance(Number(data.balance || 0));
    setHistory(data.history || []);
    setOutstanding(data.outstanding || null);
  }, [org?.id]);

  const refreshWallet = useCallback(async () => {
    if (DEMO) return;
    const data = await fetchWallet(org?.id);
    applyWallet(data);
  }, [org?.id, applyWallet]);

  /* Bin pins for the map. */
  useEffect(() => {
    let alive = true;
    if (!org?.id || DEMO === 'empty') return undefined;
    getSmartbinLocations(org.id)
      .then(rows => { if (alive) setBins(rows || []); })
      .catch(() => {});
    return () => { alive = false; };
  }, [org?.id]);

  /* The wallet itself. */
  useEffect(() => { refreshWallet(); }, [refreshWallet]);

  /* The scan — only after the cookie choice, and only once. Rejecting the
   * banner (CookieBlocked) means this never runs: no profile, no credit,
   * and the receipt stays valid for a later scan. */
  useEffect(() => {
    if (DEMO) return;
    if (!consentReady || scanStartedRef.current) return;
    const hasBackup = cupIds.length > 0;
    if (!batchId && !hasBackup) return;
    scanStartedRef.current = true;

    (async () => {
      const data = hasBackup ? await scanBackupCups(cupIds) : await scanBatch(batchId);
      if (data?.status === 'credited') {
        if (data.profile) {
          setProfile(data.profile);
          storeProfile(org?.id, { userId: data.profile.user_id, email: data.profile.email, name: data.profile.name });
        }
        setPopup({ type: 'credited', amount: Number(data.amount || 0), cups: data.cups });
        await refreshWallet();
        return;
      }
      if (data?.status === 'already_claimed' || data?.error === 'already_claimed') {
        setPopup({ type: 'claimed', yours: data.yours === true });
        await refreshWallet();
        return;
      }
      if (data?.status === 'pending_validation') {
        setPopup({ type: 'pending' });
        return;
      }
      setPopup({ type: 'error', message: SCAN_ERRORS[data?.error] || 'We couldn’t process this receipt right now. Please scan it again in a moment.' });
    })();
  }, [consentReady, batchId, cupIds, org?.id, refreshWallet]);

  /* While the held-for-review popup is the story, quietly poll: the moment
   * the bin's confirmation lands, credit the receipt and switch the popup. */
  useEffect(() => {
    if (DEMO || popup?.type !== 'pending' || !batchId) return undefined;
    let stop = false;
    let timer = null;
    const startedAt = Date.now();
    async function tick() {
      if (stop || Date.now() - startedAt > 30 * 60 * 1000) return;
      const data = await checkBatch(batchId);
      if (stop) return;
      if (data?.status === 'validated' || data?.url) {
        const credit = await scanBatch(batchId);
        if (stop) return;
        if (credit?.status === 'credited') {
          if (credit.profile) setProfile(credit.profile);
          setPopup({ type: 'credited', amount: Number(credit.amount || 0), cups: credit.cups });
          await refreshWallet();
          return;
        }
      }
      timer = setTimeout(tick, 25000);
    }
    timer = setTimeout(tick, 25000);
    return () => { stop = true; if (timer) clearTimeout(timer); };
  }, [popup?.type, batchId, refreshWallet]);

  /* Open Tikkie: mint ONE link for the whole balance and go there. */
  async function handleOpenTikkie() {
    if (DEMO) { setPopup(null); return; }
    setRedeeming(true);
    const data = await redeemWallet(org?.id);
    setRedeeming(false);
    if (data?.url) {
      window.location.href = data.url;
      return;
    }
    setPopup({
      type: 'error',
      message: data?.error === 'no_balance'
        ? 'There’s nothing to collect yet. Return some cups first.'
        : 'We couldn’t create your Tikkie link right now. Your balance is safe — please try again in a moment.',
    });
    refreshWallet();
  }

  /* ── Account view ── */
  if (showAccount) {
    return (
      <UserPage
        tikkieOnly
        profile={{
          displayName: profile?.name || 'My account',
          email: profile?.email || '',
          animalIndex: profile?.animal_index ?? 0,
        }}
        onSaveProfile={() => {}}
        cupCount={0}
        history={[]}
        userClaims={[]}
        authEmail={profile?.email || null}
        isVisitor={!profile}
        showActivity={false}
        showImpact={false}
        storeName={org?.name}
        onClose={() => setShowAccount(false)}
      />
    );
  }

  const returns = history.filter(h => h.kind === 'return');

  return (
    <div className="app tikkie-home">
      <Header
        cupCount={0}
        onBadgeClick={() => setShowAccount(true)}
        onAddCup={() => {}}
        org={org}
        design={null}
        claimStatus={balance > 0 ? 'ready' : null}
        showAdd={false}
        showCups={false}
      />

      {/* ── The wallet tile: the AVAILABLE amount, tap to collect ── */}
      <button type="button" className="tikkie-home__hero" onClick={() => setPopup({ type: 'redeem' })}>
        <div className="tikkie-home__hero-copy">
          <span className="tikkie-home__hero-label">Available to collect</span>
          <div className="tikkie-home__hero-amount">€{shownBalance.toFixed(2)}</div>
          <span className="tikkie-home__hero-cta">
            {balance > 0
              ? 'Collect via Tikkie'
              : profile
                ? 'Return cups to top up'
                : 'Scan a receipt to start'}
          </span>
        </div>
        <img className="tikkie-home__hero-art" src={smartbinTop} alt="" aria-hidden="true" />
      </button>

      {/* ── Save the balance to an email (profiles without one) ── */}
      {profile && !profile.email && (
        <EmailSection
          org={org}
          onShowPolicy={() => setShowPolicy(true)}
          onSaved={(p) => { setProfile(p); storeProfile(org?.id, { userId: p.user_id, email: p.email, name: p.name }); }}
          onVerifyNeeded={(email) => setLogin({ email, startAtCode: true })}
        />
      )}

      {/* ── Activity ── */}
      <section className="tikkie-home__section">
        <h2 className="tikkie-home__section-title">Activity</h2>
        {history.length === 0 ? (
          <div className="tikkie-home__empty">
            No returns yet. Drop your cups in a smart bin and scan the printed receipt.
          </div>
        ) : (
          <ul className="tikkie-home__history">
            {history.map(h => (
              <li key={h.id} className="tikkie-home__row">
                <span className={`tikkie-home__row-icon${h.kind === 'payout' ? ' tikkie-home__row-icon--done' : ''}`} aria-hidden="true">
                  {h.kind === 'payout' ? '✓' : '♻︎'}
                </span>
                <div className="tikkie-home__row-main">
                  <span className="tikkie-home__row-title">
                    {h.kind === 'payout'
                      ? 'Collected via Tikkie'
                      : `${h.cups} cup${h.cups === 1 ? '' : 's'} returned`}
                  </span>
                  <span className="tikkie-home__row-date">{fmtWhen(h.created_at)}</span>
                </div>
                <span className={`tikkie-home__row-amount${h.kind === 'payout' ? ' tikkie-home__row-amount--out' : ''}`}>
                  {h.kind === 'payout' ? '−' : '+'}€{Number(h.amount || 0).toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── How Tikkie works (static) ── */}
      <section className="tikkie-home__section">
        <h2 className="tikkie-home__section-title">How you get paid</h2>
        <TikkieExplainer />
      </section>

      {/* ── Where the bins are ── */}
      <section className="tikkie-home__section">
        <h2 className="tikkie-home__section-title">Smart bins near you</h2>
        <BinMap bins={bins} />
        {!bins.length && (
          <p className="tikkie-home__map-note">Bin locations are on their way.</p>
        )}
      </section>

      {/* ═══ Popups ═══ */}

      {popup?.type === 'credited' && (
        <Sheet onClose={() => setPopup(null)} label="Refund added">
          <div className="tk-icon tk-icon--ok" aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
          </div>
          <h2 className="tk-sheet__title">€{Number(popup.amount).toFixed(2)} added</h2>
          <p className="tk-sheet__sub">
            {popup.cups} cup{popup.cups === 1 ? '' : 's'} returned. Your balance is €{balance.toFixed(2)} —
            collect it whenever you like from the orange tile.
          </p>
          <button type="button" className="tk-btn tk-btn--primary tk-btn--full" onClick={() => setPopup(null)}>Nice</button>
        </Sheet>
      )}

      {popup?.type === 'claimed' && (
        <Sheet onClose={() => setPopup(null)} label="Receipt already used">
          <div className="tk-icon tk-icon--warn" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
          </div>
          <h2 className="tk-sheet__title">{popup.yours ? 'Already in your wallet' : 'Receipt already used'}</h2>
          <p className="tk-sheet__sub">
            {popup.yours
              ? 'This receipt was already added to your balance — scanning it again doesn’t add it twice.'
              : 'This receipt was already added to a wallet, so it can’t be used again.'}
          </p>
          <button type="button" className="tk-btn tk-btn--primary tk-btn--full" onClick={() => setPopup(null)}>Understood</button>
        </Sheet>
      )}

      {popup?.type === 'pending' && (
        <PendingSheet
          org={org}
          batchId={batchId}
          profile={profile}
          onShowPolicy={() => setShowPolicy(true)}
          onClose={() => setPopup(null)}
          onProfile={(p) => { setProfile(p); }}
        />
      )}

      {popup?.type === 'error' && (
        <Sheet onClose={() => setPopup(null)} label="Something went wrong">
          <div className="tk-icon tk-icon--err" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
          </div>
          <h2 className="tk-sheet__title">Sorry!</h2>
          <p className="tk-sheet__sub">{popup.message}</p>
          <button type="button" className="tk-btn tk-btn--primary tk-btn--full" onClick={() => setPopup(null)}>Understood</button>
        </Sheet>
      )}

      {popup?.type === 'redeem' && (
        <Sheet onClose={() => setPopup(null)} label="Collect your balance">
          <h2 className="tk-sheet__title">Collect your balance</h2>
          <div className="tk-sheet__amount">
            €{(outstanding && balance === 0 ? outstanding.amount : balance).toFixed(2)}
          </div>
          {outstanding && balance === 0 ? (
            <p className="tk-sheet__sub">
              Your Tikkie link is ready — open it to finish collecting this amount.
            </p>
          ) : (
            <TikkieExplainer />
          )}
          <div className="tk-sheet__actions">
            <button type="button" className="tk-btn tk-btn--primary tk-btn--full" onClick={() => setPopup(null)}>
              Do it later
            </button>
            <button
              type="button"
              className="tk-btn tk-btn--tikkie tk-btn--full"
              onClick={handleOpenTikkie}
              disabled={redeeming || (balance === 0 && !outstanding)}
            >
              {redeeming ? 'Preparing…' : 'Open Tikkie'}
            </button>
          </div>
          {balance === 0 && !outstanding && (
            <p className="tk-note">Nothing to collect yet — return some cups first.</p>
          )}
        </Sheet>
      )}

      {showPolicy && (
        <PrivacyPolicyView text={settings?.privacyPolicyText} onClose={() => setShowPolicy(false)} />
      )}

      {login && (
        <LoginSheet
          org={org}
          batchId={batchId}
          initialEmail={login.email}
          startAtCode={login.startAtCode}
          onClose={() => setLogin(null)}
          onLoggedIn={() => { setLogin(null); refreshWallet(); }}
        />
      )}
    </div>
  );
}

/* ── Held for review: the bin's confirmation hasn't reached us. Email
   capture when the profile has no address; a plain acknowledgement when
   it does (we already know where to write). ── */
function PendingSheet({ org, batchId, profile, onClose, onProfile, onShowPolicy }) {
  const hasEmail = !!profile?.email;
  const [email, setEmailVal] = useState('');
  const [privacyOk, setPrivacyOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState(null);

  async function submit(e) {
    e.preventDefault();
    if (busy || !privacyOk) return;
    setBusy(true);
    setErr(null);
    const data = await savePendingEmail(org?.id, batchId, email.trim(), false);
    setBusy(false);
    if (data?.status === 'saved' || data?.status === 'saved_pending') {
      setSaved(true);
      if (data.user_id) onProfile?.({ user_id: data.user_id, email: email.trim(), name: profile?.name, animal_index: profile?.animal_index });
      return;
    }
    setErr(data?.error === 'invalid_email'
      ? 'That doesn’t look like an email address.'
      : 'We couldn’t save your email just now. Please try again.');
  }

  return (
    <Sheet onClose={onClose} label="Return held for review">
      <div className="tk-icon tk-icon--warn" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15.5 14" /></svg>
      </div>
      <h2 className="tk-sheet__title">Held for review</h2>
      <p className="tk-sheet__sub">
        We couldn’t confirm this return with the smart bin yet — it can take up to 30 minutes.
        {hasEmail || saved
          ? ' We’ll email you as soon as it’s added to your balance.'
          : ' Leave your email and we’ll let you know the moment it’s added to your balance.'}
      </p>
      {hasEmail || saved ? (
        <button type="button" className="tk-btn tk-btn--primary tk-btn--full" onClick={onClose}>Understood</button>
      ) : (
        <form onSubmit={submit}>
          <input
            type="email"
            inputMode="email"
            className="tk-input"
            placeholder="you@example.com"
            value={email}
            onChange={e => setEmailVal(e.target.value)}
            disabled={busy}
            required
          />
          <label className="tk-consent">
            <input type="checkbox" checked={privacyOk} onChange={e => setPrivacyOk(e.target.checked)} disabled={busy} />
            <span>I have read the <button type="button" className="tk-link" onClick={onShowPolicy}>Privacy Policy</button>.</span>
          </label>
          {err && <p className="tk-err">{err}</p>}
          <button type="submit" className="tk-btn tk-btn--primary tk-btn--full" disabled={busy || !email.trim() || !privacyOk}>
            {busy ? 'Saving…' : 'Email me when it’s added'}
          </button>
        </form>
      )}
    </Sheet>
  );
}
