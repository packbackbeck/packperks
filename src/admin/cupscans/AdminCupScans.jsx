import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { getAdminCupScans, getCupScanSignedUrl } from '../lib/adminApi';
import Spinner from '../lib/Spinner';
import EmptyState from '../shared/EmptyState';
import QuickLinks from '../shared/QuickLinks';
import ColumnPicker from '../shared/ColumnPicker';
import './AdminCupScans.css';

/* Toggleable columns for the Cup Scans table. User + When + Status
 * stay always-shown — they're the bare minimum to read a row. Photo
 * is toggleable per request (admins reviewing on a smaller screen,
 * or who don't want to see images at all, can hide it). */
const CS_COLUMN_CONFIG = [
  { id: 'photo',     label: 'Photo',     desc: 'Thumbnail of the scan / receipt image',                    defaultOn: true  },
  { id: 'source',    label: 'Source',    desc: 'QR / camera / gallery / deep-link',                        defaultOn: true  },
  { id: 'batch',     label: 'Batch',     desc: 'Cup batch the scan came from',                             defaultOn: true  },
  { id: 'submitted', label: 'Submitted', desc: 'How many cup IDs the QR carried',                          defaultOn: true  },
  { id: 'awarded',   label: 'Awarded',   desc: 'How many cups were actually credited to the user',         defaultOn: true  },
  { id: 'error',     label: 'Error',     desc: 'Failure code + message (when the scan didn\'t succeed)',   defaultOn: true  },
];
const CS_DEFAULT_VISIBLE_COLS = CS_COLUMN_CONFIG.filter(c => c.defaultOn).map(c => c.id);

/* AdminCupScans — every QR claim attempt, success or failure.
 *
 * The claim-cups edge function inserts one row per attempt into cup_scans
 * (source='qr') with: requested vs activated cup ids, status, error_code,
 * scan_type, and photo_path (snapshot in the private `cup-scans` bucket).
 *
 * The table is sortable on each column, filterable by status / scan_type,
 * and free-text searchable across user / batch / cup id / error code.
 * Clicking the user cell jumps to Users; the batch cell jumps to Cup QR. */

function formatDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    + ', ' + new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function SortIcon({ active, dir }) {
  return (
    <span className={`cs-sort-icon${active ? ' cs-sort-icon--active' : ''}`}>
      {active ? (dir === 'asc' ? '↑' : '↓') : '↕'}
    </span>
  );
}

/* Status filter set matches what the cup_scans table actually emits.
 * Previously this included `partial`/`rejected` which never appear in
 * real data — the table showed an "All / Pending / Success / Failed"
 * reality but the filter buttons hinted at states that didn't exist,
 * confusing admins trying to make sense of the column. */
const STATUS_OPTIONS = [
  { id: 'all',      label: 'All',         desc: 'Every scan event' },
  { id: 'pending',  label: 'Pending',     desc: 'Awaiting server resolution' },
  { id: 'success',  label: 'Success',     desc: 'Cups added to balance' },
  { id: 'approved', label: 'Approved',    desc: 'Legacy: photo scans cleared by admin' },
  { id: 'failed',   label: 'Failed',      desc: 'QR invalid or already claimed' },
];
const TYPE_OPTIONS   = ['all', 'camera', 'gallery', 'deeplink'];

/* Thumbnail with on-demand signed URL — re-uses the cup-scans bucket key.
 * Falls back to the legacy receipt_photo_url for older rows. */
