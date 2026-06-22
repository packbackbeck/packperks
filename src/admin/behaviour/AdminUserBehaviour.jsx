import { useEffect, useState, useCallback } from 'react';
import { getUserBehaviourStats, getUserBehaviourDailyHistory } from '../lib/adminApi';
import { useOrg } from '../context/OrgContext';
import QuickLinks from '../shared/QuickLinks';
import MetricIcon from './behaviourIcons';
import DateRangePicker from './DateRangePicker';
import MetricDetailModal from './MetricDetailModal';
import './AdminUserBehaviour.css';

/* ─────────────────────────────────────────────────────────────────────
 * AdminUserBehaviour — the behavioural funnel, separate from System Health.
 *
 * Every rate is computed from live rows; each card shows the numerator and
 * denominator it came from in two small inner cards. Metrics that need
 * event instrumentation we don't capture yet are shown as "Not tracked yet"
 * with a note, never a faked number.
 *
 * On top of the cards: a time-window picker (defaults to all-time) scopes
 * every metric; a tile click opens a tailored detail modal with a trend
 * chart and a control to re-file the metric between sections; and the
 * whole board can be exported to a spreadsheet.
 * ───────────────────────────────────────────────────────────────────── */

const GROUPS = [
  { id: 'primary',   title: 'Primary',   desc: 'The core return-and-claim funnel.' },
  { id: 'secondary', title: 'Secondary', desc: 'Supporting behaviour and claim mix.' },
  { id: 'optional',  title: 'Optional',  desc: 'Derived or instrumentation-dependent signals.' },
];

/* Where the user's section re-assignments are remembered (per browser). */
const OVERRIDES_KEY = 'ppk_behaviour_group_overrides';

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

/* Unit shown in each history column header, and the raw cell value (kept as
 * a real number so the spreadsheet can chart it). Excel (.csv) gets a comma
 * decimal to match its semicolon-separated convention. */
function unitSuffix(valueType) {
  if (valueType === 'percent') return '%';
  if (valueType === 'duration') return 'sec';
  return 'count';
}

function histCell(valueType, v, isExcel) {
  if (v === null || v === undefined || Number.isNaN(v)) return '';
  let num;
  if (valueType === 'percent') num = Math.round(v * 10) / 10;
  else if (valueType === 'duration') num = Math.round((v / 1000) * 10) / 10; // ms → seconds
  else num = Math.round(v);
  const s = String(num);
  return isExcel ? s.replace('.', ',') : s;
}

/* A second table: one row per day, one column per selected metric, each
 * cell the metric's cumulative value as of that day. Numeric cells are
 * written raw (no escaping) so Excel decimals survive the ';' separator. */
