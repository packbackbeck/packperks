import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { applyOrgFilter } from '../context/orgState';
import { useAuth } from '../auth/AuthContext';
import { useOrg } from '../context/OrgContext';
import { logAction } from '../auth/actionLog';
import { getWeeklyDigest, saveWeeklyDigest, sendDigestTest, getDigestLog, DIGEST_VENDOR_METRICS, DIGEST_STAFF_METRICS, WEEKLY_DIGEST_DEFAULT, getNotificationCenter, saveNotificationCenter, sendNotificationTest, NOTIFICATION_EVENTS, NOTIFICATION_CENTER_DEFAULT } from '../lib/adminApi';
import QuickLinks from '../shared/QuickLinks';
import './AdminReports.css';
import { adminMoney, useAdminMoney } from '../lib/adminMoney';

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
      { key: 'payout_amount',  label: 'Payout',       type: 'currency', default: true, sum: true },
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
  if (type === 'currency') return adminMoney(Number(val));
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
          ? adminMoney(Number(raw))
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
  const { activeOrgMode } = useOrg();
  const isTikkie = activeOrgMode === 'tikkie_only';
  const role = profile?.role || 'checker';
  const canExportPii = role === 'owner' || role === 'admin';
  // Email configs (digest + notifications) can be set by any admin, managers
  // included — only view-only checkers are locked out.
  const canManageAlerts = role !== 'checker';

  // Redirect Refund orgs have no cup scans, cup balances or rewards —
  // the datasets and columns trim themselves to what that mode records.
  const datasets = useMemo(() => {
    if (!isTikkie) return DATASETS;
    const strip = {
      users: new Set(['cup_balance', 'lifetime_cups']),
      claims: new Set(['reward_id']),
    };
    const out = {};
    for (const [id, d] of Object.entries(DATASETS)) {
      if (id === 'cup_scans') continue;
      out[id] = strip[id]
        ? { ...d, columns: d.columns.filter(c => !strip[id].has(c.key)) }
        : d;
      if (id === 'users') out[id] = { ...out[id], description: 'Refund accounts (email save-for-later).' };
      if (id === 'claims') out[id] = { ...out[id], label: 'Refunds', description: 'Smart-bin Tikkie payouts.' };
    }
    return out;
  }, [isTikkie]);

  const [dataset, setDataset] = useState(canExportPii ? 'users' : 'cup_scans');
  // Snap the selection back onto an existing dataset when the mode
  // removes the current one (e.g. cup_scans in Redirect Refund).
  useEffect(() => {
    if (!datasets[dataset]) setDataset(Object.keys(datasets)[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasets, dataset]);
  const cfg = datasets[dataset] || DATASETS[dataset];

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
          <h1 className="rep-header__title">Reports &amp; alerts</h1>
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
              {Object.entries(datasets).map(([id, d]) => {
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
                              ? adminMoney(aggregates[c.key])
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

      <WeeklyDigest canManage={canManageAlerts} />

      <NotificationCenter canManage={canManageAlerts} />

      <QuickLinks currentPage="reports" onNavigate={onNavigate} />
    </div>
  );
}

/* ── Multi-recipient email input ────────────────────────────────────────
 * A chip list of email addresses with add/remove + a one-tap "Add me". Used by
 * the digest and notification center so admins can send to a whole team. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function EmailList({ emails, onChange, disabled, ownEmail }) {
  const [input, setInput] = useState('');
  const list = Array.isArray(emails) ? emails : [];
  const norm = (e) => e.trim().toLowerCase();
  const add = () => {
    const e = norm(input);
    if (!EMAIL_RE.test(e) || list.includes(e)) { setInput(''); return; }
    onChange([...list, e]); setInput('');
  };
  return (
    <div className="rep-emails">
      <div className="rep-emails__chips">
        {list.length === 0 && <span className="rep-emails__empty">No recipients yet — add at least one.</span>}
        {list.map((e) => (
          <span key={e} className="rep-emails__chip">
            {e}{ownEmail && e === ownEmail && <span className="rep-emails__you">you</span>}
            {!disabled && <button type="button" className="rep-emails__x" onClick={() => onChange(list.filter((x) => x !== e))} aria-label={`Remove ${e}`}>×</button>}
          </span>
        ))}
      </div>
      {!disabled && (
        <div className="rep-emails__add">
          <input type="email" className="rep-auto__input" value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } }}
            placeholder="name@packback.network" />
          <button type="button" className="rep-btn rep-btn--ghost" onClick={add} disabled={!EMAIL_RE.test(norm(input))}>Add</button>
          {ownEmail && !list.includes(ownEmail) && (
            <button type="button" className="rep-emails__self" onClick={() => onChange([...list, ownEmail])}>+ Add me</button>
          )}
        </div>
      )}
    </div>
  );
}

/* Searchable tag picker: chosen metrics as removable chips + a filtered pool
 * of the remaining catalog to tap in. Handles the "huge list" ask. */
function SearchableMetrics({ catalog, selected, onChange, disabled }) {
  const [q, setQ] = useState('');
  const sel = selected || [];
  const query = q.trim().toLowerCase();
  const byId = (id) => catalog.find((m) => m.id === id);
  const toggle = (id) => onChange(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]);
  const pool = catalog.filter((m) => !sel.includes(m.id) &&
    (!query || m.label.toLowerCase().includes(query) || (m.hint || '').toLowerCase().includes(query)));
  return (
    <div className="rep-tags">
      <div className="rep-tags__selected">
        {sel.length === 0 && <span className="rep-emails__empty">No metrics chosen yet.</span>}
        {sel.map((id) => {
          const m = byId(id);
          return (
            <span key={id} className="rep-tags__chip is-on">
              {m ? m.label : id}
              {!disabled && <button type="button" className="rep-emails__x" onClick={() => toggle(id)} aria-label="Remove">×</button>}
            </span>
          );
        })}
      </div>
      {!disabled && (
        <>
          <input
            className="rep-auto__input rep-tags__search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search ${catalog.length} metrics…`}
          />
          <div className="rep-tags__pool">
            {pool.length === 0
              ? <span className="rep-emails__empty">No matches.</span>
              : pool.map((m) => (
                <button key={m.id} type="button" className="rep-tags__chip" title={m.hint} onClick={() => toggle(m.id)}>
                  <span className="rep-tags__plus">+</span>{m.label}
                </button>
              ))}
          </div>
        </>
      )}
    </div>
  );
}

/* Illustrative values for the preview, one per metric id in the catalogs.
 * They are labelled as a sample in the UI and never leave this component —
 * their only job is to show the shape and density of the real email, which
 * a row of "—" placeholders cannot do. */
function previewValues(money) {
  return {
  new_users: '48', active_users: '212', returning_users: '96', repeat_rate: '45%',
  scans_total: '734', cups_period: '1,486', avg_cups_user: '7.0', byo_scans: '318',
  top_location: 'Central', busiest_day: 'Thursday', top_reward: 'Flat white',
  unique_rewards: '6', cups_redeemed: '890', redemption_rate: '60%',
  cashback_paid: money(400.5), avg_cashback: money(2.25), co2_avoided: '107 kg',
  total_users: '412', total_cups_lifetime: '9,340', cups_redeemed_all: '5,120',
  total_cashback: money(2304), approved_claims: '981', failed_claims: '34',
  pending_claims: '7', rejection_rate: '3.4%', ai_pass_rate: '96%',
  avg_ai_confidence: '0.94', pending_merges: '0', merges_period: '2',
  stores_count: '3', active_stores: '3',
  };
}

/* A faithful, scaled-down rendering of the email this digest will send —
 * same shell, same accent, same three-cards-per-row grid as
 * supabase/functions/send-digest. The point is that an admin choosing
 * eleven metrics can see they have made a wall of numbers before the
 * vendor receives one. */
function DigestPreview({ accent, badge, aud, catalog, orgName }) {
  const { money } = useAdminMoney();
  const values = previewValues(money);
  const byId = new Map(catalog.map((m) => [m.id, m]));
  const cells = (aud.metrics || []).map((id) => byId.get(id)).filter(Boolean);
  const period = (aud.frequency || 'weekly') === 'monthly' ? 'Last 30 days' : 'Last 7 days';
  return (
    <aside className="rep-prev" aria-label={`${badge} email preview`}>
      <div className="rep-prev__bar">
        <span className="rep-prev__bar-label">Preview</span>
        <span className="rep-prev__bar-note">Sample figures</span>
      </div>
      <div className="rep-prev__page">
        <div className="rep-prev__brand">🥤 PackPerks</div>
        <div className="rep-prev__card">
          <span className="rep-prev__badge" style={{ background: accent }}>{badge}</span>
          <div className="rep-prev__meta">{orgName} — {period}</div>
          <h3 className="rep-prev__title">{aud.title || 'Untitled digest'}</h3>
          <p className="rep-prev__intro">{aud.intro || ' '}</p>
          {cells.length === 0 ? (
            <p className="rep-prev__empty">Pick at least one metric — an email with no numbers is never sent.</p>
          ) : (
            <div className="rep-prev__grid">
              {cells.map((m) => (
                <div className="rep-prev__tile" key={m.id}>
                  <span className="rep-prev__tile-label" style={{ color: accent }}>{m.label}</span>
                  <span className="rep-prev__tile-val">{values[m.id] || '—'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <p className="rep-prev__foot">
          You are receiving this because a digest is configured in the PackPerks dashboard.
        </p>
      </div>
    </aside>
  );
}

/* One audience's digest config: enable + title/intro + recipients + a searchable
 * metric picker + its own "Send test". */
/* One audience's digest, rendered as its own full `rep-auto rep-digest` block:
 * enable switch + schedule + recipients + a searchable metric picker, with its
 * own Save + Send test. */
function DigestSection({ audKey, accent, accentHex, badge, orgName, heading, sub, catalog, aud, onChange, ownEmail, canManage, onSave, saving, savedAt, onSendTest, testing, err, msg }) {
  const set = (p) => onChange({ ...aud, ...p });
  const metrics = aud.metrics || [];
  const recipients = aud.recipients || [];
  const day = (aud.dayOfWeek || 'monday');
  const cadence = aud.frequency === 'monthly'
    ? 'on the 1st of each month'
    : `every ${day.charAt(0).toUpperCase() + day.slice(1)}`;
  return (
    <section className={`rep-auto rep-digest rep-digest--${accent}`}>
      <div className="rep-auto__head">
        <div>
          <h2 className="rep-auto__title">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 4h16v16H4z"/><path d="m22 6-10 7L2 6"/></svg>
            {heading}
          </h2>
          <p className="rep-auto__sub">{sub} — sent {cadence} as its own email.</p>
        </div>
        <label className="rep-auto__switch">
          <input type="checkbox" checked={!!aud.enabled} disabled={!canManage} onChange={(e) => set({ enabled: e.target.checked })} />
          <span className="rep-auto__switch-track"><span className="rep-auto__switch-thumb" /></span>
          <span className="rep-auto__switch-lbl">{aud.enabled ? 'On' : 'Off'}</span>
        </label>
      </div>

      <div className="rep-digest__split">
      <div className={`rep-digest__body${aud.enabled ? '' : ' rep-auto__grid--muted'}`}>
        <div className="rep-auto__grid">
          <label className="rep-auto__field rep-auto__field--wide">
            <span className="rep-auto__label">Email title</span>
            <input className="rep-auto__input" value={aud.title || ''} disabled={!canManage} onChange={(e) => set({ title: e.target.value })} />
          </label>
          <label className="rep-auto__field rep-auto__field--wide">
            <span className="rep-auto__label">Intro line</span>
            <input className="rep-auto__input" value={aud.intro || ''} disabled={!canManage} onChange={(e) => set({ intro: e.target.value })} />
          </label>
          <label className="rep-auto__field">
            <span className="rep-auto__label">Frequency</span>
            <select className="rep-auto__input" value={aud.frequency || 'weekly'} disabled={!canManage} onChange={(e) => set({ frequency: e.target.value })}>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>
          {(aud.frequency || 'weekly') === 'weekly' && (
            <label className="rep-auto__field">
              <span className="rep-auto__label">Send on</span>
              <select className="rep-auto__input" value={day} disabled={!canManage} onChange={(e) => set({ dayOfWeek: e.target.value })}>
                {['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].map((d) => (
                  <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>
                ))}
              </select>
            </label>
          )}
          <label className="rep-auto__field">
            <span className="rep-auto__label">Scope</span>
            <select className="rep-auto__input" value={aud.scope || 'org'} disabled={!canManage} onChange={(e) => set({ scope: e.target.value })}>
              <option value="org">This store</option>
              <option value="group">Whole group</option>
            </select>
          </label>
          <div className="rep-auto__field rep-auto__field--wide">
            <span className="rep-auto__label">Send to ({recipients.length})</span>
            <EmailList emails={recipients} onChange={(v) => set({ recipients: v })} disabled={!canManage} ownEmail={ownEmail} />
          </div>
        </div>
        <div className="rep-digest__metrics">
          <span className="rep-auto__label">Metrics ({metrics.length}) — search and tap to add</span>
          <SearchableMetrics catalog={catalog} selected={metrics} onChange={(v) => set({ metrics: v })} disabled={!canManage} />
        </div>
      </div>
      <DigestPreview accent={accentHex} badge={badge} aud={aud} catalog={catalog} orgName={orgName} />
      </div>

      <div className="rep-auto__foot">
        <span className="rep-auto__summary">
          {aud.enabled
            ? <>Sends <strong>{metrics.length}</strong> metric{metrics.length === 1 ? '' : 's'} {cadence} to <strong>{recipients.length}</strong> recipient{recipients.length === 1 ? '' : 's'}.</>
            : 'Turn on to schedule this digest.'}
        </span>
        <div className="rep-auto__actions">
          {err && err.which === audKey && <span className="rep-auto__err">{err.text}</span>}
          {msg && msg.which === audKey && <span className="rep-auto__ok">{msg.text}</span>}
          {savedAt && <span className="rep-auto__ok">Saved ✓</span>}
          <button className="rep-btn rep-btn--ghost" onClick={onSendTest} disabled={!canManage || testing || !recipients.length || !metrics.length}>
            {testing ? 'Sending…' : 'Send test'}
          </button>
          <button className="rep-btn rep-btn--primary" onClick={onSave} disabled={!canManage || saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
      {!canManage && <p className="rep-auto__gate">View-only accounts can’t change the digests.</p>}
    </section>
  );
}

/* ── Scheduled digests (vendor + staff) ─────────────────────────────────
 * Two fully independent digests, each its own rep-auto block (own schedule,
 * recipients, metrics) and mailed as a separate letter. */
function WeeklyDigest({ canManage }) {
  const { activeOrgId, activeOrg } = useOrg();
  const activeOrgName = activeOrg?.name || null;
  const { profile } = useAuth();
  const ownEmail = (profile?.email || '').toLowerCase();
  const [cfg, setCfg] = useState(WEEKLY_DIGEST_DEFAULT);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(null);   // 'vendor' | 'staff' | null
  const [savedAt, setSavedAt] = useState(null);
  const [testing, setTesting] = useState(null);
  const [err, setErr] = useState(null);         // { which, text }
  const [msg, setMsg] = useState(null);         // { which, text }

  useEffect(() => {
    let alive = true;
    getWeeklyDigest().then((c) => {
      if (!alive) return;
      const seed = (a) => ((a.recipients && a.recipients.length) || !ownEmail) ? a : { ...a, recipients: [ownEmail] };
      c = { ...c, vendor: seed(c.vendor), staff: seed(c.staff) };
      setCfg(c); setLoaded(true);
    }).catch(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setAud = (key, aud) => setCfg((c) => ({ ...c, [key]: aud }));
  const persist = () => saveWeeklyDigest({ ...cfg, org_id: cfg.org_id || activeOrgId || null });

  const save = async (which) => {
    setSaving(which); setErr(null); setMsg(null);
    try { const v = await persist(); setCfg((c) => ({ ...c, ...v })); setSavedAt(which); setTimeout(() => setSavedAt(null), 2200); }
    catch (e) { setErr({ which, text: e?.message || 'Could not save.' }); }
    finally { setSaving(null); }
  };

  const sendTest = async (which) => {
    const aud = cfg[which] || {};
    if (!aud.recipients?.length || !aud.metrics?.length) { setErr({ which, text: 'Add a recipient and pick metrics first.' }); return; }
    setTesting(which); setErr(null); setMsg(null);
    try {
      await persist();
      const to = ownEmail || aud.recipients[0];
      await sendDigestTest(which, activeOrgId, to);
      setMsg({ which, text: `Test sent to ${to}.` });
      setTimeout(() => setMsg(null), 4000);
    } catch (e) { setErr({ which, text: e?.message || 'Could not send the test email.' }); }
    finally { setTesting(null); }
  };

  // Accents match the sent email exactly (send-digest/index.ts) so the
  // preview is not a different-looking approximation.
  const orgName = activeOrgName || 'Your store';
  const common = { ownEmail, canManage, err, msg, orgName };
  return (
    <div className="rep-digest-wrap">
      <div className="rep-digest-rows">
        <DigestSection
          {...common} audKey="vendor" accent="vendor" accentHex="#C0451F" badge="Vendor digest"
          heading="Vendor digest" sub="For the store owner"
          catalog={DIGEST_VENDOR_METRICS} aud={cfg.vendor || {}} onChange={(a) => setAud('vendor', a)}
          onSave={() => save('vendor')} saving={saving === 'vendor' || !loaded} savedAt={savedAt === 'vendor'}
          onSendTest={() => sendTest('vendor')} testing={testing === 'vendor'}
        />
        <DigestSection
          {...common} audKey="staff" accent="admin" accentHex="#5333A5" badge="Staff digest"
          heading="Staff digest" sub="Everything vendors see + full platform totals"
          catalog={DIGEST_STAFF_METRICS} aud={cfg.staff || {}} onChange={(a) => setAud('staff', a)}
          onSave={() => save('staff')} saving={saving === 'staff' || !loaded} savedAt={savedAt === 'staff'}
          onSendTest={() => sendTest('staff')} testing={testing === 'staff'}
        />
      </div>
      <DigestLogs orgId={activeOrgId} />
    </div>
  );
}

/* Collapsible, inner-scrollable log of recent digest sends (scheduled + tests).
 * Reads the rolling log the send-digest edge fn appends to app_config. */
function DigestLogs({ orgId }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(null);

  useEffect(() => {
    if (!open || rows) return;
    let alive = true;
    getDigestLog().then((r) => { if (alive) setRows(r || []); }).catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [open, rows]);

  const fmt = (iso) => { try { return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return iso; } };

  return (
    <section className="rep-auto rep-digest-logs">
      <button type="button" className="rep-logs__head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <svg className={`rep-logs__chev${open ? ' is-open' : ''}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
        <h2 className="rep-auto__title" style={{ margin: 0 }}>Digest activity log</h2>
        <span className="rep-logs__hint">Recent scheduled sends and tests</span>
      </button>
      {open && (
        <div className="rep-logs__body">
          {rows === null ? (
            <div className="rep-logs__empty">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="rep-logs__empty">No digest has been sent yet. Scheduled sends and “Send test” runs will appear here.</div>
          ) : (
            <ul className="rep-logs__list">
              {rows.map((r, i) => (
                <li key={i} className={`rep-logs__row rep-logs__row--${r.audience || 'vendor'}`}>
                  <span className={`rep-logs__pill rep-logs__pill--${r.status === 'sent' || r.sent ? 'ok' : 'fail'}`}>{r.status === 'sent' || r.sent ? 'Sent' : 'Failed'}</span>
                  <span className="rep-logs__aud">{(r.audience || 'vendor') === 'staff' ? 'Staff' : 'Vendor'} digest</span>
                  <span className="rep-logs__mode">{r.mode === 'test' ? 'Test' : 'Scheduled'}</span>
                  <span className="rep-logs__to">{Array.isArray(r.to) ? r.to.join(', ') : (r.to || '—')}</span>
                  <span className="rep-logs__when">{fmt(r.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/* ── Notification center ────────────────────────────────────────────────
 * Real-time admin email alerts. Pick which activities send an email and to
 * whom. DB triggers fire the notify-event edge fn on matching inserts. */
function NotificationCenter({ canManage }) {
  const { activeOrgId } = useOrg();
  const { profile } = useAuth();
  const ownEmail = (profile?.email || '').toLowerCase();
  const [cfg, setCfg] = useState(NOTIFICATION_CENTER_DEFAULT);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let alive = true;
    getNotificationCenter().then((c) => {
      if (!alive) return;
      if ((!c.recipients || !c.recipients.length) && ownEmail) c = { ...c, recipients: [ownEmail] };
      setCfg(c); setLoaded(true);
    }).catch(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const patch = (p) => setCfg((c) => ({ ...c, ...p }));
  const toggleEvent = (id) => setCfg((c) => {
    const has = c.events.includes(id);
    return { ...c, events: has ? c.events.filter((e) => e !== id) : [...c.events, id] };
  });
  const recipients = cfg.recipients || [];

  const save = async () => {
    if (!recipients.length) { setErr('Add at least one recipient.'); return; }
    setSaving(true); setErr(null);
    try {
      const v = await saveNotificationCenter({ ...cfg, org_id: cfg.org_id || activeOrgId || null });
      setCfg((c) => ({ ...c, ...v }));
      setSavedAt(true); setTimeout(() => setSavedAt(false), 2200);
    } catch (e) { setErr(e?.message || 'Could not save.'); }
    finally { setSaving(false); }
  };

  const sendTest = async () => {
    if (!recipients.length) { setErr('Add a recipient first.'); return; }
    setTesting(true); setErr(null); setMsg(null);
    try {
      const to = ownEmail || recipients[0];
      await sendNotificationTest(to);
      setMsg(`Test alert sent to ${to}.`);
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
          <div className="rep-auto__field rep-auto__field--wide">
            <span className="rep-auto__label">Send alerts to ({recipients.length})</span>
            <EmailList emails={recipients} onChange={(v) => patch({ recipients: v })} disabled={!canManage} ownEmail={ownEmail} />
          </div>
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
            ? <>Emailing <strong>{recipients.length}</strong> recipient{recipients.length === 1 ? '' : 's'} on <strong>{cfg.events.length}</strong> event{cfg.events.length === 1 ? '' : 's'}.</>
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
      {!canManage && <p className="rep-auto__gate">View-only accounts can’t change notifications.</p>}
    </section>
  );
}
