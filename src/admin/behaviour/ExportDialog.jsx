import { useState } from 'react';
import { Download, FileSpreadsheet } from 'lucide-react';
import { getUserBehaviourDailyHistory } from '../lib/adminApi';
import { Button, Modal, Segmented, Switch } from '../ui';
import { GROUPS, GROUP_TITLE, METRIC_COPY } from './behaviourCopy';
import { kindOf } from './behaviourModel';

/* ─────────────────────────────────────────────────────────────────────
 * Export the page's metrics to a spreadsheet.
 *
 * Same files as before: the "Excel" format is a UTF-8-BOM CSV with a
 * semicolon separator so Excel (Windows and Mac) opens it as a sheet; the
 * plain CSV keeps commas for other tools. One row per metric with the
 * counts it came from, and optionally a second table with each metric's
 * value day by day (getUserBehaviourDailyHistory).
 * ───────────────────────────────────────────────────────────────────── */

const FORMATS = [
  { id: 'xlsx-csv', label: 'Excel (.csv)', title: 'Opens straight into Excel' },
  { id: 'csv', label: 'CSV (plain)', title: 'Comma-separated, for other tools' },
];
const FORMAT_HINT = {
  'xlsx-csv': 'Semicolon-separated with decimal commas, so Excel opens it as a sheet.',
  csv: 'Comma-separated with decimal points, for Google Sheets, Numbers or scripts.',
};

const EXPORT_COLUMNS = [
  { key: 'group', label: 'Group' },
  { key: 'label', label: 'Metric' },
  { key: 'value', label: 'Value' },
  { key: 'numerator', label: 'Numerator' },
  { key: 'numLabel', label: 'Numerator label' },
  { key: 'denominator', label: 'Denominator' },
  { key: 'denLabel', label: 'Denominator label' },
  { key: 'desc', label: 'Description' },
];

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
  const body = rows.map(r => EXPORT_COLUMNS.map(c => escapeCsv(r[c.key])).join(sep)).join('\n');
  return `${isExcel ? '\uFEFF' : ''}${header}\n${body}`;
}

function downloadFile(content, filename) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* The history table's unit per column, and each cell as a plain number so
 * the spreadsheet can chart it. Durations are written in seconds. */
function unitSuffix(kind, currency) {
  if (kind === 'pct') return '%';
  if (kind === 'minutes') return 'sec';
  if (kind === 'money') return currency || 'amount';
  if (kind === 'ratio') return 'average';
  if (kind === 'text') return 'visits on the most common screen';
  return 'count';
}

function historyCell(kind, v, isExcel) {
  if (v === null || v === undefined || Number.isNaN(v)) return '';
  let num;
  if (kind === 'pct' || kind === 'ratio') num = Math.round(v * 10) / 10;
  else if (kind === 'minutes') num = Math.round((v / 1000) * 10) / 10; // the reader gives milliseconds
  else if (kind === 'money') num = Math.round(v * 100) / 100;
  else num = Math.round(v);
  const s = String(num);
  return isExcel ? s.replace('.', ',') : s;
}

function buildHistoryCsv(hist, selected, formatId, currency) {
  const isExcel = formatId === 'xlsx-csv';
  const sep = isExcel ? ';' : ',';
  const cols = hist.metrics.filter(m => selected.has(m.id));
  const title = escapeCsv('Daily history — cumulative value per day');
  const header = ['Date', ...cols.map(m => `${METRIC_COPY[m.id]?.label || m.label} (${unitSuffix(kindOf(m), currency)})`)]
    .map(escapeCsv).join(sep);
  const rows = hist.dates.map((d, i) => (
    [escapeCsv(d.iso.slice(0, 10)), ...cols.map(m => historyCell(kindOf(m), m.values[i], isExcel))].join(sep)
  ));
  return [title, header, ...rows].join('\n');
}

function valueText(m) {
  if (m.value == null) return m.raw?.measurable === false ? 'Not tracked yet' : 'No data yet';
  return m.format(m.value);
}

