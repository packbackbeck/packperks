import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOrg } from '../context/OrgContext';
import { getTikkieAudience } from '../lib/adminApi';
import './AdminUsers.css';
import './AdminTikkieUsers.css';

/* ─────────────────────────────────────────────────────────────────────
 * AdminTikkieUsers — the Users page for Redirect Refund orgs.
 *
 * Deliberately styled with the SAME chassis as the standard Users page
 * (AdminUsers.css: au-header, au-search-bar, au-table) so switching org
 * modes doesn't feel like switching products — only the columns change,
 * because this mode's audience is different in kind:
 *
 *   ACCOUNTS — refund accounts: email + opt-in ("save for later" or the
 *              waiting-screen toggle). Payouts attach to them; they have
 *              a home page and history. No cup balances here, ever.
 *   MAILOS   — email only, left on the waiting screen without the
 *              account toggle. We can notify them when a link is ready,
 *              and that is all we know about them.
 * ───────────────────────────────────────────────────────────────────── */

function fmtWhen(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
function eur(n) { return `€${Number(n || 0).toFixed(2)}`; }

export default function AdminTikkieUsers() {
  const { activeOrgId } = useOrg();
  const [data, setData] = useState({ accounts: [], claims: [], pending: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    if (!activeOrgId) return;
    setLoading(true);
    setError(null);
    try {
      setData(await getTikkieAudience(activeOrgId));
    } catch (e) {
      setError(e?.message || 'Failed to load the audience.');
    } finally {
      setLoading(false);
    }
  }, [activeOrgId]);

  useEffect(() => { load(); }, [load]);

  const { accounts, claims, pending } = data;

  /* Mailos: waiting-screen emails that never became an account. */
  const mailos = useMemo(
    () => pending.filter(p => p.email && !p.user_id),
    [pending],
  );

  const byUser = useMemo(() => {
    const m = new Map();
    for (const c of claims) {
      if (!c.user_id) continue;
      const cur = m.get(c.user_id) || { count: 0, total: 0, collected: 0, last: null };
      cur.count += 1;
      cur.total += Number(c.payout_amount || 0);
      if (c.tikkie_status === 'redeemed') cur.collected += Number(c.payout_amount || 0);
      if (!cur.last || c.created_at > cur.last) cur.last = c.created_at;
      m.set(c.user_id, cur);
    }
    return m;
  }, [claims]);

  const q = search.trim().toLowerCase();
  const shownAccounts = useMemo(
    () => (q ? accounts.filter(u =>
      (u.email || '').toLowerCase().includes(q) ||
      (u.display_name || '').toLowerCase().includes(q) ||
      u.id.slice(0, 8).includes(q)
    ) : accounts),
    [accounts, q],
  );
  const shownMailos = useMemo(
    () => (q ? mailos.filter(p =>
      (p.email || '').toLowerCase().includes(q) ||
      String(p.batch_id).slice(0, 8).includes(q)
    ) : mailos),
    [mailos, q],
  );

  const reachable = accounts.length + mailos.length;
  const splitPct = reachable > 0 ? Math.round((accounts.length / reachable) * 100) : 0;

  return (
    <div className="admin-users admin-tikkieusers">
      <div className="au-header">
        <div>
          <h1 className="au-header__title">Users</h1>
          <p className="au-header__sub">
            {loading
              ? 'Loading…'
              : `${accounts.length} account${accounts.length === 1 ? '' : 's'} · ${mailos.length} mailo${mailos.length === 1 ? '' : 's'} (email only, no account)`}
          </p>
        </div>
      </div>

      {error && <div className="atu-error">{error}</div>}

      {/* Mailos vs accounts — the split this mode's funnel is judged on. */}
      <div className="atu-splitbar">
        <div className="atu-splitbar__head">
          <span className="atu-splitbar__label">Mailos vs accounts</span>
          <span className="atu-splitbar__pct">{reachable ? `${splitPct}% accounts` : 'No emails yet'}</span>
        </div>
        <div className="atu-split" role="img" aria-label={`${accounts.length} accounts, ${mailos.length} mailos`}>
          <div className="atu-split__accounts" style={{ width: `${splitPct}%` }} />
        </div>
        <div className="atu-split__legend">
          <span><i className="atu-dot atu-dot--accounts" /> Accounts · {accounts.length}</span>
          <span><i className="atu-dot atu-dot--mailos" /> Mailos · {mailos.length}</span>
        </div>
      </div>

      <div className="au-table-wrap">
        <div className="au-search-bar">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9E9A93" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            className="au-search-input"
            placeholder="Search by email, or short ID (first 8 chars)…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {loading ? (
          <div className="au-loading">Loading users…</div>
        ) : (
          <>
            <h2 className="atu-tabletitle">Accounts</h2>
            <div className="au-table-scroll">
              <table className="au-table">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Joined</th>
                    <th>Refunds</th>
                    <th>Total refunded</th>
                    <th>Collected</th>
                    <th>Last refund</th>
                    <th>Marketing</th>
                  </tr>
                </thead>
                <tbody>
                  {shownAccounts.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="au-table__empty">
                        {q ? 'No accounts match this search.'
                          : 'No accounts yet. They appear when a customer picks “save for later” or ticks the account toggle on the waiting screen.'}
                      </td>
                    </tr>
                  ) : shownAccounts.map(u => {
                    const agg = byUser.get(u.id) || { count: 0, total: 0, collected: 0, last: null };
                    return (
                      <tr key={u.id}>
                        <td>
                          <div className="au-user-cell">
                            <div className="au-user-avatar">{(u.email || '?')[0].toUpperCase()}</div>
                            <div className="au-user-info">
                              <span className="au-user-name">{u.email || 'No email'}</span>
                              <span className="au-user-id" title={`Full ID: ${u.id}`}>
                                ID: <span className="au-mono">{u.id.slice(0, 8)}</span>
                              </span>
                            </div>
                          </div>
                        </td>
                        <td>{fmtWhen(u.created_at)}</td>
                        <td>{agg.count}</td>
                        <td>{eur(agg.total)}</td>
                        <td>{eur(agg.collected)}</td>
                        <td>{agg.last ? fmtWhen(agg.last) : '—'}</td>
                        <td>{u.marketing_consent ? 'Yes' : <span className="au-muted">No</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <h2 className="atu-tabletitle">
              Mailos
              <span className="atu-tabletitle__hint">email left on the waiting screen, no account</span>
            </h2>
            <div className="au-table-scroll">
              <table className="au-table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Receipt</th>
                    <th>First seen</th>
                    <th>Status</th>
                    <th>Notified</th>
                  </tr>
                </thead>
                <tbody>
                  {shownMailos.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="au-table__empty">
                        {q ? 'No mailos match this search.' : 'No mailos. Every email so far came with an account.'}
                      </td>
                    </tr>
                  ) : shownMailos.map(p => (
                    <tr key={p.batch_id}>
                      <td>
                        <div className="au-user-cell">
                          <div className="au-user-avatar au-user-avatar--mailo">{(p.email || '?')[0].toUpperCase()}</div>
                          <div className="au-user-info">
                            <span className="au-user-name">{p.email}</span>
                          </div>
                        </div>
                      </td>
                      <td><span className="au-mono">{String(p.batch_id).slice(0, 8)}</span></td>
                      <td>{fmtWhen(p.first_seen)}</td>
                      <td>
                        <span className={`atu-badge ${p.resolved_at ? 'atu-badge--ok' : 'atu-badge--wait'}`}>
                          {p.resolved_at ? 'Resolved' : 'Waiting for the bin'}
                        </span>
                      </td>
                      <td>{p.notified_at ? fmtWhen(p.notified_at) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
