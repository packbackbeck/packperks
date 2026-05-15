import { useEffect, useMemo, useRef, useState } from 'react';
import './FeatureSearch.css';

/* ─────────────────────────────────────────────────────────────────────
 * Feature search — single in-memory index of every page / action the
 * admin can reach. Typing matches against name, description, and
 * keywords; results are ranked exact > prefix > word-prefix > substring
 * and clamped to the top 8. Click a result to navigate.
 *
 * Each entry has:
 *   id        — uid, used as React key only
 *   name      — what we render as the primary label
 *   desc      — short description shown below the name
 *   page      — target page id (passed to onNavigate)
 *   group     — section header in the dropdown
 *   keywords  — extra search tokens not visible in the UI
 *   icon      — small SVG element to show on the left
 * ───────────────────────────────────────────────────────────────────── */

const Icon = {
  overview: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
      <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
    </svg>
  ),
  claims: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
    </svg>
  ),
  cup: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/>
    </svg>
  ),
  qr: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
      <rect x="3" y="14" width="7" height="7"/><line x1="14" y1="14" x2="14" y2="21"/>
      <line x1="18" y1="14" x2="18" y2="18"/><line x1="14" y1="18" x2="18" y2="18"/>
    </svg>
  ),
  reward: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/>
      <line x1="12" y1="22" x2="12" y2="7"/>
    </svg>
  ),
  user: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>
    </svg>
  ),
  org: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 21h18M5 21V7l8-4 8 4v14"/>
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
    </svg>
  ),
  receipt: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
      <circle cx="12" cy="13" r="4"/>
    </svg>
  ),
  activity: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
    </svg>
  ),
  reports: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18"/><rect x="7" y="13" width="3" height="5"/>
      <rect x="12" y="9" width="3" height="9"/><rect x="17" y="5" width="3" height="13"/>
    </svg>
  ),
  history: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/>
      <line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="12" x2="15" y2="15"/>
    </svg>
  ),
  transactions: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>
      <polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
    </svg>
  ),
};

/* Feature index — every navigable thing in the dashboard, plus the
 * inner controls on each page so a search for e.g. "cashback rate"
 * lands on Settings rather than scrolling Overview. Each entry has
 * generous `keywords` so partial / fuzzy queries resolve well. */
