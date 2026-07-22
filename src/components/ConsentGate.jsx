import { useState, cloneElement, isValidElement } from 'react';
import CookieConsent, { CookieBlocked } from './CookieConsent';
import PrivacyPolicyView from './PrivacyPolicyView';
import { getConsent, setConsent, setConsentPrefs, clearConsent } from '../lib/consent';

/* Wraps the customer app: shows the first-run cookie banner, blocks the app on
 * "Reject" (essential cookies are required), and lets the user reopen the
 * choice. Never deletes anything — cups already earned stay put. The admin app
 * is exempt (staff). Analytics gating itself lives in utils/analytics.js. */
export default function ConsentGate({ children }) {
  const [consent, setLocal] = useState(() => getConsent());
  const [showPolicy, setShowPolicy] = useState(false);

  // Simple choices (Accept all / Essential only) and the granular Customize save
  // both funnel through the consent store; setLocal reads back the DERIVED level
  // ('all' / 'essential' / 'rejected') so unchecking Technical shows the blocked
  // screen.
  const choose = (level) => { setConsent(level); setLocal(getConsent()); };
  const customize = (prefs) => { setConsentPrefs(prefs); setLocal(getConsent()); };
  const policyModal = showPolicy ? <PrivacyPolicyView onClose={() => setShowPolicy(false)} /> : null;

  if (consent === 'rejected') {
    return (
      <>
        <CookieBlocked onReconsider={() => { clearConsent(); setLocal(null); }} />
        {policyModal}
      </>
    );
  }

  // The app renders behind the banner (dimmed) so it feels alive, but the
  // onboarding flow must wait until the visitor has made a cookie choice —
  // pass that readiness down so App doesn't auto-open onboarding first.
  const gatedChildren = isValidElement(children)
    ? cloneElement(children, { consentReady: !!consent })
    : children;

  return (
    <>
      {gatedChildren}
      {!consent && <CookieConsent onChoose={choose} onCustomize={customize} onPolicy={() => setShowPolicy(true)} />}
      {policyModal}
    </>
  );
}
