import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Check, Dot, ExternalLink, Eye, Gift, GitMerge, Heart, Monitor, Plus, Search, Send, Smartphone, Tablet,
  Undo2, UserCheck, Users, X,
} from 'lucide-react';
import { getAdminUsers, getUserActivity, getUserClaims, adjustUserBalance, adminUpdateUser, deleteRecords, deleteGroupAccounts, getMergeLimit, saveMergeLimit, getMergeRequests, approveMergeRequest, rejectMergeRequest, MERGE_LIMIT_DEFAULT } from '../lib/adminApi';
import { useOrg } from '../context/OrgContext';
import { logAction } from '../auth/actionLog';
import PiiMask from '../shared/PiiMask';
import { useBulkSelection } from '../shared/useBulkSelection';
import BulkDeleteBar from '../shared/BulkDeleteBar';
import ColumnPicker from '../shared/ColumnPicker';
import { Avatar, Notice, SearchBox, SortTh, SplitHandle } from '../shared/opsTable';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, PageHeader, Segmented, Switch } from '../ui';
import MergeUsersModal from './MergeUsersModal';
import MergeRequestModal from './MergeRequestModal';
import './AdminUsers.css';
import { useAdminMoney } from '../lib/adminMoney';

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
  if (!device) return { kind: 'unknown', label: '—', tone: 'neutral' };
  const d = device.toLowerCase();
  if (d.includes('ipad'))      return { kind: 'tablet',  label: device, tone: 'info' };
  if (d.includes('iphone'))    return { kind: 'iphone',  label: device, tone: 'info' };
  if (d.includes('android'))   return { kind: 'android', label: device, tone: 'success' };
  if (d.includes('mac'))       return { kind: 'mac',     label: device, tone: 'neutral' };
  if (d.includes('windows'))   return { kind: 'windows', label: device, tone: 'neutral' };
  if (d.includes('linux'))     return { kind: 'linux',   label: device, tone: 'neutral' };
  if (d.includes('web'))       return { kind: 'web',     label: device, tone: 'neutral' };
  return { kind: 'other', label: device, tone: 'neutral' };
}

const DEVICE_ICON = { iphone: Smartphone, android: Smartphone, tablet: Tablet };

function DeviceBadge({ device }) {
  const meta = classifyDevice(device);
  const Icon = DEVICE_ICON[meta.kind] || Monitor;
  return (
    <span className={`ui-badge ui-badge--${meta.tone} au-device`} title={device || ''}>
      <Icon size={11} aria-hidden="true" />
      <span className="au-device__label">{meta.label}</span>
    </span>
  );
}

function TypeTag({ visitor }) {
  return (
    <Badge
      tone={visitor ? 'neutral' : 'success'}
      icon={visitor ? Eye : UserCheck}
      title={visitor ? 'Opened the app but took no action yet' : 'Did something real (cup, scan, email, or reward)'}
    >
      {visitor ? 'Visitor' : 'User'}
    </Badge>
  );
}

const ACT_META = {
  cup_added:      { tone: 'emerald', icon: Plus },
  reward_claimed: { tone: 'amber',   icon: Gift },
  cups_withdrawn: { tone: 'sky',     icon: Undo2 },
  cups_shared:    { tone: 'violet',  icon: Send },
  cups_donated:   { tone: 'rose',    icon: Heart },
};

const CLAIM_STATUS = {
  pending:   { tone: 'warning', label: 'Pending' },
  completed: { tone: 'success', label: 'Approved' },
  failed:    { tone: 'danger',  label: 'Rejected' },
};

