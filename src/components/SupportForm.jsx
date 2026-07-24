import { useState } from 'react';
import { sendSupportMessage } from '../lib/api';
import packperksLogo from '../assets/images/packperks-wordmark.svg';
import './SupportForm.css';

/* Standalone contact-support page (routed in main.jsx at /support for
 * customers and /vendor-support for vendors). Sends to info@packback.network
 * via the send-support edge function; the email subject is tagged
 * USER/VENDOR + topic. */

const TOPICS = {
  user:   ['Complaint', 'Issue', 'Suggestion', 'Question', 'Other'],
  vendor: ['Onboarding', 'Billing', 'Technical issue', 'Suggestion', 'Other'],
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SupportForm({ audience = 'user' }) {
  const isVendor = audience === 'vendor';
  const topics = TOPICS[isVendor ? 'vendor' : 'user'];

  const [topic, setTopic] = useState(topics[0]);
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [message, setMessage] = useState('');
  const [hp, setHp] = useState(''); // honeypot
  const [state, setState] = useState('idle'); // idle | sending | done
  const [error, setError] = useState(null);

  const emailValid = EMAIL_RE.test(email.trim());
  const canSend = emailValid && message.trim().length >= 3 && state !== 'sending';

  async function submit(e) {
    e.preventDefault();
    if (!canSend) return;
    setState('sending'); setError(null);
    try {
      await sendSupportMessage({
        audience: isVendor ? 'vendor' : 'user',
        topic, email: email.trim(), message: message.trim(),
        company: company.trim(), hp,
      });
      setState('done');
    } catch (err) {
      const code = err?.detail?.error || err?.message;
      setError(
        code === 'invalid_email' ? 'That email doesn’t look right. Please check it.'
          : code === 'message_too_short' ? 'Please add a little more detail to your message.'
            : code === 'email_not_configured' ? 'Support email isn’t set up yet. Please email info@packback.network directly.'
              : 'Something went wrong sending your message. Please try again, or email info@packback.network.'
      );
      setState('idle');
    }
  }

  return (
    <div className="sf">
      <div className="sf__card">
        <img className="sf__logo" src={packperksLogo} alt="PackPerks" />

        {state === 'done' ? (
          <div className="sf__done">
            <span className="sf__done-ic" aria-hidden="true">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12l5 5L20 6" /></svg>
            </span>
            <h1 className="sf__title">Message sent</h1>
            <p className="sf__sub">Thanks for reaching out. We’ll get back to you at <strong>{email.trim()}</strong> as soon as we can.</p>
          </div>
        ) : (
          <>
            <div className="sf__head">
              <h1 className="sf__title">{isVendor ? 'Vendor support' : 'Contact support'}</h1>
              <p className="sf__sub">
                {isVendor
                  ? 'Questions about onboarding, billing or the platform? Send us a note and we’ll reply by email.'
                  : 'Stuck, or have something to tell us? Send a quick message and we’ll reply by email.'}
              </p>
            </div>

            <form className="sf__form" onSubmit={submit} noValidate>
              <label className="sf__field">
                <span className="sf__label">Topic</span>
                <select className="sf__input" value={topic} onChange={(e) => setTopic(e.target.value)}>
                  {topics.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>

              {isVendor && (
                <label className="sf__field">
                  <span className="sf__label">Company / café name <span className="sf__opt">(optional)</span></span>
                  <input className="sf__input" type="text" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="La Place" />
                </label>
              )}

              <label className="sf__field">
                <span className="sf__label">Your email</span>
                <input className={`sf__input${email && !emailValid ? ' sf__input--bad' : ''}`} type="email" inputMode="email" autoComplete="email"
                  value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
              </label>

              <label className="sf__field">
                <span className="sf__label">Message</span>
                <textarea className="sf__input sf__textarea" rows={5} value={message} onChange={(e) => setMessage(e.target.value)}
                  placeholder={isVendor ? 'Tell us what you need…' : 'What happened? The more detail, the better.'} maxLength={4000} />
              </label>

              {/* Honeypot — hidden from real users */}
              <input className="sf__hp" tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} aria-hidden="true" />

              {error && <p className="sf__error">{error}</p>}

              <button type="submit" className="sf__submit" disabled={!canSend}>
                {state === 'sending' ? 'Sending…' : 'Send message'}
              </button>
              <p className="sf__foot">Goes straight to <strong>info@packback.network</strong>.</p>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
