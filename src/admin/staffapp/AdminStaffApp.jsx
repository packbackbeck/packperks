import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Ban, Check, Copy, ExternalLink, History, MailPlus, MoreHorizontal, Power, QrCode, RotateCcw, ScanQrCode,
  Smartphone, UserCheck, UserMinus, Users, X,
} from 'lucide-react';
import { useOrg } from '../context/OrgContext';
import { relativeTime } from '../master/masterApi';
import {
  Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Menu, MenuItem, MenuSeparator, Modal,
  PageHeader, Segmented, Switch, Tabs,
} from '../ui';
import { RESULT_TEXT, STAFF_APP_URL, staffAdmin } from './staffAppApi';
import '../master/MasterSettings.css';
import './AdminStaffApp.css';

/* ─────────────────────────────────────────────────────────────────────
 * Programme → Staff app, for the open venue: the switch, who can use the
 * app (and who is asking to), every code staff made, and a preview.
 * Everything goes through the staff-app edge function (admin_* actions).
 * ───────────────────────────────────────────────────────────────────── */

const CODE_STATUS = {
  waiting: { label: 'Waiting', tone: 'info' },
  claimed: { label: 'Collected', tone: 'success' },
  partly_claimed: { label: 'Partly collected', tone: 'warning' },
  expired: { label: 'Expired', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

function whenText(iso) {
  const d = new Date(iso);
  const today = new Date();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `Today, ${time}`;
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${time}`;
}

function Person({ m, sub }) {
  return (
    <div className="ms-person">
      <span className="ms-avatar sfa-avatar" aria-hidden="true">
        {m.avatar_url ? <img src={m.avatar_url} alt="" /> : (m.name || m.email).slice(0, 1).toUpperCase()}
      </span>
      <span className="ms-person__text">
        <span className="ms-person__name">{m.name || m.email}</span>
        <span className="ms-person__email">{sub ?? (m.name ? m.email : '')}</span>
      </span>
    </div>
  );
}

/* The staff member who made a code, as a small tag. */
export function StaffTag({ staff }) {
  if (!staff) return <span className="sfa-tag sfa-tag--gone">Removed staff</span>;
  const label = staff.name || staff.email;
  return (
    <span className="sfa-tag" title={staff.email}>
      <span className="sfa-tag__dot" aria-hidden="true">
        {staff.avatar_url ? <img src={staff.avatar_url} alt="" /> : label.slice(0, 1).toUpperCase()}
      </span>
      {label}
    </span>
  );
}

function statusBadge(m) {
  if (m.status === 'blocked') return <Badge tone="danger">Paused</Badge>;
  if (m.status === 'active') return <Badge tone="success">Active</Badge>;
  if (m.status === 'requested') return <Badge tone="warning">Asking</Badge>;
  return <Badge tone="info">Invited</Badge>;
}

export default function AdminStaffApp() {
  const { activeOrg } = useOrg();
  const orgId = activeOrg?.id || null;
  const [loaded, setState] = useState(null);
  // What was loaded belongs to one venue; after switching, show nothing old.
  const state = loaded && loaded.org.id === orgId ? loaded : null;
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [tab, setTab] = useState('accounts');
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    try {
      setState(await staffAdmin('admin_state', orgId));
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, [orgId]);

  useEffect(() => {
    let alive = true;
    if (!orgId) return undefined;
    staffAdmin('admin_state', orgId)
      .then(res => { if (alive) { setState(res); setError(null); } })
      .catch(e => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [orgId]);

  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  async function act(key, fn, done) {
    setBusy(key);
    setError(null);
    try {
      const res = await fn();
      if (done) setNotice(typeof done === 'function' ? done(res) : done);
      await load();
      return res;
    } catch (e) {
      setError(e.message);
      if (e.code === 'not_requested' || e.code === 'not_found') await load();
      return null;
    } finally {
      setBusy(null);
    }
  }

  const staff = useMemo(() => state?.staff || [], [state]);
  const requests = staff.filter(m => m.status === 'requested');
  const members = staff.filter(m => m.status !== 'requested');
  const canEdit = !!state?.can_edit;
  const on = !!state?.org?.enabled;
  const month = members.reduce((t, m) => ({ codes: t.codes + m.totals.codes30, cups: t.cups + m.totals.cups30 }), { codes: 0, cups: 0 });

  return (
    <div className="ui-page sfa">
      <PageHeader
        title="Staff app"
        subtitle="The phone app your venue staff use to turn returned cups into a QR code that customers scan."
      >
        <CopyLink />
        <a className="ui-btn ui-btn--outline" href="/staff" target="_blank" rel="noopener noreferrer">
          <ExternalLink size={15} aria-hidden="true" /> Open the app
        </a>
      </PageHeader>

      {error && <p className="sfa-alert" role="alert">{error}</p>}
      {notice && <p className="sfa-ok" role="status">{notice}</p>}

      {!state ? (
        !error && <div className="sfa-skeleton" aria-busy="true"><i /><i /></div>
      ) : (
        <>
          <section className={`sfa-power${on ? ' is-on' : ''}`} aria-labelledby="sfa-power-title">
            <span className="sfa-power__icon" aria-hidden="true"><Power size={22} /></span>
            <div className="sfa-power__text">
              <h2 id="sfa-power-title" className="sfa-power__title">
                {on ? `On for ${state.org.name}` : `Off for ${state.org.name}`}
              </h2>
              <p className="sfa-power__sub">
                {on
                  ? 'Staff on the list can sign in and make cup QR codes. New people can ask for access.'
                  : 'Nobody can sign in or make codes. The list and past codes stay as they are.'}
              </p>
              <dl className="sfa-power__facts">
                <div><dt>Staff</dt><dd>{members.filter(m => m.status === 'active').length}</dd></div>
                <div><dt>Asking</dt><dd>{requests.length}</dd></div>
                <div><dt>Codes, 30 days</dt><dd>{month.codes}</dd></div>
                <div><dt>Cups, 30 days</dt><dd>{month.cups}</dd></div>
              </dl>
            </div>
            <div className="sfa-power__switch">
              <span className="sfa-power__state">{on ? 'On' : 'Off'}</span>
              <Switch
                checked={on}
                disabled={!canEdit || busy === 'toggle'}
                label={`Staff app for ${state.org.name}`}
                onChange={v => act('toggle', () => staffAdmin('admin_toggle', orgId, { enabled: v }),
                  `The staff app is ${v ? 'on' : 'off'} for ${state.org.name}.`)}
              />
            </div>
          </section>
          {!canEdit && <p className="sfa-hint">Your role can look at this page and answer requests. Someone who can change settings turns the app on or off and adds staff.</p>}

          <Tabs
            ariaLabel="Staff app"
            value={tab}
            onChange={setTab}
            tabs={[
              { id: 'accounts', label: 'Accounts', icon: Users, count: requests.length || undefined },
              { id: 'logs', label: 'Logs', icon: History },
              { id: 'preview', label: 'Preview', icon: Smartphone },
            ]}
          />

          {tab === 'accounts' && (
            <Accounts
              orgId={orgId}
              state={state}
              requests={requests}
              members={members}
              canEdit={canEdit}
              busy={busy}
              act={act}
            />
          )}
          {tab === 'logs' && <Logs orgId={orgId} state={state} members={members} />}
          {tab === 'preview' && <Preview org={state.org} minutes={state.limits?.code_minutes || 15} />}
        </>
      )}
    </div>
  );
}

function CopyLink() {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(STAFF_APP_URL);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard blocked */ }
  }
  return <Button icon={copied ? Check : Copy} onClick={copy}>{copied ? 'Copied' : 'Copy link'}</Button>;
}

/* ── Accounts ───────────────────────────────────────────────────────── */
function Accounts({ orgId, state, requests, members, canEdit, busy, act }) {
  const [emails, setEmails] = useState('');
  const [results, setResults] = useState(null);
  const [confirm, setConfirm] = useState(null);

  async function invite(e) {
    e.preventDefault();
    const list = emails.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
    if (!list.length) return;
    setResults(null);
    const res = await act('invite', () => staffAdmin('admin_invite', orgId, { emails: list }));
    if (res) {
      setResults(res.results);
      if (res.results.some(r => ['invited', 'reminded', 'approved', 'added_email_failed'].includes(r.result))) setEmails('');
    }
  }

  async function runConfirm() {
    const { kind, member } = confirm;
    const ok = kind === 'remove'
      ? await act('confirm', () => staffAdmin('admin_remove', orgId, { id: member.id }), `${member.email} was removed.`)
      : await act('confirm', () => staffAdmin('admin_status', orgId, { id: member.id, status: kind === 'pause' ? 'blocked' : 'active' }),
        `${member.email} is ${kind === 'pause' ? 'paused' : 'back on'}.`);
    if (ok) setConfirm(null);
  }

  return (
    <div className="sfa-stack">
      <Card>
        <CardHeader
          title="Add staff"
          icon={UserCheck}
          ruled
          subtitle={requests.length
            ? 'People who asked for access wait here until someone approves them. They get an email when you do.'
            : 'Add work email addresses, or let people ask for access from the app. Addresses ending in @packback.network get in without approval.'}
        />
        <CardBody>
          {requests.length > 0 && (
            <ul className="sfa-requests" aria-label="Asking for access">
              {requests.map(m => (
                <li key={m.id} className="sfa-request">
                  <Person m={m} sub={`${m.name ? `${m.email} · ` : ''}asked ${relativeTime(m.requested_at || m.created_at)}`} />
                  <span className="sfa-request__label">Asking to join</span>
                  <div className="sfa-request__actions">
                    <Button
                      size="sm"
                      icon={X}
                      disabled={!!busy}
                      onClick={() => act(`decline:${m.id}`, () => staffAdmin('admin_decline', orgId, { id: m.id }), `${m.email} was declined.`)}
                    >
                      Decline
                    </Button>
                    <Button
                      size="sm"
                      variant="primary"
                      icon={Check}
                      disabled={!!busy}
                      onClick={() => act(`approve:${m.id}`, () => staffAdmin('admin_approve', orgId, { id: m.id }),
                        (res) => `${m.email} is approved${res?.emailed ? ' and was emailed' : ''}.`)}
                    >
                      {busy === `approve:${m.id}` ? 'Approving…' : 'Approve'}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {canEdit ? (
            <form className="sa-add" onSubmit={invite}>
              <Field label="Add by email" htmlFor="sfa-emails" hint="Separate several addresses with commas or new lines. Up to 20 at a time. Each person gets an email with the link.">
                <textarea
                  id="sfa-emails"
                  className="ui-textarea sa-add__input"
                  rows={2}
                  placeholder="barista@venue.com, shift.lead@venue.com"
                  value={emails}
                  onChange={e => setEmails(e.target.value)}
                />
              </Field>
              <Button type="submit" variant="primary" icon={MailPlus} disabled={!!busy || !emails.trim() || !state.org.enabled}>
                {busy === 'invite' ? 'Adding…' : 'Add and email them'}
              </Button>
            </form>
          ) : requests.length === 0 && (
            <p className="sfa-hint sfa-hint--flat">Nobody is asking for access right now.</p>
          )}
          {canEdit && !state.org.enabled && <p className="sfa-hint sfa-hint--flat">Switch the app on above to add staff.</p>}

          {results && (
            <ul className="sa-results" role="status">
              {results.map(r => (
                <li key={r.email} className={`sa-results__row sa-results__row--${['invited', 'reminded', 'approved'].includes(r.result) ? 'ok' : 'warn'}`}>
                  <b>{r.email}</b> {RESULT_TEXT[r.result] || r.result}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Staff"
          icon={Users}
          ruled
          subtitle="Everyone who can use the app at this venue, and how many cups they turned into codes. Cancelled codes don't count."
        />
        <CardBody flush={members.length > 0}>
          {members.length === 0 ? (
            <EmptyState icon={QrCode} title="Nobody on the list yet">
              {canEdit ? 'Add the first email address above, or share the link so people can ask.' : 'Nobody has been added yet.'}
            </EmptyState>
          ) : (
            <div className="ms-table-wrap">
              <table className="ui-table sfa-table">
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Status</th>
                    <th className="sfa-num">Cups made</th>
                    <th className="sfa-num">Last 30 days</th>
                    <th>Last active</th>
                    {canEdit && <th aria-label="Actions" />}
                  </tr>
                </thead>
                <tbody>
                  {members.map(m => (
                    <tr key={m.id} className={m.status === 'blocked' ? 'ms-row--muted' : ''}>
                      <td><Person m={m} sub={m.name ? m.email : m.status === 'invited' ? `Added ${relativeTime(m.created_at)}` : 'No name yet'} /></td>
                      <td>{statusBadge(m)}</td>
                      <td className="sfa-num">
                        <b>{m.totals.cups}</b>
                        <span className="sfa-num__sub">{m.totals.codes} {m.totals.codes === 1 ? 'code' : 'codes'}</span>
                      </td>
                      <td className="sfa-num">
                        {m.totals.cups30 ? <>{m.totals.cups30}<span className="sfa-num__sub">{m.totals.codes30} {m.totals.codes30 === 1 ? 'code' : 'codes'}</span></> : <span className="ms-muted">None</span>}
                      </td>
                      <td className="ms-muted">{m.last_seen_at ? relativeTime(m.last_seen_at) : 'Never'}</td>
                      {canEdit && (
                        <td className="ms-row-actions">
                          <Menu
                            align="right"
                            trigger={({ open, toggle }) => (
                              <Button variant="ghost" size="sm" icon={MoreHorizontal} aria-label={`Actions for ${m.email}`} aria-expanded={open} onClick={toggle} />
                            )}
                          >
                            {m.status === 'invited' && (
                              <MenuItem icon={MailPlus} onClick={() => act(`resend:${m.id}`, () => staffAdmin('admin_resend', orgId, { id: m.id }), `${m.email} was emailed again.`)}>
                                Send the invitation again
                              </MenuItem>
                            )}
                            {m.status === 'blocked' ? (
                              <MenuItem icon={RotateCcw} onClick={() => setConfirm({ kind: 'resume', member: m })}>Resume</MenuItem>
                            ) : (
                              <MenuItem icon={Ban} onClick={() => setConfirm({ kind: 'pause', member: m })}>Pause</MenuItem>
                            )}
                            <MenuSeparator />
                            <MenuItem icon={UserMinus} danger onClick={() => setConfirm({ kind: 'remove', member: m })}>Remove from the list</MenuItem>
                          </Menu>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <Modal
        open={!!confirm}
        onClose={() => { if (!busy) setConfirm(null); }}
        title={confirm?.kind === 'remove' ? 'Remove from the staff list?' : confirm?.kind === 'pause' ? 'Pause this person?' : 'Resume this person?'}
        icon={confirm?.kind === 'resume' ? RotateCcw : confirm?.kind === 'pause' ? Ban : UserMinus}
        iconTone={confirm?.kind === 'resume' ? 'violet' : 'rose'}
        footer={(
          <>
            <Button onClick={() => setConfirm(null)} disabled={!!busy}>Cancel</Button>
            <Button variant={confirm?.kind === 'resume' ? 'primary' : 'danger'} onClick={runConfirm} disabled={!!busy}>
              {busy === 'confirm' ? 'Working…' : confirm?.kind === 'remove' ? 'Remove' : confirm?.kind === 'pause' ? 'Pause' : 'Resume'}
            </Button>
          </>
        )}
      >
        <p className="ms-modal-text">
          {confirm?.kind === 'remove' && <><b>{confirm.member.email}</b> can no longer use the staff app. The codes they made stay in the logs. Add the email again to give access back.</>}
          {confirm?.kind === 'pause' && <><b>{confirm.member.email}</b> can't make codes until you resume them. Codes they already made keep working until they expire.</>}
          {confirm?.kind === 'resume' && <><b>{confirm.member.email}</b> can make codes again.</>}
        </p>
      </Modal>
    </div>
  );
}

/* ── Logs ───────────────────────────────────────────────────────────── */
const STATUS_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'collected', label: 'Collected' },
  { id: 'waiting', label: 'Waiting' },
  { id: 'missed', label: 'Not collected' },
];

function Logs({ orgId, state, members }) {
  const [older, setOlder] = useState([]);
  const [hasMore, setHasMore] = useState(state.has_more);
  const [loading, setLoading] = useState(false);
  const [who, setWho] = useState('all');
  const [status, setStatus] = useState('all');
  const [error, setError] = useState(null);

  const rows = useMemo(() => [...state.log, ...older], [state.log, older]);
  const shown = rows.filter(c => (who === 'all' || c.staff?.id === who) && (
    status === 'all'
    || (status === 'collected' && (c.status === 'claimed' || c.status === 'partly_claimed'))
    || (status === 'waiting' && c.status === 'waiting')
    || (status === 'missed' && (c.status === 'expired' || c.status === 'cancelled'))));

  async function more() {
    const last = rows[rows.length - 1];
    if (!last) return;
    setLoading(true);
    try {
      const res = await staffAdmin('admin_state', orgId, { before: last.created_at });
      setOlder(o => [...o, ...res.log]);
      setHasMore(res.has_more);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const people = members.filter(m => m.totals.codes > 0 || rows.some(c => c.staff?.id === m.id));

  return (
    <Card>
      <CardHeader
        title="Codes made"
        icon={ScanQrCode}
        ruled
        subtitle="Every QR code staff made at this venue, who made it, and whether a customer collected the cups."
        actions={(
          <div className="sfa-filters">
            <select className="ui-select" value={who} onChange={e => setWho(e.target.value)} aria-label="Made by">
              <option value="all">All staff</option>
              {people.map(m => <option key={m.id} value={m.id}>{m.name || m.email}</option>)}
            </select>
            <Segmented options={STATUS_FILTERS} value={status} onChange={setStatus} ariaLabel="Status" />
          </div>
        )}
      />
      <CardBody flush={shown.length > 0}>
        {error && <p className="sfa-alert" role="alert">{error}</p>}
        {shown.length === 0 ? (
          <EmptyState icon={QrCode} title={rows.length ? 'No codes match' : 'No codes yet'}>
            {rows.length ? 'Try another person or status.' : 'Codes appear here as soon as staff make them.'}
          </EmptyState>
        ) : (
          <div className="ms-table-wrap">
            <table className="ui-table sfa-table">
              <thead>
                <tr>
                  <th>Made</th>
                  <th>Made by</th>
                  <th className="sfa-num">Cups</th>
                  <th>Package</th>
                  <th>Status</th>
                  <th>Collected</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(c => {
                  const meta = CODE_STATUS[c.status] || CODE_STATUS.expired;
                  return (
                    <tr key={c.id}>
                      <td className="sfa-when">{whenText(c.created_at)}</td>
                      <td><StaffTag staff={c.staff} /></td>
                      <td className="sfa-num">
                        {c.claimed_cups > 0 && c.claimed_cups < c.cups ? `${c.claimed_cups} of ${c.cups}` : c.cups}
                      </td>
                      <td>{c.package_type === 'cup' ? 'Cups' : c.package_type}</td>
                      <td><Badge tone={meta.tone}>{meta.label}</Badge></td>
                      <td className="ms-muted">{c.claimed_at ? whenText(c.claimed_at) : c.status === 'waiting' ? 'Not yet' : 'No'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {hasMore && (
          <div className="sfa-more">
            <Button onClick={more} disabled={loading}>{loading ? 'Loading…' : 'Show older codes'}</Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/* ── Preview ────────────────────────────────────────────────────────── */
function Preview({ org, minutes }) {
  const src = `/staff?preview=${org.id}`;
  return (
    <Card>
      <CardBody>
        <div className="sfa-preview">
          <div className="sfa-phone">
            <iframe title={`Staff app preview for ${org.name}`} src={src} className="sfa-phone__screen" />
          </div>
          <div className="sfa-preview__text">
            <h3>What staff see</h3>
            <p>
              The app uses {org.name}'s colours and logo from Design & copy, so it matches the customer app.
              Try it: pick the cups and tap Show QR code. Codes made in this preview are samples and give nobody cups.
            </p>
            <ul>
              <li>After a code is shown, the button stays grey until the cups or package are touched, so one tap can't make a second code by mistake.</li>
              <li>Each code works for {minutes} minutes. The screen shows the moment a customer collects it.</li>
              <li>Staff see their own history. Every code is in Logs, tagged with who made it.</li>
            </ul>
            <a className="ui-btn ui-btn--outline" href={src} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={15} aria-hidden="true" /> Open the preview in a new tab
            </a>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
