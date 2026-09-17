import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  Activity, Clock, Coins, Gift, LayoutGrid, MapPin, PieChart as PieIcon, RefreshCw, SlidersHorizontal,
  Smartphone, Trophy,
} from 'lucide-react';
import { getAdminStats, getRewardBudget, getScansByLocation } from '../lib/adminApi';
import RewardBudgetMonitor from '../shared/RewardBudgetMonitor';
import ScopeToggle from '../shared/ScopeToggle';
import PiiMask from '../shared/PiiMask';
import { useOrg } from '../context/OrgContext';
import { useViewRole } from '../context/ViewRole';
import { useAdminMoney } from '../lib/adminMoney';
import { resolveEffectiveMode } from '../lib/orgModes';
import {
  Button, Card, CardBody, CardFoot, CardHeader, EmptyState, InsightsCard, KpiGrid, Menu, MenuLabel,
  PageHeader, PeriodPicker, Switch, TrendCard, fmtInt, periodPhrase, periodRange, useChartSelection, usePersistentState,
} from '../ui';
import {
  buildCupFlow, buildDevices, buildHourly, buildOverviewInsights, buildOverviewMetrics,
  buildRewardPopularity, buildTopReturners,
} from './overviewModel';
import './AdminOverview.css';

const PAIRS = [
  { id: 'flow', label: 'Returned vs redeemed', hint: 'Cups coming in against cups spent on rewards', ids: ['cups', 'redeemed'] },
];

/* Detail sections under the chart. Their visibility is stored with the
 * dashboard draft (dashboardBlocks), like the old Overview's cards.
 * `modes` limits a section to the programmes it has data for: only counter
 * QR scans (Bring Your Own) carry a location, and Deferred Tikkie venues
 * have no rewards, so no reward claims or reward budget. */
const SECTIONS = [
  { id: 'chart-cup-dist', label: 'Where cups go', icon: PieIcon },
  { id: 'chart-reward-pop', label: 'Most claimed rewards', icon: Gift, modes: ['standard', 'byo'] },
  { id: 'insight-hourly', label: 'When cups come back', icon: Clock },
  { id: 'insight-devices', label: 'Devices', icon: Smartphone },
  { id: 'insight-top-returners', label: 'Top returners', icon: Trophy, staffOnly: true },
  { id: 'feed-activity', label: 'Recent activity', icon: Activity },
  { id: 'chart-locations', label: 'Scans by location', icon: MapPin, modes: ['byo'] },
  { id: 'budget', label: 'Reward budget', icon: Coins, staffOnly: true, modes: ['standard', 'byo'] },
];

const ACTIVITY = {
  cup_added: { label: 'Cup returned', tone: 'emerald' },
  reward_claimed: { label: 'Reward claimed', tone: 'amber' },
  cups_withdrawn: { label: 'Refund issued', tone: 'sky' },
  cups_shared: { label: 'Cups shared', tone: 'violet' },
  cups_donated: { label: 'Cups donated', tone: 'teal' },
};

function timeAgo(ts) {
  if (!ts) return '';
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

function PieTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  return (
    <div className="ui-series-tip">
      <div className="ui-series-tip__row">
        <span className="ui-chart__swatch" style={{ background: p.payload.color }} />
        <span className="ui-series-tip__val">{fmtInt(p.value)}</span>
        <span className="ui-series-tip__lbl">{p.name}</span>
      </div>
    </div>
  );
}

function Donut({ data, total, centerLabel }) {
  return (
    <div className="ov-donut">
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 180, height: 180 }}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius="68%" outerRadius="96%" paddingAngle={2} strokeWidth={0} isAnimationActive={false}>
            {data.map(d => <Cell key={d.name} fill={d.color} />)}
          </Pie>
          <Tooltip content={<PieTip />} />
        </PieChart>
      </ResponsiveContainer>
      <div className="ov-donut__center">
        <span className="ov-donut__value">{fmtInt(total)}</span>
        <span className="ov-donut__label">{centerLabel}</span>
      </div>
    </div>
  );
}

