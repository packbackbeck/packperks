import { useState, useEffect, useMemo } from 'react';
import { getAdminCupScans, updateScanStatus } from '../lib/adminApi';
import './AdminCupScans.css';

function formatDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatDateShort(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

const STATUS_OPTIONS = ['all', 'pending', 'approved', 'rejected'];

function SortIcon({ active, dir }) {
  return (
    <span className={`cs-sort-icon${active ? ' cs-sort-icon--active' : ''}`}>
      {active ? (dir === 'asc' ? '↑' : '↓') : '↕'}
    </span>
  );
}

function PhotoThumb({ url }) {
  if (!url) return (
    <div className="cs-thumb cs-thumb--empty">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#C8C4BC" strokeWidth="1.5">
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
        <circle cx="12" cy="13" r="4"/>
      </svg>
    </div>
  );
  return <div className="cs-thumb"><img src={url} alt="Cup photo" /></div>;
}

function DetailPanel({ scan, onApprove, onReject, updating }) {
  const [note, setNote] = useState('');
  const [lightbox, setLightbox] = useState(false);

  if (!scan) {
    return (
      <div className="cs-detail cs-detail--empty">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#C8C4BC" strokeWidth="1.5">
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
          <circle cx="12" cy="13" r="4"/>
        </svg>
        <p>Select a scan to review</p>
      </div>
    );
  }

  const canAct = scan.status === 'pending';

  return (
    <div className="cs-detail">
      <div className="cs-detail__header">
        <div>
          <div className="cs-detail__title">Scan Review</div>
          <div className="cs-detail__id">{scan.id?.slice(0, 8)}…</div>
        </div>
        <span className={`cs-status cs-status--${scan.status}`}>{scan.status}</span>
      </div>

      <div className="cs-detail__photo-wrap">
        {scan.photo_url ? (
          <>
            <img
              src={scan.photo_url}
              alt="Submitted cup photo"
              className="cs-detail__photo"
              onClick={() => setLightbox(true)}
              title="Click to enlarge"
            />
            <div className="cs-detail__photo-hint">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>
              </svg>
              Click to enlarge
            </div>
          </>
        ) : (
          <div className="cs-detail__photo-empty">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#C8C4BC" strokeWidth="1.5">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
            <span>No photo submitted</span>
            <span className="cs-detail__photo-sub">User scanned without camera access</span>
          </div>
        )}
      </div>

      <div className="cs-detail__rows">
        <div className="cs-detail__row">
          <span className="cs-detail__row-label">User</span>
          <span className="cs-detail__row-val">{scan.user?.display_name || 'Unknown'}</span>
        </div>
        {scan.user?.email && (
          <div className="cs-detail__row">
            <span className="cs-detail__row-label">Email</span>
            <span className="cs-detail__row-val cs-detail__row-val--muted">{scan.user.email}</span>
          </div>
        )}
        <div className="cs-detail__row">
          <span className="cs-detail__row-label">Cups awarded</span>
          <span className="cs-detail__row-val cs-detail__row-val--bold">{scan.cups_awarded ?? 1}</span>
        </div>
        <div className="cs-detail__row">
          <span className="cs-detail__row-label">Submitted</span>
          <span className="cs-detail__row-val cs-detail__row-val--muted">{formatDate(scan.created_at)}</span>
        </div>
        <div className="cs-detail__row">
          <span className="cs-detail__row-label">Scan ID</span>
          <span className="cs-detail__row-val cs-detail__row-val--mono">{scan.id}</span>
        </div>
        {scan.rejection_note && (
          <div className="cs-detail__row cs-detail__row--note">
            <span className="cs-detail__row-label">Rejection note</span>
            <span className="cs-detail__row-val cs-detail__row-val--note">{scan.rejection_note}</span>
          </div>
        )}
      </div>

      {canAct && (
        <div className="cs-detail__actions">
          <label className="cs-detail__note-label">Rejection note (optional)</label>
          <textarea
            className="cs-detail__note"
            placeholder="e.g. Blurry photo, wrong item, cup not visible…"
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={2}
          />
          <div className="cs-detail__btns">
            <button className="cs-detail__btn cs-detail__btn--approve" disabled={updating} onClick={() => onApprove(scan.id)}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
              Approve
            </button>
            <button className="cs-detail__btn cs-detail__btn--reject" disabled={updating} onClick={() => onReject(scan.id, note)}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              Reject
            </button>
          </div>
        </div>
      )}

      {lightbox && scan.photo_url && (
        <div className="cs-lightbox" onClick={() => setLightbox(false)}>
          <button className="cs-lightbox__close" onClick={e => { e.stopPropagation(); setLightbox(false); }}>×</button>
          <img src={scan.photo_url} alt="Cup photo enlarged" className="cs-lightbox__img" onClick={e => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}

export default function AdminCupScans() {
  const [scans, setScans]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [statusFilter, setStatus] = useState('all');
  const [search, setSearch]       = useState('');
  const [sortKey, setSortKey]     = useState('created_at');
  const [sortDir, setSortDir]     = useState('desc');
  const [selectedId, setSelectedId] = useState(null);
  const [selected, setSelected]   = useState(new Set());
  const [updating, setUpdating]   = useState(false);
  const [error, setError]         = useState(null);

  useEffect(() => {
    getAdminCupScans()
      .then(data => { setScans(data); if (data[0]) setSelectedId(data[0].id); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  function handleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  }

  async function handleApprove(scanId) {
    setUpdating(true); setError(null);
    try {
      await updateScanStatus(scanId, 'approved');
      setScans(prev => prev.map(s => s.id === scanId ? { ...s, status: 'approved' } : s));
    } catch (e) { setError(e.message || 'Update failed'); }
    finally { setUpdating(false); }
  }

  async function handleReject(scanId, note) {
    setUpdating(true); setError(null);
    try {
      await updateScanStatus(scanId, 'rejected');
      setScans(prev => prev.map(s => s.id === scanId ? { ...s, status: 'rejected', rejection_note: note } : s));
    } catch (e) { setError(e.message || 'Update failed'); }
    finally { setUpdating(false); }
  }

  async function handleBulkApprove() {
    const ids = [...selected].filter(id => scans.find(s => s.id === id)?.status === 'pending');
    if (!ids.length) return;
    setUpdating(true); setError(null);
    try {
      await Promise.all(ids.map(id => updateScanStatus(id, 'approved')));
      setScans(prev => prev.map(s => ids.includes(s.id) ? { ...s, status: 'approved' } : s));
      setSelected(new Set());
    } catch (e) { setError(e.message || 'Bulk update failed'); }
    finally { setUpdating(false); }
  }

  async function handleBulkReject() {
    const ids = [...selected].filter(id => scans.find(s => s.id === id)?.status === 'pending');
    if (!ids.length) return;
    setUpdating(true); setError(null);
    try {
      await Promise.all(ids.map(id => updateScanStatus(id, 'rejected')));
      setScans(prev => prev.map(s => ids.includes(s.id) ? { ...s, status: 'rejected' } : s));
      setSelected(new Set());
    } catch (e) { setError(e.message || 'Bulk update failed'); }
    finally { setUpdating(false); }
  }

  function toggleSelect(id) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  const filtered = useMemo(() => {
    let list = scans;
    if (statusFilter !== 'all') list = list.filter(s => s.status === statusFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(s =>
        s.user?.display_name?.toLowerCase().includes(q) ||
        s.user?.email?.toLowerCase().includes(q) ||
        s.id?.toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => {
      let av = a[sortKey], bv = b[sortKey];
      if (sortKey === 'created_at') { av = new Date(av).getTime(); bv = new Date(bv).getTime(); }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [scans, statusFilter, search, sortKey, sortDir]);

  const counts = {
    pending:  scans.filter(s => s.status === 'pending').length,
    approved: scans.filter(s => s.status === 'approved').length,
    rejected: scans.filter(s => s.status === 'rejected').length,
  };
  const totalCups = scans.filter(s => s.status === 'approved').reduce((sum, s) => sum + (s.cups_awarded || 1), 0);
  const withPhoto = scans.filter(s => s.photo_url).length;

  const selectedScan = scans.find(s => s.id === selectedId) || null;
  const filteredIds = filtered.map(s => s.id);
  const allSelected = filteredIds.length > 0 && filteredIds.every(id => selected.has(id));
  const selectedPending = [...selected].filter(id => scans.find(s => s.id === id)?.status === 'pending');

  function ThCol({ label, field, sortable }) {
    return (
      <th className={sortable ? 'cs-th--sortable' : ''} onClick={sortable ? () => handleSort(field) : undefined}>
        {label}{sortable && <SortIcon active={sortKey === field} dir={sortDir} />}
      </th>
    );
  }

  return (
    <div className="admin-cupscans">
      <div className="cs-header">
        <div>
          <h1 className="cs-header__title">Cup Scans</h1>
          <p className="cs-header__sub">
            <span className="cs-chip cs-chip--pending">{counts.pending} Pending</span>
            <span className="cs-chip cs-chip--approved">{counts.approved} Approved</span>
            <span className="cs-chip cs-chip--rejected">{counts.rejected} Rejected</span>
            <span className="cs-chip cs-chip--neutral">{totalCups} cups awarded</span>
            <span className="cs-chip cs-chip--neutral">{withPhoto}/{scans.length} with photo</span>
          </p>
        </div>
      </div>

      {error && (
        <div className="cs-error-bar">
          <span>{error}</span>
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}

      <div className="cs-toolbar">
        <div className="cs-filter-group">
          {STATUS_OPTIONS.map(s => (
            <button key={s}
              className={`cs-filter-btn${statusFilter === s ? ' cs-filter-btn--active' : ''}`}
              onClick={() => setStatus(s)}>
              {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <div className="cs-search-wrap">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9E9A93" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input className="cs-search" placeholder="Search user, email, ID…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      {selected.size > 0 && (
        <div className="cs-bulk-bar">
          <span className="cs-bulk-bar__count">{selected.size} selected</span>
          {selectedPending.length > 0 && (
            <>
              <button className="cs-bulk-btn cs-bulk-btn--approve" disabled={updating} onClick={handleBulkApprove}>
                ✓ Approve {selectedPending.length}
              </button>
              <button className="cs-bulk-btn cs-bulk-btn--reject" disabled={updating} onClick={handleBulkReject}>
                ✕ Reject {selectedPending.length}
              </button>
            </>
          )}
          <button className="cs-bulk-btn cs-bulk-btn--clear" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      <div className="cs-layout">
        <div className="cs-table-wrap">
          {loading ? (
            <div className="cs-loading">Loading scans…</div>
          ) : (
            <table className="cs-table">
              <thead>
                <tr>
                  <th style={{ width: 36, padding: '10px 8px 10px 14px' }}>
                    <input type="checkbox" className="cs-checkbox" checked={allSelected}
                      onChange={() => {
                        if (allSelected) setSelected(prev => { const n = new Set(prev); filteredIds.forEach(id => n.delete(id)); return n; });
                        else setSelected(prev => { const n = new Set(prev); filteredIds.forEach(id => n.add(id)); return n; });
                      }} />
                  </th>
                  <th style={{ width: 60 }}>Photo</th>
                  <ThCol label="User" />
                  <ThCol label="Cups" field="cups_awarded" sortable />
                  <ThCol label="Status" field="status" sortable />
                  <ThCol label="Submitted" field="created_at" sortable />
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={6} className="cs-table__empty">No scans found</td></tr>
                ) : filtered.map(scan => (
                  <tr key={scan.id}
                    className={`cs-table__row${selectedId === scan.id ? ' cs-table__row--active' : ''}${selected.has(scan.id) ? ' cs-table__row--checked' : ''}`}
                    onClick={() => setSelectedId(scan.id)}
                  >
                    <td style={{ padding: '0 8px 0 14px' }} onClick={e => e.stopPropagation()}>
                      <input type="checkbox" className="cs-checkbox" checked={selected.has(scan.id)} onChange={() => toggleSelect(scan.id)} />
                    </td>
                    <td style={{ padding: '6px 8px' }} onClick={e => e.stopPropagation()}>
                      <PhotoThumb url={scan.photo_url} />
                    </td>
                    <td>
                      <div className="cs-user-cell">
                        <div className="cs-user-avatar">{(scan.user?.display_name || '?')[0].toUpperCase()}</div>
                        <div className="cs-user-info">
                          <span className="cs-user-name">{scan.user?.display_name || 'Unknown'}</span>
                          {scan.user?.email && <span className="cs-user-email">{scan.user.email}</span>}
                        </div>
                      </div>
                    </td>
                    <td className="cs-center cs-bold">{scan.cups_awarded ?? 1}</td>
                    <td><span className={`cs-status cs-status--${scan.status}`}>{scan.status}</span></td>
                    <td className="cs-muted cs-date">{formatDateShort(scan.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <DetailPanel
          scan={selectedScan}
          onApprove={handleApprove}
          onReject={handleReject}
          updating={updating}
        />
      </div>
    </div>
  );
}
