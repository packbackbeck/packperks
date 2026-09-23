import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, Monitor, PauseCircle, RefreshCw, ShieldCheck, Smartphone, SlidersHorizontal,
  Tablet, Users,
} from 'lucide-react';
import {
  Badge, Button, Card, EmptyState, InsightsCard, KpiGrid, Segmented, TrendCard, useChartSelection,
} from '../../ui';
import {
  getUxCaptureConfig, getUxFlowStats, getUxReplay, getUxReplaySessions, getUxScreen,
  getUxTargetSeries, saveUxCaptureConfig, UX_CAPTURE_DEFAULTS,
} from '../../lib/adminApi';
import { BREAKDOWNS } from '../behaviourCopy';
import { BreakdownCard } from '../BreakdownCard';
import ButtonsCard from './ButtonsCard';
import CaptureDialog from './CaptureDialog';
import FlowCard from './FlowCard';
import HeatmapCard from './HeatmapCard';
import ReplayCard from './ReplayCard';
import {
  buildFlowInsights, buildFlowMetrics, flowChartRange, FLOW_GROUPS, MOVED_BREAKDOWN_IDS,
  MOVED_METRIC_IDS, flowSkeleton,
} from './flowModel';

/* ─────────────────────────────────────────────────────────────────────
 * User analytics → User flow.
 *
 * The main tab answers "is the programme working": scans, returns,
 * claims. This one answers "is the app working": where thumbs land, how
 * far people read, which button nobody can find, and what one visit
 * actually looked like.
 *
 * Four tiles moved here off the main tab because they were always
 * answering this question rather than that one — App opens, Time per
 * visit, Button taps, Where visits end — and they keep their own source
 * (client_events, every consented visit). Everything else is built from
 * what capture recorded, which is a subset. "Visits captured", first
 * tile on the tab, is what ties the two together: it says how much of
 * the programme the rest of the page is speaking for.
 *
 * The device filter applies to everything below the tiles, because a
 * heatmap that mixes a phone and a desktop is a heatmap of neither.
 *
 * It renders three of the page's tabs — the numbers, the heatmap and the
 * replay — from ONE component, because they read the same window, scope
 * and device and the heatmap alone is a second's worth of queries.
 * Switching tabs changes `section`, not the component, so nothing is
 * refetched and the screen you were looking at is still selected when
 * you come back to it.
 * ───────────────────────────────────────────────────────────────────── */

const DEVICES = [
  { id: '', label: 'All devices', icon: Users },
  { id: 'mobile', label: 'Phone', icon: Smartphone },
  { id: 'tablet', label: 'Tablet', icon: Tablet },
  { id: 'desktop', label: 'Desktop', icon: Monitor },
];

const KEY_METRIC = 'flow_captured';

