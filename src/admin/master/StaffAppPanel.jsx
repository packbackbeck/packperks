import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Ban, Copy, ExternalLink, MailPlus, MoreHorizontal, QrCode, RotateCcw, Smartphone, Store, UserMinus, Users,
} from 'lucide-react';
import { OrgAvatar } from '../context/OrgSwitcher';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Menu, MenuItem, MenuSeparator, Modal, Switch } from '../ui';
import { inviteStaff, listStaff, relativeTime, removeStaff, setOrgStaffApp, setStaffStatus } from './masterApi';

const APP_URL = 'https://perks.packback.network/staff';

const RESULT_TEXT = {
  invited: 'invited',
  reminded: 'sent the invitation again',
  already_active: 'already has an account',
  other_venue: 'is staff at another venue',
  blocked: 'is paused, resume them instead',
  invalid_email: 'is not a valid email address',
  added_email_failed: 'added, but the email could not be sent',
  email_failed: 'the email could not be sent',
  failed: 'could not be added',
};

function statusBadge(m) {
  if (m.status === 'blocked') return <Badge tone="danger">Paused</Badge>;
  if (m.status === 'active') return <Badge tone="success">Active</Badge>;
  return <Badge tone="info">Invited</Badge>;
}

/* Master Settings → Staff app: which venues have PackPerks Staff, and who
 * may sign up for it. */