function buildHistoryCsv(hist, selectedIds, formatId) {
  const isExcel = formatId === 'xlsx-csv';
  const sep = isExcel ? ';' : ',';
  const cols = hist.metrics.filter(m => selectedIds.has(m.id));
  const title = escapeCsv('Daily history — cumulative value per day');
  const header = ['Date', ...cols.map(m => `${m.label} (${unitSuffix(m.valueType)})`)]
    .map(escapeCsv).join(sep);
  const rows = hist.dates.map((d, i) =>
    [escapeCsv(d.iso.slice(0, 10)), ...cols.map(m => histCell(m.valueType, m.values[i], isExcel))].join(sep)
  );
  return [title, header, ...rows].join('\n');
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

function BehaviourCard({ m, onOpen }) {
  const hasNum = m.numLabel != null && m.numerator != null;
  const hasDen = m.denLabel != null && m.denominator != null;
  const noData = m.measurable && !m.valueText && (m.denominator == null || m.denominator === 0);

  let valueEl;
  if (!m.measurable) valueEl = <span className="ub-card__na">Not tracked yet</span>;
  else if (m.valueText) valueEl = m.valueText;
  else if (noData) valueEl = <span className="ub-card__na">No data yet</span>;
  else valueEl = fmtPct(m.value);

  return (
    <button
      type="button"
      className={`ub-card${!m.measurable ? ' ub-card--na' : ''}`}
      onClick={() => onOpen(m)}
      aria-label={`${m.label} — open details`}
    >
      <span className="ub-card__icon" aria-hidden="true"><MetricIcon id={m.id} width="18" height="18" /></span>

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
      <span className="ub-card__more">View details →</span>
    </button>
  );
}

export default function AdminUserBehaviour({ onNavigate }) {
  const { activeOrg } = useOrg();
  const [metrics, setMetrics] = useState(null);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Time window (null/null = all-time).
  const [range, setRange] = useState({ from: null, to: null });

  // Detail modal + per-browser section re-assignments.
  const [openId, setOpenId] = useState(null);
  const [overrides, setOverrides] = useState(() => {
    try { return JSON.parse(localStorage.getItem(OVERRIDES_KEY)) || {}; }
    catch { return {}; }
  });

  // Export-to-spreadsheet state.
  const [exportOpen, setExportOpen] = useState(false);
  const [format, setFormat] = useState('xlsx-csv');
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [includeHistory, setIncludeHistory] = useState(false);
  const [exporting, setExporting] = useState(false);

  const orgName = activeOrg?.partner_brand_name || activeOrg?.name || 'this organisation';

  const load = useCallback(async (r) => {
    setLoading(true);
    setError(null);
    try {
      const data = await getUserBehaviourStats(r || { from: null, to: null });
      setMetrics(data.metrics);
      setMeta(data.meta);
    } catch (e) {
      console.error('getUserBehaviourStats failed', e);
      setError(e?.message || 'Failed to load behaviour metrics.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(range); }, [load, activeOrg?.id, range]);

  // Whenever the metric set changes, default every metric to "on" for export.
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

  // Effective section for a metric = user's override, else its native group.
  const effGroup = (m) => overrides[m.id] || m.group;

  function changeGroup(id, g) {
    setOverrides(prev => {
      const next = { ...prev, [id]: g };
      try { localStorage.setItem(OVERRIDES_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }

  function toggleMetric(id) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  const selectAll = () => setSelectedIds(new Set((metrics || []).map(m => m.id)));
  const selectNone = () => setSelectedIds(new Set());

  async function handleExport() {
    if (!metrics || selectedIds.size === 0 || exporting) return;
    setExporting(true);
    try {
      const groupTitle = Object.fromEntries(GROUPS.map(g => [g.id, g.title]));
      // Preserve the on-screen order; only include checked metrics. Use the
      // effective (possibly overridden) section in the export.
      const rows = metrics
        .filter(m => selectedIds.has(m.id))
        .map(m => metricToRow(m, groupTitle[effGroup(m)] || effGroup(m)));
      const fmt = FORMATS.find(f => f.id === format) || FORMATS[0];
      let content = buildCsv(rows, fmt.id);

      // Optional second table: each selected metric's value, day by day.
      if (includeHistory) {
        const hist = await getUserBehaviourDailyHistory(range);
        content += '\n\n' + buildHistoryCsv(hist, selectedIds, fmt.id);
      }

      const stamp = new Date().toISOString().slice(0, 10);
      const slug = (orgName || 'org').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const suffix = includeHistory ? '_with_daily_history' : '';
      downloadFile(content, `packperks_user_behaviour${suffix}_${slug}_${stamp}.${fmt.ext}`, fmt.mime);
      setExportOpen(false);
    } catch (e) {
      console.error('behaviour export failed', e);
      setError(e?.message || 'Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  }

  const openMetric = metrics && openId ? metrics.find(m => m.id === openId) : null;

  return (
    <div className="ub-page">
      <div className="ub-header">
        <div>
          <h1 className="ub-header__title">User Behaviour</h1>
          <p className="ub-header__sub">
            Real behavioural rates for {orgName}. Every percentage shows the exact counts
            it was calculated from. Pick a time window, or click any tile to dive in.
          </p>
        </div>
        <div className="ub-header__actions">
          <DateRangePicker value={range} meta={meta} onChange={setRange} />
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
          <button className="ub-refresh" onClick={() => load(range)} disabled={loading}>
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
                const items = metrics.filter(m => effGroup(m) === g.id);
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

            <label className="ub-export__history">
              <input
                type="checkbox"
                className="ub-switch-input"
                checked={includeHistory}
                onChange={e => setIncludeHistory(e.target.checked)}
              />
              <span className="ub-switch" aria-hidden="true"><span className="ub-switch__dot" /></span>
              <span className="ub-export__history-text">
                <span className="ub-export__history-title">Include daily history</span>
                <span className="ub-export__history-sub">Adds a second table: each selected metric's value day by day across the chosen period.</span>
              </span>
            </label>

            <div className="ub-export__foot">
              <div className="ub-export__formats">
                {FORMATS.map(f => (
                  <label key={f.id} className="ub-export__fmt">
                    <input type="radio" name="ub-export-fmt" checked={format === f.id} onChange={() => setFormat(f.id)} />
                    {f.label}
                  </label>
                ))}
              </div>
              <button className="ub-export__go" onClick={handleExport} disabled={selectedIds.size === 0 || exporting}>
                {exporting ? 'Preparing…' : `Download${selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {metrics && GROUPS.map(g => {
        const cards = metrics.filter(m => effGroup(m) === g.id);
        if (!cards.length) return null;
        return (
          <section key={g.id} className="ub-section">
            <div className="ub-section__head">
              <h2 className="ub-section__title">{g.title}</h2>
              <p className="ub-section__desc">{g.desc}</p>
            </div>
            <div className="ub-grid">
              {cards.map(m => <BehaviourCard key={m.id} m={m} onOpen={() => setOpenId(m.id)} />)}
            </div>
          </section>
        );
      })}

      {openMetric && (
        <MetricDetailModal
          metric={openMetric}
          effectiveGroup={effGroup(openMetric)}
          groups={GROUPS}
          onChangeGroup={(g) => changeGroup(openMetric.id, g)}
          onClose={() => setOpenId(null)}
        />
      )}

      <QuickLinks currentPage="behaviour" onNavigate={onNavigate} />
    </div>
  );
}
