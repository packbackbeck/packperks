import { useEffect, useState, useCallback } from 'react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { getStatsMetrics, getUserActionStats, purgeOrgRecords } from '../lib/adminApi';
import { useOrg } from '../context/OrgContext';
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

/* Per-metric presentation for the User action stats cards: an icon, a
 * one-line "what it means", and the unit the numerator/denominator are in.
 * Keyed by the metric ids returned from getUserActionStats(). */
const UAS_META = {
  qr_claimed_rate: {
    tone: '#1A8737', unit: 'cups',
    desc: 'Share of issued QR cup tokens that customers actually scanned and claimed.',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
        <rect x="3" y="14" width="7" height="7" rx="1"/><line x1="14" y1="14" x2="14" y2="14.01"/>
        <line x1="21" y1="14" x2="21" y2="21"/><line x1="14" y1="21" x2="17" y2="21"/>
      </svg>
    ),
  },
  returning_scanners: {
    tone: '#2563EB', unit: 'users',
    desc: 'Stickiness — of everyone who claimed once, how many came back to scan a second receipt.',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
      </svg>
    ),
  },
  claim_mix_reward: {
    tone: '#E8910C', unit: 'claims',
    desc: 'Of all claims made, the share that chose a reward (cashback) over cash.',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/>
        <line x1="12" y1="22" x2="12" y2="7"/>
        <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>
      </svg>
    ),
  },
  claim_mix_refund: {
    tone: '#0F766E', unit: 'claims',
    desc: 'Of all claims, the share that took the plain direct cash refund.',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>
        <line x1="6" y1="12" x2="6.01" y2="12"/><line x1="18" y1="12" x2="18.01" y2="12"/>
      </svg>
    ),
  },
  claim_mix_donation: {
    tone: '#DC2626', unit: 'claims',
    desc: 'Of all claims, the share donated to the partner charity.',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 1 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z"/>
      </svg>
    ),
  },
  cups_used_rate: {
    tone: '#7C3AED', unit: 'cups',
    desc: 'Of all cups customers collected, how many they have spent on a claim.',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/>
        <line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/>
      </svg>
    ),
  },
};

export default function AdminStats() {
  const { activeOrg } = useOrg();
  const [range, setRange] = useState('all');
  const [data, setData] = useState(null);
  const [actionStats, setActionStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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
      // User-action stats are all-time (not range-scoped) — fetched together.
      const [result, actions] = await Promise.all([
        getStatsMetrics({ fromTs }),
        getUserActionStats(),
      ]);
      setData(result);
      setActionStats(actions);
    } catch (e) {
      console.error('getStatsMetrics failed', e);
      setError(e?.message || 'Failed to load stats.');
    } finally {
      setLoading(false);
    }
  }, []);

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
          <h1 className="stats-header__title">Stats — Feasibility Test</h1>
          <p className="stats-header__sub">
            End-to-end validation of the {orgName} return flow: QR generation → scan → reward → dashboard.
          </p>
        </div>
        <div className="stats-header__actions">
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

      {/* ── User action stats — real behavioural percentages ── */}
      <section className="uas">
        <div className="uas__head">
          <h2 className="uas__title">User action stats</h2>
          <p className="uas__sub">
            Live behavioural rates for {orgName} — every number is computed from real
            cups, scans, and claims (all-time, not affected by the range filter).
          </p>
        </div>
        <div className="uas__grid">
          {(actionStats || []).map(m => {
            const meta = UAS_META[m.id] || {};
            return (
              <div key={m.id} className="uas__card" title={m.formula}>
                <div className="uas__top">
                  <span className="uas__icon" style={{ background: `${meta.tone || '#1A8737'}1A`, color: meta.tone || '#1A8737' }}>
                    {meta.icon}
                  </span>
                  <span className="uas__value" style={{ color: meta.tone || '#1A8737' }}>
                    {m.value == null ? '—' : `${Math.round(m.value)}%`}
                  </span>
                </div>
                <div className="uas__label">{m.label}</div>
                <div className="uas__desc">{meta.desc || m.formula}</div>
                <div className="uas__foot">
                  <span className="uas__frac">
                    {m.denominator > 0
                      ? `${m.numerator.toLocaleString()} / ${m.denominator.toLocaleString()} ${meta.unit || ''}`.trim()
                      : 'No data yet'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

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
    </div>
  );
}