function UserDetailPanel({ user, onClose, onAdjustBalance, onUpdateUser, hideCups = false }) {
  const { money } = useAdminMoney();
  const [activity, setActivity] = useState([]);
  const [claims, setClaims] = useState([]);
  const [adjustVal, setAdjustVal] = useState(user.cupBalance);
  const [adjustReason, setAdjustReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);

  const [editMode, setEditMode] = useState(false);
  const [editName, setEditName] = useState(user.display_name || '');
  const [editEmail, setEditEmail] = useState(user.email || '');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState(null);

  useEffect(() => {
    setAdjustVal(user.cupBalance);
    setEditName(user.display_name || '');
    setEditEmail(user.email || '');
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
      });
      onUpdateUser(user.id, {
        display_name: editName.trim(),
        email: editEmail.trim(),
      });
      setEditMode(false);
    } catch (err) {
      setEditError(err?.message || 'Update failed');
    } finally {
      setEditSaving(false);
    }
  }

  // Instant toggle for the marketing-email opt-in (records proof + source
  // 'admin' server-side). Separate from the Edit form so it's one tap.
  async function handleToggleMarketing() {
    const next = !user.marketing_consent;
    try {
      await adminUpdateUser(user.id, { marketing_consent: next });
      onUpdateUser(user.id, { marketing_consent: next });
    } catch (err) {
      console.error('marketing consent toggle failed', err);
    }
  }

  return (
    <div className="ot-panel udp">
      <div className="ot-panel__head udp__header">
        <Avatar name={user.display_name} seed={user.id} size={40} />
        <div className="udp__info">
          <p className="udp__name">{user.display_name || 'Unknown'}</p>
          <div className="udp__email">
            {user.email
              ? <PiiMask type="email" value={user.email} targetType="user" targetId={user.id} inline />
              : 'No email'}
          </div>
        </div>
        <Button variant="ghost" size="sm" icon={X} aria-label="Close" onClick={onClose} />
      </div>

      <div className="ot-panel__body udp__body">
        <div className="udp__meta-grid">
          {/* Deferred Tikkie has no cup balance to show or adjust — the
              money goes straight out through Tikkie. */}
          {!hideCups && (
            <>
              <div className="udp__meta-item">
                <span className="udp__meta-label">Cup balance</span>
                <span className="udp__meta-val udp__meta-val--big">{user.cupBalance}</span>
              </div>
              <div className="udp__meta-item">
                <span className="udp__meta-label">Lifetime cups</span>
                <span className="udp__meta-val udp__meta-val--big udp__meta-val--plain">{user.lifetimeCups || 0}</span>
              </div>
            </>
          )}
          <div className="udp__meta-item">
            <span className="udp__meta-label">Joined</span>
            <span className="udp__meta-val">{formatDate(user.created_at)}</span>
          </div>
          <div className="udp__meta-item">
            <span className="udp__meta-label">Last active</span>
            <span className="udp__meta-val">{timeAgo(user.updated_at)}</span>
          </div>
          <div className="udp__meta-item udp__meta-item--wide">
            <span className="udp__meta-label">Device / browser</span>
            <span className={`udp__meta-val${user.device ? '' : ' udp__meta-val--muted'}`}>{user.device || 'Not detected'}</span>
          </div>
          <div className="udp__meta-item udp__meta-item--wide udp__meta-item--row">
            <span className="udp__consent-text">
              <span className="udp__meta-label">Marketing email</span>
              <span className="udp__consent-state">{user.marketing_consent ? 'Opted in' : 'Not opted in'}</span>
            </span>
            <Switch
              checked={!!user.marketing_consent}
              onChange={handleToggleMarketing}
              label="Marketing email consent"
            />
          </div>
        </div>

        {/* Edit user info */}
        <section className="udp__section">
          <div className="udp__section-header">
            <h3 className="udp__section-title">User info</h3>
            {!editMode ? (
              <Button variant="ghost" size="sm" onClick={() => setEditMode(true)}>Edit</Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => { setEditMode(false); setEditError(null); }}>Cancel</Button>
            )}
          </div>
          {editMode ? (
            <div className="udp__box">
              {editError && <div className="udp__edit-error" role="alert">{editError}</div>}
              <label className="udp__edit-label" htmlFor={`udp-name-${user.id}`}>Display name</label>
              <input id={`udp-name-${user.id}`} className="ui-input" value={editName} onChange={e => setEditName(e.target.value)} placeholder="Display name" />
              <label className="udp__edit-label" htmlFor={`udp-email-${user.id}`}>Email</label>
              <input id={`udp-email-${user.id}`} className="ui-input" value={editEmail} onChange={e => setEditEmail(e.target.value)} placeholder="Email address" type="email" />
              <Button variant="primary" size="sm" block className="udp__box-submit" onClick={handleEditSave} disabled={editSaving}>
                {editSaving ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          ) : null}
        </section>

        {/* Balance adjust */}
        {!hideCups && <section className="udp__section">
          <div className="udp__section-header">
            <h3 className="udp__section-title">Balance</h3>
            <Button variant="ghost" size="sm" onClick={() => setAdjustOpen(v => !v)} aria-expanded={adjustOpen}>
              Adjust manually
            </Button>
          </div>
          {adjustOpen && (
            <div className="udp__box">
              <div className="udp__adjust-row">
                <input
                  type="number"
                  min="0"
                  className="ui-input udp__adjust-input"
                  value={adjustVal}
                  onChange={e => setAdjustVal(parseInt(e.target.value) || 0)}
                  aria-label="New cup balance"
                />
                <span className="udp__adjust-label">cups</span>
              </div>
              <input
                className="ui-input"
                placeholder="Reason for adjustment (required)"
                value={adjustReason}
                onChange={e => setAdjustReason(e.target.value)}
                aria-label="Reason for adjustment"
              />
              <div className="udp__adjust-actions">
                <Button variant="outline" size="sm" onClick={() => setAdjustOpen(false)}>Cancel</Button>
                <Button variant="primary" size="sm" onClick={handleAdjust} disabled={!adjustReason.trim() || saving}>
                  {saving ? 'Saving…' : 'Confirm'}
                </Button>
              </div>
            </div>
          )}
        </section>}

        {/* Claims */}
        <section className="udp__section">
          <div className="udp__section-header">
            <h3 className="udp__section-title">Claims <span className="udp__count">{claims.length}</span></h3>
          </div>
          {claims.length === 0 ? <p className="udp__empty">No claims yet</p> : (
            <ul className="udp__list">
              {claims.map(c => {
                const st = CLAIM_STATUS[c.status] || { tone: 'neutral', label: c.status };
                return (
                  <li key={c.id} className="udp__claim-item">
                    <Badge tone={st.tone}>{st.label}</Badge>
                    <span className="udp__claim-type">{c.type === 'cashback' ? 'Cashback' : 'Refund'}</span>
                    <span className="udp__claim-amount">{money(c.payout_amount || 0)}</span>
                    <span className="udp__claim-date">{formatDate(c.created_at)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Activity */}
        <section className="udp__section">
          <div className="udp__section-header">
            <h3 className="udp__section-title">Activity <span className="udp__count">{activity.length}</span></h3>
          </div>
          {activity.length === 0 ? <p className="udp__empty">No activity yet</p> : (
            <ul className="udp__list">
              {activity.slice(0, 10).map((item, i) => {
                const meta = ACT_META[item.type] || { tone: 'slate', icon: Dot };
                const Icon = meta.icon;
                return (
                  <li key={i} className="udp__activity-item">
                    <span className={`udp__activity-dot ui-tone--${meta.tone}`} aria-hidden="true"><Icon size={12} /></span>
                    <span className="udp__activity-label">{item.label || item.type}</span>
                    <span className="udp__activity-time">{timeAgo(item.created_at)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

const SORT_KEYS = {
  name:    (u) => (u.display_name || '').toLowerCase(),
  type:    (u) => (u.isVisitor ? 1 : 0),
  email:   (u) => (u.email || '').toLowerCase(),
  marketing:(u) => (u.marketing_consent ? 1 : 0),
  device:  (u) => (u.device || '').toLowerCase(),
  cups:    (u) => u.cupBalance,
  lifetime:(u) => u.lifetimeCups,
  joined:  (u) => new Date(u.created_at).getTime(),
  active:  (u) => new Date(u.updated_at).getTime(),
};

export default function AdminUsers({ onNavigate, focusUserId, onFocusConsumed, focusSection, onSectionConsumed }) {
  // Group awareness: within a BYO group, users are one shared account across
  // every store, so we load the whole group's deduped customer base.
  const { activeOrgId, activeGroupId, groupMemberIds, groupMembers, activeOrgMode } = useOrg();
  // Deferred Tikkie customers have no cup balance and no rewards: the same
  // page, minus the columns and controls that would always read zero.
  const isTikkie = activeOrgMode === 'tikkie_only';
  const grouped = !!activeGroupId && groupMembers.length > 1;
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedUser, setSelectedUser] = useState(null);
  const [sortKey, setSortKey] = useState('joined');
  const [sortDir, setSortDir] = useState('desc');
  const [showVisitors, setShowVisitors] = useState(true); // default on
  const [mergeOpen, setMergeOpen] = useState(false);

  // Column visibility. In a group the table gains one cup column per store + a
  // Total column; the DEFAULT visible cup column is the store the admin has
  // opened (activeOrgId), with the others available via the columns dropdown.
  // Non-grouped orgs keep the single "Cups" column and no picker.
  const orgCols = grouped
    ? groupMembers.map(m => ({ id: `org:${m.id}`, orgId: m.id, label: m.name }))
    : [];
  const columnConfig = [
    { id: 'type', label: 'Type', defaultOn: true },
    { id: 'email', label: 'Email', defaultOn: true },
    { id: 'marketing', label: 'Marketing', defaultOn: true },
    { id: 'device', label: 'Device', defaultOn: true },
    ...(isTikkie ? [] : [
      ...orgCols.map(c => ({ id: c.id, label: `${c.label} cups`, defaultOn: c.orgId === activeOrgId })),
      ...(grouped ? [{ id: 'total', label: 'Total cups', desc: 'Combined across every store', defaultOn: true }] : []),
      { id: 'lifetime', label: 'Lifetime', defaultOn: true },
    ]),
    { id: 'joined', label: 'Joined', defaultOn: true },
    { id: 'active', label: 'Last active', defaultOn: true },
  ];
  const defaultVisibleCols = () => {
    const s = new Set(['type', 'email', 'marketing', 'device', 'joined', 'active']);
    if (!isTikkie) {
      s.add('lifetime');
      if (grouped) { s.add('total'); s.add(`org:${activeOrgId}`); }
    }
    return s;
  };
  const [visibleCols, setVisibleCols] = useState(defaultVisibleCols);
  const isCol = (id) => visibleCols.has(id);
  // Reset to the opened-store default whenever the store/group changes so the
  // default cup column always follows the org the admin is looking at.
  useEffect(() => { setVisibleCols(defaultVisibleCols()); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [activeOrgId, activeGroupId, groupMemberIds.join(',')]);
  function toggleCol(id) {
    setVisibleCols(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  const reload = () => {
    setLoading(true);
    getAdminUsers(activeGroupId ? groupMemberIds : undefined)
      .then(setUsers)
      .catch(console.error)
      .finally(() => setLoading(false));
  };
  // Reload when the store/group changes so switching between grouped stores
  // shows the same shared base (and switching to a solo org narrows it).
  useEffect(() => { reload(); }, [activeOrgId, activeGroupId, groupMemberIds.join(',')]);

  /* Another page (Cup Scans) can deep-link to a specific customer via
   * onNavigate('users', { focusUserId }). Open that user's panel once the
   * list has loaded, then tell the shell it's been consumed. */
  useEffect(() => {
    if (!focusUserId || loading) return;
    const u = users.find(x => x.id === focusUserId);
    if (u) setSelectedUser(u);
    onFocusConsumed?.();
  }, [focusUserId, users, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Resizable split (review layout): drag the divider to set the detail
   * panel's width. Persisted so each admin's chosen width sticks. */
  const layoutRef = useRef(null);
  const draggingSplit = useRef(false);
  const [reviewSplit, setReviewSplit] = useState(() => {
    if (typeof window === 'undefined') return 420;
    const saved = Number(localStorage.getItem('pp_admin_users_split'));
    return saved >= 320 ? saved : 420;
  });
  useEffect(() => {
    function onMove(e) {
      if (!draggingSplit.current || !layoutRef.current) return;
      const rect = layoutRef.current.getBoundingClientRect();
      // Panel width = distance from cursor to the right edge. Clamp so the
      // table keeps ≥420px and the panel keeps ≥320px.
      const w = Math.max(320, Math.min(rect.width - 420, rect.right - e.clientX));
      setReviewSplit(w);
    }
    function onUp() {
      if (!draggingSplit.current) return;
      draggingSplit.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      try { localStorage.setItem('pp_admin_users_split', String(Math.round(reviewSplit))); } catch { /* ignore */ }
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [reviewSplit]);
  function startSplitDrag(e) {
    e.preventDefault();
    draggingSplit.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

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
    const getter =
      sortKey === 'total' ? (u => u.cupBalance) :
      sortKey.startsWith('org:') ? (u => u.orgBalances?.[sortKey.slice(4)]?.balance || 0) :
      (SORT_KEYS[sortKey] || SORT_KEYS.joined);
    return [...list].sort((a, b) => {
      const av = getter(a), bv = getter(b);
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [users, search, sortKey, sortDir, showVisitors]);

  const sel = useBulkSelection(filtered);

  // Number of columns actually rendered (checkbox + User + visible value cols),
  // for the empty-state colSpan.
  const valueColCount =
    (isCol('type') ? 1 : 0) + (isCol('email') ? 1 : 0) + (isCol('marketing') ? 1 : 0) + (isCol('device') ? 1 : 0) +
    (grouped ? orgCols.filter(c => isCol(c.id)).length + (isCol('total') ? 1 : 0) : (isTikkie ? 0 : 1)) +
    (isCol('lifetime') ? 1 : 0) + (isCol('joined') ? 1 : 0) + (isCol('active') ? 1 : 0);
  const tableColSpan = 2 + valueColCount;

  const sort = { key: sortKey, dir: sortDir };
  const th = (label, sk, style, className) => <SortTh label={label} field={sk} sort={sort} onSort={handleSort} style={style} className={className} />;

  return (
    <div className="ui-page au-page">
      <PageHeader
        title="Users"
        subtitle={loading
          ? 'Customer accounts, balances and merges. Loading…'
          : `Customer accounts, balances and merges. ${userCount} user${userCount === 1 ? '' : 's'} · ${visitorCount} visitor${visitorCount === 1 ? '' : 's'}.`}
      >
        <label className="au-visitor-toggle" title="Visitors opened the app but took no action yet">
          <span>Show visitors</span>
          <Switch checked={showVisitors} onChange={setShowVisitors} label="Show visitors" />
        </label>
        {grouped && (
          <ColumnPicker
            columns={columnConfig}
            visible={visibleCols}
            onToggle={toggleCol}
            onReset={() => setVisibleCols(defaultVisibleCols())}
          />
        )}
      </PageHeader>

      <div
        className={`au-layout${selectedUser ? ' au-layout--review' : ''}`}
        ref={layoutRef}
        style={selectedUser ? { gridTemplateColumns: `minmax(360px, 1fr) 12px minmax(300px, ${reviewSplit}px)` } : undefined}
      >
        <Card className="au-table-wrap">
          <div className="au-search-bar">
            <SearchBox
              className="au-search"
              value={search}
              onChange={setSearch}
              placeholder="Search by name, email, or short ID (first 8 characters)"
              label="Search users"
            />
          </div>

          {loading ? (
            <div className="au-loading">Loading users…</div>
          ) : (
            <div className="ot-table-card au-table-scroll">
              <table className="ui-table au-table">
                <thead>
                  <tr>
                    <th className="ot-check">
                      <input
                        type="checkbox"
                        checked={sel.allSelected}
                        ref={el => { if (el) el.indeterminate = sel.someSelected && !sel.allSelected; }}
                        onChange={sel.toggleAll}
                        aria-label="Select all users"
                      />
                    </th>
                    {th('User', 'name')}
                    {isCol('type') && th('Type', 'type', { width: 110 })}
                    {isCol('email') && th('Email', 'email')}
                    {isCol('marketing') && th('Marketing', 'marketing', { width: 110 })}
                    {isCol('device') && th('Device', 'device', { width: 160 })}
                    {grouped
                      ? (
                        <>
                          {orgCols.map(c => isCol(c.id) && (
                            <SortTh key={c.id} label={c.label} field={c.id} sort={sort} onSort={handleSort} style={{ width: 92 }} className="ui-num" />
                          ))}
                          {isCol('total') && th('Total', 'total', { width: 80 }, 'ui-num')}
                        </>
                      )
                      : (!isTikkie && th('Cups', 'cups', { width: 80 }, 'ui-num'))}
                    {isCol('lifetime') && th('Lifetime', 'lifetime', { width: 90 }, 'ui-num')}
                    {isCol('joined') && th('Joined', 'joined', { width: 120 })}
                    {isCol('active') && th('Last active', 'active', { width: 120 })}
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr className="au-empty-row"><td colSpan={tableColSpan}>
                      {users.length === 0 ? (
                        <EmptyState
                          icon={Users}
                          title="No customers yet"
                          action={<Button variant="outline" size="sm" icon={ExternalLink} onClick={() => window.open('/', '_blank')}>Open user app</Button>}
                        >
                          Once someone opens the customer app and scans their first cup, they appear here.
                        </EmptyState>
                      ) : (
                        <EmptyState
                          icon={Search}
                          title="No customers match your filters"
                          action={<Button variant="outline" size="sm" onClick={() => setSearch('')}>Clear search</Button>}
                        >
                          {`${users.length} customer${users.length === 1 ? '' : 's'} on file. Try a shorter search or clear the filter.`}
                        </EmptyState>
                      )}
                    </td></tr>
                  ) : filtered.map(user => (
                    <tr
                      key={user.id}
                      className={`ot-row${sel.isSelected(user.id) ? ' ot-row--selected' : ''}${selectedUser?.id === user.id ? ' ot-row--active' : ''}`}
                      onClick={() => setSelectedUser(selectedUser?.id === user.id ? null : user)}
                    >
                      <td className="ot-check" onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={sel.isSelected(user.id)}
                          onChange={() => sel.toggle(user.id)}
                          aria-label="Select user"
                        />
                      </td>
                      <td>
                        <div className="ot-person">
                          <Avatar name={user.display_name} seed={user.id} size={32} />
                          <div className="ot-person__text">
                            <span className="ot-person__name">{user.display_name || 'Unknown'}</span>
                            <span className="ot-person__sub au-user-id" title={`Full ID: ${user.id}`}>
                              ID <span className="ot-mono">{user.id.slice(0, 8)}</span>
                            </span>
                          </div>
                        </div>
                      </td>
                      {isCol('type') && <td><TypeTag visitor={user.isVisitor} /></td>}
                      {isCol('email') && (
                        <td className="au-email-cell" onClick={e => e.stopPropagation()}>
                          <PiiMask type="email" value={user.email} targetType="user" targetId={user.id} inline />
                        </td>
                      )}
                      {isCol('marketing') && (
                        <td>
                          {user.marketing_consent
                            ? <Badge tone="success" icon={Check}>Opted in</Badge>
                            : <span className="ot-faint">—</span>}
                        </td>
                      )}
                      {isCol('device') && (
                        <td className="au-device-cell">
                          <DeviceBadge device={user.device} />
                        </td>
                      )}
                      {grouped ? (
                        <>
                          {orgCols.map(c => isCol(c.id) && (
                            <td key={c.id} className="ui-num">
                              <span className="au-cups au-cups--org">{user.orgBalances?.[c.orgId]?.balance || 0}</span>
                            </td>
                          ))}
                          {isCol('total') && <td className="ui-num"><span className="au-cups">{user.cupBalance}</span></td>}
                        </>
                      ) : (
                        (!isTikkie && <td className="ui-num"><span className="au-cups">{user.cupBalance}</span></td>)
                      )}
                      {isCol('lifetime') && <td className="ui-num ot-muted">{user.lifetimeCups || 0}</td>}
                      {isCol('joined') && <td className="ot-date">{formatDate(user.created_at)}</td>}
                      {isCol('active') && <td className="ot-date">{timeAgo(user.updated_at)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {selectedUser && (
          <SplitHandle
            className="au-resizer"
            onMouseDown={startSplitDrag}
            onDoubleClick={() => setReviewSplit(420)}
            label="Drag to resize the table and detail panel"
          />
        )}

        {selectedUser && (
          <UserDetailPanel
            user={selectedUser}
            onClose={() => setSelectedUser(null)}
            onAdjustBalance={handleAdjustBalance}
            onUpdateUser={handleUpdateUser}
            hideCups={isTikkie}
          />
        )}
      </div>

      <BulkDeleteBar
        count={sel.count}
        noun="users"
        onClear={sel.clear}
        onDelete={async () => {
          const selectedRows = filtered.filter(u => sel.isSelected(u.id));
          const ids = selectedRows.map(u => u.id);
          if (grouped) {
            // Per-group delete: erase the whole account across every store (all
            // sibling rows that share the person's identity) + the identity.
            const allRowIds = selectedRows.flatMap(u => (u.memberUserIds && u.memberUserIds.length) ? u.memberUserIds : [u.id]);
            await deleteGroupAccounts(allRowIds);
          } else {
            await deleteRecords('users', ids);
          }
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
        grouped={grouped}
        users={users.filter(u => sel.isSelected(u.id))}
        onClose={() => setMergeOpen(false)}
        onMerged={() => {
          // Close, clear selection + the right pane (a merged account may have
          // vanished), then reload so balances/profile reflect the merge.
          setMergeOpen(false);
          setSelectedUser(null);
          sel.clear();
          reload();
        }}
      />

      <MergeRequestsSection focusSection={focusSection} onSectionConsumed={onSectionConsumed} />
    </div>
  );
}

/* ── Account-merge requests ──────────────────────────────────────────────
 * Per-org weekly merge limit + the review queue. Customers over the limit
 * land in 'pending'; admins approve (runs the merge) or reject. The log tab
 * shows every merge event (self-serve, approved, rejected, admin-initiated). */
const MERGE_TABS = [
  { key: 'pending',   label: 'Pending' },
  { key: 'approved',  label: 'Approved' },
  { key: 'rejected',  label: 'Rejected' },
  { key: 'completed', label: 'Self-serve' },
  { key: 'admin',     label: 'Admin' },
  { key: 'all',       label: 'All' },
];
const MERGE_STATUS_TONE = {
  pending: 'warning', approved: 'success', rejected: 'danger', completed: 'success', admin: 'success',
};

function MergeRequestsSection({ focusSection, onSectionConsumed }) {
  const { activeOrgId } = useOrg();
  const [tab, setTab] = useState('pending');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);
  // Row-click review modal.
  const [activeReq, setActiveReq] = useState(null);

  // Settings
  const [limit, setLimit] = useState(MERGE_LIMIT_DEFAULT);
  const [limitInput, setLimitInput] = useState(String(MERGE_LIMIT_DEFAULT.weeklyLimit));
  const [copyInput, setCopyInput] = useState(MERGE_LIMIT_DEFAULT.limitCopy);
  const [savingCfg, setSavingCfg] = useState(false);
  const [cfgMsg, setCfgMsg] = useState(null);

  useEffect(() => {
    let alive = true;
    getMergeLimit(activeOrgId).then((c) => {
      if (!alive) return;
      setLimit(c); setLimitInput(String(c.weeklyLimit)); setCopyInput(c.limitCopy);
    }).catch(() => {});
    return () => { alive = false; };
  }, [activeOrgId]);

  const load = useMemo(() => async () => {
    setLoading(true); setError(null);
    try { setRows(await getMergeRequests(tab)); }
    catch (e) { setError(e.message || 'Could not load merge requests.'); }
    finally { setLoading(false); }
  }, [tab, activeOrgId]);
  useEffect(() => { load(); }, [load]);

  async function saveCfg() {
    setSavingCfg(true); setCfgMsg(null);
    try {
      const saved = await saveMergeLimit(activeOrgId, { weeklyLimit: limitInput, limitCopy: copyInput });
      setLimit(saved); setLimitInput(String(saved.weeklyLimit)); setCopyInput(saved.limitCopy);
      setCfgMsg('Saved'); setTimeout(() => setCfgMsg(null), 2200);
    } catch (e) { setCfgMsg(e.message || 'Could not save.'); }
    finally { setSavingCfg(false); }
  }

  async function decide(id, action) {
    setBusyId(id); setError(null); setNotice(null);
    try {
      if (action === 'approve') { await approveMergeRequest(id); setNotice('Approved — the accounts were merged.'); }
      else { await rejectMergeRequest(id); setNotice('Request rejected. No accounts were merged.'); }
      setActiveReq(null);
      await load();
      setTimeout(() => setNotice(null), 4000);
    } catch (e) { setError(e.message || 'Action failed.'); }
    finally { setBusyId(null); }
  }

  // Deep-link from the merge-request notification email (#users?section=merge):
  // scroll to this section once its rows have rendered, then mark it consumed.
  useEffect(() => {
    if (focusSection !== 'merge' || loading) return;
    const el = document.getElementById('s-merge-requests');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    onSectionConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSection, loading]);

  const cfgDirty = !(limitInput === String(limit.weeklyLimit) && copyInput === limit.limitCopy);

  return (
    <Card as="section" className="mergereq" id="s-merge-requests" style={{ scrollMarginTop: '84px' }}>
      <CardHeader
        title="Account merge requests"
        icon={GitMerge}
        subtitle="Customers who lost their cups can merge accounts. Over the weekly limit, requests land here for review."
        ruled
      />

      <CardBody className="mergereq__body">
        {/* Per-org limit + copy */}
        <div className="mergereq__settings">
          <div className="mergereq__setting">
            <label className="ui-field__label" htmlFor="merge-limit">Merges per customer, per week</label>
            <input id="merge-limit" className="ui-input mergereq__num" type="number" min="0" max="20" value={limitInput}
              onChange={(e) => setLimitInput(e.target.value)} disabled={!activeOrgId || savingCfg} />
            <span className="ui-field__hint">Above this, requests wait for review.</span>
          </div>
          <div className="mergereq__setting mergereq__setting--wide">
            <label className="ui-field__label" htmlFor="merge-copy">“Limit reached” message shown to the customer</label>
            <textarea id="merge-copy" className="ui-textarea mergereq__copy" rows={2} value={copyInput}
              onChange={(e) => setCopyInput(e.target.value)} disabled={!activeOrgId || savingCfg}
              placeholder={MERGE_LIMIT_DEFAULT.limitCopy} />
          </div>
          <div className="mergereq__settings-foot">
            <Button variant="primary" size="sm" onClick={saveCfg}
              disabled={!activeOrgId || savingCfg || !cfgDirty}>
              {savingCfg ? 'Saving…' : 'Save limit'}
            </Button>
            {cfgMsg && <span className={`mergereq__cfg-msg${cfgMsg === 'Saved' ? '' : ' mergereq__cfg-msg--error'}`} role="status">{cfgMsg}</span>}
          </div>
        </div>

        <div className="mergereq__tabs">
          <Segmented
            ariaLabel="Filter merge requests"
            value={tab}
            onChange={setTab}
            options={MERGE_TABS.map(t => ({ id: t.key, label: t.label }))}
          />
        </div>

        {error && <Notice tone="danger">{error}</Notice>}
        {notice && <Notice tone="success">{notice}</Notice>}
      </CardBody>

      {loading ? (
        <p className="mergereq__empty">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState icon={GitMerge} title={tab === 'pending' ? 'No merge requests waiting for review' : 'Nothing here'}>
          {tab === 'pending' ? 'Requests over the weekly limit will show up here.' : null}
        </EmptyState>
      ) : (
        <div className="mergereq__table-wrap">
          <table className="ui-table mergereq__table">
            <thead>
              <tr>
                <th>Customer</th><th>Accounts</th><th>Source</th><th>Reason</th><th>When</th><th>Status</th><th>Decided by</th><th className="mergereq__th-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="ot-row" onClick={() => setActiveReq(r)} title="Open review">
                  <td>
                    <div className="ot-person">
                      <Avatar name={r.survivorName || 'Anonymous'} seed={r.survivorEmail || r.id} size={28} />
                      <div className="ot-person__text">
                        <span className="ot-person__name">{r.survivorName || 'Anonymous'}</span>
                        {r.survivorEmail && <span className="ot-person__sub">{r.survivorEmail}</span>}
                      </div>
                    </div>
                  </td>
                  <td className="ot-num">{r.absorbedCount + 1} → 1</td>
                  <td className="ot-muted">{r.source === 'restore' ? 'Lost cups' : r.source === 'admin' ? 'Admin' : 'Merge offer'}</td>
                  <td className="ot-muted mergereq__reason">{r.reason || '—'}</td>
                  <td className="ot-date">{formatDate(r.requested_at)}</td>
                  <td>
                    <Badge tone={MERGE_STATUS_TONE[r.status] || 'warning'}>
                      <span className="mergereq__status">{r.status}</span>
                    </Badge>
                    {r.decided_at && r.status !== 'pending' && <div className="mergereq__sub">{formatDate(r.decided_at)}</div>}
                  </td>
                  <td>
                    {r.decider ? (
                      <span className="mergereq__decider" title={r.decider.email}>
                        <span className="mergereq__decider-avatar" style={{ background: r.decider.color || 'var(--ui-primary)' }}>
                          {r.decider.avatar_url
                            ? <img src={r.decider.avatar_url} alt="" />
                            : (r.decider.display_name || r.decider.email || '?')[0].toUpperCase()}
                        </span>
                        {r.decider.display_name || (r.decider.email || '').split('@')[0]}
                      </span>
                    ) : <span className="ot-faint">—</span>}
                  </td>
                  <td className="mergereq__actions-cell" onClick={(e) => e.stopPropagation()}>
                    {r.status === 'pending' ? (
                      <div className="mergereq__actions">
                        <Button variant="danger-ghost" size="sm" className="mergereq__reject" disabled={busyId === r.id} onClick={() => decide(r.id, 'reject')}>Reject</Button>
                        <Button variant="primary" size="sm" disabled={busyId === r.id} onClick={() => decide(r.id, 'approve')}>
                          {busyId === r.id ? '…' : 'Approve'}
                        </Button>
                      </div>
                    ) : (
                      <span className="ot-muted">
                        {r.merged_balance != null ? `${r.merged_balance} cups merged` : '—'}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeReq && (
        <MergeRequestModal
          req={activeReq}
          busy={busyId === activeReq.id}
          onClose={() => setActiveReq(null)}
          onDecide={(action) => decide(activeReq.id, action)}
        />
      )}
    </Card>
  );
}
