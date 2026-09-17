import { useState, useEffect, useId, useMemo } from 'react';
import {
  Activity, ArrowDown, ArrowUp, ArrowUpDown, Bell, Check, ChevronRight, CircleAlert, Columns3, Copy,
  Download, Eye, FileText, HandCoins, Inbox, LoaderCircle, Lock, Mail, Plus, Printer, Save, ScanLine,
  Search, SearchX, Send, Table2, Users, X,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { applyOrgFilter } from '../context/orgState';
import { useAuth } from '../auth/AuthContext';
import { useOrg } from '../context/OrgContext';
import { useViewRole } from '../context/ViewRole';
import { logAction } from '../auth/actionLog';
import { getWeeklyDigest, saveWeeklyDigest, sendDigestTest, getDigestLog, DIGEST_VENDOR_METRICS, DIGEST_STAFF_METRICS, WEEKLY_DIGEST_DEFAULT, getNotificationCenter, saveNotificationCenter, sendNotificationTest, NOTIFICATION_EVENTS, NOTIFICATION_CENTER_DEFAULT } from '../lib/adminApi';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, PageHeader, Switch, ToggleChip } from '../ui';
import './AdminReports.css';
import { adminMoney, useAdminMoney } from '../lib/adminMoney';

/* ── Dataset definitions ── */
const DATASETS = {
  users: {
    label: 'Users',
    description: 'Every customer account, with its cup balance.',
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
    description: 'Cashback and direct refund claims.',
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
    description: 'Every cup scan: QR codes and receipt photos.',
    columns: [
      { key: 'id',           label: 'Scan ID',     type: 'text' },
      { key: 'user_name',    label: 'User',        type: 'text',   default: true },
      { key: 'user_email',   label: 'Email',       type: 'text' },
      { key: 'source',       label: 'Source',      type: 'text' },
      { key: 'cups_awarded', label: 'Cups',        type: 'number', default: true, sum: true },
      { key: 'status',       label: 'Status',      type: 'text',   default: true },
      { key: 'created_at',   label: 'Scanned',     type: 'date',   default: true },
    ],
    statusOptions: ['all', 'success', 'failed', 'pending', 'approved', 'rejected'],
  },
  activity: {
    label: 'Activity',
    description: 'Everything customers did: cups added, rewards claimed, cups donated.',
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
  { id: 'xlsx-csv', label: 'Excel (.csv)', short: 'Excel', ext: 'csv',  mime: 'text/csv', hint: 'Opens as a spreadsheet in Excel, with European decimal commas' },
  { id: 'csv',      label: 'CSV (plain)',  short: 'CSV',   ext: 'csv',  mime: 'text/csv', hint: 'Comma-separated, for other tools' },
  { id: 'json',     label: 'JSON',         short: 'JSON',  ext: 'json', mime: 'application/json', hint: 'For developers and scripts' },
  { id: 'pdf',      label: 'PDF',          short: 'PDF',   ext: 'pdf',  mime: 'application/pdf', hint: 'A printable table' },
];

const SCAN_SOURCE = { qr: 'Cup QR', byo_qr: 'Counter QR' };

const DATASET_ICON = { users: Users, claims: HandCoins, cup_scans: ScanLine, activity: Activity };
const isNumeric = (c) => c.type === 'number' || c.type === 'currency';

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
  doc.setFillColor(91, 63, 214); // dashboard violet (--ui-primary)
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
  doc.setTextColor(59, 54, 71);
  doc.setFillColor(242, 241, 247); // --ui-soft
  doc.rect(margin, y - 12, usableW, rowH, 'F');
  columns.forEach((c, i) => doc.text(String(c.label).slice(0, 28), margin + 6 + i * colW, y, { maxWidth: colW - 8 }));
  y += rowH;

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(23, 21, 31);
  rows.forEach((r, idx) => {
    if (y > pageH - 40) { doc.addPage(); y = 40; }
    if (idx % 2 === 0) {
      doc.setFillColor(248, 247, 251);
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
  doc.setTextColor(143, 139, 156);
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
      ? 'id, user_id, source, cups_awarded, status, created_at:scanned_at'
      : 'id, user_id, type, label, created_at';
    // cup_scans has no created_at; its time is scanned_at (aliased above).
    const timeCol = dataset === 'cup_scans' ? 'scanned_at' : 'created_at';
    let q = applyOrgFilter(supabase.from(table).select(cols).order(timeCol, { ascending: false }));
    if (fromIso) q = q.gte(timeCol, fromIso);
    if (toIso)   q = q.lte(timeCol, toIso);
    const { data } = await q;
    const rows = dataset === 'cup_scans'
      ? (data || []).map(r => ({ ...r, source: SCAN_SOURCE[r.source] || r.source || 'Receipt photo' }))
      : data || [];
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
export default function AdminReports() {
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
  // A role that can only view Reports can't change them either.
  const { access } = useViewRole();
  const canManageAlerts = role !== 'checker' && role !== 'vendor' && (!access || access.canEdit('reports'));

  // Deferred Tikkie orgs have no cup scans, cup balances or rewards —
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
      if (id === 'users') out[id] = { ...out[id], description: 'Customers who saved their refund balance with an email.' };
      if (id === 'claims') out[id] = { ...out[id], label: 'Refunds', description: 'Tikkie payouts from smart-bin receipts.' };
    }
    return out;
  }, [isTikkie]);

  const [dataset, setDataset] = useState(canExportPii ? 'users' : 'cup_scans');
  // Snap the selection back onto an existing dataset when the mode
  // removes the current one (e.g. cup_scans in Deferred Tikkie).
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
  const [copyNote, setCopyNote] = useState(null); // { ok, text }

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
      alert("Your role can't export reports that include email addresses. Ask a PackBack master for help.");
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

  function flashCopyNote(note) {
    setCopyNote(note);
    setTimeout(() => setCopyNote(n => (n === note ? null : n)), 3500);
  }

  function handleCopy() {
    const content = buildExport(filtered, visibleColumns, format);
    // PDF has no text form; the copy is the CSV it would be built from.
    const as = format === 'json' ? 'JSON' : format === 'xlsx-csv' ? 'Excel CSV' : 'CSV';
    const done = navigator.clipboard?.writeText(content);
    if (!done) { flashCopyNote({ ok: false, text: 'This browser can’t copy to the clipboard.' }); return; }
    done.then(
      () => flashCopyNote({ ok: true, text: `Copied ${filtered.length.toLocaleString()} rows as ${as}` }),
      () => flashCopyNote({ ok: false, text: 'Couldn’t copy. Try again.' })
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
        body { font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif; padding: 24px; color: #17151F; }
        h1 { font-size: 18px; margin: 0 0 4px; }
        .meta { color: #676374; font-size: 12px; margin-bottom: 16px; }
        table { width: 100%; border-collapse: collapse; font-size: 11px; }
        th, td { padding: 6px 8px; border-bottom: 1px solid #E7E5EE; text-align: left; }
        th { background: #F2F1F7; font-weight: 700; color: #3B3647; }
        tr:nth-child(even) td { background: #FAFAFC; }
        @media print { body { padding: 12px; } }
      </style></head><body>
      <h1>PackPerks · ${cfg.label} report</h1>
      <div class="meta">${periodLabel} · ${filtered.length} rows · Generated ${stamp}</div>
      ${tableHtml}
      </body></html>`);
    w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 300);
  }

  const fmt = FORMATS.find(f => f.id === format) || FORMATS[1];
  const periodLabel = PERIODS.find(p => p.id === period)?.label || '';
  const rowCount = loading ? 'Loading…' : `${filtered.length.toLocaleString()} row${filtered.length !== 1 ? 's' : ''}`;
  const hasTotals = Object.keys(aggregates).length > 0;

  return (
    <div className="ui-page rep-page">
      <PageHeader
        title="Reports & alerts"
        subtitle="Build a report, check it in the preview, then export it. Further down: the digest emails and instant alerts."
      >
        <Button icon={Copy} onClick={handleCopy} disabled={!filtered.length}>Copy</Button>
        <Button icon={Printer} onClick={handlePrint} disabled={!filtered.length}>Print</Button>
        <Button variant="primary" icon={Download} onClick={handleExport} disabled={!filtered.length}>
          Export {fmt.short}
        </Button>
      </PageHeader>

      <div className="rep-builder">
        {/* Report settings */}
        <Card as="aside" className="rep-config" aria-label="Report settings">
          <div className="rep-config__section">
            <h2 className="rep-label">Data</h2>
            <div className="rep-datasets" role="radiogroup" aria-label="Data to report on">
              {Object.entries(datasets).map(([id, d]) => {
                const isPii = PII_DATASETS.has(id);
                const locked = isPii && !canExportPii;
                const on = dataset === id;
                const Icon = DATASET_ICON[id] || FileText;
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    className={`rep-dataset${on ? ' rep-dataset--on' : ''}`}
                    onClick={() => !locked && setDataset(id)}
                    disabled={locked}
                    title={locked ? 'This data includes email addresses. Only masters can export it.' : undefined}
                  >
                    <span className="rep-dataset__icon" aria-hidden="true"><Icon size={16} /></span>
                    <span className="rep-dataset__text">
                      <span className="rep-dataset__name">
                        {d.label}
                        {isPii && (
                          <Badge tone={on ? 'primary' : 'neutral'} icon={Lock} title="Includes customer email addresses">
                            Personal data
                          </Badge>
                        )}
                      </span>
                      <span className="rep-dataset__desc">{d.description}</span>
                      {locked && <span className="rep-dataset__lock">Only masters can export this</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rep-config__section">
            <div className="rep-config__row">
              <h2 className="rep-label">
                Columns <span className="rep-label__count">{visibleColumns.length} of {cfg.columns.length}</span>
              </h2>
              <div className="rep-quick">
                <button type="button" className="rep-link" onClick={selectDefaultCols}>Default</button>
                <button type="button" className="rep-link" onClick={selectAllCols}>All</button>
              </div>
            </div>
            <div className="rep-cols">
              {cfg.columns.map(c => (
                <label key={c.key} className="rep-col">
                  <input
                    type="checkbox"
                    checked={selectedCols.has(c.key)}
                    onChange={() => toggleColumn(c.key)}
                  />
                  <span className="rep-col__name">{c.label}</span>
                  {c.sum && <span className="rep-col__sum" title="Added up in the Total row">Σ</span>}
                </label>
              ))}
            </div>
          </div>

          <div className="rep-config__section">
            <h2 className="rep-label">Time period</h2>
            <div className="rep-chips" role="group" aria-label="Time period">
              {PERIODS.map(p => (
                <ToggleChip key={p.id} pressed={period === p.id} onClick={() => setPeriod(p.id)}>
                  {p.label}
                </ToggleChip>
              ))}
            </div>
            {period === 'custom' && (
              <div className="rep-range">
                <label className="rep-range__label" htmlFor="rep-from">From</label>
                <input id="rep-from" type="date" className="ui-input" value={customFrom} onChange={e => setCustomFrom(e.target.value)} />
                <label className="rep-range__label" htmlFor="rep-to">To</label>
                <input id="rep-to" type="date" className="ui-input" value={customTo} onChange={e => setCustomTo(e.target.value)} />
              </div>
            )}
          </div>

          {cfg.statusOptions && (
            <div className="rep-config__section">
              <label className="rep-label" htmlFor="rep-status">Status</label>
              <select
                id="rep-status"
                className="ui-select"
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
              >
                {cfg.statusOptions.map(s => (
                  <option key={s} value={s}>{s === 'all' ? 'All statuses' : s.charAt(0).toUpperCase() + s.slice(1)}</option>
                ))}
              </select>
            </div>
          )}

          <div className="rep-config__section">
            <h2 className="rep-label">File format</h2>
            <div className="rep-chips" role="group" aria-label="File format">
              {FORMATS.map(f => (
                <ToggleChip key={f.id} pressed={format === f.id} onClick={() => setFormat(f.id)} title={f.hint}>
                  {f.label}
                </ToggleChip>
              ))}
            </div>
          </div>
        </Card>

        {/* Preview */}
        <Card className="rep-preview">
          <CardHeader
            title={cfg.label}
            icon={Table2}
            subtitle={`${periodLabel}${cfg.statusOptions && statusFilter !== 'all' ? ` · ${statusFilter}` : ''} · ${rowCount}`}
            ruled
            actions={(
              <>
                {copyNote && (
                  <span className={`rep-status rep-status--${copyNote.ok ? 'ok' : 'err'}`} role="status">
                    {copyNote.ok ? <Check size={13} aria-hidden="true" /> : <CircleAlert size={13} aria-hidden="true" />}
                    {copyNote.text}
                  </span>
                )}
                <span className="rep-search">
                  <Search size={14} aria-hidden="true" />
                  <input
                    className="rep-search__input"
                    placeholder="Search rows"
                    aria-label="Search rows"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                  {search && (
                    <button type="button" className="rep-search__clear" aria-label="Clear search" onClick={() => setSearch('')}>
                      <X size={13} />
                    </button>
                  )}
                </span>
              </>
            )}
          />

          {error && (
            <p className="rep-error" role="alert"><CircleAlert size={14} aria-hidden="true" />{error}</p>
          )}

          <div className="rep-table-wrap">
            {loading ? (
              <div className="rep-loading">
                <EmptyState icon={LoaderCircle} title="Loading data…" />
              </div>
            ) : visibleColumns.length === 0 ? (
              <EmptyState icon={Columns3} title="No columns chosen">Pick at least one column on the left.</EmptyState>
            ) : filtered.length === 0 ? (
              <EmptyState icon={SearchX} title="No rows match">
                Try a longer time period, another status or a different search.
              </EmptyState>
            ) : (
              <table className="ui-table rep-table">
                <thead>
                  <tr>
                    {visibleColumns.map(c => {
                      const sorted = sortKey === c.key;
                      const SortIcon = sorted ? (sortDir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
                      return (
                        <th
                          key={c.key}
                          className={isNumeric(c) ? 'ui-num' : undefined}
                          aria-sort={sorted ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                        >
                          <button
                            type="button"
                            className={`rep-sort${sorted ? ' rep-sort--on' : ''}`}
                            onClick={() => handleSort(c.key)}
                          >
                            {c.label}
                            <SortIcon size={12} aria-hidden="true" />
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, 500).map((r, i) => (
                    <tr key={r.id || i}>
                      {visibleColumns.map(c => (
                        <td key={c.key} className={`rep-td${isNumeric(c) ? ' ui-num' : ''}`}>
                          {formatValue(r[c.key], c.type)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                {hasTotals && (
                  <tfoot>
                    <tr>
                      {visibleColumns.map((c, idx) => (
                        <td key={c.key} className={`rep-total${isNumeric(c) ? ' ui-num' : ''}`}>
                          {idx === 0 && <span className="rep-total__label">Total</span>}
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
          </div>
          {!loading && filtered.length > 500 && (
            <p className="rep-truncated">
              The preview shows the first 500 rows. Export to get all {filtered.length.toLocaleString()}.
            </p>
          )}
        </Card>
      </div>

      <h2 className="ui-section-label">Digest emails</h2>
      <WeeklyDigest canManage={canManageAlerts} />

      <h2 className="ui-section-label">Instant alerts</h2>
      <NotificationCenter canManage={canManageAlerts} />
    </div>
  );
}

/* ── Multi-recipient email input ────────────────────────────────────────
 * A chip list of email addresses with add/remove + a one-tap "Add me". Used by
 * the digest and notification center so admins can send to a whole team. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function EmailList({ emails, onChange, disabled, ownEmail, inputId }) {
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
      <div className="rep-pills">
        {list.length === 0 && <span className="rep-empty-note">No recipients yet. Add at least one.</span>}
        {list.map((e) => (
          <span key={e} className="rep-pill">
            <span className="rep-pill__text">{e}</span>
            {ownEmail && e === ownEmail && <span className="rep-pill__you">You</span>}
            {!disabled && (
              <button type="button" className="rep-pill__x" onClick={() => onChange(list.filter((x) => x !== e))} aria-label={`Remove ${e}`}>
                <X size={12} aria-hidden="true" />
              </button>
            )}
          </span>
        ))}
      </div>
      {!disabled && (
        <div className="rep-emails__add">
          <input
            id={inputId}
            type="email"
            className="ui-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } }}
            placeholder="name@packback.network"
          />
          <Button icon={Plus} onClick={add} disabled={!EMAIL_RE.test(norm(input))}>Add</Button>
          {ownEmail && !list.includes(ownEmail) && (
            <Button variant="ghost" onClick={() => onChange([...list, ownEmail])}>Add me</Button>
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
      <div className="rep-pills">
        {sel.length === 0 && <span className="rep-empty-note">No metrics chosen yet.</span>}
        {sel.map((id) => {
          const m = byId(id);
          const label = m ? m.label : id;
          return (
            <span key={id} className="rep-pill rep-pill--on" title={m?.hint}>
              <span className="rep-pill__text">{label}</span>
              {!disabled && (
                <button type="button" className="rep-pill__x" onClick={() => toggle(id)} aria-label={`Remove ${label}`}>
                  <X size={12} aria-hidden="true" />
                </button>
              )}
            </span>
          );
        })}
      </div>
      {!disabled && (
        <div className="rep-pool">
          <span className="rep-search rep-search--block">
            <Search size={14} aria-hidden="true" />
            <input
              className="rep-search__input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Search ${catalog.length} metrics`}
              aria-label="Search metrics"
            />
            {q && (
              <button type="button" className="rep-search__clear" aria-label="Clear search" onClick={() => setQ('')}>
                <X size={13} />
              </button>
            )}
          </span>
          <div className="rep-pool__list">
            {pool.length === 0
              ? <span className="rep-empty-note">{sel.length === catalog.length ? 'Every metric is already in the email.' : 'No metrics match.'}</span>
              : pool.map((m) => (
                <button key={m.id} type="button" className="rep-add-chip" title={m.hint} onClick={() => toggle(m.id)}>
                  <Plus size={12} aria-hidden="true" />{m.label}
                </button>
              ))}
          </div>
        </div>
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
 * vendor receives one. The frame is the dashboard's; the page inside it
 * keeps the email's own colours (see .rep-mail in the CSS). */
function DigestPreview({ accent, badge, aud, catalog, orgName }) {
  const { money } = useAdminMoney();
  const values = previewValues(money);
  const byId = new Map(catalog.map((m) => [m.id, m]));
  const cells = (aud.metrics || []).map((id) => byId.get(id)).filter(Boolean);
  const period = (aud.frequency || 'weekly') === 'monthly' ? 'Last 30 days' : 'Last 7 days';
  return (
    <aside className="rep-mail" aria-label={`${badge} email preview`}>
      <div className="rep-mail__bar">
        <span className="rep-mail__bar-label"><Eye size={13} aria-hidden="true" />Email preview</span>
        <Badge tone="neutral">Sample figures</Badge>
      </div>
      <div className="rep-mail__page">
        <div className="rep-mail__brand">🥤 PackPerks</div>
        <div className="rep-mail__card">
          <span className="rep-mail__badge" style={{ background: accent }}>{badge}</span>
          <div className="rep-mail__meta">{orgName} — {period}</div>
          <h3 className="rep-mail__title">{aud.title || 'Untitled digest'}</h3>
          <p className="rep-mail__intro">{aud.intro || ' '}</p>
          {cells.length === 0 ? (
            <p className="rep-mail__empty">Pick at least one metric. An email with no numbers is never sent.</p>
          ) : (
            <div className="rep-mail__grid">
              {cells.map((m) => (
                <div className="rep-mail__tile" key={m.id}>
                  <span className="rep-mail__tile-label" style={{ color: accent }}>{m.label}</span>
                  <span className="rep-mail__tile-val">{values[m.id] || '—'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <p className="rep-mail__foot">
          You are receiving this because a digest is configured in the PackPerks dashboard.
        </p>
      </div>
    </aside>
  );
}

/* On/off switch for a card header, with its state spelled out. */
function OnOff({ checked, onChange, disabled, label }) {
  return (
    <span className="rep-onoff">
      <span className={`rep-onoff__state${checked ? ' rep-onoff__state--on' : ''}`}>{checked ? 'On' : 'Off'}</span>
      <Switch checked={checked} onChange={onChange} disabled={disabled} label={label} />
    </span>
  );
}

/* Save / test feedback shown next to a card's buttons. */
function StatusNote({ tone, children }) {
  return (
    <span className={`rep-status rep-status--${tone}`} role={tone === 'err' ? 'alert' : 'status'}>
      {tone === 'err' ? <CircleAlert size={13} aria-hidden="true" /> : <Check size={13} aria-hidden="true" />}
      {children}
    </span>
  );
}

/* One audience's digest, as its own card: on/off switch, schedule,
 * recipients and a searchable metric picker beside a preview of the email,
 * with its own Save and Send test. */
function DigestSection({ audKey, accent, accentHex, badge, orgName, heading, sub, catalog, aud, onChange, ownEmail, canManage, onSave, saving, savedAt, onSendTest, testing, err, msg }) {
  const uid = useId();
  const set = (p) => onChange({ ...aud, ...p });
  const metrics = aud.metrics || [];
  const recipients = aud.recipients || [];
  const day = (aud.dayOfWeek || 'monday');
  const cadence = aud.frequency === 'monthly'
    ? 'on the 1st of each month'
    : `every ${day.charAt(0).toUpperCase() + day.slice(1)}`;
  return (
    <Card className={`rep-digest rep-digest--${accent}`}>
      <CardHeader
        title={heading}
        icon={Mail}
        subtitle={`${sub}. Sent ${cadence} as its own email.`}
        ruled
        actions={(
          <OnOff
            checked={!!aud.enabled}
            disabled={!canManage}
            label={`Send the ${heading.toLowerCase()}`}
            onChange={(v) => set({ enabled: v })}
          />
        )}
      />
      <CardBody>
        <div className="rep-digest__split">
          <div className={`rep-form${aud.enabled ? '' : ' rep-form--off'}`}>
            <div className="rep-fields">
              <div className="rep-fields__wide">
                <Field label="Email title" htmlFor={`${uid}-title`}>
                  <input id={`${uid}-title`} className="ui-input" value={aud.title || ''} disabled={!canManage} onChange={(e) => set({ title: e.target.value })} />
                </Field>
              </div>
              <div className="rep-fields__wide">
                <Field label="Intro line" htmlFor={`${uid}-intro`}>
                  <input id={`${uid}-intro`} className="ui-input" value={aud.intro || ''} disabled={!canManage} onChange={(e) => set({ intro: e.target.value })} />
                </Field>
              </div>
              <Field label="How often" htmlFor={`${uid}-freq`}>
                <select id={`${uid}-freq`} className="ui-select" value={aud.frequency || 'weekly'} disabled={!canManage} onChange={(e) => set({ frequency: e.target.value })}>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </Field>
              {(aud.frequency || 'weekly') === 'weekly' && (
                <Field label="Send on" htmlFor={`${uid}-day`}>
                  <select id={`${uid}-day`} className="ui-select" value={day} disabled={!canManage} onChange={(e) => set({ dayOfWeek: e.target.value })}>
                    {['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].map((d) => (
                      <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>
                    ))}
                  </select>
                </Field>
              )}
              <Field label="Numbers from" htmlFor={`${uid}-scope`}>
                <select id={`${uid}-scope`} className="ui-select" value={aud.scope || 'org'} disabled={!canManage} onChange={(e) => set({ scope: e.target.value })}>
                  <option value="org">This store</option>
                  <option value="group">Whole group</option>
                </select>
              </Field>
            </div>
            <Field label={`Send to (${recipients.length})`} htmlFor={`${uid}-to`}>
              <EmailList inputId={`${uid}-to`} emails={recipients} onChange={(v) => set({ recipients: v })} disabled={!canManage} ownEmail={ownEmail} />
            </Field>
            <div className="rep-block">
              <div className="rep-block__head">
                <h3 className="rep-block__title">Metrics in the email</h3>
                <span className="rep-block__meta">{metrics.length} of {catalog.length} · search, then tap to add</span>
              </div>
              <SearchableMetrics catalog={catalog} selected={metrics} onChange={(v) => set({ metrics: v })} disabled={!canManage} />
            </div>
          </div>
          <DigestPreview accent={accentHex} badge={badge} aud={aud} catalog={catalog} orgName={orgName} />
        </div>
      </CardBody>

      <div className="rep-foot">
        <p className="rep-foot__summary">
          {aud.enabled
            ? <>Sends <strong>{metrics.length}</strong> metric{metrics.length === 1 ? '' : 's'} {cadence} to <strong>{recipients.length}</strong> recipient{recipients.length === 1 ? '' : 's'}.</>
            : 'Off. Switch it on to schedule this digest.'}
        </p>
        <div className="rep-foot__actions">
          {err && err.which === audKey && <StatusNote tone="err">{err.text}</StatusNote>}
          {msg && msg.which === audKey && <StatusNote tone="ok">{msg.text}</StatusNote>}
          {savedAt && <StatusNote tone="ok">Saved</StatusNote>}
          <Button icon={Send} onClick={onSendTest} disabled={!canManage || testing || !recipients.length || !metrics.length}>
            {testing ? 'Sending…' : 'Send test'}
          </Button>
          <Button variant="primary" icon={Save} onClick={onSave} disabled={!canManage || saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
      {!canManage && <p className="rep-gate"><Lock size={12} aria-hidden="true" />Your role can see the digests but not change them.</p>}
    </Card>
  );
}

/* ── Scheduled digests (vendor + staff) ─────────────────────────────────
 * Two fully independent digests, each its own card (own schedule,
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
    <>
      <DigestSection
        {...common} audKey="vendor" accent="vendor" accentHex="#C0451F" badge="Vendor digest"
        heading="Vendor digest" sub="For the store owner"
        catalog={DIGEST_VENDOR_METRICS} aud={cfg.vendor || {}} onChange={(a) => setAud('vendor', a)}
        onSave={() => save('vendor')} saving={saving === 'vendor' || !loaded} savedAt={savedAt === 'vendor'}
        onSendTest={() => sendTest('vendor')} testing={testing === 'vendor'}
      />
      <DigestSection
        {...common} audKey="staff" accent="admin" accentHex="#5333A5" badge="Staff digest"
        heading="Staff digest" sub="Everything vendors see, plus platform-wide totals"
        catalog={DIGEST_STAFF_METRICS} aud={cfg.staff || {}} onChange={(a) => setAud('staff', a)}
        onSave={() => save('staff')} saving={saving === 'staff' || !loaded} savedAt={savedAt === 'staff'}
        onSendTest={() => sendTest('staff')} testing={testing === 'staff'}
      />
      <DigestLogs />
    </>
  );
}

/* Collapsible, inner-scrollable log of recent digest sends (scheduled + tests).
 * Reads the rolling log the send-digest edge fn appends to app_config. */
function DigestLogs() {
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
    <Card className="rep-logs">
      <button type="button" className="rep-logs__head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <ChevronRight size={16} className={`rep-logs__chev${open ? ' rep-logs__chev--open' : ''}`} aria-hidden="true" />
        <span className="rep-logs__titles">
          <span className="rep-logs__title">Digest send log</span>
          <span className="rep-logs__sub">Recent scheduled sends and test emails</span>
        </span>
        {rows && rows.length > 0 && <Badge tone="neutral">{rows.length}</Badge>}
      </button>
      {open && (
        <div className="rep-logs__body">
          {rows === null ? (
            <p className="rep-logs__loading">Loading…</p>
          ) : rows.length === 0 ? (
            <EmptyState icon={Inbox} title="No digest sent yet">
              Scheduled sends and test emails will show up here.
            </EmptyState>
          ) : (
            <div className="rep-logs__scroll">
              <table className="ui-table rep-logs__table">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Digest</th>
                    <th>Type</th>
                    <th>Sent to</th>
                    <th className="ui-num">When</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const ok = r.status === 'sent' || r.sent;
                    const staff = (r.audience || 'vendor') === 'staff';
                    return (
                      <tr key={i}>
                        <td><Badge tone={ok ? 'success' : 'danger'}>{ok ? 'Sent' : 'Failed'}</Badge></td>
                        <td><span className={`rep-aud rep-aud--${staff ? 'staff' : 'vendor'}`}>{staff ? 'Staff' : 'Vendor'} digest</span></td>
                        <td className="rep-muted">{r.mode === 'test' ? 'Test' : 'Scheduled'}</td>
                        <td className="rep-logs__to">{Array.isArray(r.to) ? r.to.join(', ') : (r.to || '—')}</td>
                        <td className="ui-num rep-muted">{fmt(r.at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/* ── Notification center ────────────────────────────────────────────────
 * Real-time admin email alerts. Pick which activities send an email and to
 * whom. DB triggers fire the notify-event edge fn on matching inserts. */
function NotificationCenter({ canManage }) {
  const uid = useId();
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
    <Card className="rep-notify">
      <CardHeader
        title="Notification center"
        icon={Bell}
        subtitle="Get an email the moment something happens. Choose the events and who hears about them."
        ruled
        actions={(
          <OnOff
            checked={!!cfg.enabled}
            disabled={!canManage || !loaded}
            label="Send alert emails"
            onChange={(v) => patch({ enabled: v })}
          />
        )}
      />
      <CardBody>
        <div className={`rep-form${cfg.enabled ? '' : ' rep-form--off'}`}>
          <div className="rep-block">
            <div className="rep-block__head">
              <h3 className="rep-block__title">Email me when…</h3>
              <span className="rep-block__meta">{cfg.events.length} of {NOTIFICATION_EVENTS.length} selected</span>
            </div>
            <div className="rep-events">
              {NOTIFICATION_EVENTS.map((ev) => {
                const on = cfg.events.includes(ev.id);
                return (
                  <button
                    key={ev.id}
                    type="button"
                    className={`rep-event${on ? ' rep-event--on' : ''}`}
                    disabled={!canManage}
                    aria-pressed={on}
                    onClick={() => toggleEvent(ev.id)}
                  >
                    <span className="rep-event__box" aria-hidden="true">{on && <Check size={12} strokeWidth={3} />}</span>
                    <span className="rep-event__text">
                      <span className="rep-event__label">{ev.label}</span>
                      <span className="rep-event__hint">{ev.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rep-notify__grid">
            <Field label={`Send alerts to (${recipients.length})`} htmlFor={`${uid}-to`}>
              <EmailList inputId={`${uid}-to`} emails={recipients} onChange={(v) => patch({ recipients: v })} disabled={!canManage} ownEmail={ownEmail} />
            </Field>
            <Field label="Alerts from" htmlFor={`${uid}-scope`}>
              <select
                id={`${uid}-scope`}
                className="ui-select"
                value={cfg.org_id ? 'org' : 'all'}
                disabled={!canManage}
                onChange={(e) => patch({ org_id: e.target.value === 'org' ? (activeOrgId || null) : null })}
              >
                <option value="org">This store only</option>
                <option value="all">Any store</option>
              </select>
            </Field>
          </div>
        </div>
      </CardBody>

      <div className="rep-foot">
        <p className="rep-foot__summary">
          {cfg.enabled && cfg.events.length
            ? <>Emailing <strong>{recipients.length}</strong> recipient{recipients.length === 1 ? '' : 's'} on <strong>{cfg.events.length}</strong> event{cfg.events.length === 1 ? '' : 's'}.</>
            : 'Switch it on and pick at least one event to start getting alerts.'}
        </p>
        <div className="rep-foot__actions">
          {err && <StatusNote tone="err">{err}</StatusNote>}
          {msg && <StatusNote tone="ok">{msg}</StatusNote>}
          {savedAt && <StatusNote tone="ok">Saved</StatusNote>}
          <Button icon={Send} onClick={sendTest} disabled={!canManage || testing || !loaded}>
            {testing ? 'Sending…' : 'Send test now'}
          </Button>
          <Button variant="primary" icon={Save} onClick={save} disabled={!canManage || saving || !loaded}>
            {saving ? 'Saving…' : 'Save notifications'}
          </Button>
        </div>
      </div>
      {!canManage && <p className="rep-gate"><Lock size={12} aria-hidden="true" />Your role can see the alerts but not change them.</p>}
    </Card>
  );
}
