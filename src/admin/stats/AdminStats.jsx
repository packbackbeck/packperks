import { useEffect, useState, useCallback } from 'react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { getStatsMetrics, purgeOrgRecords } from '../lib/adminApi';
import { useOrg } from '../context/OrgContext';
import ScopeToggle from '../shared/ScopeToggle';
import './AdminStats.css';

/* ─────────────────────────────────────────────────────────────────────
 * AdminStats — feasibility-test validation dashboard for the Titaan
 * sandbox. Renders the 10 go/no-go metrics, an overall verdict, scan
 * trend + error charts, and a raw error log. All numbers come from
 * getStatsMetrics() (QR cup_scans + cups), scoped to the active org.
 * ───────────────────────────────────────────────────────────────────── */

const BAND_META = {
  go:   { label: 'Go',             color: '#16A34A', bg: 'rgba(22,163,74,0.10)' },
  cond: { label: 'Conditional go', color: '#E8910C', bg: 'rgba(232,145,12,0.12)' },
  nogo: { label: 'No-go',          color: '#DC2626', bg: 'rgba(220,38,38,0.10)' },
  na:   { label: 'Not measurable', color: '#6C6259', bg: 'rgba(108,98,89,0.08)' },
};

const RANGES = [
  { id: 'all', label: 'All time', days: null },
  { id: '7',   label: 'Last 7 days', days: 7 },
  { id: '30',  label: 'Last 30 days', days: 30 },
];

