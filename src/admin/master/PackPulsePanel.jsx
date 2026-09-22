import { useEffect, useMemo, useState } from 'react';
import {
  Activity, CheckCircle2, ClipboardList, Copy, Gauge, HeartPulse, KeyRound, LayoutDashboard, Link2, PauseCircle,
  PlayCircle, RefreshCw, ShieldCheck, Smartphone, Unplug, XCircle,
} from 'lucide-react';
import { Badge, Button, Card, CardBody, CardFoot, CardHeader, EmptyState, Modal, Switch } from '../ui';
import { createPackPulseCode, listPackPulseLinks, relativeTime, updatePackPulseLink } from './masterApi';
import './PackPulsePanel.css';

/* ─────────────────────────────────────────────────────────────────────
 * Master Settings → PackPulse. Share a venue's Dashboard, System health
 * and Reports & alerts with a PackPulse organisation, read-only.
 *
 * 1. Create a one-time connection code for a venue here.
 * 2. Someone at PackPulse pastes it into PackPulse → Master settings →
 *    PackPerks and picks their organisation.
 * 3. The request shows up here; approve it once the confirmation code
 *    matches the one PackPulse shows.
 * Masters can pause a connection, choose which pages it shares, or end it.
 * The design is in docs/packpulse/INTEGRATION.md.
 * ───────────────────────────────────────────────────────────────────── */

const PAGES = [
  { id: 'overview', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'stats', label: 'System health', icon: Gauge },
  { id: 'reports', label: 'Reports & alerts', icon: ClipboardList },
  { id: 'preview', label: 'Preview', icon: Smartphone, hint: 'the customer app' },
];

const STATUS = {
  awaiting: { label: 'Code not used yet', tone: 'neutral' },
  expired: { label: 'Code expired', tone: 'neutral' },
  pending: { label: 'Waiting for approval', tone: 'warning' },
  active: { label: 'Connected', tone: 'success' },
  paused: { label: 'Paused', tone: 'neutral' },
  declined: { label: 'Declined', tone: 'neutral' },
  revoked: { label: 'Disconnected', tone: 'neutral' },
};

const EVENT = {
  code_created: 'Code created',
  code_cancelled: 'Code cancelled',
  claimed: 'PackPulse used the code',
  approved: 'Approved',
  declined: 'Declined',
  paused: 'Paused',
  resumed: 'Resumed',
  pages_changed: 'Shared pages changed',
  disconnected: 'Disconnected',
  view: 'Opened',
};

const PAGE_LABEL = Object.fromEntries(PAGES.map(p => [p.id, p.label]));

function untilText(iso) {
  const ms = Date.parse(iso) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return 'expired';
  const h = Math.round(ms / 3600000);
  if (h >= 1) return `expires in ${h} hour${h === 1 ? '' : 's'}`;
  const m = Math.max(1, Math.round(ms / 60000));
  return `expires in ${m} minute${m === 1 ? '' : 's'}`;
}

function errorText(e) {
  const m = e?.message || String(e || '');
  if (m.includes('masters_only')) return 'Only masters can manage PackPulse connections.';
  if (m.includes('not_pending')) return 'This request was already approved or declined. The list has been refreshed.';
  if (m.includes('wrong_status') || m.includes('not_connected') || m.includes('not_awaiting')) return 'This connection changed in the meantime. The list has been refreshed.';
  return m || 'Something went wrong.';
}

