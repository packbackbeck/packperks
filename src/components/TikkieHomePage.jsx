import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { getSmartbinLocations } from '../lib/api';
import {
  readStoredProfile, storeProfile, fetchWallet, scanBatch,
  scanBackupCups, redeemWallet, donateWallet, setEmail, savePendingEmail, checkBatch,
} from '../lib/tikkieWallet';
import { animalForProfile } from '../lib/animals';
import { useRegion } from '../lib/RegionContext';
import { mergeDesign } from '../admin/appdesign/designDefaults';
import { TikkieExplainer, Sheet, LoginSheet } from './tikkie/TikkieBits';
import PrivacyPolicyView from './PrivacyPolicyView';
import CupScanPage from './CupScanPage';
import UserPage, { ImpactSummary, ImpactDetailModal } from './UserPage';
import Header from './Header';
import smartbinTop from '../assets/images/smartbin-top.png';
import './TikkieHomePage.css';

/* ─────────────────────────────────────────────────────────────────────
 * TikkieHomePage — the WHOLE Deferred Tikkie experience (wallet model).
 *
 * Scanning a receipt lands here. After the cookie choice, the scan
 * credits the receipt's value to this device's wallet — the first scan
 * is what creates the profile (adjective+animal identity, like every
 * other mode). No Tikkie link exists per return: the customer collects
 * in bulk with the purple Collect button under the orange tile (or the
 * tile itself → "Open Tikkie"), which mints ONE link for the whole
 * available balance. The green Donate button beside it gives some or all
 * of the balance to the charity partner instead. Both buttons are the
 * `tikkieActionButtons` feature; switched off, the tile carries a single
 * collect pill as before.
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
    { id: 'd5', kind: 'pending', cups: null, amount: null, created_at: new Date(Date.now() - 1 * 36e5).toISOString() },
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
   pattern as the sign-in sheet (privacy required, marketing optional and
   unticked until the customer ticks it). ── */
