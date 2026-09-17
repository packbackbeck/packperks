import { useEffect, useState } from 'react';
import { ArrowRight, Check, GitMerge } from 'lucide-react';
import { getMergeRequestDetail } from '../lib/adminApi';
import { Badge, Button, Modal } from '../ui';
import './MergeRequestModal.css';

/* ─────────────────────────────────────────────────────────────────────
 * MergeRequestModal — review a single account-merge request.
 *
 * Shows the two sides of the merge side by side: the account that will be
 * KEPT (survivor) and the account(s) that will be MERGED IN (absorbed),
 * each with its name, email, cup balance, lifetime cups and join date. A
 * result strip makes the outcome explicit — which name/email is retained
 * and the combined balance. Pending requests can be approved/rejected right
 * here; decided ones are read-only.
 * ───────────────────────────────────────────────────────────────────── */

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return '—'; }
}
function shortId(id) {
  return id ? String(id).slice(0, 8) : '—';
}
const SOURCE_LABEL = { restore: 'Lost cups (restore)', admin: 'Admin-initiated', offer: 'Merge offer', merge: 'Merge offer' };

const STATUS_TONE = { pending: 'warning', approved: 'success', completed: 'success', rejected: 'danger' };

function AccountCard({ tone, badge, user }) {
  const name = user?.display_name || 'Anonymous';
  return (
    <div className={`mrm-acct mrm-acct--${tone}`}>
      <div className="mrm-acct__badge">{tone === 'keep' && <Check size={11} aria-hidden="true" />}{badge}</div>
      <div className="mrm-acct__name">{name}</div>
      <div className="mrm-acct__email">{user?.email || 'No email on file'}</div>
      <dl className="mrm-acct__stats">
        <div><dt>Cups balance</dt><dd>{user?.balance ?? '—'}</dd></div>
        <div><dt>Lifetime cups</dt><dd>{user?.lifetime_cups ?? '—'}</dd></div>
        <div><dt>Joined</dt><dd>{fmtDate(user?.created_at)}</dd></div>
        <div><dt>Account ID</dt><dd className="mrm-acct__mono">{shortId(user?.id)}</dd></div>
      </dl>
    </div>
  );
}

export default function MergeRequestModal({ req, onClose, onDecide, busy }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!req?.id) return;
    let alive = true;
    setLoading(true); setError(null);
    getMergeRequestDetail(req.id)
      .then((d) => { if (alive) { setDetail(d); setLoading(false); } })
      .catch((e) => { if (alive) { setError(e.message || 'Could not load this request.'); setLoading(false); } });
    return () => { alive = false; };
  }, [req?.id]);

  if (!req) return null;

  const survivor = detail?.survivor;
  const absorbed = detail?.absorbed || [];
  const isPending = req.status === 'pending';
  // Projected combined balance (survivor + everyone merged in) when live users
  // resolved; otherwise fall back to the stored merged_balance on the request.
  const liveSum = detail
    ? (Number(survivor?.balance) || 0) + absorbed.reduce((n, u) => n + (Number(u?.balance) || 0), 0)
    : null;
  const combinedBalance = liveSum != null ? liveSum : (req.merged_balance ?? '—');
  const keptEmail = survivor?.email || req.email || '—';
  const keptName = survivor?.display_name || 'Anonymous';

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title="Review this merge"
      subtitle="Account merge request. Check which account is kept and what it ends up with."
      icon={GitMerge}
      footer={isPending ? (
        <>
          <Button variant="outline" className="mrm__cancel" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="danger-ghost" className="mrm__reject" onClick={() => onDecide?.('reject')} disabled={busy}>
            {busy ? '…' : 'Reject'}
          </Button>
          <Button variant="primary" icon={GitMerge} onClick={() => onDecide?.('approve')} disabled={busy}>
            {busy ? '…' : 'Approve & merge'}
          </Button>
        </>
      ) : (
        <Button variant="outline" onClick={onClose}>Close</Button>
      )}
    >
      <div className="mrm__meta">
        <Badge tone={STATUS_TONE[req.status] || 'neutral'}><span className="mrm__status">{req.status}</span></Badge>
        <span className="mrm__meta-item">Source: <b>{SOURCE_LABEL[req.source] || req.source || '—'}</b></span>
        <span className="mrm__meta-item">Requested: <b>{fmtDate(req.requested_at)}</b></span>
        {req.status !== 'pending' && req.decider && (
          <span className="mrm__meta-item">Decided by: <b>{req.decider.display_name || (req.decider.email || '').split('@')[0]}</b></span>
        )}
      </div>

      {loading ? (
        <div className="mrm__loading">Loading accounts…</div>
      ) : error ? (
        <div className="mrm__error" role="alert">{error}</div>
      ) : (
        <>
          <div className="mrm__grid">
            <AccountCard tone="keep" badge="Kept" user={survivor} />
            <div className="mrm__arrow" aria-hidden="true">
              <ArrowRight size={20} />
            </div>
            <div className="mrm__absorbed-col">
              {absorbed.length === 0 && <div className="mrm__none">No source accounts listed.</div>}
              {absorbed.map((u) => (
                <AccountCard key={u.id} tone="merge" badge="Merged in" user={u} />
              ))}
            </div>
          </div>

          <div className="mrm__result">
            <div className="mrm__result-title">After the merge</div>
            <div className="mrm__result-rows">
              <div className="mrm__result-row"><span>Name kept</span><strong>{keptName}</strong></div>
              <div className="mrm__result-row"><span>Email kept</span><strong>{keptEmail}</strong></div>
              <div className="mrm__result-row"><span>Combined balance</span><strong>{combinedBalance} cups</strong></div>
              <div className="mrm__result-row"><span>Accounts merged</span><strong>{absorbed.length + 1} → 1</strong></div>
            </div>
            {req.reason && <p className="mrm__reason"><span>Customer’s reason:</span> {req.reason}</p>}
          </div>
        </>
      )}
    </Modal>
  );
}
