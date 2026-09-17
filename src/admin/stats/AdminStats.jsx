import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Building2, CircleAlert, RefreshCw, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { getAiAccuracy, getStatsMetrics, getTikkieStatsMetrics } from '../lib/adminApi';
import { TAB_BY_ID, tabAvailability } from '../lib/access';
import { resolveEffectiveMode } from '../lib/orgModes';
import { useOrg } from '../context/OrgContext';
import { useViewRole } from '../context/ViewRole';
import { AccessCtx } from '../context/accessCtx';
import ScopeToggle from '../shared/ScopeToggle';
import {
  Badge, Button, Card, EmptyState, InsightsCard, KpiGrid, Menu, MenuItem, MenuLabel, MenuSeparator, PageHeader,
  PeriodPicker, Switch, TrendCard, fmtInt, periodRange, useChartSelection, usePersistentState,
} from '../ui';
import {
  buildErrorRows, buildHealthInsights, buildHealthMetrics, inPeriod, orderedChecks, plural, prepareHealth,
} from './healthModel';
import {
  AiAccuracyCard, ChecksCard, ErrorLogCard, ErrorTypesCard, InspectModal,
} from './HealthSections';
import './AdminStats.css';

/* ─────────────────────────────────────────────────────────────────────
 * System health — whether the return flow works: the go / no-go checks
 * from getStatsMetrics (QR generation → scan → balance → dashboard), or
 * the Deferred Tikkie set from getTikkieStatsMetrics (bin session →
 * receipt → Tikkie link). Same layout as the Dashboard: tiles, the trend,
 * insights, then the detail behind every check.
 * ───────────────────────────────────────────────────────────────────── */

const PAIRS = {
  standard: [
    { id: 'scans-failed', label: 'Scans vs failed', hint: 'Every scan against the ones that added no cups', ids: ['scans', 'failed'] },
  ],
  tikkie: [
    { id: 'receipts-failed', label: 'Receipts vs failed links', hint: 'Receipts scanned against the ones whose Tikkie link failed', ids: ['receipts', 'failed_links'] },
  ],
};

/* Deferred Tikkie only has day-level series, so no "Today". */
const PERIODS = {
  standard: ['today', '7d', '14d', '30d', '90d', 'all'],
  tikkie: ['7d', '14d', '30d', '90d', 'all'],
};

const KEY_METRIC = { standard: 'qr_scan', tikkie: 'tk_mint' };

/* The tiles a new visitor sees; the rest are a switch away in Customise. */
const MAIN_TILES = 4;

/* The period and the one before it (for the change on each tile and the
 * dashed line on the chart), plus the receipt AI's record. */
async function loadHealth({ isTikkie, period, orgIds, now }) {
  const base = periodRange(period, { now });
  const allTime = base.prevFromMs == null;
  const read = isTikkie ? getTikkieStatsMetrics : getStatsMetrics;
  const fromTs = allTime ? null : base.fromMs;
  const [cur, prev, ai] = await Promise.all([
    read({ fromTs, orgIds }),
    allTime ? null : read({ fromTs: base.prevFromMs, toTs: base.prevToMs - 1, orgIds }).catch(() => null),
    isTikkie ? null : getAiAccuracy({ orgIds, fromTs }).catch(() => null),
  ]);
  const P = prepareHealth(cur, { isTikkie });
  const Q = prepareHealth(prev, { isTikkie });
  const range = allTime ? periodRange(period, { now, earliestMs: P.earliestMs }) : base;
  return { cur: P, prev: Q, ai, range, loadedAt: now };
}

function scrollToSection(id) {
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  document.getElementById(id)?.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' });
}

const lowerFirst = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

