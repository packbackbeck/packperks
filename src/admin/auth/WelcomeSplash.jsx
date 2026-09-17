import { useEffect } from 'react';
import { ArrowRight } from 'lucide-react';
import { useAuth } from './AuthContext';
import packperksLogo from '../../assets/images/packperks-logo.svg';
import './WelcomeSplash.css';

/* What each level can do, in one line. The role name comes from the
 * account; older accounts only carry the old role name. */
const LEVEL_COPY = {
  master: { label: 'Master', copy: 'Everything, including people, roles and organisations.' },
  manager: { label: 'Manager', copy: 'Runs your organisations: claims, rewards, customers and settings, as your role allows.' },
  vendor: { label: 'Vendor', copy: 'How your venue is doing: the dashboard, reports and customer behaviour.' },
};
const LEGACY_LEVEL = { owner: 'master', admin: 'master', manager: 'manager', checker: 'manager', vendor: 'vendor' };

/* Brief "you're in" card shown once, right after the first-run profile
 * setup. Auto-dismisses after a few seconds. Rendered before the dashboard
 * shell (and its organisation context), so it only uses the account. */
export default function WelcomeSplash({ onDone, autoMs = 3500 }) {
  const { profile } = useAuth();
  const name = profile?.display_name || profile?.email?.split('@')[0] || 'there';
  const level = LEVEL_COPY[profile?.access_role === 'master' ? 'master' : LEGACY_LEVEL[profile?.role]] || null;

  useEffect(() => {
    if (!autoMs) return undefined;
    const t = setTimeout(() => onDone?.(), autoMs);
    return () => clearTimeout(t);
  }, [autoMs, onDone]);

  return (
    <div className="ws-page">
      <div className="ws-card">
        <img src={packperksLogo} alt="PackPerks" className="ws-logo" />

        <div className="ws-avatar" style={{ background: profile?.color || '#5B3FD6' }}>
          {profile?.avatar_url ? <img src={profile.avatar_url} alt="" /> : <span>{(name || '?')[0].toUpperCase()}</span>}
        </div>

        <h1 className="ws-title">Welcome, {name}</h1>
        <p className="ws-sub">You’re signed in to the PackPerks dashboard.</p>

        {level && (
          <div className="ws-role">
            <span className="ws-role__pill">{level.label}</span>
            <span className="ws-role__copy">{level.copy}</span>
          </div>
        )}

        <button type="button" className="ws-btn" onClick={onDone}>
          Go to the dashboard
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