function fmtPct(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}%`;
}

function thresholdText(m) {
  const t = m.thresholds || {};
  if (m.lowerIsBetter) {
    return `Go ≤${t.go}% · Conditional ${t.go + 1}–${t.condHigh}% · No-go >${t.condHigh}%`;
  }
  if (t.go === 100) {
    return `Go 100% · Conditional ${t.condLow}–99% · No-go <${t.condLow}%`;
  }
  return `Go ≥${t.go}% · Conditional ${t.condLow}–${t.go - 1}% · No-go <${t.condLow}%`;
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="stats-tooltip">
      <div className="stats-tooltip__label">{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="stats-tooltip__row">
          <span className="stats-tooltip__dot" style={{ background: p.color || p.fill }} />
          {p.name}: <strong>{p.value}</strong>
        </div>
      ))}
    </div>
  );
}

/* Generic drill-down modal: renders the exact rows behind any metric from
 * a { summary, labels, columns, rows } detail object. row.state ∈
 * ok|bad|excluded; defaults to showing only the non-ok ("flagged") rows. */
const STATE_CLASS = { ok: 'stats-sev--ok', bad: 'stats-sev--warn', excluded: 'stats-sev--muted' };

function InspectModal({ view, showAll, onToggleAll, onClose }) {
  if (!view) return null;
  const { label, numerator, denominator, detail } = view;
  const rows = detail?.rows || [];
  const cols = detail?.columns || [];
  const labels = detail?.labels || { ok: 'OK', bad: 'Flagged', excluded: 'Excluded' };
  const flagged = rows.filter(r => r.state !== 'ok');
  const hasFlagged = flagged.length > 0;
  const effectiveAll = showAll || !hasFlagged; // nothing flagged → just show all
  const visible = effectiveAll ? rows : flagged;
  const pillText = (s) => (s === 'ok' ? labels.ok : s === 'excluded' ? (labels.excluded || 'Excluded') : labels.bad);

  return (
    <div className="stats-modal__backdrop" onClick={onClose}>
      <div className="stats-modal" onClick={(e) => e.stopPropagation()}>
        <div className="stats-modal__head">
          <div>
            <h3 className="stats-modal__title">{label}</h3>
            <p className="stats-modal__count">
              {numerator} / {denominator} · {rows.length} row{rows.length !== 1 ? 's' : ''}
              {!effectiveAll && ` · showing ${flagged.length} flagged`}
            </p>
          </div>
          <button className="stats-modal__close" onClick={onClose} aria-label="Close">×</button>
        </div>

        {detail?.summary && <div className="stats-modal__summary">{detail.summary}</div>}

        {hasFlagged && (
          <div className="stats-modal__toolbar">
            <button className="stats-modal__toggle" onClick={onToggleAll}>
              {showAll ? `Show only ${flagged.length} flagged` : `Show all ${rows.length} rows`}
            </button>
          </div>
        )}

        <div className="stats-modal__tablewrap">
          <table className="stats-errtable">
            <thead>
              <tr>
                {cols.map(c => <th key={c.key}>{c.label}</th>)}
                <th>Result</th>
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr><td colSpan={cols.length + 2} className="stats-empty">No rows to show.</td></tr>
              ) : visible.map(r => (
                <tr key={r.id} className={r.state === 'bad' ? 'stats-modal__row--bad' : ''}>
                  {cols.map(c => (
                    <td key={c.key}>
                      {c.key === 'batch' || c.key === 'user' || c.key === 'cup' || c.key === 'claim'
                        ? <code>{r.cells[c.key]}</code>
                        : r.cells[c.key]}
                    </td>
                  ))}
                  <td>
                    <span className={`stats-sev ${STATE_CLASS[r.state] || 'stats-sev--warn'}`}>
                      {pillText(r.state)}
                    </span>
                  </td>
                  <td className="stats-errtable__msg">{r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function AdminStats() {
  const { activeOrg, scopeOrgIds, statsScope } = useOrg();
  const [range, setRange] = useState('all');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Inspect drill-down: holds the view descriptor of the open card (or null).
  const [inspect, setInspect] = useState(null); // { label, numerator, denominator, detail }
  const [inspectAll, setInspectAll] = useState(false); // show all rows vs only flagged
  const openInspect = useCallback((view) => { setInspect(view); setInspectAll(false); }, []);

  // Danger-zone: org-scoped test-data purge.
  const [purgeConfirm, setPurgeConfirm] = useState('');
  const [purging, setPurging] = useState(false);
  const [purgeResult, setPurgeResult] = useState(null);
  const [purgeError, setPurgeError] = useState(null);

  const load = useCallback(async (rangeId) => {
    setLoading(true);
    setError(null);
    try {
      const r = RANGES.find(x => x.id === rangeId) || RANGES[0];
      const fromTs = r.days ? Date.now() - r.days * 24 * 60 * 60 * 1000 : null;
      const result = await getStatsMetrics({ fromTs, orgIds: scopeOrgIds });
      setData(result);
    } catch (e) {
      console.error('getStatsMetrics failed', e);
      setError(e?.message || 'Failed to load stats.');
    } finally {
      setLoading(false);
    }
    // scopeOrgIds is derived from statsScope + active org.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statsScope, activeOrg?.id]);

  useEffect(() => { load(range); }, [range, load, activeOrg?.id]);

  const verdict = data?.verdict || 'na';
  const vMeta = BAND_META[verdict];
  const orgName = activeOrg?.partner_brand_name || activeOrg?.name || 'this organisation';

  // Reset the danger-zone form whenever the active org changes, so a
  // confirmation typed for one org can never be submitted against another.
  useEffect(() => {
    setPurgeConfirm('');
    setPurgeResult(null);
    setPurgeError(null);
  }, [activeOrg?.id]);

  const canPurge = purgeConfirm.trim().toUpperCase() === 'DELETE' && !purging && !!activeOrg?.id;

  async function handlePurge() {
    if (!canPurge) return;
    setPurging(true);
    setPurgeError(null);
    setPurgeResult(null);
    try {
      const res = await purgeOrgRecords(activeOrg.id);
      setPurgeResult(res);
      setPurgeConfirm('');
      load(range); // refresh the metrics so the cleared numbers show
    } catch (e) {
      console.error('purgeOrgRecords failed', e);
      setPurgeError(e?.message || 'Failed to delete records.');
    } finally {
      setPurging(false);
    }
  }

  return (
    <div className="admin-stats">
      {/* Header */}
      <div className="stats-header">
        <div>
          <h1 className="stats-header__title">System Health</h1>
          <p className="stats-header__sub">
            Health of the {orgName} return flow: QR generation, scan, reward, and dashboard tracking.
          </p>
        </div>
        <div className="stats-header__actions">
          <ScopeToggle />
          <select
            className="stats-range"
            value={range}
            onChange={(e) => setRange(e.target.value)}
          >
            {RANGES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
          <button className="stats-refresh" onClick={() => load(range)} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && <div className="stats-error">{error}</div>}

      {data && (
        <>
          {/* Verdict banner */}
          <div className="stats-verdict" style={{ background: vMeta.bg, borderColor: vMeta.color }}>
            <div className="stats-verdict__badge" style={{ background: vMeta.color }}>
              {vMeta.label}
            </div>
            <div className="stats-verdict__text">
              <strong>Overall test verdict: {vMeta.label}.</strong>{' '}
              {verdict === 'go' && 'All measurable metrics are in the Go band.'}
              {verdict === 'cond' && 'At least one metric is in the Conditional band — review the amber cards below.'}
              {verdict === 'nogo' && 'At least one metric is in the No-go band — see the red cards below.'}
              {verdict === 'na' && 'Not enough data collected yet to reach a verdict.'}
            </div>
            <div className="stats-verdict__totals">
              <span><strong>{data.totals.totalScans}</strong> scans</span>
              <span><strong>{data.totals.attemptingUsers}</strong> users</span>
              <span><strong>{data.totals.batchesGenerated}</strong> QR batches</span>
            </div>
          </div>

          {/* Metric cards */}
          <div className="stats-grid">
            {data.metrics.map(m => {
              const meta = BAND_META[m.band];
              return (
                <div key={m.id} className="stats-card" style={{ borderTopColor: meta.color }}>
                  <div className="stats-card__top">
                    <span className="stats-card__label">{m.label}</span>
                    <span className="stats-card__pill" style={{ color: meta.color, background: meta.bg }}>
                      {meta.label}
                    </span>
                  </div>
                  <div className="stats-card__value" style={{ color: m.band === 'na' ? '#9E9A93' : meta.color }}>
                    {m.band === 'na' ? 'N/A' : fmtPct(m.value)}
                  </div>
                  {m.denominator != null && m.band !== 'na' && (
                    <div className="stats-card__counts">
                      {m.numerator} / {m.denominator}
                    </div>
                  )}
                  <div className="stats-card__formula">{m.formula}</div>
                  <div className="stats-card__threshold">{thresholdText(m)}</div>
                  {m.note && <div className="stats-card__note">{m.note}</div>}
                  {data.details?.[m.id]?.rows?.length > 0 && (
                    <button
                      type="button"
                      className="stats-card__inspect"
                      onClick={() => openInspect({
                        label: m.label, numerator: m.numerator,
                        denominator: m.denominator, detail: data.details[m.id],
                      })}
                    >
                      Inspect {data.details[m.id].rows.length} rows →
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Charts row */}
          <div className="stats-charts">
            <div className="stats-panel">
              <h2 className="stats-panel__title">Scans over time</h2>
              {data.timeSeries.length === 0 ? (
                <p className="stats-empty">No scans in this range yet.</p>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={data.timeSeries} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                    <defs>
                      <linearGradient id="okGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#16A34A" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="#16A34A" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="failGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#DC2626" stopOpacity={0.22} />
                        <stop offset="95%" stopColor="#DC2626" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#F0EDE8" />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#9E9A93' }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#9E9A93' }} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <Area type="monotone" dataKey="success" name="Successful" stroke="#16A34A" strokeWidth={2} fill="url(#okGrad)" dot={false} />
                    <Area type="monotone" dataKey="failed" name="Failed" stroke="#DC2626" strokeWidth={2} fill="url(#failGrad)" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="stats-panel">
              <h2 className="stats-panel__title">Errors by type</h2>
              {data.errorBreakdown.length === 0 ? (
                <p className="stats-empty">No errors logged in this range. 🎉</p>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={data.errorBreakdown} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#F0EDE8" />
                    <XAxis dataKey="code" tick={{ fontSize: 10, fill: '#9E9A93' }} tickLine={false} axisLine={false} interval={0} angle={-12} textAnchor="end" height={50} />
                    <YAxis tick={{ fontSize: 11, fill: '#9E9A93' }} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="count" name="Count" radius={[4, 4, 0, 0]}>
                      {data.errorBreakdown.map((e) => (
                        <Cell key={e.code} fill={e.critical ? '#DC2626' : '#E8910C'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Error log */}
          <div className="stats-panel">
            <h2 className="stats-panel__title">Error log</h2>
            {data.errorBreakdown.length === 0 ? (
              <p className="stats-empty">No errors collected in this range.</p>
            ) : (
              <table className="stats-errtable">
                <thead>
                  <tr>
                    <th>Error code</th>
                    <th>Severity</th>
                    <th>Count</th>
                    <th>Latest message</th>
                    <th>Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {data.errorBreakdown.map(e => (
                    <tr key={e.code}>
                      <td><code>{e.code}</code></td>
                      <td>
                        <span className={`stats-sev ${e.critical ? 'stats-sev--crit' : 'stats-sev--warn'}`}>
                          {e.critical ? 'Critical' : 'Expected'}
                        </span>
                      </td>
                      <td>{e.count}</td>
                      <td className="stats-errtable__msg">{e.lastMessage || '—'}</td>
                      <td>{e.lastSeen ? new Date(e.lastSeen).toLocaleString('en-GB') : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* ── Danger zone: org-scoped test-data reset ── */}
      <div className="stats-danger">
        <div className="stats-danger__head">
          <span className="stats-danger__icon" aria-hidden="true">⚠️</span>
          <div>
            <h2 className="stats-danger__title">Danger zone — delete test data</h2>
            <p className="stats-danger__sub">
              Permanently deletes <strong>cup scans</strong>, <strong>reward claims</strong>, and{' '}
              <strong>cup transfers</strong> for <strong>{orgName}</strong> only. Other organisations
              are not affected. This cannot be undone.
            </p>
          </div>
        </div>

        <ul className="stats-danger__list">
          <li>Does <strong>not</strong> delete generated QR cup batches or rewards.</li>
          <li>Scoped strictly to this organisation (<code>{activeOrg?.slug || activeOrg?.id || '—'}</code>).</li>
          <li>Type <strong>DELETE</strong> below to enable the button.</li>
        </ul>

        <div className="stats-danger__row">
          <input
            type="text"
            className="stats-danger__input"
            placeholder="Type DELETE to confirm"
            value={purgeConfirm}
            onChange={(e) => setPurgeConfirm(e.target.value)}
            disabled={purging}
            aria-label="Type DELETE to confirm"
          />
          <button
            className="stats-danger__btn"
            onClick={handlePurge}
            disabled={!canPurge}
          >
            {purging ? 'Deleting…' : `Delete ${orgName} test data`}
          </button>
        </div>

        {purgeError && <div className="stats-danger__error">{purgeError}</div>}
        {purgeResult && (
          <div className="stats-danger__ok">
            Deleted for {orgName}: {purgeResult.cup_scans ?? 0} cup scans, {purgeResult.claims ?? 0} claims,{' '}
            {purgeResult.cup_transfers ?? 0} cup transfers.
          </div>
        )}
      </div>

      {inspect && (
        <InspectModal
          view={inspect}
          showAll={inspectAll}
          onToggleAll={() => setInspectAll(v => !v)}
          onClose={() => setInspect(null)}
        />
      )}
    </div>
  );
}
