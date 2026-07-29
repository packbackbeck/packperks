import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { getMergeRequestDetail } from '../lib/adminApi';
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

function AccountCard({ tone, badge, user }) {
  const name = user?.display_name || 'Anonymous';
  return (
    <div className={`mrm-acct mrm-acct--${tone}`}>
      <div className="mrm-acct__badge">{badge}</div>
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
    function onKey(e) { if (e.key === 'Escape') onClose?.(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

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

  return createPortal(
    <div className="mrm-overlay" onClick={onClose}>
      <div className="mrm" onClick={(e) => e.stopPropagation()}>
        <header className="mrm__head">
          <div>
            <span className="mrm__eyebrow">Account merge request</span>
            <h2 className="mrm__title">Review this merge</h2>
          </div>
          <button className="mrm__close" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="mrm__meta">
          <span className={`mrm__pill mrm__pill--${req.status}`}>{req.status}</span>
          <span className="mrm__meta-item">Source: {SOURCE_LABEL[req.source] || req.source || '—'}</span>
          <span className="mrm__meta-item">Requested: {fmtDate(req.requested_at)}</span>
        </div>

        {loading ? (
          <div className="mrm__loading">Loading accounts…</div>
        ) : error ? (
          <div className="mrm__error">{error}</div>
        ) : (
          <>
            <div className="mrm__grid">
              <AccountCard tone="keep" badge="✓ Kept" user={survivor} />
              <div className="mrm__arrow" aria-hidden>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="4" y1="12" x2="20" y2="12" /><polyline points="13 5 20 12 13 19" />
                </svg>
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

        <footer className="mrm__foot">
          {isPending ? (
            <>
              <button className="mrm__btn mrm__btn--ghost" onClick={onClose} disabled={busy}>Cancel</button>
              <div className="mrm__foot-actions">
                <button className="mrm__btn mrm__btn--deny" onClick={() => onDecide?.('reject')} disabled={busy}>
                  {busy ? '…' : 'Reject'}
                </button>
                <button className="mrm__btn mrm__btn--approve" onClick={() => onDecide?.('approve')} disabled={busy}>
                  {busy ? '…' : 'Approve & merge'}
                </button>
              </div>
            </>
          ) : (
            <button className="mrm__btn mrm__btn--ghost" onClick={onClose}>Close</button>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  );
}
