import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive, ArchiveRestore, Building2, Copy, ExternalLink, Globe2, Layers, MoreHorizontal, Pencil, Plus,
  Search, Settings, X,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useOrg } from '../context/OrgContext';
import { OrgAvatar } from '../context/OrgSwitcher';
import {
  duplicateOrganization, getRegionsConfig, listAllOrganizations, listOrgGroups, restoreOrganization, softDeleteOrganization,
} from '../lib/adminApi';
import { resolveEffectiveMode } from '../lib/orgModes';
import { getAllRegions, regionForCountry, setRegions } from '../../lib/regions';
import { logAction } from '../auth/actionLog';
import {
  Badge, Button, Card, CardBody, CardHeader, EmptyState, Menu, MenuItem, MenuSeparator, Modal, Segmented, ToggleChip,
} from '../ui';
import OrgEditor from './OrgEditor';
import GroupsPanel from './GroupsPanel';
import RegionsPanel from './RegionsPanel';
import { ModeChip } from './OrgBits';
import { clearReopen, modeLabel, peekReopen } from './orgShared';

/* Organisations: every venue, the groups that tie venues together, and the
 * regions they run in. Each list opens its editor in a side drawer. */
export default function OrganisationsPanel({ onAddOrg, onNavigate, draftState, view, onView }) {
  const org = useOrg();
  const [orgs, setOrgs] = useState(null);
  const [groups, setGroups] = useState([]);
  const [modes, setModes] = useState({});
  const [regionsCfg, setRegionsCfg] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [editing, setEditing] = useState(peekReopen);   // { id, tab }
  const [archiving, setArchiving] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const fetchAll = useCallback(async () => {
    const [list, grps, regs] = await Promise.all([
      listAllOrganizations(),
      listOrgGroups(),
      getRegionsConfig().catch(() => ({})),
    ]);
    const keys = list.map(o => `published:${o.id}`);
    const { data: cfg } = keys.length
      ? await supabase.from('app_config').select('key, mode:value->settings->>mode').in('key', keys)
      : { data: [] };
    const orgModes = Object.fromEntries((cfg || []).map(r => [r.key.replace('published:', ''), r.mode || null]));
    // Admin-added regions live in app_config; the registry only knows the seed until this runs.
    setRegions(regs || {});
    return { list, grps, orgModes, regs: regs || {} };
  }, []);

  const apply = useCallback(({ list, grps, orgModes, regs }) => {
    setOrgs(list);
    setGroups(grps);
    setModes(orgModes);
    setRegionsCfg(regs);
  }, []);

  const load = useCallback(async () => {
    try {
      apply(await fetchAll());
      setError(null);
    } catch (e) {
      setError(e?.message || 'Could not load organisations.');
      setOrgs(o => o || []);
    }
  }, [fetchAll, apply]);

  useEffect(() => {
    let alive = true;
    fetchAll()
      .then(res => { if (alive) apply(res); })
      .catch(e => { if (alive) { setError(e?.message || 'Could not load organisations.'); setOrgs([]); } });
    return () => { alive = false; };
  }, [fetchAll, apply]);

  useEffect(() => { clearReopen(); }, []);

  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  const groupById = useMemo(() => Object.fromEntries(groups.map(g => [g.id, g])), [groups]);
  const modeOf = useCallback(
    (o) => resolveEffectiveMode(modes[o.id], o.group_id ? (groupById[o.group_id]?.mode || 'byo') : null),
    [modes, groupById],
  );
  const liveCount = (orgs || []).filter(o => !o.deleted_at).length;

  async function afterChange(message) {
    await load();
    await org.refresh?.(org.activeOrgId);
    if (message) setNotice(message);
  }

  /* The dashboard remounts on an organisation switch; keep this tab open. */
  const pinSection = () => onNavigate?.('master', { section: view || 'organisations' });

  function openOrg(o) {
    pinSection();
    org.switchOrg(o.id);
  }

  async function duplicate(o) {
    setBusyId(o.id);
    setError(null);
    try {
      const copy = await duplicateOrganization(o.id);
      setEditing(null);
      await afterChange(`Created ${copy.name} at /${copy.slug}/. Settings and rewards were copied; customers, scans and claims start empty.`);
    } catch (e) {
      setError(e?.message || 'Could not duplicate the organisation.');
    } finally {
      setBusyId(null);
    }
  }

  async function archive() {
    const o = archiving;
    setBusyId(o.id);
    try {
      await softDeleteOrganization(o.id);
      logAction({ action: 'org.archive', targetType: 'organization', targetId: o.id, metadata: { name: o.name } });
      setArchiving(null);
      setEditing(null);
      await afterChange(`${o.name} is archived. Its data is kept and you can restore it.`);
    } catch (e) {
      setError(e?.message || 'Could not archive the organisation.');
      setArchiving(null);
    } finally {
      setBusyId(null);
    }
  }

  async function restore(o) {
    setBusyId(o.id);
    try {
      await restoreOrganization(o.id);
      logAction({ action: 'org.restore', targetType: 'organization', targetId: o.id, metadata: { name: o.name } });
      await afterChange(`${o.name} is live again.`);
    } catch (e) {
      setError(e?.message || 'Could not restore the organisation.');
    } finally {
      setBusyId(null);
    }
  }

  const editOrg = editing && (orgs || []).find(o => o.id === editing.id && !o.deleted_at);
  const regionCount = regionsCfg ? getAllRegions().length : null;

  return (
    <div className="ms-stack">
      <Segmented
        ariaLabel="Organisation settings"
        value={view}
        onChange={onView}
        options={[
          { id: 'organisations', label: 'Organisations', icon: Building2, count: orgs ? liveCount : undefined },
          { id: 'groups', label: 'Groups', icon: Layers, count: orgs ? groups.length : undefined },
          { id: 'regions', label: 'Regions', icon: Globe2, count: regionCount ?? undefined },
        ]}
      />

      {error && <p className="ms-error" role="alert">{error}</p>}
      {notice && <p className="ms-ok" role="status">{notice}</p>}

      {view === 'organisations' && (
        <OrgList
          orgs={orgs}
          groupById={groupById}
          modeOf={modeOf}
          activeOrgId={org.activeOrgId}
          busyId={busyId}
          liveCount={liveCount}
          onAddOrg={onAddOrg}
          onEdit={(o, tab) => setEditing({ id: o.id, tab })}
          onOpen={openOrg}
          onSettings={(o) => { if (o.id !== org.activeOrgId) org.switchOrg(o.id); onNavigate?.('settings'); }}
          onDuplicate={duplicate}
          onArchive={setArchiving}
          onRestore={restore}
        />
      )}

      {view === 'groups' && (
        <GroupsPanel
          orgs={orgs}
          groups={groups}
          modes={modes}
          onChanged={afterChange}
          onEditOrg={(id) => setEditing({ id, tab: 'profile' })}
        />
      )}

      {view === 'regions' && (
        <RegionsPanel
          orgs={orgs}
          cfg={regionsCfg}
          onSaved={async (next, message) => { setRegions(next); setRegionsCfg(next); await afterChange(message); }}
          onEditOrg={(id) => setEditing({ id, tab: 'profile' })}
        />
      )}

      {editOrg && (
        <OrgEditor
          key={editOrg.id}
          org={editOrg}
          mode={modeOf(editOrg)}
          group={editOrg.group_id ? groupById[editOrg.group_id] : null}
          isActive={editOrg.id === org.activeOrgId}
          liveCount={liveCount}
          initialTab={editing.tab || 'profile'}
          busy={busyId === editOrg.id}
          draftState={draftState}
          onClose={() => setEditing(null)}
          onSaved={afterChange}
          onDuplicate={() => duplicate(editOrg)}
          onArchive={() => setArchiving(editOrg)}
          onNavigate={onNavigate}
          pinSection={pinSection}
        />
      )}

      <Modal
        open={!!archiving}
        onClose={() => setArchiving(null)}
        title={`Archive ${archiving?.name || 'this organisation'}?`}
        subtitle="Nothing is deleted."
        icon={Archive}
        iconTone="rose"
        footer={(
          <>
            <Button variant="outline" onClick={() => setArchiving(null)}>Cancel</Button>
            <Button variant="danger" onClick={archive} disabled={busyId === archiving?.id}>Archive</Button>
          </>
        )}
      >
        <p className="ms-modal-text">
          The venue leaves the switcher and its customer app stops opening at /{archiving?.slug}/.
          Customers, cups, claims and history stay in the database, and you can restore it at any time.
        </p>
      </Modal>
    </div>
  );
}

