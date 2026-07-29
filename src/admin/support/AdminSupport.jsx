import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import QuickLinks from '../shared/QuickLinks';
import './AdminSupport.css';

/* ─────────────────────────────────────────────────────────────────────
 * AdminSupport — single-page help center for the dashboard.
 *
 * Sections:
 *   1. Hero — quick "talk to us" CTA + jump links
 *   2. Resource cards — links to the public PackBack website / docs
 *   3. Contact form — generic question, mails info@packback.network
 *   4. Feedback form — what's working / what's not
 *   5. Feature request form — separated from feedback so PMs can triage
 *   6. Changelog — what we've shipped in the dashboard, sorted newest-first
 *   7. Contact card — PackBack address, hours, social links
 *
 * The three forms (contact / feedback / feature) all share the same
 * underlying flow: build a structured email body and open `mailto:` so
 * the admin's mail client takes over delivery. No server round-trip
 * required for this stage — and the structured subject prefix makes
 * inbound triage trivial. */

const SUPPORT_EMAIL = 'info@packback.network';
const FEEDBACK_EMAIL = 'feedback@packback.network';
const FEATURE_EMAIL = 'product@packback.network';

/* The Bring Your Own guidebook ships as a static page under public/ so it
 * is served in dev + production at the same path (outside the SPA router). */
const GUIDE_URL = '/admin-guide/index.html';

/* ── Static content blocks ───────────────────────────────────────── */

const RESOURCE_LINKS = [
  {
    label: 'PackBack website',
    href: 'https://packback.network',
    tone: 'purple',
    desc: 'Company homepage — mission, partners, press.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
    ),
  },
  {
    label: 'Admin documentation',
    href: 'https://packback.network/docs',
    tone: 'orange',
    desc: 'How to run the cashback programme end-to-end.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
    ),
  },
  {
    label: 'Status page',
    href: 'https://status.packback.network',
    tone: 'cream',
    desc: 'Live uptime + planned maintenance windows.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
  },
  {
    label: 'Privacy & legal',
    href: 'https://packback.network/legal',
    tone: 'slate',
    desc: 'Privacy policy, terms of service, DPA.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
  },
];

const CHANGELOG = [
  {
    date: '2026-05-14',
    tag: 'Improved',
    tone: 'purple',
    title: 'Top-right workflow controls + auto-save',
    body: 'Settings, Help, History, Preview and Publish moved into a static Framer-style top bar. Every edit now auto-saves to your local draft — no more Save button.',
  },
  {
    date: '2026-05-14',
    tag: 'New',
    tone: 'orange',
    title: 'Quick links on every page',
    body: 'Each dashboard page now ends with cards linking to the next most-relevant sections, so common workflows (Claims → Cup Scans → Transactions) are one click apart.',
  },
  {
    date: '2026-05-14',
    tag: 'Improved',
    tone: 'cream',
    title: 'User insights on Overview',
    body: 'Device-type donut, hourly-return histogram, and a top-returners leaderboard now sit at the bottom of the Overview page.',
  },
  {
    date: '2026-05-12',
    tag: 'New',
    tone: 'orange',
    title: 'Email + device columns in Users table',
    body: 'The Users page now shows each customer\'s registered email and classified device type (iPhone, Android, Mac, Windows…) right in the table.',
  },
  {
    date: '2026-05-12',
    tag: 'Improved',
    tone: 'purple',
    title: 'Smarter search bar',
    body: 'The dashboard search now indexes inner-page actions — try searching "cashback rate", "bulk approve", or "adjust balance".',
  },
  {
    date: '2026-05-08',
    tag: 'Fixed',
    tone: 'slate',
    title: 'Receipt review JWT errors',
    body: 'Edge functions no longer reject Authorization headers from the user app — receipts pass through verification cleanly.',
  },
];

/* ── Form helpers ────────────────────────────────────────────────── */

