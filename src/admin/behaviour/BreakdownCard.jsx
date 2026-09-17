import { Cell, Pie, PieChart, Tooltip } from 'recharts';
import { BarChart3, ChartPie, ListChecks } from 'lucide-react';
import {
  Button, Card, CardBody, CardFoot, CardHeader, EmptyState, Segmented, fmtInt, usePersistentState,
} from '../ui';

/* ─────────────────────────────────────────────────────────────────────
 * Category breakdowns: which buttons customers tap, where visits come
 * from, active users against visitors, in-app browser choices. Shown as
 * bars (the default) or a donut, the same two views the old detail
 * window offered.
 * ───────────────────────────────────────────────────────────────────── */

const BREAKDOWN_COLORS = ['#5B3FD6', '#0E9E74', '#E8930C', '#1F8FCE', '#E03E6B', '#0F8A7E', '#8B6CFF', '#E2552B', '#4D8A12', '#9A96A8'];

const VIEWS = [
  { id: 'bar', label: 'Bars', icon: BarChart3 },
  { id: 'pie', label: 'Donut', icon: ChartPie },
];

const share = (v, total) => (total ? `${Math.round((v / total) * 100)}%` : '—');

function DonutTip({ active, payload, total, noun }) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  return (
    <div className="ui-series-tip">
      <div className="ui-series-tip__row">
        <span className="ui-chart__swatch" style={{ background: p.payload.color }} />
        <span className="ui-series-tip__val">{fmtInt(p.value)} {noun}</span>
        <span className="ui-series-tip__lbl">{p.name}, {share(p.value, total)}</span>
      </div>
    </div>
  );
}

/* rows: [{ key, label, count, color?, hint? }] */
export function BreakdownChart({ rows, noun = 'items', view = 'bar' }) {
  const data = rows.map((r, i) => ({ ...r, color: r.color || BREAKDOWN_COLORS[i % BREAKDOWN_COLORS.length] }));
  const total = data.reduce((s, r) => s + (r.count || 0), 0);
  const max = Math.max(1, ...data.map(r => r.count || 0));

  if (view === 'pie') {
    return (
      <div className="ub-split-host">
        <div className="ub-split">
          <div className="ub-donut">
            <PieChart width={180} height={180}>
              <Pie
                data={data.filter(d => d.count > 0)} dataKey="count" nameKey="label"
                innerRadius="68%" outerRadius="96%" paddingAngle={2} strokeWidth={0} isAnimationActive={false}
              >
                {data.filter(d => d.count > 0).map(d => <Cell key={d.key} fill={d.color} />)}
              </Pie>
              <Tooltip content={<DonutTip total={total} noun={noun} />} />
            </PieChart>
            <div className="ub-donut__center">
              <span className="ub-donut__value">{fmtInt(total)}</span>
              <span className="ub-donut__label">{noun}</span>
            </div>
          </div>
          <ul className="ub-legend">
            {data.map(d => (
              <li key={d.key} className="ub-legend__row">
                <span className="ub-legend__dot" style={{ background: d.color }} />
                <span className="ub-legend__name">
                  {d.label}
                  {d.hint && <span className="ub-legend__hint">{d.hint}</span>}
                </span>
                <span className="ub-legend__value">{fmtInt(d.count)}</span>
                <span className="ub-legend__pct">{share(d.count, total)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div className="ui-rows">
      {data.map(d => (
        <div className="ui-row ub-bar-row" key={d.key}>
          <div className="ui-row__main">
            <p className="ui-row__title">
              <span className="ub-legend__dot" style={{ background: d.color }} aria-hidden="true" />
              {d.label}
            </p>
            <div className="ui-bar">
              <div className="ui-bar__fill" style={{ width: `${Math.max(d.count ? 2 : 0, Math.round(((d.count || 0) / max) * 100))}%`, background: d.color }} />
            </div>
          </div>
          <span className="ui-row__value">{fmtInt(d.count)}</span>
          <span className="ub-bar-row__pct">{share(d.count, total)}</span>
        </div>
      ))}
    </div>
  );
}

export function BreakdownViewToggle({ value, onChange }) {
  return <Segmented options={VIEWS} value={value} onChange={onChange} iconOnly ariaLabel="Chart type" />;
}

/* A breakdown as a section card. `metric` is a page metric with a
 * `breakdown`; `copy` is its BREAKDOWNS entry. */
export function BreakdownCard({ metric, copy, periodPhrase, loading, onDetails }) {
  const [view, setView] = usePersistentState(`pp-behaviour:breakdown:${metric.id}`, 'bar');
  const rows = metric.breakdown || [];
  const total = rows.reduce((s, r) => s + (r.count || 0), 0);
  return (
    <Card className={loading ? 'ub-stale' : undefined}>
      <CardHeader
        title={copy.title}
        icon={metric.icon}
        subtitle={`${copy.sub(periodPhrase)}.`}
        actions={(
          <>
            {total > 0 && <BreakdownViewToggle value={view} onChange={setView} />}
            {onDetails && <Button size="sm" variant="ghost" onClick={onDetails}>Details</Button>}
          </>
        )}
      />
      <CardBody>
        {total > 0 ? (
          <BreakdownChart rows={rows} noun={copy.noun} view={view} />
        ) : (
          <EmptyState icon={ListChecks} title="Nothing recorded yet">
            {metric.unavailable || `No ${copy.noun} were recorded ${periodPhrase}.`}
          </EmptyState>
        )}
      </CardBody>
      {total > 0 && <CardFoot>{fmtInt(total)} {copy.noun} in total.</CardFoot>}
    </Card>
  );
}

/* Deferred Tikkie: every payout link issued, and what became of it. */
export function LinkSplitCard({ split, periodPhrase, loading, icon, onOpenLog }) {
  const total = split?.issued || 0;
  return (
    <Card className={loading ? 'ub-stale' : undefined}>
      <CardHeader
        title="What happens to payout links"
        icon={icon}
        subtitle={`Tikkie links issued ${periodPhrase}, by what the customer did with them.`}
        actions={onOpenLog && <Button size="sm" variant="ghost" onClick={onOpenLog}>Tikkie payouts</Button>}
      />
      <CardBody>
        {total > 0 ? (
          <>
            <div className="ub-stack" role="img" aria-label={split.rows.map(r => `${r.label}: ${r.count}`).join(', ')}>
              {split.rows.filter(r => r.count > 0).map(r => (
                <span key={r.key} style={{ width: `${(r.count / total) * 100}%`, background: r.color }} title={`${r.label}: ${fmtInt(r.count)}`} />
              ))}
            </div>
            <ul className="ub-legend ub-legend--below">
              {split.rows.map(r => (
                <li key={r.key} className="ub-legend__row">
                  <span className="ub-legend__dot" style={{ background: r.color }} />
                  <span className="ub-legend__name">
                    {r.label}
                    <span className="ub-legend__hint">{r.hint}</span>
                  </span>
                  <span className="ub-legend__value">{fmtInt(r.count)}</span>
                  <span className="ub-legend__pct">{share(r.count, total)}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <EmptyState icon={icon} title="No payout links yet">
            Links show up here once customers collect their balance.
          </EmptyState>
        )}
      </CardBody>
      {total > 0 && <CardFoot>{fmtInt(total)} links issued.</CardFoot>}
    </Card>
  );
}
