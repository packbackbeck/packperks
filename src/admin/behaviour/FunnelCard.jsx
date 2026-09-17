import { ArrowDown, Filter } from 'lucide-react';
import { Badge, Card, CardBody, CardHeader, EmptyState, fmtInt } from '../ui';
import { fmtRate } from './behaviourModel';

/* ─────────────────────────────────────────────────────────────────────
 * Where customers drop off: two short funnels, each step with its count
 * and the share of the step before it. The weakest step is flagged.
 * ───────────────────────────────────────────────────────────────────── */

const BAR = {
  slate: '#B9B5C6', violet: '#5B3FD6', emerald: '#0E9E74', teal: '#0F8A7E', sky: '#1F8FCE', amber: '#E8930C',
};

function Funnel({ funnel }) {
  const total = funnel.total || 0;
  return (
    <div className="ub-funnel">
      <p className="ub-funnel__title">{funnel.title}</p>
      <ol className="ub-funnel__steps">
        {funnel.steps.map((s, i) => {
          const weak = s.id === funnel.weakestId;
          const width = total ? Math.max(s.count ? 1.5 : 0, Math.min(100, ((s.count || 0) / total) * 100)) : 0;
          return (
            <li key={s.id} className="ub-step">
              {i > 0 && (
                <p className={`ub-step__rate${weak ? ' ub-step__rate--weak' : ''}`}>
                  <ArrowDown size={13} aria-hidden="true" />
                  <b>{s.rate == null ? '—' : fmtRate(s.rate)}</b>
                  <span>{s.of}</span>
                  {weak && <Badge tone="warning">Biggest drop</Badge>}
                </p>
              )}
              <div className="ub-step__head">
                <span className="ub-step__label">{s.label}</span>
                <span className="ub-step__count">{fmtInt(s.count || 0)}</span>
              </div>
              <div className="ub-step__bar">
                <span style={{ width: `${width}%`, background: BAR[s.tone] || BAR.violet }} />
              </div>
            </li>
          );
        })}
      </ol>
      {funnel.note && <p className="ub-funnel__note">{funnel.note}</p>}
    </div>
  );
}

export default function FunnelCard({ funnels, periodPhrase, loading }) {
  // A funnel with nothing at its first step (no receipts printed at a Bring
  // Your Own venue, say) has nothing to say.
  const shown = funnels.filter(f => f.total > 0);
  return (
    <Card className={`ub-span-2${loading ? ' ub-stale' : ''}`}>
      <CardHeader
        title="Where customers drop off"
        icon={Filter}
        subtitle={`Each step as a share of the one before, ${periodPhrase}.`}
      />
      <CardBody>
        {shown.length ? (
          <div className={`ub-funnels${shown.length === 1 ? ' ub-funnels--single' : ''}`}>
            {shown.map(f => <Funnel key={f.id} funnel={f} />)}
          </div>
        ) : (
          <EmptyState icon={Filter} title="No customers in this period">
            The funnel fills in once receipts are printed and customers start scanning them.
          </EmptyState>
        )}
      </CardBody>
    </Card>
  );
}
