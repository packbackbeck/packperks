import { useEffect } from 'react';
import { useAuth } from './AuthContext';
import { useOrg } from '../context/OrgContext';
import packperksLogo from '../../assets/images/packperks-logo.svg';
import './WelcomeSplash.css';

const ROLE_COPY = {
  owner:   'Full control — the buck stops with you.',
  admin:   'Full operational access — invite teammates, edit org, approve claims.',
  manager: 'Approve claims, generate cup QR codes, and edit rewards.',
  checker: 'Read-only access — view dashboards and export reports.',
};

/* Brief "you're in" landing card shown the first time after sign-in
 * (right after ProfileSetup, or right after sign-in for returning
 * users on first session). Auto-dismisses after a few seconds so it
 * doesn't get in the way of the dashboard. */
export default function WelcomeSplash({ onDone, autoMs = 3500 }) {
  const { profile } = useAuth();
  const { activeOrg } = useOrg();
  const name = profile?.display_name || profile?.email?.split('@')[0] || 'there';
  const brandLabel = activeOrg?.partner_brand_name || activeOrg?.name || 'PackPerks';

  useEffect(() => {
    if (!autoMs) return;
    const t = setTimeout(() => onDone?.(), autoMs);
    return () => clearTimeout(t);
  }, [autoMs, onDone]);

  return (
    <div className="ws-page">
      <div className="ws-card">
        <div className="ws-brands">
          <img src={packperksLogo} alt="PackPerks" className="ws-brands__pp" />
          {activeOrg?.logo_url ? (
            <>
              <span className="ws-brands__x">×</span>
              <img src={activeOrg.logo_url} alt={brandLabel} className="ws-brands__bk" />
            </>
          ) : null}
        </div>

        <div
          className="ws-avatar"
          style={{ background: profile?.color || '#FD6F46' }}
        >
          {profile?.avatar_url ? (
            <img src={profile.avatar_url} alt="" />
          ) : (
            <span>{(name || '?')[0].toUpperCase()}</span>
          )}
        </div>

        <h1 className="ws-title">Welcome, {name}!</h1>
        <p className="ws-sub">
          You're now signed in to the <strong>{brandLabel}</strong> admin console.
        </p>

        {profile?.role && (
          <div className="ws-role">
            <span className="ws-role__pill">{profile.role}</span>
            <span className="ws-role__copy">{ROLE_COPY[profile.role]}</span>
          </div>
        )}

        <button type="button" className="ws-btn" onClick={onDone}>
          Continue to dashboard →
        </button>
      </div>
    </div>
  );
}
