import { useEffect, useRef, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { toJpeg } from 'html-to-image';
import './UserPage.css';
import cupIcon from '../assets/images/cup-icon.svg';
import { track, EVENTS } from '../utils/analytics';
import ActivityDetailModal from './ActivityDetailModal';
import PrivacyPolicyView from './PrivacyPolicyView';
import PendingClaims from './PendingClaims';
import { getGlobalImpact } from '../lib/api';
import { getCollectedMap, markClaimCollected } from '../lib/collectedClaims';
import { clearConsent } from '../lib/consent';
import { animalForProfile, generateProfile } from '../lib/animals';
import { usePwaInstall } from '../lib/pwa';
import { requestPushPermission, getPermissionState } from '../lib/notify';
import { useMoney } from '../lib/RegionContext';
import { getRegion, formatMoney } from '../lib/regions';
import { CO2_GRAMS_PER_CUP, NETWORK_BASE_CUPS, formatCo2 } from '../lib/impact';

const PUSH_PREF_KEY = 'packperks_push_rewards';

const DSAR_EMAIL = 'info@packback.network';
const AVATAR_KEY = 'packperks_profile_avatar';

/* Build timestamp, stamped at compile time by vite (see vite.config.js).
 * Shown subtly at the bottom of the profile so we can confirm which
 * deployed version is live (date + time + seconds, local time). */
const BUILD_STAMP = (() => {
  try {
    const iso = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : null;
    if (!iso) return null;
    return new Date(iso).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch {
    return null;
  }
})();

function getBrowserInfo() {
  const ua = navigator.userAgent;
  if (/Edg\/([\d.]+)/.test(ua)) return `Edge ${ua.match(/Edg\/([\d.]+)/)[1].split('.')[0]}`;
  if (/Firefox\/([\d.]+)/.test(ua)) return `Firefox ${ua.match(/Firefox\/([\d.]+)/)[1].split('.')[0]}`;
  if (/Chrome\/([\d.]+)/.test(ua)) return `Chrome ${ua.match(/Chrome\/([\d.]+)/)[1].split('.')[0]}`;
  if (/Version\/([\d.]+).*Safari/.test(ua)) return `Safari ${ua.match(/Version\/([\d.]+)/)[1].split('.')[0]}`;
  return 'Unknown Browser';
}

/* Mask an email so only the first + last letter of each part shows
 * (e.g. b••••••e@g•••l.com), for the default (hidden) view. */
function maskEmail(e) {
  if (!e || !e.includes('@')) return e || '';
  const mask = (s) => (s.length <= 2 ? (s[0] || '') + '•' : s[0] + '•'.repeat(Math.max(1, s.length - 2)) + s[s.length - 1]);
  const [local, domain] = e.split('@');
  const dot = domain.lastIndexOf('.');
  if (dot < 1) return `${mask(local)}@${mask(domain)}`;
  return `${mask(local)}@${mask(domain.slice(0, dot))}${domain.slice(dot)}`;
}

export default function UserPage({
  profile,
  onSaveProfile,
  cupCount,
  cashbackRate = 1.25,
  history,
  userClaims = [],
  rewards = [],
  authEmail = null,
  notifyOnApproval = true,
  onToggleNotify,
  region = 'NL',
  availableRegions = [],
  onChangeRegion,
  onOpenSignIn,
  onAddCup,
  isVisitor = false,
  onWithdraw,
  onShareCup,
  onOpenShare,
  onOpenNextCupFree,
  onOpenDonate,
  // Per-org design overrides — drive section visibility + button copy.
  showActivity = true,
  showImpact = true,
  lifetimeCups = 0,
  copy = {},
  onRefreshClaims,
  onClose,
  onOpenHowItWorks,
  // Phase 3: "general" account view opened from the Stores hub — cupCount is
  // the SUM across every store, history is combined + tagged with a store name.
  combined = false,
  combinedNote,
  // Pre-summed € total for a combined balance, valued per store (orgs can have
  // different €/cup rates). When provided, it overrides cupCount × cashbackRate.
  cashbackTotal,
  // Combined cashback split per region: [{ region, amount }]. When the group
  // spans more than one currency we render a subtotal per currency instead of
  // one (meaningless) mixed-currency number.
  cashbackByRegion,
  // The active store's name — used for the per-store balance caption.
  storeName,
  // Admin-editable privacy policy text (falls back to the bundled default).
  privacyPolicy,
  // Secret: tapping the build stamp 3× re-opens the onboarding flow.
  onReopenOnboarding,
}) {
  // Refresh claim status when the user enters this page — admin approvals
  // that happened while the user wasn't looking get pulled in automatically.
  useEffect(() => { onRefreshClaims?.(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const money = useMoney();

  // Secret re-open: three taps on the version within ~1.2s reopens onboarding.
  const versionTaps = useRef({ n: 0, t: null });
  const bumpVersion = () => {
    if (!onReopenOnboarding) return;
    const s = versionTaps.current;
    s.n += 1;
    clearTimeout(s.t);
    s.t = setTimeout(() => { s.n = 0; }, 1200);
    if (s.n >= 3) { s.n = 0; clearTimeout(s.t); onReopenOnboarding(); }
  };

  // Enrich claims with a human-readable reward name so the modal can match
  // them against the activity_history label ("Claimed: Chicken Sandwich").
  const enrichedClaims = userClaims.map(c => {
    const reward = rewards.find(r => r.id === c.reward_id);
    return { ...c, rewardName: reward?.name || 'Cashback reward', rewardImage: reward?.image || null, rewardBg: reward?.bgColor || null };
  });
  // Claims whose Tikkie CTA has been tapped once — hidden from the pending
  // block (but kept in Activity). Persisted in localStorage.
  const [collectedClaims, setCollectedClaims] = useState(() => getCollectedMap());
  const handleCollectClaim = (claim) => {
    if (!claim?.id) return;
    markClaimCollected(claim.id);
    setCollectedClaims({ ...getCollectedMap() });
  };

  // ── PWA install + reward push-notification preference ──
  // The "Add to home screen" button disappears once the app is installed; a
  // "push notifications" toggle then appears in Edit profile (push only works
  // from the installed app, so it's meaningless before install).
  const pwa = usePwaInstall();
  const [iosInstallHint, setIosInstallHint] = useState(false);
  const [pushRewards, setPushRewards] = useState(() => {
    try { return localStorage.getItem(PUSH_PREF_KEY) === '1' && getPermissionState() === 'granted'; }
    catch { return false; }
  });
  const handleAddToHome = async () => {
    // 1) Chrome / Edge / Android: fire the real one-tap install prompt.
    const outcome = await pwa.promptInstall();
    if (outcome !== 'unavailable') return;
    // 2) iOS Safari (and others with no install API): open the OS share sheet,
    //    where the user can pick "Add to Home Screen". Apple exposes no JS
    //    install API, so this is the closest we can trigger programmatically.
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: 'PackPerks',
          text: 'Save your cups by adding PackPerks to your home screen.',
          url: window.location.origin,
        });
        return;
      } catch { /* user dismissed / not permitted → fall through to steps */ }
    }
    // 3) No prompt and no share (Firefox / in-app browsers): show manual steps.
    setIosInstallHint(v => !v);
  };
  const handleTogglePush = async (checked) => {
    if (!checked) {
      setPushRewards(false);
      try { localStorage.setItem(PUSH_PREF_KEY, '0'); } catch { /* ignore */ }
      return;
    }
    const perm = await requestPushPermission();
    const on = perm === 'granted';
    setPushRewards(on);
    try { localStorage.setItem(PUSH_PREF_KEY, on ? '1' : '0'); } catch { /* ignore */ }
  };

  const [email, setEmail] = useState(profile.email || '');
  const [emailSaved, setEmailSaved] = useState(!!profile.email);
  const [isEditingEmail, setIsEditingEmail] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [isEditingName, setIsEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState('');

  /* The old floating "Save your cups" banner is gone — its prompt now lives
   * inline on the Email row below: when no email is saved the row itself is an
   * "Add email" action that opens the standard add-email popup (SignInSheet),
   * and the account card at the bottom carries the same "save across devices"
   * message. One consistent entry point instead of a separate banner. */

  // Email is masked (first + last letter) by default; tap to reveal in full.
  const [emailRevealed, setEmailRevealed] = useState(false);
  // Keep the local email fields in sync with the profile (e.g. after the
  // add-email popup saves it) — but never clobber what the user is typing.
  useEffect(() => {
    if (isEditingEmail) return;
    setEmail(profile.email || '');
    setEmailSaved(!!profile.email);
  }, [profile.email, isEditingEmail]);

  const [activeActivity, setActiveActivity] = useState(null);
  // Impact-detail modal — opens when the customer taps the Your-impact
  // card. Fetches community totals lazily on open so we don't pay the
  // round-trip cost for users who never tap it.
  const [impactOpen, setImpactOpen] = useState(false);

  // Share sheet: lifted to App.jsx — call prop to open it

  const animal = animalForProfile(profile);
  const browserInfo = useMemo(() => getBrowserInfo(), []);

  // Optional uploaded profile photo (overrides the emoji avatar). Kept on this
  // device (localStorage) so it needs no storage bucket; downscaled on upload.
  const [avatarUrl, setAvatarUrl] = useState(() => { try { return localStorage.getItem(AVATAR_KEY) || null; } catch { return null; } });
  const [editOpen, setEditOpen] = useState(false);

  const handleUploadAvatar = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const size = 200;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d');
        const s = Math.min(img.width, img.height);
        ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
        const url = canvas.toDataURL('image/jpeg', 0.82);
        try { localStorage.setItem(AVATAR_KEY, url); } catch { /* quota */ }
        setAvatarUrl(url);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  };
  const handleRemoveAvatar = () => {
    try { localStorage.removeItem(AVATAR_KEY); } catch { /* ignore */ }
    setAvatarUrl(null);
  };

  const saveProfile = (updated) => {
    onSaveProfile(updated);
  };

  // ── Data & privacy controls (GDPR items 13, 19, 21) ──
  const [policyOpen, setPolicyOpen] = useState(false);
  const handleManageCookies = () => { clearConsent(); window.location.reload(); };
  const handleResetDevice = () => {
    if (!window.confirm('Reset this device? Your cups stay safe in your account, but this browser will forget your local data and sign out.')) return;
    try { localStorage.clear(); } catch { /* ignore */ }
    window.location.reload();
  };
  const dsar = (subject, extra = '') => {
    const body = `Please handle the request below for my PackPerks account.\n\nDisplay name: ${profile.displayName}\n${email ? 'Email: ' + email : 'Email: (none saved)'}\n${extra}`;
    window.location.href = `mailto:${DSAR_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };
  const handleExportData = () => dsar('PackPerks: export my data (access request)');
  const handleDeleteAccount = () => {
    if (!window.confirm('Delete your account and personal data? This clears your saved email now and requests full erasure. Your cups will be removed. This cannot be undone.')) return;
    // Best-effort immediate scrub of identifiable data on this account.
    saveProfile({ email: '' });
    dsar('PackPerks: delete my account (erasure request)', 'I want my account and all associated personal data deleted.');
  };

  const handleRegenerate = () => {
    track(EVENTS.NAME_REGENERATED);
    const fresh = generateProfile();
    saveProfile({ displayName: fresh.displayName, animalIndex: fresh.animalIndex });
    return fresh;
  };

  const handleEditName = () => {
    track(EVENTS.NAME_EDIT_OPENED);
    setEditNameValue(profile.displayName);
    setIsEditingName(true);
  };

  const handleSaveName = () => {
    const trimmed = editNameValue.trim();
    if (trimmed) saveProfile({ displayName: trimmed });
    setIsEditingName(false);
  };

  const handleShare = () => {
    track(EVENTS.SHARE_CUP);
    onOpenShare?.();
  };

  return (
    <div className="user-page">

      {/* ── Back header ── */}
      <header className="user-page__header">
        <button className="user-page__back" onClick={onClose} aria-label="Go back">
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
            <path d="M13 4L7 10L13 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Back
        </button>
        <span className="user-page__title">My Account</span>
        <div className="user-page__header-spacer" />
      </header>

      {/* ── Profile card — avatar + identity in one row; Edit opens the
            details modal (name, photo, email, prefs). ── */}
      <div className="user-page__card user-page__profile-card">
        <button
          type="button"
          className="user-page__edit-chip"
          onClick={() => setEditOpen(true)}
          aria-label="Edit profile"
        >
          <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M13.586 3.586a2 2 0 1 1 2.828 2.828L6 16.828 2 18l1.172-4L13.586 3.586z"/>
          </svg>
          Edit
        </button>

        <div className="user-page__profile-row">
          <div className="user-page__profile-avatar" style={avatarUrl ? undefined : { background: animal.bg }}>
            {avatarUrl
              ? <img src={avatarUrl} alt="" className="user-page__profile-avatar-img" />
              : <span className="user-page__profile-avatar-emoji" role="img" aria-label={animal.name}>{animal.emoji}</span>}
          </div>
          <div className="user-page__profile-details">
            <span className="user-page__profile-name">{profile.displayName}</span>
            {(email || authEmail) ? (
              <span className="user-page__profile-email">{email || authEmail}</span>
            ) : (
              <button type="button" className="user-page__profile-email user-page__profile-email--add" onClick={onOpenSignIn}>
                Add email to save balance
              </button>
            )}
            <span className="user-page__profile-device">{[profile.phone, browserInfo].filter(Boolean).join(', ')}</span>
          </div>
        </div>
      </div>

      {/* ── Visitor nudge ── shown until they bank their first cup (or take
            any real action). Small "Visitor" badge + a big add-first-cup CTA. */}
      {isVisitor && onAddCup && (
        <div className="user-page__visitor">
          <span className="user-page__visitor-badge">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" /><circle cx="12" cy="12" r="3" />
            </svg>
            Visitor
          </span>
          <h3 className="user-page__visitor-title">Get started</h3>
          <p className="user-page__visitor-sub">Two ways to begin</p>
          <div className="user-page__visitor-ctas">
            {onOpenSignIn && (
              <button type="button" className="user-page__visitor-cta" onClick={onOpenSignIn}>
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" />
                </svg>
                Add your email
              </button>
            )}
            {onOpenSignIn && <span className="user-page__visitor-or">OR</span>}
            <button type="button" className="user-page__visitor-cta user-page__visitor-cta--alt" onClick={onAddCup}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add your first cup
            </button>
          </div>
        </div>
      )}

      {/* ── Cups ⇄ value box ── cups on the left, euro equivalent on the
            right, with a subtle "≈" between (mirrors the refund compare box). */}
      <div className="user-page__value-box">
        {(combined || storeName) && (
          <p className="user-page__value-note">
            {combined
              ? (combinedNote || 'Total across all your stores combined.')
              : `Your balance at ${storeName}.`}
          </p>
        )}
        <div className="user-page__value-row">
          <div className="user-page__value-option">
            <span className="user-page__value-num">
              <img src={cupIcon} alt="" width="22" height="22" />
              {cupCount}
            </span>
            <span className="user-page__value-label">cup{cupCount !== 1 ? 's' : ''} collected</span>
          </div>
          <span className="user-page__value-approx" aria-label="approximately">≈</span>
          <div className="user-page__value-option user-page__value-option--right">
            {Array.isArray(cashbackByRegion) && cashbackByRegion.length > 1 ? (
              // Group spans multiple currencies — never add € and AED together.
              // Show a subtotal per currency, stacked.
              <span className="user-page__value-num user-page__value-num--euro user-page__value-num--multi">
                {cashbackByRegion.map((c) => (
                  <span key={c.region} className="user-page__value-cur">{formatMoney(c.amount, c.region)}</span>
                ))}
              </span>
            ) : (
              <span className="user-page__value-num user-page__value-num--euro">
                {money(cashbackTotal != null ? cashbackTotal : cupCount * (cashbackRate ?? 1.25))}
              </span>
            )}
            <span className="user-page__value-label">in cashback</span>
          </div>
        </div>

        {/* ── Cup actions — nested inside the balance box ── */}
        <div className="user-page__actions">

        {onOpenShare && (
          <button className="user-page__action-btn" onClick={handleShare}>
            <svg width="15" height="13" viewBox="0 0 15 13" fill="none">
              <path d="M7.5 12.5L1.5 6.5C0 5 0 2.5 1.5 1.5C3 0.5 5 0.5 6.5 2L7.5 3L8.5 2C10 0.5 12 0.5 13.5 1.5C15 2.5 15 5 13.5 6.5L7.5 12.5Z" fill="var(--pb-red)"/>
            </svg>
            {copy.shareButtonLabel || 'Share your Cup'}
          </button>
        )}

        <button className="user-page__action-btn" onClick={onAddCup}>
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
            <line x1="10" y1="3" x2="10" y2="17" stroke="black" strokeWidth="2" strokeLinecap="round"/>
            <line x1="3" y1="10" x2="17" y2="10" stroke="black" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          Add more cups
        </button>

        {onOpenNextCupFree && (
          <button className="user-page__action-btn user-page__action-btn--free" onClick={onOpenNextCupFree}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="8" width="18" height="4" rx="1" />
              <path d="M12 8v13" />
              <path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7" />
              <path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5" />
            </svg>
            {copy.nextCupFreeLabel || 'Next cup for free'}
          </button>
        )}

        {onOpenDonate && (
          <button className="user-page__action-btn user-page__action-btn--donate" onClick={onOpenDonate}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m12 10 2 4v3a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-3a8 8 0 1 0-16 0v3a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-3l2-4h4Z" />
              <path d="M4.82 7.9 8 10" />
              <path d="M15.18 7.9 12 10" />
              <path d="M16.93 10H20a2 2 0 0 1 0 4H2" />
            </svg>
            {copy.donateButtonLabel || 'Donate'}
          </button>
        )}

        </div>
      </div>

      <PendingClaims claims={enrichedClaims} collectedMap={collectedClaims} onCollect={handleCollectClaim} />

      {/* ── Info + install section: "How does it work?" plus an "Add to home
           screen" button that installs the app like a native one. The install
           button disappears once the app is installed. No section title. ── */}
      {(onOpenHowItWorks || !pwa.installed) && (
        <div className="user-page__howto-group">
          {onOpenHowItWorks && (
            <button type="button" className="user-page__howto" onClick={() => { track(EVENTS.HOWTO_OPENED); onOpenHowItWorks?.(); }}>
              <span className="user-page__howto-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M9.3 9.2a2.8 2.8 0 0 1 5.3 1c0 1.9-2.6 2.2-2.6 3.6" />
                  <line x1="12" y1="17.4" x2="12.01" y2="17.4" />
                </svg>
              </span>
              <span className="user-page__howto-text">
                <span className="user-page__howto-title">How does it work?</span>
              </span>
              <svg className="user-page__howto-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="9 6 15 12 9 18" />
              </svg>
            </button>
          )}

          {!pwa.installed && (
            <button type="button" className="user-page__howto user-page__howto--install" onClick={handleAddToHome} aria-expanded={iosInstallHint}>
              <span className="user-page__howto-icon user-page__howto-icon--install">
                {/* phone + downward arrow → "install to your phone" */}
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
                  <path d="M12 7.5v6" />
                  <path d="M9.4 11l2.6 2.6L14.6 11" />
                  <line x1="10.5" y1="18.5" x2="13.5" y2="18.5" />
                </svg>
              </span>
              <span className="user-page__howto-text">
                <span className="user-page__howto-title">Add to home screen to save</span>
                {iosInstallHint && (
                  <span className="user-page__howto-sub">
                    In your browser menu, tap <strong>Share</strong> then <strong>Add to Home Screen</strong>.
                  </span>
                )}
              </span>
              <svg className="user-page__howto-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="9 6 15 12 9 18" />
              </svg>
            </button>
          )}
        </div>
      )}

      {/* Save-your-cups prompt now lives inline on the Email row below
          (the empty-email state is an "Add email" action) — no separate banner. */}

      {/* Account details (name, photo, email, marketing) now live in the
          profile-card Edit modal — rendered near the end of this component. */}

      {/* ── Lifetime impact card ──
       * Sits ABOVE the activity feed (sustainability angle is more
       * motivating than a chronological log) and BELOW the action
       * grid (rewards still come first). Clickable — opens a detail
       * modal with community totals + a shareable image. */}
      {showImpact && lifetimeCups > 0 && (
        <div className="user-page__history">
          <span className="user-page__section-title">Your impact</span>
          <button
            type="button"
            className="user-page__card user-page__card--list user-page__impact-card"
            onClick={() => setImpactOpen(true)}
            aria-label="See your detailed impact"
          >
            <ImpactSummary cups={lifetimeCups} />
          </button>
        </div>
      )}

      {/* ── Activity ── visibility gated by per-org design.sections.showActivity */}
      {showActivity && (
      <div className="user-page__history">
        <span className="user-page__section-title">{copy.activityLabel || 'Activity'}</span>
        {history.length === 0 ? (
          !authEmail ? (
            <div className="user-page__history-empty user-page__history-empty--signin">
              <span>Your activity is linked to your account.</span>
              {onOpenSignIn && (
                <button
                  type="button"
                  className="user-page__history-signin-btn"
                  onClick={onOpenSignIn}
                >
                  Sign in to see your history
                </button>
              )}
            </div>
          ) : (
            <span className="user-page__history-empty">No activity yet. Start by scanning a counter QR!</span>
          )
        ) : (
          <div className="user-page__card user-page__card--list user-page__history-scroll">
            {[...history].reverse().map((item, idx) => (
              <div key={idx}>
                {idx > 0 && <div className="user-page__divider" />}
                <button
                  className="user-page__history-item user-page__history-item--clickable"
                  onClick={() => setActiveActivity(item)}
                  type="button"
                >
                  <div className={`user-page__history-dot user-page__history-dot--${item.type}`}>
                    {item.type === 'cup_added' && (
                      <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
                        <line x1="10" y1="4" x2="10" y2="16" stroke="#1A8737" strokeWidth="2.5" strokeLinecap="round"/>
                        <line x1="4" y1="10" x2="16" y2="10" stroke="#1A8737" strokeWidth="2.5" strokeLinecap="round"/>
                      </svg>
                    )}
                    {item.type === 'reward_claimed' && (
                      <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
                        <path d="M4 10L8 14L16 6" stroke="#FEA01E" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                    {item.type === 'cups_withdrawn' && (
                      <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
                        <line x1="4" y1="10" x2="16" y2="10" stroke="#FD6F46" strokeWidth="2.5" strokeLinecap="round"/>
                      </svg>
                    )}
                    {/* Cup shared with a friend — paper-plane glyph,
                     *  PackBack purple to differentiate from the green
                     *  "earned" / orange "spent" axes. */}
                    {item.type === 'cups_shared' && (
                      <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
                        <path d="M18 2L9 11" stroke="#5333A5" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M18 2L13 18L9 11L2 7L18 2Z" stroke="#5333A5" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                    {/* Cups donated — heart glyph in BK yellow to
                     *  read as "warm act, not money out". */}
                    {item.type === 'cups_donated' && (
                      <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
                        <path d="M10 17s-6-4-6-9a3.5 3.5 0 0 1 6-2.5A3.5 3.5 0 0 1 16 8c0 5-6 9-6 9z" stroke="#B8922A" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </div>
                  <div className="user-page__history-text">
                    <span className="user-page__history-label">{item.label}</span>
                    <span className="user-page__history-time">
                      {item.storeName && <span className="user-page__history-store">{item.storeName}</span>}
                      {item.time}
                    </span>
                  </div>
                  <svg className="user-page__history-chevron" width="14" height="14" viewBox="0 0 20 20" fill="none">
                    <path d="M7 4L13 10L7 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      )}

      {/* The Account (email management) + Marketing-emails toggle now live
          in a single consolidated list card at the very bottom of the page,
          just before the footer — see below. */}

      {activeActivity && (
        <ActivityDetailModal
          item={activeActivity}
          profile={profile}
          userClaims={enrichedClaims}
          onClose={() => setActiveActivity(null)}
        />
      )}

      {impactOpen && (
        <ImpactDetailModal
          cups={lifetimeCups}
          profile={profile}
          onClose={() => setImpactOpen(false)}
        />
      )}

      {/* ── Data & privacy control (GDPR items 13, 19, 21) ── */}
      <div className="user-page__history">
        <span className="user-page__section-title">Data &amp; privacy</span>
        <div className="user-page__card user-page__card--list">
          {[
            { label: 'Privacy & cookie policy', on: () => setPolicyOpen(true) },
            { label: 'Manage cookie choices', on: handleManageCookies },
            { label: 'Export my data', on: handleExportData },
            { label: 'Reset this device', on: handleResetDevice },
            { label: 'Delete my account', on: handleDeleteAccount, danger: true },
          ].map((row, i) => (
            <div key={row.label}>
              {i > 0 && <div className="user-page__divider" />}
              <button
                type="button"
                className={`user-page__data-row${row.danger ? ' user-page__data-row--danger' : ''}`}
                onClick={row.on}
              >
                <span>{row.label}</span>
                <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M7 4L13 10L7 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          ))}
        </div>
        <p className="user-page__data-note">
          You can view, export, correct or delete your data at any time. Requests are handled at{' '}
          <strong>{DSAR_EMAIL}</strong>. Cups you’ve already earned stay in your account until you delete it.
        </p>
      </div>

      {policyOpen && <PrivacyPolicyView text={privacyPolicy} onClose={() => setPolicyOpen(false)} />}

      {editOpen && (
        <ProfileEditModal
          profile={profile}
          animal={animal}
          avatarUrl={avatarUrl}
          email={email || authEmail}
          hasEmail={!!(email || authEmail)}
          marketingConsent={profile.marketingConsent}
          notifyOnApproval={notifyOnApproval}
          onToggleNotify={onToggleNotify}
          region={region}
          availableRegions={availableRegions}
          onChangeRegion={onChangeRegion}
          pwaInstalled={pwa.installed}
          pushRewards={pushRewards}
          onTogglePush={handleTogglePush}
          browserInfo={browserInfo}
          onClose={() => setEditOpen(false)}
          onSaveName={(name) => saveProfile({ displayName: name })}
          onRegenerate={handleRegenerate}
          onUploadAvatar={handleUploadAvatar}
          onRemoveAvatar={handleRemoveAvatar}
          onManageEmail={() => { setEditOpen(false); onOpenSignIn?.(); }}
          onToggleMarketing={(checked) => onSaveProfile({ marketingConsent: checked, marketingConsentSource: 'app_profile' })}
        />
      )}

      {/* ── Footer ── */}
      {/* (ImpactCard helper component is declared at module scope below
           so the JSX above can render it inline.) */}
      <footer className="user-page__footer">
        {/* Privacy / cookie policy links live in the Data & privacy section
            above — no separate legal footer needed. */}
        {onWithdraw && (
          <button className="user-page__withdraw-btn" onClick={onWithdraw} disabled={cupCount === 0}>
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
              <line x1="4" y1="10" x2="16" y2="10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            Withdraw all Cups
          </button>
        )}
        {BUILD_STAMP && (
          <p className="user-page__build" title="App version (build time)" onClick={bumpVersion}>
            Build {BUILD_STAMP}
          </p>
        )}
      </footer>
    </div>
  );
}

/* ── Edit-profile modal — name, photo, email + marketing, in one place.
 * Minimal: an avatar with photo controls, an editable name with a shuffle,
 * the email (routes to the verified sign-in sheet), and a marketing toggle. ── */
function ProfileEditModal({
  profile, animal, avatarUrl, email, hasEmail, marketingConsent, notifyOnApproval,
  region = 'NL', availableRegions = [], onChangeRegion,
  pwaInstalled, pushRewards, onTogglePush, browserInfo,
  onClose, onSaveName, onRegenerate, onUploadAvatar, onRemoveAvatar, onManageEmail, onToggleMarketing, onToggleNotify,
}) {
  const [name, setName] = useState(profile.displayName || '');
  const [pendingRegion, setPendingRegion] = useState(null); // region key awaiting "are you sure?"
  const fileRef = useRef(null);
  const current = getRegion(region);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const commitName = () => {
    const t = name.trim();
    if (t && t !== profile.displayName) onSaveName(t);
  };
  const regenerate = () => {
    const fresh = onRegenerate?.();
    if (fresh?.displayName) setName(fresh.displayName);
  };

  return createPortal(
    <div className="upedit-overlay" onClick={onClose}>
      <div className="upedit" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Edit profile">
        <div className="upedit__head">
          <h2 className="upedit__title">Edit profile</h2>
          <button type="button" className="upedit__close" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div className="upedit__avatar-block">
          <div className="upedit__avatar" style={avatarUrl ? undefined : { background: animal.bg }}>
            {avatarUrl
              ? <img src={avatarUrl} alt="" className="upedit__avatar-img" />
              : <span className="upedit__avatar-emoji" role="img" aria-label={animal.name}>{animal.emoji}</span>}
          </div>
          <div className="upedit__avatar-actions">
            <button type="button" className="upedit__ghost" onClick={() => fileRef.current?.click()}>
              {avatarUrl ? 'Change photo' : 'Upload photo'}
            </button>
            {avatarUrl && <button type="button" className="upedit__ghost upedit__ghost--muted" onClick={onRemoveAvatar}>Remove</button>}
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { onUploadAvatar?.(e.target.files?.[0]); e.target.value = ''; }} />
          </div>
        </div>

        <div className="upedit__field">
          <span className="upedit__label">Name</span>
          <div className="upedit__name-row">
            <input
              className="upedit__input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
              aria-label="Display name"
            />
            <button type="button" className="upedit__shuffle" onClick={regenerate} aria-label="Randomise name" title="Randomise">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            </button>
          </div>
        </div>

        <div className="upedit__field">
          <span className="upedit__label">Email</span>
          <button type="button" className="upedit__row-btn" onClick={onManageEmail}>
            <span className={hasEmail ? 'upedit__row-val' : 'upedit__row-add'}>{hasEmail ? email : 'Add email to save your balance'}</span>
            <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M7 4L13 10L7 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        </div>

        {/* Region — the customer's home region. Drives currency, payout method,
            the café list/map focus, and which data policy applies. */}
        {availableRegions.length > 1 && (
          <div className="upedit__field">
            <span className="upedit__label">Region</span>
            <div className="upedit__region-row">
              {availableRegions.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  className={`upedit__region-opt${r.key === region ? ' is-on' : ''}`}
                  onClick={() => { if (r.key !== region) setPendingRegion(r.key); }}
                  aria-pressed={r.key === region}
                >
                  <span className="upedit__region-flag" aria-hidden="true">{r.flag}</span>
                  <span className="upedit__region-name">{r.label}</span>
                  <span className="upedit__region-cur">{r.symbol} {r.currency}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {hasEmail && (
          <label className="upedit__toggle">
            <span>Reward approval emails</span>
            <input type="checkbox" className="user-page__switch" checked={!!notifyOnApproval} onChange={(e) => onToggleNotify?.(e.target.checked)} aria-label="Email me when a reward is approved" />
          </label>
        )}

        {/* Push notifications only work from the installed app, so this toggle
            appears only once PackPerks is added to the home screen. */}
        {pwaInstalled && (
          <label className="upedit__toggle">
            <span>Reward push notifications</span>
            <input type="checkbox" className="user-page__switch" checked={!!pushRewards} onChange={(e) => onTogglePush?.(e.target.checked)} aria-label="Notify me about rewards via push notification" />
          </label>
        )}

        {hasEmail && (
          <label className="upedit__toggle">
            <span>Marketing emails</span>
            <input type="checkbox" className="user-page__switch" checked={!!marketingConsent} onChange={(e) => onToggleMarketing?.(e.target.checked)} aria-label="Marketing emails" />
          </label>
        )}

        <p className="upedit__meta">{[profile.phone, browserInfo].filter(Boolean).join(' · ')}</p>

        <button type="button" className="upedit__done" onClick={() => { commitName(); onClose(); }}>Done</button>
      </div>

      {/* "Are you sure?" — spell out what switching region changes. */}
      {pendingRegion && (() => {
        const next = getRegion(pendingRegion);
        return (
          <div className="upedit-confirm-overlay" onClick={(e) => { e.stopPropagation(); setPendingRegion(null); }}>
            <div className="upedit-confirm" onClick={(e) => e.stopPropagation()} role="alertdialog" aria-modal="true" aria-label="Confirm region change">
              <h3 className="upedit-confirm__title">Switch to {next.flag} {next.label}?</h3>
              <p className="upedit-confirm__sub">Changing your region updates how the app works for you:</p>
              <ul className="upedit-confirm__list">
                <li>Prices show in <strong>{next.currency}</strong> — e.g. {formatMoney(4.8, next.key)}.</li>
                <li>Cashback is paid using the <strong>{next.label}</strong> payout method.</li>
                <li>The café list and map focus on <strong>{next.label}</strong> first (other regions stay visible).</li>
                <li><strong>{next.label}</strong> data-protection terms apply.</li>
              </ul>
              <p className="upedit-confirm__note">Cups you&rsquo;ve already collected stay exactly as they are.</p>
              <div className="upedit-confirm__actions">
                <button type="button" className="upedit__ghost" onClick={() => setPendingRegion(null)}>Cancel</button>
                <button type="button" className="upedit-confirm__go" onClick={() => { onChangeRegion?.(pendingRegion); setPendingRegion(null); }}>Switch region</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>,
    document.body,
  );
}

/* ─────────────────────────────────────────────────────────────────────
 * Impact card + detail modal.
 *
 * The card on the profile page is just the SUMMARY — three muted
 * rows the customer can scan in a glance. Tapping it opens the
 * DETAIL modal which fetches community totals from the server and
 * lets them share the whole thing as an image.
 *
 * 1 cup ≈ 5 g of plastic is the PackBack pilot estimate (a thin
 * grocery bag is also ~5 g, which is why the bag comparison reads
 * 1:1). Switch to a per-org constant later if the partner uses a
 * different cup material.
 * ───────────────────────────────────────────────────────────────────── */

const GRAMS_PER_CUP = 5;

/* Five everyday comparisons. All ground "5 g of plastic" in tangible
 * objects people see every day — no Eiffel Towers, no football
 * pitches, no abstract percentages. Same user sees a stable phrasing
 * (picked via `cups % len`) that shifts as they earn more cups. */
const COMPARISON_PHRASES = [
  /* Coffee cups directly — 1:1 ratio (each returned cup IS a coffee
   * cup kept out of landfill). */
  (cups) => `${cups} disposable coffee cup${cups === 1 ? '' : 's'} kept out of landfill`,

  /* Plastic grocery bags — thin bags weigh ~5 g each, so 1 cup ≈ 1
   * bag by mass. */
  (cups) => `roughly ${cups} plastic grocery bag${cups === 1 ? '' : 's'} of waste avoided`,

  /* Plastic straws — ~0.5 g each, so 1 cup ≈ 10 straws. */
  (cups) => {
    const straws = cups * 10;
    return `about ${straws.toLocaleString()} plastic straw${straws === 1 ? '' : 's'} kept out of the ocean`;
  },

  /* Disposable forks — ~5 g each, 1:1 ratio. */
  (cups) => `${cups} disposable plastic fork${cups === 1 ? '' : 's'} that didn't get thrown away`,

  /* Weight ladder — picks an everyday object that matches the user's
   * total plastic mass. The user gets a sense of "is this a sugar
   * packet or a brick?" without needing to do mental math. */
  (cups) => {
    const g = cups * GRAMS_PER_CUP;
    if (g < 30)   return `about the weight of a sugar packet of plastic saved`;
    if (g < 80)   return `about the weight of a chocolate bar of plastic saved`;
    if (g < 200)  return `about the weight of an apple of plastic saved`;
    if (g < 600)  return `about the weight of a paperback book of plastic saved`;
    if (g < 1500) return `about the weight of a bag of sugar of plastic saved`;
    if (g < 5000) return `about the weight of a brick of plastic saved`;
    return `about ${(g / 1000).toFixed(1)} kg of plastic, a small backpack's worth`;
  },
];

function pickComparison(cups) {
  if (cups <= 0) return 'Collect your first cup to see your impact';
  const i = cups % COMPARISON_PHRASES.length;
  return COMPARISON_PHRASES[i](cups);
}

function formatGrams(g) {
  if (g >= 1000) return `${(g / 1000).toFixed(1)} kg`;
  return `${g} g`;
}

/* ─── ImpactSummary — what shows inside the clickable card on the
 * profile page. Three rows. Tap target is the wrapping button in
 * UserPage. ─── */
function ImpactSummary({ cups }) {
  const co2 = cups * CO2_GRAMS_PER_CUP;
  return (
    <div className="user-page__impact-summary">
      <div className="user-page__impact-row">
        <div className="user-page__impact-icon user-page__impact-icon--green">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8h1a4 4 0 0 1 0 8h-1" />
            <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" />
            <line x1="6" y1="1" x2="6" y2="4" />
            <line x1="10" y1="1" x2="10" y2="4" />
            <line x1="14" y1="1" x2="14" y2="4" />
          </svg>
        </div>
        <span className="user-page__impact-label">Cups collected</span>
        <span className="user-page__impact-val">{cups}</span>
      </div>
      <div className="user-page__divider" />
      <div className="user-page__impact-row">
        <div className="user-page__impact-icon user-page__impact-icon--blue">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z" />
            <path d="M2 21c0-3 1.85-5.36 5.08-6" />
          </svg>
        </div>
        <span className="user-page__impact-label">CO₂ avoided</span>
        <span className="user-page__impact-val">~{formatCo2(co2)}</span>
      </div>
      <div className="user-page__divider" />
      <div className="user-page__impact-row user-page__impact-row--cta">
        <span className="user-page__impact-cta-text">See the full picture</span>
        <svg className="user-page__history-chevron" width="14" height="14" viewBox="0 0 20 20" fill="none">
          <path d="M7 4L13 10L7 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
    </div>
  );
}

/* ─── ImpactDetailModal — opens when the summary card is tapped.
 * Shows the personal stats, the community totals (server-sourced),
 * and a Share button that captures a branded card as an image. ─── */
function ImpactDetailModal({ cups, profile, onClose }) {
  const [community, setCommunity] = useState(null); // { totalLifetimeCups, returningUsers }
  const [communityErr, setCommunityErr] = useState(null);
  const [sharing, setSharing] = useState(false);
  const [shared, setShared] = useState(false);
  const shareCardRef = useRef(null);

  // Pull community totals once on open. We don't pass orgId — the
  // RLS-readable cup_balances rows are already org-scoped for the
  // signed-in user's brand, so an unscoped SUM is "this community"
  // from their perspective. If we ever want cross-org PackPerks-wide
  // totals, pass `null` explicitly to getGlobalImpact.
  useEffect(() => {
    let cancelled = false;
    getGlobalImpact().then(res => {
      if (cancelled) return;
      setCommunity(res);
    }).catch(err => {
      if (cancelled) return;
      console.warn('getGlobalImpact failed:', err);
      setCommunityErr('Couldn\'t reach the server for community totals.');
    });
    return () => { cancelled = true; };
  }, []);

  // Esc / backdrop close
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const co2           = cups * CO2_GRAMS_PER_CUP;
  const comparison    = pickComparison(cups);
  // Collective total = the whole Packback network's returned cups (base) plus
  // every cup returned through PackPerks, expressed as CO₂e avoided.
  const communityTotalCups = NETWORK_BASE_CUPS + (community?.totalLifetimeCups || 0);
  const communityCo2  = communityTotalCups * CO2_GRAMS_PER_CUP;

  async function handleShare() {
    if (!shareCardRef.current) return;
    setSharing(true);
    setShared(false);
    try {
      // Capture the off-screen branded share card. Pixel-ratio 2x for
      // crisp text on phone screens; cacheBust avoids html-to-image
      // re-using a stale render if the user re-shares.
      const dataUrl = await toJpeg(shareCardRef.current, {
        quality: 0.92,
        pixelRatio: 2,
        cacheBust: true,
        backgroundColor: '#F4EBDC',
      });
      // navigator.share with files isn't universally supported. Best
      // path: fetch the data-URL as a Blob, hand it to share. Fall
      // back to a download link otherwise.
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], 'packperks-impact.jpg', { type: 'image/jpeg' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: 'My PackPerks impact',
          text: `I've returned ${cups} cups with PackPerks. That's ~${formatCo2(co2)} of CO₂ avoided.`,
        });
        setShared(true);
      } else {
        // Plain download fallback.
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = 'packperks-impact.jpg';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setShared(true);
      }
    } catch (e) {
      // AbortError fires when the user cancels the native share sheet
      // — not an error from our side, just suppress.
      if (e?.name !== 'AbortError') console.error('Share failed:', e);
    } finally {
      setSharing(false);
      setTimeout(() => setShared(false), 2400);
    }
  }

  /* Portal to document.body so the fixed-position backdrop + sheet
   * are NOT contained by any ancestor with a transform / filter /
   * perspective. Without this, `position: fixed` becomes relative
   * to the nearest such ancestor — which is why the dimmed layer
   * left side gaps and the sheet anchored to the page bottom
   * instead of the viewport bottom. */
  return createPortal((
    <div className="impact-modal" onClick={onClose}>
      <div className="impact-modal__sheet" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Your impact">
        <button className="impact-modal__close" onClick={onClose} aria-label="Close">×</button>

        <header className="impact-modal__header">
          <span className="impact-modal__eyebrow">Your lifetime impact</span>
          <h2 className="impact-modal__title">Look what you've done</h2>
        </header>

        {/* Personal stats */}
        <div className="impact-modal__stats">
          <div className="impact-modal__stat">
            <div className="impact-modal__stat-val">{cups.toLocaleString()}</div>
            <div className="impact-modal__stat-label">Cups collected</div>
          </div>
          <div className="impact-modal__stat-divider" />
          <div className="impact-modal__stat">
            <div className="impact-modal__stat-val">~{formatCo2(co2)}</div>
            <div className="impact-modal__stat-label">CO₂ avoided</div>
          </div>
        </div>

        <div className="impact-modal__compare">{comparison}</div>

        {/* Community totals — REAL number from server */}
        <div className="impact-modal__community">
          <span className="impact-modal__community-label">Together with everyone using PackPerks</span>
          {communityErr ? (
            <span className="impact-modal__community-err">{communityErr}</span>
          ) : community === null ? (
            <span className="impact-modal__community-loading">Loading community total…</span>
          ) : (
            <div className="impact-modal__community-stats">
              <div className="impact-modal__community-stat">
                <span className="impact-modal__community-val">{communityTotalCups.toLocaleString()}</span>
                <span className="impact-modal__community-sub">cups returned</span>
              </div>
              <div className="impact-modal__community-stat">
                <span className="impact-modal__community-val">{formatCo2(communityCo2)}</span>
                <span className="impact-modal__community-sub">CO₂ avoided</span>
              </div>
              {community.returningUsers > 0 && (
                <div className="impact-modal__community-stat">
                  <span className="impact-modal__community-val">{community.returningUsers.toLocaleString()}</span>
                  <span className="impact-modal__community-sub">people taking part</span>
                </div>
              )}
            </div>
          )}
        </div>

        <button
          className="impact-modal__share"
          onClick={handleShare}
          disabled={sharing}
        >
          {sharing ? 'Preparing image…' : shared ? '✓ Shared!' : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                <polyline points="16 6 12 2 8 6" />
                <line x1="12" y1="2" x2="12" y2="15" />
              </svg>
              Share my impact
            </>
          )}
        </button>

        {/* ─── Off-screen branded share card ───
         * Rendered absolutely-positioned at -9999px so it's not visible
         * but html-to-image can still rasterise it. Designed to look
         * great as a square-ish social image (1080×1350 at 2x). */}
        <div className="impact-share-card" ref={shareCardRef} aria-hidden="true">
          <div className="impact-share-card__brand">
            <span className="impact-share-card__brand-tag">PackPerks</span>
            <span className="impact-share-card__brand-tagline">Reusable cups · real rewards</span>
          </div>
          <div className="impact-share-card__hero">
            <div className="impact-share-card__big">{cups.toLocaleString()}</div>
            <div className="impact-share-card__big-label">cups collected</div>
          </div>
          <div className="impact-share-card__rows">
            <div className="impact-share-card__row">
              <span className="impact-share-card__row-label">CO₂ avoided</span>
              <span className="impact-share-card__row-val">~{formatCo2(co2)}</span>
            </div>
            <div className="impact-share-card__row">
              <span className="impact-share-card__row-label">Equivalent</span>
              <span className="impact-share-card__row-val impact-share-card__row-val--small">{comparison}</span>
            </div>
            {community && (
              <div className="impact-share-card__row impact-share-card__row--community">
                <span className="impact-share-card__row-label">Packback network</span>
                <span className="impact-share-card__row-val">{communityTotalCups.toLocaleString()} cups returned</span>
              </div>
            )}
          </div>
          <div className="impact-share-card__footer">
            {profile?.displayName ? `Returned by ${profile.displayName}` : 'Returned with PackPerks'}
          </div>
        </div>
      </div>
    </div>
  ), document.body);
}
