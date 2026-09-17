import { useEffect, useMemo, useState } from 'react';
import { GitMerge, TriangleAlert } from 'lucide-react';
import { mergeUsers, mergeGroupAccounts } from '../lib/adminApi';
import { logAction } from '../auth/actionLog';
import { Button, Modal } from '../ui';
import './MergeUsersModal.css';

/* ─────────────────────────────────────────────────────────────────────
 * MergeUsersModal — fold N selected accounts into one survivor.
 *
 * Admin picks the survivor (defaulted to the most-recently-active row).
 * Server sums every cup balance, repoints history/claims/scans/cups onto
 * the survivor, and keeps the most-recent non-empty profile fields. The
 * absorbed rows are soft-deleted (`merged_into`) — nothing is hard-deleted.
 *
 * Two-step confirm: "Continue" → "Merge N accounts". Closeable via Cancel
 * or the X. Refuses cross-org merges and already-merged inputs (the server
 * also re-validates).
 * ───────────────────────────────────────────────────────────────────── */

function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
}

function timeAgo(ts) {
  if (!ts) return '—';
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function MergeUsersModal({ open, users, onClose, onMerged, grouped = false }) {
  // Default survivor = most recently updated row (most likely the "current"
  // identity). Admin can override.
  const initialSurvivor = useMemo(() => {
    if (!users?.length) return null;
    return [...users].sort((a, b) =>
      new Date(b.updated_at || b.created_at || 0).getTime() -
      new Date(a.updated_at || a.created_at || 0).getTime()
    )[0]?.id;
  }, [users]);

  const [survivorId, setSurvivorId] = useState(initialSurvivor);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setSurvivorId(initialSurvivor);
      setConfirming(false);
      setError(null);
      setBusy(false);
    }
  }, [open, initialSurvivor]);

  if (!open || !users?.length) return null;

  const survivor = users.find(u => u.id === survivorId) || users[0];
  const absorbed = users.filter(u => u.id !== survivor.id);
  const totalBalance = users.reduce((s, u) => s + (u.cupBalance || 0), 0);
  const totalLifetime = users.reduce((s, u) => s + (u.lifetimeCups || 0), 0);
  // Refuse cross-org merges in the UI ONLY for solo orgs. In a group, merging is
  // per-group by design (each person keeps one row per store), so a cross-store
  // merge is exactly what we want — routed through the group-merge RPC.
  const orgIds = new Set(users.map(u => u.org_id).filter(Boolean));
  const crossOrg = !grouped && orgIds.size > 1;

  async function handleMerge() {
    setBusy(true);
    setError(null);
    try {
      const result = grouped
        ? await mergeGroupAccounts(survivor.id, absorbed.map(a => a.id))
        : await mergeUsers(survivor.id, absorbed.map(a => a.id));
      logAction({
        action: 'user.merge',
        targetType: 'user',
        targetId: survivor.id,
        metadata: {
          survivor_id: survivor.id,
          absorbed_ids: absorbed.map(a => a.id),
          merged_balance: result?.merged_balance,
          merged_lifetime: result?.merged_lifetime,
          repoint_errors: result?.repoint_errors,
        },
      });
      onMerged?.(result);
    } catch (e) {
      const msg = e?.detail?.detail || e?.detail?.error || e?.message || 'Merge failed.';
      setError(typeof msg === 'string' ? msg : JSON.stringify(msg));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  // Escape, the scrim and the close button are ignored while a merge runs.
  const requestClose = () => { if (!busy) onClose(); };

  return (
    <Modal
      open
      onClose={requestClose}
      title={`Merge ${users.length} accounts`}
      subtitle="Fold every cup balance into one account. The other accounts are kept for the audit trail, marked as merged, and left out of everything from now on."
      icon={GitMerge}
      footer={!confirming ? (
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => setConfirming(true)}
            disabled={busy || crossOrg || users.length < 2}
          >
            Continue
          </Button>
        </>
      ) : (
        <>
          <p className="mum__confirm-text">
            <TriangleAlert size={15} aria-hidden="true" />
            <span>
              Merge {absorbed.length} account{absorbed.length === 1 ? '' : 's'} into <strong>{survivor.display_name || survivor.id.slice(0, 8)}</strong>?
              Cup totals will be combined ({absorbed.reduce((s, a) => s + (a.cupBalance || 0), 0)} cups absorbed).
              The other accounts will be kept for audit.
            </span>
          </p>
          <Button variant="outline" onClick={() => setConfirming(false)} disabled={busy}>Back</Button>
          <Button variant="danger" icon={GitMerge} onClick={handleMerge} disabled={busy}>
            {busy ? 'Merging…' : `Merge ${users.length} accounts`}
          </Button>
        </>
      )}
    >
      {crossOrg && (
        <div className="mum__error" role="alert">
          These accounts belong to different organisations. Cross-org merges are not allowed.
        </div>
      )}

      <div className="mum__summary">
        <div><span>Total cups</span><strong>{totalBalance}</strong></div>
        <div><span>Total lifetime</span><strong>{totalLifetime}</strong></div>
        <div><span>Accounts</span><strong>{users.length}</strong></div>
      </div>

      <div>
        <p className="mum__section-title">Which account should survive?</p>
        <p className="mum__hint">
          The survivor keeps the merged balance. Profile fields (name, email, …)
          default to the most-recently-updated non-empty value across all selected accounts.
        </p>
      </div>

      <ul className="mum__list" role="radiogroup" aria-label="Choose the survivor">
        {users.map(u => {
          const selected = u.id === survivor.id;
          return (
            <li key={u.id}>
              <label className={`mum__row${selected ? ' is-selected' : ''}`}>
                <input
                  type="radio"
                  name="mum-survivor"
                  checked={selected}
                  onChange={() => setSurvivorId(u.id)}
                  disabled={busy || crossOrg}
                />
                <div className="mum__row-main">
                  <div className="mum__row-name">{u.display_name || '(Unnamed)'} <span className="mum__row-id">· {u.id.slice(0, 8)}</span></div>
                  <div className="mum__row-meta">
                    <span>{u.email || 'no email'}</span>
                    <span>·</span>
                    <span>{u.device || 'no device'}</span>
                  </div>
                </div>
                <div className="mum__row-stats">
                  <div><strong>{u.cupBalance || 0}</strong> cups</div>
                  <div className="mum__row-dim">Joined {fmtDate(u.created_at)} · seen {timeAgo(u.updated_at)}</div>
                </div>
              </label>
            </li>
          );
        })}
      </ul>

      {error && <div className="mum__error" role="alert">{error}</div>}
    </Modal>
  );
}