export default function StaffAppPanel({ orgs, onOrgsChanged }) {
  const [staff, setStaff] = useState(null);
  const [error, setError] = useState(null);
  const [venueId, setVenueId] = useState(null);
  const [emails, setEmails] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState(null);
  const [notice, setNotice] = useState(null);
  const [toggling, setToggling] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [copied, setCopied] = useState(false);

  const live = useMemo(
    () => orgs.filter(o => !o.deleted_at).sort((a, b) => Number(!!b.staff_app_enabled) - Number(!!a.staff_app_enabled) || a.name.localeCompare(b.name)),
    [orgs],
  );
  const enabled = live.filter(o => o.staff_app_enabled);
  const venue = enabled.find(o => o.id === venueId) || enabled[0] || null;

  const load = useCallback(async () => {
    try {
      setStaff(await listStaff());
      setError(null);
    } catch (e) {
      setError(e?.message || 'Could not load staff.');
      setStaff([]);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    listStaff()
      .then(list => { if (alive) setStaff(list); })
      .catch(e => { if (alive) { setError(e?.message || 'Could not load staff.'); setStaff([]); } });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(null), 3500);
    return () => clearTimeout(t);
  }, [notice]);

  const countByOrg = useMemo(() => {
    const out = {};
    for (const m of staff || []) out[m.org_id] = (out[m.org_id] || 0) + 1;
    return out;
  }, [staff]);
  const venueStaff = (staff || []).filter(m => m.org_id === venue?.id);

  async function toggleVenue(org, on) {
    setToggling(org.id);
    setError(null);
    try {
      await setOrgStaffApp(org, on);
      onOrgsChanged?.();
      setNotice(`The staff app is ${on ? 'on' : 'off'} for ${org.name}.`);
      if (on) setVenueId(org.id);
    } catch (e) {
      setError(e?.message || 'Could not change the venue.');
    } finally {
      setToggling(null);
    }
  }

  async function invite(e) {
    e.preventDefault();
    const list = emails.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
    if (!venue || !list.length) return;
    setBusy(true);
    setError(null);
    setResults(null);
    try {
      const res = await inviteStaff(venue.id, list);
      setResults(res);
      if (res.some(r => r.result === 'invited' || r.result === 'reminded' || r.result === 'added_email_failed')) setEmails('');
      await load();
    } catch (err) {
      setError(err?.message || 'Could not add staff.');
    } finally {
      setBusy(false);
    }
  }

  async function runConfirm() {
    const { kind, member } = confirm;
    setBusy(true);
    try {
      if (kind === 'remove') {
        await removeStaff(member);
        setNotice(`${member.email} was removed.`);
      } else {
        await setStaffStatus(member, kind === 'pause' ? 'blocked' : (member.auth_user_id ? 'active' : 'invited'));
        setNotice(`${member.email} is ${kind === 'pause' ? 'paused' : 'back on'}.`);
      }
      setConfirm(null);
      await load();
    } catch (e) {
      setError(e?.message || 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  async function resend(member) {
    setBusy(true);
    try {
      const [r] = await inviteStaff(member.org_id, [member.email]);
      setNotice(`${member.email} ${RESULT_TEXT[r?.result] || 'updated'}.`);
    } catch (e) {
      setError(e?.message || 'Could not send the invitation.');
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(APP_URL);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard blocked */ }
  }

  return (
    <div className="ms-stack">
      <Card>
        <CardHeader
          title="PackPerks Staff"
          icon={Smartphone}
          ruled
          subtitle="A phone app where venue staff make cup QR codes for customers. People sign in with email and password; only emails added below can create an account."
          actions={(
            <>
              <Button icon={copied ? undefined : Copy} onClick={copyLink}>{copied ? 'Copied' : 'Copy link'}</Button>
              <a className="ui-btn ui-btn--outline" href="/staff" target="_blank" rel="noopener noreferrer">
                <ExternalLink size={15} aria-hidden="true" /> Open the app
              </a>
            </>
          )}
        />
        <CardBody>
          {error && <p className="ms-error" role="alert">{error}</p>}
          {notice && <p className="ms-ok" role="status">{notice}</p>}
          <ul className="ms-ws__list ms-ws__list--grid sa-venues">
            {live.map(o => {
              const on = !!o.staff_app_enabled;
              return (
                <li key={o.id} className={`ms-ws__row${on ? '' : ' ms-ws__row--off'}`}>
                  <OrgAvatar org={o} size={32} />
                  <div className="ms-ws__text">
                    <p className="ms-ws__name">{o.name}</p>
                    <p className="ms-ws__desc">
                      {on
                        ? `${countByOrg[o.id] || 0} ${(countByOrg[o.id] || 0) === 1 ? 'person' : 'people'} on the staff list`
                        : 'Staff app off'}
                    </p>
                  </div>
                  <Switch
                    checked={on}
                    disabled={toggling === o.id}
                    label={`Staff app for ${o.name}`}
                    onChange={v => toggleVenue(o, v)}
                  />
                </li>
              );
            })}
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={venue ? `Staff at ${venue.name}` : 'Staff'}
          icon={Users}
          ruled
          subtitle="Add work email addresses. Each person gets an email with the link; they create an account with a code sent to that address."
          actions={enabled.length > 1 && (
            <select className="ui-select sa-venue-select" value={venue?.id || ''} onChange={e => { setVenueId(e.target.value); setResults(null); }} aria-label="Venue">
              {enabled.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
        />
        <CardBody>
          {!venue ? (
            <EmptyState icon={Store} title="No venue has the staff app yet">
              Switch it on for a venue above, then add its staff here.
            </EmptyState>
          ) : (
            <>
              <form className="sa-add" onSubmit={invite}>
                <Field label="Add staff" htmlFor="sa-emails" hint="Separate several addresses with commas or new lines. Up to 20 at a time.">
                  <textarea
                    id="sa-emails"
                    className="ui-textarea sa-add__input"
                    rows={2}
                    placeholder="barista@nyu.edu, shift.lead@nyu.edu"
                    value={emails}
                    onChange={e => setEmails(e.target.value)}
                  />
                </Field>
                <Button type="submit" variant="primary" icon={MailPlus} disabled={busy || !emails.trim()}>
                  {busy ? 'Adding…' : 'Add and email them'}
                </Button>
              </form>

              {results && (
                <ul className="sa-results" role="status">
                  {results.map(r => (
                    <li key={r.email} className={`sa-results__row sa-results__row--${['invited', 'reminded'].includes(r.result) ? 'ok' : 'warn'}`}>
                      <b>{r.email}</b> {RESULT_TEXT[r.result] || r.result}
                    </li>
                  ))}
                </ul>
              )}

              {staff === null ? (
                <p className="ms-hint">Loading staff…</p>
              ) : venueStaff.length === 0 ? (
                <EmptyState icon={QrCode} title="Nobody on the list yet">
                  Add the first email address above.
                </EmptyState>
              ) : (
                <div className="ms-table-wrap sa-table">
                  <table className="ui-table">
                    <thead>
                      <tr>
                        <th>Person</th>
                        <th>Status</th>
                        <th>Last 30 days</th>
                        <th>Last active</th>
                        <th aria-label="Actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {venueStaff.map(m => (
                        <tr key={m.id} className={m.status === 'blocked' ? 'ms-row--muted' : ''}>
                          <td>
                            <div className="ms-person">
                              <span className="ms-avatar sa-avatar" aria-hidden="true">
                                {m.avatar_url ? <img src={m.avatar_url} alt="" /> : (m.name || m.email).slice(0, 1).toUpperCase()}
                              </span>
                              <span className="ms-person__text">
                                <span className="ms-person__name">{m.name || m.email}</span>
                                {m.name && <span className="ms-person__email">{m.email}</span>}
                                {!m.name && <span className="ms-person__email">{m.status === 'invited' ? `Added ${relativeTime(m.created_at)}` : 'No name yet'}</span>}
                              </span>
                            </div>
                          </td>
                          <td>{statusBadge(m)}</td>
                          <td className="sa-num">
                            {m.last30.codes
                              ? <>{m.last30.codes} {m.last30.codes === 1 ? 'code' : 'codes'} · {m.last30.cups} {m.last30.cups === 1 ? 'cup' : 'cups'}</>
                              : <span className="ms-muted">None</span>}
                          </td>
                          <td className="ms-muted">{m.last_seen_at ? relativeTime(m.last_seen_at) : 'Never'}</td>
                          <td className="ms-row-actions">
                            <Menu
                              align="right"
                              trigger={({ open, toggle }) => (
                                <Button variant="ghost" size="sm" icon={MoreHorizontal} aria-label={`Actions for ${m.email}`} aria-expanded={open} onClick={toggle} />
                              )}
                            >
                              {m.status === 'invited' && (
                                <MenuItem icon={MailPlus} onClick={() => resend(m)}>Send the invitation again</MenuItem>
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
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
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
            <Button onClick={() => setConfirm(null)} disabled={busy}>Cancel</Button>
            <Button variant={confirm?.kind === 'resume' ? 'primary' : 'danger'} onClick={runConfirm} disabled={busy}>
              {busy ? 'Working…' : confirm?.kind === 'remove' ? 'Remove' : confirm?.kind === 'pause' ? 'Pause' : 'Resume'}
            </Button>
          </>
        )}
      >
        <p className="ms-modal-text">
          {confirm?.kind === 'remove' && <><b>{confirm.member.email}</b> can no longer use the staff app. The codes they made stay in the records. Add the email again to give access back.</>}
          {confirm?.kind === 'pause' && <><b>{confirm.member.email}</b> can't make codes until you resume them. Codes they already made keep working until they expire.</>}
          {confirm?.kind === 'resume' && <><b>{confirm.member.email}</b> can make codes again.</>}
        </p>
      </Modal>
    </div>
  );
}
