import { useState, useEffect, useMemo } from 'react';
import { Check, ExternalLink, FileText, Maximize2, X } from 'lucide-react';
import { getAdminReceiptChecks, updateClaimStatus, getReceiptSignedUrl } from '../lib/adminApi';
import Spinner from '../lib/Spinner';
import PermissionGate from '../auth/PermissionGate';
import { logAction } from '../auth/actionLog';
import { Avatar, Lightbox, Notice, SearchBox, SortTh } from '../shared/opsTable';
import { Badge, Button, EmptyState, PageHeader, Segmented } from '../ui';
import './AdminReceiptCheck.css';
import { useAdminMoney } from '../lib/adminMoney';

// Map of the three checks the LLM runs, keyed by the slug stored in
// claims.ai_failure_checks. Used to render the verdict panel below.
const AI_CHECK_LABELS = {
  is_receipt: 'Is a receipt',
  is_authentic_burger_king: 'Authentic Burger King',
  contains_required_item: 'Contains reward item',
  duplicate_receipt: 'Not a duplicate',
};

function AiVerdictPanel({ claim }) {
  const { money } = useAdminMoney();
  // Only render once the AI has actually verified the claim. We key on
  // verified_at because the model sometimes omits ai_confidence even when
  // all 3 checks passed — verified_at is set unconditionally on every run.
  if (!claim || !claim.verified_at) {
    return (
      <div className="rc-ai-panel rc-ai-panel--empty">
        <div className="rc-ai-panel__header">
          <span className="rc-ai-panel__title">AI check</span>
          <span className="rc-ai-panel__empty">Not verified yet</span>
        </div>
      </div>
    );
  }

  const checks = [
    { key: 'is_receipt',                 passed: claim.ai_is_receipt },
    { key: 'is_authentic_burger_king',   passed: claim.ai_is_burger_king },
    { key: 'contains_required_item',     passed: claim.ai_contains_required_item },
  ];
  const failedChecks = claim.ai_failure_checks || [];
  const isDuplicate = failedChecks.includes('duplicate_receipt');
  const confidence = claim.ai_confidence ?? 0;
  const allPassed = checks.every(c => c.passed) && !isDuplicate;

  return (
    <div className={`rc-ai-panel rc-ai-panel--${allPassed ? 'pass' : 'fail'}`}>
      <div className="rc-ai-panel__header">
        <span className="rc-ai-panel__title">AI check</span>
        <span className="rc-ai-panel__confidence">
          {(confidence * 100).toFixed(0)}% confident
        </span>
      </div>

      <div className="rc-ai-panel__checks">
        {checks.map(c => (
          <div key={c.key} className={`rc-ai-check rc-ai-check--${c.passed ? 'pass' : 'fail'}`}>
            <span className="rc-ai-check__dot">
              {c.passed ? <Check size={11} strokeWidth={2.8} /> : <X size={11} strokeWidth={2.8} />}
            </span>
            <span className="rc-ai-check__label">{AI_CHECK_LABELS[c.key]}</span>
          </div>
        ))}
        {isDuplicate && (
          <div className="rc-ai-check rc-ai-check--fail">
            <span className="rc-ai-check__dot"><X size={11} strokeWidth={2.8} /></span>
            <span className="rc-ai-check__label">Not a duplicate</span>
          </div>
        )}
      </div>

      {claim.ai_required_item && (
        <div className="rc-ai-panel__row">
          <span className="rc-ai-panel__row-label">Required item</span>
          <span className="rc-ai-panel__row-val">{claim.ai_required_item}</span>
        </div>
      )}
      {claim.extracted_total_eur != null && (
        <div className="rc-ai-panel__row">
          <span className="rc-ai-panel__row-label">Receipt total</span>
          <span className="rc-ai-panel__row-val">{money(Number(claim.extracted_total_eur))}</span>
        </div>
      )}
      {claim.extracted_receipt_id && (
        <div className="rc-ai-panel__row">
          <span className="rc-ai-panel__row-label">Receipt #</span>
          <span className="rc-ai-panel__row-val rc-ai-panel__row-val--mono">{claim.extracted_receipt_id}</span>
        </div>
      )}
      {claim.extracted_datetime && (
        <div className="rc-ai-panel__row">
          <span className="rc-ai-panel__row-label">Receipt date</span>
          <span className="rc-ai-panel__row-val">{new Date(claim.extracted_datetime).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      )}
      {claim.ai_reason && (
        <div className="rc-ai-panel__reason">
          <span className="rc-ai-panel__reason-label">Why</span>
          <span className="rc-ai-panel__reason-text">{claim.ai_reason}</span>
        </div>
      )}
      {claim.ai_verdict?.items?.length > 0 && (
        <details className="rc-ai-panel__items">
          <summary>Extracted line items ({claim.ai_verdict.items.length})</summary>
          <ul>
            {claim.ai_verdict.items.map((it, i) => (
              <li key={i}>
                {it.qty}× {it.name}
                {it.price_eur != null && ` — ${money(Number(it.price_eur))}`}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function formatDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatDateShort(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

const STATUS_OPTIONS = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'completed', label: 'Approved' },
  { id: 'failed', label: 'Rejected' },
];
const STATUS_BADGE = {
  pending:   { tone: 'warning', label: 'Pending' },
  completed: { tone: 'success', label: 'Approved' },
  failed:    { tone: 'danger',  label: 'Rejected' },
};

function StatusBadge({ status }) {
  const meta = STATUS_BADGE[status] || { tone: 'neutral', label: status };
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

function ReceiptThumb({ url, path }) {
  // Resolve a signed URL on-demand for thumbnails in the table. Cheap because
  // each row only fetches once.
  const [signed, setSigned] = useState(null);
  useEffect(() => {
    let cancelled = false;
    if (!url && path) {
      getReceiptSignedUrl(path, 600).then(u => { if (!cancelled) setSigned(u); });
    }
    return () => { cancelled = true; };
  }, [url, path]);
  const src = url || signed;

  if (!src) return (
    <div className="ot-thumb ot-thumb--empty"><FileText size={14} aria-hidden="true" /></div>
  );
  return <div className="ot-thumb"><img src={src} alt="Receipt" /></div>;
}

function DetailPanel({ claim, onApprove, onFail, updating, onNavigateClaims }) {
  const { money } = useAdminMoney();
  const [lightbox, setLightbox] = useState(false);
  const [signedUrl, setSignedUrl] = useState(null);

  // For new claims the photo is in private storage — sign a URL for display.
  // Legacy claims still have receipt_photo_url (inline data URL) so we fall
  // back to that.
  useEffect(() => {
    let cancelled = false;
    setSignedUrl(null);
    if (claim?.receipt_photo_path) {
      getReceiptSignedUrl(claim.receipt_photo_path).then(url => {
        if (!cancelled) setSignedUrl(url);
      });
    }
    return () => { cancelled = true; };
  }, [claim?.id, claim?.receipt_photo_path]);

  const photoSrc = signedUrl || claim?.receipt_photo_url || null;

  if (!claim) {
    return (
      <div className="ot-panel ot-panel--empty rc-detail rc-detail--empty">
        <EmptyState icon={FileText} title="No receipt selected">Select a receipt to review.</EmptyState>
      </div>
    );
  }

  const canAct = claim.status === 'pending';

  return (
    <div className="ot-panel rc-detail">
      <div className="ot-panel__head rc-detail__header">
        <div className="ot-panel__titles">
          <h2 className="ot-panel__title">Receipt review</h2>
          <p className="ot-panel__id">{claim.id?.slice(0, 8)}…</p>
        </div>
        <StatusBadge status={claim.status} />
        <Button variant="outline" size="sm" icon={ExternalLink} onClick={() => onNavigateClaims?.(claim.id)} title="View in Claims">
          Claims
        </Button>
      </div>

      {/* Receipt photo */}
      <div className="rc-detail__photo-wrap">
        {photoSrc ? (
          <>
            <img
              src={photoSrc}
              alt="Receipt"
              className="rc-detail__photo"
              onClick={() => setLightbox(true)}
              title="Click to enlarge"
            />
            <div className="rc-detail__photo-hint">
              <Maximize2 size={11} aria-hidden="true" />
              Click to enlarge
            </div>
          </>
        ) : (
          <div className="rc-detail__photo-empty">
            <span className="rc-detail__photo-icon"><FileText size={20} aria-hidden="true" /></span>
            <span className="rc-detail__photo-title">{claim.receipt_photo_path ? 'Loading photo…' : 'No receipt photo'}</span>
            {!claim.receipt_photo_path && (
              <span className="rc-detail__photo-sub">Submitted before photo capture was enabled</span>
            )}
          </div>
        )}
      </div>

      <div className="rc-detail__body">
        {/* AI check from Claude */}
        <AiVerdictPanel claim={claim} />

        {/* Claim details */}
        <div className="rc-detail__rows">
          <p className="ot-panel__label">Claimant</p>
          <div className="ot-kv">
            <div className="ot-kv__row">
              <span className="ot-kv__label">Name</span>
              <span className="ot-kv__val">{claim.user?.display_name || 'Unknown'}</span>
            </div>
            {claim.user?.email && (
              <div className="ot-kv__row">
                <span className="ot-kv__label">Email</span>
                <span className="ot-kv__val ot-kv__val--muted">{claim.user.email}</span>
              </div>
            )}
            <div className="ot-kv__row">
              <span className="ot-kv__label">Payout</span>
              <span className="ot-kv__val ot-kv__val--muted">Tikkie link</span>
            </div>
          </div>

          <p className="ot-panel__label rc-detail__label-gap">Claim</p>
          <div className="ot-kv">
            <div className="ot-kv__row">
              <span className="ot-kv__label">Type</span>
              <span className="ot-kv__val rc-detail__capital">{claim.type?.replace('_', ' ')}</span>
            </div>
            <div className="ot-kv__row">
              <span className="ot-kv__label">Cups spent</span>
              <span className="ot-kv__val ot-kv__val--strong">{claim.cups_redeemed ?? '—'}</span>
            </div>
            <div className="ot-kv__row">
              <span className="ot-kv__label">Payout</span>
              <span className="ot-kv__val ot-kv__val--money">{money(claim.payout_amount || 0)}</span>
            </div>
            <div className="ot-kv__row">
              <span className="ot-kv__label">Submitted</span>
              <span className="ot-kv__val ot-kv__val--muted">{formatDate(claim.created_at)}</span>
            </div>
            <div className="ot-kv__row">
              <span className="ot-kv__label">Claim ID</span>
              <span className="ot-kv__val ot-kv__val--mono">{claim.id}</span>
            </div>
            {claim.approver && (
              <div className="ot-kv__row">
                <span className="ot-kv__label">
                  {claim.status === 'completed' ? 'Approved by' : 'Decided by'}
                </span>
                <span className="ot-kv__val">
                  {claim.approver.display_name || claim.approver.email.split('@')[0]}
                  {claim.approved_at && (
                    <span className="ot-kv__meta">
                      · {new Date(claim.approved_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Actions */}
      {canAct && (
        <div className="rc-detail__actions">
          <p className="rc-detail__actions-hint">Check the receipt matches the claim before approving.</p>
          <div className="rc-detail__btns">
            <PermissionGate action="claim.approve">
              <Button variant="danger-ghost" icon={X} className="rc-detail__btn--reject" disabled={updating} onClick={() => onFail(claim.id)}>
                Reject
              </Button>
            </PermissionGate>
            <PermissionGate action="claim.approve">
              <Button variant="primary" icon={Check} disabled={updating} onClick={() => onApprove(claim.id)}>
                Approve & pay
              </Button>
            </PermissionGate>
          </div>
        </div>
      )}

      <Lightbox src={lightbox ? photoSrc : null} alt="Receipt enlarged" onClose={() => setLightbox(false)} />
    </div>
  );
}

export default function AdminReceiptCheck({ onNavigate }) {
  const { money } = useAdminMoney();
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

  async function handleDecide(claimId, newStatus) {
    setUpdating(true); setError(null);
    try {
      const before = claims.find(c => c.id === claimId);
      const updated = await updateClaimStatus(claimId, newStatus);
      setClaims(prev => prev.map(c => c.id === claimId ? { ...c, ...updated } : c));
      logAction({
        action: newStatus === 'completed' ? 'claim.approve' : 'claim.reject',
        targetType: 'claim',
        targetId: claimId,
        before: { status: before?.status },
        after:  { status: newStatus },
        metadata: {
          surface: 'receipt_check',
          payout_amount: before?.payout_amount,
        },
      });
    } catch (e) {
      const msg = e?.message || '';
      setError(msg.includes('claims_status_check')
        ? 'DB constraint error — run the fix SQL from the Publish error bar.'
        : msg || 'Update failed.');
    } finally { setUpdating(false); }
  }
  const handleApprove = id => handleDecide(id, 'completed');
  const handleFail    = id => handleDecide(id, 'failed');

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
  const withPhoto = claims.filter(c => c.receipt_photo_url || c.receipt_photo_path).length;
  const totalPayout = claims.filter(c => c.status === 'completed').reduce((s, c) => s + (c.payout_amount || 0), 0);

  const selectedClaim = claims.find(c => c.id === selectedId) || null;

  const sort = { key: sortKey, dir: sortDir };

  return (
    <div className="ui-page admin-receipt-check">
      <PageHeader
        title="Receipt check"
        subtitle={`${counts.pending} pending · ${counts.completed} approved · ${counts.failed} rejected · ${withPhoto}/${claims.length} with photo · ${money(totalPayout)} paid out`}
      >
        <Button variant="outline" icon={FileText} onClick={() => onNavigate?.('claims')}>
          View all claims
        </Button>
      </PageHeader>

      {error && <Notice tone="danger" onDismiss={() => setError(null)}>{error}</Notice>}

      <div className="ot-toolbar">
        <Segmented ariaLabel="Filter by status" value={statusFilter} onChange={setStatus} options={STATUS_OPTIONS} />
        <SearchBox className="rc-search" value={search} onChange={setSearch} placeholder="Search user, email, ID" label="Search receipts" />
      </div>

      <div className="rc-layout">
        <div className="ui-card ot-table-card">
          {loading ? (
            <Spinner label="Loading receipts…" />
          ) : (
            <table className="ui-table rc-table">
              <thead>
                <tr>
                  <th style={{ width: 64 }}>Receipt</th>
                  <th>User</th>
                  <SortTh label="Payout" field="payout_amount" sort={sort} onSort={handleSort} />
                  <SortTh label="Cups" field="cups_redeemed" sort={sort} onSort={handleSort} className="ot-center" />
                  <SortTh label="Status" field="status" sort={sort} onSort={handleSort} />
                  <SortTh label="Submitted" field="created_at" sort={sort} onSort={handleSort} />
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={6}><EmptyState icon={FileText} title="No receipts found" /></td></tr>
                ) : filtered.map(claim => (
                  <tr key={claim.id}
                    className={`ot-row${selectedId === claim.id ? ' ot-row--active' : ''}`}
                    onClick={() => setSelectedId(claim.id)}
                  >
                    <td>
                      <ReceiptThumb url={claim.receipt_photo_url} path={claim.receipt_photo_path} />
                    </td>
                    <td>
                      <div className="ot-person">
                        <Avatar name={claim.user?.display_name} seed={claim.user_id || claim.id} size={28} />
                        <div className="ot-person__text">
                          <span className="ot-person__name">{claim.user?.display_name || 'Unknown'}</span>
                          {claim.user?.email && <span className="ot-person__sub">{claim.user.email}</span>}
                        </div>
                      </div>
                    </td>
                    <td className="ot-num">{money(claim.payout_amount || 0)}</td>
                    <td className="ot-center ot-num">{claim.cups_redeemed ?? '—'}</td>
                    <td><StatusBadge status={claim.status} /></td>
                    <td className="ot-date">{formatDateShort(claim.created_at)}</td>
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
