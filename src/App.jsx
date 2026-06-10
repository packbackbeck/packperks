import { useState, useEffect, useRef } from 'react';
import Header from './components/Header';
import { applyDesignColors, mergeDesign } from './admin/appdesign/designDefaults';
import CupProgress from './components/CupProgress';
import FeaturedReward from './components/FeaturedReward';
import GoalSection from './components/GoalSection';
import Modal from './components/Modal';
import UserPage from './components/UserPage';
import ReceiptPage from './components/ReceiptPage';
import SuccessPage from './components/SuccessPage';
import RewardDetailSheet from './components/RewardDetailSheet';
import CupScanPage from './components/CupScanPage';
import CupScanSuccess from './components/CupScanSuccess';
import DirectRefundSheet from './components/DirectRefundSheet';
import RefundSuccessPage from './components/RefundSuccessPage';
import ShareCupSheet from './components/ShareCupSheet';
import DonateSheet from './components/DonateSheet';
import DonateSuccessPage from './components/DonateSuccessPage';
import ReceiptVerifyingPage from './components/ReceiptVerifyingPage';
import ReceiptRejectedPage from './components/ReceiptRejectedPage';
import CupClaimErrorPage from './components/CupClaimErrorPage';
import AppErrorScreen from './components/AppErrorScreen';
import SignInSheet from './components/SignInSheet';
import HomeSkeleton from './components/HomeSkeleton';
import usePersistedState from './hooks/usePersistedState';
import { rewards } from './data/rewards';
import { track, EVENTS, setAnalyticsContext } from './utils/analytics';
import {
  getOrCreateUser,
  generateInitialProfile,
  getCupBalance,
  updateCupBalance,
  getHistory,
  addHistoryEntry,
  createClaim,
  addDonationClaim,
  updateUserProfile,
  getUserStats,
  // Multi-org design tokens — applied as CSS variables in a useEffect
  // below so each org's app skin renders without a hard refresh.
  // (Note: applyDesignColors lives in the admin tree but is pure DOM
  // mutation; safe to import from the user app.)
  logCupScan,
  getAppConfig,
  uploadReceiptPhoto,
  verifyReceipt,
  getMyClaims,
  claimCups,
  uploadCupScanPhoto,
  parseCupQr,
  onAuthStateChange,
  getCurrentAuthEmail,
  getOrgBySlug,
  getDefaultOrg,
  isRewardBudgetBlocked,
} from './lib/api';
import BudgetPausedModal from './components/BudgetPausedModal';
import './App.css';

/* Best-effort device fingerprint from the user agent. Falls back to a
 * generic string when no platform-specific token is found. Used in the
 * user profile so the activity / claim "Device" field is honest instead
 * of the old hardcoded "iPhone 15 Pro" placeholder. */
function detectDevice() {
  if (typeof navigator === 'undefined') return 'Unknown device';
  const ua = navigator.userAgent || '';
  // iPad first (modern iPads identify as Mac with touch)
  if (/iPad/.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua))) {
    const m = ua.match(/(?:iPad|CPU)(?: OS)? (\d+)[_.](\d+)/);
    return m ? `iPad (iPadOS ${m[1]}.${m[2]})` : 'iPad';
  }
  if (/iPhone/.test(ua)) {
    const m = ua.match(/iPhone OS (\d+)[_.](\d+)/);
    return m ? `iPhone (iOS ${m[1]}.${m[2]})` : 'iPhone';
  }
  if (/Android/.test(ua)) {
    const m = ua.match(/Android (\d+(?:\.\d+)?)/);
    const model = (ua.match(/;\s*([^;)]+?)\s+Build/) || [])[1];
    return model ? `${model} (Android ${m?.[1] || '?'})` : `Android ${m?.[1] || ''}`.trim();
  }
  if (/Macintosh/.test(ua))    return /Safari/.test(ua) && !/Chrome/.test(ua) ? 'Mac (Safari)' : 'Mac';
  if (/Windows NT/.test(ua))   return 'Windows PC';
  if (/Linux/.test(ua))        return 'Linux';
  return 'Web browser';
}

/* Resize + compress a data-URL to max 800px wide at 0.65 JPEG quality (~60-120 KB).
 *
 * CRITICAL for iOS: phones hand back camera/library photos as HEIC — and
 * sometimes with a generic `application/octet-stream` mime. If we upload
 * those bytes/mime as-is, Supabase Storage rejects them (415 invalid_mime_type
 * — the receipts bucket only allows real image types) and the whole claim
 * dies with "something went wrong" before the AI ever runs.
 *
 * So this ALWAYS re-encodes to a real JPEG data-URL. We try createImageBitmap
 * first (decodes HEIC on modern iOS where <img> can't), then fall back to
 * <Image>. The output is guaranteed `data:image/jpeg;base64,…`. */
async function compressImage(dataUrl, maxWidth = 800, quality = 0.65) {
  const toJpeg = (source, w, h) => {
    const scale = Math.min(1, maxWidth / w);
    const canvas = document.createElement('canvas');
    canvas.width  = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
  };

  // Path 1: createImageBitmap (handles HEIC / odd mimes best on iOS).
  try {
    const blob = await (await fetch(dataUrl)).blob();
    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(blob);
      const out = toJpeg(bitmap, bitmap.width, bitmap.height);
      bitmap.close?.();
      return out;
    }
  } catch { /* fall through to <img> */ }

  // Path 2: <img> decode.
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try { resolve(toJpeg(img, img.width, img.height)); }
      catch (e) { reject(e); }
    };
    img.onerror = () =>
      reject(new Error("We couldn't read that photo. Please retake it or pick a different image."));
    img.src = dataUrl;
  });
}

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/* P-48: tiny haptic helper for the user app. The Vibration API is
 * supported on Android Chrome / Edge and a few mobile browsers; iOS
 * Safari silently no-ops which is fine. Three patterns:
 *
 *   success — short single pulse (50ms)
 *   error   — quick double pulse (50-30-50)
 *   tap     — even shorter pulse (15ms) for primary CTA confirmations
 *
 * Wrapped in try/catch because some environments (CI, embed iframes)
 * throw rather than no-op. */
