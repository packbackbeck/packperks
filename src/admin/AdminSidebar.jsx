import './AdminSidebar.css';

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
  {
    id: 'cupscans',
    label: 'Cup Scans',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
        <circle cx="12" cy="13" r="4" />
      </svg>
    ),
  },
  {
    id: 'receipts',
    label: 'Receipt Check',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="9" y1="13" x2="15" y2="13"/>
        <line x1="9" y1="17" x2="15" y2="17"/>
        <polyline points="9 9 10 9 11 9"/>
      </svg>
    ),
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
      </svg>
    ),
  },
  {
    id: 'reports',
    label: 'Reports',
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
    id: 'history',
    label: 'Version History',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 3v5h5" />
        <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="12" x2="15" y2="15" />
      </svg>
    ),
  },
];

const TOGGLES = [
  { key: 'featureCupSharing',    label: 'Cup Sharing' },
  { key: 'featureDonations',     label: 'Donations' },
  { key: 'featureDirectRefunds', label: 'Direct Refunds' },
  { key: 'maintenanceMode',      label: 'Maintenance', warn: true },
];

export default function AdminSidebar({ activePage, onNavigate, pendingClaims = 0, pendingScans = 0, draftState }) {
  const totalPending = pendingClaims + pendingScans;
  const settings = draftState?.draft?.settings || {};
  const toggleFeature = draftState?.toggleFeature;

  return (
    <aside className="admin-sidebar">
      <nav className="admin-sidebar__nav">
        {NAV_ITEMS.map(item => {
          const isActive = activePage === item.id;
          const badge =
            item.id === 'claims'   ? pendingClaims :
            item.id === 'receipts' ? pendingClaims :
            item.id === 'cupscans' ? pendingScans :
            item.id === 'overview' && totalPending > 0 ? totalPending : 0;

          return (
            <button
              key={item.id}
              className={`admin-sidebar__item ${isActive ? 'admin-sidebar__item--active' : ''}`}
              onClick={() => onNavigate(item.id)}
            >
              <span className="admin-sidebar__item-icon">{item.icon}</span>
              <span className="admin-sidebar__item-label">{item.label}</span>
              {badge > 0 && (
                <span className="admin-sidebar__badge">{badge}</span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="admin-sidebar__toggles">
        <div className="admin-sidebar__toggles-label">Quick Settings</div>

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

        {TOGGLES.map(t => (
          <div key={t.key} className="admin-sidebar__toggle-row" onClick={() => toggleFeature?.(t.key)}>
            <span className={`admin-sidebar__toggle-name${t.warn && settings[t.key] ? ' admin-sidebar__toggle-name--warn' : ''}`}>
              {t.label}
            </span>
            <span className={`admin-sidebar__toggle-pill${settings[t.key] ? (t.warn ? ' admin-sidebar__toggle-pill--warn' : ' admin-sidebar__toggle-pill--on') : ' admin-sidebar__toggle-pill--off'}`}>
              {settings[t.key] ? 'On' : 'Off'}
            </span>
          </div>
        ))}
      </div>

      <div className="admin-sidebar__footer">
        <button className="admin-sidebar__footer-btn" onClick={() => window.open('/', '_blank')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
          View Live App
        </button>
      </div>
    </aside>
  );
}
