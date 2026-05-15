import './QuickLinks.css';

/* ─────────────────────────────────────────────────────────────────────
 * QuickLinks — contextual "related sections" cards at the bottom of
 * each admin page.
 *
 * The idea is to make the dashboard feel less like a tree (sidebar →
 * leaf page → dead end) and more like a graph: every leaf page suggests
 * 3–4 other places an admin is likely to want to go next, given what
 * they were just doing.
 *
 *   • On the Claims page, the natural follow-ups are Cup Scans (the
 *     other side of the same return), Users (whose return is this?)
 *     and Transactions (did the payout happen?).
 *
 *   • On the Rewards page, it's Settings (cashback rate), Transactions
 *     (who redeemed what), and Overview (does it move the needle?).
 *
 * The component is intentionally dumb — pass it a `currentPage` and an
 * `onNavigate(pageId)` callback and it picks the right cluster from the
 * `RELATIONS` map below. Pages can override with an explicit `links`
 * prop if they want a non-default cluster.
 *
 *   <QuickLinks currentPage="claims" onNavigate={setPage} />
 */

// Catalogue of every navigable page in the admin shell, so QuickLinks
// always renders a consistent title + icon + 1-line description.
const PAGE_META = {
  overview: {
    label: 'Overview',
    desc: 'Live stats, charts, and insights at a glance.',
    tone: 'blue',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
      </svg>
    ),
  },
  rewards: {
    label: 'Rewards & Offers',
    desc: 'Edit the catalogue customers can spend cashback on.',
    tone: 'orange',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="20 12 20 22 4 22 4 12" />
        <rect x="2" y="7" width="20" height="5" />
        <line x1="12" y1="22" x2="12" y2="7" />
        <path d="M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7z" />
        <path d="M12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z" />
      </svg>
    ),
  },
  users: {
    label: 'Users',
    desc: 'Customer balances, IBANs, device types, history.',
    tone: 'purple',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 00-3-3.87" />
        <path d="M16 3.13a4 4 0 010 7.75" />
      </svg>
    ),
  },
  claims: {
    label: 'Claims',
    desc: 'Approve, reject, or review pending cashback claims.',
    tone: 'red',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    ),
  },
  cupscans: {
    label: 'Cup Scans',
    desc: 'Every scan attempt with photo, status, and error code.',
    tone: 'teal',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
        <circle cx="12" cy="13" r="4" />
      </svg>
    ),
  },
  cupqr: {
    label: 'QR Receipt Batches',
    desc: 'Mint, print, and audit the QR receipts the smart bin prints.',
    tone: 'teal',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="7" height="7" />
        <rect x="14" y="3" width="7" height="7" />
        <rect x="3" y="14" width="7" height="7" />
        <line x1="14" y1="14" x2="14" y2="21" />
        <line x1="18" y1="14" x2="18" y2="18" />
        <line x1="14" y1="18" x2="18" y2="18" />
        <line x1="21" y1="14" x2="21" y2="21" />
        <line x1="14" y1="21" x2="21" y2="21" />
      </svg>
    ),
  },
  transactions: {
    label: 'Cup Transfers',
    desc: 'Peer-to-peer cup shares between customers.',
    tone: 'green',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="17 1 21 5 17 9" />
        <path d="M3 11V9a4 4 0 0 1 4-4h14" />
        <polyline points="7 23 3 19 7 15" />
        <path d="M21 13v2a4 4 0 0 1-4 4H3" />
      </svg>
    ),
  },
  settings: {
    label: 'Settings',
    desc: 'Cashback rate, feature toggles, copy, and limits.',
    tone: 'gray',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
      </svg>
    ),
  },
  donations: {
    label: 'Donations',
    desc: 'Track money collected for charity + record transfers.',
    tone: 'purple',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
      </svg>
    ),
  },
  reports: {
    label: 'Reports',
    desc: 'Exportable summaries for finance and operations.',
    tone: 'indigo',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 3v18h18" />
        <rect x="7" y="13" width="3" height="5" />
        <rect x="12" y="9" width="3" height="9" />
        <rect x="17" y="5" width="3" height="13" />
      </svg>
    ),
  },
  history: {
    label: 'Version History',
    desc: 'Past published snapshots, with one-click rollback.',
    tone: 'amber',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 3v5h5" />
        <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="12" x2="15" y2="15" />
      </svg>
    ),
  },
  org: {
    label: 'Organisation',
    desc: 'Workspace info, locations, team, and activity log.',
    tone: 'slate',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 21h18" />
        <path d="M5 21V7l8-4v18" />
        <path d="M19 21V11l-6-4" />
      </svg>
    ),
  },
  support: {
    label: 'Help & Support',
    desc: 'Contact PackBack, send feedback, request a feature.',
    tone: 'purple',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    ),
  },
};

// Per-page suggested clusters. Order matters — first item is the most
// natural next step. Pages not listed here fall back to a generic set.
const RELATIONS = {
  overview:     ['claims', 'users', 'cupscans', 'rewards'],
  rewards:      ['settings', 'transactions', 'overview', 'users'],
  users:        ['claims', 'transactions', 'cupscans', 'reports'],
  claims:       ['cupscans', 'users', 'transactions', 'reports'],
  cupscans:     ['cupqr', 'claims', 'users', 'transactions'],
  cupqr:        ['cupscans', 'claims', 'transactions', 'reports'],
  transactions: ['donations', 'users', 'claims', 'reports'],
  donations:    ['transactions', 'reports', 'settings', 'history'],
  settings:     ['org', 'rewards', 'history', 'support'],
  reports:      ['overview', 'transactions', 'users', 'history'],
  history:      ['settings', 'reports', 'overview', 'org'],
  org:          ['settings', 'history', 'reports', 'support'],
  support:      ['overview', 'settings', 'history', 'org'],
};

const FALLBACK = ['overview', 'users', 'claims', 'transactions'];

export default function QuickLinks({ currentPage, onNavigate, links, title = 'Quick links', subtitle = 'Related sections you might want to jump to next' }) {
  // Resolve which page ids to render. Explicit `links` prop wins, then
  // the page's RELATIONS entry, then the generic fallback.
  const ids = (links || RELATIONS[currentPage] || FALLBACK).filter(id => id !== currentPage);

  if (ids.length === 0) return null;

  return (
    <section className="ql">
      <div className="ql__header">
        <h2 className="ql__title">{title}</h2>
        <p className="ql__sub">{subtitle}</p>
      </div>
      <div className="ql__grid">
        {ids.map(id => {
          const meta = PAGE_META[id];
          if (!meta) return null;
          return (
            <button
              key={id}
              type="button"
              className={`ql__card ql__card--${meta.tone}`}
              onClick={() => onNavigate?.(id)}
            >
              <span className="ql__card-icon">{meta.icon}</span>
              <span className="ql__card-body">
                <span className="ql__card-label">{meta.label}</span>
                <span className="ql__card-desc">{meta.desc}</span>
              </span>
              <span className="ql__card-arrow" aria-hidden>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
