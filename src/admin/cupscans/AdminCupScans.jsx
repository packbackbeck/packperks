import { useEffect, useMemo, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { getAdminCupScans, getCupScanSignedUrl, deleteRecords, getByoRequests, approveByoRequest, denyByoRequest } from '../lib/adminApi';
import Spinner from '../lib/Spinner';
import EmptyState from '../shared/EmptyState';
import ColumnPicker from '../shared/ColumnPicker';
import { useBulkSelection } from '../shared/useBulkSelection';
import BulkDeleteBar from '../shared/BulkDeleteBar';
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
  { id: 'held',     label: 'Held',        desc: 'Over-limit BYO scans held for your review' },
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
    pending_review: 'Held · review',
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

function DetailRow({ label, value, strong, mono }) {
  return (
    <div className="cs-detail__row">
      <span className="cs-detail__row-label">{label}</span>
      <span className={`cs-detail__row-val${strong ? ' cs-detail__row-val--strong' : ''}${mono ? ' cs-detail__row-val--mono' : ''}`}>{value}</span>
    </div>
  );
}

/* ScanDetailPanel — the right-hand "review" surface. Shows a scan's photo,
 * who scanned it (click to jump to that customer on Users), and its details.
 * For held BYO requests it adds the Approve / Reject controls. */
function ScanDetailPanel({ scan, onClose, onZoom, onOpenUser, onDecide, busyId }) {
  const [signed, setSigned] = useState(null);
  useEffect(() => {
    let cancel = false;
    setSigned(null);
    if (scan?.photo_path) {
      getCupScanSignedUrl(scan.photo_path).then(u => { if (!cancel && u) setSigned(u); }).catch(() => {});
    }
    return () => { cancel = true; };
  }, [scan?.id, scan?.photo_path]);

  if (!scan) {
    return (
      <div className="cs-detail cs-detail--empty">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#C8C4BC" strokeWidth="1.5">
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
          <circle cx="12" cy="13" r="4" />
        </svg>
        <p>Select a scan on the left to see its details.</p>
      </div>
    );
  }

  const photoSrc = scan.photo_url || signed;
  const isHeld = scan.__held;
  const busy = busyId === scan.__reqId;
  const cups = scan.cups_awarded || 1;

  return (
    <div className="cs-detail">
      <div className="cs-detail__header">
        <div className="cs-detail__heading">
          <div className="cs-detail__title">{isHeld ? 'Held cup request' : 'Scan detail'}</div>
          <div className="cs-detail__id">{String(scan.id).replace('held:', '').slice(0, 8)}…</div>
        </div>
        <StatusBadge status={scan.status} />
        <button className="cs-detail__close" onClick={onClose} aria-label="Close">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <div className="cs-detail__body">
        {isHeld && (
          <div className="cs-detail__hold-note">
            This customer went over the store's daily auto-credit limit, so the scan is
            waiting for review. Approving credits {cups} cup{cups === 1 ? '' : 's'} to their
            balance; rejecting credits nothing.
          </div>
        )}

        {photoSrc ? (
          <button className="cs-detail__photo" onClick={() => onZoom?.(photoSrc)} title="Click to enlarge">
            <img src={photoSrc} alt="Scan" />
          </button>
        ) : !isHeld ? (
          <div className="cs-detail__photo cs-detail__photo--empty">No photo for this scan</div>
        ) : null}

        <button className="cs-detail__user" onClick={() => onOpenUser?.(scan.user_id)} title="Open this customer on the Users page">
          <span className="cs-user-avatar">{(scan.user?.display_name || '?')[0].toUpperCase()}</span>
          <span className="cs-user-info">
            <span className="cs-user-name">{scan.user?.display_name || 'Unknown'}</span>
            {scan.user?.email && <span className="cs-user-email">{scan.user.email}</span>}
          </span>
          <svg className="cs-detail__user-arrow" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
        </button>

        <div className="cs-detail__rows">
          <DetailRow label="When" value={formatDate(scan.created_at)} />
          <DetailRow label="Source" value={scan.scan_type || 'photo'} />
          {!isHeld && <DetailRow label="Submitted" value={scan.requested_cup_ids?.length ?? 0} />}
          <DetailRow label={isHeld ? 'Cups to credit' : 'Cups awarded'} value={scan.cups_awarded ?? 0} strong />
          {scan.batch_id && <DetailRow label="Batch" value={`${scan.batch_id.slice(0, 8)}…`} mono />}
          {scan.error_code && <DetailRow label="Error" value={<ErrorCodeCell code={scan.error_code} message={scan.error_message} />} />}
          {scan.note && <DetailRow label="Note" value={scan.note} />}
        </div>
      </div>

      {isHeld && (
        <div className="cs-detail__actions">
          <p className="cs-detail__actions-hint">Approving credits the cup to this customer's balance.</p>
          <div className="cs-detail__btns">
            <button className="cs-detail__btn cs-detail__btn--approve" disabled={busy} onClick={() => onDecide(scan.__reqId, 'approve')}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"><polyline points="20 6 9 17 4 12"/></svg>
              {busy ? 'Working…' : 'Approve & credit'}
            </button>
            <button className="cs-detail__btn cs-detail__btn--reject" disabled={busy} onClick={() => onDecide(scan.__reqId, 'reject')}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              Reject
            </button>
          </div>
        </div>
      )}
    </div>
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

  /* Over-limit BYO scans held for review (byo_cup_requests). Merged into the
   * table as "Held" rows an admin can approve (credits the cup) or reject. */
  const [held, setHeld]           = useState([]);
  const [busyId, setBusyId]       = useState(null);
  const [notice, setNotice]       = useState(null);
  const [actionError, setActionError] = useState(null);

  /* View mode + selection, mirroring the Claims page. 'review' opens a
   * resizable split with a per-scan detail panel on the right. */
  const [viewMode, setViewMode]   = useState('table');
  const [selectedId, setSelectedId] = useState(null);

  /* Resizable split (review mode): drag the divider to set the panel width. */
  const layoutRef = useRef(null);
  const draggingSplit = useRef(false);
  const [reviewSplit, setReviewSplit] = useState(() => {
    if (typeof window === 'undefined') return 430;
    const saved = Number(localStorage.getItem('pp_admin_cupscans_split'));
    return saved >= 320 ? saved : 430;
  });
  useEffect(() => {
    function onMove(e) {
      if (!draggingSplit.current || !layoutRef.current) return;
      const rect = layoutRef.current.getBoundingClientRect();
      const w = Math.max(320, Math.min(rect.width - 420, rect.right - e.clientX));
      setReviewSplit(w);
    }
    function onUp() {
      if (!draggingSplit.current) return;
      draggingSplit.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      try { localStorage.setItem('pp_admin_cupscans_split', String(Math.round(reviewSplit))); } catch { /* ignore */ }
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

  const reload = () => {
    setLoading(true);
    Promise.all([
      getAdminCupScans(),
      getByoRequests('pending').catch(() => []),
    ])
      .then(([s, h]) => { setScans(s); setHeld(h); })
      .catch(console.error)
      .finally(() => setLoading(false));
  };
  useEffect(() => { reload(); }, []);

  /* Approve credits the cup to the customer's balance; reject denies it.
   * Both resolve the held byo_cup_requests row, then we reload so the row
   * leaves the "Held" list (an approval also mints a success scan row). */
  async function decideHeld(reqId, action) {
    setBusyId(reqId); setActionError(null); setNotice(null);
    try {
      if (action === 'approve') { await approveByoRequest(reqId); setNotice('Approved. The cup was credited to the customer.'); }
      else { await denyByoRequest(reqId); setNotice('Rejected. No cup was credited.'); }
      if (selectedId === `held:${reqId}`) setSelectedId(null);
      reload();
      setTimeout(() => setNotice(null), 3500);
    } catch (e) {
      setActionError(e?.message || 'Action failed.');
    } finally {
      setBusyId(null);
    }
  }

  function handleSort(key) {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('desc'); }
  }

  /* Normalise held byo_cup_requests into scan-shaped rows so they can live
   * in the same table (with a distinct 'pending_review' status). */
  const heldRows = useMemo(() => held.map(r => ({
    id: `held:${r.id}`,
    __held: true,
    __reqId: r.id,
    user_id: r.user_id,
    user: r.user || { display_name: r.userName, email: r.userEmail },
    status: 'pending_review',
    scan_type: 'byo',
    source: 'byo_qr',
    cups_awarded: r.cups,
    requested_cup_ids: [],
    activated_cup_ids: [],
    batch_id: null,
    photo_url: null,
    photo_path: null,
    error_code: null,
    error_message: null,
    note: r.note || null,
    created_at: r.created_at,
  })), [held]);

  const filtered = useMemo(() => {
    let list = [...heldRows, ...scans];
    if (statusFilter === 'held') list = list.filter(s => s.__held);
    else if (statusFilter !== 'all') list = list.filter(s => !s.__held && s.status === statusFilter);
    if (typeFilter !== 'all') {
      list = list.filter(s => !s.__held &&
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
      // Held rows always float to the top — they need action.
      if (a.__held !== b.__held) return a.__held ? -1 : 1;
      let av = a[sortKey], bv = b[sortKey];
      if (sortKey === 'created_at') { av = new Date(av).getTime(); bv = new Date(bv).getTime(); }
      if (sortKey === 'user') { av = a.user?.display_name || ''; bv = b.user?.display_name || ''; }
      if (av == null) av = '';
      if (bv == null) bv = '';
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [scans, heldRows, statusFilter, typeFilter, search, sortKey, sortDir]);

  const counts = useMemo(() => ({
    total: scans.length,
    success: scans.filter(s => s.status === 'success').length,
    partial: scans.filter(s => s.status === 'partial').length,
    failed:  scans.filter(s => s.status === 'failed').length,
    held:    held.length,
    cupsAwarded: scans.reduce((sum, s) => sum + (s.cups_awarded || 0), 0),
  }), [scans, held]);

  // Held rows are byo_cup_requests, not cup_scans — keep them out of the
  // bulk-delete selection (deleting them from cup_scans would be a no-op).
  const selectableRows = useMemo(() => filtered.filter(s => !s.__held), [filtered]);
  const sel = useBulkSelection(selectableRows);

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
        <div className="cs-header__left">
          <h1 className="cs-header__title">Cup Scans</h1>
          <p className="cs-header__sub">
            {counts.held > 0 && (
              <button
                type="button"
                className="cs-chip cs-chip--held"
                onClick={() => { setStatus('held'); setViewMode('review'); }}
                title="Over-limit BYO scans waiting for your review"
              >
                {counts.held} awaiting review
              </button>
            )}
            <span className="cs-chip">{counts.total} total</span>
            <span className="cs-chip cs-chip--success">{counts.success} success</span>
            <span className="cs-chip cs-chip--partial">{counts.partial} partial</span>
            <span className="cs-chip cs-chip--failed">{counts.failed} failed</span>
            <span className="cs-chip">{counts.cupsAwarded} cups added</span>
          </p>
        </div>
        <div className="cs-viewmode" role="tablist" aria-label="View mode">
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'table'}
            className={`cs-viewmode__btn${viewMode === 'table' ? ' cs-viewmode__btn--active' : ''}`}
            onClick={() => setViewMode('table')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
            Table
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'review'}
            className={`cs-viewmode__btn${viewMode === 'review' ? ' cs-viewmode__btn--active' : ''}`}
            onClick={() => { setViewMode('review'); if (!selectedId && filtered[0]) setSelectedId(filtered[0].id); }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="11" height="16" rx="1.5"/><rect x="16" y="4" width="5" height="16" rx="1.5"/></svg>
            Review
          </button>
        </div>
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

      {(notice || actionError) && (
        <div className={`cs-banner${actionError ? ' cs-banner--error' : ''}`}>
          <span>{actionError || notice}</span>
          <button className="cs-banner__x" onClick={() => { setNotice(null); setActionError(null); }} aria-label="Dismiss">×</button>
        </div>
      )}

      <div
        className={`cs-layout${viewMode === 'review' ? ' cs-layout--review' : ''}`}
        ref={layoutRef}
        style={viewMode === 'review' ? { gridTemplateColumns: `minmax(420px, 1fr) 9px ${reviewSplit}px` } : undefined}
      >
      <div className="cs-table-wrap">
        {loading ? (
          <Spinner label="Loading cup scans…" />
        ) : (
          <table className="cs-table">
            <thead>
              <tr>
                <th className="bulk-check-cell">
                  <input
                    type="checkbox"
                    checked={sel.allSelected}
                    ref={el => { if (el) el.indeterminate = sel.someSelected && !sel.allSelected; }}
                    onChange={sel.toggleAll}
                    aria-label="Select all cup scans"
                  />
                </th>
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
                <tr><td colSpan={4 + visibleCols.size} className="cs-table__empty">
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
                <tr
                  key={scan.id}
                  className={`cs-row${sel.isSelected(scan.id) ? ' cs-row--selected' : ''}${scan.__held ? ' cs-row--held' : ''}${selectedId === scan.id ? ' cs-row--active' : ''}`}
                  onClick={() => setSelectedId(prev => (prev === scan.id ? null : scan.id))}
                >
                  <td className="bulk-check-cell" onClick={e => e.stopPropagation()}>
                    {!scan.__held && (
                      <input
                        type="checkbox"
                        checked={sel.isSelected(scan.id)}
                        onChange={() => sel.toggle(scan.id)}
                        aria-label="Select scan"
                      />
                    )}
                  </td>
                  {isCol('photo') && <td><ScanThumb scan={scan} onZoom={setLightbox} /></td>}

                  <td>
                    <button
                      type="button"
                      className="cs-user-link"
                      onClick={e => { e.stopPropagation(); onNavigate?.('users', { focusUserId: scan.user_id }); }}
                      title="Open this customer on the Users page"
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
                          onClick={e => { e.stopPropagation(); onNavigate?.('cupqr'); }}
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

                  <td>
                    {scan.__held ? (
                      <div className="cs-held-cell">
                        <div className="cs-held-actions" onClick={e => e.stopPropagation()}>
                          <button
                            type="button"
                            className="cs-act cs-act--approve"
                            disabled={busyId === scan.__reqId}
                            onClick={() => decideHeld(scan.__reqId, 'approve')}
                          >
                            {busyId === scan.__reqId ? '…' : 'Approve'}
                          </button>
                          <button
                            type="button"
                            className="cs-act cs-act--reject"
                            disabled={busyId === scan.__reqId}
                            onClick={() => decideHeld(scan.__reqId, 'reject')}
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    ) : (
                      <StatusBadge status={scan.status} />
                    )}
                  </td>

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

        {viewMode === 'review' && (
          <div
            className="cs-resizer"
            onMouseDown={startSplitDrag}
            onDoubleClick={() => setReviewSplit(430)}
            role="separator"
            aria-orientation="vertical"
            aria-label="Drag to resize the table and detail panel"
            title="Drag to resize · double-click to reset"
          >
            <span className="cs-resizer__grip" aria-hidden="true" />
          </div>
        )}

        {viewMode === 'review' && (
          <ScanDetailPanel
            scan={filtered.find(s => s.id === selectedId) || null}
            onClose={() => setSelectedId(null)}
            onZoom={setLightbox}
            onOpenUser={(uid) => uid && onNavigate?.('users', { focusUserId: uid })}
            onDecide={decideHeld}
            busyId={busyId}
          />
        )}
      </div>

      <BulkDeleteBar
        count={sel.count}
        noun="cup scans"
        onClear={sel.clear}
        onDelete={async () => {
          await deleteRecords('cup_scans', sel.selectedIds);
          sel.clear();
          reload();
        }}
      />

      <Lightbox src={lightboxSrc} onClose={() => setLightbox(null)} />
    </div>
  );
}
