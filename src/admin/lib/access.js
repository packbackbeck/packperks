import {
  Activity, ArrowLeftRight, Blocks, CircleDollarSign, CircleHelp, ClipboardList, Clock, Eye, Gauge, Gift, HandCoins,
  HeartHandshake, HeartPulse, History, LayoutDashboard, Mail, MapPin, Palette, QrCode, Receipt, ReceiptText, Repeat, ScanLine, ScanQrCode,
  Search, Send, Settings, ShieldCheck, Smartphone, Store, TabletSmartphone, Users,
} from 'lucide-react';

/* ─────────────────────────────────────────────────────────────────────
 * Who can see and change what in the dashboard.
 *
 * Three levels, each account holds one role of one level:
 *   master  — PackBack staff. Every organisation, every tab, and Master
 *             Settings: people, roles, organisations, workspace tabs.
 *   manager — runs one or more organisations. What each tab allows is set
 *             by the role (hidden, view or edit per tab).
 *   vendor  — the venue's own people. Read-only by default, one or more
 *             organisations.
 *
 * Roles live in `admin_roles` (migration 048). Masters can add roles of
 * the manager or vendor level; the three built-in roles below are the
 * defaults and the fallback when the table can't be read.
 *
 * The database enforces the level and the organisation list; the tab
 * permissions are enforced here, in the sidebar, the page guard and the
 * controls that call `canEdit`.
 * ───────────────────────────────────────────────────────────────────── */

export const LEVELS = {
  master:  { id: 'master',  label: 'Master',  rank: 100, description: 'PackBack staff. Every organisation, every tab, and Master Settings.' },
  manager: { id: 'manager', label: 'Manager', rank: 50,  description: 'Runs the organisations they are given. Tabs and editing as their role allows.' },
  vendor:  { id: 'vendor',  label: 'Vendor',  rank: 10,  description: 'The venue’s own people. Read-only reporting for their organisations.' },
};
export const LEVEL_ORDER = ['master', 'manager', 'vendor'];

/* app_config keys for the workspace-wide switches (Master Settings →
 * Workspace): which tabs exist, what the top bar shows, and display. */
export const WORKSPACE_KEY = 'workspace:tabs';
export const TOPBAR_KEY = 'workspace:topbar';
/* How the dashboard looks for everyone: { sparklines } (mini graphs on the
 * number tiles; on unless set to false). */
export const DISPLAY_KEY = 'workspace:display';

/* What the top bar can show. `fixed` items can't be switched off;
 * `defaultOff` items start hidden until a master turns them on. */
export const TOPBAR_ITEMS = [
  { id: 'programme', label: 'Ways in and out', icon: ArrowLeftRight,
    description: 'The open venue’s way in → way out. Opens Ways & features.' },
  { id: 'search', label: 'Search', icon: Search,
    description: 'Find any page or setting, also with ⌘K.' },
  { id: 'rates', label: 'Cashback and refund', icon: CircleDollarSign, defaultOff: true,
    description: 'What a returned cup is worth at the open venue.' },
  { id: 'timezone', label: 'Time zone', icon: Clock, defaultOff: true,
    description: 'The time zone every time in the dashboard is shown in.' },
  { id: 'preview', label: 'Preview', icon: Eye,
    description: 'Opens the venue’s customer app in a new tab.' },
  { id: 'publish', label: 'Publish', icon: Send, fixed: true,
    description: 'Puts draft changes live. Shown to everyone who can change settings, rewards or design.' },
];

export const TOPBAR_BY_ID = Object.fromEntries(TOPBAR_ITEMS.map(i => [i.id, i]));

/* Whether the top bar shows an item: what the master saved, or the item's
 * own default when nothing is saved for it. */
export function topbarShows(topbar, id) {
  const item = TOPBAR_BY_ID[id];
  if (!item) return true;
  if (item.fixed) return true;
  const saved = topbar?.[id];
  return typeof saved === 'boolean' ? saved : !item.defaultOff;
}

/* Old role names (before migration 048) and what they are now. */
export function levelForLegacyRole(role) {
  if (role === 'owner' || role === 'admin' || role === 'master') return 'master';
  if (role === 'vendor') return 'vendor';
  if (role === 'manager' || role === 'checker') return 'manager';
  return null;
}

