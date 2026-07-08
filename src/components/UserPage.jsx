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

const DSAR_EMAIL = 'info@packback.network';

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

/* ── Inline SVG animal avatars ── */
const ANIMALS = [
  {
    name: 'Fox',
    svg: (
      <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="40" cy="40" r="40" fill="#FEA01E"/>
        <ellipse cx="40" cy="48" rx="18" ry="14" fill="#F4EBDC"/>
        <ellipse cx="40" cy="34" rx="16" ry="16" fill="#E24400"/>
        <polygon points="24,22 18,6 32,18" fill="#E24400"/>
        <polygon points="56,22 62,6 48,18" fill="#E24400"/>
        <polygon points="25,21 20,9 31,18" fill="#FFB535"/>
        <polygon points="55,21 60,9 49,18" fill="#FFB535"/>
        <ellipse cx="33" cy="35" rx="3" ry="3.5" fill="white"/>
        <ellipse cx="47" cy="35" rx="3" ry="3.5" fill="white"/>
        <circle cx="33" cy="36" r="1.8" fill="#1D1D1D"/>
        <circle cx="47" cy="36" r="1.8" fill="#1D1D1D"/>
        <ellipse cx="40" cy="41" rx="5" ry="3" fill="#F4EBDC"/>
        <ellipse cx="40" cy="42" rx="2.5" ry="1.5" fill="#E24400"/>
      </svg>
    ),
  },
  {
    name: 'Panda',
    svg: (
      <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="40" cy="40" r="40" fill="#E9E9E9"/>
        <circle cx="40" cy="38" r="18" fill="white"/>
        <circle cx="22" cy="22" r="9" fill="#1D1D1D"/>
        <circle cx="58" cy="22" r="9" fill="#1D1D1D"/>
        <ellipse cx="32" cy="35" rx="6" ry="5" fill="#1D1D1D"/>
        <ellipse cx="48" cy="35" rx="6" ry="5" fill="#1D1D1D"/>
        <circle cx="32" cy="35" r="3" fill="white"/>
        <circle cx="48" cy="35" r="3" fill="white"/>
        <circle cx="32.8" cy="35.8" r="1.8" fill="#1D1D1D"/>
        <circle cx="48.8" cy="35.8" r="1.8" fill="#1D1D1D"/>
        <ellipse cx="40" cy="42" rx="4" ry="2.5" fill="#1D1D1D"/>
        <ellipse cx="40" cy="47" rx="5" ry="3" fill="#E9E9E9"/>
      </svg>
    ),
  },
  {
    name: 'Bear',
    svg: (
      <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="40" cy="40" r="40" fill="#C87A2E"/>
        <circle cx="40" cy="38" r="18" fill="#A85C1A"/>
        <circle cx="22" cy="20" r="9" fill="#A85C1A"/>
        <circle cx="58" cy="20" r="9" fill="#A85C1A"/>
        <circle cx="22" cy="20" r="5" fill="#C87A2E"/>
        <circle cx="58" cy="20" r="5" fill="#C87A2E"/>
        <ellipse cx="40" cy="43" rx="9" ry="7" fill="#C87A2E"/>
        <circle cx="34" cy="35" r="3" fill="white"/>
        <circle cx="46" cy="35" r="3" fill="white"/>
        <circle cx="34.8" cy="35.8" r="1.8" fill="#1D1D1D"/>
        <circle cx="46.8" cy="35.8" r="1.8" fill="#1D1D1D"/>
        <ellipse cx="40" cy="42" rx="3.5" ry="2" fill="#1D1D1D"/>
      </svg>
    ),
  },
  {
    name: 'Rabbit',
    svg: (
      <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="40" cy="40" r="40" fill="#F4EBDC"/>
        <circle cx="40" cy="42" r="18" fill="white"/>
        <ellipse cx="28" cy="18" rx="7" ry="14" fill="white"/>
        <ellipse cx="52" cy="18" rx="7" ry="14" fill="white"/>
        <ellipse cx="28" cy="18" rx="4" ry="11" fill="#FFB0C8"/>
        <ellipse cx="52" cy="18" rx="4" ry="11" fill="#FFB0C8"/>
        <circle cx="34" cy="39" r="3" fill="#FFB0C8"/>
        <circle cx="46" cy="39" r="3" fill="#FFB0C8"/>
        <circle cx="34" cy="39" r="1.5" fill="#1D1D1D"/>
        <circle cx="46" cy="39" r="1.5" fill="#1D1D1D"/>
        <ellipse cx="40" cy="44.5" rx="2.5" ry="1.5" fill="#FFB0C8"/>
        <ellipse cx="40" cy="49" rx="5" ry="3" fill="#F4EBDC"/>
      </svg>
    ),
  },
  {
    name: 'Cat',
    svg: (
      <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="40" cy="40" r="40" fill="#FEA01E"/>
        <circle cx="40" cy="40" r="18" fill="#F5C040"/>
        <polygon points="22,24 16,8 32,20" fill="#F5C040"/>
        <polygon points="58,24 64,8 48,20" fill="#F5C040"/>
        <polygon points="23,23 18,11 30,20" fill="#E24400"/>
        <polygon points="57,23 62,11 50,20" fill="#E24400"/>
        <ellipse cx="34" cy="37" rx="4" ry="4.5" fill="white"/>
        <ellipse cx="46" cy="37" rx="4" ry="4.5" fill="white"/>
        <ellipse cx="34" cy="38" rx="2" ry="3.5" fill="#1D1D1D"/>
        <ellipse cx="46" cy="38" rx="2" ry="3.5" fill="#1D1D1D"/>
        <polygon points="40,43 37.5,46 42.5,46" fill="#E24400"/>
        <line x1="22" y1="44" x2="35" y2="45" stroke="white" strokeWidth="1" opacity="0.7"/>
        <line x1="22" y1="47" x2="35" y2="47" stroke="white" strokeWidth="1" opacity="0.7"/>
        <line x1="45" y1="45" x2="58" y2="44" stroke="white" strokeWidth="1" opacity="0.7"/>
        <line x1="45" y1="47" x2="58" y2="47" stroke="white" strokeWidth="1" opacity="0.7"/>
      </svg>
    ),
  },
  {
    name: 'Owl',
    svg: (
      <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="40" cy="40" r="40" fill="#502314"/>
        <circle cx="40" cy="42" r="18" fill="#A85C1A"/>
        <polygon points="29,24 25,10 35,22" fill="#502314"/>
        <polygon points="51,24 55,10 45,22" fill="#502314"/>
        <circle cx="33" cy="38" r="8" fill="#F5C040"/>
        <circle cx="47" cy="38" r="8" fill="#F5C040"/>
        <circle cx="33" cy="38" r="5" fill="#1D1D1D"/>
        <circle cx="47" cy="38" r="5" fill="#1D1D1D"/>
        <circle cx="35" cy="36" r="1.5" fill="white"/>
        <circle cx="49" cy="36" r="1.5" fill="white"/>
        <polygon points="40,43 37,48 43,48" fill="#FEA01E"/>
        <ellipse cx="40" cy="52" rx="8" ry="6" fill="#F4EBDC"/>
      </svg>
    ),
  },
  {
    name: 'Deer',
    svg: (
      <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="40" cy="40" r="40" fill="#FEA01E"/>
        <circle cx="40" cy="40" r="18" fill="#C87A2E"/>
        <line x1="28" y1="22" x2="22" y2="8" stroke="#502314" strokeWidth="3" strokeLinecap="round"/>
        <line x1="22" y1="14" x2="16" y2="10" stroke="#502314" strokeWidth="2.5" strokeLinecap="round"/>
        <line x1="22" y1="10" x2="18" y2="5" stroke="#502314" strokeWidth="2" strokeLinecap="round"/>
        <line x1="52" y1="22" x2="58" y2="8" stroke="#502314" strokeWidth="3" strokeLinecap="round"/>
        <line x1="58" y1="14" x2="64" y2="10" stroke="#502314" strokeWidth="2.5" strokeLinecap="round"/>
        <line x1="58" y1="10" x2="62" y2="5" stroke="#502314" strokeWidth="2" strokeLinecap="round"/>
        <ellipse cx="24" cy="26" rx="6" ry="8" fill="#C87A2E"/>
        <ellipse cx="56" cy="26" rx="6" ry="8" fill="#C87A2E"/>
        <ellipse cx="40" cy="44" rx="9" ry="7" fill="#F4EBDC"/>
        <circle cx="34" cy="36" r="3" fill="white"/>
        <circle cx="46" cy="36" r="3" fill="white"/>
        <circle cx="34.8" cy="36.8" r="1.8" fill="#1D1D1D"/>
        <circle cx="46.8" cy="36.8" r="1.8" fill="#1D1D1D"/>
        <ellipse cx="40" cy="43" rx="3" ry="2" fill="#A85C1A"/>
      </svg>
    ),
  },
  {
    name: 'Penguin',
    svg: (
      <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="40" cy="40" r="40" fill="#1D1D1D"/>
        <ellipse cx="40" cy="44" rx="14" ry="16" fill="white"/>
        <circle cx="40" cy="30" r="14" fill="#1D1D1D"/>
        <circle cx="35" cy="28" r="4" fill="white"/>
        <circle cx="45" cy="28" r="4" fill="white"/>
        <circle cx="35.8" cy="28.8" r="2.5" fill="#1D1D1D"/>
        <circle cx="45.8" cy="28.8" r="2.5" fill="#1D1D1D"/>
        <circle cx="36.5" cy="27.5" r="1" fill="white"/>
        <circle cx="46.5" cy="27.5" r="1" fill="white"/>
        <polygon points="40,34 37,38 43,38" fill="#FEA01E"/>
        <circle cx="30" cy="33" r="4" fill="#FEA01E" opacity="0.5"/>
        <circle cx="50" cy="33" r="4" fill="#FEA01E" opacity="0.5"/>
      </svg>
    ),
  },
];

