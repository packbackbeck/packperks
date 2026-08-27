import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOrg } from '../context/OrgContext';
import {
  listBackupCups,
  listBackupCupUses,
  getBackupAlertConfig,
  saveBackupAlertConfig,
  setBackupCupsActive,
  BACKUP_ALERT_DEFAULTS,
} from '../lib/adminApi';
import './AdminBackupCups.css';

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
    <button
      type="button"
      className={`abc-copy${small ? ' abc-copy--sm' : ''}${done ? ' abc-copy--done' : ''}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        } catch { /* clipboard blocked — the value is selectable anyway */ }
      }}
    >
      {done ? 'Copied' : label}
    </button>
  );
}

export default function AdminBackupCups() {
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

  const load = useCallback(async () => {
    if (!activeOrgId) return;
    setLoading(true);
    setError(null);
    try {
      const [c, u, a] = await Promise.all([
        listBackupCups(activeOrgId),
        listBackupCupUses(activeOrgId),
        getBackupAlertConfig(activeOrgId),
      ]);
      setCups(c);
      setUses(u);
      setAlerts(a);
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

  return (
    <div className="admin-backupcups">
      <header className="abc-header">
        <div>
          <h1 className="abc-title">Backup cups</h1>
          <p className="abc-sub">
            Ten reserved cup codes the bin falls back to when it can’t reach PackPerks. They never
            expire and pay out every time they’re scanned — so every use here means the bin was
            offline when it printed that receipt.
          </p>
        </div>
        <button className="abc-refresh" onClick={load} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      {error && <div className="abc-error">{error}</div>}

      {/* The alarm comes first: the list below never changes, this does. */}
      <section className={`abc-status${recentlyUsed ? ' abc-status--hot' : ''}`}>
        <div className="abc-status__main">
          <span className="abc-status__dot" aria-hidden="true" />
          <div>
            <div className="abc-status__head">
              {stats.totalScans === 0
                ? 'No backup cup has ever been used'
                : recentlyUsed
                  ? 'A backup cup was used in the last 24 hours'
                  : `Last used ${sinceLabel(stats.lastUsed)}`}
            </div>
            <div className="abc-status__note">
              {stats.totalScans === 0
                ? 'The bin has reached PackPerks every time it printed a receipt.'
                : recentlyUsed
                  ? 'The bin could not reach PackPerks. Check its network connection.'
                  : `${fmtWhen(stats.lastUsed)} — the bin was offline at that moment.`}
            </div>
          </div>
        </div>
      </section>

      <div className="abc-tiles">
        <div className="abc-tile">
          <div className="abc-tile__num">{stats.last24h}</div>
          <div className="abc-tile__label">Used, last 24h</div>
        </div>
        <div className="abc-tile">
          <div className="abc-tile__num">{stats.last30d}</div>
          <div className="abc-tile__label">Used, last 30 days</div>
        </div>
        <div className="abc-tile">
          <div className="abc-tile__num">{stats.totalScans}</div>
          <div className="abc-tile__label">Used, all time</div>
        </div>
        <div className="abc-tile">
          <div className="abc-tile__num">€{stats.totalEur.toFixed(2)}</div>
          <div className="abc-tile__label">Paid out via backups</div>
        </div>
      </div>

      {/* ── The codes ── */}
      <section className="abc-card">
        <header className="abc-card__head">
          <div>
            <h2 className="abc-card__title">The codes</h2>
            <p className="abc-card__desc">
              Give these to whoever configures the bin. It stores them locally and prints one
              (or several) when it can’t reach us. Nothing else needs setting up.
            </p>
          </div>
          <CopyButton value={allIds} label="Copy all 10" />
        </header>

        <div className={`abc-master${setLive ? '' : ' abc-master--off'}`}>
          <div>
            <div className="abc-master__label">
              {setLive ? 'Backup cups are accepted' : 'Backup cups are switched off'}
            </div>
            <div className="abc-master__note">
              {setLive
                ? 'A scanned backup code pays out. Switch off to retire the fallback entirely.'
                : 'A scanned backup code pays nothing — the customer sees “this receipt is no longer valid”. The bin will keep printing them until its config is updated.'}
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={setLive}
            aria-label="Accept backup cups"
            className={`abc-toggle${setLive ? ' abc-toggle--on' : ''}`}
            disabled={togglingSet || cups.length === 0}
            onClick={() => toggleSet(!setLive)}
          >
            <span className="abc-toggle__dot" />
          </button>
        </div>

        {loading && cups.length === 0 ? (
          <div className="abc-empty">Loading…</div>
        ) : cups.length === 0 ? (
          <div className="abc-empty">
            No backup cups are set up for {activeOrg?.name || 'this org'}.
          </div>
        ) : (
          <ul className="abc-list">
            {cups.map(c => (
              <li key={c.id} className={`abc-item${c.active ? '' : ' abc-item--off'}`}>
                <span className="abc-item__label">{c.label}</span>
                <code className="abc-item__id">{c.id}</code>
                <span className="abc-item__used">
                  {usesByCup[c.id]
                    ? `${usesByCup[c.id]}× · ${sinceLabel(lastUseByCup[c.id])}`
                    : 'never used'}
                </span>
                <CopyButton value={c.id} small />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Alerts ── */}
      <section className="abc-card">
        <header className="abc-card__head">
          <div>
            <h2 className="abc-card__title">Alerts</h2>
            <p className="abc-card__desc">
              Emailed the moment a backup cup is scanned. Saves immediately — no publish needed.
            </p>
          </div>
          <label className="abc-switch">
            <input
              type="checkbox"
              checked={alerts.enabled !== false}
              onChange={e => save({ ...alerts, enabled: e.target.checked })}
            />
            <span>{alerts.enabled !== false ? 'On' : 'Off'}</span>
          </label>
        </header>

        <div className="abc-field">
          <label className="abc-label">Send to</label>
          <div className="abc-chips">
            {alerts.recipients.map(r => (
              <span key={r} className="abc-chip">
                {r}
                <button
                  type="button"
                  aria-label={`Remove ${r}`}
                  onClick={() => save({ ...alerts, recipients: alerts.recipients.filter(x => x !== r) })}
                >×</button>
              </span>
            ))}
            {alerts.recipients.length === 0 && (
              <span className="abc-chips__empty">No recipients yet — nobody will be told.</span>
            )}
          </div>
          <div className="abc-addrow">
            <input
              className="abc-input"
              type="email"
              placeholder="name@example.com"
              value={recipientDraft}
              onChange={e => setRecipientDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addRecipient(); } }}
            />
            <button className="abc-btn" onClick={addRecipient} disabled={!recipientDraft.includes('@')}>
              Add
            </button>
          </div>
        </div>

        <div className="abc-field">
          <label className="abc-label" htmlFor="abc-subject">Subject</label>
          <input
            id="abc-subject"
            className="abc-input"
            value={alerts.subject}
            onChange={e => setAlerts({ ...alerts, subject: e.target.value })}
            onBlur={() => save(alerts)}
          />
        </div>

        <div className="abc-field">
          <label className="abc-label" htmlFor="abc-body">Message</label>
          <textarea
            id="abc-body"
            className="abc-input abc-input--area"
            rows={8}
            value={alerts.body}
            onChange={e => setAlerts({ ...alerts, body: e.target.value })}
            onBlur={() => save(alerts)}
          />
          <div className="abc-placeholders">
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
        </div>

        <div className="abc-savebar">
          {saving ? 'Saving…' : savedAt ? 'Saved' : ''}
        </div>
      </section>

      {/* ── History ── */}
      <section className="abc-card">
        <header className="abc-card__head">
          <div>
            <h2 className="abc-card__title">When they were used</h2>
            <p className="abc-card__desc">
              One row per scan. Each is a moment the bin printed a receipt without us.
            </p>
          </div>
        </header>

        {stats.scans.length === 0 ? (
          <div className="abc-empty">
            Nothing yet — the bin has always been able to reach us.
          </div>
        ) : (
          <div className="abc-table-wrap">
            <table className="abc-table">
              <thead>
                <tr><th>When</th><th>Backup cup</th><th className="abc-num">Cups</th><th className="abc-num">Paid</th></tr>
              </thead>
              <tbody>
                {stats.scans.map(u => {
                  const cup = cups.find(c => c.id === u.backup_cup_id);
                  return (
                    <tr key={u.id}>
                      <td>{fmtWhen(u.used_at)}</td>
                      <td>{cup?.label || <code className="abc-item__id">{String(u.backup_cup_id).slice(0, 8)}</code>}</td>
                      <td className="abc-num">{u.cups_in_scan ?? '—'}</td>
                      <td className="abc-num">€{Number(u.amount_eur || 0).toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="abc-foot">
        A backup receipt pays the customer exactly like a normal one, and they’re never told it came
        from the fallback. To stop a code being accepted at all, deactivate it in the database —
        the bin will keep printing it, but it will no longer pay.
      </p>
    </div>
  );
}
