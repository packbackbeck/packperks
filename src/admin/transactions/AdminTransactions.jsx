import { useEffect, useMemo, useState } from 'react';
import { getCupTransactions } from '../lib/adminApi';
import Spinner from '../lib/Spinner';
import QuickLinks from '../shared/QuickLinks';
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

function formatDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    + ', ' + new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function SortIcon({ active, dir }) {
  return (
    <span className={`tx-sort-icon${active ? ' tx-sort-icon--active' : ''}`}>
      {active ? (dir === 'asc' ? '↑' : '↓') : '↕'}
    </span>
  );
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

  function ThCol({ label, field, sortable = true, width }) {
    return (
      <th
        style={width ? { width } : undefined}
        className={sortable ? 'tx-th tx-th--sortable' : 'tx-th'}
        onClick={sortable ? () => handleSort(field) : undefined}
      >
        {label}
        {sortable && <SortIcon active={sortKey === field} dir={sortDir} />}
      </th>
    );
  }

  return (
    <div className="admin-tx">
      <header className="tx-header">
        <h1 className="tx-header__title">Transactions</h1>
        <p className="tx-header__sub">
          <span className="tx-chip">{counts.total} shares</span>
          <span className="tx-chip tx-chip--complete">{counts.complete} complete</span>
          <span className="tx-chip tx-chip--partial">{counts.partial} partial</span>
          <span className="tx-chip tx-chip--pending">{counts.pending} pending</span>
          <span className="tx-chip">{counts.totalCups} cups moved</span>
        </p>
      </header>

      <div className="tx-toolbar">
        <div className="tx-filter-group">
          {STATUS_OPTIONS.map(s => (
            <button
              key={s}
              type="button"
              className={`tx-filter-btn${statusFilter === s ? ' tx-filter-btn--active' : ''}`}
              onClick={() => setStatusFilter(s)}
            >
              {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <div className="tx-search-wrap">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9E9A93" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            className="tx-search"
            placeholder="Search sender, receiver, batch…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="tx-table-wrap">
        {loading ? (
          <Spinner label="Loading transactions…" />
        ) : (
          <table className="tx-table">
            <thead>
              <tr>
                <ThCol label="Sender"     field="sender" />
                <ThCol label=""           field="arrow"     sortable={false} width={40} />
                <ThCol label="Receiver"   field="receiver" />
                <ThCol label="Cups"       field="cup_count" />
                <ThCol label="Status"     field="status" />
                <ThCol label="Shared"     field="shared_at" />
                <ThCol label="Claimed"    field="claimed_at" />
                <ThCol label="Batch"      field="batch_id"  sortable={false} />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={8} className="tx-empty">No transactions yet — cup shares between customers will appear here.</td></tr>
              ) : filtered.map(t => (
                <tr key={t.batch_id} className="tx-row">
                  <td>
                    <UserCell user={t.sender} onClick={() => onNavigate?.('users')} />
                  </td>
                  <td className="tx-arrow" aria-hidden>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="5" y1="12" x2="19" y2="12"/>
                      <polyline points="12 5 19 12 12 19"/>
                    </svg>
                  </td>
                  <td>
                    {t.receiver ? (
                      <UserCell user={t.receiver} onClick={() => onNavigate?.('users')} />
                    ) : (
                      <span className="tx-pending-receiver">— waiting for scan —</span>
                    )}
                  </td>
                  <td className="tx-cups">
                    <span className="tx-cups__big">{t.cup_count}</span>
                    {t.claimed_count < t.cup_count && (
                      <span className="tx-cups__claimed">{t.claimed_count} claimed</span>
                    )}
                  </td>
                  <td>
                    <span className={`tx-status tx-status--${t.status}`}>{t.status}</span>
                  </td>
                  <td className="tx-date">{formatDate(t.shared_at)}</td>
                  <td className="tx-date">{t.claimed_at ? formatDate(t.claimed_at) : <span className="tx-muted">—</span>}</td>
                  <td className="tx-mono" title={t.batch_id}>{(t.batch_id || '').slice(0, 8)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <QuickLinks currentPage="transactions" onNavigate={onNavigate} />
    </div>
  );
}

function UserCell({ user, onClick }) {
  if (!user) return <span className="tx-muted">—</span>;
  const label = user.display_name || user.email || user.id?.slice(0, 8);
  return (
    <button type="button" className="tx-user" onClick={onClick}>
      <span className="tx-user__avatar">
        {label?.[0]?.toUpperCase()}
      </span>
      <span className="tx-user__info">
        <span className="tx-user__name">{user.display_name || 'Customer'}</span>
        {user.email && <span className="tx-user__email">{user.email}</span>}
      </span>
    </button>
  );
}
