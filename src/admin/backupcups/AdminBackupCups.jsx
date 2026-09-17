import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle, AlertTriangle, BellRing, CalendarClock, Check, CheckCircle2, Copy, Gauge, History, KeyRound,
  Plus, RefreshCw, Timer, Wallet, X,
} from 'lucide-react';
import { useOrg } from '../context/OrgContext';
import {
  listBackupCups,
  listBackupCupUses,
  getBackupAlertConfig,
  saveBackupAlertConfig,
  setBackupCupsActive,
  getBackupLimits,
  saveBackupLimits,
  BACKUP_ALERT_DEFAULTS,
  BACKUP_LIMIT_DEFAULTS,
} from '../lib/adminApi';
import { Button, Card, CardBody, CardHeader, EmptyState, Field, KpiTile, PageHeader, Switch } from '../ui';
import './AdminBackupCups.css';
import { useAdminMoney } from '../lib/adminMoney';

/* ─────────────────────────────────────────────────────────────────────
 * Backup Cups — the smart bin's offline fallback, and the alarm attached
 * to it.
 *
 * The bin always prints a receipt, even when it can't reach us. When that
 * happens it can't be handed a freshly-minted batch, so it falls back to
 * ten reserved cup ids burned into its own config. Those ids never expire
 * and mint a NEW Tikkie link on every scan, because the same ten are
 * handed to many different customers over the bin's life.
 *
 * That makes this page two things at once, and the layout says so:
 *
 *   1. A reference card — the ten ids, easy to copy into the bin.
 *   2. An alarm panel — because every use means the bin was OFFLINE. The
 *      page leads with "when did this last happen", not with the list,
 *      since a used backup cup is an incident and the list is static.
 *
 * The customer never learns their receipt came from the fallback; that
 * asymmetry is deliberate and lives entirely on this side.
 * ───────────────────────────────────────────────────────────────────── */

const PLACEHOLDERS = [
  ['{{org}}', 'Venue name'],
  ['{{cup_label}}', 'Which backup cup(s)'],
  ['{{cups}}', 'Cups in the scan'],
  ['{{amount}}', 'Amount paid out'],
  ['{{when}}', 'Timestamp'],
];

function fmtWhen(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) +
    ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function sinceLabel(iso) {
  if (!iso) return null;
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function CopyButton({ value, label = 'Copy', small = false }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      variant={small ? 'ghost' : 'outline'}
      size="sm"
      icon={done ? Check : Copy}
      className={done ? 'abc-copy--done' : ''}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        } catch { /* clipboard blocked — the value is selectable anyway */ }
      }}
    >
      {done ? 'Copied' : label}
    </Button>
  );
}

