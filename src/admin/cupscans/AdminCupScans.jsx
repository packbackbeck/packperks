import { useEffect, useMemo, useState, useRef } from 'react';
import {
  Camera, Check, ChevronRight, CloudAlert, ExternalLink, Hourglass, Lock, PanelRight, QrCode, Rows3, Search, X,
} from 'lucide-react';
import { getAdminCupScans, getCupScanSignedUrl, deleteRecords, getByoRequests, approveByoRequest, denyByoRequest } from '../lib/adminApi';
import Spinner from '../lib/Spinner';
import ColumnPicker from '../shared/ColumnPicker';
import { useBulkSelection } from '../shared/useBulkSelection';
import BulkDeleteBar from '../shared/BulkDeleteBar';
import { Avatar, Lightbox, Notice, SearchBox, SortTh, SplitHandle } from '../shared/opsTable';
import { Badge, Button, EmptyState, PageHeader, Segmented } from '../ui';
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
const TYPE_LABEL = { all: 'All', camera: 'Camera', gallery: 'Gallery', deeplink: 'Deep link', byo: 'BYO QR', photo: 'Photo' };
const TYPE_TONE = { camera: 'violet', gallery: 'sky', deeplink: 'teal', byo: 'emerald' };

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
        className="ot-thumb"
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
          <Lock size={8} strokeWidth={2.8} />
        </span>
      </button>
    );
  }

  if (scan?.photo_path && signError) {
    return (
      <div className="ot-thumb ot-thumb--bad" title="Photo missing from storage">
        <CloudAlert size={14} aria-hidden="true" />
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
    <div className="ot-thumb ot-thumb--empty" title={sourceLabel}>
      {scan?.__held ? <QrCode size={14} aria-hidden="true" /> : <Camera size={14} aria-hidden="true" />}
    </div>
  );
}

const STATUS_META = {
  success:        { tone: 'success', label: 'Success', icon: Check },
  partial:        { tone: 'warning', label: 'Partial' },
  failed:         { tone: 'danger',  label: 'Failed', icon: X },
  pending:        { tone: 'warning', label: 'Pending' },
  pending_review: { tone: 'warning', label: 'Held · review', icon: Hourglass },
  approved:       { tone: 'success', label: 'Approved' },
  rejected:       { tone: 'danger',  label: 'Rejected' },
  completed:      { tone: 'success', label: 'Completed' },
};

function StatusBadge({ status }) {
  const meta = STATUS_META[status];
  if (!meta) return <Badge tone="neutral">{status || '—'}</Badge>;
  return <Badge tone={meta.tone} icon={meta.icon}>{meta.label}</Badge>;
}

function TypeBadge({ type }) {
  if (!type) return <span className="ui-badge ui-badge--neutral">Photo</span>;
  const tone = TYPE_TONE[type];
  return (
    <span className={`ui-badge ${tone ? `ui-tone--${tone}` : 'ui-badge--neutral'}`}>
      {TYPE_LABEL[type] || type}
    </span>
  );
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
  if (!code) return <span className="ot-faint">—</span>;
  const friendly = ERROR_CODE_COPY[code] || code.replace(/_/g, ' ');
  return (
    <span className="ui-badge ui-badge--danger cs-error-code" title={message ? `${code} — ${message}` : code}>
      {friendly}
    </span>
  );
}

