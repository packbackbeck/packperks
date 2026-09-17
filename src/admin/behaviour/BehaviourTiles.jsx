import { ChevronRight } from 'lucide-react';
import { KpiTile, unitFamily } from '../ui';

/* ─────────────────────────────────────────────────────────────────────
 * A grid of the shared KPI tiles, wired to the page's one chart.
 *
 * Why not ui/KpiGrid: this page has three tile groups under one chart, so
 * the compare rules must look at every metric (the first compared one may
 * sit in another group), and each tile needs a way into its details.
 *
 *   single mode   — click shows the metric on the chart
 *   compare mode  — click adds or removes it (same unit only, max four)
 *   Details       — opens the metric's detail window
 * ───────────────────────────────────────────────────────────────────── */

export default function BehaviourTiles({
  metrics, allMetrics, selection, keyMetricId, sparklines = false, loading = false,
  onSelect, onDetails,
}) {
  const { tileMode: mode, selectedId, comparedIds, colorFor, toggleCompare } = selection;
  const first = mode === 'compare' && comparedIds.length
    ? (allMetrics || metrics).find(m => m.id === comparedIds[0])
    : null;

  return (
    <div className="ui-kpis ub-kpis">
      {metrics.map((m, i) => {
        const compared = mode === 'compare' && comparedIds.includes(m.id);
        const chartable = m.kind !== 'text';
        let blockedReason = null;
        if (mode === 'compare' && !compared && !loading) {
          if (!chartable) blockedReason = `${m.label} is a screen name, not a number, so it can’t go on the chart.`;
          else if (m.unavailable || m.value == null || !m.chartable) blockedReason = 'There is no data to plot for this one yet.';
          else if (first && unitFamily(first.unit) !== unitFamily(m.unit)) {
            blockedReason = `${m.label} is measured differently from ${first.label}, so the two can’t share one axis. Clear the comparison to start from this one.`;
          } else if (comparedIds.length >= 4) blockedReason = 'Four metrics at once is the most a chart can show clearly.';
        }
        return (
          <div className={`ub-tile${onDetails && !loading ? ' ub-tile--more' : ''}`} key={m.id}>
            <KpiTile
              metric={m}
              index={i}
              interactive={chartable}
              selected={mode === 'single' && selectedId === m.id}
              compared={compared}
              compareColor={compared ? colorFor(m.id) : undefined}
              blockedReason={blockedReason}
              isKey={keyMetricId === m.id}
              sparkline={sparklines && !loading}
              onClick={() => (mode === 'compare' ? toggleCompare(m.id) : onSelect(m.id))}
            />
            {onDetails && !loading && (
              <button
                type="button"
                className="ub-tile__more"
                onClick={() => onDetails(m.id)}
                aria-label={`Details for ${m.label}`}
              >
                Details
                <ChevronRight size={13} aria-hidden="true" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
