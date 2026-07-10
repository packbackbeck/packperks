import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { applyOrgFilter } from '../context/orgState';
import { useAuth } from '../auth/AuthContext';
import { logAction } from '../auth/actionLog';
import QuickLinks from '../shared/QuickLinks';
import './AdminReports.css';

/* ── Dataset definitions ── */
const DATASETS = {
  users: {
    label: 'Users',
    description: 'All registered users with cup balances.',
    columns: [
      { key: 'id',            label: 'User ID',       type: 'text' },
      { key: 'display_name',  label: 'Name',          type: 'text',    default: true },
      { key: 'email',         label: 'Email',         type: 'text',    default: true },
      { key: 'cup_balance',   label: 'Cup Balance',   type: 'number',  default: true, sum: true },
      { key: 'lifetime_cups', label: 'Lifetime Cups', type: 'number',  sum: true },
      { key: 'created_at',    label: 'Joined',        type: 'date',    default: true },
      { key: 'updated_at',    label: 'Last Active',   type: 'date',    default: true },
    ],
    statusOptions: null,
  },
  claims: {
    label: 'Claims',
    description: 'Cashback and direct refund claims by users.',
    columns: [
      { key: 'id',             label: 'Claim ID',     type: 'text' },
      { key: 'user_name',      label: 'User',         type: 'text',   default: true },
      { key: 'user_email',     label: 'Email',        type: 'text' },
      { key: 'type',           label: 'Type',         type: 'text',   default: true },
      { key: 'reward_id',      label: 'Reward',       type: 'text' },
      { key: 'cups_redeemed',  label: 'Cups',         type: 'number', default: true, sum: true },
      { key: 'payout_amount',  label: 'Payout (€)',   type: 'currency', default: true, sum: true },
      { key: 'status',         label: 'Status',       type: 'text',   default: true },
      { key: 'created_at',     label: 'Created',      type: 'date',   default: true },
    ],
    statusOptions: ['all', 'pending', 'completed', 'failed'],
  },
  cup_scans: {
    label: 'Cup Scans',
    description: 'Receipt photo submissions awarding cups.',
    columns: [
      { key: 'id',           label: 'Scan ID',     type: 'text' },
      { key: 'user_name',    label: 'User',        type: 'text',   default: true },
      { key: 'user_email',   label: 'Email',       type: 'text' },
      { key: 'cups_awarded', label: 'Cups',        type: 'number', default: true, sum: true },
      { key: 'status',       label: 'Status',      type: 'text',   default: true },
      { key: 'created_at',   label: 'Created',     type: 'date',   default: true },
    ],
    statusOptions: ['all', 'pending', 'approved', 'rejected'],
  },
  activity: {
    label: 'Activity',
    description: 'All user actions (cup added, claimed, donated…).',
    columns: [
      { key: 'id',         label: 'Event ID',  type: 'text' },
      { key: 'user_name',  label: 'User',      type: 'text', default: true },
      { key: 'type',       label: 'Type',      type: 'text', default: true },
      { key: 'label',      label: 'Label',     type: 'text', default: true },
      { key: 'created_at', label: 'When',      type: 'date', default: true },
    ],
    statusOptions: null,
  },
};

const PERIODS = [
  { id: '7d',   label: 'Last 7 days',  days: 7 },
  { id: '30d',  label: 'Last 30 days', days: 30 },
  { id: '90d',  label: 'Last 90 days', days: 90 },
  { id: 'all',  label: 'All time',     days: null },
  { id: 'custom', label: 'Custom',     days: null },
];

/* Export formats. The "Excel" entry is a UTF-8-BOM CSV with a
 * semicolon separator — Excel for Windows / Mac autodetects this as a
 * proper spreadsheet and respects European decimal commas, whereas a
 * plain comma-separated CSV often opens as a single column or with
 * the decimal point gone sideways. PDF is added via the existing jsPDF
 * dependency (already in the bundle for receipt exports). */
