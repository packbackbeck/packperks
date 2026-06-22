import { useEffect, useState, useCallback } from 'react';
import { getUserBehaviourStats } from '../lib/adminApi';
import { useOrg } from '../context/OrgContext';
import QuickLinks from '../shared/QuickLinks';
import './AdminUserBehaviour.css';

/* ─────────────────────────────────────────────────────────────────────
 * AdminUserBehaviour — the behavioural funnel, separate from System Health.
 *
 * Every rate is computed from live rows; each card shows the numerator and
 * denominator it came from in two small inner cards. Metrics that need
 * event instrumentation we don't capture yet are shown as "Not tracked yet"
 * with a note, never a faked number.
 * ───────────────────────────────────────────────────────────────────── */

const GROUPS = [
  { id: 'primary',   title: 'Primary',   desc: 'The core return-and-claim funnel.' },
  { id: 'secondary', title: 'Secondary', desc: 'Supporting behaviour and claim mix.' },
  { id: 'optional',  title: 'Optional',  desc: 'Derived or instrumentation-dependent signals.' },
];

/* Export formats — same convention as Reports: the "Excel" entry is a
 * UTF-8-BOM CSV with a semicolon separator so Excel (Win/Mac) opens it as
 * a proper spreadsheet; the plain CSV keeps commas for other tooling. */
const FORMATS = [
  { id: 'xlsx-csv', label: 'Excel (.csv)', ext: 'csv', mime: 'text/csv' },
  { id: 'csv',      label: 'CSV (plain)',  ext: 'csv', mime: 'text/csv' },
];

/* Columns written for each selected metric. */
const EXPORT_COLUMNS = [
  { key: 'group',       label: 'Group' },
  { key: 'label',       label: 'Metric' },
  { key: 'value',       label: 'Value' },
  { key: 'numerator',   label: 'Numerator' },
  { key: 'numLabel',    label: 'Numerator label' },
  { key: 'denominator', label: 'Denominator' },
  { key: 'denLabel',    label: 'Denominator label' },
  { key: 'desc',        label: 'Description' },
];

