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
 * Two cards, in the order the job is done: *Set up a connection* walks
 * the three steps and holds the controls for each one (make the code,
 * hand it over, approve the request that comes back), then
 * *Connections* is the live state — who is linked to whom, what each
 * one sees, and pause or disconnect.
 *
 * The design is in docs/packpulse/INTEGRATION.md.
 * ───────────────────────────────────────────────────────────────────── */

const PAGES = [
  { id: 'overview', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'behaviour', label: 'User analytics', icon: Activity, hint: 'includes the heatmap and replays' },
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
  const drawn = [...pending, ...connected];

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
      {(error || loadError) && <p className="ppl-error" role="alert">{error || loadError}</p>}

      {/* ── Setting one up: the three steps, each with its own control ── */}
      <Card>
        <CardHeader
          title="Set up a connection"
          icon={HeartPulse}
          subtitle="PackPulse shows one venue's Dashboard, System health and Reports & alerts, read-only — the same view that venue's vendors get here."
        />
        <CardBody>
          <ol className="ppl-flow">
            <li className="ppl-flow__step">
              <span className="ppl-flow__n" aria-hidden="true">1</span>
              <div className="ppl-flow__body">
                <h3 className="ppl-flow__title">Create a connection code</h3>
                <p className="ppl-flow__note">The code decides which venue PackPulse gets. It works once, for 48 hours.</p>
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
                    {busy === 'code' ? 'Creating…' : 'Create code'}
                  </Button>
                </div>

                {newCode && (
                  <div className="ppl-code" role="status">
                    <p className="ppl-code__for">Code for <b>{newCode.orgName}</b> — shown once, {untilText(newCode.expires_at)}.</p>
                    <div className="ppl-code__row">
                      <code className="ppl-code__value">{newCode.code}</code>
                      <Button size="sm" icon={copied ? CheckCircle2 : Copy} onClick={copyCode}>{copied ? 'Copied' : 'Copy'}</Button>
                    </div>
                  </div>
                )}

                {codes.length > 0 && (
                  <ul className="ppl-codes">
                    <li className="ppl-codes__head">Codes not used yet</li>
                    {codes.map(l => (
                      <li key={l.id} className={`ppl-codes__row${l.status === 'expired' ? ' is-expired' : ''}`}>
                        <span className="ppl-codes__org">{l.org_name}</span>
                        <span className="ppl-codes__hint">…{l.code_hint}</span>
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
              </div>
            </li>

            <li className="ppl-flow__step">
              <span className="ppl-flow__n" aria-hidden="true">2</span>
              <div className="ppl-flow__body">
                <h3 className="ppl-flow__title">Send it to PackPulse</h3>
                <p className="ppl-flow__note">
                  Someone there opens <b>Master settings → PackPerks</b>, pastes the code and picks their organisation.
                </p>
              </div>
            </li>

            <li className="ppl-flow__step">
              <span className="ppl-flow__n" aria-hidden="true">3</span>
              <div className="ppl-flow__body">
                <h3 className="ppl-flow__title">Approve the request</h3>
                <p className="ppl-flow__note">
                  It lands here with a 4-character confirmation code. Approve it only when PackPulse shows the same one.
                </p>
                {pending.length ? (
                  <ul className="ppl-asks">
                    {pending.map(l => (
                      <li key={l.id} className="ppl-ask">
                        <div className="ppl-ask__who">
                          <Pair link={l} />
                          <span className="ppl-ask__meta">
                            Asked {relativeTime(l.requested_at)}
                            {l.requested_by_name || l.requested_by_email ? ` by ${l.requested_by_name || l.requested_by_email}` : ''}
                            {l.packpulse_origin ? ` from ${l.packpulse_origin}` : ''}
                          </span>
                        </div>
                        <div className="ppl-ask__decide">
                          <span className="ppl-confirm" aria-label={`Confirmation code ${l.confirm_code}`}>
                            <span className="ppl-confirm__label">Code</span>
                            <span className="ppl-confirm__code">{l.confirm_code}</span>
                          </span>
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
                ) : (
                  <p className="ppl-flow__idle">Nothing waiting for approval.</p>
                )}
              </div>
            </li>
          </ol>
        </CardBody>
        <CardFoot>
          <span className="ppl-safe">
            <ShieldCheck size={15} aria-hidden="true" />
            Numbers only. Customer emails, payout links, receipt photos and cup codes never leave PackPerks, and pausing or
            disconnecting stops access at once.
          </span>
        </CardFoot>
      </Card>

      {/* ── The live state: who is linked to whom, and what they see ── */}
      <Card>
        <CardHeader
          title="Connections"
          icon={Link2}
          subtitle="Which venue is shared with which PackPulse organisation, and what each one can open."
          actions={<Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => setReload(r => r + 1)}>Refresh</Button>}
        />
        {links === null && !loadError ? (
          <CardBody><div className="ppl-diagram ppl-diagram--loading" /></CardBody>
        ) : drawn.length ? (
          <>
            <CardBody><Diagram links={drawn} /></CardBody>
            <CardBody flush>
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
                    <div className="ppl-item__foot">
                      <Events events={l.events} />
                      <div className="ppl-item__actions">
                        {l.status === 'active' ? (
                          <Button size="sm" icon={PauseCircle} disabled={!!busy} onClick={() => run(l.id, () => updatePackPulseLink(l, 'pause'))}>Pause</Button>
                        ) : (
                          <Button size="sm" variant="primary" icon={PlayCircle} disabled={!!busy} onClick={() => run(l.id, () => updatePackPulseLink(l, 'resume'))}>Resume</Button>
                        )}
                        <Button size="sm" variant="danger-ghost" icon={Unplug} disabled={!!busy} onClick={() => setEnding(l)}>Disconnect</Button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </CardBody>
          </>
        ) : (
          <CardBody>
            <EmptyState icon={Link2} title="Nothing connected yet">
              Create a code in step 1 above to connect the first venue.
            </EmptyState>
          </CardBody>
        )}
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
      </span>
      <span className="ppl-pair__arrow" aria-hidden="true">→</span>
      <span className="ppl-pair__side">
        <HeartPulse size={16} className="ppl-pair__pulse" aria-hidden="true" />
        <span className="ppl-pair__name">{link.packpulse_org_name || 'PackPulse'}</span>
      </span>
      <Badge tone={s.tone}>{s.label}</Badge>
    </div>
  );
}

function Events({ events }) {
  const list = (events || []).slice(0, 5);
  if (!list.length) return <span />;
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
 * approval or is paused. The chip riding each line says what that
 * connection actually gets — how many of the four pages are shared, and
 * how much it has been opened — so the picture carries the state of the
 * link, not just its existence. */
const ROW = 40;
const NODE_W = 180;
const NODE_H = 30;
const W = 560;
const CHIP_W = 124;
const CHIP_H = 20;
const LINE = { active: 'var(--ppl-active)', pending: 'var(--ppl-pending)', paused: 'var(--ppl-paused)' };

function clip(s, n = 22) {
  const t = String(s || '');
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/* What this connection is worth knowing, in four words or fewer. */
function chipText(l) {
  if (l.status === 'pending') return 'awaiting approval';
  const shared = PAGES.filter(p => l.pages?.[p.id] === true).length;
  const pages = `${shared}/${PAGES.length} pages`;
  if (l.status === 'paused') return `paused · ${pages}`;
  const views = Number(l.views_7d || 0);
  return `${pages} · ${views} view${views === 1 ? '' : 's'}`;
}

/* Where along a link's curve its chip rides. Two links that arrive at the
 * same organisation pass close together in the middle, so a chip that would
 * land on a neighbour slides along its own curve until it is clear. */
const CHIP_TS = [0.5, 0.32, 0.68, 0.2, 0.8];

function bezierAt(x1, y1, x2, y2, mid, t) {
  const u = 1 - t;
  const x = u * u * u * x1 + 3 * u * u * t * mid + 3 * u * t * t * mid + t * t * t * x2;
  const y = u * u * u * y1 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y2;
  return { x, y };
}

function placeChip(x1, y1, x2, y2, mid, taken) {
  let fallback = null;
  for (const t of CHIP_TS) {
    const at = bezierAt(x1, y1, x2, y2, mid, t);
    if (!fallback) fallback = at;
    const clash = taken.some(o => Math.abs(o.y - at.y) < CHIP_H + 3 && Math.abs(o.x - at.x) < CHIP_W + 6);
    if (!clash) return at;
  }
  return fallback;
}

function Diagram({ links }) {
  const left = [...new Map(links.map(l => [l.org_id, { id: l.org_id, name: l.org_name, color: l.org_color }])).values()];
  const right = [...new Map(links.map(l => [l.packpulse_org_id, { id: l.packpulse_org_id, name: l.packpulse_org_name }])).values()];
  const rows = Math.max(left.length, right.length);
  const H = 30 + rows * ROW;
  const y = (list, i) => 26 + i * ROW + (rows - list.length) * (ROW / 2);
  const lx = 8;
  const rx = W - 8 - NODE_W;
  const chips = [];
  const summary = links.map(l => `${l.org_name} to ${l.packpulse_org_name}: ${STATUS[l.status]?.label || l.status}, ${chipText(l)}`).join('; ');

  return (
    <figure className="ppl-diagram">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Connections. ${summary}`}>
        <text x={lx} y={12} className="ppl-diagram__head">PackPerks</text>
        <text x={W - 8} y={12} textAnchor="end" className="ppl-diagram__head">PackPulse</text>
        {links.map(l => {
          const y1 = y(left, left.findIndex(n => n.id === l.org_id)) + NODE_H / 2;
          const y2 = y(right, right.findIndex(n => n.id === l.packpulse_org_id)) + NODE_H / 2;
          const x1 = lx + NODE_W;
          const x2 = rx;
          const mid = (x1 + x2) / 2;
          const at = placeChip(x1, y1, x2, y2, mid, chips);
          chips.push(at);
          return (
            <g key={l.id}>
              <path
                d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
                fill="none"
                stroke={LINE[l.status] || LINE.pending}
                strokeWidth={2}
                strokeDasharray={l.status === 'active' ? undefined : '5 4'}
              />
              {/* The chip sits on the line, filled, so it masks the stroke. */}
              <rect
                x={at.x - CHIP_W / 2} y={at.y - CHIP_H / 2}
                width={CHIP_W} height={CHIP_H} rx={CHIP_H / 2}
                className="ppl-diagram__chip"
                stroke={LINE[l.status] || LINE.pending}
              />
              <text x={at.x} y={at.y + 3.5} textAnchor="middle" className="ppl-diagram__chip-text">{chipText(l)}</text>
            </g>
          );
        })}
        {left.map((n, i) => (
          <g key={n.id}>
            <rect x={lx} y={y(left, i)} width={NODE_W} height={NODE_H} rx={8} className="ppl-diagram__node" />
            <circle cx={lx + 15} cy={y(left, i) + NODE_H / 2} r={4} fill={n.color || 'var(--ui-primary)'} />
            <text x={lx + 27} y={y(left, i) + NODE_H / 2 + 4} className="ppl-diagram__name">{clip(n.name)}</text>
          </g>
        ))}
        {right.map((n, i) => (
          <g key={n.id}>
            <rect x={rx} y={y(right, i)} width={NODE_W} height={NODE_H} rx={8} className="ppl-diagram__node" />
            <circle cx={rx + 15} cy={y(right, i) + NODE_H / 2} r={4} className="ppl-diagram__dot--pulse" />
            <text x={rx + 27} y={y(right, i) + NODE_H / 2 + 4} className="ppl-diagram__name">{clip(n.name)}</text>
          </g>
        ))}
      </svg>
      <figcaption className="ppl-diagram__legend">
        <span><i className="ppl-key ppl-key--active" /> Connected</span>
        <span><i className="ppl-key ppl-key--pending" /> Waiting for approval</span>
        <span><i className="ppl-key ppl-key--paused" /> Paused</span>
        <span className="ppl-diagram__legend-note">Views are the last 7 days.</span>
      </figcaption>
    </figure>
  );
}