export const TAB_GROUPS = [
  { id: 'analytics', label: 'Analytics' },
  { id: 'customers', label: 'Customers' },
  // Ids kept from before ways in and out: roles and saved layouts use them.
  { id: 'generate', label: 'Ways in' },
  { id: 'circulation', label: 'Ways out' },
  { id: 'workspace', label: 'Workspace' },
];

const ALL_MODES = ['standard', 'byo', 'tikkie_only'];
const APP_MODES = ['standard', 'byo'];

/* Every page, in sidebar order.
 *   modes        — which customer apps show it (orgModes.js)
 *   programmes   — which programmes show it ('deposit' | 'byo'); all when unset
 *   feature      — a setting that has to be on (switching it off hides the tab)
 *   needsGroup   — only for venues that belong to a group
 *   masterOnly   — Master Settings
 *   fixed        — cannot be switched off for the workspace
 *   editable     — false when the page has nothing to change */
export const TABS = [
  { id: 'overview', label: 'Dashboard', group: 'analytics', icon: LayoutDashboard, modes: ALL_MODES, fixed: true, editable: true,
    description: 'Headline numbers, the trend and what stands out.' },
  // Editable since User flow: the page now carries a setting (what the
  // customer app may capture), so a role can be granted edit on it.
  { id: 'behaviour', label: 'User analytics', group: 'analytics', icon: Activity, modes: ALL_MODES, editable: true,
    description: 'How customers find the programme, come back and redeem — and what they do inside the app.' },
  { id: 'stats', label: 'System health', group: 'analytics', icon: Gauge, modes: ALL_MODES, editable: true,
    description: 'Whether scanning, payouts and receipt checks work as they should.' },
  { id: 'reports', label: 'Reports & alerts', group: 'analytics', icon: ClipboardList, modes: ALL_MODES, editable: true,
    description: 'Exports, the weekly digest and alert rules.' },

  { id: 'users', label: 'Users', group: 'customers', icon: Users, modes: ALL_MODES, editable: true, badge: 'merges',
    description: 'Customer accounts, balances and merges.' },
  { id: 'rewards', label: 'Rewards & offers', group: 'customers', icon: Gift, modes: APP_MODES, editable: true,
    description: 'What customers can unlock with their cups.' },
  { id: 'appdesign', label: 'Client app', group: 'customers', icon: Palette, modes: ALL_MODES, editable: true, beta: true,
    description: 'How the customer app looks: colours, texts, and which sections show in what order.' },
  { id: 'emailtemplates', label: 'Email templates', group: 'customers', icon: Mail, modes: ['tikkie_only'], editable: true,
    description: 'The automated customer emails.' },
  { id: 'futurevendors', label: 'Future vendors', group: 'customers', icon: Store, modes: APP_MODES, needsGroup: true, editable: true,
    description: 'Venues customers ask for, and the ones coming soon.' },
  { id: 'smartbins', label: 'Smart bin locations', group: 'customers', icon: MapPin, modes: ['tikkie_only'], editable: true,
    description: 'Bin locations on the customer map.' },

  // Ways in: how a returned cup reaches the customer's phone.
  { id: 'cupqr', label: 'SmartBin Receipt QR', group: 'generate', icon: QrCode, modes: ALL_MODES, programmes: ['deposit'], editable: true,
    description: 'Single-use QR codes for a set number of cups, the ones a SmartBin receipt carries: mint, print and revoke batches.' },
  { id: 'staffapp', label: 'Staff App', group: 'generate', icon: TabletSmartphone, modes: ALL_MODES, editable: true, badge: 'staff', beta: true,
    description: 'The BYO way in where staff show a cup QR code on their phone: on or off, accounts, requests and every code made. Viewing is enough to approve requests.' },
  { id: 'byorequests', label: 'Static QR tent', group: 'generate', icon: ScanQrCode, modes: ALL_MODES, editable: true,
    feature: 'featureStaticQr', featureDefault: { byo: true },
    description: 'The BYO way in: a QR tent on the counter that gives each customer a cup, up to a limit. It can’t be combined with another way in.' },
  { id: 'backupcups', label: 'Backup cups', group: 'generate', icon: Blocks, modes: ['tikkie_only'], editable: true, beta: true,
    description: 'The codes a SmartBin prints when it is offline, and their alarm.' },
  { id: 'cupscans', label: 'Cup scans', group: 'generate', icon: ScanLine, modes: APP_MODES, editable: true, badge: 'scans',
    description: 'Every cup scanned back, and the ones on hold.' },

  // Ways out: what the customer gets for the cup.
  { id: 'claims', label: 'Claims', group: 'circulation', icon: Receipt, modes: APP_MODES, editable: true, badge: 'claims',
    description: 'Reward Cashback and Direct Refund claims to review and pay.' },
  { id: 'tikkielog', label: 'Deferred Refund', group: 'circulation', icon: HandCoins, modes: ['tikkie_only'], fixed: true, editable: true,
    description: 'Every wallet payout made as a Tikkie link.' },
  { id: 'donations', label: 'Donations', group: 'circulation', icon: HeartHandshake, modes: ALL_MODES, feature: 'featureDonations', editable: true, beta: true,
    description: 'The Donation way out: cups and balances given to charity, and the transfers made for them.' },
  { id: 'transactions', label: 'Cup shares', group: 'circulation', icon: Repeat, modes: APP_MODES, feature: 'featureCupSharing', editable: false, beta: true,
    description: 'Cups customers shared with each other.' },
  { id: 'receiptgen', label: 'Receipt generator', group: 'circulation', icon: ReceiptText, modes: APP_MODES, editable: true,
    description: 'Test purchase receipts that receipt verification always accepts, for trying Reward Cashback without buying anything.' },

  { id: 'settings', label: 'Settings', group: 'workspace', icon: Settings, modes: ALL_MODES, fixed: true, editable: true,
    description: 'Ways in and out, features, payouts, limits, locations and the privacy policy.' },
  { id: 'master', label: 'Master settings', group: 'workspace', icon: ShieldCheck, modes: ALL_MODES, masterOnly: true, fixed: true, editable: true,
    description: 'People, roles, organisations, the workspace and its data.' },
  { id: 'support', label: 'Help & support', group: 'workspace', icon: CircleHelp, modes: ALL_MODES, fixed: true, editable: false,
    description: 'Guides and the support inbox.' },
  { id: 'history', label: 'Version history', group: 'workspace', icon: History, modes: ALL_MODES, editable: true, beta: true,
    description: 'Everything published, and the audit log.' },
  { id: 'mockup', label: 'MockupMaster', group: 'workspace', icon: Smartphone, modes: ALL_MODES, editable: false, href: '/mockup', beta: true,
    description: 'Build a pitch mockup of the customer app without creating an organisation. Opens in a new tab.' },
  { id: 'packpulse', label: 'PackPulse', group: 'workspace', icon: HeartPulse, modes: ALL_MODES, editable: false, beta: true,
    href: 'https://pack-pulse-v1-5.vercel.app/',
    description: 'The PackPulse dashboard. Opens in a new tab.' },
];

