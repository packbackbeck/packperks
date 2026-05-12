import { useState, useEffect, useMemo } from 'react';
import { getAdminClaims, updateClaimStatus } from '../lib/adminApi';
import './AdminClaims.css';

function formatDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    + ' ' + new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

const STATUS_OPTIONS = ['all', 'pending', 'completed', 'failed'];
const SORT_KEYS = ['created_at', 'cups_redeemed', 'payout_amount', 'status'];

function SortIcon({ active, dir }) {
  return (
    <span className={`ac-sort-icon${active ? ' ac-sort-icon--active' : ''}`}>
      {active ? (dir === 'asc' ? '↑' : '↓') : '↕'}
    </span>
  );
}

function ReceiptChip({ type }) {
  if (type === 'direct_refund') {
    return <span className="ac-receipt-chip ac-receipt-chip--na">N/A</span>;
  }
  return <span className="ac-receipt-chip ac-receipt-chip--valid">✓ Valid</span>;
}

export default function AdminClaims({ onNavigate, draftState }) {
  const rewards = draftState?.draft?.rewards || [];

  const [claims, setClaims]         = useState([]);
  const [loading, setLoading]       = useState(true);
  const [statusFilter, setStatus]   = useState('all');
  const [search, setSearch]         = useState('');
  const [sortKey, setSortKey]       = useState('created_at');
  const [sortDir, setSortDir]       = useState('desc');
  const [selected, setSelected]     = useState(new Set());
  const [updating, setUpdating]     = useState(null);
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [actionError, setActionError] = useState(null);

  useEffect(() => {
    getAdminClaims().then(setClaims).catch(console.error).finally(() => setLoading(false));
  }, []);

  function handleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  }

  async function handleStatusUpdate(claimId, newStatus) {
    setUpdating(claimId);
    setActionError(null);
    try {
      await updateClaimStatus(claimId, newStatus);
      setClaims(prev => prev.map(c => c.id === claimId ? { ...c, status: newStatus } : c));
    } catch (err) {
      console.error('Claim update failed:', err);
      const msg = err?.message || '';
      setActionError(
        msg.includes('claims_status_check')
          ? 'DB constraint error: run the SQL below in Supabase to fix it.'
          : msg || 'Update failed — check RLS policies or run fix SQL from the Publish error bar.'
      );
    } finally {
      setUpdating(null);
    }
  }

  async function handleBulkAction(newStatus) {
    setBulkUpdating(true);
    setActionError(null);
    const ids = [...selected].filter(id => {
      const claim = claims.find(c => c.id === id);
      return claim?.status === 'pending';
    });
    try {
      await Promise.all(ids.map(id => updateClaimStatus(id, newStatus)));
      setClaims(prev => prev.map(c => ids.includes(c.id) ? { ...c, status: newStatus } : c));
      setSelected(new Set());
    } catch (err) {
      console.error('Bulk claim update failed:', err);
      const msg = err?.message || '';
      setActionError(
        msg.includes('claims_status_check')
          ? 'DB constraint error: run the SQL below in Supabase to fix it.'
          : msg || 'Update failed — run fix SQL from the Publish error bar.'
      );
    } finally {
      setBulkUpdating(false);
    }
  }

  function toggleSelect(id) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleSelectAll(ids) {
    if (ids.every(id => selected.has(id))) {
      setSelected(prev => { const n = new Set(prev); ids.forEach(id => n.delete(id)); return n; });
    } else {
      setSelected(prev => { const n = new Set(prev); ids.forEach(id => n.add(id)); return n; });
    }
  }

  const filtered = useMemo(() => {
    let list = claims;
    if (statusFilter !== 'all') list = list.filter(c => c.status === statusFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(c =>
        c.user?.display_name?.toLowerCase().includes(q) ||
        c.user?.email?.toLowerCase().includes(q) ||
        c.id?.toLowerCase().includes(q) ||
        c.iban?.toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => {
      let av = a[sortKey], bv = b[sortKey];
      if (sortKey === 'created_at') { av = new Date(av).getTime(); bv = new Date(bv).getTime(); }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [claims, statusFilter, search, sortKey, sortDir]);

  const counts = {
    pending:   claims.filter(c => c.status === 'pending').length,
    completed: claims.filter(c => c.status === 'completed').length,
    failed:    claims.filter(c => c.status === 'failed').length,
  };

  const filteredIds = filtered.map(c => c.id);
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every(id => selected.has(id));
  const selectedPending = [...selected].filter(id => claims.find(c => c.id === id)?.status === 'pending');

  function getRewardName(claim) {
    if (claim.type === 'direct_refund') return null;
    if (!claim.reward_id) return 'Unknown reward';
    const r = rewards.find(r => r.id === claim.reward_id);
    return r?.name || claim.reward_id;
  }

  function ThCol({ label, sortable, field, style }) {
    return (
      <th style={style}
        className={sortable ? 'ac-th--sortable' : ''}
        onClick={sortable ? () => handleSort(field) : undefined}
      >
        {label}
        {sortable && <SortIcon active={sortKey === field} dir={sortDir} />}
      </th>
    );
  }

  return (
    <div className="admin-claims">
      <div className="ac-header">
        <div>
          <h1 className="ac-header__title">Claims</h1>
          <p className="ac-header__sub">
            <span className="ac-chip ac-chip--pending">{counts.pending} Pending</span>
            <span className="ac-chip ac-chip--completed">{counts.completed} Completed</span>
            <span className="ac-chip ac-chip--failed">{counts.failed} Failed</span>
          </p>
        </div>
      </div>

      {actionError && (
        <div className="ac-error-bar">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span>{actionError}</span>
          {actionError.includes('constraint') && (
            <button
              style={{ marginLeft: 8, background: 'rgba(220,38,38,0.12)', border: 'none', color: '#DC2626', borderRadius: 5, padding: '2px 8px', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
              onClick={() => navigator.clipboard?.writeText("ALTER TABLE claims DROP CONSTRAINT IF EXISTS claims_status_check;\nALTER TABLE claims ADD CONSTRAINT claims_status_check\n  CHECK (status IN ('pending', 'completed', 'failed'));")}
            >
              📋 Copy SQL
            </button>
          )}
          <button onClick={() => setActionError(null)}>×</button>
        </div>
      )}

      <div className="ac-toolbar">
        <div className="ac-filter-group">
          {STATUS_OPTIONS.map(s => (
            <button key={s} className={`ac-filter-btn${statusFilter === s ? ' ac-filter-btn--active' : ''}`}
              onClick={() => setStatus(s)}>
              {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <div className="ac-search-wrap">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9E9A93" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            className="ac-search-input"
            placeholder="Search user, email, IBAN…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Bulk actions bar */}
      {selected.size > 0 && (
        <div className="ac-bulk-bar">
          <span className="ac-bulk-bar__count">{selected.size} selected</span>
          {selectedPending.length > 0 && (
            <>
              <button className="ac-bulk-btn ac-bulk-btn--complete"
                disabled={bulkUpdating}
                onClick={() => handleBulkAction('completed')}>
                ✓ Approve {selectedPending.length}
              </button>
              <button className="ac-bulk-btn ac-bulk-btn--fail"
                disabled={bulkUpdating}
                onClick={() => handleBulkAction('failed')}>
                ✕ Fail {selectedPending.length}
              </button>
            </>
          )}
          <button className="ac-bulk-btn ac-bulk-btn--clear" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}

      <div className="ac-layout">
        <div className="ac-table-wrap">
          {loading ? (
            <div className="ac-loading">Loading claims…</div>
          ) : (
            <table className="ac-table">
              <thead>
                <tr>
                  <th style={{ width: 40, padding: '10px 8px 10px 16px' }}>
                    <input type="checkbox"
                      className="ac-checkbox"
                      checked={allFilteredSelected}
                      onChange={() => toggleSelectAll(filteredIds)}
                    />
                  </th>
                  <ThCol label="User" />
                  <ThCol label="ID" />
                  <ThCol label="Receipt" />
                  <ThCol label="Reward / Type" />
                  <ThCol label="Cups" sortable field="cups_redeemed" />
                  <ThCol label="Amount" sortable field="payout_amount" />
                  <ThCol label="IBAN" />
                  <ThCol label="Date" sortable field="created_at" />
                  <ThCol label="Status" sortable field="status" />
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={11} className="ac-table__empty">No claims found</td></tr>
                ) : filtered.map(claim => {
                  const rewardName = getRewardName(claim);
                  const rewardObj  = rewards.find(r => r.id === claim.reward_id);
                  return (
                    <tr key={claim.id}
                      className={`ac-table__row${selected.has(claim.id) ? ' ac-table__row--selected' : ''}`}
                    >
                      <td style={{ padding: '0 8px 0 16px' }} onClick={e => e.stopPropagation()}>
                        <input type="checkbox"
                          className="ac-checkbox"
                          checked={selected.has(claim.id)}
                          onChange={() => toggleSelect(claim.id)}
                        />
                      </td>
                      <td>
                        <div className="ac-user-cell">
                          <div className="ac-user-avatar">
                            {(claim.user?.display_name || '?')[0].toUpperCase()}
                          </div>
                          <div className="ac-user-info">
                            <span className="ac-user-name">{claim.user?.display_name || 'Unknown'}</span>
                            <span className="ac-user-email">{claim.user?.email || '—'}</span>
                          </div>
                        </div>
                      </td>
                      <td className="ac-mono ac-muted">{claim.id?.slice(0, 8)}…</td>
                      <td><ReceiptChip type={claim.type} /></td>
                      <td>
                        {claim.type === 'direct_refund' ? (
                          <span className="ac-type-badge ac-type-badge--direct_refund">Direct Refund</span>
                        ) : rewardObj ? (
                          <button
                            className="ac-reward-link"
                            onClick={e => { e.stopPropagation(); onNavigate?.('rewards'); }}
                            title="Go to reward"
                          >
                            {rewardName}
                          </button>
                        ) : (
                          <span className="ac-muted">{rewardName}</span>
                        )}
                      </td>
                      <td className="ac-center ac-bold">{claim.cups_redeemed ?? '—'}</td>
                      <td className="ac-bold">€{(claim.payout_amount || 0).toFixed(2)}</td>
                      <td className="ac-mono ac-iban">{claim.iban || '—'}</td>
                      <td className="ac-muted ac-date">{formatDate(claim.created_at)}</td>
                      <td>
                        <span className={`ac-status ac-status--${claim.status}`}>{claim.status}</span>
                      </td>
                      <td>
                        {claim.status === 'pending' && (
                          <div className="ac-actions" onClick={e => e.stopPropagation()}>
                            <button
                              className="ac-action-btn ac-action-btn--complete"
                              disabled={updating === claim.id}
                              onClick={() => handleStatusUpdate(claim.id, 'completed')}
                              title="Approve"
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                <polyline points="20 6 9 17 4 12"/>
                              </svg>
                            </button>
                            <button
                              className="ac-action-btn ac-action-btn--fail"
                              disabled={updating === claim.id}
                              onClick={() => handleStatusUpdate(claim.id, 'failed')}
                              title="Fail"
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                              </svg>
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
