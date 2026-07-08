import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { getAdminClaims, updateClaimStatus, markClaim, getReceiptSignedUrl, deleteRecords, refreshTikkieStatus } from '../lib/adminApi';
import Spinner from '../lib/Spinner';
import PermissionGate from '../auth/PermissionGate';
import { useAuth, hasPermission } from '../auth/AuthContext';
import { logAction } from '../auth/actionLog';
import ClaimDetailPanel from './ClaimDetailPanel';
import PiiMask from '../shared/PiiMask';
import ClaimStatusPills, { ClaimStatusPill } from '../shared/ClaimStatusPills';
import EmptyState from '../shared/EmptyState';
import QuickLinks from '../shared/QuickLinks';
import ColumnPicker from '../shared/ColumnPicker';
import './AdminClaims.css';

/* Compact receipt thumbnail used in the table. Resolves a signed URL on
 * mount for claims that store the photo in private storage; falls back to
 * the legacy inline data-URL (receipt_photo_url) for older rows. Clicking
 * the thumb opens a full-size lightbox via the `onZoom` callback. */
function ReceiptThumb({ claim, onZoom }) {
  const [signed, setSigned] = useState(null);
  useEffect(() => {
    let cancelled = false;
    // Skip fetching the signed URL when the image is hidden — we won't
    // render it anyway and there's no reason to spend storage RPS on it.
    if (claim.image_hidden) return;
    if (!claim.receipt_photo_url && claim.receipt_photo_path) {
      getReceiptSignedUrl(claim.receipt_photo_path, 600).then(u => {
        if (!cancelled) setSigned(u);
      });
    }
    return () => { cancelled = true; };
  }, [claim.receipt_photo_url, claim.receipt_photo_path, claim.image_hidden]);

  // Hidden variant — preempts the photo render entirely so admins
  // browsing the table never see an inappropriate / PII-leaking image
  // by accident. The tone depends on whether AI hid it (red) or an
  // admin did (amber).
  if (claim.image_hidden) {
    const isAiHidden = !claim.image_hidden_by;
    return (
      <div
        className={`ac-thumb ac-thumb--hidden ${isAiHidden ? 'ac-thumb--hidden-ai' : 'ac-thumb--hidden-admin'}`}
        title={isAiHidden
          ? `Hidden — inappropriate (${(claim.image_hidden_reason || 'auto').replace(/^ai_/, '')})`
          : `Hidden by admin: ${(claim.image_hidden_reason || '').replace(/^admin:\s*/, '') || 'no reason'}`}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
          <line x1="1" y1="1" x2="23" y2="23"/>
        </svg>
        <span className="ac-thumb__hidden-label">
          {isAiHidden ? 'Hidden' : 'Hidden'}
        </span>
      </div>
    );
  }

  const src = claim.receipt_photo_url || signed;

  if (!src) {
    return (
      <div className="ac-thumb ac-thumb--empty" title="No photo">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#C8C4BC" strokeWidth="1.5">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
      </div>
    );
  }
  return (
    <button
      className="ac-thumb"
      onClick={e => { e.stopPropagation(); onZoom?.(src); }}
      title="Click to enlarge"
    >
      <img src={src} alt="Receipt" />
    </button>
  );
}

/* Modal showing the full AI check for one claim. Opens when the verdict
 * chip in the table is clicked. Rendered via portal so the fixed overlay
 * escapes any transformed ancestors. */
