import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, CupSoda, ExternalLink, HandCoins, Link2, ListFilter, RefreshCw } from 'lucide-react';
import { useOrg } from '../context/OrgContext';
import { listBinTikkiePayouts } from '../lib/adminApi';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, KpiTile, PageHeader, Segmented } from '../ui';
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
  created:  { label: 'Link active',        tone: 'info' },
  redeemed: { label: 'Redeemed',           tone: 'success' },
  expired:  { label: 'Expired',            tone: 'neutral' },
  minting:  { label: 'Creating link…',     tone: 'warning' },
  failed:   { label: 'Link failed',        tone: 'danger' },
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

  const kpis = [
    { id: 'links', label: 'Links generated', icon: Link2, tone: 'violet', value: stats.count, description: 'One per collected balance' },
    { id: 'cups', label: 'Cups returned', icon: CupSoda, tone: 'teal', value: stats.cups, description: 'Across all links' },
    { id: 'issued', label: 'Cashback issued', icon: HandCoins, tone: 'sky', value: fmtEur(stats.issued), description: 'Every link that was created' },
    { id: 'redeemed', label: 'Redeemed', icon: CheckCircle2, tone: 'emerald', value: stats.redeemed, description: `${fmtEur(stats.redeemedEur)} collected by customers` },
  ];

  return (
    <div className="ui-page atl">
      <PageHeader
        title="Tikkie payouts"
        subtitle="Every time a customer collected their bin receipts as a Tikkie cashback link. Tikkie reports back when a link is paid, and the status here follows."
      >
        <Button icon={RefreshCw} onClick={load} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </Button>
      </PageHeader>

      <div className="ui-kpis atl-kpis">
        {kpis.map((m, i) => <KpiTile key={m.id} metric={m} index={i} interactive={false} />)}
      </div>

      <Card>
        <CardHeader
          title="Payout links"
          icon={ListFilter}
          ruled
          actions={(
            <Segmented
              ariaLabel="Filter payouts"
              value={filter}
              onChange={setFilter}
              options={FILTERS.map(f => ({ id: f.key, label: f.label }))}
            />
          )}
        />
        <CardBody flush>
          {error && (
            <p className="atl-error" role="alert">
              <AlertCircle size={15} aria-hidden="true" />{error}
            </p>
          )}

          {loading && rows.length === 0 ? (
            <p className="atl-loading">Loading…</p>
          ) : visible.length === 0 ? (
            <EmptyState icon={HandCoins} title={rows.length === 0 ? 'No payouts yet' : 'Nothing matches this filter'}>
              {rows.length === 0
                ? 'They appear here the moment a customer collects their balance.'
                : 'Try another status.'}
            </EmptyState>
          ) : (
            <div className="atl-table-wrap">
              <table className="ui-table atl-table">
                <thead>
                  <tr>
                    <th>Generated</th>
                    <th className="ui-num">Cups</th>
                    <th className="ui-num">Amount</th>
                    <th>Status</th>
                    <th>Redeemed</th>
                    <th>Expires</th>
                    <th>Batch</th>
                    <th aria-label="Link" />
                  </tr>
                </thead>
                <tbody>
                  {visible.map(r => {
                    const st = rowStatus(r);
                    const meta = STATUS_META[st];
                    return (
                      <tr key={r.id}>
                        <td>{fmtDateTime(r.created_at)}</td>
                        <td className="ui-num">{r.cups_redeemed ?? '—'}</td>
                        <td className="ui-num atl-amount">{fmtEur(r.payout_amount)}</td>
                        <td>
                          <Badge tone={meta.tone} title={st === 'failed' ? (r.tikkie_last_error || '') : undefined}>
                            {meta.label}
                          </Badge>
                        </td>
                        <td className="atl-muted">{fmtDateTime(r.tikkie_redeemed_at)}</td>
                        <td className="atl-muted">{r.tikkie_expires_at ? new Date(r.tikkie_expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—'}</td>
                        <td className="atl-batch" title={r.batch_id || 'Bulk payout: one link for the whole wallet balance'}>
                          {r.batch_id ? r.batch_id.slice(0, 8) : 'Whole wallet'}
                        </td>
                        <td className="atl-link-cell">
                          {r.tikkie_url && (
                            <a className="atl-link" href={r.tikkie_url} target="_blank" rel="noopener noreferrer">
                              Open link <ExternalLink size={12} aria-hidden="true" />
                            </a>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