const FORMATS = [
  { id: 'xlsx-csv', label: 'Excel (.csv)', ext: 'csv',  mime: 'text/csv' },
  { id: 'csv',      label: 'CSV (plain)',  ext: 'csv',  mime: 'text/csv' },
  { id: 'json',     label: 'JSON',         ext: 'json', mime: 'application/json' },
  { id: 'pdf',      label: 'PDF',          ext: 'pdf',  mime: 'application/pdf' },
];

/* Which datasets contain PII (email columns). Only roles with
 * the `data.export_pii` permission can export these — others see the
 * non-PII reports only. Activity is borderline (it joins user names)
 * but the column shape is shallow so we treat it as safe. */
const PII_DATASETS = new Set(['users', 'claims']);

/* ── Helpers ── */
function formatValue(val, type) {
  if (val === null || val === undefined || val === '') return '';
  if (type === 'date') {
    const d = new Date(val);
    if (isNaN(d.getTime())) return val;
    return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  if (type === 'currency') return `€${Number(val).toFixed(2)}`;
  if (type === 'number')   return String(val);
  return String(val);
}

function escapeCsv(val) {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function buildExport(rows, columns, format) {
  if (format === 'json') {
    return JSON.stringify(rows.map(r => {
      const out = {};
      columns.forEach(c => { out[c.key] = r[c.key] ?? null; });
      return out;
    }), null, 2);
  }
  // `xlsx-csv` uses ; as separator + a BOM prefix so Excel auto-recognises
  // it. Plain `csv` keeps a comma separator for non-Excel tooling.
  const isExcel = format === 'xlsx-csv';
  const sep = isExcel ? ';' : ',';
  const header = columns.map(c => c.label).join(sep);
  const body = rows.map(r => columns.map(c => {
    const v = r[c.key];
    if (c.type === 'date' && v) return new Date(v).toISOString();
    if (c.type === 'currency' && isExcel && v != null && v !== '') {
      // European decimal — Excel will display this as €X,YZ in NL locale.
      return String(Number(v).toFixed(2)).replace('.', ',');
    }
    return escapeCsv(v);
  }).join(sep)).join('\n');
  // BOM tells Excel to treat the file as UTF-8 instead of Windows-1252.
  const bom = isExcel ? '﻿' : '';
  return bom + header + '\n' + body;
}

/* PDF export — uses jsPDF (already in the bundle). Keeps things simple:
 * landscape A4, header bar, autoTable-style rows with alternating zebra,
 * footer with row count + generated-on timestamp. For very wide reports
 * (claims) we let columns wrap rather than truncating. */
async function buildPdf(rows, columns, datasetLabel, period) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 28;
  const usableW = pageW - margin * 2;
  // Header
  doc.setFillColor(83, 51, 165); // PackBack purple
  doc.rect(0, 0, pageW, 42, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(`PackPerks — ${datasetLabel} report`, margin, 26);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`${period} · generated ${new Date().toLocaleString('en-GB')}`, pageW - margin, 26, { align: 'right' });

  // Body table
  const colW = usableW / columns.length;
  const startY = 58;
  const rowH = 18;
  let y = startY;

  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(60, 60, 60);
  doc.setFillColor(236, 229, 216); // cream
  doc.rect(margin, y - 12, usableW, rowH, 'F');
  columns.forEach((c, i) => doc.text(String(c.label).slice(0, 28), margin + 6 + i * colW, y, { maxWidth: colW - 8 }));
  y += rowH;

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(30, 30, 30);
  rows.forEach((r, idx) => {
    if (y > pageH - 40) { doc.addPage(); y = 40; }
    if (idx % 2 === 0) {
      doc.setFillColor(250, 248, 244);
      doc.rect(margin, y - 12, usableW, rowH, 'F');
    }
    columns.forEach((c, i) => {
      const raw = r[c.key];
      const txt = c.type === 'date' && raw
        ? new Date(raw).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })
        : c.type === 'currency' && raw != null
          ? `€${Number(raw).toFixed(2)}`
          : String(raw ?? '');
      doc.text(txt.slice(0, 40), margin + 6 + i * colW, y, { maxWidth: colW - 8 });
    });
    y += rowH;
  });

  // Footer
  doc.setFontSize(8);
  doc.setTextColor(140, 140, 140);
  doc.text(`${rows.length} rows`, margin, pageH - 14);

  return doc.output('blob');
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

