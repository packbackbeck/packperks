import { useState, useEffect, cloneElement, isValidElement } from 'react';
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
  // Re-opened from the in-app "Manage cookie choices" affordance. We show the
  // banner again IN PLACE (pre-filled with the current choice) rather than
  // clearing consent + reloading — that reload re-bootstrapped the whole app and
  // could strand the user on the "trouble loading your cups" error screen.
  const [reopen, setReopen] = useState(false);
  useEffect(() => {
    const onOpen = () => setReopen(true);
    window.addEventListener('packperks:open-consent', onOpen);
    return () => window.removeEventListener('packperks:open-consent', onOpen);
  }, []);
  // Tikkie-only orgs (smart-bin cashback): the redirect page sets no cookies,
  // creates no account and tracks nothing, so the banner would be pure
  // friction between the customer and their payout. App fires this event
  // when it resolves a tikkie_only org; we simply don't show the banner.
  // Initialise from the window flag too: the event alone can be missed if
  // this component remounts (StrictMode) after App already fired it.
  const [suppressed, setSuppressed] = useState(() => !!window.__ppkSuppressConsent);
  useEffect(() => {
    const onSuppress = () => setSuppressed(true);
    if (window.__ppkSuppressConsent) setSuppressed(true);
    window.addEventListener('packperks:suppress-consent', onSuppress);
    return () => window.removeEventListener('packperks:suppress-consent', onSuppress);
  }, []);

  // Simple choices (Accept all / Essential only) and the granular Customize save
  // both funnel through the consent store; setLocal reads back the DERIVED level
  // ('all' / 'essential' / 'rejected') so unchecking Technical shows the blocked
  // screen.
  const choose = (level) => { setConsent(level); setLocal(getConsent()); setReopen(false); };
  const customize = (prefs) => { setConsentPrefs(prefs); setLocal(getConsent()); setReopen(false); };
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
      {!suppressed && (!consent || reopen) && (
        <CookieConsent
          onChoose={choose}
          onCustomize={customize}
          onPolicy={() => setShowPolicy(true)}
          // Only the re-opened banner can be dismissed without choosing; the
          // first-run gate (no prior consent) stays modal until a choice is made.
          onDismiss={consent && reopen ? () => setReopen(false) : undefined}
        />
      )}
      {policyModal}
    </>
  );
}