/* Best-effort browser/OS/device fingerprint string for the auto-attached
 * context block. We deliberately keep this short — nobody wants to read
 * a full UA string at the top of a support ticket. */
function detectClient() {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent || '';
  let browser = 'browser';
  if (/Edg\//.test(ua))      browser = 'Edge';
  else if (/Chrome\//.test(ua) && !/Edg|OPR/.test(ua)) browser = 'Chrome';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Safari\//.test(ua) && !/Chrome/.test(ua)) browser = 'Safari';
  let os = 'unknown OS';
  if (/Mac OS X/.test(ua))   os = 'macOS';
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/Linux/.test(ua)) os = 'Linux';
  else if (/iPhone|iPad/.test(ua)) os = 'iOS';
  else if (/Android/.test(ua)) os = 'Android';
  return `${browser} · ${os}`;
}

/* Build the context footer auto-appended to every support email.
 *
 * The external review called out that the previous form sent a bare
 * mailto with only what the user typed — when a bug report lands at
 * info@packback.network the responder has no idea which org, which
 * role, which page, or which browser the admin was using. This footer
 * solves that for ~10 lines of code. Nothing here is sensitive that
 * the admin wouldn't be willing to disclose to support. */
function buildContextFooter({ profile, page = 'support' }) {
  return [
    '',
    '— Context (auto-attached) —',
    `User:       ${profile?.display_name || profile?.email || 'unknown'}`,
    `Role:       ${profile?.role || 'unknown'}`,
    `Org:        ${profile?.org_name || profile?.org_id || 'unknown'}`,
    `Page:       PackPerks Admin · /#${page}`,
    `Client:     ${detectClient()}`,
    `When:       ${new Date().toISOString()}`,
    `Build:      ${typeof window !== 'undefined' ? window.location.host : ''}`,
  ];
}

function openMailto({ to, subject, lines }) {
  const body = lines.filter(l => l !== null && l !== undefined).join('\n');
  const url = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  window.location.href = url;
}

/* ── Page ────────────────────────────────────────────────────────── */

export default function AdminSupport({ onNavigate }) {
  const { profile } = useAuth();
  return (
    <div className="admin-support">
      {/* Hero */}
      <header className="sup-hero">
        <div className="sup-hero__text">
          <span className="sup-hero__eyebrow">Support</span>
          <h1 className="sup-hero__title">We're here when something breaks — or when you have ideas.</h1>
          <p className="sup-hero__sub">
            Reach the PackBack team directly, browse the help docs, or send
            structured feedback below. Most replies land within one business day.
          </p>
          <div className="sup-hero__cta-row">
            <a href="/vendor-support" className="sup-btn sup-btn--primary">
              Open the support form
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </a>
            <a href="#sup-changelog" className="sup-btn sup-btn--ghost">
              See what's new
            </a>
          </div>
        </div>
        <div className="sup-hero__art" aria-hidden>
          <span className="sup-hero__art-ring sup-hero__art-ring--1" />
          <span className="sup-hero__art-ring sup-hero__art-ring--2" />
          <span className="sup-hero__art-glyph">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
            </svg>
          </span>
        </div>
      </header>

      {/* Resource cards */}
      <section className="sup-section">
        <header className="sup-section__header">
          <h2 className="sup-section__title">Resources</h2>
          <p className="sup-section__sub">External links to the PackBack site and docs.</p>
        </header>
        <div className="sup-resources">
          {RESOURCE_LINKS.map(r => (
            <a
              key={r.href}
              href={r.href}
              target="_blank"
              rel="noopener noreferrer"
              className={`sup-resource sup-resource--${r.tone}`}
            >
              <span className="sup-resource__icon">{r.icon}</span>
              <span className="sup-resource__body">
                <span className="sup-resource__label">{r.label}</span>
                <span className="sup-resource__desc">{r.desc}</span>
              </span>
              <svg className="sup-resource__arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="7" y1="17" x2="17" y2="7" />
                <polyline points="7 7 17 7 17 17" />
              </svg>
            </a>
          ))}
        </div>
      </section>

      {/* Bring Your Own guidebook — the full admin walkthrough, embedded
       *  inline. Served as a static page from /admin-guide so it works in
       *  production too; the button opens it full-screen in a new tab. */}
      <section className="sup-section" id="sup-guide">
        <header className="sup-section__header">
          <h2 className="sup-section__title">Bring Your Own guidebook</h2>
          <p className="sup-section__sub">
            A step-by-step walkthrough of the whole dashboard — from approving cup
            scans to setting up rewards and reading your reports.
          </p>
        </header>
        <div className="sup-guide">
          <div className="sup-guide__bar">
            <span className="sup-guide__bar-label">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
              </svg>
              Bring Your Own guidebook
            </span>
            <a href={GUIDE_URL} target="_blank" rel="noopener noreferrer" className="sup-btn sup-btn--ghost sup-btn--sm">
              Open full guide
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <line x1="7" y1="17" x2="17" y2="7" />
                <polyline points="7 7 17 7 17 17" />
              </svg>
            </a>
          </div>
          <iframe className="sup-guide__frame" src={GUIDE_URL} title="Bring Your Own guidebook" loading="lazy" />
        </div>
      </section>

      {/* Forms — three stacked columns on wide, single column on narrow */}
      <section className="sup-section">
        <header className="sup-section__header">
          <h2 className="sup-section__title">Get in touch</h2>
          <p className="sup-section__sub">
            All three forms open your mail client with a prefilled message —
            sent straight to the right inbox at PackBack. Every send
            includes a short context footer with your role, organisation,
            browser, and the page you were on, so we can triage faster.
          </p>
        </header>

        <div className="sup-forms">
          <ContactForm profile={profile} />
          <FeedbackForm profile={profile} />
          <FeatureRequestForm profile={profile} />
        </div>
      </section>

      {/* Changelog */}
      <section className="sup-section" id="sup-changelog">
        <header className="sup-section__header">
          <h2 className="sup-section__title">What's new in the dashboard</h2>
          <p className="sup-section__sub">
            Updates we've shipped to PackPerks Admin, newest first.
          </p>
        </header>

        <ol className="sup-changelog">
          {CHANGELOG.map((entry, i) => (
            <li key={i} className="sup-changelog__item">
              <div className="sup-changelog__rail">
                <span className={`sup-changelog__dot sup-changelog__dot--${entry.tone}`} />
                {i < CHANGELOG.length - 1 && <span className="sup-changelog__line" />}
              </div>
              <div className="sup-changelog__body">
                <div className="sup-changelog__meta">
                  <span className={`sup-changelog__tag sup-changelog__tag--${entry.tone}`}>{entry.tag}</span>
                  <span className="sup-changelog__date">{formatDate(entry.date)}</span>
                </div>
                <h3 className="sup-changelog__title">{entry.title}</h3>
                <p className="sup-changelog__text">{entry.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* Contact card */}
      <section className="sup-contact">
        <div className="sup-contact__col">
          <span className="sup-contact__eyebrow">Talk to a human</span>
          <h2 className="sup-contact__title">PackBack HQ</h2>
          <p className="sup-contact__line">Postjesweg 1, 1057 DT Amsterdam</p>
          <p className="sup-contact__line">The Netherlands</p>
          <p className="sup-contact__line sup-contact__line--muted">Mon–Fri · 09:00–18:00 CET</p>
        </div>
        <div className="sup-contact__col">
          <span className="sup-contact__eyebrow">Direct channels</span>
          <a className="sup-contact__link" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
          <a className="sup-contact__link" href={`mailto:${FEEDBACK_EMAIL}`}>{FEEDBACK_EMAIL}</a>
          <a className="sup-contact__link" href={`mailto:${FEATURE_EMAIL}`}>{FEATURE_EMAIL}</a>
        </div>
        <div className="sup-contact__col">
          <span className="sup-contact__eyebrow">Follow PackBack</span>
          <a className="sup-contact__link" href="https://linkedin.com/company/packback" target="_blank" rel="noopener noreferrer">LinkedIn</a>
          <a className="sup-contact__link" href="https://instagram.com/packback.network" target="_blank" rel="noopener noreferrer">Instagram</a>
          <a className="sup-contact__link" href="https://packback.network/press" target="_blank" rel="noopener noreferrer">Press kit</a>
        </div>
      </section>

      <QuickLinks currentPage="support" onNavigate={onNavigate} links={['overview', 'settings', 'history', 'org']} />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
 * Form subcomponents — all three share the same shell + structured
 * mailto handler. Separating them gives each its own labels/placeholders
 * and lets us route to a different inbox without branching logic. */

function ContactForm({ profile }) {
  const [topic, setTopic] = useState('Bug or unexpected behaviour');
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);

  function handleSubmit(e) {
    e.preventDefault();
    if (!message.trim()) return;
    openMailto({
      to: SUPPORT_EMAIL,
      subject: `[Support · ${topic}] PackPerks Dashboard`,
      lines: [
        `Topic: ${topic}`,
        '',
        message,
        ...buildContextFooter({ profile, page: 'support' }),
      ],
    });
    setSent(true);
    setTimeout(() => setSent(false), 4000);
  }

  return (
    <form className="sup-form" onSubmit={handleSubmit}>
      <div className="sup-form__head">
        <span className="sup-form__icon sup-form__icon--purple">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
          </svg>
        </span>
        <div>
          <h3 className="sup-form__title">Contact support</h3>
          <p className="sup-form__sub">Bug reports, account issues, or anything urgent.</p>
        </div>
      </div>

      <label className="sup-field">
        <span className="sup-field__label">Topic</span>
        <select className="sup-input" value={topic} onChange={e => setTopic(e.target.value)}>
          <option>Bug or unexpected behaviour</option>
          <option>Account or login problem</option>
          <option>Billing</option>
          <option>Question about a feature</option>
          <option>Something else</option>
        </select>
      </label>

      <label className="sup-field">
        <span className="sup-field__label">What's going on?</span>
        <textarea
          className="sup-input sup-input--textarea"
          rows={5}
          placeholder="Describe what happened, what you expected, and any steps to reproduce…"
          value={message}
          onChange={e => setMessage(e.target.value)}
        />
      </label>

      <button type="submit" className="sup-btn sup-btn--primary sup-btn--block" disabled={!message.trim()}>
        {sent ? 'Mail client opened ✓' : `Send to ${SUPPORT_EMAIL}`}
      </button>
    </form>
  );
}

function FeedbackForm({ profile }) {
  const [working, setWorking] = useState('');
  const [notWorking, setNotWorking] = useState('');
  const [sent, setSent] = useState(false);

  function handleSubmit(e) {
    e.preventDefault();
    if (!working.trim() && !notWorking.trim()) return;
    openMailto({
      to: FEEDBACK_EMAIL,
      subject: '[Feedback] PackPerks Dashboard',
      lines: [
        "## What's working well",
        working.trim() || '(no notes)',
        '',
        "## What's not working / could be better",
        notWorking.trim() || '(no notes)',
        ...buildContextFooter({ profile, page: 'support' }),
      ],
    });
    setSent(true);
    setTimeout(() => setSent(false), 4000);
  }

  return (
    <form className="sup-form" onSubmit={handleSubmit}>
      <div className="sup-form__head">
        <span className="sup-form__icon sup-form__icon--orange">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 9V5a3 3 0 0 0-6 0v4" />
            <rect x="2" y="9" width="20" height="11" rx="2" />
          </svg>
        </span>
        <div>
          <h3 className="sup-form__title">Share feedback</h3>
          <p className="sup-form__sub">Tell us what's great and what's frustrating.</p>
        </div>
      </div>

      <label className="sup-field">
        <span className="sup-field__label">What's working well?</span>
        <textarea
          className="sup-input sup-input--textarea"
          rows={3}
          placeholder="A feature you love, a workflow that saves you time…"
          value={working}
          onChange={e => setWorking(e.target.value)}
        />
      </label>

      <label className="sup-field">
        <span className="sup-field__label">What could be better?</span>
        <textarea
          className="sup-input sup-input--textarea"
          rows={3}
          placeholder="Friction points, confusing labels, missing affordances…"
          value={notWorking}
          onChange={e => setNotWorking(e.target.value)}
        />
      </label>

      <button type="submit" className="sup-btn sup-btn--secondary sup-btn--block" disabled={!working.trim() && !notWorking.trim()}>
        {sent ? 'Mail client opened ✓' : `Send to ${FEEDBACK_EMAIL}`}
      </button>
    </form>
  );
}

function FeatureRequestForm({ profile }) {
  const [title, setTitle] = useState('');
  const [problem, setProblem] = useState('');
  const [proposal, setProposal] = useState('');
  const [priority, setPriority] = useState('Nice to have');
  const [sent, setSent] = useState(false);

  function handleSubmit(e) {
    e.preventDefault();
    if (!title.trim() || !problem.trim()) return;
    openMailto({
      to: FEATURE_EMAIL,
      subject: `[Feature request · ${priority}] ${title}`,
      lines: [
        `Title: ${title}`,
        `Priority: ${priority}`,
        '',
        '## Problem',
        problem,
        '',
        '## Proposed solution',
        proposal || '(none yet — open to ideas)',
        ...buildContextFooter({ profile, page: 'support' }),
      ],
    });
    setSent(true);
    setTimeout(() => setSent(false), 4000);
  }

  return (
    <form className="sup-form" onSubmit={handleSubmit}>
      <div className="sup-form__head">
        <span className="sup-form__icon sup-form__icon--cream">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a7 7 0 0 0-7 7c0 2.5 1.5 4.5 3 6v3a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-3c1.5-1.5 3-3.5 3-6a7 7 0 0 0-7-7z" />
            <line x1="9" y1="22" x2="15" y2="22" />
          </svg>
        </span>
        <div>
          <h3 className="sup-form__title">Request a feature</h3>
          <p className="sup-form__sub">Pitch us on something we should build next.</p>
        </div>
      </div>

      <label className="sup-field">
        <span className="sup-field__label">Title</span>
        <input
          className="sup-input"
          placeholder="Bulk approve claims by location"
          value={title}
          onChange={e => setTitle(e.target.value)}
        />
      </label>

      <label className="sup-field">
        <span className="sup-field__label">What problem does it solve?</span>
        <textarea
          className="sup-input sup-input--textarea"
          rows={3}
          placeholder="Right now I have to click each claim individually…"
          value={problem}
          onChange={e => setProblem(e.target.value)}
        />
      </label>

      <label className="sup-field">
        <span className="sup-field__label">How would you imagine it working?</span>
        <textarea
          className="sup-input sup-input--textarea"
          rows={3}
          placeholder="(Optional) Sketch the ideal flow — we'll fill in the details."
          value={proposal}
          onChange={e => setProposal(e.target.value)}
        />
      </label>

      <label className="sup-field">
        <span className="sup-field__label">Priority for you</span>
        <select className="sup-input" value={priority} onChange={e => setPriority(e.target.value)}>
          <option>Nice to have</option>
          <option>Would meaningfully improve my work</option>
          <option>Blocking me / my team right now</option>
        </select>
      </label>

      <button type="submit" className="sup-btn sup-btn--ghost sup-btn--block" disabled={!title.trim() || !problem.trim()}>
        {sent ? 'Mail client opened ✓' : `Send to ${FEATURE_EMAIL}`}
      </button>
    </form>
  );
}

function formatDate(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}
