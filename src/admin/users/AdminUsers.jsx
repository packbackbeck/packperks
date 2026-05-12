import { useState, useEffect, useMemo } from 'react';
import { getAdminUsers, getUserActivity, getUserClaims, adjustUserBalance, adminUpdateUser } from '../lib/adminApi';
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
      await adjustUserBalance(user.id, adjustVal);
      onAdjustBalance(user.id, adjustVal);
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
          <div className="udp__email">{user.email || 'No email'}</div>
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
            <span className="udp__meta-val udp__meta-val--mono">{user.iban || '—'}</span>
          </div>
          <div className="udp__meta-item udp__meta-item--wide">
            <span className="udp__meta-label">Device / Browser</span>
            <span className="udp__meta-val udp__meta-val--muted">Not collected</span>
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
  email:   (u) => (u.email || '').toLowerCase(),
  cups:    (u) => u.cupBalance,
  lifetime:(u) => u.lifetimeCups,
  joined:  (u) => new Date(u.created_at).getTime(),
  active:  (u) => new Date(u.updated_at).getTime(),
};

export default function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedUser, setSelectedUser] = useState(null);
  const [sortKey, setSortKey] = useState('joined');
  const [sortDir, setSortDir] = useState('desc');

  useEffect(() => {
    getAdminUsers()
      .then(setUsers)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

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

  const filtered = useMemo(() => {
    let list = users;
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
  }, [users, search, sortKey, sortDir]);

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
          <p className="au-header__sub">{loading ? 'Loading…' : `${users.length} registered users`}</p>
        </div>
      </div>

      <div className="au-layout">
        <div className="au-table-wrap">
          <div className="au-search-bar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9E9A93" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              className="au-search-input"
              placeholder="Search by name, email or ID…"
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
                    <ThCol label="User" sortKey="name" />
                    <ThCol label="Email" sortKey="email" />
                    <ThCol label="Cups" sortKey="cups" style={{ width: 80 }} />
                    <ThCol label="Lifetime" sortKey="lifetime" style={{ width: 90 }} />
                    <ThCol label="Joined" sortKey="joined" style={{ width: 120 }} />
                    <ThCol label="Last active" sortKey="active" style={{ width: 120 }} />
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr><td colSpan={6} className="au-table__empty">No users found</td></tr>
                  ) : filtered.map(user => (
                    <tr
                      key={user.id}
                      className={`au-table__row ${selectedUser?.id === user.id ? 'au-table__row--active' : ''}`}
                      onClick={() => setSelectedUser(selectedUser?.id === user.id ? null : user)}
                    >
                      <td>
                        <div className="au-user-cell">
                          <div className="au-user-avatar">{(user.display_name || '?')[0].toUpperCase()}</div>
                          <span className="au-user-name">{user.display_name || 'Unknown'}</span>
                        </div>
                      </td>
                      <td className="au-muted">{user.email || '—'}</td>
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
    </div>
  );
}