function ScanThumb({ scan, onZoom }) {
  const [signed, setSigned] = useState(null);
  const [signError, setSignError] = useState(false);
  useEffect(() => {
    let cancel = false;
    setSigned(null);
    setSignError(false);
    if (scan?.photo_path) {
      getCupScanSignedUrl(scan.photo_path)
        .then(u => { if (!cancel) { if (u) setSigned(u); else setSignError(true); } })
        .catch(() => { if (!cancel) setSignError(true); });
    }
    return () => { cancel = true; };
  }, [scan?.id, scan?.photo_path]);

  // Three states:
  //   • src present  → render the photo thumbnail
  //   • photo_path set but the signed URL fetch failed (or 404) → render
  //     a broken-link icon so admins can see "the bucket lost this one"
  //     vs. a deeplink that legitimately never had a photo.
  //   • neither      → render a source-aware empty placeholder.
  const src = scan?.photo_url || signed;
  if (src) {
    return (
      <button
        className="cs-thumb"
        onClick={e => { e.stopPropagation(); onZoom?.(src); }}
        title="Click to enlarge. Photo may incidentally include the customer's hand or face — handle as personal data."
        type="button"
      >
        <img src={src} alt="Scan" />
        {/* Privacy indicator on the thumbnail itself (P-33). The cup
         *  scan camera occasionally captures hands/faces beyond the
         *  cup itself; the dot is a constant reminder this image is
         *  customer-facing data, not a generic asset. */}
        <span className="cs-thumb__privacy" aria-hidden title="May contain personal data">
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </span>
      </button>
    );
  }

  if (scan?.photo_path && signError) {
    return (
      <div className="cs-thumb cs-thumb--empty" title="Photo missing from storage">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="1.5">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
      </div>
    );
  }

  // No photo at all. Tag the placeholder by scan source so admins can
  // tell a deeplink (legitimately photoless) from a gallery upload that
  // failed silently before the new upload-hardening landed.
  const sourceLabel = scan?.scan_type === 'deeplink'
    ? 'Deeplink scan (no photo)'
    : scan?.scan_type === 'gallery'
      ? 'Gallery upload — photo missing'
      : 'No photo';
  return (
    <div className="cs-thumb cs-thumb--empty" title={sourceLabel}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#C8C4BC" strokeWidth="1.5">
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
        <circle cx="12" cy="13" r="4"/>
      </svg>
    </div>
  );
}

