import { useId, useState } from 'react';
import {
  ArrowUpRight, Bot, CircleAlert, CircleCheck, Download, ListChecks, ScrollText, Search, ServerCrash, Trash2,
  TriangleAlert,
} from 'lucide-react';
import { purgeOrgRecords } from '../lib/adminApi';
import {
  Badge, Button, Card, CardBody, CardFoot, CardHeader, EmptyState, Modal, Segmented, fmtInt,
} from '../ui';
import {
  bandMeta, errorName, fmtRate, goalShort, plural, prettyRowTime, statusBadge,
} from './healthModel';

/* Detail sections of System health. Styles: AdminStats.css (hl-*). */

function fmtWhen(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleString('en-GB', {
    day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }), hour: '2-digit', minute: '2-digit',
  });
}

function downloadCsv(filename, header, rows) {
  const csv = [header, ...rows]
    .map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ── Every check, with its goal and the rows behind it ─────────────── */
export function ChecksCard({ checks, details, canInspect, onInspect, footer, loading }) {
  return (
    <Card className="hl-span-2">
      <CardHeader
        title="Checks in detail"
        icon={ListChecks}
        subtitle="What each check counts, the level it has to reach, and the rows behind it."
      />
      <CardBody className={loading ? 'hl-dim' : ''}>
        <ul className={`hl-checks${canInspect ? '' : ' hl-checks--static'}`}>
          {checks.map(m => {
            const Icon = m.icon;
            const b = bandMeta(m.band);
            const rows = details?.[m.id]?.rows || [];
            const flagged = rows.filter(r => r.state !== 'ok').length;
            return (
              <li key={m.id} className="hl-check">
                <span className={`hl-check__icon ui-tone--${b.tone}`}>
                  <Icon size={16} aria-hidden="true" />
                </span>
                <div className="hl-check__main">
                  <p className="hl-check__title">{m.label}</p>
                  <p className="hl-check__how">{m.how}</p>
                  {(m.unavailable || m.note) && <p className="hl-check__note">{m.unavailable || m.note}</p>}
                </div>
                <dl className="hl-check__facts">
                  <div>
                    <dt>{m.perLabel}</dt>
                    <dd>
                      {m.denominator ? `${fmtInt(m.numerator)} of ${fmtInt(m.denominator)}` : m.denominator === 0 ? '0' : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt>Healthy at</dt>
                    <dd>{goalShort(m.lower, m.thresholds)}</dd>
                  </div>
                </dl>
                <div className="hl-check__result">
                  <span className={`hl-check__value hl-text--${m.band}`}>{m.value == null ? 'N/A' : fmtRate(m.value)}</span>
                  {statusBadge(m.band)}
                </div>
                {canInspect && (
                  <div className="hl-check__act">
                    {rows.length > 0 ? (
                      <Button
                        size="sm"
                        variant="outline"
                        icon={Search}
                        onClick={() => onInspect(m.id)}
                        title={`See the ${fmtInt(rows.length)} rows behind ${m.label}`}
                      >
                        {flagged ? `${fmtInt(flagged)} flagged` : `${fmtInt(rows.length)} ${plural(rows.length, 'row')}`}
                      </Button>
                    ) : (
                      <span className="hl-check__none">No rows</span>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </CardBody>
      {footer && <CardFoot>{footer}</CardFoot>}
    </Card>
  );
}

/* ── Errors by type ────────────────────────────────────────────────── */
export function ErrorTypesCard({ errors, when, isTikkie, loading }) {
  const max = errors[0]?.count || 0;
  const total = errors.reduce((s, e) => s + e.count, 0);
  const critical = errors.filter(e => e.critical).reduce((s, e) => s + e.count, 0);
  return (
    <Card>
      <CardHeader
        title="Errors by type"
        icon={CircleAlert}
        subtitle={isTikkie
          ? `Why Tikkie links failed ${when}, grouped by how the error starts.`
          : `Why scans were turned away ${when}. Red means something broke; amber means the scan was refused, as designed.`}
      />
      <CardBody className={loading ? 'hl-dim' : ''}>
        {errors.length ? (
          <div className="ui-rows">
            {errors.map(e => (
              <div className="ui-row" key={e.code}>
                <span className={`ui-row__icon ui-tone--${e.critical ? 'rose' : 'amber'}`}>
                  {e.critical ? <ServerCrash size={15} aria-hidden="true" /> : <CircleAlert size={15} aria-hidden="true" />}
                </span>
                <div className="ui-row__main">
                  <p className="ui-row__title" title={e.code}>{e.name}</p>
                  <div className="ui-bar">
                    <div
                      className="ui-bar__fill"
                      style={{
                        width: `${Math.max(2, Math.round((e.count / max) * 100))}%`,
                        background: e.critical ? 'var(--ui-danger)' : '#E3A21A',
                      }}
                    />
                  </div>
                </div>
                <span className="ui-row__value">{fmtInt(e.count)}</span>
                <span className="hl-share">{total ? `${Math.round((e.count / total) * 100)}%` : ''}</span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon={CircleCheck} title="No errors">
            {isTikkie ? `Every Tikkie link ${when} was created without an error.` : `No scan was turned away ${when}.`}
          </EmptyState>
        )}
      </CardBody>
      {total > 0 && (
        <CardFoot>
          {fmtInt(total)} {plural(total, 'error')} in total
          {isTikkie ? '.' : `, ${critical ? `${fmtInt(critical)} of them critical` : 'none of them critical'}.`}
        </CardFoot>
      )}
    </Card>
  );
}

/* ── Error log ─────────────────────────────────────────────────────── */
export function ErrorLogCard({ errors, when, isTikkie, loading }) {
  return (
    <Card id="hl-errors">
      <CardHeader
        title="Error log"
        icon={ScrollText}
        subtitle="The latest message for each kind of error, and when it last happened."
      />
      <CardBody className={loading ? 'hl-dim' : ''}>
        {errors.length ? (
          <div className="ui-table-wrap hl-log-wrap">
            <table className="ui-table hl-log">
              <thead>
                <tr>
                  <th>Error</th>
                  <th>Type</th>
                  <th className="ui-num">Count</th>
                  <th>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {errors.map(e => (
                  <tr key={e.code}>
                    <td>
                      <span className="hl-log__name">{e.name}</span>
                      <span className="hl-log__msg">
                        {!isTikkie && <code className="hl-code">{e.code}</code>}
                        {e.lastMessage || 'No message recorded'}
                      </span>
                    </td>
                    <td>
                      <Badge
                        tone={e.critical ? 'danger' : 'warning'}
                        title={e.critical ? 'Something broke on our side' : 'The system refused the scan, as designed'}
                      >
                        {e.critical ? 'Critical' : 'Expected'}
                      </Badge>
                    </td>
                    <td className="ui-num">{fmtInt(e.count)}</td>
                    <td className="hl-log__when" title={e.lastSeen ? new Date(e.lastSeen).toLocaleString('en-GB') : undefined}>
                      {fmtWhen(e.lastSeen)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={ScrollText} title="The log is empty">
            No errors were logged {when}.
          </EmptyState>
        )}
      </CardBody>
    </Card>
  );
}

/* ── Receipt AI against the reviewers ──────────────────────────────── */
const rateBand = (r) => (r == null ? 'na' : r >= 85 ? 'go' : r >= 60 ? 'cond' : 'nogo');
const RATE_COLOR = { go: 'var(--ui-success)', cond: '#E3A21A', nogo: 'var(--ui-danger)', na: 'var(--ui-muted-2)' };

function MiniStat({ label, value, sub }) {
  return (
    <div>
      <p className="ui-mini-stat__label">{label}</p>
      <p className="ui-mini-stat__value">{value}</p>
      {sub && <p className="ui-mini-stat__sub">{sub}</p>}
    </div>
  );
}

function RateRow({ title, rate, children }) {
  const band = rateBand(rate);
  return (
    <div className="ui-row">
      <div className="ui-row__main">
        <p className="ui-row__title">{title}</p>
        <div className="ui-bar">
          <div className="ui-bar__fill" style={{ width: `${rate ?? 0}%`, background: RATE_COLOR[band] }} />
        </div>
        {children && <div className="hl-ai__meta">{children}</div>}
      </div>
      <span className="ui-row__value" style={{ color: RATE_COLOR[band] }}>{rate == null ? '—' : `${rate}%`}</span>
    </div>
  );
}

export function AiAccuracyCard({ acc, groupScope, onReview, loading }) {
  const has = !!acc?.total;
  const band = rateBand(acc?.overallRate);
  return (
    <Card className="hl-span-2" id="hl-ai">
      <CardHeader
        title="Receipt AI accuracy"
        icon={Bot}
        subtitle={`How often the receipt AI’s verdict matched the reviewer’s decision${groupScope ? ', across the group' : ''}. Only claims a reviewer judged check by check count.`}
        actions={onReview ? <Button size="sm" variant="ghost" iconRight={ArrowUpRight} onClick={onReview}>Review claims</Button> : null}
      />
      <CardBody className={loading ? 'hl-dim' : ''}>
        {!acc ? (
          <EmptyState icon={Bot} title="The AI scores didn’t load">
            Refresh the page to try again. The checks above are not affected.
          </EmptyState>
        ) : !has ? (
          <EmptyState icon={Bot} title="No reviewed receipts yet">
            When reviewers approve or reject receipts check by check, this shows how often the AI agreed with them.
          </EmptyState>
        ) : (
          <div className="hl-ai">
            <div className={`hl-ai__score hl-ai__score--${band}`}>
              <p className="hl-ai__num">{acc.overallRate}%</p>
              <p className="hl-ai__lbl">Agreement with reviewers</p>
              <p className="hl-ai__sub">
                {fmtInt(acc.overallAgree)} of {fmtInt(acc.total)} reviewed {plural(acc.total, 'claim')} matched
              </p>
              <div className="hl-ai__mini">
                {acc.avgConfidence != null && (
                  <MiniStat label="Confidence" value={`${Math.round(acc.avgConfidence * 100)}%`} sub="AI average" />
                )}
                <MiniStat label="Reviewed" value={fmtInt(acc.total)} sub="by AI and a person" />
                <MiniStat label={acc.perStore.length === 1 ? 'Store' : 'Stores'} value={fmtInt(acc.perStore.length)} />
              </div>
            </div>

            <div className="hl-ai__block">
              <p className="hl-subhead">By check</p>
              <p className="hl-ai__legend">
                <b>Too strict</b>: the AI failed a check the reviewer passed. <b>Missed</b>: the reviewer failed a check the AI passed.
              </p>
              {acc.perCriterion.length ? (
                <div className="ui-rows">
                  {acc.perCriterion.map(c => (
                    <RateRow key={c.code} title={c.label} rate={c.rate}>
                      <span>{fmtInt(c.agree)} of {fmtInt(c.inPlay)} agreed</span>
                      {c.aiFalsePos > 0 && <Badge tone="danger">{fmtInt(c.aiFalsePos)} too strict</Badge>}
                      {c.aiFalseNeg > 0 && <Badge tone="warning">{fmtInt(c.aiFalseNeg)} missed</Badge>}
                    </RateRow>
                  ))}
                </div>
              ) : (
                <p className="hl-muted">Neither the AI nor a reviewer failed a specific check yet.</p>
              )}
            </div>

            {acc.perStore.length > 1 && (
              <div className="hl-ai__block hl-ai__stores">
                <p className="hl-subhead">By store</p>
                <div className="ui-rows hl-ai__store-rows">
                  {acc.perStore.map(s => (
                    <RateRow key={s.orgId} title={s.name} rate={s.rate}>
                      <span>{fmtInt(s.total)} reviewed {plural(s.total, 'claim')}</span>
                    </RateRow>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/* ── Danger zone: delete one venue's test data (masters only) ──────── */
export function DangerZoneCard({ org, orgName, groupScope, onDeleted }) {
  const inputId = useId();
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const ready = confirm.trim().toUpperCase() === 'DELETE' && !busy && !!org?.id;

  async function purge() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await purgeOrgRecords(org.id);
      setResult(res || {});
      setConfirm('');
      onDeleted?.();
    } catch (e) {
      console.error('purgeOrgRecords failed', e);
      setError(e?.message || 'The records could not be deleted.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="hl-span-2 hl-danger">
      <CardHeader
        title="Delete test data"
        icon={TriangleAlert}
        subtitle={`Permanently deletes the cup scans, reward claims and cup transfers of ${orgName}. This can’t be undone.`}
      />
      <CardBody>
        <ul className="hl-danger__list">
          <li>Printed QR batches and rewards stay.</li>
          <li>
            Only <b>{orgName}</b> (<code>{org?.slug || org?.id || '—'}</code>) is touched
            {groupScope ? ', even though this page shows the whole group' : ''}. Other organisations keep their data.
          </li>
          <li>Type <b>DELETE</b> to unlock the button.</li>
        </ul>
        <div className="hl-danger__row">
          <label htmlFor={inputId} className="hl-sr-only">Type DELETE to confirm</label>
          <input
            id={inputId}
            type="text"
            className="ui-input hl-danger__input"
            placeholder="Type DELETE to confirm"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            disabled={busy}
            autoComplete="off"
            spellCheck={false}
          />
          <Button variant="danger" icon={Trash2} disabled={!ready} onClick={purge}>
            {busy ? 'Deleting…' : `Delete ${orgName} test data`}
          </Button>
        </div>
        {error && <p className="hl-danger__msg hl-danger__msg--error" role="alert">{error}</p>}
        {result && (
          <p className="hl-danger__msg hl-danger__msg--ok" role="status">
            Deleted for {orgName}: {fmtInt(result.cup_scans ?? 0)} cup scans, {fmtInt(result.claims ?? 0)} claims
            and {fmtInt(result.cup_transfers ?? 0)} cup transfers.
          </p>
        )}
      </CardBody>
    </Card>
  );
}

/* ── The rows behind one check ─────────────────────────────────────── */
const ROW_CAP = 500;
const STATE_TONE = { ok: 'success', bad: 'danger', excluded: 'neutral' };

const STATE_LABELS = {
  qr_gen: { ok: 'Created', bad: 'Failed' },
  qr_scan: { ok: 'Added cups', bad: 'Failed', excluded: 'Left out: repeat scan' },
  correct_org: { ok: 'Right venue', bad: 'Other venue', excluded: 'Left out: cups deleted' },
  cup_count: { ok: 'Every cup', bad: 'Short count' },
  uid_reg: { ok: 'Linked', bad: 'No customer' },
  duplicate: { ok: 'Added once', bad: 'Added more than once' },
  critical_err: { ok: 'Expected', bad: 'Something broke' },
  stuck: { ok: 'Got through', bad: 'Stuck' },
  uptime: { ok: 'Clean', bad: 'Had a system error' },
};

const COLUMN_LABELS = {
  batch: 'Receipt batch',
  cups: 'Cups',
  count: 'Cups',
  req: 'Cups on receipt',
  act: 'Cups added',
  user: 'Customer',
  scan: 'Scan ID',
  matched: 'Saved by server',
  missing: 'Missing details',
  cup: 'Cup',
  times: 'Times added',
  code: 'Error',
  msg: 'Message',
  outcome: 'Outcome',
};

const MONO = new Set(['batch', 'user', 'cup', 'scan']);
const cap = (v) => (typeof v === 'string' && v && v !== '—' ? v.charAt(0).toUpperCase() + v.slice(1) : v);

function cellText(key, v) {
  if (v == null || v === '') return '—';
  if (key === 'time') return prettyRowTime(v);
  if (key === 'code') return errorName(v);
  if (key === 'status' || key === 'matched' || key === 'result') return cap(String(v));
  return v;
}

export function InspectModal({ metric, detail, when, onClose }) {
  const [view, setView] = useState('flagged');
  if (!metric || !detail) return null;

  const rows = detail.rows || [];
  const cols = detail.columns || [];
  const proxyCompleteness = metric.id === 'completeness' && cols.some(c => c.key === 'missing');
  const labels = {
    ok: 'OK', bad: 'Flagged', excluded: 'Left out',
    ...Object.fromEntries(Object.entries(detail.labels || {}).filter(([, v]) => v)),
    ...(metric.id === 'completeness'
      ? (proxyCompleteness ? { ok: 'Complete', bad: 'Missing details' } : { ok: 'Saved', bad: 'Not saved' })
      : STATE_LABELS[metric.id] || {}),
  };
  const flagged = rows.filter(r => r.state !== 'ok');
  const tally = {
    ok: rows.length - flagged.length,
    bad: flagged.filter(r => r.state === 'bad').length,
    excluded: flagged.filter(r => r.state === 'excluded').length,
  };
  const mode = flagged.length ? view : 'all';
  const visible = mode === 'all' ? rows : flagged;
  const shown = visible.slice(0, ROW_CAP);
  const b = bandMeta(metric.band);

  const exportCsv = () => {
    const header = [...cols.map(c => COLUMN_LABELS[c.key] || c.label), 'Result', 'Why'];
    const body = visible.map(r => [...cols.map(c => r.cells?.[c.key]), labels[r.state] || r.state, r.reason]);
    const slug = metric.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    downloadCsv(`packperks-health-${slug}-${new Date().toISOString().slice(0, 10)}.csv`, header, body);
  };

  const subtitle = [
    metric.value == null ? 'Not measured' : fmtRate(metric.value),
    metric.countText,
    `${fmtInt(rows.length)} ${plural(rows.length, 'row')} ${when}`,
  ].filter(Boolean).join(' · ');

  return (
    <Modal
      open
      wide
      onClose={onClose}
      icon={metric.icon}
      iconTone={b.tone}
      title={metric.label}
      subtitle={subtitle}
      footer={(
        <>
          <Button variant="outline" icon={Download} onClick={exportCsv} disabled={!visible.length}>Download CSV</Button>
          <Button variant="primary" onClick={onClose}>Done</Button>
        </>
      )}
    >
      <div className="hl-inspect__summary">
        <p><b>How it’s counted:</b> {metric.how}.</p>
        {(metric.unavailable || metric.note) && <p>{metric.unavailable || metric.note}</p>}
        <div className="hl-inspect__tally">
          <Badge tone="success">{fmtInt(tally.ok)} {labels.ok.toLowerCase()}</Badge>
          {tally.bad > 0 && <Badge tone="danger">{fmtInt(tally.bad)} {labels.bad.toLowerCase()}</Badge>}
          {tally.excluded > 0 && <Badge tone="neutral">{fmtInt(tally.excluded)} {labels.excluded.toLowerCase()}</Badge>}
        </div>
      </div>

      {flagged.length > 0 ? (
        <div className="hl-inspect__bar">
          <Segmented
            ariaLabel="Rows to show"
            value={mode}
            onChange={setView}
            options={[
              { id: 'flagged', label: 'Flagged', count: fmtInt(flagged.length) },
              { id: 'all', label: 'All rows', count: fmtInt(rows.length) },
            ]}
          />
        </div>
      ) : (
        <p className="hl-inspect__clean">Nothing flagged: every row passed.</p>
      )}

      <div className="ui-table-wrap hl-inspect__table">
        <table className="ui-table">
          <thead>
            <tr>
              {cols.map(c => <th key={c.key}>{COLUMN_LABELS[c.key] || c.label}</th>)}
              <th>Result</th>
              <th>Why</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr><td colSpan={cols.length + 2} className="hl-inspect__empty">No rows to show.</td></tr>
            ) : shown.map(r => (
              <tr key={r.id} className={r.state === 'bad' ? 'hl-row--bad' : r.state === 'excluded' ? 'hl-row--muted' : undefined}>
                {cols.map(c => (
                  <td
                    key={c.key}
                    className={MONO.has(c.key) ? 'hl-mono' : c.key === 'time' || c.key === 'hour' ? 'hl-nowrap' : undefined}
                    title={c.key === 'code' ? r.cells?.[c.key] : undefined}
                  >
                    {cellText(c.key, r.cells?.[c.key])}
                  </td>
                ))}
                <td><Badge tone={STATE_TONE[r.state] || 'danger'}>{labels[r.state] || r.state}</Badge></td>
                <td className="hl-inspect__why">{r.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {visible.length > ROW_CAP && (
        <p className="hl-inspect__cap">
          Showing the first {fmtInt(ROW_CAP)} of {fmtInt(visible.length)} rows. Download the CSV to get all of them.
        </p>
      )}
    </Modal>
  );
}
