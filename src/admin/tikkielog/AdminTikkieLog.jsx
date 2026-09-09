import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOrg } from '../context/OrgContext';
import { listBinTikkiePayouts } from '../lib/adminApi';
import './AdminTikkieLog.css';
import { adminMoney } from '../lib/adminMoney';

/* Tikkie payouts log — the reporting page for tikkie-only (smart-bin) orgs.
 *
 * Every Tikkie link is one claims row: wallet-era bulk payouts (no batch,
 * they sweep many receipts) and legacy per-receipt links. When a link
 * was generated, how many cups, the amount, and the live Tikkie status
 * (created → redeemed/expired, kept fresh by the tikkie-webhook). This page
 * is deliberately a flat log + a few counters — in tikkie-only mode there is
 * nothing to review or approve. */

const STATUS_META = {
  created:  { label: 'Link active', cls: 'ok' },
  redeemed: { label: 'Redeemed',    cls: 'good' },
  expired:  { label: 'Expired',     cls: 'muted' },
  minting:  { label: 'Minting…',    cls: 'busy' },
  failed:   { label: 'Mint failed', cls: 'bad' },
};

function rowStatus(r) {
  if (r.tikkie_status && STATUS_META[r.tikkie_status]) return r.tikkie_status;
  if (r.tikkie_url) return 'created';
  return 'failed'; // claim exists but no link and not minting → the mint errored
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) +
    ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
const fmtEur = (n) => adminMoney(Number(n || 0));

const FILTERS = [
  { key: 'all',      label: 'All' },
  { key: 'created',  label: 'Active' },
  { key: 'redeemed', label: 'Redeemed' },
  { key: 'expired',  label: 'Expired' },
  { key: 'failed',   label: 'Failed' },
];

export default function AdminTikkieLog() {
  const { activeOrgId } = useOrg();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');

  const load = useCallback(async () => {
    if (!activeOrgId) return;
    setLoading(true);
    setError(null);
    try {
      setRows(await listBinTikkiePayouts(activeOrgId));
    } catch (e) {
      setError(e.message || 'Failed to load payouts.');
    } finally {
      setLoading(false);
    }
  }, [activeOrgId]);

  useEffect(() => { load(); }, [load]);

  const stats = useMemo(() => {
    const s = { count: 0, cups: 0, issued: 0, redeemed: 0, redeemedEur: 0 };
    for (const r of rows) {
      const st = rowStatus(r);
      s.count += 1;
      s.cups += r.cups_redeemed || 0;
      if (st !== 'failed') s.issued += Number(r.payout_amount || 0);
      if (st === 'redeemed') { s.redeemed += 1; s.redeemedEur += Number(r.payout_amount || 0); }
    }
    return s;
  }, [rows]);

  const visible = useMemo(
    () => (filter === 'all' ? rows : rows.filter(r => rowStatus(r) === filter)),
    [rows, filter],
  );

  return (
    <div className="admin-tikkielog">
      <header className="atl-header">
        <div>
          <h1 className="atl-title">Tikkie payouts</h1>
          <p className="atl-sub">
            Every bin receipt that was scanned and turned into a Tikkie cashback link.
            Redemption status updates automatically via the Tikkie webhook.
          </p>
        </div>
        <button className="atl-refresh" onClick={load} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      <div className="atl-tiles">
        <div className="atl-tile">
          <div className="atl-tile__num">{stats.count}</div>
          <div className="atl-tile__label">Links generated</div>
        </div>
        <div className="atl-tile">
          <div className="atl-tile__num">{stats.cups}</div>
          <div className="atl-tile__label">Cups returned</div>
        </div>
        <div className="atl-tile">
          <div className="atl-tile__num">{fmtEur(stats.issued)}</div>
          <div className="atl-tile__label">Cashback issued</div>
        </div>
        <div className="atl-tile">
          <div className="atl-tile__num">{stats.redeemed} <span className="atl-tile__sm">({fmtEur(stats.redeemedEur)})</span></div>
          <div className="atl-tile__label">Redeemed</div>
        </div>
      </div>

      <div className="atl-filters">
        {FILTERS.map(f => (
          <button
            key={f.key}
            className={`atl-chip${filter === f.key ? ' atl-chip--on' : ''}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && <div className="atl-error">{error}</div>}

      {loading && rows.length === 0 ? (
        <div className="atl-empty">Loading…</div>
      ) : visible.length === 0 ? (
        <div className="atl-empty">
          {rows.length === 0
            ? 'No payouts yet. They appear here the moment a customer collects their balance.'
            : 'Nothing matches this filter.'}
        </div>
      ) : (
        <div className="atl-table-wrap">
          <table className="atl-table">
            <thead>
              <tr>
                <th>Generated</th>
                <th>Cups</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Redeemed</th>
                <th>Expires</th>
                <th>Batch</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map(r => {
                const st = rowStatus(r);
                const meta = STATUS_META[st];
                return (
                  <tr key={r.id}>
                    <td>{fmtDateTime(r.created_at)}</td>
                    <td>{r.cups_redeemed ?? '—'}</td>
                    <td className="atl-amount">{fmtEur(r.payout_amount)}</td>
                    <td>
                      <span className={`atl-badge atl-badge--${meta.cls}`} title={st === 'failed' ? (r.tikkie_last_error || '') : ''}>
                        {meta.label}
                      </span>
                    </td>
                    <td>{fmtDateTime(r.tikkie_redeemed_at)}</td>
                    <td>{r.tikkie_expires_at ? new Date(r.tikkie_expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—'}</td>
                    <td className="atl-batch" title={r.batch_id || 'Bulk payout: one link for the whole wallet balance'}>
                      {r.batch_id ? r.batch_id.slice(0, 8) : 'bulk'}
                    </td>
                    <td>
                      {r.tikkie_url && (
                        <a className="atl-link" href={r.tikkie_url} target="_blank" rel="noopener noreferrer">Link</a>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