export default function UserFlowTab({
  section = 'flow',
  orgId, orgSlug, orgIds, mode, win, phrase, behaviourMetrics = [], behaviourLoading, canEdit, device, onDevice,
}) {
  const [config, setConfig] = useState(UX_CAPTURE_DEFAULTS);
  const [result, setResult] = useState(null);
  const [failure, setFailure] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [screen, setScreen] = useState(null);
  const [screenData, setScreenData] = useState(null);
  const [seriesByTarget, setSeriesByTarget] = useState({});
  const [buttonScreen, setButtonScreen] = useState(null);
  const [replaySessions, setReplaySessions] = useState([]);
  const [replayId, setReplayId] = useState(null);
  const [replay, setReplay] = useState(null);
  const [dialog, setDialog] = useState(false);
  const chartRef = useRef(null);

  const range = useMemo(
    () => (win?.fromMs == null ? null : { from: new Date(win.fromMs).toISOString(), to: new Date(win.toMs).toISOString() }),
    [win],
  );
  const prevRange = useMemo(
    () => (win?.prevFromMs == null ? null : { from: new Date(win.prevFromMs).toISOString(), to: new Date(win.prevToMs - 1).toISOString() }),
    [win],
  );
  const requestKey = [orgId || '', (orgIds || []).join(','), mode || '', device || '', range?.from || 'all', range?.to || 'all', reloadKey].join('|');

  /* The venue's own capture settings. Read separately from the numbers,
   * because they matter even when there are no numbers yet. */
  useEffect(() => {
    if (!orgId) return undefined;
    let alive = true;
    getUxCaptureConfig(orgId)
      .then(c => { if (alive) setConfig(c); })
      .catch(() => {});
    return () => { alive = false; };
  }, [orgId, reloadKey]);

  useEffect(() => {
    if (!orgId) return undefined;
    let alive = true;
    const key = requestKey;
    Promise.all([
      getUxFlowStats(range, orgIds, mode, device || null),
      prevRange ? getUxFlowStats(prevRange, orgIds, mode, device || null) : Promise.resolve(null),
      getUxReplaySessions(range, orgIds, mode, { device: device || null, limit: 60 }),
    ])
      .then(([cur, prev, visits]) => {
        if (!alive) return;
        setResult({ key, cur, prev });
        setReplaySessions(visits || []);
      })
      .catch((e) => {
        console.error('getUxFlowStats failed', e);
        if (alive) setFailure({ key, message: e?.message || 'The captured visits could not be loaded.' });
      });
    return () => { alive = false; };
    // Everything a load depends on is in requestKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  const fresh = result?.key === requestKey ? result : null;
  const error = failure?.key === requestKey ? failure.message : null;
  const loading = !fresh && !error;
  const shown = fresh || result || null;
  const cur = shown?.cur || null;
  const screens = useMemo(() => cur?.screens || [], [cur]);
  const targets = useMemo(() => cur?.targets || [], [cur]);

  /* The busiest screen, unless a screen is already picked and still has
   * traffic in the new window. */
  const activeScreen = useMemo(() => {
    if (screen && screens.some(s => s.screen === screen)) return screen;
    return screens[0]?.screen || null;
  }, [screen, screens]);

  /* The heat for one screen. The result carries the key it was loaded
   * for, so the previous screen's heat is never painted under the new
   * screen's name — and "still loading" is that mismatch, not a flag. */
  const screenKey = `${requestKey}|${activeScreen || ''}`;
  useEffect(() => {
    if (!activeScreen || !orgId) return undefined;
    let alive = true;
    const key = screenKey;
    getUxScreen(activeScreen, range, orgIds, mode, device || null)
      .then(d => { if (alive) setScreenData({ key, ...d }); })
      .catch(() => { if (alive) setScreenData({ key, cells: [], curve: [], targets: [], layout: null }); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenKey]);
  const screenReady = screenData?.key === screenKey ? screenData : null;
  const screenBusy = !!activeScreen && !screenReady;

  useEffect(() => {
    if (!replayId) return undefined;
    let alive = true;
    const key = replayId;
    getUxReplay(replayId, orgIds, mode)
      .then(r => { if (alive) setReplay({ key, ...r }); })
      .catch(() => { if (alive) setReplay({ key, session: null, events: [], layouts: [] }); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayId]);
  const replayReady = replay?.key === replayId ? replay : null;
  const replayBusy = !!replayId && !replayReady;

  // A new window invalidates the per-button lines that were loaded for the
  // old one, so they are dropped rather than shown against the wrong dates.
  const [seriesKey, setSeriesKey] = useState(requestKey);
  if (seriesKey !== requestKey) { setSeriesKey(requestKey); setSeriesByTarget({}); }

  const loadSeries = useCallback((target) => {
    getUxTargetSeries(target, range, orgIds, mode, device || null)
      .then(s => setSeriesByTarget(prev => ({ ...prev, [target]: s || [] })))
      .catch(() => setSeriesByTarget(prev => ({ ...prev, [target]: [] })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  /* ── Tiles ── */

  const movedById = useMemo(
    () => Object.fromEntries(behaviourMetrics.filter(m => MOVED_METRIC_IDS.includes(m.id)).map(m => [m.id, m])),
    [behaviourMetrics],
  );
  const appOpens = movedById.entry_source?.value ?? null;

  const flowMetrics = useMemo(() => (cur
    ? buildFlowMetrics({ sessions: cur.sessions, targets: cur.targets, prev: shown?.prev, win, appOpens })
    : flowSkeleton()), [cur, shown, win, appOpens]);

  /* The moved tiles keep their own numbers and their own sections. */
  const moved = useMemo(() => {
    const place = { entry_source: 'visits', avg_session: 'visits', last_screen: 'visits', button_clicks: 'taps' };
    return MOVED_METRIC_IDS
      .map(id => movedById[id])
      .filter(Boolean)
      .map(m => ({ ...m, group: place[m.id] || 'visits' }));
  }, [movedById]);

  const metrics = useMemo(() => {
    const all = [...flowMetrics, ...moved];
    // Reading order inside each section: the moved tiles sit with the ones
    // they belong beside, not in a block of their own.
    const order = [
      'entry_source', 'flow_captured', 'avg_session', 'flow_screens', 'last_screen',
      'button_clicks', 'flow_taps', 'flow_first_tap', 'flow_no_tap', 'flow_dead', 'flow_rage',
      'flow_top_target', 'flow_slow_target',
      'flow_scroll', 'flow_bottom',
    ];
    return all.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  }, [flowMetrics, moved]);

  const byGroup = useMemo(() => {
    const out = { visits: [], taps: [], reading: [] };
    for (const m of metrics) (out[m.group] || out.visits).push(m);
    return out;
  }, [metrics]);

  const selection = useChartSelection({ metrics, defaultId: KEY_METRIC, storageKey: 'pp-userflow:chart' });
  const chartMetrics = useMemo(() => metrics.map(m => (m.chartable
    ? { ...m, series: m.points.map(p => ({ t: p.t, value: p.value })) }
    : { ...m, series: undefined })), [metrics]);
  const chartRange = useMemo(() => flowChartRange(win, metrics, selection.activeIds), [win, metrics, selection.activeIds]);

  const insights = useMemo(() => (cur
    ? buildFlowInsights({ metrics, screens, targets, config, phrase })
    : []), [cur, metrics, screens, targets, config, phrase]);

  const busy = loading || behaviourLoading;
  const nothing = !busy && !error && (cur?.sessions?.length || 0) === 0;
  const totalTaps = useMemo(() => (cur?.sessions || []).reduce((s, v) => s + (Number(v.clicks) || 0), 0), [cur]);

  function revealChart() {
    const el = chartRef.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    if (top >= 60 && top < window.innerHeight * 0.45) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }

  async function saveConfig(next) {
    const saved = await saveUxCaptureConfig(orgId, next);
    setConfig(saved);
    setReloadKey(k => k + 1);
    return saved;
  }

  return (
    <div className="uf">
      <div className="uf__bar">
        <div className="uf__status">
          {config.enabled ? (
            <Badge tone="emerald" icon={ShieldCheck}>
              Capturing{Number(config.sample) < 100 ? ` ${config.sample}% of visits` : ''}
            </Badge>
          ) : (
            <Badge tone="slate" icon={PauseCircle}>Capture paused</Badge>
          )}
          <span className="uf__statusnote">
            Consented visits only · kept {config.retentionDays} days · replay {config.replay ? 'on' : 'off'}
          </span>
        </div>
        <div className="uf__controls">
          <Segmented options={DEVICES} value={device || ''} onChange={v => onDevice(v || null)} ariaLabel="Device" />
          <Button variant="outline" icon={RefreshCw} aria-label="Refresh" title="Refresh" onClick={() => setReloadKey(k => k + 1)} />
          <Button variant="outline" icon={SlidersHorizontal} onClick={() => setDialog(true)}>Capture settings</Button>
        </div>
      </div>

      {error && (
        <Card className="ub-alert" role="alert">
          <span className="ub-alert__icon"><AlertTriangle size={17} aria-hidden="true" /></span>
          <div className="ub-alert__text">
            <p className="ub-alert__title">The captured visits didn’t load</p>
            <p className="ub-alert__sub">{error}</p>
          </div>
          <Button size="sm" variant="outline" icon={RefreshCw} onClick={() => setReloadKey(k => k + 1)}>Try again</Button>
        </Card>
      )}

      {section === 'flow' && FLOW_GROUPS.map(g => (byGroup[g.id].length > 0 && (
        <section key={g.id} className="uf__group" aria-labelledby={`uf-group-${g.id}`}>
          <div className="ub-group__head">
            <h2 className="ub-group__title" id={`uf-group-${g.id}`}>{g.title}</h2>
            <p className="ub-group__desc">{g.desc}</p>
          </div>
          <KpiGrid
            metrics={busy ? byGroup[g.id].map(m => ({ ...m, value: null, delta: null, description: undefined })) : byGroup[g.id]}
            mode={selection.tileMode}
            selectedId={selection.selectedId}
            comparedIds={selection.comparedIds}
            colorFor={selection.colorFor}
            keyMetricId={KEY_METRIC}
            sparklines={g.id !== 'visits'}
            onSelect={(id) => { selection.select(id); if (g.id !== 'visits') revealChart(); }}
            onToggleCompare={selection.toggleCompare}
          />
        </section>
      )))}

      {section === 'flow' && (
      <div className="ui-grid-main uf__chartrow" ref={chartRef}>
        <TrendCard
          metrics={chartMetrics}
          selection={selection}
          range={chartRange}
          loading={busy}
          storageKey="pp-userflow:chart"
          csvName="packperks-user-flow"
          emptyHint={busy ? 'Loading the numbers…' : undefined}
        />
        <InsightsCard
          insights={insights}
          loading={busy}
          subtitle="Read from the captured visits on screen."
          emptyText="Once a few dozen visits are captured, the patterns worth acting on show up here."
        />
      </div>
      )}

      {nothing ? (
        <Card>
          <EmptyState
            icon={ShieldCheck}
            title={config.enabled ? 'No visit captured in this period' : 'Capture is switched off'}
            action={canEdit && (
              <Button variant="primary" icon={SlidersHorizontal} onClick={() => setDialog(true)}>
                Open Capture settings
              </Button>
            )}
          >
            {config.enabled
              ? 'Only customers who accepted analytics cookies are captured, so it takes a few visits before a heatmap is worth looking at. Try a longer period.'
              : 'Nothing new is being recorded for this venue. Turning capture on starts the heatmaps, the button table and the flow filling in.'}
          </EmptyState>
        </Card>
      ) : section === 'heatmap' ? (
        <>
          <HeatmapCard
            screens={screens}
            screen={activeScreen}
            onScreen={setScreen}
            data={screenReady}
            loading={busy || screenBusy}
            phrase={phrase}
            captureOff={!config.enabled}
            slug={orgSlug}
            device={device}
          />
          <ButtonsCard
            targets={targets}
            screens={screens}
            loading={busy}
            phrase={phrase}
            onLoadSeries={loadSeries}
            seriesByTarget={seriesByTarget}
            screenFilter={buttonScreen}
            onScreenFilter={setButtonScreen}
          />
        </>
      ) : section === 'replay' ? (
        <ReplayCard
          sessions={replaySessions}
          replayOn={!!config.replay}
          loading={busy}
          phrase={phrase}
          selected={replayId}
          onSelect={setReplayId}
          replay={replayReady}
          replayLoading={replayBusy}
          onOpenSettings={canEdit ? () => setDialog(true) : undefined}
          slug={orgSlug}
        />
      ) : (
        <>
          <FlowCard
            flow={cur?.flow || []}
            screens={screens}
            screen={activeScreen}
            onScreen={setScreen}
            loading={busy}
            phrase={phrase}
          />

          {MOVED_BREAKDOWN_IDS.filter(id => movedById[id]?.breakdown?.length).length > 0 && (
            <div className="ub-sections">
              {MOVED_BREAKDOWN_IDS.filter(id => movedById[id]?.breakdown?.length).map(id => (
                <BreakdownCard
                  key={id}
                  metric={movedById[id]}
                  copy={BREAKDOWNS[id]}
                  periodPhrase={phrase}
                  loading={behaviourLoading}
                />
              ))}
            </div>
          )}
        </>
      )}

      {dialog && (
        <CaptureDialog
          config={config}
          canEdit={canEdit}
          stats={{ sessions: cur?.sessions?.length || 0, taps: totalTaps }}
          onSave={saveConfig}
          onClose={() => setDialog(false)}
        />
      )}
    </div>
  );
}