export default function AdminStats({ onNavigate }) {
  const {
    activeOrg, scopeOrgIds, statsScope, activeOrgMode, activeGroupMode, activeOrgSettings, status: orgStatus,
  } = useOrg();
  const { access } = useViewRole();
  const workspace = useContext(AccessCtx)?.workspace;
  const isTikkie = activeOrgMode === 'tikkie_only';
  const kind = isTikkie ? 'tikkie' : 'standard';
  const mode = resolveEffectiveMode(activeOrgMode, activeGroupMode);
  const groupScope = statsScope === 'group';

  const [storedPeriod, setPeriod] = usePersistentState('pp-health:period', '30d');
  const period = PERIODS[kind].includes(storedPeriod) ? storedPeriod : (storedPeriod === 'today' ? '7d' : '30d');
  const [mountedAt] = useState(() => Date.now());
  const [reloadKey, setReloadKey] = useState(0);
  const [result, setResult] = useState(null);
  const [inspectId, setInspectId] = useState(null);
  // Which tiles show, per kind of venue: { standard: [ids], tikkie: [ids] }.
  const [tileChoice, setTileChoice] = usePersistentState('pp-health:tiles', {});

  const scopeKey = scopeOrgIds.join(',');
  // No organisation at all: nothing to check. While the list is still
  // loading the page just shows its loading state.
  const noOrg = !scopeKey && orgStatus !== 'loading';
  const requestKey = `${kind}|${period}|${scopeKey}|${reloadKey}`;
  const loading = !noOrg && result?.key !== requestKey;

  useEffect(() => {
    if (!scopeKey) return undefined; // never query without an organisation: that would read every venue
    let alive = true;
    loadHealth({ isTikkie: kind === 'tikkie', period, orgIds: scopeKey.split(','), now: Date.now() })
      .then((r) => { if (alive) setResult({ key: requestKey, kind, ...r }); })
      .catch((e) => {
        console.error('System health failed to load', e);
        if (alive) setResult({ key: requestKey, kind, error: e?.message || 'Something went wrong.' });
      });
    return () => { alive = false; };
  }, [requestKey, kind, period, scopeKey]);

  const refresh = useCallback(() => setReloadKey(k => k + 1), []);
  const closeInspect = useCallback(() => setInspectId(null), []);

  // The last good load for this kind of venue stays on screen (dimmed) while the next one runs.
  const data = scopeKey && result?.cur && result.kind === kind ? result : null;
  const fallbackRange = useMemo(() => periodRange(period, { now: mountedAt }), [period, mountedAt]);
  const range = data?.range || fallbackRange;

  const metrics = useMemo(
    () => buildHealthMetrics({ cur: data?.cur, prev: data?.prev, range, isTikkie }),
    [data, range, isTikkie],
  );
  const selection = useChartSelection({
    metrics, defaultId: KEY_METRIC[kind], pairs: PAIRS[kind], storageKey: 'pp-health:chart',
  });

  const canOpen = useCallback((tabId) => {
    const tab = TAB_BY_ID[tabId];
    if (!tab || !access) return false;
    return tabAvailability(tab, {
      access, mode, settings: activeOrgSettings, hasGroup: !!activeOrg?.group_id, workspace,
    }).visible;
  }, [access, mode, activeOrgSettings, activeOrg?.group_id, workspace]);
  const tabLabel = useCallback((tabId) => `Open ${(TAB_BY_ID[tabId]?.label || 'page').toLowerCase()}`, []);

  const insights = useMemo(() => (data ? buildHealthInsights({
    cur: data.cur,
    prev: data.prev,
    ai: data.ai,
    metrics,
    range,
    isTikkie,
    groupScope,
    now: data.loadedAt,
    onInspect: setInspectId,
    onNavigate,
    canOpen,
    tabLabel,
    onScroll: scrollToSection,
  }) : []), [data, metrics, range, isTikkie, groupScope, onNavigate, canOpen, tabLabel]);

  const checks = useMemo(() => orderedChecks(data?.cur, metrics), [data, metrics]);
  const errors = useMemo(() => buildErrorRows(data?.cur?.raw), [data]);

  // Tiles blank out while a new period loads, like the Dashboard's.
  let tiles = metrics;
  if (loading || noOrg) {
    const badge = loading ? <Badge tone="neutral">Checking…</Badge> : null;
    tiles = metrics.map(m => ({ ...m, value: null, unavailable: null, footnote: m.kind === 'check' ? badge : null }));
  }

  const mainIds = metrics.slice(0, MAIN_TILES).map(m => m.id);
  const shownIds = Array.isArray(tileChoice?.[kind]) ? tileChoice[kind] : mainIds;
  const shownTiles = tiles.filter(m => shownIds.includes(m.id));
  const setShown = (ids) => setTileChoice(prev => ({ ...(prev || {}), [kind]: ids }));
  const toggleTile = (id) => setShown(shownIds.includes(id) ? shownIds.filter(x => x !== id) : [...shownIds, id]);
  const isMainSet = shownIds.length === mainIds.length && mainIds.every(id => shownIds.includes(id));

  // A check scored only for the period as a whole can't join a comparison:
  // it would get a colour but no line.
  const toggleCompare = (id) => {
    const m = metrics.find(x => x.id === id);
    if (m && !m.series && !selection.comparedIds.includes(id)) return;
    selection.toggleCompare(id);
  };

  const selected = metrics.find(m => m.id === selection.selectedId);
  let emptyHint;
  if (noOrg) {
    emptyHint = 'Pick an organisation to see how its setup is doing.';
  } else if (!data) {
    emptyHint = loading ? 'Loading the checks…' : 'The chart fills in once the checks load.';
  } else if (selection.mode === 'single' && selected?.unavailable) {
    emptyHint = `Nothing to plot for ${selected.label}: ${lowerFirst(selected.unavailable)}.`;
  } else if (selection.mode === 'single' && selected && !selected.series) {
    emptyHint = `${selected.label} is worked out for the period as a whole, so it has no line over time. Pick another tile to see a trend.`;
  }

  const venueName = activeOrg?.name || 'this venue';
  const where = groupScope ? 'across this group' : `at ${venueName}`;
  const subtitle = isTikkie
    ? `Whether refunds work ${where}, from smart-bin receipt to Tikkie payout.`
    : `Whether cup returns work ${where}, from printed receipt to customer balance.`;

  const when = inPeriod(range);
  const T = data?.cur?.totals;
  let footer = null;
  if (T) {
    const n = (v) => fmtInt(v || 0);
    const last = T.lastScan
      ? ` Latest ${isTikkie ? 'receipt' : 'scan'}: ${new Date(T.lastScan).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.`
      : '';
    footer = isTikkie
      ? `${n(T.totalScans)} ${plural(T.totalScans, 'receipt')} from ${n(T.attemptingUsers)} ${plural(T.attemptingUsers, 'account')} and ${n(T.batchesGenerated)} bin ${plural(T.batchesGenerated, 'session')} ${when}.${last}`
      : `${n(T.totalScans)} ${plural(T.totalScans, 'scan')} from ${n(T.attemptingUsers)} ${plural(T.attemptingUsers, 'customer')} ${when}. ${n(T.batchesGenerated)} receipt ${T.batchesGenerated === 1 ? 'batch' : 'batches'} printed in total.${last}`;
  }

  const inspectMetric = inspectId ? metrics.find(m => m.id === inspectId) : null;
  const inspectDetail = inspectId ? data?.cur?.raw?.details?.[inspectId] : null;

  return (
    <div className="ui-page hl-page">
      <PageHeader title="System health" subtitle={subtitle}>
        <ScopeToggle />
        <PeriodPicker value={period} onChange={setPeriod} allowed={PERIODS[kind]} />
        <Button
          variant="outline"
          icon={RefreshCw}
          aria-label="Refresh"
          title="Refresh"
          className={loading ? 'hl-spin' : ''}
          onClick={refresh}
        />
        <Menu
          align="right"
          className="hl-custom"
          trigger={({ open, toggle }) => (
            <Button variant="outline" icon={SlidersHorizontal} aria-expanded={open} onClick={toggle}>Customise</Button>
          )}
        >
          <MenuLabel>Tiles on this page</MenuLabel>
          {metrics.map((m, i) => {
            const Icon = m.icon;
            return (
              <div key={m.id} className="hl-custom-row">
                {Icon && <Icon size={15} aria-hidden="true" />}
                <span>{m.label}{i < MAIN_TILES && <small>Main</small>}</span>
                <Switch checked={shownIds.includes(m.id)} onChange={() => toggleTile(m.id)} label={`Show ${m.label}`} />
              </div>
            );
          })}
          {!isMainSet && (
            <>
              <MenuSeparator />
              <MenuItem icon={RotateCcw} onClick={() => setShown(mainIds)}>Show the {MAIN_TILES} main tiles only</MenuItem>
            </>
          )}
        </Menu>
      </PageHeader>

      {result?.error && !loading && (
        <div className="hl-alert" role="alert">
          <CircleAlert size={16} aria-hidden="true" />
          <p><b>The health checks didn’t load.</b> {result.error}</p>
          <Button size="sm" variant="outline" icon={RefreshCw} onClick={refresh}>Try again</Button>
        </div>
      )}

      {shownTiles.length > 0 && (
      <KpiGrid
        metrics={shownTiles}
        mode={selection.tileMode}
        selectedId={selection.selectedId}
        comparedIds={selection.comparedIds}
        onSelect={selection.select}
        onToggleCompare={toggleCompare}
        colorFor={selection.colorFor}
        keyMetricId={KEY_METRIC[kind]}
      />
      )}

      <div className="ui-grid-main">
        <TrendCard
          metrics={metrics}
          selection={selection}
          pairs={PAIRS[kind]}
          range={range}
          loading={loading}
          storageKey="pp-health:chart"
          csvName="packperks-system-health"
          emptyHint={emptyHint}
        />
        <InsightsCard
          insights={insights}
          loading={loading}
          emptyText={noOrg ? 'Insights appear once an organisation is selected.' : 'Insights appear once the checks have loaded.'}
        />
      </div>

      {data && (
        <div className="hl-sections">
          <ChecksCard
            checks={checks}
            details={data.cur.raw?.details}
            canInspect={!isTikkie}
            onInspect={setInspectId}
            footer={footer}
            loading={loading}
          />
          <ErrorTypesCard errors={errors} when={when} isTikkie={isTikkie} loading={loading} />
          <ErrorLogCard errors={errors} when={when} isTikkie={isTikkie} loading={loading} />
          {!isTikkie && (
            <AiAccuracyCard
              acc={data.ai}
              groupScope={groupScope}
              loading={loading}
              onReview={onNavigate && canOpen('claims') ? () => onNavigate('claims') : null}
            />
          )}
        </div>
      )}

      {noOrg && (
        <Card>
          <EmptyState icon={Building2} title="No organisation to check">
            Choose an organisation in the switcher at the top left. If there is none, ask a master account for access.
          </EmptyState>
        </Card>
      )}

      {!data && loading && (
        <div className="hl-sections" aria-hidden="true">
          <div className="hl-skeleton hl-span-2" style={{ height: 320 }} />
          <div className="hl-skeleton" style={{ height: 240 }} />
          <div className="hl-skeleton" style={{ height: 240 }} />
        </div>
      )}

      {inspectMetric && inspectDetail && (
        <InspectModal
          key={inspectId}
          metric={inspectMetric}
          detail={inspectDetail}
          when={when}
          onClose={closeInspect}
        />
      )}
    </div>
  );
}
