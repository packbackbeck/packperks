import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOrg } from '../context/OrgContext';
import { getTikkieAudience } from '../lib/adminApi';
import './TikkieMailosSection.css';

/* ─────────────────────────────────────────────────────────────────────
 * Mailos — Redirect Refund's second audience.
 *
 * A "mailo" left an email on the waiting screen but declined the account
 * toggle: we can mail them their refund link, and that is all we know.
 * They have no users row, so they can't appear in the Users table without
 * inventing fake accounts — hence this section directly beneath it, in
 * the same table language as the merge-requests queue.
 * ───────────────────────────────────────────────────────────────────── */

function fmtWhen(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function TikkieMailosSection({ accounts = 0 }) {
  const { activeOrgId } = useOrg();
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!activeOrgId) return;
    setLoading(true);
    setError(null);
    try {
      const { pending: rows } = await getTikkieAudience(activeOrgId);
      setPending(rows || []);
    } catch (e) {
      setError(e?.message || 'Failed to load mailos.');
    } finally {
      setLoading(false);
    }
  }, [activeOrgId]);

  useEffect(() => { load(); }, [load]);

  const mailos = useMemo(() => pending.filter(p => p.email && !p.user_id), [pending]);
  const reachable = accounts + mailos.length;
  const pct = reachable > 0 ? Math.round((accounts / reachable) * 100) : 0;

  return (
    <section className="tms">
      <div className="tms__head">
        <div>
          <h2 className="tms__title">Mailos <span className="tms__count">{mailos.length}</span></h2>
          <p className="tms__sub">
            Emails left on the waiting screen without an account. We mail them the refund link when the
            bin confirms; they never see a PackPerks account.
          </p>
        </div>
        <button className="tms__refresh" onClick={load} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && <div className="tms__error">{error}</div>}

      <div className="tms__split-wrap">
        <div className="tms__split-head">
          <span className="tms__split-label">Mailos vs accounts</span>
          <span className="tms__split-pct">{reachable ? `${pct}% accounts` : 'No emails yet'}</span>
        </div>
        <div className="tms__split" role="img" aria-label={`${accounts} accounts, ${mailos.length} mailos`}>
          <div className="tms__split-acc" style={{ width: `${pct}%` }} />
        </div>
        <div className="tms__legend">
          <span><i className="tms__dot tms__dot--acc" /> Accounts · {accounts}</span>
          <span><i className="tms__dot tms__dot--mailo" /> Mailos · {mailos.length}</span>
        </div>
      </div>

      {loading ? (
        <div className="tms__empty">Loading mailos…</div>
      ) : mailos.length === 0 ? (
        <div className="tms__empty">No mailos. Every email so far came with an account.</div>
      ) : (
        <div className="tms__table-wrap">
          <table className="tms__table">
            <thead>
              <tr>
                <th>Email</th><th>Receipt</th><th>First seen</th><th>Status</th><th>Notified</th>
              </tr>
            </thead>
            <tbody>
              {mailos.map(p => (
                <tr key={p.batch_id}>
                  <td className="tms__email">{p.email}</td>
                  <td><span className="tms__mono">{String(p.batch_id).slice(0, 8)}</span></td>
                  <td className="tms__muted">{fmtWhen(p.first_seen)}</td>
                  <td>
                    <span className={`tms__badge tms__badge--${p.resolved_at ? 'ok' : 'wait'}`}>
                      {p.resolved_at ? 'Resolved' : 'Waiting for the bin'}
                    </span>
                  </td>
                  <td className="tms__muted">{p.notified_at ? fmtWhen(p.notified_at) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