function AiVerdictModal({ claim, onClose }) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose?.(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!claim) return null;

  const checks = [
    { key: 'is_receipt',                 label: 'Is a receipt',          passed: claim.ai_is_receipt },
    { key: 'is_authentic_burger_king',   label: 'Authentic Burger King', passed: claim.ai_is_burger_king },
    { key: 'contains_required_item',     label: 'Contains reward item',  passed: claim.ai_contains_required_item },
  ];
  const failed = claim.ai_failure_checks || [];
  const isDup = failed.includes('duplicate_receipt');
  // A claim is "verified" if the function actually wrote a verdict — keyed on
  // verified_at, which is set unconditionally after every Anthropic call.
  // (Older check looked at ai_confidence, which the model sometimes omits.)
  const noVerdict = !claim.verified_at;
  // Mirror the threshold used by ClaimDetailPanel — keep the modal,
  // the table chip, and the detail panel all aligned on what counts
  // as "trustworthy enough to surface as passed".
  const conf = claim.ai_confidence || 0;
  const lowConfidence = conf < 0.50;
  const rawAllPassed = !noVerdict && failed.length === 0 && !isDup;
  const needsManualReview = rawAllPassed && lowConfidence;

  return createPortal(
    <div className="ac-verdict-overlay" onClick={onClose}>
      <div className="ac-verdict-modal" onClick={e => e.stopPropagation()}>
        <button className="ac-verdict-close" onClick={onClose} aria-label="Close">×</button>

        <div className="ac-verdict-header">
          <span className="ac-verdict-eyebrow">AI check</span>
          {!noVerdict && (
            <span className="ac-verdict-confidence">
              {Math.round((claim.ai_confidence || 0) * 100)}% confident
            </span>
          )}
        </div>

        {noVerdict ? (
          <p className="ac-verdict-empty">This claim hasn't been verified yet.</p>
        ) : (
          <>
            {needsManualReview && (
              <div className="ac-verdict-override">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span>
                  <strong>Needs manual review.</strong> The model passed every check but is
                  only {Math.round(conf * 100)}% sure. Confirm against the receipt before approving.
                </span>
              </div>
            )}
            <div className="ac-verdict-checks">
              {checks.map(c => (
                <div key={c.key} className={`ac-verdict-check ac-verdict-check--${c.passed === true ? 'pass' : c.passed === false ? 'fail' : 'skip'}`}>
                  <span className="ac-verdict-check__dot">
                    {c.passed === true ? '✓' : c.passed === false ? '✕' : '–'}
                  </span>
                  <span className="ac-verdict-check__label">{c.label}</span>
                  <span className="ac-verdict-check__state">
                    {c.passed === true ? 'passed' : c.passed === false ? 'failed' : 'skipped'}
                  </span>
                </div>
              ))}
              {isDup && (
                <div className="ac-verdict-check ac-verdict-check--fail">
                  <span className="ac-verdict-check__dot">✕</span>
                  <span className="ac-verdict-check__label">Not a duplicate</span>
                  <span className="ac-verdict-check__state">failed</span>
                </div>
              )}
            </div>

            {(claim.ai_required_item || claim.extracted_total_eur != null || claim.extracted_receipt_id || claim.extracted_datetime) && (
              <div className="ac-verdict-extracted">
                {claim.ai_required_item && (
                  <div className="ac-verdict-row"><span>Required item</span><strong>{claim.ai_required_item}</strong></div>
                )}
                {claim.extracted_total_eur != null && (
                  <div className="ac-verdict-row"><span>Receipt total</span><strong>€{Number(claim.extracted_total_eur).toFixed(2)}</strong></div>
                )}
                {claim.extracted_receipt_id && (
                  <div className="ac-verdict-row"><span>Receipt #</span><strong className="ac-mono">{claim.extracted_receipt_id}</strong></div>
                )}
                {claim.extracted_datetime && (
                  <div className="ac-verdict-row"><span>Receipt date</span><strong>{new Date(claim.extracted_datetime).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</strong></div>
                )}
              </div>
            )}

            {claim.ai_reason && (
              <div className="ac-verdict-reason">
                <span className="ac-verdict-reason__label">Why</span>
                <span className="ac-verdict-reason__text">{claim.ai_reason}</span>
              </div>
            )}

            {claim.ai_verdict?.items?.length > 0 && (
              <details className="ac-verdict-items">
                <summary>Extracted line items ({claim.ai_verdict.items.length})</summary>
                <ul>
                  {claim.ai_verdict.items.map((it, i) => (
                    <li key={i}>
                      {it.qty}× {it.name}
                      {it.price_eur != null && ` — €${Number(it.price_eur).toFixed(2)}`}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

/* Fullscreen lightbox for the receipt photo, opened when a thumb is clicked.
 * Rendered via portal so it covers the viewport, not the panel. */
function ReceiptLightbox({ src, onClose }) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose?.(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  if (!src) return null;
  return createPortal(
    <div className="ac-lightbox" onClick={onClose}>
      <button className="ac-lightbox__close" onClick={e => { e.stopPropagation(); onClose(); }}>×</button>
      <img src={src} alt="Receipt enlarged" className="ac-lightbox__img" onClick={e => e.stopPropagation()} />
    </div>,
    document.body,
  );
}

function formatDate(ts) {
  if (!ts) return '—';
  // Compact "13 May, 12:16" — fits in a narrow column without scroll.
  // Year is dropped because all visible claims are this year; full timestamp
  // is still available in the AI check modal.
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    + ', ' + new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

const STATUS_OPTIONS = ['all', 'pending', 'completed', 'failed'];
const SORT_KEYS = ['created_at', 'cups_redeemed', 'payout_amount', 'status'];

/* Toggleable columns for the Claims table. The four non-toggleable
 * columns (checkbox, User, Date, Actions) live outside this list —
 * they're always shown because the row would be unintelligible
 * without them.
 *
 * The Receipt thumbnail column USED to be non-toggleable; we made it
 * toggleable so admins reviewing pending claims on a smaller laptop
 * can hide the picture column when they don't need to see the photo
 * in the row (e.g. when they're using the right-pane Review mode and
 * the photo shows up there anyway). */
const COLUMN_CONFIG = [
  { id: 'receipt',    label: 'Receipt',      desc: 'Thumbnail of the uploaded receipt image',                          defaultOn: true  },
  { id: 'validation', label: 'Validation',  desc: 'AI verdict on the receipt (combined with the old AI check column)', defaultOn: true  },
  { id: 'reward',     label: 'Reward / Type', desc: 'Which reward the customer picked, or "Direct refund"',           defaultOn: false },
  { id: 'cups',       label: 'Cups',        desc: 'Cups spent on this claim',                                          defaultOn: false },
  { id: 'amount',     label: 'Amount',      desc: 'Euro payout amount',                                                defaultOn: true  },
  { id: 'tikkie',     label: 'Tikkie status', desc: 'Tikkie link stage — Created / Redeemed / Expired (click for the timeline)', defaultOn: true  },
  { id: 'review',     label: 'Review',      desc: 'Pending / Approved / Rejected',                                     defaultOn: true  },
  { id: 'decided_by', label: 'Decided by',  desc: 'Admin who made the call',                                           defaultOn: true  },
];
const DEFAULT_VISIBLE_COLS = COLUMN_CONFIG.filter(c => c.defaultOn).map(c => c.id);

function SortIcon({ active, dir }) {
  return (
    <span className={`ac-sort-icon${active ? ' ac-sort-icon--active' : ''}`}>
      {active ? (dir === 'asc' ? '↑' : '↓') : '↕'}
    </span>
  );
}

function ReceiptChip({ claim, onClick }) {
  // Wrap as a button when clickable so the cursor + a11y are right.
  const Wrapper = ({ className, title, children }) => (
    <button
      type="button"
      className={`${className} ac-receipt-chip--clickable`}
      title={title}
      onClick={e => { e.stopPropagation(); onClick?.(claim); }}
    >
      {children}
    </button>
  );

  if (claim.type === 'direct_refund') {
    return <span className="ac-receipt-chip ac-receipt-chip--na">N/A</span>;
  }
  if (claim.ai_confidence == null) {
    return (
      <Wrapper
        className="ac-receipt-chip ac-receipt-chip--neutral"
        title="No verdict yet — click for details"
      >
        — Not checked
      </Wrapper>
    );
  }
  const failed = claim.ai_failure_checks || [];
  const conf = claim.ai_confidence || 0;
  // Mirror the threshold used by ClaimDetailPanel.AiVerdictPanel — keep
  // the two in sync so the table chip and the detail panel never tell
  // the admin contradictory stories.
  const lowConfidence = conf < 0.50;
  if (failed.length === 0) {
    // "All three checks came back true" but Claude itself is hedging.
    // Surface that as an amber "uncertain" pill instead of a green
    // pass — the admin needs to look at the receipt before approving.
    if (lowConfidence) {
      return (
        <Wrapper
          className="ac-receipt-chip ac-receipt-chip--uncertain"
          title={`AI marked all checks pass but is only ${Math.round(conf * 100)}% confident — needs manual review`}
        >
          ⚠ Needs review
        </Wrapper>
      );
    }
    return (
      <Wrapper
        className="ac-receipt-chip ac-receipt-chip--valid"
        title={`All 3 checks passed (${Math.round(conf * 100)}% confident) — click for details`}
      >
        ✓ Passed
      </Wrapper>
    );
  }
  const labelMap = {
    is_receipt: 'not a receipt',
    is_authentic_burger_king: 'not real BK',
    contains_required_item: 'wrong item',
    duplicate_receipt: 'duplicate',
  };
  const first = labelMap[failed[0]] || 'Flagged';
  return (
    <Wrapper
      className="ac-receipt-chip ac-receipt-chip--invalid"
      title={`${claim.ai_reason || failed.join(', ')} — click for details`}
    >
      ✕ {first}
    </Wrapper>
  );
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
  // Detail-modal state: which claim's verdict is open, which receipt is being lightboxed.
  const [verdictOpenClaim, setVerdictOpenClaim] = useState(null);
  const [lightboxSrc, setLightboxSrc] = useState(null);
  /* ── View mode ────────────────────────────────────────────────────
   * 'table'  — full-width sortable table for bulk operations.
   * 'review' — split-pane: compact table on the left + per-claim
   *            detail panel (photo + AI check + actions) on the right.
   * The selected-row id is shared between modes so flipping the toggle
   * keeps the user on the same record. */
  const [viewMode, setViewMode] = useState('table');
  const [selectedId, setSelectedId] = useState(null);
  const [tikkieModal, setTikkieModal] = useState(null); // claim whose Tikkie timeline is open

  /* Column visibility (user-toggleable).
   *
   * The Claims table used to surface every claim attribute in a wide
   * row that overflowed laterally on most displays. We split the
   * old combined status pill into three discrete columns
   * (Validation, Review, Payout) and gate the noisiest columns
   * behind a header chooser so each admin can shape the view to
   * their job:
   *
   *   • Always-on (not toggleable): checkbox, Receipt, User, Date, Actions
   *   • On by default: Validation, Amount, Tikkie, Review, Payout, Decided by
   *   • Off by default: Reward / Type, Cups
   *
   * Hidden columns persist in localStorage so an admin's chosen view
   * survives reloads. */
  const [visibleCols, setVisibleCols] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_VISIBLE_COLS;
    try {
      const raw = localStorage.getItem('pp_admin_claims_cols');
      if (raw) {
        const parsed = JSON.parse(raw);
        return new Set(parsed);
      }
    } catch { /* ignore parse failures */ }
    return new Set(DEFAULT_VISIBLE_COLS);
  });
  useEffect(() => {
    try {
      localStorage.setItem('pp_admin_claims_cols', JSON.stringify([...visibleCols]));
    } catch { /* quota / private-mode failure — fine, we just don't persist */ }
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

  const [deleting, setDeleting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const reloadClaims = () => {
    setLoading(true);
    getAdminClaims().then(setClaims).catch(console.error).finally(() => setLoading(false));
  };
  useEffect(() => { reloadClaims(); }, []);

  async function handleBulkDelete() {
    setDeleting(true);
    setActionError(null);
    try {
      await deleteRecords('claims', [...selected]);
      setSelected(new Set());
      setDeleteConfirm(false);
      reloadClaims();
    } catch (err) {
      console.error('Bulk claim delete failed:', err);
      setActionError(err?.message || 'Delete failed.');
    } finally {
      setDeleting(false);
    }
  }

  function handleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  }

  /* Toggle the admin "mark for a second look" flag on a claim. Optimistic:
   * we flip the row immediately, then reconcile with the DB write. On
   * failure we roll the row back and surface the error. */
  async function handleFlag(claimId, flagged) {
    setClaims(prev => prev.map(c => c.id === claimId ? { ...c, flagged } : c));
    try {
      const updated = await markClaim(claimId, flagged);
      setClaims(prev => prev.map(c => c.id === claimId ? { ...c, ...updated } : c));
    } catch (err) {
      setClaims(prev => prev.map(c => c.id === claimId ? { ...c, flagged: !flagged } : c));
      setActionError(err.message || 'Could not update the flag.');
    }
  }

  async function handleStatusUpdate(claimId, newStatus, reason = '') {
    setUpdating(claimId);
    setActionError(null);
    try {
      const before = claims.find(c => c.id === claimId);
      const updated = await updateClaimStatus(claimId, newStatus, reason);
      // Merge in the approver reference for instant UI feedback.
      setClaims(prev => prev.map(c => c.id === claimId ? { ...c, ...updated } : c));

      /* AI human-override detection (P-13).
       *
       * Compares the admin's decision against what the AI check
       * implied. If they disagree we mark the row as a human override
       * in the audit metadata — useful both for the audit trail and as
       * a future training signal ("here are the claims the model got
       * wrong"). The four-way truth table:
       *
       *   AI all-passed + human approved → no override
       *   AI all-passed + human rejected → override (false positive)
       *   AI failed     + human approved → override (false negative)
       *   AI failed     + human rejected → no override
       *
       * Low-confidence "uncertain" verdicts are NOT counted as override
       * either way — the admin was supposed to make a manual call.
       */
      const aiFailedChecks = before?.ai_failure_checks || [];
      const aiAllPassed = before?.verified_at && aiFailedChecks.length === 0;
      const aiAnyFailed = before?.verified_at && aiFailedChecks.length > 0;
      const aiConfident = (before?.ai_confidence ?? 0) >= 0.50;
      let humanOverride = false;
      let overrideKind = null;
      if (aiConfident && aiAllPassed && newStatus === 'failed') {
        humanOverride = true; overrideKind = 'rejected_ai_pass'; // false positive
      } else if (aiConfident && aiAnyFailed && newStatus === 'completed') {
        humanOverride = true; overrideKind = 'approved_ai_fail'; // false negative
      }

      // Audit log — non-blocking; failures are swallowed inside logAction.
      // Reason goes into metadata so we can answer "why was this approved
      // at 0% AI confidence" or "why was this rejected" months later.
      logAction({
        action: newStatus === 'completed' ? 'claim.approve' : 'claim.reject',
        targetType: 'claim',
        targetId: claimId,
        before: { status: before?.status },
        after:  { status: newStatus },
        metadata: {
          reward_id: before?.reward_id,
          payout_amount: before?.payout_amount,
          cups_redeemed: before?.cups_redeemed,
          reason: reason || null,
          ai_confidence: before?.ai_confidence ?? null,
          ai_failure_checks: aiFailedChecks,
          human_override: humanOverride,
          override_kind: overrideKind,
        },
      });
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

  /* Confirm-modal state for bulk actions (P-45). Keeping it next to the
   * single-claim DecisionModal so both flows share the same audit
   * pattern: reason → modal → submit → action log row per claim. */
  const [bulkConfirm, setBulkConfirm] = useState(null);
  // null when closed; { newStatus: 'completed' | 'failed' } when open.

  async function runBulkAction(newStatus, reason) {
    setBulkUpdating(true);
    setActionError(null);
    const ids = [...selected].filter(id => {
      const claim = claims.find(c => c.id === id);
      return claim?.status === 'pending';
    });
    try {
      // Pass the shared reason to every update so it lands on every
      // claim row's approval_note. Same string is reused as the
      // explanation in the bulk audit log too — explicit is better
      // than guessing per-claim reasons after the fact.
      const updateds = await Promise.all(ids.map(id => updateClaimStatus(id, newStatus, reason)));
      const byId = Object.fromEntries(updateds.map(u => [u.id, u]));
      setClaims(prev => prev.map(c => byId[c.id] ? { ...c, ...byId[c.id] } : c));
      // Fire one audit-log row per claim. They're concurrent-safe; no need to await.
      ids.forEach(id => {
        const before = claims.find(c => c.id === id);
        logAction({
          action: newStatus === 'completed' ? 'claim.approve' : 'claim.reject',
          targetType: 'claim',
          targetId: id,
          before: { status: before?.status },
          after:  { status: newStatus },
          metadata: {
            bulk: true,
            bulk_size: ids.length,
            reason: reason || null,
            payout_amount: before?.payout_amount,
          },
        });
      });
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
            <span className="ac-chip ac-chip--completed">{counts.completed} Approved</span>
            <span className="ac-chip ac-chip--failed">{counts.failed} Rejected</span>
          </p>
        </div>

        {/* View-mode toggle. The "Table" mode is the historic full-width
         *  layout optimised for bulk operations; "Review" splits the
         *  page into a compact list + the per-claim photo / AI check
         *  panel (formerly the standalone Receipt Check tab). */}
        <div className="ac-viewmode" role="tablist" aria-label="Claims view mode">
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'table'}
            className={`ac-viewmode__btn${viewMode === 'table' ? ' ac-viewmode__btn--active' : ''}`}
            onClick={() => setViewMode('table')}
            title="Bulk table view"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="6" x2="21" y2="6"/>
              <line x1="3" y1="12" x2="21" y2="12"/>
              <line x1="3" y1="18" x2="21" y2="18"/>
            </svg>
            Table
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'review'}
            className={`ac-viewmode__btn${viewMode === 'review' ? ' ac-viewmode__btn--active' : ''}`}
            onClick={() => {
              setViewMode('review');
              // When entering review mode for the first time, auto-select
              // the first pending claim so the right pane isn't empty.
              if (!selectedId) {
                const firstPending = filtered.find(c => c.status === 'pending');
                if (firstPending) setSelectedId(firstPending.id);
              }
            }}
            title="Single-claim review with photo + AI check"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="8" height="18"/>
              <rect x="13" y="3" width="8" height="18"/>
            </svg>
            Review
          </button>
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
            placeholder="Search user, email, claim ID…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        {/* Column picker — shared component, same dropdown is now used
         *  on the Cup Scans table too. State + storage stay local so
         *  each table persists its own column choices. */}
        <ColumnPicker
          columns={COLUMN_CONFIG}
          visible={visibleCols}
          onToggle={toggleCol}
          onReset={() => setVisibleCols(new Set(DEFAULT_VISIBLE_COLS))}
        />
      </div>

      {/* Bulk actions bar */}
      {selected.size > 0 && (
        <div className="ac-bulk-bar">
          <span className="ac-bulk-bar__count">{selected.size} selected</span>
          {selectedPending.length > 0 && (
            <>
              <button className="ac-bulk-btn ac-bulk-btn--complete"
                disabled={bulkUpdating}
                onClick={() => setBulkConfirm({ newStatus: 'completed' })}>
                ✓ Approve {selectedPending.length}
              </button>
              <button className="ac-bulk-btn ac-bulk-btn--fail"
                disabled={bulkUpdating}
                onClick={() => setBulkConfirm({ newStatus: 'failed' })}>
                ✕ Reject {selectedPending.length}
              </button>
            </>
          )}
          {!deleteConfirm ? (
            <button className="ac-bulk-btn ac-bulk-btn--fail"
              disabled={deleting}
              onClick={() => setDeleteConfirm(true)}
              title="Permanently delete the selected claims">
              🗑 Delete {selected.size}
            </button>
          ) : (
            <>
              <span className="ac-bulk-bar__count" style={{ color: '#FCA5A5' }}>
                ⚠️ Permanently delete {selected.size} claim{selected.size === 1 ? '' : 's'}? Can’t be undone.
              </span>
              <button className="ac-bulk-btn ac-bulk-btn--fail" disabled={deleting} onClick={handleBulkDelete}>
                {deleting ? 'Deleting…' : 'Confirm delete'}
              </button>
              <button className="ac-bulk-btn ac-bulk-btn--clear" disabled={deleting} onClick={() => setDeleteConfirm(false)}>
                Cancel
              </button>
            </>
          )}
          <button className="ac-bulk-btn ac-bulk-btn--clear" onClick={() => { setSelected(new Set()); setDeleteConfirm(false); }}>
            Clear
          </button>
        </div>
      )}

      <div className={`ac-layout${viewMode === 'review' ? ' ac-layout--review' : ''}`}>
        <div className="ac-table-wrap">
          {loading ? (
            <Spinner label="Loading claims…" />
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
                  {isCol('receipt') && <th style={{ width: 50 }}>Receipt</th>}
                  <ThCol label="User" />
                  {isCol('validation') && <ThCol label="Validation" />}
                  {isCol('reward')    && <ThCol label="Reward / Type" />}
                  {isCol('cups')      && <ThCol label="Cups" sortable field="cups_redeemed" />}
                  {isCol('amount')    && <ThCol label="Amount" sortable field="payout_amount" />}
                  {isCol('tikkie')    && <ThCol label="Tikkie status" />}
                  <ThCol label="Date" sortable field="created_at" />
                  {isCol('review')    && <ThCol label="Review" sortable field="status" />}
                  {isCol('decided_by') && <ThCol label="Decided by" />}
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  // 4 fixed cols (checkbox, User, Date, Actions) + the
                  // toggleable ones still on. Was 5 before Receipt
                  // became toggleable.
                  <tr><td colSpan={4 + visibleCols.size} className="ac-table__empty">
                    {claims.length === 0 ? (
                      <EmptyState
                        icon={
                          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                            <line x1="16" y1="13" x2="8" y2="13" />
                            <line x1="16" y1="17" x2="8" y2="17" />
                          </svg>
                        }
                        title="No claims yet"
                        body="Claims arrive here when customers submit a cashback receipt or cash-out request. You'll review the AI verdict + the photo before approving payout."
                        tone="action"
                        secondaryAction={{ label: 'See how claims work', onClick: () => onNavigate?.('support') }}
                      />
                    ) : (
                      <EmptyState
                        icon={
                          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="11" cy="11" r="8" />
                            <line x1="21" y1="21" x2="16.65" y2="16.65" />
                          </svg>
                        }
                        title="No claims match these filters"
                        body={`${claims.length} claim${claims.length === 1 ? '' : 's'} in total — broaden the status or clear the search.`}
                        secondaryAction={{
                          label: 'Reset filters',
                          onClick: () => { setStatus('all'); setSearch(''); },
                        }}
                      />
                    )}
                  </td></tr>
                ) : filtered.map(claim => {
                  const rewardName = getRewardName(claim);
                  const rewardObj  = rewards.find(r => r.id === claim.reward_id);
                  return (
                    <tr
                      key={claim.id}
                      className={[
                        'ac-table__row',
                        selected.has(claim.id) ? 'ac-table__row--selected' : '',
                        viewMode === 'review' && selectedId === claim.id ? 'ac-table__row--active' : '',
                        claim.flagged ? 'ac-table__row--flagged' : '',
                      ].filter(Boolean).join(' ')}
                      onClick={() => viewMode === 'review' && setSelectedId(claim.id)}
                      style={viewMode === 'review' ? { cursor: 'pointer' } : undefined}
                    >
                      <td style={{ padding: '0 8px 0 16px' }} onClick={e => e.stopPropagation()}>
                        <input type="checkbox"
                          className="ac-checkbox"
                          checked={selected.has(claim.id)}
                          onChange={() => toggleSelect(claim.id)}
                        />
                      </td>
                      {isCol('receipt') && (
                        <td style={{ padding: '6px 8px 6px 0' }}>
                          <ReceiptThumb claim={claim} onZoom={setLightboxSrc} />
                        </td>
                      )}
                      <td>
                        <div className="ac-user-cell">
                          <div className="ac-user-avatar">
                            {(claim.user?.display_name || '?')[0].toUpperCase()}
                          </div>
                          <div className="ac-user-info">
                            <span className="ac-user-name">{claim.user?.display_name || 'Unknown'}</span>
                            <span className="ac-user-email" onClick={e => e.stopPropagation()}>
                              {claim.user?.email
                                ? <PiiMask type="email" value={claim.user.email} targetType="claim" targetId={claim.id} inline />
                                : '—'}
                            </span>
                          </div>
                        </div>
                      </td>
                      {/* Validation column — combines the old "AI check"
                       *  chip with the validation half of the old
                       *  three-pill status cluster. Click opens the
                       *  full AI verdict modal. */}
                      {isCol('validation') && (
                        <td onClick={e => e.stopPropagation()}>
                          <ReceiptChip claim={claim} onClick={setVerdictOpenClaim} />
                        </td>
                      )}
                      {isCol('reward') && (
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
                      )}
                      {isCol('cups')   && <td className="ac-center ac-bold">{claim.cups_redeemed ?? '—'}</td>}
                      {isCol('amount') && <td className="ac-bold">€{(claim.payout_amount || 0).toFixed(2)}</td>}
                      {isCol('tikkie') && (
                        <td onClick={e => e.stopPropagation()}>
                          {(() => {
                            const meta = tikkieStatusOf(claim);
                            // Not approved yet → no Tikkie link → empty cell.
                            return meta ? (
                              <button
                                type="button"
                                className="ac-tikkie-status"
                                style={{ background: meta.bg, color: meta.color }}
                                onClick={() => setTikkieModal(claim)}
                                title="View the Tikkie link status timeline"
                              >
                                {meta.label}
                              </button>
                            ) : null;
                          })()}
                        </td>
                      )}
                      <td className="ac-muted ac-date">{formatDate(claim.created_at)}</td>
                      {isCol('review') && <td><ClaimStatusPill kind="review" claim={claim} /></td>}
                      {isCol('decided_by') && (
                        <td>
                          {claim.approver ? (
                            <span className="ac-approver" title={`${claim.approver.email}\n${claim.approved_at ? new Date(claim.approved_at).toLocaleString('en-GB') : ''}`}>
                              <span className="ac-approver__avatar" style={{ background: claim.approver.color || '#FD6F46' }}>
                                {claim.approver.avatar_url
                                  ? <img src={claim.approver.avatar_url} alt="" />
                                  : (claim.approver.display_name || claim.approver.email)[0].toUpperCase()}
                              </span>
                              <span className="ac-approver__name">
                                {claim.approver.display_name || claim.approver.email.split('@')[0]}
                              </span>
                            </span>
                          ) : (
                            <span className="ac-muted">—</span>
                          )}
                        </td>
                      )}
                      <td>
                        {claim.status === 'pending' && (
                          <div className="ac-actions" onClick={e => e.stopPropagation()}>
                            <PermissionGate action="claim.approve">
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
                            </PermissionGate>
                            <PermissionGate action="claim.approve">
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
                            </PermissionGate>
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

        {/* Right-hand review panel — only rendered in "review" view mode.
         *  Reuses the styles + structure from the old standalone Receipt
         *  Check tab, but the selected claim state is shared with the
         *  same approve/reject handlers used by the table view. */}
        {viewMode === 'review' && (
          <ClaimDetailPanel
            claim={filtered.find(c => c.id === selectedId) || null}
            updating={updating !== null}
            onApprove={(id, reason) => handleStatusUpdate(id, 'completed', reason)}
            onFail={(id, reason) => handleStatusUpdate(id, 'failed', reason)}
            onFlag={handleFlag}
            onClaimUpdate={(updated) => {
              // Merge a partial update (e.g. from hide/unhide image) back
              // into the table state so the panel + row stay in sync
              // without a full refetch.
              setClaims(prev => prev.map(c => c.id === updated.id ? { ...c, ...updated } : c));
            }}
          />
        )}
      </div>

      {verdictOpenClaim && (
        <AiVerdictModal claim={verdictOpenClaim} onClose={() => setVerdictOpenClaim(null)} />
      )}
      {lightboxSrc && (
        <ReceiptLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
      )}

      {bulkConfirm && (
        <BulkConfirmModal
          newStatus={bulkConfirm.newStatus}
          claims={selectedPending.map(id => claims.find(c => c.id === id)).filter(Boolean)}
          updating={bulkUpdating}
          onCancel={() => setBulkConfirm(null)}
          onConfirm={async (reason) => {
            const status = bulkConfirm.newStatus;
            setBulkConfirm(null);
            await runBulkAction(status, reason);
          }}
        />
      )}

      {tikkieModal && (
        <TikkieStatusModal
          claim={tikkieModal}
          onClose={() => setTikkieModal(null)}
          onRefreshed={(fields) => {
            setClaims(prev => prev.map(c => c.id === tikkieModal.id ? { ...c, ...fields } : c));
            setTikkieModal(prev => prev ? { ...prev, ...fields } : prev);
          }}
        />
      )}

      <QuickLinks currentPage="claims" onNavigate={onNavigate} />
    </div>
  );
}

/* ── Tikkie link status ──
 * The Tikkie Cashback link lifecycle (per the Tikkie Cashback API): a link is
 * CREATED when we mint it on approval, then becomes REDEEMED once the customer
 * collects the cash, or EXPIRED if the validity window passes first. Our claim
 * mirrors this in `tikkie_status`. No link (claim not approved) → empty cell. */
const TIKKIE_STATUS_META = {
  created:  { label: 'Created',  color: '#A85320', bg: '#FBEEDA' },
  redeemed: { label: 'Redeemed', color: '#1A8737', bg: '#DFF5E3' },
  expired:  { label: 'Expired',  color: '#B4463E', bg: '#FBE7E1' },
};

function tikkieStatusOf(claim) {
  if (!claim?.tikkie_url) return null;
  const s = String(claim.tikkie_status || 'created').toLowerCase();
  return TIKKIE_STATUS_META[s] || TIKKIE_STATUS_META.created;
}

function fmtWhen(d) {
  if (!d) return null;
  try { return new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  catch { return null; }
}

/* Popup timeline of a claim's Tikkie link status, plus the link itself.
 * "Refresh" pulls the live CREATED|REDEEMED|EXPIRED status from the Tikkie
 * Cashback API (via the tikkie-cashback edge function) and syncs it. */
function TikkieStatusModal({ claim, onClose, onRefreshed }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg]   = useState(null);

  const s = String(claim.tikkie_status || 'created').toLowerCase();
  const redeemed = s === 'redeemed';
  const expired  = s === 'expired';
  const createdAt  = fmtWhen(claim.notified_at || claim.approved_at || claim.verified_at);
  const redeemedAt = fmtWhen(claim.tikkie_redeemed_at);
  const expiresAt  = fmtWhen(claim.tikkie_expires_at);

  async function handleRefresh() {
    if (!claim.tikkie_cashback_id) { setMsg('No Tikkie cashback to check yet.'); return; }
    setBusy(true); setMsg(null);
    try {
      const res = await refreshTikkieStatus(claim.id);
      if (res?.error) { setMsg(res.message || res.error); }
      else {
        onRefreshed?.({
          tikkie_status: res.tikkie_status,
          tikkie_redeemed_at: res.redeemedDateTime ?? null,
          tikkie_expires_at: res.expiryDateTime ?? claim.tikkie_expires_at ?? null,
        });
        setMsg('Up to date.');
      }
    } catch (e) {
      setMsg(e?.message || 'Could not refresh.');
    } finally {
      setBusy(false);
    }
  }

  const steps = [
    {
      key: 'created', title: 'Link created', at: createdAt, done: true, current: !redeemed && !expired,
      sub: 'We minted a Tikkie cashback link and sent it to the customer.',
    },
    redeemed
      ? { key: 'redeemed', title: 'Redeemed', at: redeemedAt, done: true, current: true, tone: 'good',
          sub: 'The customer opened the link and collected the cashback.' }
      : expired
        ? { key: 'expired', title: 'Expired', at: expiresAt, done: true, current: true, tone: 'bad',
            sub: 'The link expired before it was collected. Reissue if needed.' }
        : { key: 'awaiting', title: 'Awaiting collection', at: expiresAt ? `expires ${expiresAt}` : null, done: false, current: false,
            sub: 'Waiting for the customer to open the Tikkie link.' },
  ];

  return createPortal(
    <div className="ac-tk-overlay" onClick={onClose}>
      <div className="ac-tk-modal" onClick={e => e.stopPropagation()}>
        <div className="ac-tk-head">
          <span className="ac-tk-title">Tikkie link status</span>
          <button className="ac-tk-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <ol className="ac-tk-timeline">
          {steps.map(st => (
            <li
              key={st.key}
              className={`ac-tk-step${st.done ? ' is-done' : ''}${st.current ? ' is-current' : ''}${st.tone ? ` is-${st.tone}` : ''}`}
            >
              <span className="ac-tk-dot" />
              <div className="ac-tk-body">
                <span className="ac-tk-step-title">
                  {st.title}{st.at ? <span className="ac-tk-at"> · {st.at}</span> : null}
                </span>
                <span className="ac-tk-step-sub">{st.sub}</span>
              </div>
            </li>
          ))}
        </ol>

        {claim.tikkie_url ? (
          <a className="ac-tk-link" href={claim.tikkie_url} target="_blank" rel="noopener noreferrer">
            Open Tikkie link
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
          </a>
        ) : (
          <p className="ac-tk-nolink">No Tikkie link yet — approve the claim to mint one.</p>
        )}

        {claim.tikkie_cashback_id && (
          <div className="ac-tk-refresh-row">
            <button className="ac-tk-refresh" onClick={handleRefresh} disabled={busy}>
              {busy ? 'Checking…' : 'Refresh status'}
            </button>
            {msg && <span className="ac-tk-refresh-msg">{msg}</span>}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/* ─────────────────────────────────────────────────────────────────────
 * BulkConfirmModal (P-45) — confirm + required-reason for bulk
 * approve / reject.
 *
 * Differences from the single-claim DecisionModal:
 *   • Both directions require a reason (≥3 chars), because bulk
 *     actions move many euros at once and "I just hit the button"
 *     isn't a sufficient audit story.
 *   • Approve direction shows total payout exposure so the admin sees
 *     how much money is about to leave the programme.
 *   • Lists up to 5 affected user names so admins eyeball who they're
 *     actioning before committing.
 */
function BulkConfirmModal({ newStatus, claims, updating, onCancel, onConfirm }) {
  const [reason, setReason] = useState('');
  const isReject = newStatus === 'failed';
  const canSubmit = reason.trim().length >= 3;
  const totalPayout = claims.reduce((sum, c) => sum + (c.payout_amount || 0), 0);
  const previewNames = claims.slice(0, 5).map(c => c.user?.display_name || c.user?.email?.split('@')[0] || 'Unknown');

  return (
    <div className="admin-publish-overlay" onClick={onCancel}>
      <div className="admin-publish-modal admin-publish-modal--wide" onClick={e => e.stopPropagation()}>
        <div className="admin-publish-modal__header">
          <div
            className="admin-publish-modal__icon"
            style={isReject
              ? { background: 'rgba(220,38,38,0.10)', color: '#DC2626' }
              : { background: 'rgba(22,163,74,0.12)', color: '#16A34A' }}
          >
            {isReject ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </div>
          <div>
            <h3 className="admin-publish-modal__title">
              {isReject
                ? `Reject ${claims.length} claim${claims.length === 1 ? '' : 's'}?`
                : `Approve ${claims.length} claim${claims.length === 1 ? '' : 's'}?`}
            </h3>
            <p className="admin-publish-modal__sub">
              {isReject
                ? <>The customers' reserved cups stay reserved — they can submit fresh receipts. No payouts will be sent.</>
                : <>Releases <strong>€{totalPayout.toFixed(2)}</strong> in payouts across the selected claims. This action can't be reversed in bulk.</>
              }
            </p>
          </div>
        </div>

        {previewNames.length > 0 && (
          <div className="wd-diff" style={{ margin: '0 0 14px' }}>
            <div className="wd-diff__title">Affecting</div>
            <ul className="wd-diff__list" style={{ maxHeight: 140 }}>
              {previewNames.map((name, i) => (
                <li key={i} className="wd-diff__row" style={{ gridTemplateColumns: '1fr auto' }}>
                  <span className="wd-diff__label">{name}</span>
                  <span className="wd-diff__detail">
                    {claims[i].type?.replace('_', ' ')} · €{(claims[i].payout_amount || 0).toFixed(2)}
                  </span>
                </li>
              ))}
              {claims.length > previewNames.length && (
                <li className="wd-diff__more">+ {claims.length - previewNames.length} more</li>
              )}
            </ul>
          </div>
        )}

        <label className="admin-publish-modal__label">Reason (required)</label>
        <input
          className="admin-publish-modal__input"
          placeholder={isReject
            ? 'e.g. Receipts older than the 30-day claim window'
            : 'e.g. Manual review of 3 borderline cases — all check out'}
          value={reason}
          onChange={e => setReason(e.target.value)}
          autoFocus
        />

        <div className="admin-publish-modal__actions">
          <button className="admin-publish-modal__cancel" onClick={onCancel} disabled={updating}>
            Cancel
          </button>
          <button
            className="admin-publish-modal__confirm"
            onClick={() => onConfirm(reason.trim())}
            disabled={!canSubmit || updating}
            style={isReject ? { background: '#DC2626' } : { background: '#16A34A' }}
            title={!canSubmit ? 'Describe why you\'re actioning all of these in bulk' : ''}
          >
            {updating
              ? (isReject ? 'Rejecting…' : 'Approving…')
              : isReject ? `Reject ${claims.length} →` : `Approve ${claims.length} & pay →`}
          </button>
        </div>
      </div>
    </div>
  );
}