function fmtPct(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}%`;
}

function fmtNum(n) {
  if (n === null || n === undefined) return '—';
  return Number(n).toLocaleString();
}

/* The value as shown on the card, flattened to a string for export. */
function metricValueText(m) {
  if (!m.measurable) return 'Not tracked yet';
  if (m.valueText) return m.valueText;
  if (m.value == null || Number.isNaN(m.value)) return 'No data yet';
  return fmtPct(m.value);
}

function escapeCsv(val) {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (/[";,\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function buildCsv(rows, formatId) {
  const isExcel = formatId === 'xlsx-csv';
  const sep = isExcel ? ';' : ',';
  const header = EXPORT_COLUMNS.map(c => c.label).join(sep);
  const body = rows
    .map(r => EXPORT_COLUMNS.map(c => escapeCsv(r[c.key])).join(sep))
    .join('\n');
  const bom = isExcel ? '﻿' : '';
  return bom + header + '\n' + body;
}

function downloadFile(content, filename, mime) {
  const blob = new Blob([content], { type: mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* Flatten one metric into an export row. desc can be a React node on a
 * couple of cards; only plain-string descriptions are exported. */
function metricToRow(m, groupTitle) {
  return {
    group: groupTitle,
    label: m.label,
    value: metricValueText(m),
    numerator: m.numerator ?? '',
    numLabel: m.numLabel ?? '',
    denominator: m.denominator ?? '',
    denLabel: m.denLabel ?? '',
    desc: typeof m.desc === 'string' ? m.desc : '',
  };
}

function BehaviourCard({ m }) {
  const hasNum = m.numLabel != null && m.numerator != null;
  const hasDen = m.denLabel != null && m.denominator != null;
  const noData = m.measurable && !m.valueText && (m.denominator == null || m.denominator === 0);

  let valueEl;
  if (!m.measurable) valueEl = <span className="ub-card__na">Not tracked yet</span>;
  else if (m.valueText) valueEl = m.valueText;
  else if (noData) valueEl = <span className="ub-card__na">No data yet</span>;
  else valueEl = fmtPct(m.value);

  return (
    <div className={`ub-card${!m.measurable ? ' ub-card--na' : ''}`}>
      <div className="ub-card__label">{m.label}</div>

      <div className="ub-card__value">{valueEl}</div>

      {m.measurable ? (
        (hasNum || hasDen) && (
          <div className="ub-card__subs">
            {hasNum && (
              <div className="ub-sub">
                <span className="ub-sub__num">{fmtNum(m.numerator)}</span>
                <span className="ub-sub__lbl">{m.numLabel}</span>
              </div>
            )}
            {hasNum && hasDen && <span className="ub-sub__op">/</span>}
            {hasDen && (
              <div className="ub-sub">
                <span className="ub-sub__num">{fmtNum(m.denominator)}</span>
                <span className="ub-sub__lbl">{m.denLabel}</span>
              </div>
            )}
          </div>
        )
      ) : (
        <div className="ub-card__note">{m.note}</div>
      )}

      <div className="ub-card__desc">{m.desc}</div>
    </div>
  );
}

export default function AdminUserBehaviour({ onNavigate }) {
  const { activeOrg } = useOrg();
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Export-to-spreadsheet state.
  const [exportOpen, setExportOpen] = useState(false);
  const [format, setFormat] = useState('xlsx-csv');
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  const orgName = activeOrg?.partner_brand_name || activeOrg?.name || 'this organisation';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getUserBehaviourStats();
      setMetrics(data);
    } catch (e) {
      console.error('getUserBehaviourStats failed', e);
      setError(e?.message || 'Failed to load behaviour metrics.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, activeOrg?.id]);

  // Whenever the metric set changes, default every metric to "on".
  useEffect(() => {
    if (metrics) setSelectedIds(new Set(metrics.map(m => m.id)));
  }, [metrics]);

  // Close the export sheet on Escape.
  useEffect(() => {
    if (!exportOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setExportOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [exportOpen]);

  function toggleMetric(id) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  const selectAll = () => setSelectedIds(new Set((metrics || []).map(m => m.id)));
  const selectNone = () => setSelectedIds(new Set());

  function handleExport() {
    if (!metrics || selectedIds.size === 0) return;
    const groupTitle = Object.fromEntries(GROUPS.map(g => [g.id, g.title]));
    // Preserve the on-screen order; only include checked metrics.
    const rows = metrics
      .filter(m => selectedIds.has(m.id))
      .map(m => metricToRow(m, groupTitle[m.group] || m.group));
    const fmt = FORMATS.find(f => f.id === format) || FORMATS[0];
    const stamp = new Date().toISOString().slice(0, 10);
    const slug = (orgName || 'org').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    downloadFile(buildCsv(rows, fmt.id), `packperks_user_behaviour_${slug}_${stamp}.${fmt.ext}`, fmt.mime);
    setExportOpen(false);
  }

  return (
    <div className="ub-page">
      <div className="ub-header">
        <div>
          <h1 className="ub-header__title">User Behaviour</h1>
          <p className="ub-header__sub">
            Real behavioural rates for {orgName}. Every percentage shows the exact counts
            it was calculated from. All-time, computed from live cups, scans, claims, and users.
          </p>
        </div>
        <div className="ub-header__actions">
          <button
            className="ub-export-btn"
            onClick={() => setExportOpen(true)}
            disabled={loading || !metrics}
            title="Export these metrics to Excel / CSV"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Export
          </button>
          <button className="ub-refresh" onClick={load} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && <div className="ub-error">{error}</div>}

      {exportOpen && metrics && (
        <div className="ub-export-overlay" onClick={() => setExportOpen(false)} role="presentation">
          <div className="ub-export" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Export behaviour metrics">
            <div className="ub-export__head">
              <h2 className="ub-export__title">Export metrics</h2>
              <button className="ub-export__close" onClick={() => setExportOpen(false)} aria-label="Close">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <p className="ub-export__sub">Pick the metrics to include, then download as a spreadsheet. Each row carries the value plus the raw numerator and denominator it came from.</p>

            <div className="ub-export__toolbar">
              <span className="ub-export__count">{selectedIds.size} of {metrics.length} selected</span>
              <div className="ub-export__toolbtns">
                <button type="button" onClick={selectAll}>Select all</button>
                <button type="button" onClick={selectNone}>Clear</button>
              </div>
            </div>

            <div className="ub-export__list">
              {GROUPS.map(g => {
                const items = metrics.filter(m => m.group === g.id);
                if (!items.length) return null;
                return (
                  <div key={g.id} className="ub-export__group">
                    <div className="ub-export__group-title">{g.title}</div>
                    {items.map(m => (
                      <label key={m.id} className="ub-export__item">
                        <input type="checkbox" checked={selectedIds.has(m.id)} onChange={() => toggleMetric(m.id)} />
                        <span>{m.label}</span>
                      </label>
                    ))}
                  </div>
                );
              })}
            </div>

            <div className="ub-export__foot">
              <div className="ub-export__formats">
                {FORMATS.map(f => (
                  <label key={f.id} className="ub-export__fmt">
                    <input type="radio" name="ub-export-fmt" checked={format === f.id} onChange={() => setFormat(f.id)} />
                    {f.label}
                  </label>
                ))}
              </div>
              <button className="ub-export__go" onClick={handleExport} disabled={selectedIds.size === 0}>
                Download{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
              </button>
            </div>
          </div>
        </div>
      )}

      {metrics && GROUPS.map(g => {
        const cards = metrics.filter(m => m.group === g.id);
        if (!cards.length) return null;
        return (
          <section key={g.id} className="ub-section">
            <div className="ub-section__head">
              <h2 className="ub-section__title">{g.title}</h2>
              <p className="ub-section__desc">{g.desc}</p>
            </div>
            <div className="ub-grid">
              {cards.map(m => <BehaviourCard key={m.id} m={m} />)}
            </div>
          </section>
        );
      })}

      <QuickLinks currentPage="behaviour" onNavigate={onNavigate} />
    </div>
  );
}
