import { useId, useState } from 'react';
import {
  ArrowUpRight, BookOpen, Check, Clock, Globe, Lightbulb, LifeBuoy, Mail, MapPin,
  MessageCircle, MessageSquareHeart, Newspaper, Send, ShieldCheck, Sparkles,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { Badge, Button, Card, CardBody, CardHeader, Field, PageHeader } from '../ui';
import './AdminSupport.css';

/* ─────────────────────────────────────────────────────────────────────
 * AdminSupport — single-page help center for the dashboard.
 *
 * Sections:
 *   1. Page header — the support form and "What's new" jump
 *   2. Resource tiles — links to the public PackBack website / docs
 *   3. Bring Your Own guidebook — embedded static guide
 *   4. Contact / feedback / feature request forms
 *   5. Changelog — what we've shipped in the dashboard, sorted newest-first
 *   6. Contact card — PackBack address, hours, social links
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
    tone: 'violet',
    icon: Globe,
    desc: 'Our mission, partners and press.',
  },
  {
    label: 'Admin documentation',
    href: 'https://packback.network/docs',
    tone: 'orange',
    icon: BookOpen,
    desc: 'How to run the programme, step by step.',
  },
  {
    label: 'Status page',
    href: 'https://status.packback.network',
    tone: 'emerald',
    icon: Clock,
    desc: 'Live uptime and planned maintenance.',
  },
  {
    label: 'Privacy & legal',
    href: 'https://packback.network/legal',
    tone: 'slate',
    icon: ShieldCheck,
    desc: 'Privacy policy, terms and data agreement.',
  },
];

/* Tag → badge tone. */
const TAG_TONE = { New: 'primary', Improved: 'info', Fixed: 'success' };

const CHANGELOG = [
  {
    date: '2026-09-17',
    tag: 'New',
    title: 'A new look for the dashboard',
    body: 'Dashboard, System health and User behaviour share one layout: headline tiles, a trend chart you drive from the tiles, and what stands out beside it. Every other page follows the same design.',
  },
  {
    date: '2026-09-17',
    tag: 'New',
    title: 'Roles and Master Settings',
    body: 'Masters add people, decide per tab what each role can see or change, and manage organisations, groups, regions and the workspace in one place.',
  },
  {
    date: '2026-09-17',
    tag: 'Improved',
    title: 'A simpler top bar',
    body: 'The top bar shows the venue’s programme, search, what a returned cup pays, Preview and Publish. Masters choose which of these it shows.',
  },
  {
    date: '2026-05-12',
    tag: 'New',
    title: 'Email + device columns in Users table',
    body: 'The Users page now shows each customer\'s registered email and classified device type (iPhone, Android, Mac, Windows…) right in the table.',
  },
  {
    date: '2026-05-12',
    tag: 'Improved',
    title: 'Smarter search bar',
    body: 'The dashboard search now indexes inner-page actions — try searching "cashback rate", "bulk approve", or "adjust balance".',
  },
  {
    date: '2026-05-08',
    tag: 'Fixed',
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

export default function AdminSupport() {
  const { profile } = useAuth();
  /* The dashboard routes on the URL hash, so an in-page #anchor would
   * navigate away. Scroll instead. */
  const showChangelog = () => {
    document.getElementById('sup-changelog')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="ui-page sup-page">
      <PageHeader
        title="Help & support"
        subtitle="Something broken, or an idea? Reach the PackBack team, read the guide or send us feedback. Most replies arrive within one business day."
      >
        <Button icon={Sparkles} onClick={showChangelog}>What’s new</Button>
        <a href="/vendor-support" className="ui-btn ui-btn--primary">
          <LifeBuoy size={15} aria-hidden="true" />
          Open the support form
        </a>
      </PageHeader>

      {/* Resources */}
      <Card>
        <CardHeader
          title="Resources"
          icon={Globe}
          subtitle="The PackBack website and documentation. Links open in a new tab."
        />
        <CardBody>
          <div className="sup-resources">
            {RESOURCE_LINKS.map(r => {
              const Icon = r.icon;
              return (
                <a key={r.href} href={r.href} target="_blank" rel="noopener noreferrer" className="sup-resource">
                  <span className={`sup-resource__icon ui-tone--${r.tone}`} aria-hidden="true"><Icon size={18} /></span>
                  <span className="sup-resource__text">
                    <span className="sup-resource__label">{r.label}</span>
                    <span className="sup-resource__desc">{r.desc}</span>
                  </span>
                  <ArrowUpRight className="sup-resource__arrow" size={15} aria-hidden="true" />
                </a>
              );
            })}
          </div>
        </CardBody>
      </Card>

      {/* Bring Your Own guidebook — the full admin walkthrough, embedded
       *  inline. Served as a static page from /admin-guide so it works in
       *  production too; the button opens it full-screen in a new tab. */}
      <Card id="sup-guide" className="sup-guide">
        <CardHeader
          title="Bring Your Own guidebook"
          icon={BookOpen}
          subtitle="A step-by-step walkthrough of the dashboard, from approving cup scans to setting up rewards and reading your reports."
          ruled
          actions={(
            <a href={GUIDE_URL} target="_blank" rel="noopener noreferrer" className="ui-btn ui-btn--outline ui-btn--sm">
              Open full guide
              <ArrowUpRight size={14} aria-hidden="true" />
            </a>
          )}
        />
        <iframe className="sup-guide__frame" src={GUIDE_URL} title="Bring Your Own guidebook" loading="lazy" />
      </Card>

      {/* Forms */}
      <section className="sup-section" aria-labelledby="sup-touch">
        <div className="sup-section__head">
          <h2 id="sup-touch" className="ui-section-label sup-section__label">Get in touch</h2>
          <p className="sup-section__sub">
            Each form opens your email app with the message written out and addressed to the right
            team. It adds a short footer with your role, organisation, browser and the page you were
            on, so we can help faster.
          </p>
        </div>
        <div className="sup-forms">
          <ContactForm profile={profile} />
          <FeedbackForm profile={profile} />
          <FeatureRequestForm profile={profile} />
        </div>
      </section>

      {/* Changelog */}
      <Card id="sup-changelog" className="sup-changelog-card">
        <CardHeader
          title="What’s new in the dashboard"
          icon={Newspaper}
          subtitle="Updates we’ve shipped to the PackPerks dashboard, newest first."
          ruled
        />
        <CardBody>
          <ol className="sup-changelog">
            {CHANGELOG.map((entry, i) => {
              const tone = TAG_TONE[entry.tag] || 'neutral';
              return (
                <li key={i} className="sup-changelog__item">
                  <span className={`sup-changelog__dot sup-changelog__dot--${tone}`} aria-hidden="true" />
                  <div className="sup-changelog__body">
                    <div className="sup-changelog__meta">
                      <Badge tone={tone}>{entry.tag}</Badge>
                      <time className="sup-changelog__date" dateTime={entry.date}>{formatDate(entry.date)}</time>
                    </div>
                    <h3 className="sup-changelog__title">{entry.title}</h3>
                    <p className="sup-changelog__text">{entry.body}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </CardBody>
      </Card>

      {/* Contact card */}
      <Card className="sup-contact">
        <div className="sup-contact__col">
          <span className="sup-contact__label"><MapPin size={13} aria-hidden="true" />Talk to a person</span>
          <h2 className="sup-contact__title">PackBack HQ</h2>
          <p className="sup-contact__line">Postjesweg 1, 1057 DT Amsterdam</p>
          <p className="sup-contact__line">The Netherlands</p>
          <p className="sup-contact__line sup-contact__line--muted">Mon–Fri · 09:00–18:00 CET</p>
        </div>
        <div className="sup-contact__col">
          <span className="sup-contact__label"><Mail size={13} aria-hidden="true" />Email us directly</span>
          <a className="sup-contact__link" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
          <a className="sup-contact__link" href={`mailto:${FEEDBACK_EMAIL}`}>{FEEDBACK_EMAIL}</a>
          <a className="sup-contact__link" href={`mailto:${FEATURE_EMAIL}`}>{FEATURE_EMAIL}</a>
        </div>
        <div className="sup-contact__col">
          <span className="sup-contact__label"><Globe size={13} aria-hidden="true" />Follow PackBack</span>
          <a className="sup-contact__link" href="https://linkedin.com/company/packback" target="_blank" rel="noopener noreferrer">LinkedIn</a>
          <a className="sup-contact__link" href="https://instagram.com/packback.network" target="_blank" rel="noopener noreferrer">Instagram</a>
          <a className="sup-contact__link" href="https://packback.network/press" target="_blank" rel="noopener noreferrer">Press kit</a>
        </div>
      </Card>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
 * Form subcomponents — all three share the same card + structured
 * mailto handler. Separating them gives each its own labels/placeholders
 * and lets us route to a different inbox without branching logic. */

function FormCard({ icon: Icon, tone, title, subtitle, onSubmit, to, sent, disabled, children }) {
  return (
    <Card as="form" className="sup-form" onSubmit={onSubmit}>
      <div className="sup-form__head">
        <span className={`sup-form__icon ui-tone--${tone}`} aria-hidden="true"><Icon size={18} /></span>
        <div>
          <h3 className="sup-form__title">{title}</h3>
          <p className="sup-form__sub">{subtitle}</p>
        </div>
      </div>
      <div className="sup-form__fields">{children}</div>
      <div className="sup-form__foot">
        <Button type="submit" variant="primary" block icon={sent ? Check : Send} disabled={disabled}>
          {sent ? 'Email app opened' : 'Open in your email app'}
        </Button>
        <p className="sup-form__to">Addressed to {to}</p>
      </div>
    </Card>
  );
}

function ContactForm({ profile }) {
  const id = useId();
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
    <FormCard
      icon={MessageCircle}
      tone="violet"
      title="Contact support"
      subtitle="Bug reports, account problems, or anything urgent."
      onSubmit={handleSubmit}
      to={SUPPORT_EMAIL}
      sent={sent}
      disabled={!message.trim()}
    >
      <Field label="Topic" htmlFor={`${id}-topic`}>
        <select id={`${id}-topic`} className="ui-select" value={topic} onChange={e => setTopic(e.target.value)}>
          <option>Bug or unexpected behaviour</option>
          <option>Account or login problem</option>
          <option>Billing</option>
          <option>Question about a feature</option>
          <option>Something else</option>
        </select>
      </Field>

      <Field label="What’s going on?" htmlFor={`${id}-message`}>
        <textarea
          id={`${id}-message`}
          className="ui-textarea"
          rows={5}
          placeholder="What happened, what you expected, and the steps that lead to it…"
          value={message}
          onChange={e => setMessage(e.target.value)}
        />
      </Field>
    </FormCard>
  );
}

function FeedbackForm({ profile }) {
  const id = useId();
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
    <FormCard
      icon={MessageSquareHeart}
      tone="orange"
      title="Share feedback"
      subtitle="Tell us what works well and what gets in your way."
      onSubmit={handleSubmit}
      to={FEEDBACK_EMAIL}
      sent={sent}
      disabled={!working.trim() && !notWorking.trim()}
    >
      <Field label="What’s working well?" htmlFor={`${id}-good`}>
        <textarea
          id={`${id}-good`}
          className="ui-textarea"
          rows={3}
          placeholder="A feature you like, a task that got quicker…"
          value={working}
          onChange={e => setWorking(e.target.value)}
        />
      </Field>

      <Field label="What could be better?" htmlFor={`${id}-better`}>
        <textarea
          id={`${id}-better`}
          className="ui-textarea"
          rows={3}
          placeholder="Things that slow you down, labels that confuse, something missing…"
          value={notWorking}
          onChange={e => setNotWorking(e.target.value)}
        />
      </Field>
    </FormCard>
  );
}

function FeatureRequestForm({ profile }) {
  const id = useId();
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
    <FormCard
      icon={Lightbulb}
      tone="amber"
      title="Request a feature"
      subtitle="Tell us what we should build next."
      onSubmit={handleSubmit}
      to={FEATURE_EMAIL}
      sent={sent}
      disabled={!title.trim() || !problem.trim()}
    >
      <Field label="Title" htmlFor={`${id}-title`}>
        <input
          id={`${id}-title`}
          className="ui-input"
          placeholder="Bulk approve claims by location"
          value={title}
          onChange={e => setTitle(e.target.value)}
        />
      </Field>

      <Field label="What problem does it solve?" htmlFor={`${id}-problem`}>
        <textarea
          id={`${id}-problem`}
          className="ui-textarea"
          rows={3}
          placeholder="Right now I have to click each claim individually…"
          value={problem}
          onChange={e => setProblem(e.target.value)}
        />
      </Field>

      <Field label="How would it work?" hint="Optional. Sketch the ideal flow and we’ll fill in the details." htmlFor={`${id}-idea`}>
        <textarea
          id={`${id}-idea`}
          className="ui-textarea"
          rows={3}
          placeholder="I pick a location, tick the claims and approve them in one go…"
          value={proposal}
          onChange={e => setProposal(e.target.value)}
        />
      </Field>

      <Field label="How much does it matter to you?" htmlFor={`${id}-priority`}>
        <select id={`${id}-priority`} className="ui-select" value={priority} onChange={e => setPriority(e.target.value)}>
          <option>Nice to have</option>
          <option>Would meaningfully improve my work</option>
          <option>Blocking me / my team right now</option>
        </select>
      </Field>
    </FormCard>
  );
}

function formatDate(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}
