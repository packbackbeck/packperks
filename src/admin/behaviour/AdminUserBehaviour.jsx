import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, Download, HandCoins, Inbox, LayoutGrid, RefreshCw, SlidersHorizontal,
} from 'lucide-react';
import { getUserBehaviourStats } from '../lib/adminApi';
import { useOrg } from '../context/OrgContext';
import { useViewRole } from '../context/ViewRole';
import { useAdminMoney } from '../lib/adminMoney';
import { resolveEffectiveMode } from '../lib/orgModes';
import { TAB_BY_ID } from '../lib/access';
import { formatMoney } from '../../lib/regions';
import ScopeToggle from '../shared/ScopeToggle';
import {
  Button, Card, EmptyState, InsightsCard, PageHeader, TrendCard, useChartSelection, usePersistentState,
} from '../ui';
import ArrangeDialog from './ArrangeDialog';
import BehaviourTiles from './BehaviourTiles';
import { BreakdownCard, LinkSplitCard } from './BreakdownCard';
import DateRangePicker from './DateRangePicker';
import ExportDialog from './ExportDialog';
import FunnelCard from './FunnelCard';
import MetricDetailModal from './MetricDetailModal';
import { BREAKDOWNS, GROUPS } from './behaviourCopy';
import {
  buildFunnels, buildInsights, buildLinkSplit, buildMetrics, chartMetricsFor, chartRangeFor, phraseFor,
  previousRequestFor, requestFor, resolveWindow, skeletonMetrics, windowText,
} from './behaviourModel';
import './AdminUserBehaviour.css';

/* ─────────────────────────────────────────────────────────────────────
 * User behaviour — how customers move from a first scan to a claim.
 *
 * Laid out like the Dashboard: the primary metrics as tiles, one chart
 * that plots whichever tile is picked (or several to compare), insights
 * beside it, then the funnel, the secondary and optional metrics, and the
 * category breakdowns. Every number comes from getUserBehaviourStats; the
 * window before the selected one is read too, for the change on each
 * tile. Deferred Tikkie venues get their own metric set from the same
 * reader.
 *
 * Which section a metric sits in can be changed per browser (Customize,
 * or "Show in" in a metric's details).
 * ───────────────────────────────────────────────────────────────────── */

const OVERRIDES_KEY = 'ppk_behaviour_group_overrides';

const PAIRS = {
  standard: [{
    id: 'comeback', label: 'Second vs third scan',
    hint: 'Customers who came back once, against those who came back twice', ids: ['second_scan', 'third_scan'],
  }],
  tikkie: [{
    id: 'links', label: 'Collected vs expired',
    hint: 'Payout links customers collected, against links that ran out', ids: ['tk_collect', 'tk_expired'],
  }],
};
const KEY_METRIC = { standard: 'qr_scan_receipts', tikkie: 'tk_collect' };
const BREAKDOWN_IDS = ['button_clicks', 'entry_source', 'audience_split', 'inapp_redirect'];
const LOWER_GROUPS = GROUPS.filter(g => g.id !== 'primary');

