import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Repeat, Search } from 'lucide-react';
import { getCupTransactions } from '../lib/adminApi';
import Spinner from '../lib/Spinner';
import { Avatar, SearchBox, SortTh } from '../shared/opsTable';
import { Badge, Button, EmptyState, PageHeader, Segmented } from '../ui';
import './AdminTransactions.css';

/* AdminTransactions — every user-to-user cup share, aggregated by
 * batch_id so each row is one logical transfer (not one cup).
 *
 * Status:
 *   pending  — sender minted the share, no cups claimed yet
 *   partial  — some but not all cups in the batch were claimed
 *   complete — every cup in the batch was activated by the receiver
 *
 * Searchable by sender / receiver name / email / batch id; filterable
 * by status; every column sorts. Designed so an admin can spot abuse
 * patterns (one sender flooding many strangers, same receiver claiming
 * from many senders, etc.). */
const STATUS_OPTIONS = ['all', 'complete', 'partial', 'pending'];
const STATUS_META = {
  complete: { tone: 'success', label: 'Complete' },
  partial:  { tone: 'warning', label: 'Partial' },
  pending:  { tone: 'info',    label: 'Pending' },
};

function formatDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    + ', ' + new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export default function AdminTransactions({ onNavigate }) {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch]   = useState('');
  const [sortKey, setSortKey] = useState('shared_at');
  const [sortDir, setSortDir] = useState('desc');

  useEffect(() => {
    getCupTransactions()
      .then(setRows)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  function handleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  }

  const filtered = useMemo(() => {
    let list = rows;
    if (statusFilter !== 'all') list = list.filter(r => r.status === statusFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(r =>
        r.sender?.display_name?.toLowerCase().includes(q) ||
        r.sender?.email?.toLowerCase().includes(q) ||
        r.receiver?.display_name?.toLowerCase().includes(q) ||
        r.receiver?.email?.toLowerCase().includes(q) ||
        r.batch_id?.toLowerCase().includes(q) ||
        r.cup_ids.some(id => id.toLowerCase().includes(q))
      );
    }
    return [...list].sort((a, b) => {
      let av = a[sortKey], bv = b[sortKey];
      if (sortKey === 'shared_at' || sortKey === 'claimed_at') {
        av = av ? new Date(av).getTime() : 0;
        bv = bv ? new Date(bv).getTime() : 0;
      }
      if (sortKey === 'sender') { av = a.sender?.display_name || ''; bv = b.sender?.display_name || ''; }
      if (sortKey === 'receiver') { av = a.receiver?.display_name || ''; bv = b.receiver?.display_name || ''; }
      if (av == null) av = '';
      if (bv == null) bv = '';
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [rows, statusFilter, search, sortKey, sortDir]);

  const counts = useMemo(() => ({
    total:    rows.length,
    complete: rows.filter(r => r.status === 'complete').length,
    partial:  rows.filter(r => r.status === 'partial').length,
    pending:  rows.filter(r => r.status === 'pending').length,
    totalCups: rows.reduce((s, r) => s + r.cup_count, 0),
  }), [rows]);

  const sort = { key: sortKey, dir: sortDir };
  const th = (label, field, opts = {}) => (
    <SortTh label={label} field={field} sort={sort} onSort={handleSort} sortable={opts.sortable !== false} style={opts.width ? { width: opts.width } : undefined} className={opts.className} />
  );

  return (
    <div className="ui-page tx-page">
      <PageHeader
        title="Cup shares"
        subtitle={loading
          ? 'Cups customers shared with each other.'
          : `Cups customers shared with each other. ${counts.total} share${counts.total === 1 ? '' : 's'} · ${counts.totalCups} cup${counts.totalCups === 1 ? '' : 's'} moved.`}
      />

      <div className="ot-toolbar">
        <Segmented
          ariaLabel="Filter by status"
          value={statusFilter}
          onChange={setStatusFilter}
          options={STATUS_OPTIONS.map(s => ({
            id: s,
            label: s === 'all' ? 'All' : STATUS_META[s].label,
            count: loading ? undefined : (s === 'all' ? counts.total : counts[s]),
          }))}
        />
        <SearchBox
          className="tx-search"
          value={search}
          onChange={setSearch}
          placeholder="Search sender, receiver, batch"
          label="Search transfers"
        />
      </div>

      <div className="ui-card ot-table-card tx-table-wrap">
        {loading ? (
          <Spinner label="Loading transfers…" />
        ) : (
          <table className="ui-table tx-table">
            <thead>
              <tr>
                {th('Sender', 'sender')}
                <th className="tx-arrow" aria-label="to" />
                {th('Receiver', 'receiver')}
                {th('Cups', 'cup_count')}
                {th('Status', 'status')}
                {th('Shared', 'shared_at')}
                {th('Claimed', 'claimed_at')}
                {th('Batch', 'batch_id', { sortable: false })}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr className="tx-empty-row"><td colSpan={8}>
                  {rows.length === 0 ? (
                    <EmptyState icon={Repeat} title="No cup transfers yet">
                      Cup shares between customers will appear here.
                    </EmptyState>
                  ) : (
                    <EmptyState
                      icon={Search}
                      title="No transfers match these filters"
                      action={<Button variant="outline" size="sm" onClick={() => { setStatusFilter('all'); setSearch(''); }}>Reset filters</Button>}
                    >
                      {`${rows.length} transfer${rows.length === 1 ? '' : 's'} in total. Broaden the status or clear the search.`}
                    </EmptyState>
                  )}
                </td></tr>
              ) : filtered.map(t => {
                const meta = STATUS_META[t.status] || { tone: 'neutral', label: t.status };
                return (
                  <tr key={t.batch_id}>
                    <td>
                      <UserCell user={t.sender} onClick={() => onNavigate?.('users')} />
                    </td>
                    <td className="tx-arrow" aria-hidden="true">
                      <ArrowRight size={15} />
                    </td>
                    <td>
                      {t.receiver ? (
                        <UserCell user={t.receiver} onClick={() => onNavigate?.('users')} />
                      ) : (
                        <span className="tx-pending-receiver">Waiting for scan</span>
                      )}
                    </td>
                    <td className="tx-cups">
                      <span className="tx-cups__big">{t.cup_count}</span>
                      {t.claimed_count < t.cup_count && (
                        <span className="tx-cups__claimed">{t.claimed_count} claimed</span>
                      )}
                    </td>
                    <td>
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                    </td>
                    <td className="ot-date">{formatDate(t.shared_at)}</td>
                    <td className="ot-date">{t.claimed_at ? formatDate(t.claimed_at) : <span className="ot-faint">—</span>}</td>
                    <td className="ot-mono tx-batch" title={t.batch_id}>{(t.batch_id || '').slice(0, 8)}…</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function UserCell({ user, onClick }) {
  if (!user) return <span className="ot-faint">—</span>;
  const label = user.display_name || user.email || user.id?.slice(0, 8);
  return (
    <button type="button" className="ot-person" onClick={onClick}>
      <Avatar name={label} seed={user.id || user.email || label} size={28} />
      <span className="ot-person__text">
        <span className="ot-person__name">{user.display_name || 'Customer'}</span>
        {user.email && <span className="ot-person__sub">{user.email}</span>}
      </span>
    </button>
  );
}
