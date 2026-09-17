import { AlertTriangle, ArrowUpRight, Info, Lightbulb, TrendingDown, TrendingUp } from 'lucide-react';
import { Card, CardBody, CardHeader, EmptyState } from './primitives';

const ICONS = { up: TrendingUp, down: TrendingDown, warn: AlertTriangle, info: Info };

/* insights: [{ id, tone: 'up'|'down'|'warn'|'info', text: ReactNode,
 *              action?: { label, onClick } }] — most important first.
 * Beside the trend chart the card takes the chart's height and scrolls
 * inside (ui.css, .ui-insights-card), however many insights there are. */
export function InsightsCard({ insights, loading, subtitle, emptyText }) {
  return (
    <Card className="ui-insights-card">
      <CardHeader
        title="Insights"
        icon={Lightbulb}
        subtitle={subtitle || 'Read from the period on screen. They change as you change the period or the store.'}
      />
      <CardBody className="ui-insights-card__body">
        {loading ? (
          <div className="ui-insights" aria-busy="true">
            {[0, 1, 2].map(i => (
              <div key={i} className="ui-insight ui-insight--info" style={{ height: 64, opacity: 0.5 }} />
            ))}
          </div>
        ) : !insights?.length ? (
          <EmptyState icon={Lightbulb} title="Nothing stands out">
            {emptyText || 'Once this store has a few days of activity, patterns worth knowing show up here.'}
          </EmptyState>
        ) : (
          <div className="ui-insights">
            {insights.map((ins, i) => {
              const Icon = ICONS[ins.tone] || Info;
              return (
                <div key={ins.id} className={`ui-insight ui-insight--${ins.tone || 'info'}`} style={{ animationDelay: `${i * 40}ms` }}>
                  <span className="ui-insight__icon"><Icon size={13} aria-hidden="true" /></span>
                  <div style={{ minWidth: 0 }}>
                    <p className="ui-insight__text">{ins.text}</p>
                    {ins.action && (
                      <button type="button" className="ui-insight__action" onClick={ins.action.onClick}>
                        {ins.action.label}
                        <ArrowUpRight size={12} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
