import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOrg } from '../context/OrgContext';
import { getTikkieAudience } from '../lib/adminApi';
import './AdminTikkieUsers.css';

/* ─────────────────────────────────────────────────────────────────────
 * AdminTikkieUsers — the Users page a Redirect Refund org actually needs.
 *
 * This mode's audience has exactly two shapes, and the page is built
 * around that split:
 *
 *   ACCOUNTS — refund accounts: the customer left an email AND opted into
 *              an account ("save for later", or the toggle on the waiting
 *              screen). They have a home page, history, and their payouts
 *              attach to them.
 *   MAILOS   — email only: left on the waiting screen without the account
 *              toggle. We can notify them when a link is ready, and that
 *              is all we know about them.
 *
 * No cup balances, no merges, no rewards — none of that exists here. The
 * standard AdminUsers stays untouched for every other mode.
 * ───────────────────────────────────────────────────────────────────── */

function fmtWhen(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
function eur(n) { return `€${Number(n || 0).toFixed(2)}`; }
function shortId(id) { return id ? `${String(id).slice(0, 8)}…` : '—'; }

export default function AdminTikkieUsers() {
  const { activeOrgId } = useOrg();
  const [data, setData] = useState({ accounts: [], claims: [], pending: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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

  const totals = useMemo(() => {
    const reachable = accounts.length + mailos.length;
    const attached = claims.filter(c => c.user_id).length;
    const paid = claims.reduce((s, c) => s + Number(c.payout_amount || 0), 0);
    return { reachable, attached, paid };
  }, [accounts, mailos, claims]);

  const splitPct = totals.reachable > 0
    ? Math.round((accounts.length / totals.reachable) * 100)
    : 0;

  return (
    <div className="admin-tikkieusers">
      <header className="atu-header">
        <div>
          <h1 className="atu-title">Users</h1>
          <p className="atu-sub">
            The Redirect Refund audience: <strong>accounts</strong> (refund accounts with a home
            page and history) and <strong>mailos</strong> (an email left on the waiting screen,
            nothing more). Payouts only attach to accounts.
          </p>
        </div>
        <button type="button" className="atu-refresh" onClick={load} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </header>

      {error && <div className="atu-error">{error}</div>}

      {/* ── The stat the split bar answers: mailos vs accounts ── */}
      <div className="atu-tiles">
        <div className="atu-tile">
          <div className="atu-tile__num">{accounts.length}</div>
          <div className="atu-tile__label">Accounts</div>
        </div>
        <div className="atu-tile">
          <div className="atu-tile__num">{mailos.length}</div>
          <div className="atu-tile__label">Mailos</div>
        </div>
        <div className="atu-tile">
          <div className="atu-tile__num">{totals.attached}</div>
          <div className="atu-tile__label">Refunds on accounts</div>
        </div>
        <div className="atu-tile">
          <div className="atu-tile__num">{eur(totals.paid)}</div>
          <div className="atu-tile__label">Total refunded</div>
        </div>
      </div>

      <section className="atu-card">
        <header className="atu-card__head">
          <div>
            <h2 className="atu-card__title">Mailos vs accounts</h2>
            <p className="atu-card__sub">
              Of everyone reachable by email, how many opted into an account.
            </p>
          </div>
          <span className="atu-split__pct">{totals.reachable ? `${splitPct}% accounts` : 'No emails yet'}</span>
        </header>
        <div className="atu-split" role="img"
          aria-label={`${accounts.length} accounts, ${mailos.length} mailos`}>
          <div className="atu-split__accounts" style={{ width: `${splitPct}%` }} />
        </div>
        <div className="atu-split__legend">
          <span><i className="atu-dot atu-dot--accounts" /> Accounts · {accounts.length}</span>
          <span><i className="atu-dot atu-dot--mailos" /> Mailos · {mailos.length}</span>
        </div>
      </section>

      {/* ── Accounts ── */}
      <section className="atu-card">
        <header className="atu-card__head">
          <div>
            <h2 className="atu-card__title">Accounts</h2>
            <p className="atu-card__sub">Refund accounts, one per device. Their payouts show in their refund history.</p>
          </div>
        </header>
        {accounts.length === 0 ? (
          <p className="atu-empty">
            No accounts yet. They appear when a customer picks “save for later” on the
            redirect page, or ticks the account toggle on the waiting screen.
          </p>
        ) : (
          <div className="atu-tablewrap">
            <table className="atu-table">
              <thead>
                <tr>
                  <th>Email</th><th>Created</th><th>Refunds</th><th>Total</th><th>Collected</th><th>Last refund</th><th>Marketing</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map(u => {
                  const agg = byUser.get(u.id) || { count: 0, total: 0, collected: 0, last: null };
                  return (
                    <tr key={u.id}>
                      <td className="atu-td-email">{u.email || <span className="atu-muted">no email</span>}</td>
                      <td>{fmtWhen(u.created_at)}</td>
                      <td>{agg.count}</td>
                      <td>{eur(agg.total)}</td>
                      <td>{eur(agg.collected)}</td>
                      <td>{agg.last ? fmtWhen(agg.last) : '—'}</td>
                      <td>{u.marketing_consent ? 'Yes' : 'No'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Mailos ── */}
      <section className="atu-card">
        <header className="atu-card__head">
          <div>
            <h2 className="atu-card__title">Mailos</h2>
            <p className="atu-card__sub">
              Emails left on the waiting screen without the account toggle. We mail them their
              link when the bin confirms; they never see a PackPerks account.
            </p>
          </div>
        </header>
        {mailos.length === 0 ? (
          <p className="atu-empty">No mailos. Every email so far came with an account.</p>
        ) : (
          <div className="atu-tablewrap">
            <table className="atu-table">
              <thead>
                <tr>
                  <th>Email</th><th>Receipt</th><th>First seen</th><th>Status</th><th>Notified</th>
                </tr>
              </thead>
              <tbody>
                {mailos.map(p => (
                  <tr key={p.batch_id}>
                    <td className="atu-td-email">{p.email}</td>
                    <td className="atu-mono">{shortId(p.batch_id)}</td>
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
        )}
      </section>
    </div>
  );
}
