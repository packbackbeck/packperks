import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2, DatabaseZap, HandCoins, HeartHandshake, History, MousePointerClick, Printer, ScanLine,
  ServerCog, Trash2, TriangleAlert,
} from 'lucide-react';
import { countOrgData, purgeOrgData } from '../lib/adminApi';
import { logAction } from '../auth/actionLog';
import { useOrg } from '../context/OrgContext';
import { Badge, Button, Card, CardBody, CardFoot, CardHeader, Field, Modal, Segmented } from '../ui';
import './DataPanel.css';

/* What a master can delete. Only records of activity: customers, balances,
 * rewards, printed cups, locations and settings are never touched here
 * (migration 049 knows the same list). */
const KINDS = [
  { id: 'cup_scans', label: 'Cup scans', icon: ScanLine,
    description: 'Every QR code and receipt scan, with its result. System health reads these.' },
  { id: 'claims', label: 'Claims', icon: HandCoins, warn: true,
    description: 'Cashback, voucher and refund claims with their payout status.' },
  { id: 'activity_history', label: 'Customer history', icon: History,
    description: 'What customers see under their history in the app: cups added, rewards claimed, cups shared.' },
  { id: 'donation_transfers', label: 'Charity transfers', icon: HeartHandshake,
    description: 'Donations passed on to the charity.' },
  { id: 'bin_sessions', label: 'Smart bin sessions', icon: Printer,
    description: 'Each use of a smart bin and the receipt it printed.' },
  { id: 'client_events', label: 'App usage', icon: MousePointerClick,
    description: 'Screens opened, scans attempted, rewards viewed. User behaviour reads these.' },
  { id: 'system_events', label: 'System events', icon: ServerCog,
    description: 'Receipt batches printed, smart-bin cups created and backup cups used.' },
];
const KIND_BY_ID = Object.fromEntries(KINDS.map(k => [k.id, k]));