function EmailSection({ org, onSaved, onVerifyNeeded, onShowPolicy }) {
  const [email, setEmailVal] = useState('');
  const [privacyOk, setPrivacyOk] = useState(false);
  const [marketing, setMarketing] = useState(false);
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
  // Currency AND payout copy follow the active region: a UAE venue shows
  // AED and never names Tikkie, which is a Dutch product with no UAE
  // equivalent wired up yet (payments.js). `isLinkPayout` gates every
  // sentence that only makes sense when we hand over a Tikkie link.
  const { money, collectLabel, payout } = useRegion();
  const isLinkPayout = payout.style === 'link';
  // Both default on, like every feature switch: an org that never touched
  // them gets the two big buttons, and donations follow the same
  // featureDonations flag the server checks (venue_flag).
  const actionButtons = settings?.tikkieActionButtons !== false;
  const donationsOn = settings?.featureDonations !== false;
  const charity = settings?.donationRecipient || 'Plastic Soup Foundation';
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
    if (DEMO === 'donate') return { type: 'donate' };
    if (DEMO === 'donated') return { type: 'donated', amount: 0.5, left: 0.4 };
    return null;
  });
  const [login, setLogin] = useState(null);
  const [showPolicy, setShowPolicy] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [impactOpen, setImpactOpen] = useState(false);
  const [redeeming, setRedeeming] = useState(false);
  const [donating, setDonating] = useState(false);
  const scanStartedRef = useRef(false);
  // The batch the "held for review" popup is waiting on — the URL's, or one
  // the camera just read.
  const [pendingBatch, setPendingBatch] = useState(batchId || '');
  const [scanner, setScanner] = useState(false);

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

  /* One receipt → the wallet. Shared by the two ways a receipt arrives:
   * the QR's own URL (?batch=/?cups=) and the in-app camera scanner. */
  const runScan = useCallback(async ({ batchId: bid = '', cupIds: cids = [] } = {}) => {
    const hasBackup = cids.length > 0;
    if (!bid && !hasBackup) return;
    const data = hasBackup ? await scanBackupCups(cids) : await scanBatch(bid);
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
      if (data.profile) setProfile(data.profile);
      setPendingBatch(bid);
      setPopup({ type: 'pending' });
      await refreshWallet();   // the wait now shows in the activity list
      return;
    }
    setPopup({ type: 'error', message: SCAN_ERRORS[data?.error] || 'We couldn’t process this receipt right now. Please scan it again in a moment.' });
  }, [org?.id, refreshWallet]);

  /* The scan from the URL — only after the cookie choice, and only once.
   * Rejecting the banner (CookieBlocked) means this never runs: no profile,
   * no credit, and the receipt stays valid for a later scan. */
  useEffect(() => {
    if (DEMO) return;
    if (!consentReady || scanStartedRef.current) return;
    if (!batchId && !cupIds.length) return;
    scanStartedRef.current = true;
    runScan({ batchId, cupIds });
  }, [consentReady, batchId, cupIds, runScan]);

  /* While the held-for-review popup is the story, quietly poll: the moment
   * the bin's confirmation lands, credit the receipt and switch the popup. */
  useEffect(() => {
    const waitFor = pendingBatch || batchId;
    if (DEMO || popup?.type !== 'pending' || !waitFor) return undefined;
    let stop = false;
    let timer = null;
    const startedAt = Date.now();
    async function tick() {
      if (stop || Date.now() - startedAt > 30 * 60 * 1000) return;
      const data = await checkBatch(waitFor);
      if (stop) return;
      if (data?.status === 'validated' || data?.url) {
        const credit = await scanBatch(waitFor);
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
  }, [popup?.type, pendingBatch, batchId, refreshWallet]);

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
        : isLinkPayout
          ? 'We couldn’t create your Tikkie link right now. Your balance is safe — please try again in a moment.'
          : 'We couldn’t start your payout right now. Your balance is safe — please try again in a moment.',
    });
    refreshWallet();
  }

  /* Donate: give `amount` of the balance to the charity partner. */
  async function handleDonate(amount) {
    if (DEMO) { setPopup({ type: 'donated', amount, left: Math.max(0, balance - amount) }); return; }
    setDonating(true);
    const data = await donateWallet(org?.id, amount);
    setDonating(false);
    if (data?.status === 'donated') {
      const left = Number(data.balance || 0);
      setBalance(left);
      setPopup({ type: 'donated', amount: Number(data.amount || amount), left });
      refreshWallet();
      return;
    }
    setPopup({
      type: 'error',
      message: data?.error === 'no_balance'
        ? 'There’s nothing to donate yet. Return some cups first.'
        : data?.error === 'donations_disabled'
          ? 'Donations aren’t available here right now. Your balance is unchanged.'
          : 'We couldn’t record your donation just now. Your balance is safe — please try again in a moment.',
    });
    refreshWallet();
  }

  /* ── The in-app scanner: add another receipt without leaving the app ── */
  if (scanner) {
    return (
      <CupScanPage
        copy={{
          title: 'Scan your receipt',
          subtitle: 'Point your camera at the QR on the receipt the smart bin printed. We’ll add its value to your balance.',
          caption: 'Hold steady in good light — the QR is at the bottom of the receipt.',
        }}
        onBack={() => setScanner(false)}
        onScan={(parsed) => {
          setScanner(false);
          // A BYO counter QR isn't a refund receipt — say so rather than
          // failing silently on a code this mode can't pay out.
          if (!parsed?.batchId && !parsed?.cupIds?.length) {
            setPopup({ type: 'error', message: SCAN_ERRORS.wrong_mode });
            return;
          }
          runScan({ batchId: parsed.batchId || '', cupIds: parsed.cupIds || [] });
        }}
      />
    );
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
  const lifetimeCups = returns.reduce((t, h) => t + Number(h.cups || 0), 0);
  const canCollect = balance > 0 || !!outstanding;

  return (
    <div className="app tikkie-home">
      <Header
        cupCount={0}
        onBadgeClick={() => setShowAccount(true)}
        onAddCup={() => setScanner(true)}
        org={org}
        design={mergeDesign(settings?.design)}
        claimStatus={balance > 0 ? 'ready' : null}
        showAdd
        showCups={false}
      />

      {/* ── The wallet tile: the AVAILABLE amount, tap to collect ── */}
      <button
        type="button"
        className="tikkie-home__hero"
        onClick={() => (canCollect ? setPopup({ type: 'redeem' }) : setScanner(true))}
      >
        <div className="tikkie-home__hero-copy">
          <span className="tikkie-home__hero-label">Available to collect</span>
          <div className="tikkie-home__hero-amount">{money(shownBalance)}</div>
          {!actionButtons && (
            <span className="tikkie-home__hero-cta">
              {canCollect ? collectLabel : 'Scan a receipt'}
            </span>
          )}
        </div>
        <img className="tikkie-home__hero-art" src={smartbinTop} alt="" aria-hidden="true" />
      </button>

      {/* ── Collect and Donate, as two big buttons under the tile ── */}
      {actionButtons && (
        <div className={`tikkie-home__actions${donationsOn ? '' : ' tikkie-home__actions--single'}`}>
          {canCollect ? (
            <button
              type="button"
              className={`tikkie-home__action ${isLinkPayout ? 'tikkie-home__action--tikkie' : 'tikkie-home__action--collect'}`}
              onClick={handleOpenTikkie}
              disabled={redeeming}
            >
              <span className="tikkie-home__action-icon" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="5.5" width="19" height="13" rx="2.5" /><path d="M2.5 10h19" /><path d="M6.5 14.5h4" /></svg>
              </span>
              <span className="tikkie-home__action-label">{redeeming ? 'Preparing…' : collectLabel}</span>
            </button>
          ) : (
            <button
              type="button"
              className="tikkie-home__action tikkie-home__action--scan"
              onClick={() => setScanner(true)}
            >
              <span className="tikkie-home__action-icon" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8" /><path d="M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8" /><path d="M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16" /><path d="M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" /><rect x="8.5" y="8.5" width="7" height="7" rx="1" /></svg>
              </span>
              <span className="tikkie-home__action-label">Scan a QR code</span>
            </button>
          )}
          {donationsOn && (
            <button
              type="button"
              className="tikkie-home__action tikkie-home__action--donate"
              onClick={() => setPopup({ type: 'donate' })}
              disabled={donating || balance <= 0}
            >
              <span className="tikkie-home__action-icon" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7z" /></svg>
              </span>
              <span className="tikkie-home__action-label">{donating ? 'Donating…' : 'Donate'}</span>
            </button>
          )}
        </div>
      )}

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
                <span
                  className={`tikkie-home__row-icon${
                    h.kind === 'payout' ? ' tikkie-home__row-icon--done' : ''
                  }${h.kind === 'pending' ? ' tikkie-home__row-icon--wait' : ''}${
                    h.kind === 'donation' ? ' tikkie-home__row-icon--gift' : ''}`}
                  aria-hidden="true"
                >
                  {h.kind === 'payout' ? '✓' : h.kind === 'pending' ? '◷' : h.kind === 'donation' ? '♥' : '♻︎'}
                </span>
                <div className="tikkie-home__row-main">
                  <span className="tikkie-home__row-title">
                    {h.kind === 'payout'
                      ? (isLinkPayout ? 'Collected via Tikkie' : 'Cashback sent')
                      : h.kind === 'donation'
                        ? `Donated to ${charity}`
                      : h.kind === 'pending'
                        ? 'Scanned and held for a review'
                        : `${h.cups} cup${h.cups === 1 ? '' : 's'} returned`}
                  </span>
                  <span className="tikkie-home__row-date">
                    {h.kind === 'pending'
                      ? `${fmtWhen(h.created_at)} · waiting for the bin`
                      : fmtWhen(h.created_at)}
                  </span>
                </div>
                {/* A pending scan carries no amount yet: the bin hasn't told
                    us how many cups went in. */}
                {h.kind === 'pending' ? (
                  <span className="tikkie-home__row-amount tikkie-home__row-amount--wait">Pending</span>
                ) : (
                  <span className={`tikkie-home__row-amount${h.kind === 'payout' || h.kind === 'donation' ? ' tikkie-home__row-amount--out' : ''}`}>
                    {h.kind === 'payout' || h.kind === 'donation' ? '−' : '+'}{money(Number(h.amount || 0))}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── How the customer gets paid (region-aware, static) ── */}
      <section className="tikkie-home__section">
        <h2 className="tikkie-home__section-title">How you get paid</h2>
        <TikkieExplainer />
      </section>

      {/* ── Lifetime impact — the same card every other PackPerks mode
             shows, reused verbatim from UserPage. ── */}
      {lifetimeCups > 0 && (
        <section className="tikkie-home__section">
          <h2 className="tikkie-home__section-title">Your impact</h2>
          <button
            type="button"
            className="user-page__card user-page__card--list user-page__impact-card"
            onClick={() => setImpactOpen(true)}
            aria-label="See your detailed impact"
          >
            <ImpactSummary cups={lifetimeCups} />
          </button>
        </section>
      )}

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
          <h2 className="tk-sheet__title">{money(Number(popup.amount))} added</h2>
          <p className="tk-sheet__sub">
            {popup.cups} cup{popup.cups === 1 ? '' : 's'} returned. Your balance is {money(balance)} —
            collect it whenever you like{actionButtons ? '.' : ' from the orange tile.'}
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
            {money(outstanding && balance === 0 ? outstanding.amount : balance)}
          </div>
          {outstanding && balance === 0 ? (
            <p className="tk-sheet__sub">
              {isLinkPayout
                ? 'Your Tikkie link is ready — open it to finish collecting this amount.'
                : 'Your cashback is on its way — we’ll let you know as soon as it’s sent.'}
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
              className={`tk-btn tk-btn--full ${isLinkPayout ? 'tk-btn--tikkie' : 'tk-btn--collect'}`}
              onClick={handleOpenTikkie}
              disabled={redeeming || (balance === 0 && !outstanding)}
            >
              {redeeming ? 'Preparing…' : isLinkPayout ? 'Open Tikkie' : collectLabel}
            </button>
          </div>
          {balance === 0 && !outstanding && (
            <p className="tk-note">Nothing to collect yet — return some cups first.</p>
          )}
        </Sheet>
      )}

      {popup?.type === 'donate' && (
        <DonateSheet
          balance={balance}
          charity={charity}
          money={money}
          busy={donating}
          onClose={() => setPopup(null)}
          onDonate={handleDonate}
        />
      )}

      {popup?.type === 'donated' && (
        <Sheet onClose={() => setPopup(null)} label="Thank you">
          <div className="tk-icon tk-icon--ok" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="#fff" stroke="none"><path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7z" /></svg>
          </div>
          <h2 className="tk-sheet__title tk-sheet__title--center">Thank you!</h2>
          <p className="tk-sheet__sub tk-sheet__sub--center">
            You gave {money(Number(popup.amount))} to {charity}.
            {popup.left > 0 ? ` ${money(popup.left)} is still in your wallet.` : ''}
          </p>
          <button type="button" className="tk-btn tk-btn--primary tk-btn--full" onClick={() => setPopup(null)}>Close</button>
        </Sheet>
      )}

      {impactOpen && (
        <ImpactDetailModal cups={lifetimeCups} onClose={() => setImpactOpen(false)} />
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

/* ── Donate: pick how much of the balance to give. Starts at all of it;
   the slider and the quick picks move in cents. ── */
const DONATE_PICKS = [
  { label: '25%', share: 0.25 },
  { label: '50%', share: 0.5 },
  { label: '75%', share: 0.75 },
  { label: 'All', share: 1 },
];

function DonateSheet({ balance, charity, money, busy, onClose, onDonate }) {
  const cents = Math.max(0, Math.round(balance * 100));
  const [pick, setPick] = useState(cents);
  const amount = Math.min(pick, cents);
  const fill = cents > 1 ? ((amount - 1) / (cents - 1)) * 100 : 100;

  return (
    <Sheet onClose={busy ? undefined : onClose} label="Donate your balance">
      <div className="tk-donate__badge" aria-hidden="true">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7z" /></svg>
      </div>
      <h2 className="tk-sheet__title">Donate to {charity}</h2>
      <p className="tk-sheet__sub">
        Choose how much of your balance to give. Whatever you keep stays in your wallet to collect later.
      </p>

      <div className="tk-donate__amount" aria-live="polite">{money(amount / 100)}</div>
      <p className="tk-donate__of">of {money(cents / 100)}</p>

      {cents > 1 && (
        <input
          type="range"
          className="tk-donate__range"
          min={1}
          max={cents}
          step={1}
          value={amount}
          onChange={e => setPick(Number(e.target.value))}
          disabled={busy}
          aria-label="Amount to donate"
          style={{ '--fill': `${fill}%` }}
        />
      )}

      <div className="tk-donate__picks">
        {DONATE_PICKS.map(p => {
          const value = Math.max(1, Math.round(cents * p.share));
          return (
            <button
              key={p.label}
              type="button"
              className={`tk-donate__pick${amount === value ? ' tk-donate__pick--on' : ''}`}
              onClick={() => setPick(value)}
              disabled={busy}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      <div className="tk-sheet__actions">
        <button
          type="button"
          className="tk-btn tk-btn--donate tk-btn--full"
          onClick={() => onDonate(amount / 100)}
          disabled={busy || amount < 1}
        >
          {busy ? 'Donating…' : `Donate ${money(amount / 100)}`}
        </button>
        <button type="button" className="tk-btn tk-btn--full" onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </div>
    </Sheet>
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
    <Sheet onClose={onClose} label="Scanned and held for a review">
      <div className="tk-icon tk-icon--warn" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15.5 14" /></svg>
      </div>
      <h2 className="tk-sheet__title">Scanned and held for a review</h2>
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
