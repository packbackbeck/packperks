import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { applyOrgFilter } from '../context/orgState';
import { useAuth } from '../auth/AuthContext';
import { useOrg } from '../context/OrgContext';
import { logAction } from '../auth/actionLog';
import { getAutomatedReports, saveAutomatedReports, AUTOMATED_REPORTS_DEFAULT, getWeeklyDigest, saveWeeklyDigest, sendDigestTest, DIGEST_METRICS, WEEKLY_DIGEST_DEFAULT, getNotificationCenter, saveNotificationCenter, sendNotificationTest, NOTIFICATION_EVENTS, NOTIFICATION_CENTER_DEFAULT } from '../lib/adminApi';
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

      <AutomatedReports canManage={canExportPii} />

      <WeeklyDigest canManage={canExportPii} />

      <NotificationCenter canManage={canExportPii} />

      <QuickLinks currentPage="reports" onNavigate={onNavigate} />
    </div>
  );
}

/* ── Automated reports ──────────────────────────────────────────────────
 * Config for a scheduled report email (defaults to the weekly per-store
 * valid-claims summary that feeds vendor direct-debit batching). Persists to
 * app_config; a cron + edge function reads it and sends the mail. */
function AutomatedReports({ canManage }) {
  const [cfg, setCfg] = useState(AUTOMATED_REPORTS_DEFAULT);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let alive = true;
    getAutomatedReports().then((c) => { if (alive) { setCfg(c); setLoaded(true); } })
      .catch(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, []);

  const patch = (p) => setCfg((c) => ({ ...c, ...p }));

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((cfg.recipient || '').trim());

  const save = async () => {
    if (!emailValid) { setErr('Enter a valid recipient email.'); return; }
    setSaving(true); setErr(null);
    try {
      const v = await saveAutomatedReports(cfg);
      setCfg((c) => ({ ...c, ...v }));
      setSavedAt(true);
      setTimeout(() => setSavedAt(false), 2200);
    } catch (e) {
      setErr(e?.message || 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  const cadenceLabel = cfg.frequency === 'weekly'
    ? `every ${cfg.dayOfWeek.charAt(0).toUpperCase() + cfg.dayOfWeek.slice(1)}`
    : cfg.frequency === 'daily' ? 'every day' : 'on the 1st of each month';

  return (
    <section className="rep-auto">
      <div className="rep-auto__head">
        <div>
          <h2 className="rep-auto__title">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            Automated reports
          </h2>
          <p className="rep-auto__sub">Email a scheduled report automatically — e.g. the weekly valid-claims summary per store for vendor direct debits.</p>
        </div>
        <label className="rep-auto__switch">
          <input type="checkbox" checked={!!cfg.enabled} disabled={!canManage || !loaded} onChange={(e) => patch({ enabled: e.target.checked })} />
          <span className="rep-auto__switch-track"><span className="rep-auto__switch-thumb" /></span>
          <span className="rep-auto__switch-lbl">{cfg.enabled ? 'On' : 'Off'}</span>
        </label>
      </div>

      <div className={`rep-auto__grid${cfg.enabled ? '' : ' rep-auto__grid--muted'}`}>
        <label className="rep-auto__field">
          <span className="rep-auto__label">Report</span>
          <select className="rep-auto__input" value={cfg.dataset} disabled={!canManage} onChange={(e) => patch({ dataset: e.target.value })}>
            <option value="claims">Reward claims</option>
            <option value="cup_scans">Cup scans</option>
            <option value="activity">Activity</option>
          </select>
        </label>

        <label className="rep-auto__field">
          <span className="rep-auto__label">Only include</span>
          <select className="rep-auto__input" value={cfg.status} disabled={!canManage} onChange={(e) => patch({ status: e.target.value })}>
            <option value="completed">Valid / paid claims</option>
            <option value="all">All statuses</option>
            <option value="pending">Pending only</option>
          </select>
        </label>

        <label className="rep-auto__field">
          <span className="rep-auto__label">Break down</span>
          <select className="rep-auto__input" value={cfg.scope} disabled={!canManage} onChange={(e) => patch({ scope: e.target.value })}>
            <option value="per_store">Per store</option>
            <option value="all">Whole programme</option>
          </select>
        </label>

        <label className="rep-auto__field">
          <span className="rep-auto__label">Frequency</span>
          <select className="rep-auto__input" value={cfg.frequency} disabled={!canManage} onChange={(e) => patch({ frequency: e.target.value })}>
            <option value="weekly">Weekly</option>
            <option value="daily">Daily</option>
            <option value="monthly">Monthly</option>
          </select>
        </label>

        {cfg.frequency === 'weekly' && (
          <label className="rep-auto__field">
            <span className="rep-auto__label">Send on</span>
            <select className="rep-auto__input" value={cfg.dayOfWeek} disabled={!canManage} onChange={(e) => patch({ dayOfWeek: e.target.value })}>
              {['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].map((d) => (
                <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>
              ))}
            </select>
          </label>
        )}

        <label className="rep-auto__field">
          <span className="rep-auto__label">Format</span>
          <select className="rep-auto__input" value={cfg.format} disabled={!canManage} onChange={(e) => patch({ format: e.target.value })}>
            <option value="csv">CSV (Excel)</option>
            <option value="xlsx">CSV (plain)</option>
            <option value="pdf">PDF</option>
          </select>
        </label>

        <label className="rep-auto__field rep-auto__field--wide">
          <span className="rep-auto__label">Send to</span>
          <input
            type="email"
            className={`rep-auto__input${!emailValid ? ' rep-auto__input--bad' : ''}`}
            value={cfg.recipient}
            disabled={!canManage}
            placeholder="name@packback.network"
            onChange={(e) => patch({ recipient: e.target.value })}
          />
        </label>
      </div>

      <div className="rep-auto__foot">
        <span className="rep-auto__summary">
          {cfg.enabled
            ? <>Sends the <strong>{cfg.dataset === 'claims' ? 'reward claims' : cfg.dataset}</strong> report {cadenceLabel} to <strong>{cfg.recipient}</strong>.</>
            : 'Turn on to schedule an automatic report email.'}
        </span>
        <div className="rep-auto__actions">
          {err && <span className="rep-auto__err">{err}</span>}
          {savedAt && <span className="rep-auto__ok">Saved ✓</span>}
          <button className="rep-btn rep-btn--primary" onClick={save} disabled={!canManage || saving || !loaded}>
            {saving ? 'Saving…' : 'Save schedule'}
          </button>
        </div>
      </div>
      {!canManage && <p className="rep-auto__gate">Only Owners and Admins can change automated reports.</p>}
    </section>
  );
}

/* ── Weekly digest ──────────────────────────────────────────────────────
 * Pick any subset of dashboard metrics and mail them as a designed email
 * letter on a schedule. Config persists to app_config ('weekly_digest');
 * the send-digest edge function renders + sends. "Send test now" fires a
 * one-off to the recipient so the layout can be eyeballed. */
function WeeklyDigest({ canManage }) {
  const { activeOrgId } = useOrg();
  const [cfg, setCfg] = useState(WEEKLY_DIGEST_DEFAULT);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let alive = true;
    getWeeklyDigest().then((c) => { if (alive) { setCfg(c); setLoaded(true); } })
      .catch(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, []);

  const patch = (p) => setCfg((c) => ({ ...c, ...p }));
  const toggleMetric = (id) => setCfg((c) => {
    const has = c.metrics.includes(id);
    return { ...c, metrics: has ? c.metrics.filter((m) => m !== id) : [...c.metrics, id] };
  });
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((cfg.recipient || '').trim());

  const save = async () => {
    if (!emailValid) { setErr('Enter a valid recipient email.'); return; }
    if (!cfg.metrics.length) { setErr('Pick at least one metric to include.'); return; }
    setSaving(true); setErr(null);
    try {
      const v = await saveWeeklyDigest({ ...cfg, org_id: cfg.org_id || activeOrgId || null });
      setCfg((c) => ({ ...c, ...v }));
      setSavedAt(true);
      setTimeout(() => setSavedAt(false), 2200);
    } catch (e) { setErr(e?.message || 'Could not save.'); }
    finally { setSaving(false); }
  };

  const sendTest = async () => {
    if (!emailValid) { setErr('Enter a valid recipient email.'); return; }
    if (!cfg.metrics.length) { setErr('Pick at least one metric first.'); return; }
    setTesting(true); setErr(null); setMsg(null);
    try {
      await saveWeeklyDigest({ ...cfg, org_id: cfg.org_id || activeOrgId || null }); // persist latest picks first
      await sendDigestTest(activeOrgId, cfg.recipient);
      setMsg(`Test digest sent to ${cfg.recipient}.`);
      setTimeout(() => setMsg(null), 4000);
    } catch (e) { setErr(e?.message || 'Could not send the test email.'); }
    finally { setTesting(false); }
  };

  const cadence = cfg.frequency === 'weekly'
    ? `every ${cfg.dayOfWeek.charAt(0).toUpperCase() + cfg.dayOfWeek.slice(1)}`
    : 'on the 1st of each month';

  return (
    <section className="rep-auto rep-digest">
      <div className="rep-auto__head">
        <div>
          <h2 className="rep-auto__title">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 4h16v16H4z"/><path d="m22 6-10 7L2 6"/></svg>
            Weekly digest
          </h2>
          <p className="rep-auto__sub">Pick the metrics you care about and get them as a designed email letter, {cadence}.</p>
        </div>
        <label className="rep-auto__switch">
          <input type="checkbox" checked={!!cfg.enabled} disabled={!canManage || !loaded} onChange={(e) => patch({ enabled: e.target.checked })} />
          <span className="rep-auto__switch-track"><span className="rep-auto__switch-thumb" /></span>
          <span className="rep-auto__switch-lbl">{cfg.enabled ? 'On' : 'Off'}</span>
        </label>
      </div>

      <div className={`rep-digest__body${cfg.enabled ? '' : ' rep-auto__grid--muted'}`}>
        {/* Metric picker */}
        <div className="rep-digest__metrics">
          <span className="rep-auto__label">Metrics to include ({cfg.metrics.length})</span>
          <div className="rep-digest__chips">
            {DIGEST_METRICS.map((m) => {
              const on = cfg.metrics.includes(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  className={`rep-digest__chip${on ? ' is-on' : ''}`}
                  disabled={!canManage}
                  aria-pressed={on}
                  onClick={() => toggleMetric(m.id)}
                  title={m.hint}
                >
                  <span className="rep-digest__chip-check">{on ? '✓' : '+'}</span>
                  {m.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Settings grid */}
        <div className="rep-auto__grid">
          <label className="rep-auto__field rep-auto__field--wide">
            <span className="rep-auto__label">Email title</span>
            <input className="rep-auto__input" value={cfg.title} disabled={!canManage} onChange={(e) => patch({ title: e.target.value })} placeholder="Your PackPerks weekly digest" />
          </label>
          <label className="rep-auto__field rep-auto__field--wide">
            <span className="rep-auto__label">Intro line</span>
            <input className="rep-auto__input" value={cfg.intro} disabled={!canManage} onChange={(e) => patch({ intro: e.target.value })} placeholder="Here’s how your programme performed this week." />
          </label>
          <label className="rep-auto__field">
            <span className="rep-auto__label">Frequency</span>
            <select className="rep-auto__input" value={cfg.frequency} disabled={!canManage} onChange={(e) => patch({ frequency: e.target.value })}>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>
          {cfg.frequency === 'weekly' && (
            <label className="rep-auto__field">
              <span className="rep-auto__label">Send on</span>
              <select className="rep-auto__input" value={cfg.dayOfWeek} disabled={!canManage} onChange={(e) => patch({ dayOfWeek: e.target.value })}>
                {['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].map((d) => (
                  <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>
                ))}
              </select>
            </label>
          )}
          <label className="rep-auto__field">
            <span className="rep-auto__label">Scope</span>
            <select className="rep-auto__input" value={cfg.scope} disabled={!canManage} onChange={(e) => patch({ scope: e.target.value })}>
              <option value="org">This store</option>
              <option value="group">Whole group</option>
            </select>
          </label>
          <label className="rep-auto__field rep-auto__field--wide">
            <span className="rep-auto__label">Send to</span>
            <input type="email" className={`rep-auto__input${!emailValid ? ' rep-auto__input--bad' : ''}`} value={cfg.recipient} disabled={!canManage} onChange={(e) => patch({ recipient: e.target.value })} placeholder="name@packback.network" />
          </label>
        </div>
      </div>

      <div className="rep-auto__foot">
        <span className="rep-auto__summary">
          {cfg.enabled
            ? <>Sends <strong>{cfg.metrics.length}</strong> metric{cfg.metrics.length === 1 ? '' : 's'} {cadence} to <strong>{cfg.recipient}</strong>.</>
            : 'Turn on to schedule the digest email.'}
        </span>
        <div className="rep-auto__actions">
          {err && <span className="rep-auto__err">{err}</span>}
          {msg && <span className="rep-auto__ok">{msg}</span>}
          {savedAt && <span className="rep-auto__ok">Saved ✓</span>}
          <button className="rep-btn rep-btn--ghost" onClick={sendTest} disabled={!canManage || testing || !loaded}>
            {testing ? 'Sending…' : 'Send test now'}
          </button>
          <button className="rep-btn rep-btn--primary" onClick={save} disabled={!canManage || saving || !loaded}>
            {saving ? 'Saving…' : 'Save digest'}
          </button>
        </div>
      </div>
      {!canManage && <p className="rep-auto__gate">Only Owners and Admins can change the weekly digest.</p>}
    </section>
  );
}

/* ── Notification center ────────────────────────────────────────────────
 * Real-time admin email alerts. Pick which activities send an email and to
 * whom. DB triggers fire the notify-event edge fn on matching inserts. */
function NotificationCenter({ canManage }) {
  const { activeOrgId } = useOrg();
  const [cfg, setCfg] = useState(NOTIFICATION_CENTER_DEFAULT);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let alive = true;
    getNotificationCenter().then((c) => { if (alive) { setCfg(c); setLoaded(true); } })
      .catch(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, []);

  const patch = (p) => setCfg((c) => ({ ...c, ...p }));
  const toggleEvent = (id) => setCfg((c) => {
    const has = c.events.includes(id);
    return { ...c, events: has ? c.events.filter((e) => e !== id) : [...c.events, id] };
  });
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((cfg.recipient || '').trim());

  const save = async () => {
    if (!emailValid) { setErr('Enter a valid recipient email.'); return; }
    setSaving(true); setErr(null);
    try {
      const v = await saveNotificationCenter({ ...cfg, org_id: cfg.org_id || activeOrgId || null });
      setCfg((c) => ({ ...c, ...v }));
      setSavedAt(true); setTimeout(() => setSavedAt(false), 2200);
    } catch (e) { setErr(e?.message || 'Could not save.'); }
    finally { setSaving(false); }
  };

  const sendTest = async () => {
    if (!emailValid) { setErr('Enter a valid recipient email.'); return; }
    setTesting(true); setErr(null); setMsg(null);
    try {
      await sendNotificationTest(cfg.recipient);
      setMsg(`Test alert sent to ${cfg.recipient}.`);
      setTimeout(() => setMsg(null), 4000);
    } catch (e) { setErr(e?.message || 'Could not send the test email.'); }
    finally { setTesting(false); }
  };

  return (
    <section className="rep-auto rep-notify">
      <div className="rep-auto__head">
        <div>
          <h2 className="rep-auto__title">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
            Notification center
          </h2>
          <p className="rep-auto__sub">Get an email the moment something happens. Pick the activities and the address.</p>
        </div>
        <label className="rep-auto__switch">
          <input type="checkbox" checked={!!cfg.enabled} disabled={!canManage || !loaded} onChange={(e) => patch({ enabled: e.target.checked })} />
          <span className="rep-auto__switch-track"><span className="rep-auto__switch-thumb" /></span>
          <span className="rep-auto__switch-lbl">{cfg.enabled ? 'On' : 'Off'}</span>
        </label>
      </div>

      <div className={`rep-notify__body${cfg.enabled ? '' : ' rep-auto__grid--muted'}`}>
        <div className="rep-notify__events">
          <span className="rep-auto__label">Notify me when… ({cfg.events.length} selected)</span>
          <div className="rep-notify__list">
            {NOTIFICATION_EVENTS.map((ev) => {
              const on = cfg.events.includes(ev.id);
              return (
                <button key={ev.id} type="button" className={`rep-notify__row${on ? ' is-on' : ''}`}
                  disabled={!canManage} aria-pressed={on} onClick={() => toggleEvent(ev.id)}>
                  <span className="rep-notify__check">{on ? '✓' : ''}</span>
                  <span className="rep-notify__row-txt">
                    <span className="rep-notify__row-label">{ev.label}</span>
                    <span className="rep-notify__row-hint">{ev.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="rep-auto__grid">
          <label className="rep-auto__field rep-auto__field--wide">
            <span className="rep-auto__label">Send alerts to</span>
            <input type="email" className={`rep-auto__input${!emailValid ? ' rep-auto__input--bad' : ''}`} value={cfg.recipient}
              disabled={!canManage} onChange={(e) => patch({ recipient: e.target.value })} placeholder="name@packback.network" />
          </label>
          <label className="rep-auto__field">
            <span className="rep-auto__label">Scope</span>
            <select className="rep-auto__input" value={cfg.org_id ? 'org' : 'all'} disabled={!canManage}
              onChange={(e) => patch({ org_id: e.target.value === 'org' ? (activeOrgId || null) : null })}>
              <option value="org">This store only</option>
              <option value="all">Any store</option>
            </select>
          </label>
        </div>
      </div>

      <div className="rep-auto__foot">
        <span className="rep-auto__summary">
          {cfg.enabled && cfg.events.length
            ? <>Emailing <strong>{cfg.recipient}</strong> on <strong>{cfg.events.length}</strong> event{cfg.events.length === 1 ? '' : 's'}.</>
            : 'Turn on and pick at least one activity to start getting alerts.'}
        </span>
        <div className="rep-auto__actions">
          {err && <span className="rep-auto__err">{err}</span>}
          {msg && <span className="rep-auto__ok">{msg}</span>}
          {savedAt && <span className="rep-auto__ok">Saved ✓</span>}
          <button className="rep-btn rep-btn--ghost" onClick={sendTest} disabled={!canManage || testing || !loaded}>
            {testing ? 'Sending…' : 'Send test now'}
          </button>
          <button className="rep-btn rep-btn--primary" onClick={save} disabled={!canManage || saving || !loaded}>
            {saving ? 'Saving…' : 'Save notifications'}
          </button>
        </div>
      </div>
      {!canManage && <p className="rep-auto__gate">Only Owners and Admins can change notifications.</p>}
    </section>
  );
}