/* ── The list ─────────────────────────────────────────────────────── */
function OrgList({
  orgs, groupById, modeOf, activeOrgId, busyId, liveCount,
  onAddOrg, onEdit, onOpen, onSettings, onDuplicate, onArchive, onRestore,
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [showArchived, setShowArchived] = useState(false);

  const live = useMemo(() => (orgs || []).filter(o => !o.deleted_at), [orgs]);
  const archivedCount = (orgs || []).length - live.length;
  const counts = useMemo(() => {
    const c = { all: live.length, standard: 0, byo: 0, tikkie_only: 0 };
    live.forEach(o => { c[modeOf(o)] += 1; });
    return c;
  }, [live, modeOf]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (orgs || [])
      .filter(o => (showArchived ? true : !o.deleted_at))
      .filter(o => filter === 'all' || o.deleted_at || modeOf(o) === filter)
      .filter(o => !q || `${o.name} ${o.slug} ${o.partner_brand_name || ''}`.toLowerCase().includes(q))
      .sort((a, b) => Number(!!a.deleted_at) - Number(!!b.deleted_at) || a.name.localeCompare(b.name));
  }, [orgs, query, filter, showArchived, modeOf]);

  return (
    <Card>
      <CardHeader
        title="Organisations"
        icon={Building2}
        ruled
        subtitle="Every venue: its profile, its programme and whether it is live. Only masters can add or change them."
        actions={(
          <>
            <span className="ms-search ms-search--card">
              <Search size={14} aria-hidden="true" />
              <input className="ms-search__input" placeholder="Search organisations" value={query}
                onChange={e => setQuery(e.target.value)} aria-label="Search organisations" />
              {query && (
                <button type="button" className="ms-search__clear" aria-label="Clear search" onClick={() => setQuery('')}>
                  <X size={13} />
                </button>
              )}
            </span>
            <Button variant="primary" icon={Plus} onClick={onAddOrg}>New organisation</Button>
          </>
        )}
      >
        <div className="ms-filters ms-filters--row">
          <Segmented
            ariaLabel="Filter by programme"
            value={filter}
            onChange={setFilter}
            options={[
              { id: 'all', label: 'All', count: counts.all },
              { id: 'standard', label: modeLabel('standard'), count: counts.standard },
              { id: 'byo', label: modeLabel('byo'), count: counts.byo },
              { id: 'tikkie_only', label: modeLabel('tikkie_only'), count: counts.tikkie_only },
            ]}
          />
          {archivedCount > 0 && (
            <ToggleChip pressed={showArchived} onClick={() => setShowArchived(v => !v)} icon={Archive}>
              Show archived ({archivedCount})
            </ToggleChip>
          )}
        </div>
      </CardHeader>
      <CardBody flush>
        {orgs === null ? (
          <p className="ms-hint ms-pad ms-pad--b">Loading organisations…</p>
        ) : visible.length === 0 ? (
          <EmptyState icon={Building2} title={query || filter !== 'all' ? 'No organisation matches' : 'No organisations yet'}
            action={!query && filter === 'all' && <Button variant="primary" icon={Plus} onClick={onAddOrg}>New organisation</Button>}>
            {query || filter !== 'all' ? 'Try another name, address or programme.' : 'Create the first venue to get started.'}
          </EmptyState>
        ) : (
          <ul className="ms-orgs">
            <li className="ms-org ms-org--head" aria-hidden="true">
              <span>Organisation</span>
              <span className="ms-org__cells"><span>Programme</span><span>Group</span><span>Region</span></span>
              <span />
            </li>
            {visible.map(o => {
              const mode = modeOf(o);
              const group = o.group_id ? groupById[o.group_id] : null;
              const region = regionForCountry(o.country);
              const isActive = o.id === activeOrgId;
              const archived = !!o.deleted_at;
              return (
                <li key={o.id} className={`ms-org${archived ? ' ms-org--archived' : ''}`}>
                  <button type="button" className="ms-org__main" onClick={() => !archived && onEdit(o)} disabled={archived}
                    aria-label={archived ? undefined : `Edit ${o.name}`}>
                    <OrgAvatar org={o} size={40} />
                    <span className="ms-org__text">
                      <span className="ms-org__name">
                        {o.name}
                        {isActive && <Badge tone="primary">Open now</Badge>}
                        {archived && <Badge tone="neutral">Archived</Badge>}
                      </span>
                      <span className="ms-org__meta">
                        <span className="ms-mono">/{o.slug}/</span>
                        {o.partner_brand_name && o.partner_brand_name !== o.name && <span>· {o.partner_brand_name}</span>}
                      </span>
                    </span>
                  </button>
                  <span className="ms-org__cells">
                    <span className="ms-org__cell"><ModeChip mode={mode} /></span>
                    <span className="ms-org__cell">
                      {group
                        ? <span className="ms-chip" title={`In the ${group.name} group`}><Layers size={11} aria-hidden="true" />{group.name}</span>
                        : <span className="ms-dim">No group</span>}
                    </span>
                    <span className="ms-org__cell">
                      {region
                        ? <span className="ms-chip" title={`${region.label} · ${region.currency}`}><Globe2 size={11} aria-hidden="true" />{region.key} · {region.currency}</span>
                        : <span className="ms-chip ms-chip--warn" title={o.country ? `“${o.country}” matches no region` : 'No country set'}>No region</span>}
                    </span>
                  </span>
                  <span className="ms-org__actions">
                    {archived ? (
                      <Button size="sm" icon={ArchiveRestore} disabled={busyId === o.id} onClick={() => onRestore(o)}>Restore</Button>
                    ) : (
                      <>
                        <Button size="sm" icon={Pencil} onClick={() => onEdit(o)}>Edit</Button>
                        <Menu
                          trigger={({ toggle, open, id }) => (
                            <Button variant="ghost" size="sm" icon={MoreHorizontal} aria-label={`More for ${o.name}`}
                              aria-expanded={open} aria-controls={id} onClick={toggle} />
                          )}
                        >
                          {!isActive && <MenuItem icon={Building2} onClick={() => onOpen(o)}>Open in the dashboard</MenuItem>}
                          <MenuItem icon={Settings} onClick={() => onSettings(o)}>Open its settings</MenuItem>
                          <MenuItem icon={ExternalLink} onClick={() => window.open(`/${o.slug}/`, '_blank', 'noopener')}>Open the customer app</MenuItem>
                          <MenuItem icon={Copy} disabled={busyId === o.id} onClick={() => onDuplicate(o)}>Duplicate</MenuItem>
                          <MenuSeparator />
                          <MenuItem icon={Archive} danger disabled={liveCount <= 1} onClick={() => onArchive(o)}>Archive</MenuItem>
                        </Menu>
                      </>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <p className="ms-foot-note">
          Archiving hides a venue from the switcher and closes its customer app. Customers, claims and history
          are kept, and you can restore it.
        </p>
      </CardBody>
    </Card>
  );
}