/* ── Data loaders ── */
async function loadDataset(dataset, fromIso, toIso) {
  // Multi-org: every query here is scoped to the currently-active org
  // via applyOrgFilter. Without this, reports leaked rows across orgs
  // (KFC's report would include BK's users/claims).
  if (dataset === 'users') {
    const [{ data: users }, { data: balances }] = await Promise.all([
      applyOrgFilter(supabase.from('users').select('id, display_name, email, created_at, updated_at')),
      applyOrgFilter(supabase.from('cup_balances').select('user_id, balance, lifetime_cups')),
    ]);
    const balMap = Object.fromEntries((balances || []).map(b => [b.user_id, b]));
    let rows = (users || []).map(u => ({
      ...u,
      cup_balance: balMap[u.id]?.balance ?? 0,
      lifetime_cups: balMap[u.id]?.lifetime_cups ?? 0,
    }));
    if (fromIso) rows = rows.filter(r => r.created_at >= fromIso);
    if (toIso)   rows = rows.filter(r => r.created_at <= toIso);
    return rows;
  }
  if (dataset === 'claims' || dataset === 'cup_scans' || dataset === 'activity') {
    const table = dataset === 'activity' ? 'activity_history' : dataset;
    const cols  = dataset === 'claims'
      ? 'id, user_id, type, reward_id, cups_redeemed, payout_amount, status, created_at'
      : dataset === 'cup_scans'
      ? 'id, user_id, cups_awarded, status, created_at'
      : 'id, user_id, type, label, created_at';
    let q = applyOrgFilter(supabase.from(table).select(cols).order('created_at', { ascending: false }));
    if (fromIso) q = q.gte('created_at', fromIso);
    if (toIso)   q = q.lte('created_at', toIso);
    const { data } = await q;
    const rows = data || [];
    const userIds = [...new Set(rows.map(r => r.user_id).filter(Boolean))];
    if (userIds.length) {
      const { data: users } = await applyOrgFilter(
        supabase.from('users').select('id, display_name, email').in('id', userIds)
      );
      const map = Object.fromEntries((users || []).map(u => [u.id, u]));
      return rows.map(r => ({ ...r, user_name: map[r.user_id]?.display_name || '—', user_email: map[r.user_id]?.email || '' }));
    }
    return rows;
  }
  return [];
}