export default function PackPulsePanel({ orgs }) {
  const [links, setLinks] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [reload, setReload] = useState(0);
  const [orgId, setOrgId] = useState('');
  const [newCode, setNewCode] = useState(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [ending, setEnding] = useState(null);

  useEffect(() => {
    let alive = true;
    listPackPulseLinks()
      .then(list => { if (alive) { setLinks(list); setLoadError(null); } })
      .catch(e => { if (alive) setLoadError(errorText(e)); });
    return () => { alive = false; };
  }, [reload]);

  const liveOrgs = useMemo(() => orgs.filter(o => !o.deleted_at), [orgs]);
  const all = useMemo(() => links || [], [links]);
  const codes = all.filter(l => l.status === 'awaiting' || l.status === 'expired');
  const pending = all.filter(l => l.status === 'pending');
  const connected = all.filter(l => l.status === 'active' || l.status === 'paused');
  const ended = all.filter(l => l.status === 'declined' || l.status === 'revoked');

  async function run(key, fn) {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
      setReload(r => r + 1);
    }
  }

  function makeCode() {
    const org = liveOrgs.find(o => o.id === orgId);
    if (!org) return;
    setCopied(false);
    run('code', async () => {
      const made = await createPackPulseCode(org.id);
      setNewCode({ ...made, orgName: org.name });
    });
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(newCode.code);
      setCopied(true);
    } catch { setCopied(false); }
  }

  function setPage(link, pageId, on) {
    setLinks(list => list.map(l => (l.id === link.id ? { ...l, pages: { ...l.pages, [pageId]: on } } : l)));
    run(`${link.id}:pages`, () => updatePackPulseLink(link, 'pages', { [pageId]: on }));
  }

  return (
    <div className="ppl">
      <Card>
        <CardHeader
          title="PackPulse"
          icon={HeartPulse}
          subtitle="Show a venue's Dashboard, System health and Reports & alerts inside a PackPulse organisation. PackPulse sees them read-only, the way the venue's vendors see them here."
        />
        <CardBody>
          <ol className="ppl-steps">
            <li><b>Create a connection code</b> for a venue below. It works once, for 48 hours.</li>
            <li><b>In PackPulse</b>, someone opens Master settings → PackPerks, pastes the code and picks their organisation.</li>
            <li><b>Approve the request here</b> when its confirmation code matches the one PackPulse shows.</li>
          </ol>
          <p className="ppl-note">
            <ShieldCheck size={15} aria-hidden="true" />
            <span>
              PackPulse only reads this venue's numbers. Customer emails, payout links, receipt photos and cup codes never
              leave PackPerks, and pausing or disconnecting stops access at once.
            </span>
          </p>
        </CardBody>
      </Card>

      {(error || loadError) && <p className="ppl-error" role="alert">{error || loadError}</p>}

      <Card>
        <CardHeader
          title="Connections"
          icon={Link2}
          subtitle="Which PackPerks venue is shared with which PackPulse organisation."
          actions={<Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => setReload(r => r + 1)}>Refresh</Button>}
        />
        <CardBody>
          {links === null && !loadError ? (
            <div className="ppl-diagram ppl-diagram--loading" />
          ) : [...pending, ...connected].length ? (
            <Diagram links={[...pending, ...connected]} />
          ) : (
            <EmptyState icon={Link2} title="No connections yet">Create a code below to connect the first venue.</EmptyState>
          )}
        </CardBody>
      </Card>

      {pending.length > 0 && (
        <Card>
          <CardHeader
            title="Waiting for your approval"
            icon={KeyRound}
            subtitle="PackPulse used these codes. Approve a request only when PackPulse shows the same confirmation code."
          />
          <CardBody flush>
            <ul className="ppl-list">
              {pending.map(l => (
                <li key={l.id} className="ppl-item">
                  <Pair link={l} />
                  <div className="ppl-item__meta">
                    <span>Asked {relativeTime(l.requested_at)}{l.requested_by_email || l.requested_by_name ? ` by ${l.requested_by_name || l.requested_by_email}` : ''}</span>
                    {l.packpulse_origin && <span>from {l.packpulse_origin}</span>}
                  </div>
                  <div className="ppl-confirm" aria-label={`Confirmation code ${l.confirm_code}`}>
                    <span className="ppl-confirm__label">Confirmation code</span>
                    <span className="ppl-confirm__code">{l.confirm_code}</span>
                  </div>
                  <div className="ppl-item__actions">
                    <Button
                      variant="primary"
                      icon={CheckCircle2}
                      disabled={!!busy}
                      onClick={() => run(l.id, () => updatePackPulseLink(l, 'approve'))}
                    >
                      Approve
                    </Button>
                    <Button icon={XCircle} disabled={!!busy} onClick={() => run(l.id, () => updatePackPulseLink(l, 'decline'))}>
                      Decline
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Connect a venue"
          icon={KeyRound}
          subtitle="The code decides which venue PackPulse gets. Send it to the person setting up PackPulse."
        />
        <CardBody>
          <div className="ppl-make">
            <select
              className="ui-select ppl-make__org"
              value={orgId}
              onChange={e => { setOrgId(e.target.value); setNewCode(null); }}
              aria-label="Venue to connect"
            >
              <option value="">Pick a venue</option>
              {liveOrgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <Button variant="primary" icon={KeyRound} disabled={!orgId || busy === 'code'} onClick={makeCode}>
              {busy === 'code' ? 'Creating…' : 'Create connection code'}
            </Button>
          </div>

          {newCode && (
            <div className="ppl-code" role="status">
              <p className="ppl-code__for">Connection code for <b>{newCode.orgName}</b></p>
              <div className="ppl-code__row">
                <code className="ppl-code__value">{newCode.code}</code>
                <Button size="sm" icon={copied ? CheckCircle2 : Copy} onClick={copyCode}>{copied ? 'Copied' : 'Copy'}</Button>
              </div>
              <p className="ppl-code__hint">
                Shown once. It works one time and {untilText(newCode.expires_at)}. Paste it in PackPulse → Master settings → PackPerks.
              </p>
            </div>
          )}

          {codes.length > 0 && (
            <ul className="ppl-codes">
              {codes.map(l => (
                <li key={l.id} className={`ppl-codes__row${l.status === 'expired' ? ' is-expired' : ''}`}>
                  <span className="ppl-codes__org">{l.org_name}</span>
                  <span className="ppl-codes__hint">code ending …{l.code_hint}</span>
                  <span className="ppl-codes__when">{l.status === 'expired' ? 'expired' : untilText(l.code_expires_at)}</span>
                  {l.status === 'awaiting' && (
                    <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => run(l.id, () => updatePackPulseLink(l, 'cancel'))}>
                      Cancel
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Connected"
          icon={CheckCircle2}
          subtitle="Choose what each connection shows in PackPulse's sidebar. A page switched off disappears there, and its data stops at once."
        />
        <CardBody flush>
          {connected.length ? (
            <ul className="ppl-list">
              {connected.map(l => (
                <li key={l.id} className={`ppl-item${l.status === 'paused' ? ' is-paused' : ''}`}>
                  <Pair link={l} />
                  <div className="ppl-item__meta">
                    <span>Approved {relativeTime(l.approved_at)}{l.approved_by_name ? ` by ${l.approved_by_name}` : ''}</span>
                    <span>{l.last_used_at ? `Last opened ${relativeTime(l.last_used_at)}` : 'Not opened yet'}</span>
                    <span>{l.views_7d} view{Number(l.views_7d) === 1 ? '' : 's'} in the last 7 days</span>
                  </div>
                  <div className="ppl-pages" role="group" aria-label={`Pages shared with ${l.packpulse_org_name}`}>
                    {PAGES.map(p => {
                      const Icon = p.icon;
                      return (
                        <div key={p.id} className="ppl-page">
                          <Icon size={15} aria-hidden="true" />
                          <span>{p.label}{p.hint && <small> {p.hint}</small>}</span>
                          <Switch
                            checked={l.pages?.[p.id] === true}
                            onChange={() => setPage(l, p.id, !(l.pages?.[p.id] === true))}
                            label={`Share ${p.label} with ${l.packpulse_org_name}`}
                            disabled={!!busy}
                          />
                        </div>
                      );
                    })}
                  </div>
                  <Events events={l.events} />
                  <div className="ppl-item__actions">
                    {l.status === 'active' ? (
                      <Button icon={PauseCircle} disabled={!!busy} onClick={() => run(l.id, () => updatePackPulseLink(l, 'pause'))}>Pause</Button>
                    ) : (
                      <Button variant="primary" icon={PlayCircle} disabled={!!busy} onClick={() => run(l.id, () => updatePackPulseLink(l, 'resume'))}>Resume</Button>
                    )}
                    <Button variant="danger-ghost" icon={Unplug} disabled={!!busy} onClick={() => setEnding(l)}>Disconnect</Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={CheckCircle2} title="Nothing connected">Approved connections show up here.</EmptyState>
          )}
        </CardBody>
        {ended.length > 0 && (
          <CardFoot>
            Ended in the last 90 days: {ended.map(l => `${l.org_name} → ${l.packpulse_org_name || 'PackPulse'} (${STATUS[l.status].label.toLowerCase()}${l.ended_by === 'packpulse' ? ' by PackPulse' : ''})`).join(', ')}.
          </CardFoot>
        )}
      </Card>

      <Modal
        open={!!ending}
        onClose={() => setEnding(null)}
        title="Disconnect this venue?"
        subtitle={ending ? `${ending.org_name} stops showing in ${ending.packpulse_org_name} right away. To share it again, create a new code.` : ''}
        icon={Unplug}
        iconTone="rose"
        footer={(
          <>
            <Button onClick={() => setEnding(null)}>Keep it</Button>
            <Button
              variant="danger"
              icon={Unplug}
              disabled={!!busy}
              onClick={() => { const l = ending; setEnding(null); run(l.id, () => updatePackPulseLink(l, 'disconnect')); }}
            >
              Disconnect
            </Button>
          </>
        )}
      />
    </div>
  );
}

function Pair({ link }) {
  const s = STATUS[link.status] || STATUS.pending;
  return (
    <div className="ppl-pair">
      <span className="ppl-pair__side">
        {link.org_logo
          ? <img className="ppl-pair__logo" src={link.org_logo} alt="" />
          : <span className="ppl-pair__dot" style={{ background: link.org_color || 'var(--ui-primary)' }} />}
        <span className="ppl-pair__name">{link.org_name}</span>
        <span className="ppl-pair__app">PackPerks</span>
      </span>
      <span className="ppl-pair__arrow" aria-hidden="true">→</span>
      <span className="ppl-pair__side">
        <HeartPulse size={16} className="ppl-pair__pulse" aria-hidden="true" />
        <span className="ppl-pair__name">{link.packpulse_org_name || 'PackPulse'}</span>
        <span className="ppl-pair__app">PackPulse</span>
      </span>
      <Badge tone={s.tone}>{s.label}</Badge>
    </div>
  );
}

function Events({ events }) {
  const list = (events || []).slice(0, 5);
  if (!list.length) return null;
  return (
    <details className="ppl-events">
      <summary><Activity size={14} aria-hidden="true" /> Recent activity</summary>
      <ul>
        {list.map((e, i) => (
          <li key={i}>
            <span>{EVENT[e.action] || e.action}{e.action === 'view' && e.detail?.page ? `: ${PAGE_LABEL[e.detail.page] || e.detail.page}` : ''}</span>
            <span className="ppl-events__who">{e.actor}</span>
            <span className="ppl-events__when">{relativeTime(e.created_at)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/* PackPerks venues on the left, PackPulse organisations on the right, one
 * line per connection: solid when connected, dashed while it waits for
 * approval or is paused. */
const ROW = 58;
const NODE_W = 236;
const NODE_H = 40;
const W = 720;
const LINE = { active: 'var(--ppl-active)', pending: 'var(--ppl-pending)', paused: 'var(--ppl-paused)' };

function clip(s, n = 28) {
  const t = String(s || '');
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function Diagram({ links }) {
  const left = [...new Map(links.map(l => [l.org_id, { id: l.org_id, name: l.org_name }])).values()];
  const right = [...new Map(links.map(l => [l.packpulse_org_id, { id: l.packpulse_org_id, name: l.packpulse_org_name }])).values()];
  const rows = Math.max(left.length, right.length);
  const H = 44 + rows * ROW;
  const y = (list, i) => 40 + i * ROW + (rows - list.length) * (ROW / 2);
  const lx = 12;
  const rx = W - 12 - NODE_W;
  const summary = links.map(l => `${l.org_name} to ${l.packpulse_org_name}: ${STATUS[l.status]?.label || l.status}`).join('; ');

  return (
    <figure className="ppl-diagram">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Connections. ${summary}`}>
        <text x={lx} y={20} className="ppl-diagram__head">PackPerks venues</text>
        <text x={W - 12} y={20} textAnchor="end" className="ppl-diagram__head">PackPulse organisations</text>
        {links.map(l => {
          const a = left.findIndex(n => n.id === l.org_id);
          const b = right.findIndex(n => n.id === l.packpulse_org_id);
          const y1 = y(left, a) + NODE_H / 2;
          const y2 = y(right, b) + NODE_H / 2;
          const x1 = lx + NODE_W;
          const x2 = rx;
          const mid = (x1 + x2) / 2;
          return (
            <path
              key={l.id}
              d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
              fill="none"
              stroke={LINE[l.status] || LINE.pending}
              strokeWidth={2.5}
              strokeDasharray={l.status === 'active' ? undefined : '6 5'}
            />
          );
        })}
        {left.map((n, i) => (
          <g key={n.id}>
            <rect x={lx} y={y(left, i)} width={NODE_W} height={NODE_H} rx={10} className="ppl-diagram__node" />
            <circle cx={lx + 18} cy={y(left, i) + NODE_H / 2} r={5} className="ppl-diagram__dot ppl-diagram__dot--perks" />
            <text x={lx + 32} y={y(left, i) + NODE_H / 2 + 4.5} className="ppl-diagram__name">{clip(n.name)}</text>
          </g>
        ))}
        {right.map((n, i) => (
          <g key={n.id}>
            <rect x={rx} y={y(right, i)} width={NODE_W} height={NODE_H} rx={10} className="ppl-diagram__node" />
            <circle cx={rx + 18} cy={y(right, i) + NODE_H / 2} r={5} className="ppl-diagram__dot ppl-diagram__dot--pulse" />
            <text x={rx + 32} y={y(right, i) + NODE_H / 2 + 4.5} className="ppl-diagram__name">{clip(n.name)}</text>
          </g>
        ))}
      </svg>
      <figcaption className="ppl-diagram__legend">
        <span><i className="ppl-key ppl-key--active" /> Connected</span>
        <span><i className="ppl-key ppl-key--pending" /> Waiting for approval</span>
        <span><i className="ppl-key ppl-key--paused" /> Paused</span>
      </figcaption>
    </figure>
  );
}