export default function AdminBackupCups() {
  const { money } = useAdminMoney();
  const { activeOrgId, activeOrg } = useOrg();
  const [cups, setCups] = useState([]);
  const [uses, setUses] = useState([]);
  const [alerts, setAlerts] = useState(BACKUP_ALERT_DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [recipientDraft, setRecipientDraft] = useState('');
  const [togglingSet, setTogglingSet] = useState(false);
  const [limits, setLimits] = useState(BACKUP_LIMIT_DEFAULTS);
  const [limitsSaving, setLimitsSaving] = useState(false);
  const [limitsSaved, setLimitsSaved] = useState(false);

  const load = useCallback(async () => {
    if (!activeOrgId) return;
    setLoading(true);
    setError(null);
    try {
      const [c, u, a, l] = await Promise.all([
        listBackupCups(activeOrgId),
        listBackupCupUses(activeOrgId),
        getBackupAlertConfig(activeOrgId),
        getBackupLimits(activeOrgId),
      ]);
      setCups(c);
      setUses(u);
      setAlerts(a);
      setLimits(l);
    } catch (e) {
      setError(e.message || 'Could not load backup cups.');
    } finally {
      setLoading(false);
    }
  }, [activeOrgId]);

  useEffect(() => { load(); }, [load]);

  /* One row per cup per scan, so group by scan to count real incidents. */
  const stats = useMemo(() => {
    const byClaim = new Map();
    for (const u of uses) {
      const k = u.claim_id || u.id;
      if (!byClaim.has(k)) byClaim.set(k, u);
    }
    const scans = [...byClaim.values()];
    const total = scans.reduce((s, u) => s + Number(u.amount_eur || 0), 0);
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const last30 = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return {
      scans,
      totalScans: scans.length,
      totalEur: total,
      last24h: scans.filter(u => new Date(u.used_at).getTime() > dayAgo).length,
      last30d: scans.filter(u => new Date(u.used_at).getTime() > last30).length,
      lastUsed: scans[0]?.used_at || null,
    };
  }, [uses]);

  const usesByCup = useMemo(() => {
    const m = {};
    for (const u of uses) m[u.backup_cup_id] = (m[u.backup_cup_id] || 0) + 1;
    return m;
  }, [uses]);

  const lastUseByCup = useMemo(() => {
    const m = {};
    for (const u of uses) if (!m[u.backup_cup_id]) m[u.backup_cup_id] = u.used_at;
    return m;
  }, [uses]);

  const allIds = cups.map(c => c.id).join('\n');
  // "On" means at least one code still pays out. The bin keeps printing
  // them either way — this only decides whether a scan is honoured.
  const setLive = cups.some(c => c.active);

  async function toggleSet(next) {
    if (togglingSet) return;
    setTogglingSet(true);
    setCups(cs => cs.map(c => ({ ...c, active: next })));  // optimistic
    try {
      await setBackupCupsActive(activeOrgId, next);
    } catch (e) {
      setError(e.message || 'Could not change the backup cups.');
      await load();
    } finally {
      setTogglingSet(false);
    }
  }
  async function saveLimits(next) {
    setLimits(next);
    setLimitsSaving(true);
    setLimitsSaved(false);
    try {
      const saved = await saveBackupLimits(activeOrgId, next);
      setLimits(saved);
      setLimitsSaved(true);
      setTimeout(() => setLimitsSaved(false), 2000);
    } catch (e) {
      setError(e.message || 'Could not save the limits.');
    } finally {
      setLimitsSaving(false);
    }
  }

  const recentlyUsed = stats.lastUsed &&
    Date.now() - new Date(stats.lastUsed).getTime() < 24 * 60 * 60 * 1000;

  async function save(next) {
    setAlerts(next);
    setSaving(true);
    try {
      await saveBackupAlertConfig(activeOrgId, next);
      setSavedAt(Date.now());
    } catch (e) {
      setError(e.message || 'Could not save the alert settings.');
    } finally {
      setSaving(false);
    }
  }

  function addRecipient() {
    const e = recipientDraft.trim();
    if (!e.includes('@') || alerts.recipients.includes(e)) return;
    setRecipientDraft('');
    save({ ...alerts, recipients: [...alerts.recipients, e] });
  }

  const kpis = [
    { id: 'day', label: 'Used, last 24 hours', icon: Timer, tone: stats.last24h ? 'amber' : 'emerald', value: stats.last24h, description: 'Scans while the bin was offline' },
    { id: 'month', label: 'Used, last 30 days', icon: CalendarClock, tone: 'sky', value: stats.last30d, description: 'Scans while the bin was offline' },
    { id: 'all', label: 'Used, all time', icon: History, tone: 'violet', value: stats.totalScans, description: 'Every backup scan so far' },
    { id: 'paid', label: 'Paid out via backups', icon: Wallet, tone: 'teal', value: money(stats.totalEur), description: 'Across all backup scans' },
  ];
  const statusTone = stats.totalScans === 0 ? 'quiet' : recentlyUsed ? 'hot' : 'past';

  return (
    <div className="ui-page abc">
      <PageHeader
        title="Backup cups"
        subtitle="Ten reserved cup codes the bin falls back to when it can’t reach PackPerks. They never expire and pay out every time they’re scanned, so every use here means the bin was offline when it printed that receipt."
      >
        <Button icon={RefreshCw} onClick={load} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </Button>
      </PageHeader>

      {error && (
        <p className="abc-error" role="alert">
          <AlertCircle size={15} aria-hidden="true" />{error}
        </p>
      )}

      {/* The alarm comes first: the list below never changes, this does. */}
      <section className={`abc-status abc-status--${statusTone}`} aria-live="polite">
        <span className="abc-status__icon" aria-hidden="true">
          {recentlyUsed ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
        </span>
        <div>
          <h2 className="abc-status__head">
            {stats.totalScans === 0
              ? 'No backup cup has ever been used'
              : recentlyUsed
                ? 'A backup cup was used in the last 24 hours'
                : `Last used ${sinceLabel(stats.lastUsed)}`}
          </h2>
          <p className="abc-status__note">
            {stats.totalScans === 0
              ? 'The bin has reached PackPerks every time it printed a receipt.'
              : recentlyUsed
                ? 'The bin could not reach PackPerks. Check its network connection.'
                : `${fmtWhen(stats.lastUsed)} — the bin was offline at that moment.`}
          </p>
        </div>
      </section>

      <div className="ui-kpis abc-kpis">
        {kpis.map((m, i) => <KpiTile key={m.id} metric={m} index={i} interactive={false} />)}
      </div>

      {/* ── The codes ── */}
      <Card>
        <CardHeader
          title="The codes"
          icon={KeyRound}
          subtitle="Give these to whoever sets up the bin. It stores them and prints one (or several) when it can’t reach us. Nothing else needs setting up."
          actions={<CopyButton value={allIds} label="Copy all 10" />}
        />
        <CardBody>
          <div className={`abc-master${setLive ? '' : ' abc-master--off'}`}>
            <div>
              <label className="abc-master__label" htmlFor="abc-accept">
                {setLive ? 'Backup cups are accepted' : 'Backup cups are switched off'}
              </label>
              <div className="abc-master__note">
                {setLive
                  ? 'A scanned backup code pays out. Switch off to retire the fallback entirely.'
                  : 'A scanned backup code pays nothing — the customer sees “this receipt is no longer valid”. The bin will keep printing them until its config is updated.'}
              </div>
            </div>
            <Switch
              id="abc-accept"
              checked={setLive}
              label="Accept backup cups"
              disabled={togglingSet || cups.length === 0}
              onChange={next => toggleSet(next)}
            />
          </div>

          {loading && cups.length === 0 ? (
            <p className="abc-loading">Loading…</p>
          ) : cups.length === 0 ? (
            <EmptyState icon={KeyRound} title="No backup cups yet">
              No backup cups are set up for {activeOrg?.name || 'this organisation'}.
            </EmptyState>
          ) : (
            <ul className="abc-list">
              {cups.map(c => (
                <li key={c.id} className={`abc-item${c.active ? '' : ' abc-item--off'}`}>
                  <span className="abc-item__label">{c.label}</span>
                  <code className="abc-item__id">{c.id}</code>
                  <span className="abc-item__used">
                    {usesByCup[c.id]
                      ? `${usesByCup[c.id]}× · ${sinceLabel(lastUseByCup[c.id])}`
                      : 'Never used'}
                  </span>
                  <CopyButton value={c.id} small />
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {/* ── Limits ── */}
      <Card>
        <CardHeader
          title="Limits"
          icon={Gauge}
          subtitle="Backup codes pay out on every scan, so these ceilings are what stop a shared receipt photo from paying out again and again. Changes apply from the very next scan."
          actions={<span className="abc-saved" role="status">{limitsSaving ? 'Saving…' : limitsSaved ? <><Check size={13} aria-hidden="true" /> Saved</> : ''}</span>}
        />
        <CardBody>
          <div className="abc-limit-grid">
            <Field
              label="Payouts per day"
              htmlFor="abc-lim-day"
              hint="All backup scans at this venue together, per rolling 24 hours. Past it, every backup scan is refused until the window moves on."
            >
              <input
                id="abc-lim-day"
                className="ui-input abc-input--num"
                type="number" min="1" max="500"
                value={limits.dailyCap}
                onChange={e => setLimits({ ...limits, dailyCap: e.target.value })}
                onBlur={() => saveLimits(limits)}
              />
            </Field>
            <Field
              label="Payouts per phone per day"
              htmlFor="abc-lim-dev"
              hint="One person rescanning their receipt hits this long before the venue limit."
            >
              <input
                id="abc-lim-dev"
                className="ui-input abc-input--num"
                type="number" min="1" max="50"
                value={limits.perDeviceDaily}
                onChange={e => setLimits({ ...limits, perDeviceDaily: e.target.value })}
                onBlur={() => saveLimits(limits)}
              />
            </Field>
          </div>
        </CardBody>
        <div className="abc-card-note">
          A fixed 2-minute wait between scans of the same code also applies. That one can’t be changed.
        </div>
      </Card>

      {/* ── Alerts ── */}
      <Card>
        <CardHeader
          title="Alerts"
          icon={BellRing}
          subtitle="Emailed the moment a backup cup is scanned. Saves straight away, no publish needed."
          actions={(
            <span className="abc-switch">
              <span className="abc-saved" role="status">{saving ? 'Saving…' : savedAt ? <><Check size={13} aria-hidden="true" /> Saved</> : ''}</span>
              <label htmlFor="abc-alerts-on">{alerts.enabled !== false ? 'On' : 'Off'}</label>
              <Switch
                id="abc-alerts-on"
                checked={alerts.enabled !== false}
                label="Email alerts"
                onChange={next => save({ ...alerts, enabled: next })}
              />
            </span>
          )}
        />
        <CardBody>
          <div className="abc-stack">
            <div className="ui-field">
              <label className="ui-field__label" htmlFor="abc-recipient">Send to</label>
              <div className="abc-chips">
                {alerts.recipients.map(r => (
                  <span key={r} className="abc-chip">
                    {r}
                    <button
                      type="button"
                      aria-label={`Remove ${r}`}
                      onClick={() => save({ ...alerts, recipients: alerts.recipients.filter(x => x !== r) })}
                    >
                      <X size={11} aria-hidden="true" />
                    </button>
                  </span>
                ))}
                {alerts.recipients.length === 0 && (
                  <span className="abc-chips__empty">
                    <AlertTriangle size={13} aria-hidden="true" /> No recipients yet, so nobody will be told.
                  </span>
                )}
              </div>
              <div className="abc-addrow">
                <input
                  id="abc-recipient"
                  className="ui-input"
                  type="email"
                  placeholder="name@example.com"
                  value={recipientDraft}
                  onChange={e => setRecipientDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addRecipient(); } }}
                />
                <Button icon={Plus} onClick={addRecipient} disabled={!recipientDraft.includes('@')}>
                  Add
                </Button>
              </div>
            </div>

            <Field label="Subject" htmlFor="abc-subject">
              <input
                id="abc-subject"
                className="ui-input"
                value={alerts.subject}
                onChange={e => setAlerts({ ...alerts, subject: e.target.value })}
                onBlur={() => save(alerts)}
              />
            </Field>

            <Field label="Message" htmlFor="abc-body">
              <textarea
                id="abc-body"
                className="ui-textarea abc-body"
                rows={8}
                value={alerts.body}
                onChange={e => setAlerts({ ...alerts, body: e.target.value })}
                onBlur={() => save(alerts)}
              />
              <div className="abc-placeholders" aria-label="Insert a placeholder">
                {PLACEHOLDERS.map(([token, meaning]) => (
                  <button
                    key={token}
                    type="button"
                    className="abc-token"
                    title={`Insert ${meaning.toLowerCase()}`}
                    onClick={() => save({ ...alerts, body: `${alerts.body}${token}` })}
                  >
                    <code>{token}</code><span>{meaning}</span>
                  </button>
                ))}
              </div>
            </Field>
          </div>
        </CardBody>
      </Card>

      {/* ── History ── */}
      <Card>
        <CardHeader
          title="When they were used"
          icon={History}
          subtitle="One row per scan. Each is a moment the bin printed a receipt without us."
          ruled
        />
        <CardBody flush>
          {stats.scans.length === 0 ? (
            <EmptyState icon={CheckCircle2} title="Nothing yet">
              The bin has always been able to reach us.
            </EmptyState>
          ) : (
            <div className="abc-table-wrap">
              <table className="ui-table abc-table">
                <thead>
                  <tr><th>When</th><th>Backup cup</th><th className="ui-num">Cups</th><th className="ui-num">Paid</th></tr>
                </thead>
                <tbody>
                  {stats.scans.map(u => {
                    const cup = cups.find(c => c.id === u.backup_cup_id);
                    return (
                      <tr key={u.id}>
                        <td>{fmtWhen(u.used_at)}</td>
                        <td>{cup?.label || <code className="abc-item__id">{String(u.backup_cup_id).slice(0, 8)}</code>}</td>
                        <td className="ui-num">{u.cups_in_scan ?? '—'}</td>
                        <td className="ui-num">{money(Number(u.amount_eur || 0))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <p className="abc-foot">
        A backup receipt pays the customer exactly like a normal one, and they’re never told it came
        from the fallback. To stop the codes paying out, switch off “Backup cups are accepted” above
        (a single code can only be switched off in the database). The bin keeps printing them, but
        they no longer pay.
      </p>
    </div>
  );
}
