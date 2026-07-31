import { useState, useEffect } from 'react';
import ProfileMenu from './auth/ProfileMenu';
import OrgSwitcher from './context/OrgSwitcher';
import { useOrg } from './context/OrgContext';
import { getPendingCounts } from './lib/adminApi';
import { logAction } from './auth/actionLog';
import './AdminSidebar.css';

// Nav items that show a "Group" chip because they operate on the whole BYO
// group (one shared customer base across every store), not just this store.
const GROUP_SCOPED_ITEMS = new Set(['users', 'futurevendors']);

const NAV_ITEMS = [
  {
    id: 'overview',
    label: 'Overview',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
      </svg>
    ),
  },
  {
    id: 'rewards',
    label: 'Rewards & Offers',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="20 12 20 22 4 22 4 12" />
        <rect x="2" y="7" width="20" height="5" />
        <line x1="12" y1="22" x2="12" y2="7" />
        <path d="M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7z" />
        <path d="M12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z" />
      </svg>
    ),
  },
  {
    id: 'appdesign',
    label: 'Design & Copy',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="13.5" cy="6.5" r=".5" />
        <circle cx="17.5" cy="10.5" r=".5" />
        <circle cx="8.5" cy="7.5" r=".5" />
        <circle cx="6.5" cy="12.5" r=".5" />
        <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.992 6.012 17.547 2 12 2z" />
      </svg>
    ),
  },
  {
    id: 'users',
    label: 'Users',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 00-3-3.87" />
        <path d="M16 3.13a4 4 0 010 7.75" />
      </svg>
    ),
  },
  {
    id: 'claims',
    label: 'Claims',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
      </svg>
    ),
  },
  // (Former "Receipt Check" tab merged into Claims as a "Review" view
  //  mode toggle in the Claims page header.)
  {
    id: 'cupscans',
    label: 'Cup Scans',
    /* Cup glyph — each scan is a returned cup. */
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 3h12l-1.2 15.3A2 2 0 0 1 14.8 20H9.2a2 2 0 0 1-2-1.7L6 3z" />
        <path d="M5 3h14" />
        <path d="M9 10h6" />
      </svg>
    ),
  },
  {
    id: 'transactions',
    // P-27: "Transactions" was too vague — it currently only contains
    // peer-to-peer cup shares (no money). Renamed to make the scope
    // obvious. If the page later grows to include payouts, rename to
    // "Payouts & Ledger".
    label: 'Cup Transfers',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="17 1 21 5 17 9" />
        <path d="M3 11V9a4 4 0 0 1 4-4h14" />
        <polyline points="7 23 3 19 7 15" />
        <path d="M21 13v2a4 4 0 0 1-4 4H3" />
      </svg>
    ),
  },
  {
    id: 'cupqr',
    // "Receipt Generator" hosts two tabs: the QR cup-receipt batch
    // generator and the rewards test-receipt image generator.
    label: 'Receipt Generator',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
  // (Settings + Version History moved out of the sidebar — they now
  //  live as icon buttons in the top-right WorkflowDock, matching how
  //  Framer/Webflow/Linear arrange "meta" workspace actions.)
  {
    id: 'donations',
    label: 'Donations',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
      </svg>
    ),
  },
  {
    id: 'byorequests',
    label: 'BYO QR Codes',
    /* QR-code glyph — minting + reviewing the printed bring-your-own codes. */
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <path d="M14 14h3v3M20.5 14v3.5M14 20.5h3.5M20.5 20.5v.01" />
      </svg>
    ),
  },
  {
    id: 'futurevendors',
    label: 'Future Vendors',
    /* Map pin + plus — nearby "coming soon" venues shown on the Stores map. */
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 10c0 5-8 12-8 12s-8-7-8-12a8 8 0 0 1 16 0Z" />
        <path d="M12 7v6" />
        <path d="M9 10h6" />
      </svg>
    ),
  },
  {
    id: 'reports',
    label: 'Reports & alerts',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 3v18h18" />
        <rect x="7" y="13" width="3" height="5" />
        <rect x="12" y="9" width="3" height="9" />
        <rect x="17" y="5" width="3" height="13" />
      </svg>
    ),
  },
  {
    id: 'stats',
    label: 'System Health',
    /* Activity/pulse glyph — distinct from the bar-chart "Reports" icon.
     * This is the feasibility-test go/no-go dashboard. */
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
      </svg>
    ),
  },
  {
    id: 'behaviour',
    label: 'User Behaviour',
    /* People glyph — behavioural funnel metrics, separate from System Health. */
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  // (Org is reachable via the OrgBadge in the sidebar footer, so we
  //  don't duplicate it as a nav row.)
  // (Help & Support is reachable via the ? icon in the top-right
  //  WorkflowDock — same reasoning.)
];