const FEATURES = [
  // ── Overview / dashboards ────────────────────────────────────────────
  { id: 'f-overview',     name: 'Overview',                desc: 'Dashboards, KPIs, charts',          group: 'Dashboards', page: 'overview', icon: Icon.overview, keywords: 'home dashboard kpi stats metric main analytics insights summary' },
  { id: 'f-retention',    name: 'Retention rate',          desc: 'Users who came back at least once', group: 'Dashboards', page: 'overview', icon: Icon.activity, keywords: 'cohort returning users chart graph come back loyal' },
  { id: 'f-cashback',     name: 'Cashback paid (chart)',   desc: 'Spotlight from Overview',           group: 'Dashboards', page: 'overview', icon: Icon.reports,  keywords: 'money euros payout euros paid revenue' },
  { id: 'f-totalusers',   name: 'Total customers',         desc: 'Card on the Overview',              group: 'Dashboards', page: 'overview', icon: Icon.user,     keywords: 'count signups total registered users people' },
  { id: 'f-cupscollected',name: 'Cups collected',          desc: 'Lifetime cups returned',            group: 'Dashboards', page: 'overview', icon: Icon.cup,      keywords: 'total lifetime returned scanned' },
  { id: 'f-insights-dev', name: 'Device breakdown',        desc: 'iOS vs Android customers',          group: 'Dashboards', page: 'overview', icon: Icon.user,     keywords: 'devices iphone android ipad mac windows pie chart split' },
  { id: 'f-insights-hour',name: 'Cup returns by hour',     desc: 'Peak times for the program',        group: 'Dashboards', page: 'overview', icon: Icon.activity, keywords: 'hourly time of day busiest peak lunch dinner heatmap histogram' },
  { id: 'f-insights-top', name: 'Top returners',           desc: 'Power users leaderboard',           group: 'Dashboards', page: 'overview', icon: Icon.user,     keywords: 'leaderboard top customers most active power loyal users' },

  // ── Claims + receipts ──────────────────────────────────────────────
  { id: 'f-claims',       name: 'Claims',                  desc: 'Approve, reject, refund',           group: 'Operations', page: 'claims',   icon: Icon.claims,   keywords: 'cashback refund decisions verdict queue review' },
  { id: 'f-approve',      name: 'Approve a cashback',      desc: 'Open Claims and approve a row',     group: 'Operations', page: 'claims',   icon: Icon.claims,   keywords: 'pay payout decide ok accept' },
  { id: 'f-reject',       name: 'Reject a claim',          desc: 'Open Claims and reject',            group: 'Operations', page: 'claims',   icon: Icon.claims,   keywords: 'fail decline refuse deny' },
  { id: 'f-bulkapprove',  name: 'Bulk approve claims',     desc: 'Select rows, mass-approve',         group: 'Operations', page: 'claims',   icon: Icon.claims,   keywords: 'mass batch many checkbox select all' },
  { id: 'f-receipt-review', name: 'Receipt review',        desc: 'Side-by-side photo + AI check',   group: 'Operations', page: 'claims',   icon: Icon.receipt,  keywords: 'photo ai check receipt review pane split detail' },
  { id: 'f-ai-verdict',   name: 'AI check on a claim',   desc: '3-check summary from Claude',       group: 'Operations', page: 'claims',   icon: Icon.receipt,  keywords: 'ai claude verdict authenticity is receipt burger king required item confidence' },

  // ── Cup scans ─────────────────────────────────────────────────────
  { id: 'f-cupscans',     name: 'Cup Scans',               desc: 'Every QR scan attempt',             group: 'Operations', page: 'cupscans', icon: Icon.qr,       keywords: 'audit photos errors log scans qr code attempts customers' },
  { id: 'f-cupscans-fail',name: 'Failed scan reasons',     desc: 'Filter Cup Scans by error code',    group: 'Operations', page: 'cupscans', icon: Icon.qr,       keywords: 'error already claimed duplicate invalid failure' },

  // ── Cup QR Codes (separate page for minting + printing) ──────────
  { id: 'f-cupqr',        name: 'Generate cup QR codes',   desc: 'Mint new tokens for the smart bin', group: 'Operations', page: 'cupqr',    icon: Icon.qr,       keywords: 'generate print batch token bin new mint code create' },
  { id: 'f-cup-print',    name: 'Print / export QR',       desc: 'Save as JPG, PDF or print',         group: 'Operations', page: 'cupqr',    icon: Icon.qr,       keywords: 'jpg pdf print export download save image receipt' },

  // ── Transactions ───────────────────────────────────────────────────
  { id: 'f-transactions', name: 'Transactions',            desc: 'Cup transfers between customers',   group: 'Operations', page: 'transactions', icon: Icon.transactions, keywords: 'share peer to peer p2p shared sender receiver send transfer' },
  { id: 'f-tx-pending',   name: 'Pending shares',          desc: 'Cups shared but not yet claimed',   group: 'Operations', page: 'transactions', icon: Icon.transactions, keywords: 'pending waiting unclaimed share' },

  // ── Donations ────────────────────────────────────────────────────
  { id: 'f-donations',    name: 'Donations',               desc: 'Track charity transfers',           group: 'Operations', page: 'donations',    icon: Icon.transactions, keywords: 'donation charity plastic soup foundation transfer wire bank money out' },
  { id: 'f-donations-add',name: 'Record a donation transfer', desc: 'Wire confirmation + receipt',    group: 'Operations', page: 'donations',    icon: Icon.transactions, keywords: 'add new record transfer receipt upload confirm bank wire' },
  { id: 'f-donations-balance', name: 'Outstanding donation balance', desc: 'Money still owed to charity', group: 'Operations', page: 'donations', icon: Icon.transactions, keywords: 'balance owed outstanding collected difference money out' },

  // ── Rewards ────────────────────────────────────────────────────────
  { id: 'f-rewards',      name: 'Rewards & Offers',        desc: 'Edit menu items + pricing',         group: 'Content',    page: 'rewards',  icon: Icon.reward,   keywords: 'menu items burger king prices cashback rate per cup' },
  { id: 'f-add-reward',   name: 'Add a reward',            desc: 'Create a new menu offer',           group: 'Content',    page: 'rewards',  icon: Icon.reward,   keywords: 'new create add item offer reward' },
  { id: 'f-publish',      name: 'Publish to live',         desc: 'Push reward changes to the user app', group: 'Content',  page: 'rewards',  icon: Icon.reward,   keywords: 'deploy ship live release publish go push' },
  { id: 'f-save-draft',   name: 'Save draft',              desc: 'Save without publishing',           group: 'Content',    page: 'rewards',  icon: Icon.reward,   keywords: 'save draft hold review' },

  // ── Customers ──────────────────────────────────────────────────────
  { id: 'f-customers',    name: 'Customers',               desc: 'All app users + balances',          group: 'People',     page: 'users',    icon: Icon.user,     keywords: 'users people accounts balance cups consumers' },
  { id: 'f-adjust-bal',   name: 'Adjust cup balance',      desc: 'Manually credit / debit cups',      group: 'People',     page: 'users',    icon: Icon.user,     keywords: 'balance adjust credit debit manual override cups' },
  { id: 'f-edit-cust',    name: 'Edit customer email',     desc: 'Update name / email / IBAN',        group: 'People',     page: 'users',    icon: Icon.user,     keywords: 'edit update email iban name customer' },
  { id: 'f-cust-device',  name: 'Customer device',         desc: 'Phone or web client used',          group: 'People',     page: 'users',    icon: Icon.user,     keywords: 'device iphone android ipad mac phone agent' },

  // ── Organisation ──────────────────────────────────────────────────
  { id: 'f-org',          name: 'Organisation',            desc: 'Org info, locations, team',         group: 'Organisation', page: 'org',    icon: Icon.org,      keywords: 'company burger king info kvk btw vat' },
  { id: 'f-org-edit',     name: 'Edit organisation',       desc: 'Name, KvK, BTW, brand colour',      group: 'Organisation', page: 'org',    icon: Icon.org,      keywords: 'edit company kvk btw vat brand colour address' },
  { id: 'f-locations',    name: 'Locations',               desc: 'Restaurants in your org',           group: 'Organisation', page: 'org',    icon: Icon.org,      keywords: 'restaurants stores branches address city damrak amsterdam rotterdam utrecht' },
  { id: 'f-add-location', name: 'Add location',            desc: 'New restaurant in the program',     group: 'Organisation', page: 'org',    icon: Icon.org,      keywords: 'add new restaurant branch store location' },
  { id: 'f-team',         name: 'Team members',            desc: 'Manage admins',                     group: 'Organisation', page: 'org',    icon: Icon.user,     keywords: 'team admins staff colleagues' },
  { id: 'f-invite',       name: 'Invite teammate',         desc: 'Send invitation by email',          group: 'Organisation', page: 'org',    icon: Icon.user,     keywords: 'invite email new member role permission add' },
  { id: 'f-role',         name: 'Change role',             desc: 'Owner / Admin / Manager / Checker', group: 'Organisation', page: 'org',    icon: Icon.user,     keywords: 'role permission promote demote owner admin manager checker' },
  { id: 'f-block',        name: 'Block teammate',          desc: 'Disable login for an admin',        group: 'Organisation', page: 'org',    icon: Icon.user,     keywords: 'block disable suspend remove kick' },
  { id: 'f-activity',     name: 'Activity Log',            desc: 'Audit trail of admin actions',      group: 'Organisation', page: 'org',    icon: Icon.activity, keywords: 'history audit log who what when changes diff' },

  // ── Settings + meta ────────────────────────────────────────────────
  { id: 'f-settings',     name: 'Settings',                desc: 'Cashback rates, features',          group: 'System',     page: 'settings', icon: Icon.settings, keywords: 'rate refund features toggle config' },
  { id: 'f-cashback-rate',name: 'Cashback rate',           desc: '€ per cup paid to customers',       group: 'Settings',   page: 'settings', icon: Icon.settings, keywords: 'rate price euros per cup cashback amount' },
  { id: 'f-refund-rate',  name: 'Direct refund rate',      desc: '€ per cup paid as a direct refund', group: 'Settings',   page: 'settings', icon: Icon.settings, keywords: 'refund rate price euros per cup direct' },
  { id: 'f-feat-share',   name: 'Cup sharing toggle',      desc: 'Enable/disable peer-to-peer shares',group: 'Settings',   page: 'settings', icon: Icon.settings, keywords: 'cup sharing toggle on off feature flag' },
  { id: 'f-feat-donate',  name: 'Donations toggle',        desc: 'Enable/disable donate flow',        group: 'Settings',   page: 'settings', icon: Icon.settings, keywords: 'donate donation charity toggle plastic soup' },
  { id: 'f-feat-direct',  name: 'Direct refund toggle',    desc: 'Enable/disable direct refunds',     group: 'Settings',   page: 'settings', icon: Icon.settings, keywords: 'direct refund toggle' },
  { id: 'f-maintenance',  name: 'Maintenance mode',        desc: 'Take user app offline',             group: 'Settings',   page: 'settings', icon: Icon.settings, keywords: 'offline shutdown closed disabled emergency' },
  { id: 'f-reports',      name: 'Reports',                 desc: 'Export CSV',                        group: 'System',     page: 'reports',  icon: Icon.reports,  keywords: 'export csv data download report' },
  { id: 'f-history',      name: 'Version History',         desc: 'Past published configs',            group: 'System',     page: 'history',  icon: Icon.history,  keywords: 'changelog rollback published versions snapshot' },

  // ── Support page ───────────────────────────────────────────────────
  { id: 'f-support',      name: 'Help & Support',          desc: 'Contact PackBack, send feedback',   group: 'System',     page: 'support',  icon: Icon.settings, keywords: 'help support contact email feedback request feature changelog updates docs documentation' },
  { id: 'f-feedback',     name: 'Send feedback',           desc: 'What\'s working, what\'s not',         group: 'System',     page: 'support',  icon: Icon.settings, keywords: 'feedback comment opinion review rate working broken issue' },
  { id: 'f-feature-req',  name: 'Request a feature',       desc: 'Pitch us on something to build',    group: 'System',     page: 'support',  icon: Icon.settings, keywords: 'feature request idea suggestion roadmap propose pitch wish' },
  { id: 'f-changelog',    name: 'Dashboard changelog',     desc: 'What we shipped recently',          group: 'System',     page: 'support',  icon: Icon.history,  keywords: 'changelog release notes updates new shipped recent' },

  // ── Account (profile menu actions) ─────────────────────────────────
  { id: 'f-prof-edit',    name: 'Edit my profile',         desc: 'Display name, avatar, colour',      group: 'Account',    page: null,       icon: Icon.user,     keywords: 'profile me name avatar photo color picture self' },
  { id: 'f-prof-pwd',     name: 'Reset password',          desc: 'Email yourself a reset link',       group: 'Account',    page: null,       icon: Icon.settings, keywords: 'password reset change lock security' },
  { id: 'f-prof-email',   name: 'Change email',            desc: 'Move your login to a new address',  group: 'Account',    page: null,       icon: Icon.settings, keywords: 'change email login address swap update' },
  { id: 'f-prof-logout',  name: 'Sign out',                desc: 'End your session',                  group: 'Account',    page: null,       icon: Icon.settings, keywords: 'sign out log out logout exit leave' },
];