/* ── Silly rhyming names: adjective rhymes with animal ── */
const SILLY_NAMES = {
  Fox:     ['Ferris Fox',    'Felix Fox',    'Francis Fox',   'Foxy Fong'],
  Panda:   ['Amanda Panda',  'Sandy Panda',  'Wanda Panda',   'Panda Banda'],
  Bear:    ['Barry Bear',    'Perry Bear',   'Larry Bear',    'Gary Bear'],
  Rabbit:  ['Habit Rabbit',  'Grabbit Rabbit','Abbott Rabbit', 'Rabbit Mabbitt'],
  Cat:     ['Chadwick Cat',  'Pat the Cat',  'Natty Cat',     'Catrick Pat'],
  Owl:     ['Rowland Owl',   'Powell Owl',   'Fowler Owl',    'Howlin Owl'],
  Deer:    ['Cheerful Deer', 'Sheer Deer',   'Pierre Deer',   'Deer O\'Leary'],
  Penguin: ['Finn Penguin',  'Quinn Penguin','Guin Penguin',  'Ringo Penguin'],
};

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateProfile() {
  const animalIndex = Math.floor(Math.random() * ANIMALS.length);
  const animal = ANIMALS[animalIndex];
  const nameOptions = SILLY_NAMES[animal.name] || [`Randy ${animal.name}`];
  const displayName = pickRandom(nameOptions);
  return { displayName, phone: 'iPhone 15 Pro', email: '', animalIndex };
}

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
  // The active store's name — used for the per-store balance caption.
  storeName,
  // Admin-editable privacy policy text (falls back to the bundled default).
  privacyPolicy,
}) {
  // Refresh claim status when the user enters this page — admin approvals
  // that happened while the user wasn't looking get pulled in automatically.
  useEffect(() => { onRefreshClaims?.(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // Enrich claims with a human-readable reward name so the modal can match
  // them against the activity_history label ("Claimed: Chicken Sandwich").
  const enrichedClaims = userClaims.map(c => {
    const reward = rewards.find(r => r.id === c.reward_id);
    return { ...c, rewardName: reward?.name || c.reward_id, rewardImage: reward?.image || null, rewardBg: reward?.bgColor || null };
  });
  // Claims whose Tikkie CTA has been tapped once — hidden from the pending
  // block (but kept in Activity). Persisted in localStorage.
  const [collectedClaims, setCollectedClaims] = useState(() => getCollectedMap());
  const handleCollectClaim = (claim) => {
    if (!claim?.id) return;
    markClaimCollected(claim.id);
    setCollectedClaims({ ...getCollectedMap() });
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

  const animal = ANIMALS[profile.animalIndex % ANIMALS.length];
  const browserInfo = useMemo(() => getBrowserInfo(), []);

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
  const handleExportData = () => dsar('PackPerks — export my data (access request)');
  const handleDeleteAccount = () => {
    if (!window.confirm('Delete your account and personal data? This clears your saved email now and requests full erasure. Your cups will be removed. This cannot be undone.')) return;
    // Best-effort immediate scrub of identifiable data on this account.
    saveProfile({ email: '' });
    dsar('PackPerks — delete my account (erasure request)', 'I want my account and all associated personal data deleted.');
  };

  const handleRegenerate = () => {
    track(EVENTS.NAME_REGENERATED);
    const fresh = generateProfile();
    saveProfile({ displayName: fresh.displayName, animalIndex: fresh.animalIndex });
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

  const handleSaveEmail = () => {
    if (!email.includes('@') || !email.includes('.')) {
      setEmailError('Please enter a valid email address.');
      return;
    }
    saveProfile({ email });
    setEmailSaved(true);
    setIsEditingEmail(false);
    setEmailError('');
    track('email_saved', { email_length: email.length });
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

      {/* ── Profile card ── */}
      <div className="user-page__card">

        {/* Corner buttons — regenerate & edit (hidden while editing name) */}
        {!isEditingName && (
          <div className="user-page__card-actions">
            <button className="user-page__name-icon-btn" onClick={handleRegenerate} aria-label="Regenerate name and avatar" title="Randomise">
              {/* Clockwise refresh icon */}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10"/>
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
              </svg>
            </button>
            <button className="user-page__name-icon-btn" onClick={handleEditName} aria-label="Edit name" title="Edit name">
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13.586 3.586a2 2 0 1 1 2.828 2.828L6 16.828 2 18l1.172-4L13.586 3.586z"/>
              </svg>
            </button>
          </div>
        )}

        <div className="user-page__avatar">{animal.svg}</div>
        <div className="user-page__profile-info">
          {isEditingName ? (
            <div className="user-page__name-edit-row">
              <input
                className="user-page__name-input"
                value={editNameValue}
                onChange={e => setEditNameValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSaveName(); if (e.key === 'Escape') setIsEditingName(false); }}
                autoFocus
                aria-label="Edit display name"
              />
              <button className="user-page__name-icon-btn user-page__name-icon-btn--save" onClick={handleSaveName} aria-label="Save name">
                <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 10L8 14L16 6"/>
                </svg>
              </button>
            </div>
          ) : (
            <div className="user-page__name-row">
              <span className="user-page__name">{profile.displayName}</span>
            </div>
          )}
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
          <p className="user-page__visitor-sub">Two ways to begin — scan your first cup, or save your email. Either one sets up your account and unlocks cashback.</p>
          <div className="user-page__visitor-ctas">
            <button type="button" className="user-page__visitor-cta" onClick={onAddCup}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add your first cup
            </button>
            {onOpenSignIn && (
              <button type="button" className="user-page__visitor-cta user-page__visitor-cta--alt" onClick={onOpenSignIn}>
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" />
                </svg>
                Add your email
              </button>
            )}
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
            <span className="user-page__value-num user-page__value-num--euro">
              €{(cashbackTotal != null ? cashbackTotal : cupCount * (cashbackRate || 1.25)).toFixed(2)}
            </span>
            <span className="user-page__value-label">in cashback</span>
          </div>
        </div>

        {/* ── Cup actions — nested inside the balance box ── */}
        <div className="user-page__actions">

        {onOpenShare && (
          <button className="user-page__action-btn" onClick={handleShare}>
            <svg width="15" height="13" viewBox="0 0 15 13" fill="none">
              <path d="M7.5 12.5L1.5 6.5C0 5 0 2.5 1.5 1.5C3 0.5 5 0.5 6.5 2L7.5 3L8.5 2C10 0.5 12 0.5 13.5 1.5C15 2.5 15 5 13.5 6.5L7.5 12.5Z" fill="var(--bk-red)"/>
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

      {/* ── How it works ── opens the full-screen Stories-style guide ── */}
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
            <span className="user-page__howto-sub">A quick walkthrough of cups, rewards and cashback</span>
          </span>
          <svg className="user-page__howto-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="9 6 15 12 9 18" />
          </svg>
        </button>
      )}

      {/* Save-your-cups prompt now lives inline on the Email row below
          (the empty-email state is an "Add email" action) — no separate banner. */}

      {/* ── Details + account ── phone / browser / email, plus the email
          management action and the marketing-email toggle, all in one card. */}
      <div className="user-page__card user-page__card--list">
        <div className="user-page__row">
          <span className="user-page__row-label">Phone</span>
          <span className="user-page__row-value">{profile.phone}</span>
        </div>
        <div className="user-page__divider" />
        <div className="user-page__row">
          <span className="user-page__row-label">Browser</span>
          <span className="user-page__row-value">{browserInfo}</span>
        </div>
        <div className="user-page__divider" />
        <div className="user-page__row">
          <span className="user-page__row-label">Email</span>
          {emailSaved && email ? (
            emailRevealed ? (
              <span className="user-page__row-value">{email}</span>
            ) : (
              <button
                className="user-page__row-value user-page__masked-value"
                onClick={() => setEmailRevealed(true)}
                title="Tap to reveal"
              >
                {maskEmail(email)}
              </button>
            )
          ) : (
            <span className="user-page__row-value user-page__row-value--unknown">—</span>
          )}
        </div>

        {/* Email management — inline editor when editing, otherwise a
            "Manage email" / "Add your email" action row. */}
        {isEditingEmail ? (
          <>
            <div className="user-page__divider" />
            <div className="user-page__account-edit">
              <div className="user-page__email-row">
                <input
                  type="email"
                  className={`user-page__email-input${emailError ? ' user-page__email-input--error' : ''}`}
                  placeholder="your@email.com"
                  value={email}
                  onChange={e => { setEmail(e.target.value); setEmailError(''); }}
                  aria-label="Your email address"
                  autoFocus
                />
                <button className="user-page__email-btn" onClick={handleSaveEmail}>Save</button>
              </div>
              <button
                className="user-page__email-cancel"
                onClick={() => { setIsEditingEmail(false); setEmail(profile.email || ''); setEmailError(''); }}
              >
                Cancel
              </button>
              {emailError && <span className="user-page__email-error" role="alert">{emailError}</span>}
              <p className="user-page__privacy-hint">
                Used only to save and restore your account across devices.{' '}
                <button type="button" className="user-page__privacy-hint-link" onClick={() => setPolicyOpen(true)}>Learn more</button>
              </p>
            </div>
          </>
        ) : (
          <>
            <div className="user-page__divider" />
            <button
              type="button"
              className="user-page__data-row"
              onClick={
                authEmail ? onOpenSignIn
                  : emailSaved ? () => { setEmail(profile.email || ''); setIsEditingEmail(true); }
                  : onOpenSignIn
              }
            >
              <span>{(emailSaved || authEmail) ? 'Manage email' : 'Add your email'}</span>
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M7 4L13 10L7 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </>
        )}

        {/* Marketing emails — one toggle row (no description). */}
        {(emailSaved || authEmail) && !isEditingEmail && (
          <>
            <div className="user-page__divider" />
            <label className="user-page__pref user-page__pref--row">
              <span className="user-page__pref-title">Marketing emails</span>
              <input
                type="checkbox"
                className="user-page__switch"
                checked={!!profile.marketingConsent}
                onChange={e => onSaveProfile({ marketingConsent: e.target.checked, marketingConsentSource: 'app_profile' })}
                aria-label="Marketing emails"
              />
            </label>
          </>
        )}
      </div>

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
          <p className="user-page__build" title="App version (build time)">
            Build {BUILD_STAMP}
          </p>
        )}
      </footer>
    </div>
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
    return `about ${(g / 1000).toFixed(1)} kg of plastic — a small backpack's worth`;
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
  const grams = cups * GRAMS_PER_CUP;
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
        <span className="user-page__impact-label">Cups returned</span>
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
        <span className="user-page__impact-label">Plastic avoided</span>
        <span className="user-page__impact-val">~{formatGrams(grams)}</span>
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

  const grams         = cups * GRAMS_PER_CUP;
  const comparison    = pickComparison(cups);
  const communityCups = community?.totalLifetimeCups || 0;
  const communityKg   = (communityCups * GRAMS_PER_CUP) / 1000;

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
          text: `I've returned ${cups} cups with PackPerks — that's ${formatGrams(grams)} of plastic kept out of landfill.`,
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
            <div className="impact-modal__stat-label">Cups returned</div>
          </div>
          <div className="impact-modal__stat-divider" />
          <div className="impact-modal__stat">
            <div className="impact-modal__stat-val">~{formatGrams(grams)}</div>
            <div className="impact-modal__stat-label">Plastic avoided</div>
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
                <span className="impact-modal__community-val">{communityCups.toLocaleString()}</span>
                <span className="impact-modal__community-sub">cups returned</span>
              </div>
              <div className="impact-modal__community-stat">
                <span className="impact-modal__community-val">
                  {communityKg >= 1 ? `${communityKg.toFixed(1)} kg` : `${(communityKg * 1000).toFixed(0)} g`}
                </span>
                <span className="impact-modal__community-sub">plastic avoided</span>
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
            <div className="impact-share-card__big-label">cups returned</div>
          </div>
          <div className="impact-share-card__rows">
            <div className="impact-share-card__row">
              <span className="impact-share-card__row-label">Plastic kept out of landfill</span>
              <span className="impact-share-card__row-val">~{formatGrams(grams)}</span>
            </div>
            <div className="impact-share-card__row">
              <span className="impact-share-card__row-label">Equivalent</span>
              <span className="impact-share-card__row-val impact-share-card__row-val--small">{comparison}</span>
            </div>
            {community && communityCups > 0 && (
              <div className="impact-share-card__row impact-share-card__row--community">
                <span className="impact-share-card__row-label">PackPerks community</span>
                <span className="impact-share-card__row-val">{communityCups.toLocaleString()} cups together</span>
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