export const TAB_BY_ID = Object.fromEntries(TABS.map(t => [t.id, t]));

/* Legacy routes that are now part of another page. */
export const TAB_ALIASES = { org: 'settings', receipts: 'claims', organizations: 'master' };

const everything = (level) => Object.fromEntries(TABS.filter(t => !t.masterOnly).map(t => [t.id, level]));
const viewEverything = () => everything('view');

export const BUILT_IN_ROLES = {
  master: {
    key: 'master', label: 'Master', level: 'master', builtIn: true,
    description: 'Everything, including Master Settings. Always has every tab.',
    tabs: { ...everything('edit'), master: 'edit' },
  },
  manager: {
    key: 'manager', label: 'Manager', level: 'manager', builtIn: true,
    description: 'Runs their organisations day to day: claims, rewards, customers and settings.',
    tabs: { ...everything('edit'), mockup: 'hidden', packpulse: 'hidden' },
  },
  vendor: {
    key: 'vendor', label: 'Vendor', level: 'vendor', builtIn: true,
    description: 'Read-only reporting for their venue.',
    tabs: {
      ...everything('hidden'),
      overview: 'view', behaviour: 'view', reports: 'view', support: 'view', settings: 'hidden', staffapp: 'view',
    },
  },
};

export const ACCESS_LEVELS = ['hidden', 'view', 'edit'];

/* Normalise a stored role row (admin_roles) into the shape above. */
export function normalizeRole(row) {
  if (!row) return null;
  const level = LEVELS[row.level] ? row.level : 'vendor';
  const base = BUILT_IN_ROLES[level];
  const tabs = {};
  for (const t of TABS) {
    if (t.masterOnly) { tabs[t.id] = level === 'master' ? 'edit' : 'hidden'; continue; }
    const v = row.tabs?.[t.id];
    tabs[t.id] = level === 'master' ? 'edit' : (ACCESS_LEVELS.includes(v) ? v : base.tabs[t.id] || 'hidden');
    if (tabs[t.id] === 'edit' && t.editable === false) tabs[t.id] = 'view';
  }
  return {
    key: row.key,
    label: row.label || base.label,
    level,
    builtIn: !!(row.built_in ?? row.builtIn),
    description: row.description || '',
    tabs,
    updatedAt: row.updated_at || null,
    updatedBy: row.updated_by || null,
  };
}