function tokenize(s) { return s.toLowerCase().split(/\s+/).filter(Boolean); }

/* Rank a single feature against a search query. Returns a numeric
 * score — higher is better — or 0 to exclude. */
function scoreFeature(feature, query) {
  if (!query) return 0;
  const q = query.toLowerCase();
  const name = feature.name.toLowerCase();
  const desc = (feature.desc || '').toLowerCase();
  const kw   = (feature.keywords || '').toLowerCase();
  const haystack = `${name} ${desc} ${kw}`;

  if (name === q) return 1000;                  // exact name match
  if (name.startsWith(q)) return 600;            // name prefix
  // word prefix in name (e.g. "rece" matches "receipt review")
  if (tokenize(name).some(t => t.startsWith(q))) return 400;
  if (name.includes(q)) return 250;              // substring in name
  if (desc.includes(q)) return 120;              // substring in desc
  if (kw.includes(q))   return 80;               // substring in keywords
  // Multi-word query: every token must appear somewhere
  const tokens = tokenize(q);
  if (tokens.length > 1 && tokens.every(t => haystack.includes(t))) return 40;
  return 0;
}

export default function FeatureSearch({ onNavigate }) {
  const [open, setOpen]     = useState(false);
  const [query, setQuery]   = useState('');
  const [active, setActive] = useState(0);
  const wrapRef  = useRef(null);
  const inputRef = useRef(null);
  const listRef  = useRef(null);

  // Filter + rank.
  const results = useMemo(() => {
    if (!query.trim()) return FEATURES.slice(0, 8);
    return FEATURES
      .map(f => ({ f, s: scoreFeature(f, query.trim()) }))
      .filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 12)
      .map(x => x.f);
  }, [query]);

  // Group consecutive items by `group` for the dropdown headers.
  const grouped = useMemo(() => {
    const out = [];
    let last = null;
    for (const f of results) {
      if (f.group !== last) { out.push({ type: 'group', label: f.group }); last = f.group; }
      out.push({ type: 'item', feature: f });
    }
    return out;
  }, [results]);

  // Bound the active index whenever results change.
  useEffect(() => {
    if (active >= results.length) setActive(Math.max(0, results.length - 1));
  }, [results, active]);

  // Click outside / Escape closes the dropdown.
  useEffect(() => {
    if (!open) return;
    function onMouse(e) { if (!wrapRef.current?.contains(e.target)) { setOpen(false); } }
    function onKey(e) { if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur(); } }
    document.addEventListener('mousedown', onMouse);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouse);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // ⌘K / Ctrl+K to focus.
  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  function navigateToItem(f) {
    onNavigate?.(f.page);
    setOpen(false);
    setQuery('');
    inputRef.current?.blur();
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(results.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const f = results[active];
      if (f) navigateToItem(f);
    }
  }

  // Keep the active item visible when arrow-keying.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector('[data-active="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  return (
    <div className={`fs-wrap${open ? ' fs-wrap--open' : ''}`} ref={wrapRef}>
      <div className="fs-input-row">
        <svg className="fs-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8"/>
          <line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input
          ref={inputRef}
          className="fs-input"
          type="text"
          placeholder="Search the dashboard…"
          value={query}
          onChange={e => { setQuery(e.target.value); setActive(0); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        <kbd className="fs-kbd">⌘K</kbd>
      </div>

      {open && (
        <div className="fs-dropdown" ref={listRef} role="listbox">
          {results.length === 0 ? (
            <div className="fs-empty">No matching features</div>
          ) : grouped.map((entry, i) => {
            if (entry.type === 'group') {
              return <div key={`g-${i}`} className="fs-group">{entry.label}</div>;
            }
            const f = entry.feature;
            const idx = results.indexOf(f);
            const isActive = idx === active;
            return (
              <button
                key={f.id}
                data-active={isActive ? 'true' : 'false'}
                role="option"
                aria-selected={isActive}
                className={`fs-item${isActive ? ' fs-item--active' : ''}`}
                onMouseEnter={() => setActive(idx)}
                onClick={() => navigateToItem(f)}
                type="button"
              >
                <span className="fs-item__icon" aria-hidden>{f.icon}</span>
                <span className="fs-item__text">
                  <span className="fs-item__name">{f.name}</span>
                  <span className="fs-item__desc">{f.desc}</span>
                </span>
                <svg className="fs-item__arrow" width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="10" x2="15" y2="10"/>
                  <polyline points="11 6 15 10 11 14"/>
                </svg>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
