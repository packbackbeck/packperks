import { useState, useEffect } from 'react';
import './SuccessPage.css';
import { setClaimNotifyPrefs } from '../lib/api';
import { requestPushPermission, isPushSupported, iosNeedsInstall, getPermissionState } from '../lib/notify';

function formatDate(d = new Date()) {
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
function formatTime(d = new Date()) {
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
function getUserName() {
  try { const p = JSON.parse(localStorage.getItem('packperks_user_profile') || '{}'); return p.displayName || 'PackPerks User'; }
  catch { return 'PackPerks User'; }
}
function getUserEmail() {
  try { const p = JSON.parse(localStorage.getItem('packperks_user_profile') || '{}'); return p.email || null; }
  catch { return null; }
}

const ReceiptRow = ({ label, value, bold, green }) => (
  <div className="sp-receipt__row">
    <span className="sp-receipt__label">{label}</span>
    <span className={`sp-receipt__value${bold ? ' sp-receipt__value--bold' : ''}${green ? ' sp-receipt__value--green' : ''}`}>{value}</span>
  </div>
);

/* Shown after an ACCEPTED receipt verdict. In the Tikkie model every accepted
 * claim is reviewed by a person, then we send a Tikkie link to collect the
 * cashback (within 7 days) — the customer collects it themselves via the
 * link. The customer picks how they want to be told it's ready (email
 * and/or a browser push notification); the choice is stored on the claim. */
export default function SuccessPage({ reward, onDone, userName: userNameProp, userEmail: userEmailProp, claimId, onAddEmail }) {
  const now = new Date();
  const userName = userNameProp || getUserName();
  const userEmail = userEmailProp || getUserEmail();
  const cashback = reward.euros?.toFixed(2) ?? (reward.cupsNeeded * 1.25).toFixed(2);

  const pushSupported = isPushSupported();
  const needsInstall = iosNeedsInstall();
  const [notifyEmail, setNotifyEmail] = useState(!!userEmail);
  const [notifyPush, setNotifyPush] = useState(false);
  const [pushPerm, setPushPerm] = useState(getPermissionState());

  // Persist the initial choice (email on if we already have one) once.
  useEffect(() => {
    if (claimId) setClaimNotifyPrefs(claimId, { email: !!userEmail, push: false }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claimId]);

  const save = (email, push) => { if (claimId) setClaimNotifyPrefs(claimId, { email, push }).catch(() => {}); };

  const toggleEmail = () => {
    if (!userEmail) { onAddEmail?.(); return; } // no address yet → open the add-email popup
    const next = !notifyEmail;
    setNotifyEmail(next);
    save(next, notifyPush);
  };

  const togglePush = async () => {
    if (notifyPush) { setNotifyPush(false); save(notifyEmail, false); return; }
    const perm = await requestPushPermission();
    setPushPerm(perm);
    if (perm === 'granted') { setNotifyPush(true); save(notifyEmail, true); }
  };

  return (
    <div className="success-page success-page--pending">
      <div className="success-page__glow" />

      <div className="success-page__check-wrap">
        <svg className="success-page__check-svg" viewBox="0 0 80 80" fill="none">
          <circle cx="40" cy="40" r="38" fill="#E89E2C" opacity="0.15" />
          <circle cx="40" cy="40" r="30" fill="#E89E2C" />
          <circle cx="40" cy="40" r="18" stroke="white" strokeWidth="3.5" fill="none" />
          <path d="M40 28 L40 40 L48 46" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      <div className="success-page__text">
        <h1 className="success-page__title">Receipt submitted</h1>
        <p className="success-page__subtitle">
          We'll review it and send you a <strong>Tikkie link</strong> to collect your €{cashback} cashback — within <strong>7 days</strong>.
        </p>
      </div>

      {/* ── Receipt card ── */}
      <div className="sp-receipt">
        <div className="sp-receipt__header">
          <div className="sp-receipt__img-wrap" style={{ background: reward.bgColor || '#FEA01E' }}>
            <img
              src={reward.image}
              alt={reward.name}
              className="sp-receipt__img"
              style={typeof reward.image === 'string' && reward.image.startsWith('http')
                ? { width: '140%', objectFit: 'contain', transform: 'translate(-14%, -20%)' }
                : undefined}
            />
          </div>
          <div className="sp-receipt__header-info">
            <span className="sp-receipt__reward-name">{reward.name}</span>
            <span className="sp-receipt__cashback-amount">€{cashback} cashback</span>
          </div>
        </div>

        <div className="sp-receipt__dashed" />

        <div className="sp-receipt__rows">
          <ReceiptRow label="Date" value={formatDate(now)} />
          <ReceiptRow label="Name" value={userName} />
          {userEmail && <ReceiptRow label="Email" value={userEmail} />}
          <ReceiptRow label="Cups redeemed" value={`${reward.cupsNeeded} cup${reward.cupsNeeded !== 1 ? 's' : ''}`} />
        </div>
      </div>

      {/* ── Notify me when it's ready ── */}
      <div className="sp-notify">
        <span className="sp-notify__title">Tell me when my cashback is ready</span>

        <button type="button" className="sp-notify__opt" onClick={toggleEmail}>
          <span className="sp-notify__opt-icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="5" width="18" height="14" rx="2"/><polyline points="3 7 12 13 21 7"/>
            </svg>
          </span>
          <span className="sp-notify__opt-main">
            <span className="sp-notify__opt-label">Email me</span>
            <span className="sp-notify__opt-sub">{userEmail ? `We'll email ${userEmail}` : 'Add your email to get notified'}</span>
          </span>
          <span className={`sp-notify__check${notifyEmail ? ' is-on' : ''}`} aria-hidden="true" />
        </button>

        {pushSupported && (
          <button
            type="button"
            className="sp-notify__opt"
            onClick={togglePush}
            disabled={pushPerm === 'denied'}
          >
            <span className="sp-notify__opt-icon" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>
              </svg>
            </span>
            <span className="sp-notify__opt-main">
              <span className="sp-notify__opt-label">Notify me on this device</span>
              <span className="sp-notify__opt-sub">
                {pushPerm === 'denied'
                  ? 'Notifications are blocked in your browser settings'
                  : needsInstall
                    ? 'On iPhone, add PackPerks to your Home Screen first'
                    : 'A browser push notification'}
              </span>
            </span>
            <span className={`sp-notify__check${notifyPush ? ' is-on' : ''}`} aria-hidden="true" />
          </button>
        )}
      </div>

      <button className="success-page__btn" onClick={onDone}>
        Back to home
      </button>
    </div>
  );
}