/* The signed-in account's effective access. `roles` is a key → role map
 * (from admin_roles, falling back to the built-ins). */
export function accessFor(profile, roles) {
  if (!profile) return null;
  const roleKey = profile.access_role || profile.role || null;
  const stored = roleKey ? roles?.[roleKey] : null;
  const legacyLevel = levelForLegacyRole(profile.role);
  // A checker (or a Viewer whose role row couldn't be read) sees what a
  // manager sees and changes nothing.
  const legacyRole = profile.role === 'checker'
    ? normalizeRole({ key: 'viewer', label: 'Viewer', level: 'manager', tabs: viewEverything() })
    : legacyLevel ? normalizeRole({ ...BUILT_IN_ROLES[legacyLevel], built_in: true }) : null;
  const role = stored || legacyRole;
  if (!role) return { level: null, role: null, tabAccess: () => 'hidden', canEdit: () => false, isMaster: false, allOrgs: false, orgIds: [] };
  const level = role.level;
  // Before migration 048 staff accounts had no organisation list: a staff
  // role with no org_id saw every organisation. Keep that until the
  // account has a role from admin_roles.
  const legacyGlobal = !profile.access_role && profile.org_id == null
    && ['owner', 'admin', 'manager', 'checker'].includes(profile.role);
  return {
    level,
    role,
    isMaster: level === 'master',
    tabAccess: (tabId) => (level === 'master' ? 'edit' : role.tabs[tabId] || 'hidden'),
    canEdit: (tabId) => level === 'master' || role.tabs[tabId] === 'edit',
    allOrgs: level === 'master' || !!profile.all_orgs || legacyGlobal,
    orgIds: Array.isArray(profile.org_ids) && profile.org_ids.length
      ? profile.org_ids
      : (profile.org_id ? [profile.org_id] : []),
  };
}

/* A vendor preview is the vendor role applied to a staff account. */
export function previewAccess(access, roles) {
  const vendor = roles?.vendor || normalizeRole({ ...BUILT_IN_ROLES.vendor, built_in: true });
  return {
    ...access,
    level: 'vendor',
    role: vendor,
    isMaster: false,
    tabAccess: (tabId) => vendor.tabs[tabId] || 'hidden',
    canEdit: (tabId) => vendor.tabs[tabId] === 'edit',
  };
}

/* Why a tab is or isn't on screen for this account, venue and settings. */
export function tabAvailability(tab, { access, mode, programme, settings, hasGroup, workspace }) {
  if (!tab) return { visible: false, reason: 'unknown' };
  if (tab.masterOnly) {
    return access?.isMaster ? { visible: true } : { visible: false, reason: 'role' };
  }
  if (!tab.fixed && workspace && workspace[tab.id] === false) return { visible: false, reason: 'workspace' };
  if (!access || access.tabAccess(tab.id) === 'hidden') return { visible: false, reason: 'role' };
  if (tab.modes && !tab.modes.includes(mode || 'standard')) return { visible: false, reason: 'mode' };
  // A BYO venue has no SmartBin: its programme hides the SmartBin pages.
  if (tab.programmes && !tab.programmes.includes(programme || 'deposit')) return { visible: false, reason: 'programme' };
  if (tab.needsGroup && !hasGroup) return { visible: false, reason: 'group' };
  if (tab.feature) {
    // Unset means on, unless the tab names a default per programme
    // (Static QR code: on for Bring Your Own, off elsewhere).
    const v = settings ? settings[tab.feature] : undefined;
    const on = v === undefined || v === null
      ? (tab.featureDefault ? !!tab.featureDefault[mode || 'standard'] : true)
      : v !== false;
    if (!on) return { visible: false, reason: 'feature', feature: tab.feature };
  }
  return { visible: true };
}

export function visibleTabs(ctx) {
  return TABS.filter(t => tabAvailability(t, ctx).visible);
}

export function firstVisibleTab(ctx) {
  return visibleTabs(ctx).find(t => !t.href)?.id || 'support';
}
