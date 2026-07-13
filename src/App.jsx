import { useState, useEffect, useRef, useMemo } from 'react';
import Header from './components/Header';
import { applyDesignColors, mergeDesign } from './admin/appdesign/designDefaults';
import CupProgress from './components/CupProgress';
import FeaturedReward from './components/FeaturedReward';
import GoalSection from './components/GoalSection';
import Modal from './components/Modal';
import UserPage from './components/UserPage';
import InAppBrowserSheet from './components/InAppBrowserSheet';
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
import HowItWorks from './components/HowItWorks';
import usePersistedState from './hooks/usePersistedState';
import { rewards } from './data/rewards';
import { getShotPreset } from './lib/shotPresets'; // DEV-only screen-audit harness
import { track, EVENTS, setAnalyticsContext, getEntryContext, getInAppBrowserKind } from './utils/analytics';
import { getConsentPrefs } from './lib/consent';
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
  ensureIdentityForUser,
  propagateProfileToGroup,
  getGroupActivity,
  mintByoCup,
} from './lib/api';
import { getGroupContext, composeGroupCopy, getGroupBalances, getGroupStores, getGroupBySlug } from './lib/groups';
import BudgetPausedModal from './components/BudgetPausedModal';
import StoresPage from './components/StoresPage';
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

// Placeholder reward used only in the brief window before a venue's real rewards
// arrive from its published config (there is no Burger King default any more —
// `rewards` is empty). Numeric fields are 0 so the progress math is safe; the
// home screen shows a skeleton while isLoading, so a venue that has rewards
// never actually shows this.
const EMPTY_REWARD = {
  id: null,
  name: '',
  description: '',
  image: null,
  cupsNeeded: 0,
  euros: 0,
  bgColor: 'var(--pb-cream)',
  tags: [],
  displayLines: [],
};

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
  // When a claim is attempted without an email, we open the sign-in sheet and
  // remember to continue to the receipt step the moment the email verifies.
  const [claimAfterSignIn, setClaimAfterSignIn] = useState(false);

  /* ── Live config from admin publish ── */
  const [liveRewards, setLiveRewards] = useState(rewards);
  const [liveSettings, setLiveSettings] = useState({
    cashbackRatePerCup: 1.25,
    refundRatePerCup: 1.00,
    // D.5: default to the BYO wording (this is the product now). Was the old
    // Burger-King/deposit hero ("Collect Cups & Get Rewards" / "cup deposits…
    // standard refund"), which showed for any ungrouped org + the pre-config flash.
    heroHeadline: 'Bring your cup, earn cashback',
    heroSubtext: 'Use your own reusable cup and collect rewards every time you refill.',
    featureCupSharing: false,
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
  // Phase 3: group context for the active org (null when the org isn't in a
  // group — i.e. every existing single org, which then behaves unchanged).
  // Drives the Stores page and the mode-sensitive (BYO vs deposit) copy.
  const [groupCtx, setGroupCtx] = useState(null);
  // Phase 3: the shared customer identity id for this person (grouped orgs
  // only). Lets profile edits propagate to every store in the group.
  const identityIdRef = useRef(null);
  // Whether the active group is BYO — profile consistency across stores is a
  // BYO-only behaviour.
  const byoGroupRef = useRef(false);
  // Phase 3: this person's per-store balances across the group (org id →
  // {balance, lifetime}). Powers the Stores page + the A1 unlock gate.
  const [groupBalances, setGroupBalances] = useState({});
  // Phase 3: when the account page is opened FROM the Stores hub it shows a
  // combined view — summed balance + activity across every store.
  const [accountCombined, setAccountCombined] = useState(false);
  // Where "add a cup" was launched from, so the cup-scan back button returns
  // there (e.g. the combined Stores account) instead of always a store home.
  const [cupScanReturn, setCupScanReturn] = useState(null);
  const [combinedHistory, setCombinedHistory] = useState([]);
  // Phase 3: per-store extras for the Stores page (org id → {featured, location}).
  const [groupStores, setGroupStores] = useState({});
  // Phase 3: result of a BYO stationary-QR scan (?byo). Drives a confirmation
  // modal — credited (+ optional cross-store note) or held-for-review.
  const [byoResult, setByoResult] = useState(null);
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
  // Persisted to localStorage (not just React state) so it survives the full
  // page reload that a BYO counter-QR scan triggers. Without this, each added
  // cup reloads the app, `selectedRewardId` starts empty while the async DB
  // restore is still in flight, and the auto-select effect below snaps the
  // pick to the featured reward — the "my 8-cup reward jumped to 12 cups" bug.
  // localStorage is synchronous, so the pick is present on the very first
  // render after a reload and never gets yanked.
  const [selectedRewardId, setSelectedRewardId] = usePersistedState('selected_reward_id', ''); // set from the active org's rewards on load (see effect below)

  // Keep the selected reward valid for the active org. The default
  // ('chicken-sandwich') is a Burger King id; on other orgs we snap to the
  // featured reward (or the first) so the selection — and any claim made
  // from it — always references a reward that belongs to THIS org.
  //
  // Guard against a ONE-RENDER transient: while the published config refetches
  // (e.g. right as you hit the cup goal) `liveRewards` can briefly swap in a
  // stale/other list that doesn't contain your pick. We only snap when the
  // selection is empty (initial) or was ALSO absent from the *previous* rewards
  // set — a real invalidation (org switch / removed reward), not a blip — so a
  // valid choice like the one you selected is never yanked out from under you.
  const prevRewardIdsRef = useRef('');
  useEffect(() => {
    if (!liveRewards.length) return;
    const idSet = liveRewards.map(r => r.id).join('|');
    if (!liveRewards.some(r => r.id === selectedRewardId)) {
      const missingBefore = prevRewardIdsRef.current !== '' &&
        !prevRewardIdsRef.current.split('|').includes(selectedRewardId);
      if (!selectedRewardId || missingBefore) {
        const featured = liveRewards.find(r => r.featured) || liveRewards[0];
        if (featured) setSelectedRewardId(featured.id);
      }
    }
    prevRewardIdsRef.current = idSet;
  }, [liveRewards, selectedRewardId]);
  const [claimed, setClaimed] = usePersistedState('claimed', false); // transient UI flag, localStorage is fine
  // S1: a "visitor" only opened the app. This flips true the moment they do
  // anything real this session (scan attempt, name/email edit, reward
  // pick); persisted signals (cups, email) cover it across reloads.
  const [didEngage, setDidEngage] = useState(false);
  // Android in-app browser hit a cup deeplink: hold the claim and offer to
  // reopen in the default browser. { parsed } = the cup payload, kept unclaimed.
  const [inAppClaim, setInAppClaim] = useState(null);
  const [inAppRedirecting, setInAppRedirecting] = useState(false);

  /* ── Navigation ── */
  const [page, setPage] = useState('home');
  const [shot, setShot] = useState(null); // DEV-only screen-audit preset (?__shot=)

  // Behavioural analytics: log which screen the user is on whenever it
  // changes. Powers the "Last screen / drop-off" metric. Fire-and-forget.
  useEffect(() => {
    track(EVENTS.SCREEN_VIEW, { screen: page });
  }, [page]);

  /* ── Detail sheet ── */
  const [detailReward, setDetailReward] = useState(null);

  /* ── Nudge (highlight remaining cups) ── */
  const [nudgeCount, setNudgeCount] = useState(0);

  /* ── Modal state ── */
  const [termsOpen, setTermsOpen] = useState(false);
  // "How it works" walkthrough. The intro button shows until the guide has
  // been opened once (first-time users), then stays out of the way.
  const [howItWorksOpen, setHowItWorksOpen] = useState(false);
  const [hiwSeen, setHiwSeen] = usePersistedState('hiw_seen', false);
  const [directRefundOpen, setDirectRefundOpen] = useState(false);
  const [refundCupCount, setRefundCupCount] = useState(0);
  const [refundAmount, setRefundAmount] = useState(0); // C.2: real € paid (rate × cups)
  const [shareSheetOpen, setShareSheetOpen] = useState(false);
  const [donateSheetOpen, setDonateSheetOpen] = useState(false);
  const [donatedCups, setDonatedCups] = useState(0);

  /* ── Derived values ── */
  // Harmless fallback for the window before a venue's rewards load (there is no
  // Burger King default any more — `rewards` is empty). Keeps every downstream
  // `selectedReward.*` access safe instead of crashing on undefined; the real
  // reward replaces it as soon as the published config arrives.
  const selectedReward = liveRewards.find((r) => r.id === selectedRewardId) || liveRewards[0] || EMPTY_REWARD;
  const otherRewards = liveRewards.filter((r) => r.id !== selectedRewardId);
  const isUnlocked = cupCount >= selectedReward.cupsNeeded;
  const cupsRemaining = Math.max(0, selectedReward.cupsNeeded - cupCount);

  // S1: still just a visitor? No cups, no contact details, and no engaging
  // action this session. (selectedRewardId is excluded — it defaults to the
  // featured reward on load, so its presence doesn't mean they picked one.)
  const isVisitor =
    (cupCount || 0) === 0 &&
    (lifetimeCups || 0) === 0 &&
    !(profile?.email && String(profile.email).trim()) &&
    !didEngage;

  // Header user-tile indicator: green "!" once a claim is approved (admin sent
  // the Tikkie link), amber timer while any claim is still in review.
  const claimStatus = (() => {
    const cs = userClaims || [];
    const isCash = c => c.type === 'cashback' || c.type === 'direct_refund';
    if (cs.some(c => isCash(c) && c.status === 'completed' && c.tikkie_url && c.tikkie_status !== 'redeemed')) return 'ready';
    if (cs.some(c => isCash(c) && (c.status === 'pending' || (c.status === 'completed' && !c.tikkie_url)))) return 'pending';
    return null;
  })();

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

  /* Phase 3: mode-sensitive copy. For a grouped org we compose the copy
   * from its group's mode (BYO drops all deposit/return/SmartBin wording);
   * for an ungrouped org this is null and every string below falls back to
   * the app's existing per-org / hardcoded copy — so nothing changes for
   * the existing single orgs. */
  const groupCopy    = useMemo(() => (groupCtx ? composeGroupCopy(groupCtx) : null), [groupCtx]);
  const heroHeadline = groupCopy?.heroHeadline ?? liveSettings.heroHeadline;
  const heroSubtext  = groupCopy?.heroSubtext  ?? liveSettings.heroSubtext;
  const effDesignCopy = groupCopy ? { ...designCopy, ...groupCopy.designCopy } : designCopy;
  const isByo        = groupCopy?.mode === 'byo';
  // Guide "stories" steps: an admin-edited guide (App Design) wins; else the
  // group-mode copy; else HowItWorks falls back to its built-in steps.
  const guideSteps   = (design.guide?.steps?.length ? design.guide.steps : groupCopy?.howItWorks?.steps);

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
    async function init(attempt = 0) {
      try {
        // DEV-ONLY screen-audit harness. ?__shot=<preset> renders one screen +
        // state deterministically INSIDE the real BYO group (byonl) — it
        // resolves the real org/group/config (authentic BYO copy, venues,
        // rewards, Stores hub) then applies preset overrides. No user writes.
        // Stripped from prod via import.meta.env.DEV.
        if (import.meta.env.DEV) {
          const shotName = new URLSearchParams(window.location.search).get('__shot');
          const preset = shotName ? getShotPreset(shotName) : null;
          if (preset) {
            setShot(preset);
            if (preset.hold) return; // keep the loading skeleton up

            // Resolve the REAL org + group from the URL (/byonl or /byonl/<store>).
            const segs = (window.location.pathname || '/').split('/').filter(Boolean);
            const grp = segs[0] ? await getGroupBySlug(segs[0]) : null;
            let org = null, hubRoute = false;
            if (grp) {
              if (segs[1]) org = (await getOrgBySlug(segs[1])) || grp.members[0];
              else { hubRoute = true; org = grp.members[0]; }
            } else if (segs[0]) {
              org = await getOrgBySlug(segs[0]);
            }
            if (!org) org = await getDefaultOrg();
            if (org) setActiveOrg(org);

            const gctx = await getGroupContext(org?.id);
            setGroupCtx(gctx);
            if (gctx) byoGroupRef.current = gctx.mode === 'byo';

            const config = await getAppConfig(org?.id);
            const live = (config?.rewards || []).filter((r) => r.status === 'live');
            if (live.length) setLiveRewards(live);
            if (config?.settings) setLiveSettings((s) => ({ ...s, ...config.settings }));
            if (preset.settings) setLiveSettings((s) => ({ ...s, ...preset.settings }));

            if (gctx) {
              try { setGroupStores(await getGroupStores(gctx.members.map((m) => m.id))); } catch { /* best-effort */ }
              if (preset.memberBalances) {
                const bals = {};
                gctx.members.forEach((m, i) => { bals[m.id] = { balance: preset.memberBalances[i] ?? 0, lifetime: preset.memberBalances[i] ?? 0 }; });
                setGroupBalances(bals);
              }
            }

            // Featured reward + reward-linked demo objects from the venue's REAL rewards.
            const rlist = live.length ? live : liveRewards;
            const featured = rlist[preset.featIdx ?? 0] || rlist[0];
            if (featured) setSelectedRewardId(featured.id);
            const euro = (rw) => (typeof rw?.euros === 'number' ? rw.euros : (rw?.cupsNeeded || 0) * (config?.settings?.cashbackRatePerCup || 0.4));
            const mkClaim = (kind, rw) => ({
              id: `demo-${kind}`, type: 'cashback', reward_id: rw?.id, cups_redeemed: rw?.cupsNeeded || 8,
              payout_amount: Number(euro(rw).toFixed(2)), created_at: '2026-07-06T10:00:00Z', notify_email: true, notify_push: false,
              ...(kind === 'pending' ? { status: 'pending' }
                : kind === 'ready' ? { status: 'completed', tikkie_url: 'https://tikkie.me/pay/demo/abc', tikkie_status: 'created' }
                : { status: 'failed' }),
            });
            if (preset.claims === 'pending') setUserClaims([mkClaim('pending', featured)]);
            else if (preset.claims === 'ready') setUserClaims([mkClaim('ready', featured)]);
            else if (preset.claims === 'mix') setUserClaims([mkClaim('pending', featured), mkClaim('ready', rlist[1] || featured), mkClaim('rejected', rlist[3] || featured)]);
            if (preset.detailIdx != null) setDetailReward(rlist[preset.detailIdx] || rlist[1] || featured);

            if (preset.profile) setProfile(preset.profile);
            if (preset.authEmail) setAuthEmail(preset.authEmail);
            if (typeof preset.cupCount === 'number') setCupCount(preset.cupCount);
            if (typeof preset.lifetimeCups === 'number') setLifetimeCups(preset.lifetimeCups);
            if (preset.history) setHistory(preset.history);
            if (preset.termsOpen) setTermsOpen(true);
            if (preset.howItWorksOpen) setHowItWorksOpen(true);
            if (preset.directRefundOpen) setDirectRefundOpen(true);
            if (preset.donateSheetOpen) setDonateSheetOpen(true);
            if (preset.byoResult) setByoResult(preset.byoResult);
            if (preset.budgetPausedOpen) setBudgetPausedOpen(true);
            if (preset.inAppClaim) setInAppClaim(preset.inAppClaim);
            if (preset.showSignIn) setShowSignIn(true);
            if (preset.accountCombined) setAccountCombined(true);
            if (typeof preset.refundCupCount === 'number') setRefundCupCount(preset.refundCupCount);
            if (typeof preset.donatedCups === 'number') setDonatedCups(preset.donatedCups);
            if (typeof preset.lastCupsScanned === 'number') setLastCupsScanned(preset.lastCupsScanned);
            if (preset.cupScanError) setCupScanError(preset.cupScanError);
            if (preset.aiVerdict) setAiVerdict(preset.aiVerdict);
            if (preset.aiRequiredItem) setAiRequiredItem(preset.aiRequiredItem);
            if (preset.lastClaimId) setLastClaimId(preset.lastClaimId);
            setUserId('shot-user');
            if (preset.initError) { setInitError(preset.initError); setIsLoading(false); return; }
            setPage(preset.page || (hubRoute ? 'stores' : 'home'));
            setIsLoading(false);
            return;
          }
        }

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
            phone: 'Preview device',
            marketingConsent: false,
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
        // Path shapes:
        //   /<orgSlug>              → that store (legacy, still works)
        //   /<groupSlug>            → the group's Stores hub
        //   /<groupSlug>/<orgSlug>  → that store within the group
        const segs = (window.location.pathname || '/').split('/').filter(Boolean);
        const seg0 = segs[0] === 'admin' ? null : (segs[0] || null);
        const seg1 = segs[1] || null;
        let org = null;
        let hubRoute = false;
        if (seg0) {
          const grp = await getGroupBySlug(seg0);
          if (grp) {
            if (seg1) {
              // Individual store under the group.
              org = (await getOrgBySlug(seg1)) || grp.members[0] || null;
            } else {
              // Group hub → open the Stores page. Use a member for context.
              hubRoute = true;
              org = grp.members[0] || null;
            }
          } else {
            // seg0 wasn't a group — try it as an org slug, then (defensively)
            // seg1, so /<group>/<venue> still resolves the venue even if the
            // group lookup hiccups.
            org = (await getOrgBySlug(seg0)) || (seg1 ? await getOrgBySlug(seg1) : null);
          }
        }
        // No venue resolved from the URL. Do NOT fall back to a default org —
        // that silently dropped visitors into Burger King (its rewards + a
        // wrong-org users row that crashed on users_device_org_key). Send them
        // to the root venue chooser instead.
        if (!org) { window.location.replace('/'); return; }
        setActiveOrg(org);
        if (hubRoute) setPage('stores'); // /<groupSlug> lands on the Stores hub

        const user = await getOrCreateUser(org?.id);

        // Phase 3: resolve the group + shared identity FIRST, so a store the
        // customer is visiting for the first time inherits the SAME name /
        // email they already have at their first store (rather than
        // minting a fresh random profile). ensureIdentityForUser backfills
        // `user` in place; returns null for ungrouped orgs.
        const gctx = await getGroupContext(org?.id);
        setGroupCtx(gctx);
        const byoGroup = gctx?.mode === 'byo';
        byoGroupRef.current = byoGroup;
        let identity = null;
        if (gctx) {
          try {
            // Profile consistency across stores is a BYO-only behaviour
            // (syncProfile). Deposit groups still get an identity for the
            // Stores page + combined balances, just no shared profile.
            identity = await ensureIdentityForUser(user, {
              deviceId: user.device_id,
              authUid: user.auth_user_id,
              authEmail: user.email,
              syncProfile: byoGroup,
            });
            identityIdRef.current = identity?.id || null;
          } catch (e) {
            console.warn('group identity (non-fatal):', e);
          }
        }

        // Generate a display name only for a genuinely brand-new person — one
        // with no name on this row AND none inherited from the shared identity.
        let displayName = user.display_name;
        let animalIndex = user.animal_index ?? 0;
        if (!displayName) {
          const generated = generateInitialProfile();
          displayName = generated.displayName;
          animalIndex = generated.animalIndex;
          await updateUserProfile(user.id, { displayName, animalIndex });
          // BYO only: seed the shared identity so sibling stores inherit this name.
          if (identity?.id && byoGroup) persist(propagateProfileToGroup(identity.id, { displayName, animalIndex }));
        }

        setUserId(user.id);
        // Funnel analytics: tie this session to the resolved org + user,
        // then mark the app as loaded (top of the feasibility-test funnel).
        setAnalyticsContext({ orgId: org?.id, userId: user.id });
        // Capture entry context BEFORE the deeplink's ?batch param is
        // stripped below, so we can later attribute 0-cup accounts to a
        // shared link / in-app browser / bare URL.
        track(EVENTS.APP_LOADED, { slug: seg0 || null, ...getEntryContext() });
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
          phone: device,
          marketingConsent: !!user.marketing_consent,
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

        // Phase 3: `gctx` + `identity` were resolved up-front (above) so the
        // profile could be shared before minting a name. For grouped orgs,
        // pull the per-store balances + the Stores-page data here.
        if (gctx) {
          try {
            if (identity?.id) {
              const bals = await getGroupBalances(identity.id, gctx.members.map(m => m.id));
              setGroupBalances(bals);
            }
          } catch (e) {
            console.warn('group balances (non-fatal):', e);
          }
          // Per-store featured reward + location for the Stores page (best-effort).
          getGroupStores(gctx.members.map(m => m.id))
            .then(setGroupStores)
            .catch(e => console.warn('getGroupStores (non-fatal):', e));
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
            const inAppKind = getInAppBrowserKind();
            if (inAppKind) {
              // In-app webview (Android, or a detectable iOS app): DON'T
              // claim or strip the param yet — the cup would strand in a
              // throwaway account. Hold it and prompt the user to open in
              // their real browser. "Collect here anyway" is the safe
              // fallback. The param stays in the URL so both paths work.
              track(EVENTS.INAPP_PROMPT_SHOWN, { platform: inAppKind });
              setInAppClaim({ parsed, platform: inAppKind });
            } else {
              // Normal browser (incl. iOS, desktop, Chrome Custom Tabs):
              // unchanged — clear the param so a refresh doesn't re-trigger,
              // then auto-claim. Pass user.id directly to avoid the stale
              // userId closure on first render.
              window.history.replaceState({}, '', window.location.pathname);
              setTimeout(() => handleCupScan(parsed, { scanType: 'deeplink' }, user.id), 100);
            }
          }
        }

        // Phase 3 BYO: the stationary counter QR opens /<slug>/?byo=1. Mint
        // one cup via the byo-mint edge function (soft cap: ≤2 auto-credit per
        // rolling 24h, 3rd+ held for admin review). The edge function is the
        // authority and rejects any non-BYO org, so this is safe to attempt
        // whenever the param is present.
        const urlByo = sp.get('byo');
        if (urlByo && org?.id) {
          window.history.replaceState({}, '', window.location.pathname);
          const gcopy = gctx ? composeGroupCopy(gctx) : null;
          // Test-only: the counter QR can carry ?cups=N to add several cups
          // per scan (the admin generator sets this). The edge mint remains the
          // authority (+1, cap-aware); any extra test cups are credited client-side.
          const testCups = Math.max(1, Math.min(50, parseInt(sp.get('cups'), 10) || 1));
          mintByoCup(user.id, org.id)
            .then(res => {
              if (res?.status === 'credited') {
                // Show the SAME success popup as a normal cup claim
                // (CupScanSuccess) rather than a bespoke BYO modal.
                const total = testCups > 1 ? res.newBalance + (testCups - 1) : res.newBalance;
                if (testCups > 1) persist(updateCupBalance(user.id, total));
                setCupCount(total);
                setLastCupsScanned(testCups);
                setPage('cup-scan-success');
              } else if (res?.status === 'pending_review') {
                setByoResult({
                  status: 'pending',
                  title: gcopy?.dailyCapReview?.title || 'You’ve reached today’s cup limit',
                  body:  gcopy?.dailyCapReview?.body  || 'You’ve hit today’s cup limit at this store. We’ll review this scan and, if it’s valid, add the cup to your balance.',
                });
              }
            })
            .catch(err => {
              console.warn('BYO mint failed:', err);
              setByoResult({
                status: 'error',
                title: 'Couldn’t add the cup',
                body: 'Please try scanning the counter code again in a moment.',
              });
            });
        }
      } catch (err) {
        console.error('PackPerks init failed:', err);
        // Self-heal transient row collisions. A concurrent sign-in / email
        // merge can race the per-(device,org) user insert (Postgres 23505
        // "users_device_org_key") or briefly leave two rows for one slot
        // (PostgREST PGRST116 "multiple rows"). By the time we retry, the
        // row exists and getOrCreateUser resolves to it — so retry a couple
        // of times with a short backoff instead of stranding the user on the
        // "trouble loading your cups" screen.
        const code = err?.code || '';
        const msg = err?.message || '';
        const recoverable =
          code === '23505' || code === 'PGRST116' ||
          /duplicate key|users_device_org_key|multiple \(or no\) rows|multiple rows returned/i.test(msg);
        if (recoverable && attempt < 3) {
          await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
          return init(attempt + 1);
        }
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
   * using var(--pb-orange) etc. and just get a different colour. */
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

  /* Server-side consent sync: mirror the Marketing cookie choice onto the user's
   * row (users.marketing_consent) so the choice is stored + honoured server-side.
   * (Analytical consent already takes effect client-side — client_events are only
   * written with analytical consent; see utils/analytics.js. Technical is the
   * essential baseline.) Runs once the user row exists and again whenever the
   * choice changes, writing only on an actual change so the timestamp isn't
   * churned on every load. */
  useEffect(() => {
    if (!userId) return undefined;
    const sync = (marketing) => {
      if (marketing === profile?.marketingConsent) return;
      updateUserProfile(userId, { marketingConsent: marketing }).catch(() => {});
    };
    const prefs = getConsentPrefs();
    if (prefs) sync(prefs.marketing);
    const onChange = (e) => sync(!!e.detail?.marketing);
    window.addEventListener('packperks:consent-changed', onChange);
    return () => window.removeEventListener('packperks:consent-changed', onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, profile?.marketingConsent]);

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
    setDidEngage(true); // editing name / email means they're no longer just a visitor
    setProfile((prev) => ({ ...prev, ...updates }));
    if (userId) persist(updateUserProfile(userId, updates));
    // Phase 3 (BYO groups only): keep the account identical across every store
    // in the group — push name / email edits to the shared identity +
    // sibling rows.
    if (identityIdRef.current && byoGroupRef.current) {
      persist(propagateProfileToGroup(identityIdRef.current, {
        displayName: updates.displayName,
        animalIndex: updates.animalIndex,
        email: updates.email,
        marketingConsent: updates.marketingConsent,
      }));
    }
  };

  /* ── Reward handlers ── */
  const handlePickReward = (id) => {
    // C.8.6: log the reward from LIVE rewards, not the Burger King seed array
    // (which would log an undefined/wrong name for any real org reward).
    const reward = liveRewards.find((r) => r.id === id);
    track(EVENTS.REWARD_SELECTED, { reward_id: id, reward_name: reward?.name, cup_count: cupCount });
    setDidEngage(true); // actively picking a reward = a real user, not a visitor
    setSelectedRewardId(id);
    setClaimed(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (userId) persist(updateUserProfile(userId, { selectedRewardId: id }));
  };

  const handleAddCup = () => { setCupScanReturn({ page, accountCombined }); setPage('cup-scan'); };
  // Back from cup-scan → return to wherever "add a cup" was launched from.
  // From the combined Stores account that's the account page (still combined);
  // otherwise the store home.
  const handleCupScanBack = () => {
    const ret = cupScanReturn;
    setCupScanReturn(null);
    if (ret?.page === 'user') { setAccountCombined(!!ret.accountCombined); setPage('user'); return; }
    setPage('home');
  };

  // Open the account page as a COMBINED, group-wide view (from the Stores hub):
  // summed balance + activity across every store, each tagged with its store.
  const openCombinedAccount = () => {
    setAccountCombined(true);
    setCombinedHistory([]);
    setPage('user');
    const idId = identityIdRef.current;
    if (idId && groupCtx?.members?.length) {
      const nameById = {};
      groupCtx.members.forEach(m => { nameById[m.id] = m.name; });
      getGroupActivity(idId, nameById).then(setCombinedHistory).catch(() => setCombinedHistory([]));
    }
  };

  /* Phase 3: switch to another store in the group. Org identity is resolved
   * from the URL slug on load, so switching = navigating to that slug (a
   * clean re-bootstrap into the other venue's app, branding, and balance). */
  const handleSwitchStore = (member) => {
    if (member?.slug) window.location.href = `/${member.slug}/`;
  };

  // In-app browser sheet (Android): reopen the still-unclaimed deeplink in
  // the phone's default browser via an Android intent URL, carrying the
  // ?batch param so the claim lands on the real-browser account.
  const handleOpenInDefaultBrowser = () => {
    track(EVENTS.OPEN_IN_DEFAULT_BROWSER, { platform: inAppClaim?.platform });
    setInAppRedirecting(true);
    try {
      const href = window.location.href; // param was deliberately kept
      if (inAppClaim?.platform === 'ios') {
        // iOS can't be force-redirected reliably. Best-effort: the
        // x-safari- scheme opens Safari from some in-app browsers; if it's
        // ignored the sheet stays with manual "tap ••• → Open in Safari"
        // guidance + "Collect here anyway", so nothing is made worse.
        window.location.href = 'x-safari-' + href;
      } else {
        const u = new URL(href);
        window.location.href =
          `intent://${u.host}${u.pathname}${u.search}` +
          `#Intent;scheme=https;action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;end`;
      }
    } catch (e) {
      console.warn('open-in-browser failed:', e);
    }
  };
  // Fallback / explicit choice: claim right here (in the webview). Never
  // loses the cup; also covers a mis-detected normal browser.
  const handleCollectHere = () => {
    track(EVENTS.COLLECT_HERE_ANYWAY);
    const parsed = inAppClaim?.parsed;
    setInAppClaim(null);
    setInAppRedirecting(false);
    window.history.replaceState({}, '', window.location.pathname);
    if (parsed) setTimeout(() => handleCupScan(parsed, { scanType: 'deeplink' }, userId), 50);
  };
  const handleWithdraw = () => setDirectRefundOpen(true);

  /* ── Direct refund ── */
  const handleDirectRefundConfirm = () => {
    const count = cupCount;
    // C.2: use the venue's CONFIGURED refund rate for the analytics figure, the
    // history label, AND the stored payout amount — not a hardcoded €1.00. The
    // on-screen sheet already showed this rate, so the amount paid now matches
    // what the customer saw (was a 2.5× overpay at a €0.40 BYO venue).
    const refundRate = liveSettings.refundRatePerCup ?? 1.00;
    const amount = Number((count * refundRate).toFixed(2));
    track(EVENTS.WITHDRAW_ALL_CUPS, { cups_withdrawn: count, deposit_value: amount.toFixed(2) });
    const label = `Direct refund: ${count} cup${count !== 1 ? 's' : ''}, €${amount.toFixed(2)}`;
    addHistory('cups_withdrawn', label);
    setRefundCupCount(count);
    setRefundAmount(amount);
    setCupCount(0);
    setClaimed(false);
    setDirectRefundOpen(false);
    setPage('refund-success');

    if (userId) {
      persist(
        updateCupBalance(userId, 0),
        createClaim(userId, { type: 'direct_refund', cupsRedeemed: count, payoutAmount: amount, orgId: activeOrg?.id }),
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
  const handleClaim = async () => {
    if (!(await ensureRewardBudgetOk())) return;
    track(EVENTS.REWARD_CLAIM_ATTEMPTED, {
      reward_id: selectedRewardId,
      reward_name: selectedReward.name,
      cup_count: cupCount,
    });
    // A verified email is REQUIRED to claim cashback (that's how we pay it out
    // and reach the customer). No email yet → open the sign-in sheet; once the
    // email verifies we continue straight to the receipt step (onVerified).
    if (!(authEmail || profile?.email)) {
      setClaimAfterSignIn(true);
      setShowSignIn(true);
      return;
    }
    // No IBAN step anymore — go straight to the receipt scan. Cashback is
    // paid via a Tikkie link after the claim is reviewed.
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
          "We couldn't reach the verification service. Your cups have not been used. Please try again in a moment.",
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
    // Same email gate as the main claim button.
    if (!(authEmail || profile?.email)) {
      setDetailReward(null);
      setClaimAfterSignIn(true);
      setShowSignIn(true);
      return;
    }
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
    // Phase 3 BYO counter QR: this QR carries no cup UUIDs — it's credited by
    // the byo-mint edge function (always +1, up to the per-store daily cap).
    // Re-enter the stationary-QR flow on the CURRENT origin using only the
    // store-slug path, so it works on any domain (localhost, vercel, or
    // perks.packback.app) regardless of the domain baked into the QR. The
    // reload lets init resolve the store + mint via the proven ?byo path.
    if (parsed?.byo) {
      track(EVENTS.CUP_ADDED);
      setDidEngage(true);
      const path = (parsed.byoPath && parsed.byoPath !== '/')
        ? parsed.byoPath
        : (activeOrg?.slug ? `/${activeOrg.slug}/` : '/');
      window.location.href = `${path}?byo=1`;
      return;
    }
    track(EVENTS.CUP_ADDED);
    setDidEngage(true); // any scan attempt (even an already-claimed one) = a real user
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
          ? `Cup collected at ${brand}`
          : `${result.activatedCount} cups collected at ${brand}`;
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
    return <CupScanPage onScan={handleCupScan} onBack={handleCupScanBack} />;
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
      // D.10: scan EVERY `check_*` node that failed with a reason, instead of a
      // hardcoded Burger-King-specific list. The old list included
      // `check_is_authentic_burger_king`, so on a non-BK org an authenticity
      // rejection never surfaced its real reason. `check_is_receipt` is tried
      // first (most fundamental), then any other failed check.
      if (v.check_is_receipt?.passed === false && v.check_is_receipt?.reason) {
        return v.check_is_receipt.reason;
      }
      for (const k of Object.keys(v)) {
        if (!k.startsWith('check_')) continue;
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
        onDone={handleSuccessDone}
        aiStatus={aiVerdict?.status}
        userName={profile?.displayName}
        userEmail={profile?.email || authEmail}
        claimId={lastClaimId}
        onAddEmail={() => setShowSignIn(true)}
      />
    );
  }

  if (page === 'refund-success') {
    return (
      <RefundSuccessPage
        cupCount={refundCupCount}
        amount={refundAmount}
        userEmail={profile?.email || authEmail}
        onDone={() => { setPage('home'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
      />
    );
  }

  if (page === 'stores') {
    // Enrich each group member with this person's balance + the store's
    // featured reward and location for the redesigned Stores hub.
    const storeCards = (groupCtx?.members || []).map(m => ({
      id: m.id,
      name: m.name,
      slug: m.slug,
      brand_color: m.brand_color,
      logo_url: m.logo_url,
      balance: m.id === activeOrg?.id ? cupCount : (groupBalances[m.id]?.balance || 0),
      featured: groupStores[m.id]?.featured || null,
      rewards: groupStores[m.id]?.rewards || [],
      location: groupStores[m.id]?.location || null,
    }));
    const groupSlug = groupCtx?.group?.slug;
    // Total cups this person has collected across the group (lifetime), for
    // the plastic-avoided impact panel.
    const personalCups = Object.values(groupBalances).reduce((sum, b) => sum + (b?.lifetime || 0), 0);
    // Region drives the curated "coming soon" venue list; admins can hide those
    // via the group setting (default on).
    const storesRegion = /uae|dubai|emirat|abu\s*dhabi/i.test(`${groupCtx?.group?.slug || ''} ${groupCtx?.group?.name || ''}`) ? 'UAE' : 'NL';
    const showNotYetStores = groupCtx?.groupConfig?.settings?.showNotYetStores !== false;
    return (
      <>
        <StoresPage
          group={groupCtx?.group}
          intro={groupCopy?.storesIntro}
          stores={storeCards}
          personalCups={personalCups}
          region={storesRegion}
          showNotYet={showNotYetStores}
          notYetStores={groupCtx?.groupConfig?.settings?.notYetVendors || null}
          notYetThreshold={groupCtx?.groupConfig?.settings?.notYetThreshold || 10}
          onRequestStore={(s) => track('store_requested', { name: s?.name, area: s?.area, region: storesRegion })}
          onSelectStore={(store) => {
            // Open the store within the group: /<groupSlug>/<orgSlug>.
            if (groupSlug && store?.slug) window.location.href = `/${groupSlug}/${store.slug}`;
            else handleSwitchStore(store);
          }}
          onOpenAccount={openCombinedAccount}
          onOpenGuide={() => setHowItWorksOpen(true)}
          onScanCup={() => setPage('cup-scan')}
        />
        {howItWorksOpen && (
          <HowItWorks
            steps={guideSteps}
            onClose={() => setHowItWorksOpen(false)}
            onComplete={() => setHiwSeen(true)}
          />
        )}
      </>
    );
  }

  // Shared donate sheet — both the account page and the store/home page open
  // it via donateSheetOpen (the reward sheet's "Donate my cups" CTA opens it
  // on the store page). Defined once so either return renders the same sheet.
  const donateSheetNode = liveSettings.featureDonations ? (
    <DonateSheet
      open={donateSheetOpen}
      orgName={activeOrg?.partner_brand_name || activeOrg?.name}
      onClose={(cupsToDonate) => {
        setDonateSheetOpen(false);
        // Clamp so a stale cupsToDonate can't overdraw or fabricate history.
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
            addDonationClaim(userId, actual, actual * (liveSettings.refundRatePerCup || 1.00), activeOrg?.id),
          );
        }
      }}
      cupCount={cupCount}
    />
  ) : null;

  /* The sign-in / add-email sheet. Rendered on BOTH the account page and the
   * home/store page so that a claim from the store (which requires a verified
   * email) can actually open it — previously it lived only on the account page,
   * so tapping "Get cashback" without an email did nothing. */
  const signInSheetNode = (
    <SignInSheet
      open={showSignIn}
      onClose={() => { setShowSignIn(false); setClaimAfterSignIn(false); }}
      onLinked={async () => {
        try {
          const refreshed = await getOrCreateUser(activeOrg?.id);
          setUserId(refreshed.id);
        } catch (e) { console.error(e); }
      }}
      /* Fired the moment the email is verified. If the user was mid-claim
         (no email when they tapped "Get cashback"), continue straight to the
         receipt step now that they're verified. */
      onVerified={() => {
        if (claimAfterSignIn) {
          setClaimAfterSignIn(false);
          setShowSignIn(false);
          setDetailReward(null);
          setPage('receipt');
        }
      }}
      /* Email verification is ALWAYS required — every email (first time or
         changed) must be confirmed with the 6-digit code we email. */
      requireVerification={true}
      savedEmail={profile?.email || authEmail || null}
      onMarketingConsent={(consent) =>
        handleSaveProfile({ marketingConsent: consent, marketingConsentSource: 'signin_popup' })
      }
      __devStatus={shot?.signInStatus || null}
      __devEmail={shot?.signInEmail || null}
    />
  );

  if (page === 'user') {
    // Combined (from-Stores) account view: sum balances + merge activity
    // across every store in the group.
    const combinedBalance = Object.values(groupBalances).reduce((s, b) => s + (b?.balance || 0), 0);
    // Value the combined balance store-by-store: each org has its OWN €/cup
    // rate, so we can't just multiply the total cups by a single rate.
    const combinedCashback = Object.entries(groupBalances).reduce((s, [orgId, b]) => {
      const rate = groupStores[orgId]?.cashbackRate ?? (liveSettings.cashbackRatePerCup || 1.25);
      return s + (b?.balance || 0) * rate;
    }, 0);
    const acctCombined = accountCombined && !!groupCtx;
    return (
      <div className="app">
        <UserPage
          profile={profile}
          onSaveProfile={handleSaveProfile}
          cupCount={acctCombined ? combinedBalance : cupCount}
          cashbackRate={liveSettings.cashbackRatePerCup}
          cashbackTotal={acctCombined ? combinedCashback : undefined}
          history={acctCombined ? combinedHistory : history}
          combined={acctCombined}
          storeName={acctCombined ? null : (activeOrg?.partner_brand_name || activeOrg?.name)}
          privacyPolicy={liveSettings.privacyPolicyText}
          userClaims={userClaims}
          rewards={liveRewards}
          authEmail={authEmail}
          onOpenSignIn={() => setShowSignIn(true)}
          onAddCup={handleAddCup}
          isVisitor={isVisitor}
          onWithdraw={showRefund ? handleWithdraw : null}
          onOpenShare={showShare ? () => setShareSheetOpen(true) : null}
          onOpenNextCupFree={showNextCupFree ? () => setShareSheetOpen(true) : null}
          onOpenDonate={showDonate ? () => setDonateSheetOpen(true) : null}
          showActivity={showActivity}
          showImpact={showImpact}
          lifetimeCups={lifetimeCups}
          copy={effDesignCopy}
          onRefreshClaims={async () => {
            // Re-pull claims when user lands on the activity tab — that's when
            // they'd notice an admin status change. Cheap enough to do eagerly.
            if (userId) {
              try { setUserClaims(await getMyClaims(userId)); } catch (e) { console.error(e); }
            }
          }}
          onClose={() => {
            // From the combined (Stores) view, go back to the Stores hub;
            // otherwise back to this store's home.
            if (acctCombined && groupCtx?.group?.slug) { window.location.href = `/${groupCtx.group.slug}`; return; }
            setAccountCombined(false);
            setPage('home');
          }}
          onOpenHowItWorks={() => setHowItWorksOpen(true)}
        />
        {signInSheetNode}
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
        {donateSheetNode}
        {howItWorksOpen && <HowItWorks steps={guideSteps} onClose={() => setHowItWorksOpen(false)} onComplete={() => setHiwSeen(true)} />}
      </div>
    );
  }

  return (
    <div className="app">
      {/* Android in-app browser hit a cup deeplink — offer to open in the
          default browser before the cup strands in a throwaway account. */}
      <InAppBrowserSheet
        open={!!inAppClaim}
        platform={inAppClaim?.platform}
        redirecting={inAppRedirecting}
        onOpenDefaultBrowser={handleOpenInDefaultBrowser}
        onCollectHere={handleCollectHere}
      />

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

      {/* Grouped org → a "back to all stores" affordance above everything. */}
      {groupCtx && (
        <button type="button" className="app__see-stores" onClick={() => { if (groupCtx?.group?.slug) window.location.href = `/${groupCtx.group.slug}`; else setPage('stores'); }}>
          <svg className="app__see-stores-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          See all stores
        </button>
      )}

      <Header
        cupCount={cupCount}
        onBadgeClick={() => { setAccountCombined(false); setPage('user'); }}
        onAddCup={handleAddCup}
        org={activeOrg}
        design={design}
        claimStatus={claimStatus}
      />

      <section className="app__hero">
        <h1 className="app__headline">{(heroHeadline || '').replace(/,\s*/g, ',\n')}</h1>
        <p className="app__subtext">{heroSubtext}</p>
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
        onExplain={() => setHowItWorksOpen(true)}
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
        />
      )}

      {howItWorksOpen && <HowItWorks steps={guideSteps} onClose={() => setHowItWorksOpen(false)} onComplete={() => setHiwSeen(true)} />}

      <BudgetPausedModal
        open={budgetPausedOpen}
        onClose={() => setBudgetPausedOpen(false)}
        title={liveSettings?.budgetPausedTitle}
        body={liveSettings?.budgetPausedBody}
      />

      {/* Donate sheet — opened from the claim UI as well as the account page. */}
      {donateSheetNode}

      <Modal open={termsOpen} onClose={() => setTermsOpen(false)} title="Cashback terms">
        {groupCopy ? (
          /* Grouped org: use the group's mode-sensitive terms (BYO drops all
           * deposit/return wording). */
          <>
            <p><strong>{groupCopy.terms.title}:</strong> {groupCopy.terms.intro}</p>
            <ul>
              {groupCopy.terms.points.map((pt, i) => <li key={i}>{pt}</li>)}
            </ul>
          </>
        ) : (
          <>
            <p><strong>How it works:</strong> Collect cups at any participating {activeOrg?.partner_brand_name || activeOrg?.name || 'partner'} venue. Scan the QR each time to add a cup to your balance for that venue.</p>
            <ul>
              <li>Collect enough cups to unlock a reward, then claim it as <strong>cashback</strong>.</li>
              <li>To claim, add and <strong>verify your email</strong> (we send a 6-digit code), then upload a clear photo of the <strong>printed store receipt</strong> for the reward item.</li>
              <li>We accept genuine printed store/till receipts that clearly show the reward item and are dated within the last 30 days.</li>
              <li>We <strong>can’t accept</strong> screenshots, photos of a screen, edited or AI-generated images, blurry or unreadable photos, receipts that don’t show the reward item, or receipts dated before you collected your cups. Each receipt can be used once.</li>
              <li>An automated check pre-screens your photo, but a person makes the final call. Once approved, we send a <strong>Tikkie link</strong> to collect your cashback yourself, usually within a few days, no later than 7. We never ask for your bank details; collect it promptly as links expire.</li>
              <li>Prefer not to take cashback? You can <strong>donate</strong> your cups to a good cause instead.</li>
              <li>Cups are saved separately at each venue, and you can switch your reward goal any time before claiming.</li>
            </ul>
            {liveSettings?.featureDirectRefunds && (
              <p><strong>Direct refund:</strong> If you would rather take a plain cash refund than a food reward, use &quot;Get the direct refund&quot;.</p>
            )}
          </>
        )}
        <button className="modal-btn" onClick={() => setTermsOpen(false)}>Got it</button>
      </Modal>

      {/* Phase 3 BYO: stationary-QR scan result. */}
      <Modal
        open={!!byoResult}
        onClose={() => setByoResult(null)}
        title={byoResult?.title || 'Hmm'}
      >
        <p>{byoResult?.body}</p>
        {byoResult?.crossOrg && (
          <div className="app__byo-crossorg">
            <strong>{byoResult.crossOrg.title}</strong>
            <span>{byoResult.crossOrg.body}</span>
          </div>
        )}
        <button className="modal-btn" onClick={() => setByoResult(null)}>Got it</button>
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
      {/* Also mount the sign-in / add-email sheet here so "Get cashback" without
          an email can open it from the store page (not just the account page). */}
      {signInSheetNode}
    </div>
  );
}
