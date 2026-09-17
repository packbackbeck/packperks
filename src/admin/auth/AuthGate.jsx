import { useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import LoginPage from './LoginPage';
import ResetPasswordPage from './ResetPasswordPage';
import ProfileSetup from './ProfileSetup';
import WelcomeSplash from './WelcomeSplash';
import './AuthGate.css';

// Files in public/ are served from the site root, not imported.
const packperksMark = '/favicon.svg';

/* AuthGate — the single decision point in front of the admin app.
 *
 * State machine:
 *   loading          → splash spinner
 *   unauthenticated  → <LoginPage />
 *   authenticated    → first run? show ProfileSetup → WelcomeSplash → app
 *                      returning user? render the app immediately
 *
 * "First run" is heuristically: profile has no display_name AND no avatar
 * (i.e. they haven't customised anything yet). Setting these in the
 * onboarding wizard flips the heuristic. The user can always re-edit
 * later from the top-bar profile menu. */
export default function AuthGate({ children }) {
  const { status, profile, recovering, endRecovery, signOut } = useAuth();
  const [setupDone, setSetupDone]   = useState(false);
  const [welcomeDone, setWelcomeDone] = useState(false);

  // Reset onboarding flags whenever a different user signs in.
  useEffect(() => {
    setSetupDone(false);
    setWelcomeDone(false);
  }, [profile?.id]);

  // A password-reset link was opened — show the set-new-password screen before
  // any other routing (the recovery session would otherwise fall through to the
  // app or, for a non-team account, bounce to the login screen).
  if (recovering) {
    return (
      <ResetPasswordPage
        onFinish={async () => { try { await signOut(); } catch { /* ignore */ } endRecovery(); }}
      />
    );
  }

  if (status === 'loading') {
    return (
      <div className="ag-loading" role="status" aria-live="polite">
        <img src={packperksMark} alt="" className="ag-loading__mark" />
        <span className="ag-loading__bar" aria-hidden="true"><span /></span>
        <span className="ag-loading__label">Opening the dashboard…</span>
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return <LoginPage />;
  }

  // Authenticated + has profile. Decide if we owe them onboarding.
  const needsSetup = profile && !profile.display_name && !profile.avatar_url;

  if (needsSetup && !setupDone) {
    return <ProfileSetup onDone={() => setSetupDone(true)} />;
  }

  // Show the welcome splash once per session (until dismissed).
  const isFirstRun = needsSetup; // they just came out of setup
  if (isFirstRun && setupDone && !welcomeDone) {
    return <WelcomeSplash onDone={() => setWelcomeDone(true)} />;
  }

  return children;
}