export default function AdminUserBehaviour({ onNavigate }) {
  const { activeOrg, scopeOrgIds, statsScope, activeOrgMode, activeGroupMode } = useOrg();
  const { access, isVendorView } = useViewRole();
  const { region, currency } = useAdminMoney();
  const money = useMemo(() => (n) => formatMoney(n, region), [region]);
  const modeKey = activeOrgMode === 'tikkie_only' ? 'tikkie' : 'standard';
  const tikkie = modeKey === 'tikkie';

  const [period, setPeriod] = usePersistentState('pp-behaviour:period', '30d');
  const [custom, setCustom] = usePersistentState('pp-behaviour:custom', null);
  const [overrides, setOverrides] = usePersistentState(OVERRIDES_KEY, {});
  const [reloadKey, setReloadKey] = useState(0);
  const [result, setResult] = useState(null);
  const [failure, setFailure] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [excluded, setExcluded] = useState([]);
  const [format, setFormat] = useState('xlsx-csv');
  const [includeHistory, setIncludeHistory] = useState(false);
  const chartRef = useRef(null);

  /* Everything a load depends on. The data on screen belongs to one key;
   * while the key it was loaded for differs, the page is loading. */
  const requestKey = [
    modeKey, period, period === 'custom' ? `${custom?.from}~${custom?.to}` : '', statsScope, activeOrg?.id || '', reloadKey,
  ].join('|');

  useEffect(() => {
    if (!activeOrg?.id) return undefined;
    let alive = true;
    const key = requestKey;
    const win = resolveWindow(period, custom, Date.now());
    const current = getUserBehaviourStats(requestFor(win), scopeOrgIds, activeOrgMode);
    current
      .then((cur) => {
        if (alive) setResult(r => ({ key, modeKey, win, cur, prev: r?.key === key ? r.prev : null }));
      })
      .catch((e) => {
        console.error('getUserBehaviourStats failed', e);
        if (alive) setFailure({ key, message: e?.message || 'The numbers could not be loaded.' });
      });
    // The window before, for the change on each tile. Optional: without it
    // the tiles simply show no change.
    const before = previousRequestFor(win);
    if (before) {
      Promise.all([current, getUserBehaviourStats(before, scopeOrgIds, activeOrgMode)])
        .then(([cur, prev]) => { if (alive) setResult({ key, modeKey, win, cur, prev }); })
        .catch(() => {});
    }
    return () => { alive = false; };
    // The window, scope and mode are all part of requestKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  const fresh = result?.key === requestKey ? result : null;
  const error = failure?.key === requestKey ? failure.message : null;
  const loading = !fresh && !error;
  // The last numbers stay on screen (faded) while the next ones load, but
  // not after a failed load: they would pass for the new period's.
  const shown = fresh || (loading && result?.modeKey === modeKey ? result : null);
  const win = shown?.win || null;
  const meta = shown?.cur?.meta || null;

  const built = useMemo(
    () => (shown ? buildMetrics(shown.cur, shown.prev, shown.win, { money }) : null),
    [shown, money],
  );
  const skeleton = useMemo(() => skeletonMetrics(modeKey), [modeKey]);
  const metrics = built || skeleton;
  const byId = useMemo(() => Object.fromEntries(metrics.map(m => [m.id, m])), [metrics]);

  const groupOf = useCallback((m) => {
    const g = overrides?.[m.id];
    return GROUPS.some(x => x.id === g) ? g : m.group;
  }, [overrides]);
  const changeGroup = useCallback((m, g) => {
    setOverrides((prev) => {
      const next = { ...(prev || {}) };
      if (g === m.group) delete next[m.id];
      else next[m.id] = g;
      return next;
    });
  }, [setOverrides]);

  // While loading, tiles keep their place but not their numbers.
  const tiles = useMemo(() => (loading
    ? metrics.map(m => ({ ...m, value: null, unavailable: null, delta: null, footnote: undefined, description: undefined }))
    : metrics), [loading, metrics]);
  const byGroup = useMemo(() => {
    const out = { primary: [], secondary: [], optional: [] };
    for (const m of tiles) (out[groupOf(m)] || out.optional).push(m);
    return out;
  }, [tiles, groupOf]);

  const selection = useChartSelection({
    metrics, defaultId: KEY_METRIC[modeKey], pairs: PAIRS[modeKey], storageKey: 'pp-behaviour:chart',
  });
  const chartMetrics = useMemo(() => chartMetricsFor(metrics), [metrics]);
  const chartRange = useMemo(
    () => (win ? chartRangeFor(win, meta, metrics, selection.activeIds) : null),
    [win, meta, metrics, selection.activeIds],
  );

  const effMode = resolveEffectiveMode(activeOrgMode, activeGroupMode);
  const canOpen = useCallback((tab) => {
    const t = TAB_BY_ID[tab];
    if (!t || !onNavigate) return false;
    if (t.modes && !t.modes.includes(effMode)) return false;
    return !access?.tabAccess || access.tabAccess(tab) !== 'hidden';
  }, [access, effMode, onNavigate]);

  const insights = useMemo(
    () => (built && win ? buildInsights({ metrics: built, win, tikkie, canOpen, onNavigate }) : []),
    [built, win, tikkie, canOpen, onNavigate],
  );
  const funnels = useMemo(() => (built && !tikkie ? buildFunnels(byId) : []), [built, tikkie, byId]);
  const linkSplit = useMemo(() => (built && tikkie ? buildLinkSplit(byId) : null), [built, tikkie, byId]);

  /* A tile far below the chart scrolls the chart into view when picked. */
  function revealChart() {
    const el = chartRef.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    if (top >= 60 && top < window.innerHeight * 0.45) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }
  function selectFromBelow(id) {
    selection.select(id);
    revealChart();
  }
  function chartFromDetails(id) {
    selection.setMode('single');
    selection.select(id);
    setDetailId(null);
    revealChart();
  }

  const orgName = statsScope === 'group' ? 'this group' : (activeOrg?.name || 'this venue');
  const phrase = phraseFor(win);
  const dates = win ? windowText(win, meta) : '';
  const windowLabel = win && win.id !== 'custom' && dates ? `${win.label} · ${dates}` : dates;
  const focus = selection.mode === 'single' ? byId[selection.selectedId] : null;
  const emptyHint = loading
    ? 'Loading the numbers…'
    : focus?.kind === 'text'
      ? `${focus.label} is a screen name, so there is no line to draw. Open its details instead.`
      : focus && !focus.chartable
        ? `Nothing to plot for ${focus.label} ${phrase}.`
        : undefined;
  const quiet = !!built && built.every(m => m.value == null || m.value === 0);
  const detailMetric = detailId ? byId[detailId] : null;
  let exportPeriod = dates;
  if (win && win.id !== 'custom') {
    const name = win.id === 'all' ? 'all time' : win.id === 'ytd' ? 'this year so far' : `the ${win.noun}`;
    exportPeriod = dates ? `${name} (${dates})` : name;
  }
  const stepDays = chartRange?.stepDays || 1;
  const openDetails = setDetailId;

  return (
    <div className="ui-page ub-page">
      <PageHeader
        title="User behaviour"
        subtitle={tikkie
          ? `How customers use ${orgName}: scanning receipts, collecting payouts and saving an email.`
          : `How customers use ${orgName}: scanning, coming back, claiming, and where they drop off.`}
      >
        <ScopeToggle />
        <DateRangePicker
          value={period}
          custom={custom}
          minDate={meta?.hasData ? meta.minDate : null}
          onChange={(id, range) => { if (range) setCustom(range); setPeriod(id); }}
        />
        <Button
          variant="outline"
          icon={RefreshCw}
          aria-label="Refresh"
          title="Refresh"
          onClick={() => setReloadKey(k => k + 1)}
        />
        {!isVendorView && (
          <Button variant="outline" icon={SlidersHorizontal} onClick={() => setDialog('arrange')}>Customise</Button>
        )}
        <Button variant="outline" icon={Download} onClick={() => setDialog('export')} disabled={!fresh}>Export</Button>
      </PageHeader>

      {error && (
        <Card className="ub-alert" role="alert">
          <span className="ub-alert__icon"><AlertTriangle size={17} aria-hidden="true" /></span>
          <div className="ub-alert__text">
            <p className="ub-alert__title">The numbers didn’t load</p>
            <p className="ub-alert__sub">{error}</p>
          </div>
          <Button size="sm" variant="outline" icon={RefreshCw} onClick={() => setReloadKey(k => k + 1)}>Try again</Button>
        </Card>
      )}

      {byGroup.primary.length > 0 ? (
        <BehaviourTiles
          metrics={byGroup.primary}
          allMetrics={metrics}
          selection={selection}
          keyMetricId={KEY_METRIC[modeKey]}
          loading={loading}
          onSelect={selection.select}
          onDetails={openDetails}
        />
      ) : (
        <Card>
          <EmptyState
            icon={LayoutGrid}
            title="No tiles at the top"
            action={!isVendorView && <Button variant="outline" icon={SlidersHorizontal} onClick={() => setDialog('arrange')}>Customise</Button>}
          >
            Move a metric to Primary to show it here.
          </EmptyState>
        </Card>
      )}

      <div className="ui-grid-main ub-chart-row" ref={chartRef}>
        <TrendCard
          metrics={chartMetrics}
          selection={selection}
          pairs={PAIRS[modeKey]}
          range={chartRange}
          loading={loading}
          storageKey="pp-behaviour:chart"
          csvName="packperks-user-behaviour"
          emptyHint={emptyHint}
        />
        <InsightsCard insights={insights} loading={loading} />
      </div>

      {built && quiet && !loading && (
        <Card>
          <EmptyState
            icon={Inbox}
            title={period === 'all' ? 'No customer activity yet' : 'No customer activity in this period'}
            action={period !== 'all' && meta?.hasData && (
              <Button variant="outline" onClick={() => setPeriod('all')}>Show all time</Button>
            )}
          >
            {tikkie
              ? 'The numbers fill in once customers scan the receipts the bin prints.'
              : 'The numbers fill in once customers scan cup receipts or open the app.'}
          </EmptyState>
        </Card>
      )}

      {built && !quiet && (
        <>
          <div className="ub-sections">
            {tikkie ? (
              <>
                <LinkSplitCard
                  split={linkSplit}
                  periodPhrase={phrase}
                  loading={loading}
                  icon={HandCoins}
                  onOpenLog={canOpen('tikkielog') ? () => onNavigate('tikkielog') : undefined}
                />
                {byId.tk_audience && (
                  <BreakdownCard
                    metric={byId.tk_audience}
                    copy={BREAKDOWNS.tk_audience}
                    periodPhrase={phrase}
                    loading={loading}
                    onDetails={() => openDetails('tk_audience')}
                  />
                )}
              </>
            ) : (
              <FunnelCard funnels={funnels} periodPhrase={phrase} loading={loading} />
            )}
          </div>

          {LOWER_GROUPS.map(g => (byGroup[g.id].length > 0 && (
            <section key={g.id} className="ub-group" aria-labelledby={`ub-group-${g.id}`}>
              <div className="ub-group__head">
                <h2 className="ub-group__title" id={`ub-group-${g.id}`}>{g.title}</h2>
                <p className="ub-group__desc">{g.desc}</p>
              </div>
              <BehaviourTiles
                metrics={byGroup[g.id]}
                allMetrics={metrics}
                selection={selection}
                keyMetricId={KEY_METRIC[modeKey]}
                sparklines
                loading={loading}
                onSelect={selectFromBelow}
                onDetails={openDetails}
              />
            </section>
          )))}

          {!tikkie && (
            <div className="ub-sections">
              {BREAKDOWN_IDS.filter(id => byId[id]).map(id => (
                <BreakdownCard
                  key={id}
                  metric={byId[id]}
                  copy={BREAKDOWNS[id]}
                  periodPhrase={phrase}
                  loading={loading}
                  onDetails={() => openDetails(id)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {detailMetric && built && (
        <MetricDetailModal
          metric={detailMetric}
          group={groupOf(detailMetric)}
          onGroupChange={(g) => changeGroup(detailMetric, g)}
          onClose={() => setDetailId(null)}
          onChart={() => chartFromDetails(detailMetric.id)}
          granularity={chartRange?.granularity}
          stepLabel={stepDays === 1 ? 'day' : `${stepDays} days`}
          windowLabel={windowLabel}
          breakdownCopy={BREAKDOWNS[detailMetric.id]}
        />
      )}

      {dialog === 'export' && built && win && (
        <ExportDialog
          metrics={built}
          groupOf={groupOf}
          excluded={excluded}
          onExcludedChange={setExcluded}
          format={format}
          onFormatChange={setFormat}
          includeHistory={includeHistory}
          onIncludeHistoryChange={setIncludeHistory}
          request={requestFor(win)}
          scopeOrgIds={scopeOrgIds}
          mode={activeOrgMode}
          orgName={activeOrg?.partner_brand_name || activeOrg?.name}
          periodText={exportPeriod}
          currency={currency}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog === 'arrange' && (
        <ArrangeDialog
          metrics={metrics}
          groupOf={groupOf}
          onChange={changeGroup}
          onReset={() => setOverrides({})}
          changed={metrics.some(m => overrides?.[m.id])}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