const fmt = (n) => (n == null ? '—' : new Intl.NumberFormat('en-GB').format(n));
const startOfDay = (d) => (d ? new Date(`${d}T00:00:00`).toISOString() : null);
const startOfNextDay = (d) => {
  if (!d) return null;
  const t = new Date(`${d}T00:00:00`);
  t.setDate(t.getDate() + 1);
  return t.toISOString();
};
const dayLabel = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/* Master Settings → Data: delete chosen records of one organisation. */
export default function DataPanel({ orgs }) {
  const { activeOrgId } = useOrg();
  const [orgId, setOrgId] = useState(activeOrgId || '');
  const [span, setSpan] = useState('all');
  const [fromDay, setFromDay] = useState('');
  const [toDay, setToDay] = useState('');
  const [picked, setPicked] = useState([]);
  const [counts, setCounts] = useState({ key: null, values: {} });
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const [reload, setReload] = useState(0);

  const org = orgs.find(o => o.id === orgId) || null;
  const selectedOrgId = org ? orgId : (orgs.find(o => o.id === activeOrgId)?.id || '');
  const selectedOrg = orgs.find(o => o.id === selectedOrgId) || null;

  const badRange = span === 'range' && fromDay && toDay && fromDay > toDay;
  const timeWindow = useMemo(() => (span === 'range' && !badRange
    ? { from: startOfDay(fromDay), to: startOfNextDay(toDay) }
    : { from: null, to: null }), [span, fromDay, toDay, badRange]);

  const countKey = `${selectedOrgId}|${timeWindow.from}|${timeWindow.to}|${reload}`;
  const loadingCounts = !!selectedOrgId && counts.key !== countKey;
  useEffect(() => {
    if (!selectedOrgId) return undefined;
    let alive = true;
    countOrgData(selectedOrgId, KINDS.map(k => k.id), timeWindow)
      .then(values => { if (alive) setCounts({ key: countKey, values }); })
      .catch(() => { if (alive) setCounts({ key: countKey, values: {} }); });
    return () => { alive = false; };
  }, [countKey, selectedOrgId, timeWindow]);

  const countOf = (id) => (loadingCounts ? null : counts.values[id]);
  const total = picked.reduce((sum, id) => sum + (countOf(id) || 0), 0);
  const word = selectedOrg?.slug || 'delete';
  const rangeText = span === 'range' && fromDay && toDay
    ? `from ${dayLabel(fromDay)} up to and including ${dayLabel(toDay)}`
    : span === 'range' && fromDay ? `from ${dayLabel(fromDay)} onwards`
      : span === 'range' && toDay ? `up to and including ${dayLabel(toDay)}`
        : 'from all time';
  const canStart = !!selectedOrg && picked.length > 0 && !badRange && !loadingCounts && total > 0;

  function toggle(id) {
    setDone(null);
    setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]));
  }

  function openConfirm() {
    setTyped('');
    setError(null);
    setConfirming(true);
  }

  async function runDelete() {
    if (typed.trim().toLowerCase() !== word.toLowerCase() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const deleted = await purgeOrgData(selectedOrg.id, picked, timeWindow);
      logAction({
        action: 'data.delete',
        targetType: 'organization',
        targetId: selectedOrg.id,
        metadata: { org_slug: selectedOrg.slug, kinds: picked, from: timeWindow.from, to: timeWindow.to, deleted },
      });
      setDone({ orgName: selectedOrg.name, deleted, rangeText });
      setPicked([]);
      setConfirming(false);
      setReload(n => n + 1);
    } catch (e) {
      setError(e?.message || 'The records could not be deleted.');
    } finally {
      setBusy(false);
    }
  }

  const sortedOrgs = useMemo(
    () => [...orgs].sort((a, b) => Number(!!a.deleted_at) - Number(!!b.deleted_at) || (a.name || '').localeCompare(b.name || '')),
    [orgs],
  );

  return (
    <div className="ms-stack">
      <Card>
        <CardHeader
          title="Delete data"
          icon={DatabaseZap}
          ruled
          subtitle="Permanently delete records of one organisation. Customers, balances, rewards, printed cups, locations and settings are never touched here."
        />
        <CardBody>
          <div className="md-steps">
            <section className="md-step" aria-labelledby="md-org">
              <h3 className="md-step__title" id="md-org"><span className="md-step__n">1</span>Organisation</h3>
              <select
                className="ui-select md-org"
                value={selectedOrgId}
                onChange={e => { setOrgId(e.target.value); setPicked([]); setDone(null); }}
                aria-label="Organisation"
              >
                {!selectedOrgId && <option value="">Pick an organisation</option>}
                {sortedOrgs.map(o => (
                  <option key={o.id} value={o.id}>
                    {o.name} (/{o.slug}/){o.deleted_at ? ' · archived' : ''}
                  </option>
                ))}
              </select>
              <p className="ms-note">Only this organisation is touched, even when it shares a group with other venues.</p>
            </section>

            <section className="md-step" aria-labelledby="md-time">
              <h3 className="md-step__title" id="md-time"><span className="md-step__n">2</span>Time</h3>
              <Segmented
                ariaLabel="Time"
                value={span}
                onChange={v => { setSpan(v); setDone(null); }}
                options={[{ id: 'all', label: 'All time' }, { id: 'range', label: 'Between dates' }]}
              />
              {span === 'range' && (
                <div className="md-dates">
                  <Field label="From" htmlFor="md-from" hint="Leave empty to start at the first record.">
                    <input id="md-from" type="date" className="ui-input" value={fromDay} max={toDay || undefined} onChange={e => setFromDay(e.target.value)} />
                  </Field>
                  <Field label="Up to and including" htmlFor="md-to" hint="Leave empty to include today.">
                    <input id="md-to" type="date" className="ui-input" value={toDay} min={fromDay || undefined} onChange={e => setToDay(e.target.value)} />
                  </Field>
                </div>
              )}
              {badRange && <p className="ms-error" role="alert">The start date is after the end date.</p>}
            </section>

            <section className="md-step" aria-labelledby="md-what">
              <div className="md-step__head">
                <h3 className="md-step__title" id="md-what"><span className="md-step__n">3</span>What to delete</h3>
                <div className="md-step__actions">
                  <Button size="sm" variant="ghost" onClick={() => { setPicked(KINDS.map(k => k.id)); setDone(null); }}>Select all</Button>
                  <Button size="sm" variant="ghost" disabled={!picked.length} onClick={() => setPicked([])}>Clear</Button>
                </div>
              </div>
              <ul className="md-kinds">
                {KINDS.map(k => {
                  const Icon = k.icon;
                  const on = picked.includes(k.id);
                  const n = countOf(k.id);
                  return (
                    <li key={k.id}>
                      <label className={`md-kind${on ? ' md-kind--on' : ''}`}>
                        <input type="checkbox" checked={on} onChange={() => toggle(k.id)} />
                        <span className="md-kind__icon" aria-hidden="true"><Icon size={16} /></span>
                        <span className="md-kind__text">
                          <span className="md-kind__name">{k.label}</span>
                          <span className="md-kind__desc">{k.description}</span>
                          {k.warn && on && (
                            <span className="md-kind__warn">
                              <TriangleAlert size={12} aria-hidden="true" />
                              Claims are the record of what was paid out. Keep them if you need them for the books.
                            </span>
                          )}
                        </span>
                        <span className={`md-kind__count${n === 0 ? ' md-kind__count--zero' : ''}`}>
                          {loadingCounts ? '…' : fmt(n)}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </section>
          </div>

          {done && (
            <div className="md-done" role="status">
              <CheckCircle2 size={16} aria-hidden="true" />
              <p>
                Deleted for <b>{done.orgName}</b> ({done.rangeText}):{' '}
                {Object.entries(done.deleted).map(([k, n], i, all) => (
                  <span key={k}>{fmt(n)} {(KIND_BY_ID[k]?.label || k).toLowerCase()}{i < all.length - 1 ? ', ' : '.'}</span>
                ))}
                {' '}Reload other pages to see the change.
              </p>
            </div>
          )}
        </CardBody>
        <CardFoot>
          <div className="md-foot">
            <span className="md-foot__summary">
              {picked.length === 0
                ? 'Pick at least one kind of record.'
                : loadingCounts ? 'Counting…'
                  : <>{fmt(total)} {total === 1 ? 'record' : 'records'} selected, {rangeText}.</>}
            </span>
            <Button variant="danger" icon={Trash2} disabled={!canStart} onClick={openConfirm}>
              {canStart ? `Delete ${fmt(total)} ${total === 1 ? 'record' : 'records'}…` : 'Delete…'}
            </Button>
          </div>
        </CardFoot>
      </Card>

      <Modal
        open={confirming}
        onClose={() => { if (!busy) setConfirming(false); }}
        title={`Delete data of ${selectedOrg?.name || 'this organisation'}?`}
        subtitle="This can’t be undone."
        icon={TriangleAlert}
        iconTone="rose"
        footer={(
          <>
            <Button onClick={() => setConfirming(false)} disabled={busy}>Cancel</Button>
            <Button
              variant="danger"
              icon={Trash2}
              disabled={busy || typed.trim().toLowerCase() !== word.toLowerCase()}
              onClick={runDelete}
            >
              {busy ? 'Deleting…' : `Delete ${fmt(total)} ${total === 1 ? 'record' : 'records'}`}
            </Button>
          </>
        )}
      >
        <p className="md-confirm__intro">These records of <b>{selectedOrg?.name}</b>, {rangeText}, will be permanently deleted:</p>
        <ul className="md-confirm__list">
          {picked.map(id => (
            <li key={id}>
              <span>{KIND_BY_ID[id]?.label}</span>
              <Badge tone={countOf(id) ? 'danger' : 'neutral'}>{fmt(countOf(id))}</Badge>
            </li>
          ))}
        </ul>
        <Field label={<>Type <b>{word}</b> to confirm</>} htmlFor="md-confirm">
          <input
            id="md-confirm"
            className="ui-input"
            value={typed}
            onChange={e => setTyped(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && runDelete()}
            placeholder={word}
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
            autoFocus
          />
        </Field>
        {error && <p className="ms-error" role="alert">{error}</p>}
      </Modal>
    </div>
  );
}