/* Maintenance toggle deliberately lives only on the Settings page now —
 * having it one click away in the always-visible sidebar was a footgun
 * (the confirm modal helped, but customers shouldn't be one stray
 * click from being locked out). */
/* Which tabs each role can SEE. Matches the permission matrix in
 * AuthContext — the sidebar is the visual mirror of those rules. */
const ROLE_VISIBLE_TABS = {
  owner:   null, // null = all
  admin:   null, // all
  // Manager + Checker also see the Org tab (read-only) so they know
  // where they work; the editing controls inside are gated by
  // PermissionGate so they're disabled.
  manager: new Set(['overview', 'rewards', 'appdesign', 'users', 'claims', 'cupscans', 'transactions', 'cupqr', 'donations', 'byorequests', 'futurevendors', 'reports', 'stats', 'behaviour']),
  checker: new Set(['overview', 'users', 'claims', 'cupscans', 'transactions', 'donations', 'byorequests', 'reports', 'stats', 'behaviour']),
};

export default function AdminSidebar({ activePage, onNavigate, draftState, role, onAddOrg }) {
  const settings = draftState?.draft?.settings || {};
  const toggleFeature = draftState?.toggleFeature;

  // Maintenance is destructive (takes the customer app offline) so it
  // routes through a confirm step. Other toggles fire immediately.
  const [maintenanceConfirm, setMaintenanceConfirm] = useState(null);
  // null when closed; { nextValue: true|false } when open.

  // Feature/mode gating for the nav (Phase 3).
  const { activeOrgId, activeGroupId, activeOrgSharing, activeGroupMode } = useOrg();
  const isByo = activeGroupMode === 'byo';

  // Pending-work signal dots: claims to review, held cup scans, and account-merge
  // requests. Refetched on org switch + whenever the active page changes (a
  // lightweight way to keep counts fresh after an admin acts on the queue).
  const [pending, setPending] = useState({ claims: 0, scans: 0, merges: 0 });
  useEffect(() => {
    let alive = true;
    getPendingCounts().then(c => { if (alive) setPending(c); }).catch(() => {});
    return () => { alive = false; };
  }, [activeOrgId, activePage]);
  const pendingClaims = pending.claims;
  const pendingScans = pending.scans;
  const pendingMerges = pending.merges;
  const totalPending = pendingClaims + pendingScans + pendingMerges;

  function confirmMaintenance() {
    if (!maintenanceConfirm) return;
    const next = maintenanceConfirm.nextValue;
    toggleFeature?.('maintenanceMode');
    // Audit trail — important for any future "why did the app go down at 14:32"
    // investigation. logAction is fire-and-forget; failures don't block.
    logAction({
      action: 'settings.maintenance_toggle',
      targetType: 'settings',
      targetId: 'maintenanceMode',
      before: { maintenanceMode: !next },
      after:  { maintenanceMode:  next },
    });
    setMaintenanceConfirm(null);
  }

  return (
    <aside className="admin-sidebar">
      <nav className="admin-sidebar__nav">
        {NAV_ITEMS.filter(item => {
          // Hide tabs the current role can't access. Always show Org +
          // Activity to owner/admin (we'll add those tabs in P7/P8).
          const visible = ROLE_VISIBLE_TABS[role];
          if (!(visible === null || !visible || visible.has(item.id))) return false;
          // Phase 3 gating:
          //  • Cup Transfers only when cup sharing is on for this org.
          //  • BYO orgs show BYO Requests and hide the Receipt Generator;
          //    non-BYO orgs do the reverse.
          if (item.id === 'transactions' && !activeOrgSharing) return false;
          if (item.id === 'byorequests' && !isByo) return false;
          if (item.id === 'cupqr' && isByo) return false;
          return true;
        }).map(item => {
          const isActive = activePage === item.id;
          // Per-tab pending count (Overview intentionally has NO indicator).
          const badge =
            item.id === 'claims'   ? pendingClaims :
            // 'receipts' merged into 'claims' — kept here as a noop in
            // case some old saved nav state lands.
            item.id === 'receipts' ? pendingClaims :
            item.id === 'cupscans' ? pendingScans :
            item.id === 'users'    ? pendingMerges :
            0;
          // "Group" chip on the shared, group-wide tabs (only when this org is
          // actually part of a group).
          const showGroupTag = !!activeGroupId && GROUP_SCOPED_ITEMS.has(item.id);

          return (
            <button
              key={item.id}
              className={`admin-sidebar__item ${isActive ? 'admin-sidebar__item--active' : ''}`}
              onClick={() => onNavigate(item.id)}
            >
              <span className="admin-sidebar__item-icon">{item.icon}</span>
              <span className="admin-sidebar__item-label">{item.label}</span>
              {showGroupTag && <span className="admin-sidebar__tag">Group</span>}
              {badge > 0 && (
                <span className="admin-sidebar__badge" title={`${badge} pending`}>{badge}</span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="admin-sidebar__toggles">
        <div className="admin-sidebar__rates" onClick={() => onNavigate('settings')}>
          <div className="admin-sidebar__rate-item">
            <span className="admin-sidebar__rate-label">Cashback</span>
            <span className="admin-sidebar__rate-val">€{(settings.cashbackRatePerCup || 1.25).toFixed(2)}/cup</span>
          </div>
          <div className="admin-sidebar__rate-item">
            <span className="admin-sidebar__rate-label">Refund</span>
            <span className="admin-sidebar__rate-val">€{(settings.refundRatePerCup || 1.00).toFixed(2)}/cup</span>
          </div>
        </div>
      </div>

      {maintenanceConfirm && (
        <MaintenanceConfirmModal
          turningOn={maintenanceConfirm.nextValue}
          onConfirm={confirmMaintenance}
          onCancel={() => setMaintenanceConfirm(null)}
        />
      )}

      {/* Sidebar footer: org badge + profile menu.
       * "View Live App" used to live here — it moved to the floating
       * WorkflowDock (bottom-right) as the "Preview" action so we have
       * one canonical place for workflow controls. */}
      <div className="admin-sidebar__footer">
        <OrgSwitcher onNavigate={onNavigate} onAddOrg={onAddOrg} />
        <ProfileMenu />
      </div>
    </aside>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 * MaintenanceConfirmModal — gates the maintenance toggle.
 *
 * The maintenance switch in the sidebar is one click away from taking
 * the customer-facing app offline (or bringing it back). That's far
 * too high-stakes for a hover-target in a permanently-visible sidebar,
 * so we route both directions through a confirm modal that:
 *
 *   • States plainly what will happen in customer-facing terms.
 *   • Requires the admin to type a reason for the action (audit trail).
 *   • Shows visibly different copy + colour for ON vs OFF transitions.
 *   • Logs the change via actionLog so we can answer "who flipped this
 *     at 14:32 last Tuesday".
 *
 * The reason input is required for ON (lockout) but optional for OFF
 * (re-opening) — the asymmetry mirrors which direction is genuinely
 * customer-impacting. We still log either way. */
function MaintenanceConfirmModal({ turningOn, onConfirm, onCancel }) {
  const [reason, setReason] = useState('');
  const canSubmit = turningOn ? reason.trim().length >= 3 : true;

  return (
    <div className="admin-publish-overlay" onClick={onCancel}>
      <div className="admin-publish-modal" onClick={e => e.stopPropagation()}>
        <div className="admin-publish-modal__header">
          <div
            className="admin-publish-modal__icon"
            style={turningOn
              ? { background: 'rgba(253, 111, 70, 0.14)', color: '#FD6F46' }
              : { background: 'rgba(22, 163, 74, 0.12)',  color: '#16A34A' }}
          >
            {turningOn ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 002 3h16.94a2 2 0 002-3L13.71 3.86a2 2 0 00-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            )}
          </div>
          <div>
            <h3 className="admin-publish-modal__title">
              {turningOn ? 'Take customer app offline?' : 'Bring customer app back online?'}
            </h3>
            <p className="admin-publish-modal__sub">
              {turningOn
                ? 'Every customer will see a maintenance banner and can\'t scan cups, claim cashback, or share QR codes until you turn this off again.'
                : 'Customers will be able to scan, claim, and share again immediately.'}
            </p>
          </div>
        </div>

        <label className="admin-publish-modal__label">
          {turningOn ? 'Reason (required)' : 'Reason (optional)'}
        </label>
        <input
          className="admin-publish-modal__input"
          placeholder={turningOn
            ? 'e.g. Deploying new payout integration, expected back in 15 min'
            : 'e.g. Maintenance complete'}
          value={reason}
          onChange={e => setReason(e.target.value)}
          autoFocus
        />

        <div className="admin-publish-modal__actions">
          <button className="admin-publish-modal__cancel" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="admin-publish-modal__confirm"
            onClick={onConfirm}
            disabled={!canSubmit}
            style={turningOn ? { background: '#FD6F46' } : { background: '#16A34A' }}
            title={!canSubmit ? 'Please describe why you\'re taking the app offline' : ''}
          >
            {turningOn ? 'Take app offline →' : 'Bring app back online →'}
          </button>
        </div>
      </div>
    </div>
  );
}