function haptic(kind = 'tap') {
  try {
    if (typeof navigator === 'undefined' || !navigator.vibrate) return;
    if (kind === 'success') navigator.vibrate(50);
    else if (kind === 'error') navigator.vibrate([50, 30, 50]);
    else                       navigator.vibrate(15);
  } catch { /* ignore */ }
}

export default function App() {
  /* ── Supabase-backed state ── */
  const [userId, setUserId] = useState(null);
  const [profile, setProfile] = useState(null);
  const [cupCount, setCupCount] = useState(0);
  // Lifetime count — never decremented when the user redeems rewards.
  // Drives the Impact card on the user page. Sourced from
  // cup_balances.lifetime_cups via getUserStats() during init.
  const [lifetimeCups, setLifetimeCups] = useState(0);
  const [history, setHistory] = useState([]);
  // User's own claims, used by the activity modal to display live status
  // (admin approvals reflect here after the user reopens the activity).
  const [userClaims, setUserClaims] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [initError, setInitError] = useState(null);

  /* ── Email magic-link auth (optional account binding) ── */
  // `authEmail` is null when the user is in anonymous device-only mode
  // and set once they've verified an email via the magic-link flow.
  // We surface it in the UserPage as "Signed in as …".
  const [authEmail, setAuthEmail] = useState(null);
  const [showSignIn, setShowSignIn] = useState(false);

  /* ── Live config from admin publish ── */
  const [liveRewards, setLiveRewards] = useState(rewards);
  const [liveSettings, setLiveSettings] = useState({
    cashbackRatePerCup: 1.25,
    refundRatePerCup: 1.00,
    heroHeadline: 'Collect Cups & Get Rewards',
    heroSubtext: 'We pool your cup deposits into one cashback payout — worth more than a standard refund.',
    featureCupSharing: true,
    featureDonations: true,
    featureDirectRefunds: true,
    maintenanceMode: false,
  });

  /* ── Active organisation (multi-org) ──
   * The user-facing app is now per-org. The slug in the URL path
   * (e.g. /coffeeshop/) selects which org's config to load. If no slug,
   * we fall back to the default (oldest non-deleted) org so existing
   * /  URLs keep working as before for the BK demo.
   *
   * `activeOrg` drives:
   *   • Hero copy + branding (org.partner_brand_name in user-visible text)
   *   • Per-org app_config lookup (org.id passed to getAppConfig)
   *   • Brand color (org.brand_color exposed to CSS variables / chips)
   */
  const [activeOrg, setActiveOrg] = useState(null);
  // Reward-budget gate: true when this org has reached its cashback cap.
  // The amount is never sent to the client — only this boolean.
  const [rewardBudgetBlocked, setRewardBudgetBlocked] = useState(false);
  const [budgetPausedOpen, setBudgetPausedOpen] = useState(false);
  // Always-current active org id for callbacks that live outside the
  // render closure (e.g. the onAuthStateChange listener). Passing this to
  // getOrCreateUser keeps a signed-in user bound to THEIR org's row —
  // calling it without an org makes the per-org device lookup hit multiple
  // rows and mint a fresh (orphan) user, fragmenting the cup balance.
  const activeOrgIdRef = useRef(null);
  useEffect(() => { activeOrgIdRef.current = activeOrg?.id || null; }, [activeOrg]);

  // Resolve whether reward claiming is paused for this org (cashback cap
  // reached). Fail-open: a transient error never blocks a real claim, since
  // the DB trigger is the hard guard.
  useEffect(() => {
    let alive = true;
    if (activeOrg?.id) {
      isRewardBudgetBlocked(activeOrg.id).then(b => { if (alive) setRewardBudgetBlocked(b); });
    } else {
      setRewardBudgetBlocked(false);
    }
    return () => { alive = false; };
  }, [activeOrg?.id]);

  /* ── UI preferences ── */
  const [selectedRewardId, setSelectedRewardId] = useState(''); // set from the active org's rewards on load (see effect below)

  // Keep the selected reward valid for the active org. The default
  // ('chicken-sandwich') is a Burger King id; on other orgs we snap to the
  // featured reward (or the first) so the selection — and any claim made
  // from it — always references a reward that belongs to THIS org.
  useEffect(() => {
    if (!liveRewards.length) return;
    if (!liveRewards.some(r => r.id === selectedRewardId)) {
      const featured = liveRewards.find(r => r.featured) || liveRewards[0];
      if (featured) setSelectedRewardId(featured.id);
    }
  }, [liveRewards, selectedRewardId]);
  const [claimed, setClaimed] = usePersistedState('claimed', false); // transient UI flag, localStorage is fine

  /* ── Navigation ── */
  const [page, setPage] = useState('home');

  // Behavioural analytics: log which screen the user is on whenever it
  // changes. Powers the "Last screen / drop-off" metric. Fire-and-forget.
  useEffect(() => {
    track(EVENTS.SCREEN_VIEW, { screen: page });
  }, [page]);

  /* ── Transient claim state ── */
  const [claimedIban, setClaimedIban] = useState('');
  // (was previously the placeholder for the +1 photo-scan flow; now driven
  // by lastCupsScanned which comes from the QR claim response.)

  /* ── Detail sheet ── */
  const [detailReward, setDetailReward] = useState(null);

  /* ── Nudge (highlight remaining cups) ── */
  const [nudgeCount, setNudgeCount] = useState(0);

  /* ── Modal state ── */
  const [termsOpen, setTermsOpen] = useState(false);
  const [directRefundOpen, setDirectRefundOpen] = useState(false);
  const [refundIban, setRefundIban] = useState('');
  const [refundCupCount, setRefundCupCount] = useState(0);
  const [shareSheetOpen, setShareSheetOpen] = useState(false);
  const [donateSheetOpen, setDonateSheetOpen] = useState(false);
  const [donatedCups, setDonatedCups] = useState(0);

  /* ── Derived values ── */
  const selectedReward = liveRewards.find((r) => r.id === selectedRewardId) || liveRewards[0];
  const otherRewards = liveRewards.filter((r) => r.id !== selectedRewardId);
  const isUnlocked = cupCount >= selectedReward.cupsNeeded;
  const cupsRemaining = Math.max(0, selectedReward.cupsNeeded - cupCount);

  /* Effective section flags: an action button is visible only when
   * BOTH the feature flag (sidebar Quick Settings) AND the design
   * section toggle (App Design tab) say it should be. This way feature
   * flags continue to act as a global kill-switch while design
   * sections act as per-org layout choices. */
  const design = mergeDesign(liveSettings?.design);
  const showShare       = !!liveSettings.featureCupSharing    && design.sections.showShareCup       !== false;
  const showNextCupFree = !!liveSettings.featureCupSharing    && design.sections.showNextCupForFree !== false;
  const showDonate      = !!liveSettings.featureDonations     && design.sections.showDonate         !== false;
  const showRefund      = !!liveSettings.featureDirectRefunds && design.sections.showDirectRefund   !== false;
  const showActivity    = design.sections.showActivity !== false;
  // Impact card — defaults ON; orgs that don't want sustainability
  // copy in front of their customers can flip it off in App Design.
  const showImpact      = design.sections.showImpact !== false;
  const designCopy      = design.copy;

  /* Detect "preview mode" — when the App Design tab's iframe embeds
   * us with ?preview=1, we skip every Supabase round-trip (auth,
   * user creation, balance, history, claims) and just render the
   * layout. Why: those round-trips fire onAuthStateChange events
   * that cascade through the parent's draftState, which used to
   * trigger an iframe reload loop. In preview mode we want a static,
   * stable render that ONLY reflects the design tokens we receive
   * over postMessage. */
  const isPreviewMode = (() => {
    if (typeof window === 'undefined') return false;
    try { return new URLSearchParams(window.location.search).get('preview') === '1'; }
    catch { return false; }
  })();

  /* ── Init: load user + state from Supabase ── */
  useEffect(() => {
    async function init() {
      try {
        // Preview mode short-circuit. We still need the per-org
        // config so the iframe paints with the right brand
        // (rewards + settings + design), but we skip the user-data
        // path entirely.
        if (isPreviewMode) {
          const pathSlug = (window.location.pathname || '/').split('/').filter(Boolean)[0] || null;
          const previewOrg = (pathSlug ? await getOrgBySlug(pathSlug) : null) || (await getDefaultOrg());
          if (previewOrg) setActiveOrg(previewOrg);
          // Minimal fake user state — just enough so downstream
          // renders don't crash on null. The values are visible in
          // the preview (e.g. cup count badge shows "2 cups").
          setUserId('preview-user');
          setProfile({
            displayName: 'Preview',
            animalIndex: 0,
            email: '',
            iban: '',
            phone: 'Preview device',
          });
          setCupCount(2);
          setLifetimeCups(0);
          setHistory([]);
          setUserClaims([]);
          // Pull the published config so reward cards + brand colours
          // reflect the org's published state (the parent then layers
          // the live draft on top via postMessage).
          if (previewOrg?.id) {
            try {
              const config = await getAppConfig(previewOrg.id);
              if (config?.rewards) {
                const seedById = Object.fromEntries(rewards.map(r => [r.id, r]));
                const looksLikeBuildAsset = (url) =>
                  typeof url === 'string' &&
                  (url.startsWith('/assets/') || url.startsWith('/src/') || url.startsWith('./') || url.startsWith('../'));
                const live = config.rewards
                  .filter(r => r.status === 'live')
                  .map(r => looksLikeBuildAsset(r.image) && seedById[r.id]?.image
                    ? { ...r, image: seedById[r.id].image }
                    : r);
                if (live.length > 0) setLiveRewards(live);
              }
              if (config?.settings) setLiveSettings(s => ({ ...s, ...config.settings }));
            } catch { /* preview tolerates missing config */ }
          }
          setIsLoading(false);
          return;
        }

        // Step 0: resolve the active organisation from the URL slug.
        // Path shape: /<slug>/?... — first non-empty segment is the slug.
        // If no slug (e.g. visiting /), fall back to the default org so
        // the existing demo URL keeps working without breakage.
        const pathSlug = (window.location.pathname || '/')
          .split('/')
          .filter(Boolean)[0] || null;
        const isReservedSlug = pathSlug === 'admin'; // admin route uses its own shell
        const org = (!isReservedSlug && pathSlug)
          ? (await getOrgBySlug(pathSlug)) || (await getDefaultOrg())
          : (await getDefaultOrg());
        if (org) setActiveOrg(org);

        const user = await getOrCreateUser(org?.id);

        // Generate a display name for brand-new users
        let displayName = user.display_name;
        let animalIndex = user.animal_index ?? 0;
        if (!displayName) {
          const generated = generateInitialProfile();
          displayName = generated.displayName;
          animalIndex = generated.animalIndex;
          await updateUserProfile(user.id, { displayName, animalIndex });
        }

        setUserId(user.id);
        // Funnel analytics: tie this session to the resolved org + user,
        // then mark the app as loaded (top of the feasibility-test funnel).
        setAnalyticsContext({ orgId: org?.id, userId: user.id });
        track(EVENTS.APP_LOADED, { slug: pathSlug || null });
        // Detect the device once per session and push it to Supabase so
        // the admin Users tab can show what kind of phone is using the
        // app. We only re-push if it changed (e.g. user switched
        // devices), since this is best-effort metadata.
        const device = detectDevice();
        if (device && device !== user.device) {
          persist(updateUserProfile(user.id, { device }));
        }
        setProfile({
          displayName,
          animalIndex,
          email: user.email || '',
          iban: user.iban || '',
          phone: device,
        });
        if (user.selected_reward_id) setSelectedRewardId(user.selected_reward_id);

        const [balance, hist, config, claims] = await Promise.all([
          getCupBalance(user.id),
          getHistory(user.id),
          // Per-org config: passes the active org id so each org has
          // its own published rewards + settings document.
          getAppConfig(org?.id),
          getMyClaims(user.id),
        ]);

        if (config?.rewards) {
          // The admin "Publish" flow stores reward objects whole — including
          // the image field. For seeded rewards (Big King, Chicken Sandwich,
          // Veggie Nuggets) the image is a Vite-imported asset whose URL is
          // resolved at build time (e.g. /assets/big-king-7Bk2nm.png in prod,
          // /src/assets/images/big-king.png in dev). That URL gets persisted
          // into Supabase, but it's *build-specific* — a later production
          // build with new hashes, or a deploy from a different environment,
          // will 404 that path even though the same logical reward still
          // exists in this bundle.
          //
          // Fix: if the stored image URL looks like a build-time asset path,
          // fall back to the matching seed reward's current import (which
          // resolves to the current build's hashed URL). External URLs
          // (https://..., supabase storage, sanity CDN, data: URIs) are
          // left alone because those are stable across builds.
          const seedById = Object.fromEntries(rewards.map(r => [r.id, r]));
          const looksLikeBuildAsset = (url) =>
            typeof url === 'string' &&
            (url.startsWith('/assets/') || url.startsWith('/src/') || url.startsWith('./') || url.startsWith('../'));
          const live = config.rewards
            .filter(r => r.status === 'live')
            .map(r => {
              if (looksLikeBuildAsset(r.image) && seedById[r.id]?.image) {
                return { ...r, image: seedById[r.id].image };
              }
              return r;
            });
          if (live.length > 0) {
            setLiveRewards(live);
            // Funnel: rewards rendered for the user (mid-funnel signal).
            track(EVENTS.REWARD_SHOWN, { count: live.length });
          }
        }
        if (config?.settings) {
          setLiveSettings(s => ({ ...s, ...config.settings }));
        }
        setCupCount(balance);
        setHistory(hist);
        setUserClaims(claims);

        // Fetch lifetime_cups separately so we don't widen the existing
        // getCupBalance contract for every consumer. Best-effort —
        // the impact card just shows 0 if this fails.
        try {
          const stats = await getUserStats(user.id);
          setLifetimeCups(stats.lifetimeCups || 0);
        } catch (e) {
          console.warn('getUserStats failed (impact card will show 0):', e);
        }

        // Deep-link: phone camera scans the bin's QR which opens this URL
        // with ?batch=<uuid> or ?cups=<uuid,uuid>. Auto-trigger the claim
        // flow so the user doesn't need to open the in-app scanner.
        const sp = new URLSearchParams(window.location.search);
        const urlBatch = sp.get('batch');
        const urlCups = sp.get('cups');
        if (urlBatch || urlCups) {
          const parsed = parseCupQr(window.location.href);
          if (parsed) {
            // Clear the param so a refresh doesn't re-trigger.
            window.history.replaceState({}, '', window.location.pathname);
            // Small delay so the home screen renders first, then the
            // claim result lands on top instead of flashing.
            // Pass user.id directly — handleCupScan closes over the
            // *initial* render's userId state (null) and would silently
            // return early without this override.
            setTimeout(() => handleCupScan(parsed, { scanType: 'deeplink' }, user.id), 100);
          }
        }
      } catch (err) {
        console.error('PackPerks init failed:', err);
        setInitError(err.message || 'Unknown error');
      } finally {
        setIsLoading(false);
      }
    }
    init();
  }, []);

  /* ── Apply per-org design palette to :root CSS variables ──
   * The admin's App Design tab writes settings.design.colors per-org;
   * here we re-target the existing --bk-* tokens at whatever the
   * active org has chosen. Components don't need to know — they keep
   * using var(--bk-orange) etc. and just get a different colour. */
  useEffect(() => {
    const merged = mergeDesign(liveSettings?.design);
    applyDesignColors(merged.colors);
    return () => applyDesignColors(null); // reset on unmount
  }, [liveSettings?.design]);

  /* ── Preview-mode override (admin App Design tab) ──
   * When the user app runs inside the admin's App Design iframe, the
   * parent posts the current DRAFT design over postMessage on every
   * change. We merge that override into liveSettings.design so the
   * iframe always reflects what the admin is editing, even before
   * they hit Save. Same-origin so no security gymnastics. */
  useEffect(() => {
    function onMessage(e) {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type !== 'packperks-preview-design') return;
      const next = e.data.payload || {};
      setLiveSettings(s => ({ ...s, design: next }));
    }
    window.addEventListener('message', onMessage);
    // Tell the parent we're ready so it can flush its first design payload.
    try { window.parent?.postMessage({ type: 'packperks-preview-ready' }, '*'); }
    catch { /* parent might not exist */ }
    return () => window.removeEventListener('message', onMessage);
  }, []);

  /* ── Auth-state listener (email magic link flow) ──
   * Fires when:
   *   • the page loads with a pending magic-link code in the URL —
   *     supabase-js auto-exchanges it and emits SIGNED_IN
   *   • the user signs out from the SignInSheet
   *
   * Either way we read the latest auth email + refresh the local user
   * row so any newly-linked auth_user_id surfaces in subsequent reads. */
  useEffect(() => {
    // Preview mode: skip the auth-state listener entirely. The
    // inner iframe shares the parent admin's Supabase session via
    // cookies, so onAuthStateChange would fire SIGNED_IN here on
    // mount → trigger getOrCreateUser → state update → repeat
    // across the parent's design-payload cycle. Detaching the
    // listener in preview mode breaks that loop cleanly.
    if (isPreviewMode) return;

    let cancelled = false;
    // Pre-populate from any session that already existed on load.
    getCurrentAuthEmail().then(e => { if (!cancelled) setAuthEmail(e); });
    const unsubscribe = onAuthStateChange(async (event, session) => {
      if (cancelled) return;
      const nextEmail = session?.user?.email || null;
      setAuthEmail(nextEmail);
      // On SIGNED_IN, refresh our local user row so the new auth_user_id
      // link takes effect and `signed in as …` appears in the UserPage.
      if (event === 'SIGNED_IN') {
        try {
          const refreshed = await getOrCreateUser(activeOrgIdRef.current);
          setUserId(refreshed.id);
          setProfile(p => p ? { ...p, email: refreshed.email || nextEmail || p.email } : p);
        } catch (err) {
          console.error('post-signin user refresh failed:', err);
        }
      }
    });
    return () => { cancelled = true; unsubscribe?.(); };
  }, [isPreviewMode]);

  /* ── Helpers ── */
  const addHistory = (type, label) => {
    setHistory((prev) => [...prev, { type, label, time: formatTime(Date.now()) }]);
  };

  const persist = (...promises) => Promise.all(promises).catch(console.error);

  /* ── Profile handler ── */
  const handleSaveProfile = (updates) => {
    setProfile((prev) => ({ ...prev, ...updates }));
    if (userId) persist(updateUserProfile(userId, updates));
  };

  /* ── Reward handlers ── */
  const handlePickReward = (id) => {
    const reward = rewards.find((r) => r.id === id);
    track(EVENTS.REWARD_SELECTED, { reward_id: id, reward_name: reward?.name, cup_count: cupCount });
    setSelectedRewardId(id);
    setClaimed(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (userId) persist(updateUserProfile(userId, { selectedRewardId: id }));
  };

  const handleAddCup = () => setPage('cup-scan');
  const handleWithdraw = () => setDirectRefundOpen(true);

  /* ── Direct refund ── */
  const handleDirectRefundConfirm = (iban) => {
    track(EVENTS.WITHDRAW_ALL_CUPS, { cups_withdrawn: cupCount, deposit_value: (cupCount * 1.00).toFixed(2) });
    const count = cupCount;
    const label = `Direct refund: ${count} cup${count !== 1 ? 's' : ''} — €${(count * 1.00).toFixed(2)}`;
    addHistory('cups_withdrawn', label);
    setRefundIban(iban);
    setRefundCupCount(count);
    setCupCount(0);
    setClaimed(false);
    setDirectRefundOpen(false);
    setPage('refund-success');

    if (userId) {
      persist(
        updateCupBalance(userId, 0),
        createClaim(userId, { type: 'direct_refund', cupsRedeemed: count, payoutAmount: count * 1.00, iban, orgId: activeOrg?.id }),
        addHistoryEntry(userId, 'cups_withdrawn', label)
      );
    }
  };

  /* ── Reward-budget gate ── */
  const handleBudgetBlocked = () => setBudgetPausedOpen(true);
  // Fresh server check before committing to a cashback claim. Returns false
  // and opens the paused popup when the org has hit its budget cap.
  const ensureRewardBudgetOk = async () => {
    const blocked = await isRewardBudgetBlocked(activeOrg?.id);
    setRewardBudgetBlocked(blocked);
    if (blocked) { setBudgetPausedOpen(true); return false; }
    return true;
  };

  /* ── Cashback claim ── */
  const handleClaim = async (iban) => {
    if (!(await ensureRewardBudgetOk())) return;
    track(EVENTS.REWARD_CLAIM_ATTEMPTED, {
      reward_id: selectedRewardId,
      reward_name: selectedReward.name,
      iban_length: iban.length,
      cup_count: cupCount,
    });
    setClaimedIban(iban);
    handleSaveProfile({ iban }); // persist IBAN for future auto-fill
    setPage('receipt');
  };

  /* ── Receipt submission → AI verification ─────────────────────────────
   *
   * Flow:
   *   1. Compress photo to keep upload small.
   *   2. Create the claim row server-side (gets a UUID).
   *   3. Upload the photo to Storage under `receipts/{claim_id}.jpg`.
   *   4. Call the verify-receipt edge function — Claude Haiku decides.
   *   5. Branch on verdict:
   *       • status='completed' → success page, deduct cups
   *       • status='pending'   → success page with "under review" hint
   *       • status='failed'    → rejected page with which check failed
   *
   * We keep an in-flight `pendingClaim` object so each screen has the data
   * it needs without prop-drilling. The user CANNOT advance past verifying
   * until the function returns. */
  const [aiVerdict, setAiVerdict] = useState(null);
  const [aiRequiredItem, setAiRequiredItem] = useState(null);

  const handleReceiptSubmit = async (photoDataUrl) => {
    if (!photoDataUrl || !userId) {
      // No photo / no auth — fall back to old direct-success flow
      setPage('success');
      return;
    }

    setPage('verifying');
    try {
      const compressed = await compressImage(photoDataUrl);

      // 1. Create the claim row first (status='pending', no photo yet).
      //    Use selectedReward.id (the RESOLVED reward), not the raw
      //    selectedRewardId — the latter can still hold the cross-org
      //    default ('chicken-sandwich') if the user never tapped a card,
      //    which would make verify-receipt check for the wrong item.
      const claimId = await createClaim(userId, {
        type: 'cashback',
        rewardId: selectedReward.id,
        cupsRedeemed: selectedReward.cupsNeeded,
        payoutAmount: selectedReward.euros,
        iban: claimedIban,
        orgId: activeOrg?.id,
        // Set receipt_photo_path at insert time — anon users can't UPDATE
        // claims afterwards (no SELECT policy → 0 rows updated). The upload
        // below writes to exactly `${claimId}.jpg`.
        attachReceiptPhoto: true,
      });
      // Keep the claim ID around so the rejection page can surface it
      // (and pass it to the support mailto link).
      setLastClaimId(claimId);

      // 2. Upload photo to storage, attach path to the claim
      await uploadReceiptPhoto(claimId, compressed);

      // 3. Call the verify-receipt edge function (Claude Haiku)
      const result = await verifyReceipt(claimId);
      setAiVerdict(result);
      setAiRequiredItem(result?.requiredItem || selectedReward.name);

      if (result?.status === 'failed') {
        // AI rejected → don't deduct cups, show the rejection screen
        track(EVENTS.REWARD_CLAIM_ATTEMPTED, {
          reward_id: selectedRewardId,
          ai_status: 'failed',
          failure_checks: result?.failureChecks || [],
        });
        haptic('error');
        setPage('rejected');
        return;
      }

      // AI approved (status='completed') OR sent to human review (status='pending')
      // — both deduct cups now. If review later rejects, admin reverses manually.
      track(EVENTS.REWARD_CLAIM_SUCCESS, {
        reward_id: selectedRewardId,
        reward_name: selectedReward.name,
        cup_count: cupCount,
        ai_status: result?.status,
      });
      const newCount = Math.max(0, cupCount - selectedReward.cupsNeeded);
      const label = `Claimed: ${selectedReward.name}`;
      addHistory('reward_claimed', label);
      setCupCount(newCount);

      persist(
        updateCupBalance(userId, newCount),
        addHistoryEntry(userId, 'reward_claimed', label)
      );

      haptic('success');
      setPage('success');
    } catch (err) {
      console.error('Receipt verification failed:', err);
      // Budget cap reached at insert time (DB trigger) — show the paused
      // popup rather than a scary error, and never mention the amount.
      const errText = `${err?.message || ''} ${err?.detail || ''} ${err?.code || ''}`;
      if (/reward_budget_exceeded/i.test(errText)) {
        setRewardBudgetBlocked(true);
        setBudgetPausedOpen(true);
        setPage('home');
        return;
      }
      // Real failure (network, function down, RLS). Show an explicit
      // system-error state on the rejected page (no fake check ticks)
      // and DO NOT deduct cups — the claim row still exists for admin
      // to handle manually.
      setAiVerdict({
        status: 'failed',
        failureChecks: [],
        skippedChecks: [],
        isSystemError: true,
        summary:
          err?.message ||
          "We couldn't reach the verification service. Your cups have not been used — please try again in a moment.",
      });
      haptic('error');
      setPage('rejected');
    }
  };

  const handleSuccessDone = () => {
    setClaimed(false);
    setPage('home');
    setAiVerdict(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleRejectedTryAgain = () => {
    setAiVerdict(null);
    setPage('receipt');
  };

  const handleRejectedClose = () => {
    setAiVerdict(null);
    setPage('home');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleClaimAttempt = () => {
    track(EVENTS.REWARD_CLAIM_ATTEMPTED, { reward_id: selectedRewardId, reward_name: selectedReward.name, cup_count: cupCount });
  };

  const handleResetClaim = () => setClaimed(false);
  const handleOpenRefund = () => { track(EVENTS.DIRECT_REFUND_OPENED, { cup_count: cupCount }); setDirectRefundOpen(true); };
  const handleOpenTerms = () => { track(EVENTS.TERMS_OPENED); setTermsOpen(true); };

  /* ── Detail sheet ── */
  const handleViewDetail = (reward) => setDetailReward(reward);
  const handleClaimFromDetail = async () => {
    if (!(await ensureRewardBudgetOk())) return;
    setDetailReward(null);
    setPage('receipt');
  };

  /* ── Cup scan flow (QR-based) ────────────────────────────────────────
   * User scans a QR printed by the smart bin → CupScanPage decodes the
   * payload to a list of cup UUIDs → we call the claim-cups edge function
   * which atomically activates them server-side and increments the user's
   * balance. The function is the source of truth, so we re-read the
   * returned newBalance instead of optimistically guessing. */
  const [lastCupsScanned, setLastCupsScanned] = useState(1);
  const [cupScanError, setCupScanError] = useState(null);
  // Tracks the most-recently-attempted claim so the rejection page can
  // pass it to the "Get help" mailto link. Only set during the verify
  // flow, never cleared, since a stale id is still useful for support.
  const [lastClaimId, setLastClaimId] = useState(null);

  /* New signature: receives the parsed QR ({batchId} | {cupIds}) plus
   * optional scan-event metadata from CupScanPage so we can audit-log
   * every attempt admin-side. The photo upload is fire-and-forget — if
   * it fails the claim still goes through, the photo just won't appear
   * in the admin cup-scans table. */
  // `_overrideUserId` is passed by the deep-link init path to avoid a
  // stale-closure bug: when the app loads with ?batch= in the URL the
  // init useEffect calls this via setTimeout. At that point the React
  // state `userId` is still null in the initial render's closure even
  // though setUserId() was called moments earlier — the re-render
  // hasn't happened yet. Passing user.id directly sidesteps the race.
  const handleCupScan = async (parsed, meta = {}, _overrideUserId) => {
    track(EVENTS.CUP_ADDED);
    const uid = _overrideUserId || userId;
    if (!uid) return;

    // Mint a scan_id up front so the upload + claim call share a key.
    const scanId =
      (typeof crypto !== 'undefined' && crypto.randomUUID && crypto.randomUUID()) ||
      // Fallback for old browsers — random hex string of UUID shape
      'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });

    // Upload photo (if any) before calling the function, in parallel
    // with reading scan_id — both are cheap and uploadCupScanPhoto
    // resolves to null on failure so we keep going either way.
    let photoPath = null;
    if (meta.photoDataUrl) {
      try { photoPath = await uploadCupScanPhoto(scanId, meta.photoDataUrl); }
      catch (e) { console.error('photo upload failed (continuing):', e); }
    }

    // Funnel: a scan attempt reached the client claim path. Paired with
    // the resulting cup_scans row, this powers dashboard-completeness (#6)
    // — every attempt should produce exactly one server-side scan row.
    track(EVENTS.SCAN_ATTEMPTED, { user_id: uid, scan_id: scanId });

    try {
      const result = await claimCups(uid, parsed, {
        scanId,
        scanType: meta.scanType || 'deeplink',
        photoPath,
      });
      setCupCount(result.newBalance ?? cupCount + (result.activatedCount || 0));
      setLastCupsScanned(result.activatedCount || 1);
      const brand = activeOrg?.partner_brand_name || activeOrg?.name || 'the store';
      const label =
        (result.activatedCount || 1) === 1
          ? `Cup returned at ${brand}`
          : `${result.activatedCount} cups returned at ${brand}`;
      addHistory('cup_added', label);
      haptic('success');
      setPage('cup-scan-success');
    } catch (err) {
      console.error('Cup claim failed:', err);
      // Capture the structured error from claim-cups: edge function emits
      // `error` (machine code) + `reason` (human text). We send both
      // forward so CupClaimErrorPage can branch by code rather than
      // pattern-matching the human string.
      setCupScanError({
        code: err?.detail?.error || 'unknown',
        reason:
          err?.detail?.reason ||
          err?.message ||
          "Couldn't activate this cup QR. It may already have been used.",
        alreadyClaimed: err?.detail?.alreadyClaimed || [],
      });
      haptic('error');
      setPage('cup-scan-error');
    }
  };

  const handleCupScanAgain = () => setPage('cup-scan');
  const handleCupScanHome = () => { setPage('home'); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  /* ── Nudge ── */
  const handleNudge = (remaining) => {
    setNudgeCount(remaining);
    setTimeout(() => setNudgeCount(0), 3000);
  };

  /* ── Loading / error screens ──
   * P-47: skeleton shimmer instead of the bare "🥤 Loading…" spinner.
   * Feels less like a wait and more like the page composing itself. */
  if (isLoading) {
    return <HomeSkeleton />;
  }

  if (initError) {
    return <AppErrorScreen error={initError} />;
  }

  /* ── Maintenance mode ── */
  if (liveSettings.maintenanceMode) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', padding: '2rem', textAlign: 'center', background: '#FFF8F4' }}>
        <div>
          <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>🔧</div>
          <div style={{ fontSize: '1.1rem', fontWeight: 800, marginBottom: '0.5rem', color: '#1A1A1A' }}>Down for Maintenance</div>
          <div style={{ color: '#7A7166', fontSize: '0.875rem' }}>We'll be back shortly. Thanks for your patience.</div>
        </div>
      </div>
    );
  }

  /* ── Pages ── */
  if (page === 'cup-scan') {
    return <CupScanPage onScan={handleCupScan} onBack={() => setPage('home')} />;
  }

  if (page === 'donate-success') {
    return <DonateSuccessPage amount={donatedCups} onClose={() => setPage('home')} />;
  }

  // NOTE: cup-scan-success is intentionally NOT an early-return page. It
  // renders as a modal popup OVER the home screen (see the home return
  // below) so the customer sees their updated balance behind the success
  // card. The success state is keyed off `page === 'cup-scan-success'`.

  if (page === 'cup-scan-error') {
    return (
      <CupClaimErrorPage
        code={cupScanError?.code}
        reason={cupScanError?.reason}
        alreadyClaimed={cupScanError?.alreadyClaimed}
        onTryAgain={() => { setCupScanError(null); setPage('cup-scan'); }}
        onClose={() => { setCupScanError(null); setPage('home'); }}
        orgName={activeOrg?.partner_brand_name || activeOrg?.name}
      />
    );
  }

  if (page === 'receipt') {
    return <ReceiptPage reward={selectedReward} onSubmit={handleReceiptSubmit} onBack={() => setPage('home')} orgName={activeOrg?.partner_brand_name || activeOrg?.name} />;
  }

  if (page === 'verifying') {
    return <ReceiptVerifyingPage />;
  }

  if (page === 'rejected') {
    /* Pull the most-relevant per-check `reason` from the AI verdict.
     * Previously we only fell back to `check_is_receipt.reason`, which
     * meant a rejection on (say) "not really BK" never surfaced its
     * actual reason — the user just saw the generic check label. */
    const checkReason = (() => {
      const v = aiVerdict?.verdict;
      if (!v) return null;
      const checks = ['check_is_receipt', 'check_is_authentic_burger_king', 'check_contains_required_item'];
      for (const k of checks) {
        const node = v[k];
        if (node && node.passed === false && node.reason) return node.reason;
      }
      return null;
    })();
    return (
      <ReceiptRejectedPage
        failureChecks={aiVerdict?.failureChecks || []}
        skippedChecks={aiVerdict?.skippedChecks || []}
        isSystemError={aiVerdict?.isSystemError === true}
        reason={aiVerdict?.summary || checkReason}
        requiredItem={aiRequiredItem}
        claimId={lastClaimId}
        partnerBrand={activeOrg?.partner_brand_name || activeOrg?.name}
        onTryAgain={handleRejectedTryAgain}
        onClose={handleRejectedClose}
      />
    );
  }

  if (page === 'success') {
    return (
      <SuccessPage
        reward={selectedReward}
        claimedIban={claimedIban}
        onDone={handleSuccessDone}
        aiStatus={aiVerdict?.status}
        userName={profile?.displayName}
        userEmail={profile?.email}
      />
    );
  }

  if (page === 'refund-success') {
    return (
      <RefundSuccessPage
        cupCount={refundCupCount}
        iban={refundIban}
        onDone={() => { setPage('home'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
      />
    );
  }

  if (page === 'user') {
    return (
      <div className="app">
        <UserPage
          profile={profile}
          onSaveProfile={handleSaveProfile}
          cupCount={cupCount}
          cashbackRate={liveSettings.cashbackRatePerCup}
          history={history}
          userClaims={userClaims}
          rewards={liveRewards}
          authEmail={authEmail}
          onOpenSignIn={() => setShowSignIn(true)}
          onAddCup={handleAddCup}
          onWithdraw={showRefund ? handleWithdraw : null}
          onOpenShare={showShare ? () => setShareSheetOpen(true) : null}
          onOpenNextCupFree={showNextCupFree ? () => setShareSheetOpen(true) : null}
          onOpenDonate={showDonate ? () => setDonateSheetOpen(true) : null}
          showActivity={showActivity}
          showImpact={showImpact}
          lifetimeCups={lifetimeCups}
          copy={designCopy}
          onRefreshClaims={async () => {
            // Re-pull claims when user lands on the activity tab — that's when
            // they'd notice an admin status change. Cheap enough to do eagerly.
            if (userId) {
              try { setUserClaims(await getMyClaims(userId)); } catch (e) { console.error(e); }
            }
          }}
          onClose={() => setPage('home')}
        />
        <SignInSheet
          open={showSignIn}
          onClose={() => setShowSignIn(false)}
          onLinked={async () => {
            // After a sign-out, refresh the local user back to anonymous
            // device mode so the in-memory state matches reality. Pass the
            // active org so we resolve THIS org's row, not a fresh orphan.
            try {
              const refreshed = await getOrCreateUser(activeOrg?.id);
              setUserId(refreshed.id);
            } catch (e) { console.error(e); }
          }}
          requireVerification={liveSettings?.requireEmailVerification !== false}
          savedEmail={profile?.email || authEmail || null}
          onSaveEmailDirect={async (em) => {
            if (!userId) throw new Error('no_user');
            await updateUserProfile(userId, { email: em });
            setProfile(p => (p ? { ...p, email: em } : p));
          }}
        />
        {liveSettings.featureDirectRefunds && (
          <DirectRefundSheet
            open={directRefundOpen}
            onClose={() => setDirectRefundOpen(false)}
            cupCount={cupCount}
            onConfirm={handleDirectRefundConfirm}
            refundRate={liveSettings.refundRatePerCup}
            cashbackRate={liveSettings.cashbackRatePerCup}
          />
        )}
        {liveSettings.featureCupSharing && (
          <ShareCupSheet
            open={shareSheetOpen}
            userId={userId}
            orgName={activeOrg?.partner_brand_name || activeOrg?.name}
            onClose={(result) => {
              setShareSheetOpen(false);
              // share-cups edge function already decremented the balance
              // and wrote the activity row server-side. We just need to
              // mirror that locally so the UI updates without another
              // round-trip.
              const cupsShared = result?.cupsShared || 0;
              if (cupsShared > 0) {
                const newCount =
                  typeof result?.newBalance === 'number'
                    ? result.newBalance
                    : Math.max(0, cupCount - cupsShared);
                setCupCount(newCount);
                addHistory(
                  'cups_shared',
                  `Shared ${cupsShared} cup${cupsShared !== 1 ? 's' : ''} via QR code`,
                );
              }
            }}
            cupCount={cupCount}
          />
        )}
        {liveSettings.featureDonations && (
          <DonateSheet
            open={donateSheetOpen}
            orgName={activeOrg?.partner_brand_name || activeOrg?.name}
            onClose={(cupsToDonate) => {
              setDonateSheetOpen(false);
              // Donate has no server-side enforcement (vs. share-cups which
              // does). The sheet itself blocks 0-balance opens, but clamp
              // here too so a stale `cupsToDonate` from a race condition
              // can never overdraw the balance or fabricate a history entry.
              const actual = Math.max(0, Math.min(cupsToDonate, cupCount));
              if (actual > 0) {
                const newCount = cupCount - actual;
                const label = `Donated ${actual} cup${actual !== 1 ? 's' : ''} to Plastic Soup Foundation`;
                setCupCount(newCount);
                setDonatedCups(actual);
                addHistory('cups_donated', label);
                setPage('donate-success');
                if (userId) persist(
                  updateCupBalance(userId, newCount),
                  addHistoryEntry(userId, 'cups_donated', label),
                  // Write a completed donation claim so the admin Donations
                  // page can aggregate real cup + euro totals. Uses the refund
                  // rate (€/cup) as the per-cup value — same basis used for
                  // direct-refund claims.
                  addDonationClaim(userId, actual, actual * (liveSettings.refundRatePerCup || 1.00), activeOrg?.id),
                );
              }
            }}
            cupCount={cupCount}
          />
        )}
      </div>
    );
  }

  return (
    <div className="app">
      {/* Cup-scan success — modal popup over the live home screen (portaled
          to <body>), so the customer sees their updated balance behind it. */}
      {page === 'cup-scan-success' && (
        <CupScanSuccess
          cupsAdded={lastCupsScanned}
          newTotal={cupCount}
          onAddMore={handleCupScanAgain}
          onHome={handleCupScanHome}
        />
      )}

      <Header
        cupCount={cupCount}
        onBadgeClick={() => setPage('user')}
        onAddCup={handleAddCup}
        org={activeOrg}
        design={design}
      />

      <section className="app__hero">
        <h1 className="app__headline">{liveSettings.heroHeadline}</h1>
        <p className="app__subtext">{liveSettings.heroSubtext}</p>
      </section>

      <CupProgress
        collected={cupCount}
        target={selectedReward.cupsNeeded}
        nudgeCount={nudgeCount}
      />

      <FeaturedReward
        key={selectedRewardId}
        reward={selectedReward}
        isUnlocked={isUnlocked}
        cupsRemaining={cupsRemaining}
        cupsCollected={cupCount}
        claimed={claimed}
        savedIban={profile?.iban}
        onClaim={handleClaim}
        onClaimAttempt={handleClaimAttempt}
        budgetBlocked={rewardBudgetBlocked}
        onBudgetBlocked={handleBudgetBlocked}
        onResetClaim={handleResetClaim}
        onOpenTerms={handleOpenTerms}
        onOpenRefund={showRefund ? handleOpenRefund : null}
        onViewDetail={() => handleViewDetail(selectedReward)}
        onNudge={handleNudge}
        onAddCup={handleAddCup}
      />

      <GoalSection
        rewards={otherRewards}
        cupCount={cupCount}
        onSelectReward={handlePickReward}
        onViewDetail={handleViewDetail}
      />

      {detailReward && (
        <RewardDetailSheet
          reward={detailReward}
          isSelected={detailReward.id === selectedRewardId}
          cupCount={cupCount}
          onPick={(id) => { handlePickReward(id); }}
          onClaim={handleClaimFromDetail}
          budgetBlocked={rewardBudgetBlocked}
          onBudgetBlocked={handleBudgetBlocked}
          onClose={() => setDetailReward(null)}
          orgName={activeOrg?.partner_brand_name || activeOrg?.name}
          showCashbackStep={!!liveSettings?.featureDirectRefunds}
        />
      )}

      <BudgetPausedModal
        open={budgetPausedOpen}
        onClose={() => setBudgetPausedOpen(false)}
        title={liveSettings?.budgetPausedTitle}
        body={liveSettings?.budgetPausedBody}
      />

      <Modal open={termsOpen} onClose={() => setTermsOpen(false)} title="Voucher Terms">
        <p><strong>How it works:</strong> Return your reusable PackBack cups at any participating {activeOrg?.partner_brand_name || activeOrg?.name || 'partner'} location. Each returned cup adds to your balance.</p>
        <ul>
          <li>Rewards are digital vouchers — no app download needed.</li>
          <li>One reward can be claimed per cup cycle.</li>
          <li>Vouchers are valid for 30 days after claiming.</li>
          {liveSettings?.featureDirectRefunds && (
            <li>Cashback is sent to your IBAN within 3 business days.</li>
          )}
          <li>You can switch your reward goal at any time before claiming.</li>
        </ul>
        {liveSettings?.featureDirectRefunds && (
          <p><strong>Refund policy:</strong> If you prefer cash over a food reward, use &quot;Get the direct refund&quot; to withdraw your cup deposit instead.</p>
        )}
        <button className="modal-btn" onClick={() => setTermsOpen(false)}>Got it</button>
      </Modal>

      {liveSettings.featureDirectRefunds && (
        <DirectRefundSheet
          open={directRefundOpen}
          onClose={() => setDirectRefundOpen(false)}
          cupCount={cupCount}
          onConfirm={handleDirectRefundConfirm}
          refundRate={liveSettings.refundRatePerCup}
          cashbackRate={liveSettings.cashbackRatePerCup}
        />
      )}
    </div>
  );
}