function Lightbox({ src, onClose }) {
  useEffect(() => {
    function k(e) { if (e.key === 'Escape') onClose?.(); }
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);
  if (!src) return null;
  return createPortal(
    <div className="cs-lightbox" onClick={onClose}>
      <button className="cs-lightbox__close" onClick={e => { e.stopPropagation(); onClose(); }}>×</button>
      <img src={src} alt="Scan enlarged" className="cs-lightbox__img" onClick={e => e.stopPropagation()} />
    </div>,
    document.body,
  );
}

function StatusBadge({ status }) {
  const cls = `cs-status cs-status--${status || 'unknown'}`;
  const map = {
    success: '✓ Success',
    partial: '◐ Partial',
    failed: '✕ Failed',
    pending: 'Pending',
    approved: 'Approved',
    rejected: 'Rejected',
    completed: 'Completed',
  };
  return <span className={cls}>{map[status] || status || '—'}</span>;
}

function TypeBadge({ type }) {
  if (!type) return <span className="cs-type cs-type--unknown">photo</span>;
  return <span className={`cs-type cs-type--${type}`}>{type}</span>;
}

/* P-28: map raw enum error codes from the claim-cups edge function
 * into something an admin can read at a glance. We keep the original
 * enum in the hover tooltip so power users can still see exactly
 * which branch fired without having to dive into the logs. */
const ERROR_CODE_COPY = {
  already_claimed:        'Already claimed',
  batch_not_found:        'Invalid batch',
  batch_revoked:          'Batch revoked',
  batch_expired:          'Batch expired',
  invalid_uuid:           'Malformed QR',
  no_cups:                'Empty QR',
  too_many:               'Too many cups',
  db_error:               'Server error',
  balance_update_failed:  'Balance write failed',
};

function ErrorCodeCell({ code, message }) {
  if (!code) return <span className="cs-muted">—</span>;
  const friendly = ERROR_CODE_COPY[code] || code.replace(/_/g, ' ');
  return (
    <span title={message ? `${code} — ${message}` : code}>
      <span className="cs-error-code">{friendly}</span>
    </span>
  );
}

export default function AdminCupScans({ onNavigate }) {
  const [scans, setScans]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [statusFilter, setStatus] = useState('all');
  const [typeFilter, setType]     = useState('all');
  const [search, setSearch]       = useState('');
  const [sortKey, setSortKey]     = useState('created_at');
  const [sortDir, setSortDir]     = useState('desc');

  /* Column visibility — persisted to localStorage (keyed separately
   * from claims so each table owns its own toggle state). */
  const [visibleCols, setVisibleCols] = useState(() => {
    if (typeof window === 'undefined') return new Set(CS_DEFAULT_VISIBLE_COLS);
    try {
      const raw = localStorage.getItem('pp_admin_cup_scans_cols');
      if (raw) return new Set(JSON.parse(raw));
    } catch { /* ignore parse failures */ }
    return new Set(CS_DEFAULT_VISIBLE_COLS);
  });
  useEffect(() => {
    try {
      localStorage.setItem('pp_admin_cup_scans_cols', JSON.stringify([...visibleCols]));
    } catch { /* quota / private-mode — fine, just don't persist */ }
  }, [visibleCols]);
  function toggleCol(id) {
    setVisibleCols(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const isCol = (id) => visibleCols.has(id);
  const [lightboxSrc, setLightbox] = useState(null);

  useEffect(() => {
    getAdminCupScans()
      .then(setScans)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  function handleSort(key) {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('desc'); }
  }

  const filtered = useMemo(() => {
    let list = scans;
    if (statusFilter !== 'all') list = list.filter(s => s.status === statusFilter);
    if (typeFilter !== 'all') {
      list = list.filter(s =>
        (s.scan_type || (s.source === 'qr' ? null : 'photo')) === typeFilter,
      );
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(s =>
        s.user?.display_name?.toLowerCase().includes(q) ||
        s.user?.email?.toLowerCase().includes(q) ||
        s.id?.toLowerCase().includes(q) ||
        s.batch_id?.toLowerCase().includes(q) ||
        s.error_code?.toLowerCase().includes(q) ||
        s.error_message?.toLowerCase().includes(q) ||
        (s.requested_cup_ids || []).some(id => id.toLowerCase().includes(q)) ||
        (s.activated_cup_ids || []).some(id => id.toLowerCase().includes(q))
      );
    }
    return [...list].sort((a, b) => {
      let av = a[sortKey], bv = b[sortKey];
      if (sortKey === 'created_at') { av = new Date(av).getTime(); bv = new Date(bv).getTime(); }
      if (sortKey === 'user') { av = a.user?.display_name || ''; bv = b.user?.display_name || ''; }
      if (av == null) av = '';
      if (bv == null) bv = '';
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [scans, statusFilter, typeFilter, search, sortKey, sortDir]);

  const counts = useMemo(() => ({
    total: scans.length,
    success: scans.filter(s => s.status === 'success').length,
    partial: scans.filter(s => s.status === 'partial').length,
    failed:  scans.filter(s => s.status === 'failed').length,
    cupsAwarded: scans.reduce((sum, s) => sum + (s.cups_awarded || 0), 0),
  }), [scans]);

  function ThCol({ label, field, sortable = true, width }) {
    return (
      <th
        style={width ? { width } : undefined}
        className={sortable ? 'cs-th cs-th--sortable' : 'cs-th'}
        onClick={sortable ? () => handleSort(field) : undefined}
      >
        {label}
        {sortable && <SortIcon active={sortKey === field} dir={sortDir} />}
      </th>
    );
  }

  return (
    <div className="admin-cup-scans">
      <div className="cs-header">
        <h1 className="cs-header__title">Cup Scans</h1>
        <p className="cs-header__sub">
          <span className="cs-chip">{counts.total} total</span>
          <span className="cs-chip cs-chip--success">{counts.success} success</span>
          <span className="cs-chip cs-chip--partial">{counts.partial} partial</span>
          <span className="cs-chip cs-chip--failed">{counts.failed} failed</span>
          <span className="cs-chip">{counts.cupsAwarded} cups added</span>
        </p>
      </div>

      <div className="cs-toolbar">
        <div className="cs-filter-group">
          <span className="cs-filter-label">Status</span>
          {STATUS_OPTIONS.map(opt => (
            <button
              key={opt.id}
              type="button"
              className={`cs-filter-btn${statusFilter === opt.id ? ' cs-filter-btn--active' : ''}`}
              onClick={() => setStatus(opt.id)}
              title={opt.desc}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="cs-filter-group">
          <span className="cs-filter-label">Source</span>
          {TYPE_OPTIONS.map(t => (
            <button
              key={t}
              type="button"
              className={`cs-filter-btn${typeFilter === t ? ' cs-filter-btn--active' : ''}`}
              onClick={() => setType(t)}
            >
              {t === 'all' ? 'All' : t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        <div className="cs-search-wrap">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9E9A93" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            className="cs-search"
            placeholder="Search user, batch, cup id, error…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <ColumnPicker
          columns={CS_COLUMN_CONFIG}
          visible={visibleCols}
          onToggle={toggleCol}
          onReset={() => setVisibleCols(new Set(CS_DEFAULT_VISIBLE_COLS))}
        />
      </div>

      <div className="cs-table-wrap">
        {loading ? (
          <Spinner label="Loading cup scans…" />
        ) : (
          <table className="cs-table">
            <thead>
              <tr>
                {isCol('photo')     && <ThCol label="Photo"     field="photo_path" sortable={false} width={64} />}
                <ThCol label="User"   field="user" />
                {isCol('source')    && <ThCol label="Source"    field="scan_type" />}
                {isCol('batch')     && <ThCol label="Batch"     field="batch_id" sortable={false} />}
                {isCol('submitted') && <ThCol label="Submitted" field="requested_count" sortable={false} width={80} />}
                {isCol('awarded')   && <ThCol label="Awarded"   field="cups_awarded" width={80} />}
                <ThCol label="Status" field="status" />
                {isCol('error')     && <ThCol label="Error"     field="error_code" sortable={false} />}
                <ThCol label="When"   field="created_at" />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                // 3 always-shown columns (User, Status, When) + the
                // currently-on toggleable ones. Was hard-coded 9
                // before the column picker.
                <tr><td colSpan={3 + visibleCols.size} className="cs-table__empty">
                  {scans.length === 0 ? (
                    <EmptyState
                      icon={
                        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                          <circle cx="12" cy="13" r="4" />
                        </svg>
                      }
                      title="No cup scans yet"
                      body="Every QR scan attempt — successful or not — shows up here. Generate a QR receipt batch first, then scan it from the user app to see audit rows appear."
                      tone="action"
                      primaryAction={{ label: 'Generate QR batch →', onClick: () => onNavigate?.('cupqr') }}
                      secondaryAction={{ label: 'Open user app', onClick: () => window.open('/', '_blank') }}
                    />
                  ) : (
                    <EmptyState
                      icon={
                        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="11" cy="11" r="8" />
                          <line x1="21" y1="21" x2="16.65" y2="16.65" />
                        </svg>
                      }
                      title="No scans match these filters"
                      body={`${scans.length} scan event${scans.length === 1 ? '' : 's'} in total — broaden your filter or clear the search.`}
                      secondaryAction={{
                        label: 'Reset filters',
                        onClick: () => { setStatus('all'); setType('all'); setSearch(''); },
                      }}
                    />
                  )}
                </td></tr>
              ) : filtered.map(scan => (
                <tr key={scan.id} className="cs-row">
                  {isCol('photo') && <td><ScanThumb scan={scan} onZoom={setLightbox} /></td>}

                  <td>
                    <button
                      type="button"
                      className="cs-user-link"
                      onClick={() => onNavigate?.('users')}
                      title="Open Users tab"
                    >
                      <span className="cs-user-avatar">{(scan.user?.display_name || '?')[0].toUpperCase()}</span>
                      <span className="cs-user-info">
                        <span className="cs-user-name">{scan.user?.display_name || 'Unknown'}</span>
                        {scan.user?.email && <span className="cs-user-email">{scan.user.email}</span>}
                      </span>
                    </button>
                  </td>

                  {isCol('source') && <td><TypeBadge type={scan.scan_type} /></td>}

                  {isCol('batch') && (
                    <td>
                      {scan.batch_id ? (
                        <button
                          type="button"
                          className="cs-batch-link"
                          onClick={() => onNavigate?.('cupqr')}
                          title="Open Cup QR Codes tab"
                        >
                          {scan.batch_id.slice(0, 8)}…
                        </button>
                      ) : <span className="cs-muted">—</span>}
                    </td>
                  )}

                  {/* P-32: split the legacy "0/5" cell into two
                   *  columns — Submitted = what the customer tried to
                   *  claim (cup IDs in the QR), Awarded = what the
                   *  server actually credited to their balance. Makes
                   *  "they hit a bin that only had 3 valid cups out
                   *  of 5 advertised" much easier to spot than the old
                   *  combined fraction. */}
                  {isCol('submitted') && (
                    <td className="cs-center">
                      <span
                        className="cs-cups cs-cups--muted"
                        title={
                          (scan.requested_cup_ids || []).length > 0
                            ? `Requested cup IDs:\n${(scan.requested_cup_ids || []).join('\n')}`
                            : ''
                        }
                      >
                        {scan.requested_cup_ids?.length ?? 0}
                      </span>
                    </td>
                  )}
                  {isCol('awarded') && (
                    <td className="cs-center">
                      <span
                        className="cs-cups"
                        title={
                          (scan.activated_cup_ids || []).length > 0
                            ? `Activated cup IDs:\n${(scan.activated_cup_ids || []).join('\n')}`
                            : 'No cups added to balance'
                        }
                      >
                        {scan.cups_awarded ?? 0}
                      </span>
                    </td>
                  )}

                  <td><StatusBadge status={scan.status} /></td>

                  {isCol('error') && (
                    <td className="cs-error">
                      <ErrorCodeCell code={scan.error_code} message={scan.error_message} />
                    </td>
                  )}

                  <td className="cs-date">{formatDate(scan.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Lightbox src={lightboxSrc} onClose={() => setLightbox(null)} />

      <QuickLinks currentPage="cupscans" onNavigate={onNavigate} />
    </div>
  );
}