/* ── Component ── */
export default function AdminReports({ onNavigate }) {
  // Role-gated PII export: Owners + Admins can export the full Users
  // and Claims reports including email columns. Everyone else
  // sees the safe datasets (cup_scans, activity) only. We resolve the
  // role once here and reuse it through the rest of the page.
  const { profile } = useAuth();
  const role = profile?.role || 'checker';
  const canExportPii = role === 'owner' || role === 'admin';

  const [dataset, setDataset] = useState(canExportPii ? 'users' : 'cup_scans');
  const cfg = DATASETS[dataset];

  const [selectedCols, setSelectedCols] = useState(() =>
    new Set(cfg.columns.filter(c => c.default).map(c => c.key))
  );
  const [period, setPeriod] = useState('30d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('');
  const [sortDir, setSortDir] = useState('desc');
  const [format, setFormat] = useState('csv');

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState(null);

  /* Reset selections when dataset changes */
  useEffect(() => {
    setSelectedCols(new Set(cfg.columns.filter(c => c.default).map(c => c.key)));
    setStatusFilter('all');
    setSortKey('');
  }, [dataset]); // eslint-disable-line

  /* Auto-fetch */
  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setError(null);

    let fromIso = null, toIso = null;
    const p = PERIODS.find(p => p.id === period);
    if (p?.days) fromIso = new Date(Date.now() - p.days * 86400000).toISOString();
    if (period === 'custom') {
      if (customFrom) fromIso = new Date(customFrom).toISOString();
      if (customTo)   toIso   = new Date(customTo + 'T23:59:59').toISOString();
    }

    loadDataset(dataset, fromIso, toIso)
      .then(data => { if (!cancel) setRows(data); })
      .catch(err => { if (!cancel) setError(err.message || 'Failed to load data'); })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [dataset, period, customFrom, customTo]);

  /* Filter + sort */
  const visibleColumns = cfg.columns.filter(c => selectedCols.has(c.key));

  const filtered = useMemo(() => {
    let list = rows;
    if (statusFilter !== 'all' && cfg.statusOptions) {
      list = list.filter(r => r.status === statusFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(r => Object.values(r).some(v => String(v ?? '').toLowerCase().includes(q)));
    }
    if (sortKey) {
      list = [...list].sort((a, b) => {
        let av = a[sortKey], bv = b[sortKey];
        if (av === null || av === undefined) av = '';
        if (bv === null || bv === undefined) bv = '';
        if (typeof av === 'number' && typeof bv === 'number') return sortDir === 'asc' ? av - bv : bv - av;
        return sortDir === 'asc'
          ? String(av).localeCompare(String(bv))
          : String(bv).localeCompare(String(av));
      });
    }
    return list;
  }, [rows, statusFilter, search, sortKey, sortDir, cfg.statusOptions]);

  /* Aggregates */
  const aggregates = useMemo(() => {
    const out = {};
    cfg.columns.forEach(c => {
      if (c.sum && selectedCols.has(c.key)) {
        out[c.key] = filtered.reduce((s, r) => s + (Number(r[c.key]) || 0), 0);
      }
    });
    return out;
  }, [filtered, cfg.columns, selectedCols]);

  /* Toggle column */
  function toggleColumn(key) {
    setSelectedCols(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size > 1) next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function selectAllCols() {
    setSelectedCols(new Set(cfg.columns.map(c => c.key)));
  }
  function selectDefaultCols() {
    setSelectedCols(new Set(cfg.columns.filter(c => c.default).map(c => c.key)));
  }

  function handleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  }

  async function handleExport() {
    const fmt = FORMATS.find(f => f.id === format);
    if (!fmt) return;
    // Block PII-bearing exports for roles without `data.export_pii`.
    // The UI already disables the dataset selector for those roles, but
    // this is a defence-in-depth check in case the state slipped through.
    if (PII_DATASETS.has(dataset) && !canExportPii) {
      alert("Your role can't export reports that include emails. Ask an Owner or Admin for help.");
      return;
    }
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === 'pdf') {
      const periodLabel = PERIODS.find(p => p.id === period)?.label || '';
      const blob = await buildPdf(filtered, visibleColumns, cfg.label, periodLabel);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `packperks_${dataset}_${stamp}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } else {
      const content = buildExport(filtered, visibleColumns, format);
      downloadFile(content, `packperks_${dataset}_${stamp}.${fmt.ext}`, fmt.mime);
    }
    // Audit every export — what dataset, how many rows, by whom, in
    // which format. PII exports especially are useful to be able to
    // trace later if a leak is suspected.
    logAction({
      action: 'report.export',
      targetType: 'report',
      targetId: dataset,
      metadata: {
        dataset,
        format,
        rows: filtered.length,
        columns: visibleColumns.map(c => c.key),
        contains_pii: PII_DATASETS.has(dataset),
        // B10: record the SPECIFIC PII columns that left the system and how many
        // rows, so a personal-data egress is queryable on its own (to match the
        // per-look pii.reveal events) — not just inferred from a boolean flag.
        pii_columns: visibleColumns
          .filter(c => c.key === 'email' || c.key === 'user_email')
          .map(c => c.key),
        pii_rows: PII_DATASETS.has(dataset) ? filtered.length : 0,
      },
    });
  }

  function handleCopy() {
    const content = buildExport(filtered, visibleColumns, format);
    navigator.clipboard?.writeText(content).then(
      () => alert(`Copied ${filtered.length} rows as ${format.toUpperCase()}.`),
      () => alert('Copy failed.')
    );
  }

  function handlePrint() {
    const stamp = new Date().toLocaleString('en-GB');
    const periodLabel = PERIODS.find(p => p.id === period)?.label || '';
    const tableHtml = `
      <table>
        <thead><tr>${visibleColumns.map(c => `<th>${c.label}</th>`).join('')}</tr></thead>
        <tbody>${filtered.map(r => `<tr>${visibleColumns.map(c => `<td>${formatValue(r[c.key], c.type)}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>`;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(`<!doctype html><html><head><title>PackPerks · ${cfg.label} report</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; padding: 24px; color: #1A1A1A; }
        h1 { font-size: 18px; margin: 0 0 4px; }
        .meta { color: #6B6860; font-size: 12px; margin-bottom: 16px; }
        table { width: 100%; border-collapse: collapse; font-size: 11px; }
        th, td { padding: 6px 8px; border-bottom: 1px solid #E8E6E1; text-align: left; }
        th { background: #F8F4EC; font-weight: 700; }
        tr:nth-child(even) td { background: #FAFAF8; }
        @media print { body { padding: 12px; } }
      </style></head><body>
      <h1>PackPerks · ${cfg.label} report</h1>
      <div class="meta">${periodLabel} · ${filtered.length} rows · Generated ${stamp}</div>
      ${tableHtml}
      </body></html>`);
    w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 300);
  }

  return (
    <div className="admin-reports">
      <div className="rep-header">
        <div>
          <h1 className="rep-header__title">Reports</h1>
          <p className="rep-header__sub">Build, preview & export custom data reports.</p>
        </div>
        <div className="rep-header__actions">
          <button className="rep-btn rep-btn--ghost" onClick={handleCopy} disabled={!filtered.length}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
            Copy
          </button>
          <button className="rep-btn rep-btn--ghost" onClick={handlePrint} disabled={!filtered.length}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="6 9 6 2 18 2 18 9"/>
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
              <rect x="6" y="14" width="12" height="8"/>
            </svg>
            Print / PDF
          </button>
          <button className="rep-btn rep-btn--primary" onClick={handleExport} disabled={!filtered.length}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Export {format.toUpperCase()}
          </button>
        </div>
      </div>

      <div className="rep-layout">
        {/* Sidebar / config */}
        <aside className="rep-config">
          <div className="rep-config__section">
            <div className="rep-config__label">Dataset</div>
            <div className="rep-config__datasets">
              {Object.entries(DATASETS).map(([id, d]) => {
                const isPii = PII_DATASETS.has(id);
                const locked = isPii && !canExportPii;
                return (
                  <button key={id}
                    className={`rep-dataset-btn${dataset === id ? ' rep-dataset-btn--active' : ''}${locked ? ' rep-dataset-btn--locked' : ''}`}
                    onClick={() => !locked && setDataset(id)}
                    disabled={locked}
                    title={locked ? 'This dataset contains email. Only Owners and Admins can export it.' : undefined}
                  >
                    <span className="rep-dataset-btn__name">
                      {d.label}
                      {isPii && (
                        <span className="rep-dataset-btn__pii" title="Contains personal data">
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                          </svg>
                          PII
                        </span>
                      )}
                    </span>
                    <span className="rep-dataset-btn__desc">{d.description}</span>
                    {locked && (
                      <span className="rep-dataset-btn__lockmsg">Owner/Admin only</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rep-config__section">
            <div className="rep-config__label-row">
              <span className="rep-config__label">Columns</span>
              <div className="rep-config__quick">
                <button onClick={selectDefaultCols}>default</button>
                <span>·</span>
                <button onClick={selectAllCols}>all</button>
              </div>
            </div>
            <div className="rep-config__cols">
              {cfg.columns.map(c => (
                <label key={c.key} className="rep-col-checkbox">
                  <input type="checkbox"
                    checked={selectedCols.has(c.key)}
                    onChange={() => toggleColumn(c.key)} />
                  <span>{c.label}</span>
                  {c.sum && <span className="rep-col-checkbox__badge">Σ</span>}
                </label>
              ))}
            </div>
          </div>

          <div className="rep-config__section">
            <div className="rep-config__label">Time period</div>
            <div className="rep-config__periods">
              {PERIODS.map(p => (
                <button key={p.id}
                  className={`rep-period-btn${period === p.id ? ' rep-period-btn--active' : ''}`}
                  onClick={() => setPeriod(p.id)}>
                  {p.label}
                </button>
              ))}
            </div>
            {period === 'custom' && (
              <div className="rep-config__custom">
                <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} />
                <span>→</span>
                <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} />
              </div>
            )}
          </div>

          {cfg.statusOptions && (
            <div className="rep-config__section">
              <div className="rep-config__label">Status</div>
              <select className="rep-config__select"
                value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                {cfg.statusOptions.map(s => (
                  <option key={s} value={s}>{s === 'all' ? 'All statuses' : s}</option>
                ))}
              </select>
            </div>
          )}

          <div className="rep-config__section">
            <div className="rep-config__label">Format</div>
            <div className="rep-config__formats">
              {FORMATS.map(f => (
                <button key={f.id}
                  className={`rep-format-btn${format === f.id ? ' rep-format-btn--active' : ''}`}
                  onClick={() => setFormat(f.id)}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </aside>

        {/* Main / preview */}
        <section className="rep-preview">
          <div className="rep-preview__toolbar">
            <input className="rep-preview__search"
              placeholder="Search rows…"
              value={search} onChange={e => setSearch(e.target.value)} />
            <span className="rep-preview__count">
              {loading ? 'Loading…' : `${filtered.length} row${filtered.length !== 1 ? 's' : ''}`}
            </span>
          </div>

          {error && <div className="rep-preview__error">{error}</div>}

          <div className="rep-preview__table-wrap">
            {loading ? (
              <div className="rep-preview__empty">Loading data…</div>
            ) : visibleColumns.length === 0 ? (
              <div className="rep-preview__empty">Select at least one column.</div>
            ) : filtered.length === 0 ? (
              <div className="rep-preview__empty">No rows match the current filters.</div>
            ) : (
              <table className="rep-table">
                <thead>
                  <tr>
                    {visibleColumns.map(c => (
                      <th key={c.key}
                        className="rep-table__th"
                        onClick={() => handleSort(c.key)}>
                        {c.label}
                        <span className="rep-table__sort">
                          {sortKey === c.key ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, 500).map((r, i) => (
                    <tr key={r.id || i}>
                      {visibleColumns.map(c => (
                        <td key={c.key} className={`rep-table__td rep-table__td--${c.type}`}>
                          {formatValue(r[c.key], c.type)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                {Object.keys(aggregates).length > 0 && (
                  <tfoot>
                    <tr>
                      {visibleColumns.map((c, idx) => (
                        <td key={c.key} className="rep-table__tf">
                          {idx === 0 && 'Total'}
                          {aggregates[c.key] !== undefined && (
                            c.type === 'currency'
                              ? `€${aggregates[c.key].toFixed(2)}`
                              : aggregates[c.key].toLocaleString()
                          )}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                )}
              </table>
            )}
            {filtered.length > 500 && (
              <div className="rep-preview__truncated">
                Showing first 500 rows in preview. Export to see all {filtered.length}.
              </div>
            )}
          </div>
        </section>
      </div>

      <QuickLinks currentPage="reports" onNavigate={onNavigate} />
    </div>
  );
}
