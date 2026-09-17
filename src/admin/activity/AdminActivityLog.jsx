import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, History, LoaderCircle, Search, SearchX, X } from 'lucide-react';
import { getAdminActionLog } from '../lib/adminApi';
import { Badge, Card, CardHeader, EmptyState, PageHeader } from '../ui';
import './AdminActivityLog.css';

/* AdminActivityLog — searchable, filterable view over admin_action_log.
 *
 * Owners + admins see every action for the open venue, plus the ones tied to
 * no venue; other roles see only their own (RLS enforces this). Each row can be expanded to inspect
 * the JSON before/after diff captured at the time of the action.
 *
 * `tone` is a Badge tone: success | danger | primary | info | warning | neutral.
 * An action missing here still shows, with its key turned into words. */

const ACTION_LABELS = {
  'admin.signup':        { tone: 'success', label: 'Joined the team' },
  'claim.approve':       { tone: 'success', label: 'Approved cashback claim' },
  'claim.reject':        { tone: 'danger',  label: 'Rejected cashback claim' },
  'claim.hide_image':    { tone: 'neutral', label: 'Hid a receipt photo' },
  'claim.unhide_image':  { tone: 'neutral', label: 'Showed a receipt photo again' },
  'team.invite':         { tone: 'primary', label: 'Invited teammate' },
  'team.role':           { tone: 'primary', label: 'Changed role' },
  'team.block':          { tone: 'danger',  label: 'Blocked teammate' },
  'team.unblock':        { tone: 'success', label: 'Unblocked teammate' },
  'team.delete':         { tone: 'danger',  label: 'Removed teammate' },
  'team.invite_revoke':  { tone: 'neutral', label: 'Revoked invitation' },
  'org.update':          { tone: 'info',    label: 'Updated organisation' },
  'location.create':     { tone: 'primary', label: 'Created location' },
  'location.update':     { tone: 'info',    label: 'Updated location' },
  'location.delete':     { tone: 'danger',  label: 'Deleted location' },
  'team.access':         { tone: 'primary', label: 'Changed someone’s access' },
  'team.invite_access':  { tone: 'primary', label: 'Changed an invitation' },
  'role.save':           { tone: 'primary', label: 'Saved a role' },
  'role.delete':         { tone: 'danger',  label: 'Deleted a role' },
  'workspace.tabs':      { tone: 'info',    label: 'Changed workspace tabs' },
  'workspace.topbar':    { tone: 'info',    label: 'Changed the top bar' },
  'workspace.display':   { tone: 'info',    label: 'Changed how tiles look' },
  'data.delete':         { tone: 'danger',  label: 'Deleted organisation data' },
  'org.mode':            { tone: 'warning', label: 'Changed a programme' },
  'org.archive':         { tone: 'danger',  label: 'Archived an organisation' },
  'org.restore':         { tone: 'success', label: 'Restored an organisation' },
  'report.export':       { tone: 'info',    label: 'Exported a report' },
  'pii.reveal':          { tone: 'warning', label: 'Revealed personal data' },
  'user.balance_adjust': { tone: 'warning', label: 'Adjusted a cup balance' },
  'user.merge':          { tone: 'primary', label: 'Merged two accounts' },
  'user.merge_by_email': { tone: 'primary', label: 'Accounts merged by email' },
  'customer.delete':     { tone: 'danger',  label: 'Deleted a customer' },
  'donation.transfer':   { tone: 'success', label: 'Transferred donations' },
  'design.publish':      { tone: 'primary', label: 'Published the app design' },
  'receipt.generate':    { tone: 'primary', label: 'Generated receipts' },
  'cup_batch.generate':  { tone: 'primary', label: 'Generated a cup batch' },
  'cup_batch.revoke':    { tone: 'danger',  label: 'Revoked a cup batch' },
  'cup_batch.unrevoke':  { tone: 'success', label: 'Restored a cup batch' },
  'cup_batch.delete':    { tone: 'danger',  label: 'Deleted a cup batch' },
  'support.message':     { tone: 'neutral', label: 'Sent a support message' },
};

