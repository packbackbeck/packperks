import { useState } from 'react';
import CookieConsent, { CookieBlocked } from './CookieConsent';
import PrivacyPolicyView from './PrivacyPolicyView';
import { getConsent, setConsent, clearConsent } from '../lib/consent';

/* Wraps the customer app: shows the first-run cookie banner, blocks the app on
 * "Reject" (essential cookies are required), and lets the user reopen the
 * choice. Never deletes anything — cups already earned stay put. The admin app
 * is exempt (staff). Analytics gating itself lives in utils/analytics.js. */
export default function ConsentGate({ children }) {
  const [consent, setLocal] = useState(() => getConsent());
  const [showPolicy, setShowPolicy] = useState(false);

  const choose = (level) => { setConsent(level); setLocal(level); };
  const policyModal = showPolicy ? <PrivacyPolicyView onClose={() => setShowPolicy(false)} /> : null;

  if (consent === 'rejected') {
    return (
      <>
        <CookieBlocked onReconsider={() => { clearConsent(); setLocal(null); }} />
        {policyModal}
      </>
    );
  }

  return (
    <>
      {children}
      {!consent && <CookieConsent onChoose={choose} onPolicy={() => setShowPolicy(true)} />}
      {policyModal}
    </>
  );
}
