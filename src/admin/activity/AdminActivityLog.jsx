import { useEffect, useMemo, useState } from 'react';
import { getAdminActionLog } from '../lib/adminApi';
import Spinner from '../lib/Spinner';
import './AdminActivityLog.css';

/* AdminActivityLog — searchable, filterable view over admin_action_log.
 *
 * Owners + admins see every action in their org; other roles see only
 * their own (RLS enforces this). Each row can be expanded to inspect
 * the JSON before/after diff captured at the time of the action. */

const ACTION_LABELS = {
  'admin.signup':       { color: '#1A8737', label: 'Joined the team' },
  'claim.approve':      { color: '#16A34A', label: 'Approved cashback claim' },
  'claim.reject':       { color: '#DC2626', label: 'Rejected cashback claim' },
  'team.invite':        { color: '#5333A5', label: 'Invited teammate' },
  'team.role':          { color: '#7C3AED', label: 'Changed role' },
  'team.block':         { color: '#DC2626', label: 'Blocked teammate' },
  'team.unblock':       { color: '#16A34A', label: 'Unblocked teammate' },
  'team.delete':        { color: '#DC2626', label: 'Removed teammate' },
  'team.invite_revoke': { color: '#7A7166', label: 'Revoked invitation' },
  'org.update':         { color: '#FD6F46', label: 'Updated organisation' },
  'location.create':    { color: '#5333A5', label: 'Created location' },
  'location.update':    { color: '#FD6F46', label: 'Updated location' },
  'location.delete':    { color: '#DC2626', label: 'Deleted location' },
};

function formatTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    + ', ' + new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export default function AdminActivityLog({ embedded = false }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');
  const [actionFilter, setActionFilter] = useState('all');
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    getAdminActionLog()
      .then(setEvents)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const actionTypes = useMemo(() => {
    const set = new Set(events.map(e => e.action));
    return ['all', ...Array.from(set).sort()];
  }, [events]);

  const filtered = useMemo(() => {
    let list = events;
    if (actionFilter !== 'all') list = list.filter(e => e.action === actionFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(e =>
        e.action?.toLowerCase().includes(q) ||
        e.actor_email?.toLowerCase().includes(q) ||
        e.actor?.display_name?.toLowerCase().includes(q) ||
        e.target_id?.toLowerCase().includes(q) ||
        e.target_type?.toLowerCase().includes(q) ||
        JSON.stringify(e.metadata || {}).toLowerCase().includes(q)
      );
    }
    return list;
  }, [events, actionFilter, search]);

  return (
    <div className={`al-page${embedded ? ' al-page--embedded' : ''}`}>
      <header className="al-header">
        <h1 className="al-header__title">Activity Log</h1>
        <p className="al-header__sub">
          Every admin action with full before / after diff. <strong>{events.length}</strong> events.
        </p>
      </header>

      <div className="al-toolbar">
        <select
          className="al-filter"
          value={actionFilter}
          onChange={e => setActionFilter(e.target.value)}
        >
          {actionTypes.map(t => (
            <option key={t} value={t}>
              {t === 'all' ? `All actions (${events.length})` : (ACTION_LABELS[t]?.label || t)}
            </option>
          ))}
        </select>

        <div className="al-search-wrap">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9E9A93" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            className="al-search"
            placeholder="Search action, actor, target id…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <Spinner label="Loading activity…" />
      ) : (
        <div className="al-feed">
          {filtered.length === 0 ? (
            <div className="al-empty">No matching events</div>
          ) : filtered.map(ev => {
            const meta = ACTION_LABELS[ev.action] || { color: '#7A7166', label: ev.action };
            const expanded = expandedId === ev.id;
            const actorName = ev.actor?.display_name || ev.actor_email || 'Unknown';
            return (
              <div
                key={ev.id}
                className={`al-row${expanded ? ' al-row--expanded' : ''}`}
                onClick={() => setExpandedId(expanded ? null : ev.id)}
              >
                <div className="al-row__main">
                  <span
                    className="al-actor"
                    style={{ background: ev.actor?.color || '#FD6F46' }}
                    title={ev.actor_email}
                  >
                    {ev.actor?.avatar_url
                      ? <img src={ev.actor.avatar_url} alt="" />
                      : actorName[0].toUpperCase()}
                  </span>
                  <div className="al-row__text">
                    <div className="al-row__line">
                      <strong className="al-row__actor-name">{actorName}</strong>
                      <span className="al-row__action" style={{ color: meta.color }}>
                        {meta.label}
                      </span>
                      {ev.target_id && (
                        <span className="al-row__target">
                          <span className="al-row__target-type">{ev.target_type}</span>
                          <span className="al-row__target-id">{String(ev.target_id).slice(0, 8)}…</span>
                        </span>
                      )}
                    </div>
                    <div className="al-row__when">{formatTime(ev.created_at)}</div>
                  </div>
                  <svg
                    className={`al-chevron${expanded ? ' al-chevron--up' : ''}`}
                    width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  ><path d="M5 8L10 13L15 8"/></svg>
                </div>

                {expanded && (
                  <div className="al-row__diff">
                    {ev.before_state && (
                      <Block title="Before" payload={ev.before_state} />
                    )}
                    {ev.after_state && (
                      <Block title="After" payload={ev.after_state} />
                    )}
                    {ev.metadata && Object.keys(ev.metadata).length > 0 && (
                      <Block title="Metadata" payload={ev.metadata} />
                    )}
                    {ev.user_agent && (
                      <div className="al-meta-row">
                        <span className="al-meta-label">User agent</span>
                        <span className="al-meta-val">{ev.user_agent}</span>
                      </div>
                    )}
                    {ev.ip && (
                      <div className="al-meta-row">
                        <span className="al-meta-label">IP</span>
                        <span className="al-meta-val">{ev.ip}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Block({ title, payload }) {
  return (
    <div className="al-block">
      <div className="al-block__title">{title}</div>
      <pre className="al-block__body">{JSON.stringify(payload, null, 2)}</pre>
    </div>
  );
}