function Legend({ data, total }) {
  return (
    <ul className="ov-legend">
      {data.map(d => (
        <li key={d.name} className="ov-legend__row">
          <span className="ov-legend__dot" style={{ background: d.color }} />
          <span className="ov-legend__name">
            {d.name}
            {d.hint && <span className="ov-legend__hint">{d.hint}</span>}
          </span>
          <span className="ov-legend__value">{fmtInt(d.value)}</span>
          <span className="ov-legend__pct">{total ? `${Math.round((d.value / total) * 100)}%` : '—'}</span>
        </li>
      ))}
    </ul>
  );
}

export default function AdminOverview({ draftState, onNavigate }) {
  const { money } = useAdminMoney();
  const { isVendorView } = useViewRole();
  const { activeOrg, scopeOrgIds, statsScope, activeOrgMode, activeGroupMode } = useOrg();
  const mode = resolveEffectiveMode(activeOrgMode, activeGroupMode);
  const { draft, updateDraft } = draftState;
  const [period, setPeriod] = usePersistentState('pp-overview:period', '30d');
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [budget, setBudget] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [loadedAt, setLoadedAt] = useState(() => Date.now());

  useEffect(() => {
    let alive = true;
    getAdminStats(scopeOrgIds)
      .then(s => { if (alive) { setStats(s); setLoadedAt(Date.now()); } })
      .catch(() => { if (alive) setStats(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statsScope, activeOrg?.id, reloadKey]);

  useEffect(() => {
    let alive = true;
    getRewardBudget().then(b => { if (alive) setBudget(b); }).catch(() => {});
    return () => { alive = false; };
  }, [activeOrg?.id, reloadKey]);

  const earliestMs = useMemo(() => {
    const times = (stats?.rawCupActivity || []).map(e => new Date(e.created_at).getTime())
      .concat((stats?.rawUsers || []).map(u => new Date(u.created_at).getTime()))
      .filter(Number.isFinite);
    return times.length ? Math.min(...times) : null;
  }, [stats]);
  const range = useMemo(() => periodRange(period, { now: loadedAt, earliestMs }), [period, loadedAt, earliestMs]);

  const voucherVenue = draft?.settings?.paymentMethod === 'voucher';
  const metrics = useMemo(
    () => buildOverviewMetrics(stats, range, { money, voucherVenue }),
    [stats, range, money, voucherVenue],
  );
  const selection = useChartSelection({ metrics, defaultId: 'cups', pairs: PAIRS, storageKey: 'pp-overview:chart' });
  const insights = useMemo(() => buildOverviewInsights({
    stats, metrics, range, rewards: draft?.rewards, budget, money, onNavigate, isVendorView,
  }), [stats, metrics, range, draft?.rewards, budget, money, onNavigate, isVendorView]);

  const blocks = draft?.dashboardBlocks || [];
  const sections = SECTIONS.filter(s => !(s.staffOnly && isVendorView) && (!s.modes || s.modes.includes(mode)));
  const isVisible = (id) => blocks.find(b => b.id === id)?.visible ?? true;
  const toggleSection = (id) => updateDraft(prev => {
    const list = prev.dashboardBlocks || [];
    const exists = list.some(b => b.id === id);
    return {
      ...prev,
      dashboardBlocks: exists
        ? list.map(b => (b.id === id ? { ...b, visible: !(b.visible ?? true) } : b))
        : [...list, { id, label: SECTIONS.find(s => s.id === id)?.label || id, type: 'section', visible: false }],
    };
  });

  const flow = useMemo(() => buildCupFlow(stats), [stats]);
  const flowTotal = flow.reduce((a, b) => a + b.value, 0);
  const rewards = useMemo(() => buildRewardPopularity(stats, draft?.rewards, range), [stats, draft?.rewards, range]);
  const hourly = useMemo(() => buildHourly(stats, range), [stats, range]);
  const peakHour = hourly.reduce((p, h) => (h.value > p.value ? h : p), hourly[0]);
  const devices = useMemo(() => buildDevices(stats), [stats]);
  const deviceTotal = devices.reduce((a, b) => a + b.value, 0);
  const returners = useMemo(() => buildTopReturners(stats, range), [stats, range]);

  const orgName = statsScope === 'group' ? 'this group' : (activeOrg?.name || 'this venue');
  const shown = (id) => isVisible(id) && sections.some(s => s.id === id);

  return (
    <div className="ui-page">
      <PageHeader
        title="Dashboard"
        subtitle={`How ${orgName} is doing: cups coming back, customers, rewards and payouts.`}
      >
        <ScopeToggle />
        <PeriodPicker value={period} onChange={setPeriod} />
        <Button
          variant="outline"
          icon={RefreshCw}
          aria-label="Refresh"
          title="Refresh"
          onClick={() => { setLoading(true); setReloadKey(k => k + 1); }}
        />
        {!isVendorView && (
          <Menu
            align="right"
            trigger={({ open, toggle }) => (
              <Button variant="outline" icon={SlidersHorizontal} aria-expanded={open} onClick={toggle}>Customise</Button>
            )}
          >
            <MenuLabel>Sections on this page</MenuLabel>
            {sections.map(s => {
              const Icon = s.icon;
              return (
                <div key={s.id} className="ov-custom-row">
                  <Icon size={15} aria-hidden="true" />
                  <span>{s.label}</span>
                  <Switch checked={isVisible(s.id)} onChange={() => toggleSection(s.id)} label={`Show ${s.label}`} />
                </div>
              );
            })}
          </Menu>
        )}
      </PageHeader>

      <KpiGrid
        metrics={loading ? metrics.map(m => ({ ...m, value: null, unavailable: null })) : metrics}
        mode={selection.tileMode}
        selectedId={selection.selectedId}
        comparedIds={selection.comparedIds}
        onSelect={selection.select}
        onToggleCompare={selection.toggleCompare}
        colorFor={selection.colorFor}
        keyMetricId="cups"
      />

      <div className="ui-grid-main">
        <TrendCard
          metrics={metrics}
          selection={selection}
          pairs={PAIRS}
          range={range}
          loading={loading}
          storageKey="pp-overview:chart"
          csvName="packperks-dashboard"
        />
        <InsightsCard insights={insights} loading={loading} />
      </div>

      <div className="ov-sections">
        {shown('chart-cup-dist') && (
          <Card>
            <CardHeader title="Where cups go" icon={PieIcon} subtitle="Every cup ever collected, and where it is now." />
            <CardBody>
              {flowTotal ? (
                <div className="ov-split">
                  <Donut data={flow.filter(d => d.value > 0)} total={flowTotal} centerLabel="cups collected" />
                  <Legend data={flow} total={flowTotal} />
                </div>
              ) : <EmptyState icon={PieIcon} title="No cups yet">Cups show up here once customers start returning them.</EmptyState>}
            </CardBody>
          </Card>
        )}

        {shown('chart-reward-pop') && (
          <Card>
            <CardHeader
              title="Most claimed rewards"
              icon={Gift}
              subtitle={`Claims ${periodPhrase(range)}, rejected ones left out.`}
              actions={!isVendorView && <Button size="sm" variant="ghost" onClick={() => onNavigate?.('rewards')}>Rewards</Button>}
            />
            <CardBody>
              {rewards.length ? (
                <div className="ui-rows">
                  {rewards.map((r, i) => (
                    <div className="ui-row" key={r.id}>
                      <span className={`ui-row__icon ui-tone--${i === 0 ? 'orange' : 'slate'}`}>
                        {r.image ? <img className="ov-reward-img" src={r.image} alt="" /> : <Gift size={15} aria-hidden="true" />}
                      </span>
                      <div className="ui-row__main">
                        <p className="ui-row__title">{r.name}</p>
                        <div className="ui-bar">
                          <div className="ui-bar__fill" style={{ width: `${Math.round((r.value / rewards[0].value) * 100)}%`, background: i === 0 ? 'var(--ui-accent)' : 'var(--ui-primary)' }} />
                        </div>
                      </div>
                      <span className="ui-row__value">{fmtInt(r.value)}</span>
                    </div>
                  ))}
                </div>
              ) : <EmptyState icon={Gift} title="No rewards claimed">Nothing was claimed {periodPhrase(range)}.</EmptyState>}
            </CardBody>
          </Card>
        )}

        {shown('insight-hourly') && (
          <Card>
            <CardHeader
              title="When cups come back"
              icon={Clock}
              subtitle={peakHour?.value ? `Busiest hour: ${peakHour.label}–${String((peakHour.hour + 1) % 24).padStart(2, '0')}:00.` : `Cups returned per hour of the day, ${periodPhrase(range)}.`}
            />
            <CardBody>
              <div style={{ height: 210 }}>
                <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 520, height: 210 }}>
                  <BarChart data={hourly} margin={{ top: 6, right: 4, left: -18, bottom: 0 }}>
                    <XAxis dataKey="hour" tick={{ fontSize: 11, fill: '#8F8B9C' }} tickLine={false} axisLine={false} interval={2} tickFormatter={(h) => `${h}h`} />
                    <YAxis tick={{ fontSize: 11, fill: '#8F8B9C' }} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip
                      cursor={{ fill: 'rgba(91, 63, 214, 0.06)' }}
                      content={({ active, payload }) => (active && payload?.length ? (
                        <div className="ui-series-tip">
                          <p className="ui-series-tip__when">{payload[0].payload.label}</p>
                          <div className="ui-series-tip__row"><span className="ui-series-tip__val">{fmtInt(payload[0].value)}</span><span className="ui-series-tip__lbl">cups</span></div>
                        </div>
                      ) : null)}
                    />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                      {hourly.map(h => <Cell key={h.hour} fill={h.hour === peakHour?.hour && h.value ? '#5B3FD6' : '#C9BFF4'} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardBody>
          </Card>
        )}

        {shown('insight-devices') && (
          <Card>
            <CardHeader title="Devices" icon={Smartphone} subtitle="What customers use to open the app." />
            <CardBody>
              {deviceTotal ? (
                <div className="ov-split">
                  <Donut data={devices} total={deviceTotal} centerLabel="customers" />
                  <Legend data={devices} total={deviceTotal} />
                </div>
              ) : <EmptyState icon={Smartphone} title="No customers yet" />}
            </CardBody>
          </Card>
        )}

        {shown('insight-top-returners') && (
          <Card>
            <CardHeader title="Top returners" icon={Trophy} subtitle={`Most cups returned ${periodPhrase(range)}.`} />
            <CardBody>
              {returners.length ? (
                <ol className="ov-leaders">
                  {returners.map((u, i) => (
                    <li key={u.id} className="ov-leaders__row">
                      <span className={`ov-leaders__rank${i < 3 ? ` ov-leaders__rank--${i + 1}` : ''}`}>{i + 1}</span>
                      <span className="ov-leaders__who">
                        <span className="ov-leaders__name">{u.name}</span>
                        {u.email && (
                          <span className="ov-leaders__email">
                            <PiiMask type="email" value={u.email} targetType="user" targetId={u.id} inline />
                          </span>
                        )}
                      </span>
                      <span className="ov-leaders__bar"><span style={{ width: `${Math.round((u.value / returners[0].value) * 100)}%` }} /></span>
                      <span className="ov-leaders__value">{fmtInt(u.value)}</span>
                    </li>
                  ))}
                </ol>
              ) : <EmptyState icon={Trophy} title="No returns in this period" />}
            </CardBody>
          </Card>
        )}

        {shown('feed-activity') && (
          <Card>
            <CardHeader title="Recent activity" icon={Activity} subtitle="The latest things customers did." />
            <CardBody>
              {stats?.recentActivity?.length ? (
                <ul className="ov-feed">
                  {stats.recentActivity.slice(0, 8).map(item => {
                    const meta = ACTIVITY[item.type] || { label: item.type, tone: 'slate' };
                    return (
                      <li key={item.id} className="ov-feed__row">
                        <span className={`ov-feed__dot ui-tone--${meta.tone}`} aria-hidden="true" />
                        <span className="ov-feed__label">{meta.label}</span>
                        <span className="ov-feed__time">{timeAgo(item.created_at)}</span>
                      </li>
                    );
                  })}
                </ul>
              ) : <EmptyState icon={Activity} title="Nothing yet" />}
            </CardBody>
          </Card>
        )}

        {shown('chart-locations') && (
          <LocationShare orgIds={scopeOrgIds} depKey={`${statsScope}:${activeOrg?.id || ''}:${reloadKey}`} />
        )}

        {shown('budget') && budget && (
          <Card className="ov-span-2">
            <CardHeader title="Reward budget" icon={Coins} subtitle="The most cashback this venue will commit to rewards." />
            <CardBody>
              <RewardBudgetMonitor
                cap={budget.cap}
                enabled={budget.enabled}
                spent={budget.spent}
                title="Committed so far"
                onManage={() => onNavigate?.('settings', { section: 'payouts' })}
              />
            </CardBody>
          </Card>
        )}
      </div>

      {!sections.some(s => shown(s.id)) && (
        <Card>
          <EmptyState icon={LayoutGrid} title="All sections are hidden">
            Use Customise at the top to bring them back.
          </EmptyState>
        </Card>
      )}
    </div>
  );
}

const LOC_PALETTE = ['#5B3FD6', '#0E9E74', '#E8930C', '#1F8FCE', '#E03E6B', '#0F8A7E', '#8B6CFF', '#E2552B'];

function LocationShare({ orgIds, depKey }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    getScansByLocation(orgIds)
      .then(d => { if (alive) setData(d); })
      .catch(() => { if (alive) setData(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depKey]);

  const rows = data?.locations || [];
  const total = data?.total || 0;
  const color = (r, i) => (r.locationId ? LOC_PALETTE[i % LOC_PALETTE.length] : '#D6D3E0');

  return (
    <Card className="ov-span-2">
      <CardHeader title="Cup scans by location" icon={MapPin} subtitle="Which counter QR code customers scanned. Cups collected at one location can be spent at any other." />
      <CardBody>
        {loading ? (
          <div className="ov-loc__bar ov-loc__bar--loading" />
        ) : !total ? (
          <EmptyState icon={MapPin} title="No scans with a location yet">
            Add your locations in Settings → Locations, then give each counter QR code one.
          </EmptyState>
        ) : (
          <>
            <div className="ov-loc__bar" role="img" aria-label="Cup scans split by location">
              {rows.map((r, i) => (
                <span key={r.locationId || 'none'} style={{ width: `${r.share}%`, background: color(r, i) }} title={`${r.label}: ${r.count} (${r.share}%)`} />
              ))}
            </div>
            <ul className="ov-legend ov-legend--grid">
              {rows.map((r, i) => (
                <li key={r.locationId || 'none'} className="ov-legend__row">
                  <span className="ov-legend__dot" style={{ background: color(r, i) }} />
                  <span className="ov-legend__name">{r.label}</span>
                  <span className="ov-legend__value">{fmtInt(r.count)}</span>
                  <span className="ov-legend__pct">{r.share}%</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardBody>
      {total > 0 && <CardFoot>{fmtInt(total)} counter scans in total.</CardFoot>}
    </Card>
  );
}