function humanize(action) {
  const text = String(action || 'Unknown action').replace(/[._]+/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function metaFor(action) {
  const m = ACTION_LABELS[action];
  return { tone: m?.tone || 'neutral', label: m?.label || humanize(action) };
}

/* Same avatar palette as Master settings → People. #E24400 was the old
 * default colour and counts as "none chosen". */
const AVATAR_TONES = ['#5B3FD6', '#0E9E74', '#E8930C', '#1F8FCE', '#E03E6B', '#0F8A7E', '#8B6CFF', '#E2552B'];
function avatarColor(color, key) {
  if (color && color !== '#E24400') return color;
  let h = 0;
  const s = String(key || '?');
  for (let i = 0; i < s.length; i++) h = (31 * h + s.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

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
        metaFor(e.action).label.toLowerCase().includes(q) ||
        JSON.stringify(e.metadata || {}).toLowerCase().includes(q)
      );
    }
    return list;
  }, [events, actionFilter, search]);

  const toolbar = (
    <>
      <select
        className="ui-select alog-filter"
        value={actionFilter}
        onChange={e => setActionFilter(e.target.value)}
        aria-label="Filter by action"
      >
        {actionTypes.map(t => (
          <option key={t} value={t}>
            {t === 'all' ? `All actions (${events.length})` : metaFor(t).label}
          </option>
        ))}
      </select>
      <span className="alog-search">
        <Search size={14} aria-hidden="true" />
        <input
          className="alog-search__input"
          placeholder="Search person, action or ID"
          aria-label="Search the activity log"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {search && (
          <button type="button" className="alog-search__clear" aria-label="Clear search" onClick={() => setSearch('')}>
            <X size={13} />
          </button>
        )}
      </span>
    </>
  );

  const content = (
    <>
      <CardHeader
        title={embedded ? 'Activity log' : 'All actions'}
        icon={History}
        subtitle={(
          <>
            Every change made in the dashboard, with what it looked like before and after.
            {!loading && <> <b className="alog-count">{events.length.toLocaleString()}</b> event{events.length === 1 ? '' : 's'}.</>}
          </>
        )}
        ruled
        actions={toolbar}
      />

      {loading ? (
        <div className="alog-loading">
          <EmptyState icon={LoaderCircle} title="Loading activity…" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={events.length ? SearchX : History}
          title={events.length ? 'No matching events' : 'No activity yet'}
        >
          {events.length
            ? 'Try another action or a different search.'
            : 'Changes people make in the dashboard will show up here.'}
        </EmptyState>
      ) : (
        <ul className="alog-feed">
          {filtered.map(ev => {
            const meta = metaFor(ev.action);
            const expanded = expandedId === ev.id;
            const actorName = ev.actor?.display_name || ev.actor_email || 'Unknown';
            const hasMeta = !!ev.metadata && Object.keys(ev.metadata).length > 0;
            const hasDetail = !!(ev.before_state || ev.after_state || hasMeta || ev.user_agent || ev.ip);
            return (
              <li key={ev.id} className={`alog-row${expanded ? ' alog-row--open' : ''}`}>
                <button
                  type="button"
                  className="alog-row__main"
                  aria-expanded={expanded}
                  onClick={() => setExpandedId(expanded ? null : ev.id)}
                >
                  <span
                    className="alog-avatar"
                    style={{ background: avatarColor(ev.actor?.color, ev.actor_email || actorName) }}
                    title={ev.actor_email}
                    aria-hidden="true"
                  >
                    {ev.actor?.avatar_url
                      ? <img src={ev.actor.avatar_url} alt="" />
                      : (actorName[0] || '?').toUpperCase()}
                  </span>
                  <span className="alog-row__text">
                    <span className="alog-row__line">
                      <span className="alog-row__actor">{actorName}</span>
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                      {ev.target_id && (
                        <span className="alog-target" title={`${ev.target_type || ''} ${ev.target_id}`.trim()}>
                          {ev.target_type && <span className="alog-target__type">{ev.target_type}</span>}
                          <span className="alog-target__id">{String(ev.target_id).slice(0, 8)}…</span>
                        </span>
                      )}
                    </span>
                    <span className="alog-row__when">{formatTime(ev.created_at)}</span>
                  </span>
                  <ChevronDown size={16} className="alog-row__chev" aria-hidden="true" />
                </button>

                {expanded && (
                  <div className="alog-detail">
                    {!hasDetail && <p className="alog-detail__none">No details were recorded for this action.</p>}
                    {(ev.before_state || ev.after_state) && (
                      <div className="alog-diff">
                        {ev.before_state && <Block title="Before" payload={ev.before_state} />}
                        {ev.after_state && <Block title="After" payload={ev.after_state} />}
                      </div>
                    )}
                    {hasMeta && <Block title="Details" payload={ev.metadata} />}
                    {(ev.user_agent || ev.ip) && (
                      <dl className="alog-meta">
                        {ev.user_agent && (
                          <div className="alog-meta__row">
                            <dt>Browser</dt>
                            <dd>{ev.user_agent}</dd>
                          </div>
                        )}
                        {ev.ip && (
                          <div className="alog-meta__row">
                            <dt>IP address</dt>
                            <dd>{ev.ip}</dd>
                          </div>
                        )}
                      </dl>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );

  if (embedded) return <div className="alog">{content}</div>;

  return (
    <div className="ui-page">
      <PageHeader
        title="Activity log"
        subtitle="Who changed what in the dashboard, and when."
      />
      <Card className="alog">{content}</Card>
    </div>
  );
}

function Block({ title, payload }) {
  return (
    <div className="alog-block">
      <div className="alog-block__title">{title}</div>
      <pre className="alog-block__body">{JSON.stringify(payload, null, 2)}</pre>
    </div>
  );
}