function DetailRow({ label, value, strong, mono }) {
  return (
    <div className="ot-kv__row">
      <span className="ot-kv__label">{label}</span>
      <span className={`ot-kv__val${strong ? ' ot-kv__val--strong' : ''}${mono ? ' ot-kv__val--mono' : ''}`}>{value}</span>
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
      <div className="ot-panel ot-panel--empty cs-detail cs-detail--empty">
        <EmptyState icon={Camera} title="No scan selected">
          Select a scan on the left to see its details.
        </EmptyState>
      </div>
    );
  }

  const photoSrc = scan.photo_url || signed;
  const isHeld = scan.__held;
  const busy = busyId === scan.__reqId;
  const cups = scan.cups_awarded || 1;

  return (
    <div className="ot-panel cs-detail">
      <div className="ot-panel__head">
        <div className="ot-panel__titles">
          <h2 className="ot-panel__title">{isHeld ? 'Held cup request' : 'Scan detail'}</h2>
          <p className="ot-panel__id">{String(scan.id).replace('held:', '').slice(0, 8)}…</p>
        </div>
        <StatusBadge status={scan.status} />
        <Button variant="ghost" size="sm" icon={X} aria-label="Close" onClick={onClose} />
      </div>

      <div className="ot-panel__body cs-detail__body">
        {isHeld && (
          <p className="ot-callout ot-callout--info">
            <Hourglass size={15} aria-hidden="true" />
            <span>
              This customer went over the store's daily auto-credit limit, so the scan is
              waiting for review. Approving credits {cups} cup{cups === 1 ? '' : 's'} to their
              balance; rejecting credits nothing.
            </span>
          </p>
        )}

        {photoSrc ? (
          <button type="button" className="cs-detail__photo" onClick={() => onZoom?.(photoSrc)} title="Click to enlarge">
            <img src={photoSrc} alt="Scan" />
          </button>
        ) : !isHeld ? (
          <div className="cs-detail__photo cs-detail__photo--empty">
            <Camera size={18} aria-hidden="true" />
            No photo for this scan
          </div>
        ) : null}

        <button type="button" className="cs-detail__user" onClick={() => onOpenUser?.(scan.user_id)} title="Open this customer on the Users page">
          <Avatar name={scan.user?.display_name} seed={scan.user_id} size={34} />
          <span className="ot-person__text">
            <span className="ot-person__name">{scan.user?.display_name || 'Unknown'}</span>
            {scan.user?.email && <span className="ot-person__sub">{scan.user.email}</span>}
          </span>
          <ChevronRight className="cs-detail__user-arrow" size={16} aria-hidden="true" />
        </button>

        <div className="ot-kv">
          <DetailRow label="When" value={formatDate(scan.created_at)} />
          <DetailRow label="Source" value={TYPE_LABEL[scan.scan_type] || scan.scan_type || 'Photo'} />
          {!isHeld && <DetailRow label="Submitted" value={scan.requested_cup_ids?.length ?? 0} />}
          <DetailRow label={isHeld ? 'Cups to credit' : 'Cups awarded'} value={scan.cups_awarded ?? 0} strong />
          {scan.batch_id && <DetailRow label="Batch" value={`${scan.batch_id.slice(0, 8)}…`} mono />}
          {scan.error_code && <DetailRow label="Error" value={<ErrorCodeCell code={scan.error_code} message={scan.error_message} />} />}
          {scan.note && <DetailRow label="Note" value={scan.note} />}
        </div>
      </div>

      {isHeld && (
        <div className="ot-panel__foot cs-detail__actions">
          <p className="cs-detail__actions-hint">Approving credits the cup to this customer's balance.</p>
          <div className="cs-detail__btns">
            <Button variant="danger-ghost" icon={X} className="cs-detail__btn--reject" disabled={busy} onClick={() => onDecide(scan.__reqId, 'reject')}>
              Reject
            </Button>
            <Button variant="primary" icon={Check} disabled={busy} onClick={() => onDecide(scan.__reqId, 'approve')}>
              {busy ? 'Working…' : 'Approve & credit'}
            </Button>
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

  const sort = { key: sortKey, dir: sortDir };
  const th = (label, field, { sortable = true, width, className } = {}) => (
    <SortTh label={label} field={field} sort={sort} onSort={handleSort} sortable={sortable} style={width ? { width } : undefined} className={className} />
  );

  return (
    <div className="ui-page cs-page">
      <PageHeader
        title="Cup scans"
        subtitle={loading
          ? 'Every cup scanned back, and the ones on hold.'
          : `${counts.total} scans · ${counts.success} successful · ${counts.partial} partial · ${counts.failed} failed · ${counts.cupsAwarded} cups added`}
      >
        {counts.held > 0 && (
          <button
            type="button"
            className="ui-btn cs-held-btn"
            onClick={() => { setStatus('held'); setViewMode('review'); }}
            title="Over-limit BYO scans waiting for your review"
          >
            <Hourglass size={15} aria-hidden="true" />
            {counts.held} awaiting review
          </button>
        )}
        <Segmented
          ariaLabel="View mode"
          value={viewMode}
          onChange={(mode) => {
            if (mode === 'table') { setViewMode('table'); return; }
            setViewMode('review');
            if (!selectedId && filtered[0]) setSelectedId(filtered[0].id);
          }}
          options={[
            { id: 'table', label: 'Table', icon: Rows3 },
            { id: 'review', label: 'Review', icon: PanelRight },
          ]}
        />
      </PageHeader>

      <div className="ot-toolbar">
        <div className="ot-toolbar__group">
          <span className="ot-toolbar__label">Status</span>
          <Segmented
            ariaLabel="Filter by status"
            value={statusFilter}
            onChange={setStatus}
            options={STATUS_OPTIONS.map(opt => ({
              id: opt.id,
              label: opt.label,
              title: opt.desc,
              count: opt.id === 'held' && counts.held > 0 ? counts.held : undefined,
            }))}
          />
        </div>
        <div className="ot-toolbar__group">
          <span className="ot-toolbar__label">Source</span>
          <Segmented
            ariaLabel="Filter by source"
            value={typeFilter}
            onChange={setType}
            options={TYPE_OPTIONS.map(t => ({ id: t, label: TYPE_LABEL[t] }))}
          />
        </div>
        <span className="ot-toolbar__break" aria-hidden="true" />
        <SearchBox
          className="cs-search"
          value={search}
          onChange={setSearch}
          placeholder="Search user, batch, cup ID, error"
          label="Search cup scans"
        />
        <ColumnPicker
          columns={CS_COLUMN_CONFIG}
          visible={visibleCols}
          onToggle={toggleCol}
          onReset={() => setVisibleCols(new Set(CS_DEFAULT_VISIBLE_COLS))}
        />
      </div>

      {(notice || actionError) && (
        <Notice tone={actionError ? 'danger' : 'success'} onDismiss={() => { setNotice(null); setActionError(null); }}>
          {actionError || notice}
        </Notice>
      )}

      <div
        className={`cs-layout${viewMode === 'review' ? ' cs-layout--review' : ''}`}
        ref={layoutRef}
        style={viewMode === 'review' ? { gridTemplateColumns: `minmax(360px, 1fr) 12px minmax(300px, ${reviewSplit}px)` } : undefined}
      >
      <div className="ui-card ot-table-card cs-table-wrap">
        {loading ? (
          <Spinner label="Loading cup scans…" />
        ) : (
          <table className="ui-table cs-table">
            <thead>
              <tr>
                <th className="ot-check">
                  <input
                    type="checkbox"
                    checked={sel.allSelected}
                    ref={el => { if (el) el.indeterminate = sel.someSelected && !sel.allSelected; }}
                    onChange={sel.toggleAll}
                    aria-label="Select all cup scans"
                  />
                </th>
                {isCol('photo')     && th('Photo', 'photo_path', { sortable: false, width: 64 })}
                {th('User', 'user')}
                {isCol('source')    && th('Source', 'scan_type')}
                {isCol('batch')     && th('Batch', 'batch_id', { sortable: false })}
                {isCol('submitted') && th('Submitted', 'requested_count', { sortable: false, width: 90, className: 'ot-center' })}
                {isCol('awarded')   && th('Awarded', 'cups_awarded', { width: 90, className: 'ot-center' })}
                {th('Status', 'status')}
                {isCol('error')     && th('Error', 'error_code', { sortable: false })}
                {th('When', 'created_at')}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                // 4 always-shown columns (checkbox, User, Status, When) + the
                // currently-on toggleable ones.
                <tr className="cs-empty-row"><td colSpan={4 + visibleCols.size}>
                  {scans.length === 0 ? (
                    <EmptyState
                      icon={Camera}
                      title="No cup scans yet"
                      action={(
                        <div className="cs-empty-actions">
                          <Button variant="primary" size="sm" icon={QrCode} onClick={() => onNavigate?.('cupqr')}>Generate QR batch</Button>
                          <Button variant="outline" size="sm" icon={ExternalLink} onClick={() => window.open('/', '_blank')}>Open user app</Button>
                        </div>
                      )}
                    >
                      Every QR scan attempt, successful or not, shows up here. Generate a QR receipt batch first, then scan it from the user app to see rows appear.
                    </EmptyState>
                  ) : (
                    <EmptyState
                      icon={Search}
                      title="No scans match these filters"
                      action={(
                        <Button variant="outline" size="sm" onClick={() => { setStatus('all'); setType('all'); setSearch(''); }}>
                          Reset filters
                        </Button>
                      )}
                    >
                      {`${scans.length} scan event${scans.length === 1 ? '' : 's'} in total. Broaden your filter or clear the search.`}
                    </EmptyState>
                  )}
                </td></tr>
              ) : filtered.map(scan => (
                <tr
                  key={scan.id}
                  className={`ot-row${sel.isSelected(scan.id) ? ' ot-row--selected' : ''}${scan.__held ? ' ot-row--flag' : ''}${selectedId === scan.id ? ' ot-row--active' : ''}`}
                  onClick={() => {
                    // Click a row → open review + select it. Click the same
                    // highlighted row again → back to the normal table view.
                    if (viewMode === 'review' && selectedId === scan.id) {
                      setSelectedId(null);
                      setViewMode('table');
                    } else {
                      setSelectedId(scan.id);
                      setViewMode('review');
                    }
                  }}
                >
                  <td className="ot-check" onClick={e => e.stopPropagation()}>
                    {!scan.__held && (
                      <input
                        type="checkbox"
                        checked={sel.isSelected(scan.id)}
                        onChange={() => sel.toggle(scan.id)}
                        aria-label="Select scan"
                      />
                    )}
                  </td>
                  {isCol('photo') && <td className="cs-thumb-cell"><ScanThumb scan={scan} onZoom={setLightbox} /></td>}

                  <td>
                    <button
                      type="button"
                      className="ot-person"
                      onClick={e => { e.stopPropagation(); onNavigate?.('users', { focusUserId: scan.user_id }); }}
                      title="Open this customer on the Users page"
                    >
                      <Avatar name={scan.user?.display_name} seed={scan.user_id} size={28} />
                      <span className="ot-person__text">
                        <span className="ot-person__name cs-user-name">{scan.user?.display_name || 'Unknown'}</span>
                        {scan.user?.email && <span className="ot-person__sub cs-user-email">{scan.user.email}</span>}
                      </span>
                    </button>
                  </td>

                  {isCol('source') && <td><TypeBadge type={scan.scan_type} /></td>}

                  {isCol('batch') && (
                    <td>
                      {scan.batch_id ? (
                        <button
                          type="button"
                          className="ot-link ot-mono cs-batch-link"
                          onClick={e => { e.stopPropagation(); onNavigate?.('cupqr'); }}
                          title="Open Dynamic QR code"
                        >
                          {scan.batch_id.slice(0, 8)}…
                        </button>
                      ) : <span className="ot-faint">—</span>}
                    </td>
                  )}

                  {/* P-32: Submitted = what the customer tried to claim (cup
                   *  IDs in the QR), Awarded = what the server actually
                   *  credited to their balance. */}
                  {isCol('submitted') && (
                    <td className="ot-center">
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
                    <td className="ot-center">
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
                      <div className="cs-held-actions" onClick={e => e.stopPropagation()}>
                        <Button
                          variant="primary"
                          size="sm"
                          className="cs-act"
                          disabled={busyId === scan.__reqId}
                          onClick={() => decideHeld(scan.__reqId, 'approve')}
                        >
                          {busyId === scan.__reqId ? '…' : 'Approve'}
                        </Button>
                        <Button
                          variant="danger-ghost"
                          size="sm"
                          className="cs-act cs-act--reject"
                          disabled={busyId === scan.__reqId}
                          onClick={() => decideHeld(scan.__reqId, 'reject')}
                        >
                          Reject
                        </Button>
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

                  <td className="ot-date">{formatDate(scan.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

        {viewMode === 'review' && (
          <SplitHandle
            className="cs-resizer"
            onMouseDown={startSplitDrag}
            onDoubleClick={() => setReviewSplit(430)}
            label="Drag to resize the table and detail panel"
          />
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

      <Lightbox src={lightboxSrc} alt="Scan enlarged" onClose={() => setLightbox(null)} />
    </div>
  );
}
