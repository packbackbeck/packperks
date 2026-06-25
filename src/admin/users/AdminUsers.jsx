import { useState, useEffect, useMemo } from 'react';
import { getAdminUsers, getUserActivity, getUserClaims, adjustUserBalance, adminUpdateUser, deleteRecords } from '../lib/adminApi';
import { logAction } from '../auth/actionLog';
import PiiMask from '../shared/PiiMask';
import EmptyState from '../shared/EmptyState';
import QuickLinks from '../shared/QuickLinks';
import { useBulkSelection } from '../shared/useBulkSelection';
import BulkDeleteBar from '../shared/BulkDeleteBar';
import MergeUsersModal from './MergeUsersModal';
import './AdminUsers.css';

function formatDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function timeAgo(ts) {
  if (!ts) return '—';
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

/* Classify the device string from the customer's user agent into a
 * displayable category + colour. Robust to nulls (legacy rows have no
 * device captured) — those render as a "Unknown" pill. */
function classifyDevice(device) {
  if (!device) return { kind: 'unknown', label: '—', tone: 'gray' };
  const d = device.toLowerCase();
  if (d.includes('ipad'))      return { kind: 'tablet',  label: device, tone: 'blue' };
  if (d.includes('iphone'))    return { kind: 'iphone',  label: device, tone: 'blue' };
  if (d.includes('android'))   return { kind: 'android', label: device, tone: 'green' };
  if (d.includes('mac'))       return { kind: 'mac',     label: device, tone: 'gray' };
  if (d.includes('windows'))   return { kind: 'windows', label: device, tone: 'gray' };
  if (d.includes('linux'))     return { kind: 'linux',   label: device, tone: 'gray' };
  if (d.includes('web'))       return { kind: 'web',     label: device, tone: 'gray' };
  return { kind: 'other', label: device, tone: 'gray' };
}

function DeviceBadge({ device }) {
  const meta = classifyDevice(device);
  return (
    <span className={`au-device au-device--${meta.tone}`} title={device || ''}>
      {meta.kind === 'iphone' && (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="7" y="2" width="10" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>
        </svg>
      )}
      {meta.kind === 'tablet' && (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="3" width="16" height="18" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>
        </svg>
      )}
      {meta.kind === 'android' && (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="7" y="2" width="10" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>
        </svg>
      )}
      {(meta.kind === 'mac' || meta.kind === 'windows' || meta.kind === 'linux' || meta.kind === 'web' || meta.kind === 'unknown' || meta.kind === 'other') && (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
        </svg>
      )}
      <span className="au-device__label">{meta.label}</span>
    </span>
  );
}

function TypeTag({ visitor }) {
  return (
    <span className={`au-type au-type--${visitor ? 'visitor' : 'user'}`} title={visitor ? 'Opened the app but took no action yet' : 'Did something real (cup, scan, email, IBAN, or reward)'}>
      {visitor ? (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>
      ) : (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="17 11 19 13 23 9"/></svg>
      )}
      {visitor ? 'Visitor' : 'User'}
    </span>
  );
}

function SortIcon({ active, dir }) {
  return (
    <span className={`au-sort-icon${active ? ' au-sort-icon--active' : ''}`}>
      {active ? (dir === 'asc' ? '↑' : '↓') : '↕'}
    </span>
  );
}

const ACT_META = {
  cup_added:      { color: '#4ADE80', symbol: '+' },
  reward_claimed: { color: '#FFC52F', symbol: '✓' },
  cups_withdrawn: { color: '#60A5FA', symbol: '−' },
  cups_shared:    { color: '#A78BFA', symbol: '→' },
  cups_donated:   { color: '#4ADE80', symbol: '♥' },
};

function UserDetailPanel({ user, onClose, onAdjustBalance, onUpdateUser }) {
  const [activity, setActivity] = useState([]);
  const [claims, setClaims] = useState([]);
  const [adjustVal, setAdjustVal] = useState(user.cupBalance);
  const [adjustReason, setAdjustReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);

  const [editMode, setEditMode] = useState(false);
  const [editName, setEditName] = useState(user.display_name || '');
  const [editEmail, setEditEmail] = useState(user.email || '');
  const [editIban, setEditIban] = useState(user.iban || '');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState(null);

  useEffect(() => {
    setAdjustVal(user.cupBalance);
    setEditName(user.display_name || '');
    setEditEmail(user.email || '');
    setEditIban(user.iban || '');
    setEditMode(false);
    setEditError(null);
    getUserActivity(user.id).then(setActivity).catch(() => {});
    getUserClaims(user.id).then(setClaims).catch(() => {});
  }, [user.id]);

  async function handleAdjust() {
    if (!adjustReason.trim()) return;
    setSaving(true);
    try {
      const beforeBalance = user.cupBalance;
      await adjustUserBalance(user.id, adjustVal);
      onAdjustBalance(user.id, adjustVal);
      // Audit log — balance edits are money movement, so an immutable
      // trail of who/what/why is the difference between an honest tool
      // and an opaque one. logAction is fire-and-forget; failures don't
      // block the UI update because the adjust itself already landed.
      logAction({
        action: 'user.balance_adjust',
        targetType: 'user',
        targetId: user.id,
        before: { cupBalance: beforeBalance },
        after:  { cupBalance: adjustVal },
        metadata: {
          delta: adjustVal - beforeBalance,
          reason: adjustReason.trim(),
          user_display_name: user.display_name,
          user_email: user.email,
        },
      });
      setAdjustOpen(false);
      setAdjustReason('');
    } finally {
      setSaving(false);
    }
  }

  async function handleEditSave() {
    setEditSaving(true);
    setEditError(null);
    try {
      await adminUpdateUser(user.id, {
        display_name: editName.trim(),
        email: editEmail.trim(),
        iban: editIban.trim(),
      });
      onUpdateUser(user.id, {
        display_name: editName.trim(),
        email: editEmail.trim(),
        iban: editIban.trim(),
      });
      setEditMode(false);
    } catch (err) {
      setEditError(err?.message || 'Update failed');
    } finally {
      setEditSaving(false);
    }
  }

  return (
    <div className="udp">
      <div className="udp__header">
        <div className="udp__avatar">{(user.display_name || '?')[0].toUpperCase()}</div>
        <div className="udp__info">
          <div className="udp__name">{user.display_name || 'Unknown'}</div>
          <div className="udp__email">
            {user.email
              ? <PiiMask type="email" value={user.email} targetType="user" targetId={user.id} inline />
              : 'No email'}
          </div>
        </div>
        <button className="udp__close" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div className="udp__body">
        <div className="udp__meta-grid">
          <div className="udp__meta-item">
            <span className="udp__meta-label">Cup Balance</span>
            <span className="udp__meta-val udp__meta-val--big">{user.cupBalance}</span>
          </div>
          <div className="udp__meta-item">
            <span className="udp__meta-label">Lifetime Cups</span>
            <span className="udp__meta-val">{user.lifetimeCups || 0}</span>
          </div>
          <div className="udp__meta-item">
            <span className="udp__meta-label">Joined</span>
            <span className="udp__meta-val">{formatDate(user.created_at)}</span>
          </div>
          <div className="udp__meta-item">
            <span className="udp__meta-label">Last Active</span>
            <span className="udp__meta-val">{timeAgo(user.updated_at)}</span>
          </div>
          <div className="udp__meta-item udp__meta-item--wide">
            <span className="udp__meta-label">IBAN</span>
            <span className="udp__meta-val udp__meta-val--mono">
              {user.iban
                ? <PiiMask type="iban" value={user.iban} targetType="user" targetId={user.id} />
                : <span style={{ color: '#B8B2A8' }}>—</span>}
            </span>
          </div>
          <div className="udp__meta-item udp__meta-item--wide">
            <span className="udp__meta-label">Device / Browser</span>
            <span className="udp__meta-val udp__meta-val--muted">{user.device || 'Not detected'}</span>
          </div>
        </div>

        {/* Edit user info */}
        <div className="udp__section">
          <div className="udp__section-header">
            <span className="udp__section-title">User Info</span>
            {!editMode ? (
              <button className="udp__section-btn" onClick={() => setEditMode(true)}>Edit</button>
            ) : (
              <button className="udp__section-btn udp__section-btn--cancel" onClick={() => { setEditMode(false); setEditError(null); }}>Cancel</button>
            )}
          </div>
          {editMode ? (
            <div className="udp__edit-form">
              {editError && <div className="udp__edit-error">{editError}</div>}
              <label className="udp__edit-label">Display Name</label>
              <input className="udp__edit-input" value={editName} onChange={e => setEditName(e.target.value)} placeholder="Display name" />
              <label className="udp__edit-label">Email</label>
              <input className="udp__edit-input" value={editEmail} onChange={e => setEditEmail(e.target.value)} placeholder="Email address" type="email" />
              <label className="udp__edit-label">IBAN</label>
              <input className="udp__edit-input" value={editIban} onChange={e => setEditIban(e.target.value)} placeholder="IBAN" />
              <button className="udp__adjust-confirm" style={{ width: '100%', marginTop: 4 }} onClick={handleEditSave} disabled={editSaving}>
                {editSaving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          ) : null}
        </div>

        {/* Balance adjust */}
        <div className="udp__section">
          <div className="udp__section-header">
            <span className="udp__section-title">Balance</span>
            <button className="udp__section-btn" onClick={() => setAdjustOpen(v => !v)}>
              Adjust manually
            </button>
          </div>
          {adjustOpen && (
            <div className="udp__adjust">
              <div className="udp__adjust-row">
                <input
                  type="number"
                  min="0"
                  className="udp__adjust-input"
                  value={adjustVal}
                  onChange={e => setAdjustVal(parseInt(e.target.value) || 0)}
                />
                <span className="udp__adjust-label">cups</span>
              </div>
              <input
                className="udp__adjust-reason"
                placeholder="Reason for adjustment (required)"
                value={adjustReason}
                onChange={e => setAdjustReason(e.target.value)}
              />
              <div className="udp__adjust-actions">
                <button className="udp__adjust-cancel" onClick={() => setAdjustOpen(false)}>Cancel</button>
                <button className="udp__adjust-confirm" onClick={handleAdjust} disabled={!adjustReason.trim() || saving}>
                  {saving ? 'Saving…' : 'Confirm'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Claims */}
        <div className="udp__section">
          <div className="udp__section-title">Claims ({claims.length})</div>
          {claims.length === 0 ? <div className="udp__empty">No claims yet</div> : (
            <div className="udp__claim-list">
              {claims.map(c => (
                <div key={c.id} className="udp__claim-item">
                  <span className={`udp__claim-badge udp__claim-badge--${c.status}`}>{c.status}</span>
                  <span className="udp__claim-type">{c.type === 'cashback' ? 'Cashback' : 'Refund'}</span>
                  <span className="udp__claim-amount">€{(c.payout_amount || 0).toFixed(2)}</span>
                  <span className="udp__claim-date">{formatDate(c.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Activity */}
        <div className="udp__section">
          <div className="udp__section-title">Activity ({activity.length})</div>
          {activity.length === 0 ? <div className="udp__empty">No activity yet</div> : (
            <div className="udp__activity-list">
              {activity.slice(0, 10).map((item, i) => {
                const meta = ACT_META[item.type] || { color: '#9E9A93', symbol: '·' };
                return (
                  <div key={i} className="udp__activity-item">
                    <span className="udp__activity-dot" style={{ background: `${meta.color}20`, color: meta.color }}>{meta.symbol}</span>
                    <span className="udp__activity-label">{item.label || item.type}</span>
                    <span className="udp__activity-time">{timeAgo(item.created_at)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const SORT_KEYS = {
  name:    (u) => (u.display_name || '').toLowerCase(),
  type:    (u) => (u.isVisitor ? 1 : 0),
  email:   (u) => (u.email || '').toLowerCase(),
  device:  (u) => (u.device || '').toLowerCase(),
  cups:    (u) => u.cupBalance,
  lifetime:(u) => u.lifetimeCups,
  joined:  (u) => new Date(u.created_at).getTime(),
  active:  (u) => new Date(u.updated_at).getTime(),
};

export default function AdminUsers({ onNavigate }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedUser, setSelectedUser] = useState(null);
  const [sortKey, setSortKey] = useState('joined');
  const [sortDir, setSortDir] = useState('desc');
  const [showVisitors, setShowVisitors] = useState(true); // default on
  const [mergeOpen, setMergeOpen] = useState(false);

  const reload = () => {
    setLoading(true);
    getAdminUsers()
      .then(setUsers)
      .catch(console.error)
      .finally(() => setLoading(false));
  };
  useEffect(() => { reload(); }, []);

  function handleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  }

  function handleAdjustBalance(userId, newBalance) {
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, cupBalance: newBalance } : u));
    if (selectedUser?.id === userId) setSelectedUser(prev => ({ ...prev, cupBalance: newBalance }));
  }

  function handleUpdateUser(userId, updates) {
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, ...updates } : u));
    if (selectedUser?.id === userId) setSelectedUser(prev => ({ ...prev, ...updates }));
  }

  const visitorCount = useMemo(() => users.filter(u => u.isVisitor).length, [users]);
  const userCount = users.length - visitorCount;

  const filtered = useMemo(() => {
    let list = users;
    if (!showVisitors) list = list.filter(u => !u.isVisitor);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(u =>
        (u.display_name || '').toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q) ||
        (u.id || '').toLowerCase().includes(q)
      );
    }
    const getter = SORT_KEYS[sortKey] || SORT_KEYS.joined;
    return [...list].sort((a, b) => {
      const av = getter(a), bv = getter(b);
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [users, search, sortKey, sortDir, showVisitors]);

  const sel = useBulkSelection(filtered);

  function ThCol({ label, sortKey: sk, style }) {
    return (
      <th style={style} className="au-th--sortable" onClick={() => handleSort(sk)}>
        {label} <SortIcon active={sortKey === sk} dir={sortDir} />
      </th>
    );
  }

  return (
    <div className="admin-users">
      <div className="au-header">
        <div>
          <h1 className="au-header__title">Users</h1>
          <p className="au-header__sub">
            {loading ? 'Loading…' : `${userCount} user${userCount === 1 ? '' : 's'} · ${visitorCount} visitor${visitorCount === 1 ? '' : 's'}`}
          </p>
        </div>
        <label className="au-visitor-toggle" title="Visitors opened the app but took no action yet">
          <span>Show visitors</span>
          <input
            type="checkbox"
            className="au-switch-input"
            checked={showVisitors}
            onChange={e => setShowVisitors(e.target.checked)}
          />
          <span className="au-switch" aria-hidden="true"><span className="au-switch__dot" /></span>
        </label>
      </div>

      <div className="au-layout">
        <div className="au-table-wrap">
          <div className="au-search-bar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9E9A93" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              className="au-search-input"
              placeholder="Search by name, email, or short ID (first 8 chars)…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          {loading ? (
            <div className="au-loading">Loading users…</div>
          ) : (
            <div className="au-table-scroll">
              <table className="au-table">
                <thead>
                  <tr>
                    <th className="bulk-check-cell">
                      <input
                        type="checkbox"
                        checked={sel.allSelected}
                        ref={el => { if (el) el.indeterminate = sel.someSelected && !sel.allSelected; }}
                        onChange={sel.toggleAll}
                        aria-label="Select all users"
                      />
                    </th>
                    <ThCol label="User" sortKey="name" />
                    <ThCol label="Type" sortKey="type" style={{ width: 110 }} />
                    <ThCol label="Email" sortKey="email" />
                    <ThCol label="Device" sortKey="device" style={{ width: 160 }} />
                    <ThCol label="Cups" sortKey="cups" style={{ width: 80 }} />
                    <ThCol label="Lifetime" sortKey="lifetime" style={{ width: 90 }} />
                    <ThCol label="Joined" sortKey="joined" style={{ width: 120 }} />
                    <ThCol label="Last active" sortKey="active" style={{ width: 120 }} />
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr><td colSpan={9} className="au-table__empty">
                      {users.length === 0 ? (
                        <EmptyState
                          icon={
                            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                              <circle cx="9" cy="7" r="4" />
                              <path d="M23 21v-2a4 4 0 00-3-3.87" />
                              <path d="M16 3.13a4 4 0 010 7.75" />
                            </svg>
                          }
                          title="No customers yet"
                          body="Once someone opens the user app and scans their first cup, they'll appear here. Try the customer flow yourself to seed test data."
                          primaryAction={{ label: 'Open user app', onClick: () => window.open('/', '_blank') }}
                        />
                      ) : (
                        <EmptyState
                          icon={
                            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                              <circle cx="11" cy="11" r="8" />
                              <line x1="21" y1="21" x2="16.65" y2="16.65" />
                            </svg>
                          }
                          title="No customers match your filters"
                          body={`${users.length} customer${users.length === 1 ? '' : 's'} on file — try a shorter search or clear the filter.`}
                          secondaryAction={{ label: 'Clear search', onClick: () => setSearch('') }}
                        />
                      )}
                    </td></tr>
                  ) : filtered.map(user => (
                    <tr
                      key={user.id}
                      className={`au-table__row ${selectedUser?.id === user.id ? 'au-table__row--active' : ''}`}
                      onClick={() => setSelectedUser(selectedUser?.id === user.id ? null : user)}
                    >
                      <td className="bulk-check-cell" onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={sel.isSelected(user.id)}
                          onChange={() => sel.toggle(user.id)}
                          aria-label="Select user"
                        />
                      </td>
                      <td>
                        <div className="au-user-cell">
                          <div className="au-user-avatar">{(user.display_name || '?')[0].toUpperCase()}</div>
                          <div className="au-user-info">
                            <span className="au-user-name">{user.display_name || 'Unknown'}</span>
                            <span
                              className="au-user-id"
                              title={`Full ID: ${user.id}`}
                            >
                              ID: <span className="au-mono">{user.id.slice(0, 8)}</span>
                            </span>
                          </div>
                        </div>
                      </td>
                      <td><TypeTag visitor={user.isVisitor} /></td>
                      <td className="au-muted" onClick={e => e.stopPropagation()}>
                        <PiiMask type="email" value={user.email} targetType="user" targetId={user.id} inline />
                      </td>
                      <td className="au-device-cell">
                        <DeviceBadge device={user.device} />
                      </td>
                      <td><span className="au-cup-badge">{user.cupBalance}</span></td>
                      <td className="au-muted">{user.lifetimeCups || 0}</td>
                      <td className="au-muted">{formatDate(user.created_at)}</td>
                      <td className="au-muted">{timeAgo(user.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {selectedUser && (
          <UserDetailPanel
            user={selectedUser}
            onClose={() => setSelectedUser(null)}
            onAdjustBalance={handleAdjustBalance}
            onUpdateUser={handleUpdateUser}
          />
        )}
      </div>

      <BulkDeleteBar
        count={sel.count}
        noun="users"
        onClear={sel.clear}
        onDelete={async () => {
          const ids = sel.selectedIds;
          await deleteRecords('users', ids);
          if (selectedUser && ids.includes(selectedUser.id)) setSelectedUser(null);
          sel.clear();
          reload();
        }}
        extraAction={{
          label: `Merge ${sel.count}`,
          onClick: () => setMergeOpen(true),
          // Merge needs ≥2 selected accounts. Only available when 2+ are chosen.
          visible: sel.count >= 2,
        }}
      />

      <MergeUsersModal
        open={mergeOpen}
        users={users.filter(u => sel.isSelected(u.id))}
        onClose={() => setMergeOpen(false)}
        onMerged={(result) => {
          // Close, clear selection, drop the right-pane if it was an absorbed
          // user, then reload from the server so balances/profile reflect the
          // merge.
          setMergeOpen(false);
          const absorbed = result?.absorbed_ids || [];
          if (selectedUser && absorbed.includes(selectedUser.id)) setSelectedUser(null);
          sel.clear();
          reload();
        }}
      />

      <QuickLinks currentPage="users" onNavigate={onNavigate} />
    </div>
  );
}