export default function ExportDialog({
  metrics, groupOf, excluded, onExcludedChange, format, onFormatChange, includeHistory, onIncludeHistoryChange,
  request, scopeOrgIds, mode, orgName, periodText, currency, onClose,
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const skip = new Set(excluded);
  const chosen = metrics.filter(m => !skip.has(m.id));
  const count = chosen.length;

  const toggle = (id) => onExcludedChange(skip.has(id) ? excluded.filter(x => x !== id) : [...excluded, id]);

  async function download() {
    if (!count || busy) return;
    setBusy(true);
    setError(null);
    try {
      const rows = chosen.map(m => ({
        group: GROUP_TITLE[groupOf(m)] || groupOf(m),
        label: m.label,
        value: valueText(m),
        numerator: m.raw?.numerator ?? '',
        numLabel: m.basis?.numLabel ?? '',
        denominator: m.raw?.denominator ?? '',
        denLabel: m.basis?.denLabel ?? '',
        desc: m.info || '',
      }));
      let content = buildCsv(rows, format);
      if (includeHistory) {
        const hist = await getUserBehaviourDailyHistory(request, scopeOrgIds, mode);
        content += `\n\n${buildHistoryCsv(hist, new Set(chosen.map(m => m.id)), format, currency)}`;
      }
      const stamp = new Date().toISOString().slice(0, 10);
      const slug = (orgName || 'org').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      downloadFile(content, `packperks_user_behaviour${includeHistory ? '_with_daily_history' : ''}_${slug}_${stamp}.csv`);
      onClose();
    } catch (e) {
      console.error('behaviour export failed', e);
      setError(e?.message || 'The export failed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      wide
      onClose={onClose}
      icon={FileSpreadsheet}
      iconTone="emerald"
      title="Export metrics"
      subtitle={`Download the numbers for ${periodText} as a spreadsheet. Each row has the value and the counts it was calculated from.`}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={Download} onClick={download} disabled={!count || busy}>
            {busy ? 'Preparing…' : `Download ${count} metric${count === 1 ? '' : 's'}`}
          </Button>
        </>
      )}
    >
      <div className="ub-export__bar">
        <span className="ub-export__count">{count} of {metrics.length} selected</span>
        <span className="ub-export__bulk">
          <Button size="sm" variant="ghost" onClick={() => onExcludedChange([])} disabled={count === metrics.length}>Select all</Button>
          <Button size="sm" variant="ghost" onClick={() => onExcludedChange(metrics.map(m => m.id))} disabled={!count}>Clear</Button>
        </span>
      </div>

      <div className="ub-export__groups">
        {GROUPS.map((g) => {
          const items = metrics.filter(m => groupOf(m) === g.id);
          if (!items.length) return null;
          return (
            <fieldset key={g.id} className="ub-export__group">
              <legend className="ub-export__legend">{g.title}</legend>
              {items.map(m => (
                <label key={m.id} className="ub-check">
                  <input type="checkbox" checked={!skip.has(m.id)} onChange={() => toggle(m.id)} />
                  <span>{m.label}</span>
                </label>
              ))}
            </fieldset>
          );
        })}
      </div>

      <div className="ub-export__option">
        <div className="ub-export__option-text">
          <p className="ub-export__option-title">Include daily history</p>
          <p className="ub-export__option-sub">Adds a second table: each selected metric’s value, day by day, across the period.</p>
        </div>
        <Switch checked={includeHistory} onChange={onIncludeHistoryChange} label="Include daily history" />
      </div>

      <div className="ub-export__option">
        <div className="ub-export__option-text">
          <p className="ub-export__option-title">Format</p>
          <p className="ub-export__option-sub">{FORMAT_HINT[format] || FORMAT_HINT['xlsx-csv']}</p>
        </div>
        <Segmented options={FORMATS} value={format} onChange={onFormatChange} ariaLabel="File format" />
      </div>

      {error && <p className="ub-export__error" role="alert">{error}</p>}
    </Modal>
  );
}
