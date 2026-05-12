import { useState, useEffect, useMemo } from 'react';
import { getAdminReceiptChecks, updateClaimStatus } from '../lib/adminApi';
import './AdminReceiptCheck.css';

function formatDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatDateShort(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

const STATUS_OPTIONS = ['all', 'pending', 'completed', 'failed'];

function SortIcon({ active, dir }) {
  return (
    <span className={`rc-sort-icon${active ? ' rc-sort-icon--active' : ''}`}>
      {active ? (dir === 'asc' ? '↑' : '↓') : '↕'}
    </span>
  );
}

function ReceiptThumb({ url }) {
  if (!url) return (
    <div className="rc-thumb rc-thumb--empty">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#C8C4BC" strokeWidth="1.5">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
      </svg>
    </div>
  );
  return <div className="rc-thumb"><img src={url} alt="Receipt" /></div>;
}

function DetailPanel({ claim, onApprove, onFail, updating, onNavigateClaims }) {
  const [lightbox, setLightbox] = useState(false);

  if (!claim) {
    return (
      <div className="rc-detail rc-detail--empty">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#C8C4BC" strokeWidth="1.5">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
        </svg>
        <p>Select a receipt to review</p>
      </div>
    );
  }

  const canAct = claim.status === 'pending';
  const ibanDisplay = claim.iban
    ? claim.iban.replace(/\s/g,'').replace(/(.{4})/g,'$1 ').trim().slice(0,-8) + '•••• ••••'
    : '—';

  return (
    <div className="rc-detail">
      <div className="rc-detail__header">
        <div>
          <div className="rc-detail__title">Receipt Review</div>
          <div className="rc-detail__id">{claim.id?.slice(0,8)}…</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className={`rc-status rc-status--${claim.status}`}>{claim.status}</span>
          <button className="rc-detail__claims-link" onClick={() => onNavigateClaims?.(claim.id)} title="View in Claims">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
              <polyline points="15 3 21 3 21 9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
            Claims
          </button>
        </div>
      </div>

      {/* Receipt photo */}
      <div className="rc-detail__photo-wrap">
        {claim.receipt_photo_url ? (
          <>
            <img
              src={claim.receipt_photo_url}
              alt="Receipt"
              className="rc-detail__photo"
              onClick={() => setLightbox(true)}
              title="Click to enlarge"
            />
            <div className="rc-detail__photo-hint">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>
              </svg>
              Click to enlarge
            </div>
          </>
        ) : (
          <div className="rc-detail__photo-empty">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#C8C4BC" strokeWidth="1.5">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
            <span>No receipt photo</span>
            <span className="rc-detail__photo-sub">Submitted before photo capture was enabled</span>
          </div>
        )}
      </div>

      {/* Claim details */}
      <div className="rc-detail__rows">
        <div className="rc-detail__section-label">Claimant</div>
        <div className="rc-detail__row">
          <span className="rc-detail__row-label">Name</span>
          <span className="rc-detail__row-val">{claim.user?.display_name || 'Unknown'}</span>
        </div>
        {claim.user?.email && (
          <div className="rc-detail__row">
            <span className="rc-detail__row-label">Email</span>
            <span className="rc-detail__row-val rc-detail__row-val--muted">{claim.user.email}</span>
          </div>
        )}
        <div className="rc-detail__row">
          <span className="rc-detail__row-label">IBAN</span>
          <span className="rc-detail__row-val rc-detail__row-val--mono">{ibanDisplay}</span>
        </div>

        <div className="rc-detail__section-label" style={{ marginTop: 10 }}>Claim</div>
        <div className="rc-detail__row">
          <span className="rc-detail__row-label">Type</span>
          <span className="rc-detail__row-val" style={{ textTransform: 'capitalize' }}>{claim.type?.replace('_', ' ')}</span>
        </div>
        <div className="rc-detail__row">
          <span className="rc-detail__row-label">Cups redeemed</span>
          <span className="rc-detail__row-val rc-detail__row-val--bold">{claim.cups_redeemed ?? '—'}</span>
        </div>
        <div className="rc-detail__row">
          <span className="rc-detail__row-label">Payout</span>
          <span className="rc-detail__row-val rc-detail__row-val--green">€{(claim.payout_amount || 0).toFixed(2)}</span>
        </div>
        <div className="rc-detail__row">
          <span className="rc-detail__row-label">Submitted</span>
          <span className="rc-detail__row-val rc-detail__row-val--muted">{formatDate(claim.created_at)}</span>
        </div>
        <div className="rc-detail__row">
          <span className="rc-detail__row-label">Claim ID</span>
          <span className="rc-detail__row-val rc-detail__row-val--mono">{claim.id}</span>
        </div>
      </div>

      {/* Actions */}
      {canAct && (
        <div className="rc-detail__actions">
          <p className="rc-detail__actions-hint">Verify the receipt matches the claim before approving.</p>
          <div className="rc-detail__btns">
            <button className="rc-detail__btn rc-detail__btn--approve" disabled={updating} onClick={() => onApprove(claim.id)}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
              Approve & Pay
            </button>
            <button className="rc-detail__btn rc-detail__btn--fail" disabled={updating} onClick={() => onFail(claim.id)}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              Reject
            </button>
          </div>
        </div>
      )}

      {lightbox && claim.receipt_photo_url && (
        <div className="rc-lightbox" onClick={() => setLightbox(false)}>
          <button className="rc-lightbox__close" onClick={e => { e.stopPropagation(); setLightbox(false); }}>×</button>
          <img src={claim.receipt_photo_url} alt="Receipt enlarged" className="rc-lightbox__img" onClick={e => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}

export default function AdminReceiptCheck({ onNavigate }) {
  const [claims, setClaims]       = useState([]);
  const [loading, setLoading]     = useState(true);
  const [statusFilter, setStatus] = useState('pending');
  const [search, setSearch]       = useState('');
  const [sortKey, setSortKey]     = useState('created_at');
  const [sortDir, setSortDir]     = useState('desc');
  const [selectedId, setSelectedId] = useState(null);
  const [updating, setUpdating]   = useState(false);
  const [error, setError]         = useState(null);

  useEffect(() => {
    getAdminReceiptChecks()
      .then(data => {
        setClaims(data);
        const first = data.find(c => c.status === 'pending') || data[0];
        if (first) setSelectedId(first.id);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  function handleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  }

  async function handleApprove(claimId) {
    setUpdating(true); setError(null);
    try {
      await updateClaimStatus(claimId, 'completed');
      setClaims(prev => prev.map(c => c.id === claimId ? { ...c, status: 'completed' } : c));
    } catch (e) {
      const msg = e?.message || '';
      setError(msg.includes('claims_status_check')
        ? 'DB constraint error — run the fix SQL from the Publish error bar.'
        : msg || 'Update failed.');
    } finally { setUpdating(false); }
  }

  async function handleFail(claimId) {
    setUpdating(true); setError(null);
    try {
      await updateClaimStatus(claimId, 'failed');
      setClaims(prev => prev.map(c => c.id === claimId ? { ...c, status: 'failed' } : c));
    } catch (e) {
      const msg = e?.message || '';
      setError(msg.includes('claims_status_check')
        ? 'DB constraint error — run the fix SQL from the Publish error bar.'
        : msg || 'Update failed.');
    } finally { setUpdating(false); }
  }

  const filtered = useMemo(() => {
    let list = claims;
    if (statusFilter !== 'all') list = list.filter(c => c.status === statusFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(c =>
        c.user?.display_name?.toLowerCase().includes(q) ||
        c.user?.email?.toLowerCase().includes(q) ||
        c.id?.toLowerCase().includes(q)
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
  const withPhoto = claims.filter(c => c.receipt_photo_url).length;
  const totalPayout = claims.filter(c => c.status === 'completed').reduce((s, c) => s + (c.payout_amount || 0), 0);

  const selectedClaim = claims.find(c => c.id === selectedId) || null;

  function ThCol({ label, field, sortable }) {
    return (
      <th className={sortable ? 'rc-th--sortable' : ''} onClick={sortable ? () => handleSort(field) : undefined}>
        {label}{sortable && <SortIcon active={sortKey === field} dir={sortDir} />}
      </th>
    );
  }

  return (
    <div className="admin-receipt-check">
      <div className="rc-header">
        <div>
          <h1 className="rc-header__title">Receipt Check</h1>
          <p className="rc-header__sub">
            <span className="rc-chip rc-chip--pending">{counts.pending} Pending</span>
            <span className="rc-chip rc-chip--completed">{counts.completed} Approved</span>
            <span className="rc-chip rc-chip--failed">{counts.failed} Rejected</span>
            <span className="rc-chip rc-chip--neutral">{withPhoto}/{claims.length} with photo</span>
            <span className="rc-chip rc-chip--neutral">€{totalPayout.toFixed(2)} paid out</span>
          </p>
        </div>
        <button className="rc-header__link" onClick={() => onNavigate?.('claims')}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
          </svg>
          View all Claims
        </button>
      </div>

      {error && (
        <div className="rc-error-bar">
          <span>{error}</span>
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}

      <div className="rc-toolbar">
        <div className="rc-filter-group">
          {STATUS_OPTIONS.map(s => (
            <button key={s}
              className={`rc-filter-btn${statusFilter === s ? ' rc-filter-btn--active' : ''}`}
              onClick={() => setStatus(s)}>
              {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <div className="rc-search-wrap">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9E9A93" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input className="rc-search" placeholder="Search user, email, ID…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="rc-layout">
        <div className="rc-table-wrap">
          {loading ? (
            <div className="rc-loading">Loading receipts…</div>
          ) : (
            <table className="rc-table">
              <thead>
                <tr>
                  <th style={{ width: 60 }}>Receipt</th>
                  <ThCol label="User" />
                  <ThCol label="Payout" field="payout_amount" sortable />
                  <ThCol label="Cups" field="cups_redeemed" sortable />
                  <ThCol label="Status" field="status" sortable />
                  <ThCol label="Submitted" field="created_at" sortable />
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={6} className="rc-table__empty">No receipts found</td></tr>
                ) : filtered.map(claim => (
                  <tr key={claim.id}
                    className={`rc-table__row${selectedId === claim.id ? ' rc-table__row--active' : ''}`}
                    onClick={() => setSelectedId(claim.id)}
                  >
                    <td style={{ padding: '6px 8px 6px 14px' }}>
                      <ReceiptThumb url={claim.receipt_photo_url} />
                    </td>
                    <td>
                      <div className="rc-user-cell">
                        <div className="rc-user-avatar">{(claim.user?.display_name || '?')[0].toUpperCase()}</div>
                        <div className="rc-user-info">
                          <span className="rc-user-name">{claim.user?.display_name || 'Unknown'}</span>
                          {claim.user?.email && <span className="rc-user-email">{claim.user.email}</span>}
                        </div>
                      </div>
                    </td>
                    <td className="rc-bold rc-green">€{(claim.payout_amount || 0).toFixed(2)}</td>
                    <td className="rc-center rc-bold">{claim.cups_redeemed ?? '—'}</td>
                    <td><span className={`rc-status rc-status--${claim.status}`}>{claim.status}</span></td>
                    <td className="rc-muted rc-date">{formatDateShort(claim.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <DetailPanel
          claim={selectedClaim}
          onApprove={handleApprove}
          onFail={handleFail}
          updating={updating}
          onNavigateClaims={() => onNavigate?.('claims')}
        />
      </div>
    </div>
  );
}
