import { useEffect, useState, useMemo } from 'react';
import './UserPage.css';
import cupIcon from '../assets/images/cup-icon.svg';
import { track, EVENTS } from '../utils/analytics';
import ActivityDetailModal from './ActivityDetailModal';
import { validateIban } from '../utils/iban';

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

export default function UserPage({ profile, onSaveProfile, cupCount, history, userClaims = [], rewards = [], authEmail = null, onOpenSignIn, onAddCup, onWithdraw, onShareCup, onOpenShare, onOpenDonate, onRefreshClaims, onClose }) {
  // Refresh claim status when the user enters this page — admin approvals
  // that happened while the user wasn't looking get pulled in automatically.
  useEffect(() => { onRefreshClaims?.(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // Enrich claims with a human-readable reward name so the modal can match
  // them against the activity_history label ("Claimed: Chicken Sandwich").
  const enrichedClaims = userClaims.map(c => {
    const reward = rewards.find(r => r.id === c.reward_id);
    return { ...c, rewardName: reward?.name || c.reward_id };
  });
  const [email, setEmail] = useState(profile.email || '');
  const [emailSaved, setEmailSaved] = useState(!!profile.email);
  const [isEditingEmail, setIsEditingEmail] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [isEditingName, setIsEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState('');

  // IBAN state
  const [ibanValue, setIbanValue] = useState(profile.iban || '');
  const [ibanRevealed, setIbanRevealed] = useState(false);
  const [isEditingIban, setIsEditingIban] = useState(false);
  const [ibanInput, setIbanInput] = useState('');
  const [ibanError, setIbanError] = useState('');

  const [activeActivity, setActiveActivity] = useState(null);

  // Share sheet: lifted to App.jsx — call prop to open it

  const animal = ANIMALS[profile.animalIndex % ANIMALS.length];
  const browserInfo = useMemo(() => getBrowserInfo(), []);

  const saveProfile = (updated) => {
    onSaveProfile(updated);
  };

  const handleRegenerate = () => {
    const fresh = generateProfile();
    saveProfile({ displayName: fresh.displayName, animalIndex: fresh.animalIndex });
  };

  const handleEditName = () => {
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

  const handleSaveIban = () => {
    const trimmed = ibanInput.trim().toUpperCase();
    if (!trimmed) {
      setIbanError('Please enter your IBAN.');
      return;
    }
    if (!validateIban(trimmed)) {
      setIbanError('This IBAN is invalid. Please double-check the number.');
      return;
    }
    saveProfile({ iban: trimmed });
    setIbanValue(trimmed);
    setIsEditingIban(false);
    setIbanRevealed(false);
    setIbanError('');
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
          <div className="user-page__cup-badge">
            <img src={cupIcon} alt="" width="14" height="14" />
            {cupCount} cup{cupCount !== 1 ? 's' : ''} collected
          </div>
        </div>
      </div>

      {/* ── Details ── */}
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
          {emailSaved && email && !isEditingEmail ? (
            <button
              className="user-page__row-value user-page__row-value--editable"
              onClick={() => setIsEditingEmail(true)}
              title="Tap to edit"
            >
              {email}
            </button>
          ) : (
            <span className="user-page__row-value user-page__row-value--unknown">
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="7" stroke="#E24400" strokeWidth="1.5"/>
                <path d="M8 5v4" stroke="#E24400" strokeWidth="1.5" strokeLinecap="round"/>
                <circle cx="8" cy="11.5" r="0.75" fill="#E24400"/>
              </svg>
              Unknown
            </span>
          )}
        </div>
        <div className="user-page__divider" />
        <div className="user-page__row">
          <span className="user-page__row-label">IBAN</span>
          {ibanValue && !isEditingIban ? (
            ibanRevealed ? (
              /* Revealed — tap to edit */
              <button
                className="user-page__row-value user-page__row-value--editable"
                onClick={() => { setIbanInput(ibanValue); setIsEditingIban(true); }}
                title="Tap to change IBAN"
              >
                {ibanValue}
              </button>
            ) : (
              /* Blurred — tap to reveal */
              <button
                className="user-page__row-value user-page__iban-blurred"
                onClick={() => setIbanRevealed(true)}
                title="Tap to reveal"
              >
                <span className="user-page__iban-dots">
                  {ibanValue.replace(/\s/g, '').slice(0, -4).replace(/./g, '•').replace(/(.{4})/g, '$1 ').trim()}
                </span>
                <span className="user-page__iban-last4">{ibanValue.replace(/\s/g, '').slice(-4)}</span>
              </button>
            )
          ) : (
            <span className="user-page__row-value user-page__row-value--unknown">
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="7" stroke="#E24400" strokeWidth="1.5"/>
                <path d="M8 5v4" stroke="#E24400" strokeWidth="1.5" strokeLinecap="round"/>
                <circle cx="8" cy="11.5" r="0.75" fill="#E24400"/>
              </svg>
              Not saved
            </span>
          )}
        </div>
      </div>

      {/* "Save your progress" card has moved to the bottom of the page,
       *  after the Activity block — the customer first reads their
       *  recent actions, then sees the settings card. Restyled to match
       *  the surrounding white cards rather than the cream-tinted
       *  variant that used to live up here. */}

      {/* ── IBAN edit card ── */}
      {isEditingIban && (
        <div className="user-page__card">
          <span className="user-page__card-title">Update your IBAN</span>
          <span className="user-page__card-desc">Your IBAN is used to pay out cashback. It is stored only on this device.</span>
          <div className="user-page__email-row">
            <input
              type="text"
              className={`user-page__email-input${ibanError ? ' user-page__email-input--error' : ''}`}
              placeholder="NL 00 BANK 1020 3012 3456 78"
              value={ibanInput}
              onChange={e => { setIbanInput(e.target.value.toUpperCase()); setIbanError(''); }}
              aria-label="Your IBAN"
              autoFocus
              spellCheck={false}
              autoComplete="off"
            />
            <button className="user-page__email-btn" onClick={handleSaveIban}>Save</button>
          </div>
          <button
            className="user-page__email-cancel"
            onClick={() => { setIsEditingIban(false); setIbanError(''); }}
          >
            Cancel
          </button>
          {ibanError && <span className="user-page__email-error" role="alert">{ibanError}</span>}
        </div>
      )}

      {/* ── Cup actions grid ── */}
      <div className="user-page__actions">

        {onOpenShare && (
          <button className="user-page__action-btn" onClick={handleShare}>
            <svg width="15" height="13" viewBox="0 0 15 13" fill="none">
              <path d="M7.5 12.5L1.5 6.5C0 5 0 2.5 1.5 1.5C3 0.5 5 0.5 6.5 2L7.5 3L8.5 2C10 0.5 12 0.5 13.5 1.5C15 2.5 15 5 13.5 6.5L7.5 12.5Z" fill="#E24400"/>
            </svg>
            Share your Cup
          </button>
        )}

        <button className="user-page__action-btn" onClick={onAddCup}>
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
            <line x1="10" y1="3" x2="10" y2="17" stroke="black" strokeWidth="2" strokeLinecap="round"/>
            <line x1="3" y1="10" x2="17" y2="10" stroke="black" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          Add more cups
        </button>

        {onOpenShare && (
          <button className="user-page__action-btn user-page__action-btn--free" onClick={onOpenShare}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="8" width="18" height="4" rx="1" />
              <path d="M12 8v13" />
              <path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7" />
              <path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5" />
            </svg>
            Next cup for free
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
            Donate
          </button>
        )}

      </div>

      {/* ── Activity ── */}
      <div className="user-page__history">
        <span className="user-page__section-title">Activity</span>
        {history.length === 0 ? (
          <span className="user-page__history-empty">No activity yet. Start by returning a cup!</span>
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
                    <span className="user-page__history-time">{item.time}</span>
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

      {/* ── Save your progress / account ──
       * Re-skinned to match the rest of the user-page cards: a section
       * title above + a regular white card body, instead of the cream
       * pill it used to be at the top of the page. Lives at the bottom
       * so the customer scans their cup count + activity first and
       * meets the "set up your account" prompt only after they've
       * earned context to care. */}
      {(!emailSaved || isEditingEmail || authEmail) && (
        <div className="user-page__history user-page__progress-section">
          <span className="user-page__section-title">
            {authEmail ? 'Account' : 'Save your progress'}
          </span>
          <div className="user-page__card">
            <span className="user-page__card-title">
              {authEmail
                ? 'Synced across devices'
                : (isEditingEmail ? 'Update your email' : 'Add your email')}
            </span>
            <span className="user-page__card-desc">
              {authEmail
                ? <>Your cups are linked to <strong>{authEmail}</strong>. Sign in with this email on any device to pick up where you left off.</>
                : 'Add your email so we can restore your cups if you switch phones or clear your browser.'}
            </span>

            {authEmail && onOpenSignIn ? (
              <button
                type="button"
                className="user-page__email-btn user-page__progress-manage"
                onClick={onOpenSignIn}
              >
                Manage account
              </button>
            ) : (
              <>
                <div className="user-page__email-row">
                  <input
                    type="email"
                    className={`user-page__email-input${emailError ? ' user-page__email-input--error' : ''}`}
                    placeholder="your@email.com"
                    value={email}
                    onChange={e => { setEmail(e.target.value); setEmailError(''); }}
                    aria-label="Your email address"
                    autoFocus={isEditingEmail}
                  />
                  <button className="user-page__email-btn" onClick={handleSaveEmail}>Save</button>
                </div>
                {isEditingEmail && (
                  <button
                    className="user-page__email-cancel"
                    onClick={() => { setIsEditingEmail(false); setEmail(profile.email || ''); setEmailError(''); }}
                  >
                    Cancel
                  </button>
                )}
                {emailError && <span className="user-page__email-error" role="alert">{emailError}</span>}

                {/* Upgrade CTA — only shown once the email looks valid
                 *  (or has already been saved), so we don't tease the
                 *  cross-device sign-in until the user has something
                 *  to sign in with. */}
                {onOpenSignIn && (emailSaved || (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) && (
                  <button
                    type="button"
                    className="user-page__progress-upgrade"
                    onClick={onOpenSignIn}
                  >
                    <span>Use this email to sign in on other devices</span>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="5" y1="12" x2="19" y2="12" />
                      <polyline points="12 5 19 12 12 19" />
                    </svg>
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {activeActivity && (
        <ActivityDetailModal
          item={activeActivity}
          profile={profile}
          userClaims={enrichedClaims}
          onClose={() => setActiveActivity(null)}
        />
      )}

      {/* ── Footer ── */}
      <footer className="user-page__footer">
        <nav className="user-page__legal">
          <button className="user-page__legal-link">Privacy Policy</button>
          <span className="user-page__legal-sep">·</span>
          <button className="user-page__legal-link">Terms of Service</button>
          <span className="user-page__legal-sep">·</span>
          <button className="user-page__legal-link">Cookie Policy</button>
        </nav>
        {onWithdraw && (
          <button className="user-page__withdraw-btn" onClick={onWithdraw} disabled={cupCount === 0}>
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
              <line x1="4" y1="10" x2="16" y2="10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            Withdraw all Cups
          </button>
        )}
      </footer>
    </div>
  );
}
