import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive, ArchiveRestore, Building2, ChevronDown, Copy, CupSoda, ExternalLink, Gift, Globe2, ImageUp,
  Layers, MoreHorizontal, Plus, Search, Settings, Smartphone, WalletCards, X,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useOrg } from '../context/OrgContext';
import { OrgAvatar } from '../context/OrgSwitcher';
import {
  createOrgGroup, duplicateOrganization, listAllOrganizations, listOrgGroups, restoreOrganization,
  setOrgGroupMembership, setOrgGroupMode, setOrgMode, softDeleteOrganization, updateOrg, uploadRewardImage,
} from '../lib/adminApi';
import { ORG_MODE_META, resolveEffectiveMode } from '../lib/orgModes';
import { DEFAULT_REGIONS, regionForCountry } from '../../lib/regions';
import { logAction } from '../auth/actionLog';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Menu, MenuItem, MenuSeparator, Modal, Segmented, ToggleChip } from '../ui';
import TypedConfirmModal from '../shared/TypedConfirmModal';
import OrgGroupsPanel from '../organizations/OrgGroupsPanel';
import RegionsPanel from '../organizations/RegionsPanel';
import '../organizations/AdminOrganizations.css';

const MODE_GLYPH = { standard: Gift, byo: CupSoda, tikkie_only: WalletCards };
const EXPAND_KEY = 'pp-master:expand-org';

const PROFILE_FIELDS = [
  'name', 'slug', 'partner_brand_name', 'email_domain_hint', 'logo_url', 'logo_width', 'brand_color',
  'legal_name', 'kvk_number', 'btw_number', 'address', 'postal_code', 'city', 'country',
  'contact_email', 'contact_phone', 'website',
];

function readExpand() {
  try { return sessionStorage.getItem(EXPAND_KEY); } catch { return null; }
}
function writeExpand(id) {
  try { if (id) sessionStorage.setItem(EXPAND_KEY, id); else sessionStorage.removeItem(EXPAND_KEY); } catch { /* ignore */ }
}

/* Organisations: every venue, its profile and programme, plus the groups
 * that tie venues together and the regions they run in. */
export default function OrganisationsPanel({ onAddOrg, onNavigate, draftState, view, onView }) {
  const org = useOrg();
  const [orgs, setOrgs] = useState(null);
  const [groups, setGroups] = useState([]);
  const [modes, setModes] = useState({});
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [expanded, setExpanded] = useState(readExpand);
  const [archiving, setArchiving] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const fetchAll = useCallback(async () => {
    const [list, grps] = await Promise.all([listAllOrganizations(), listOrgGroups()]);
    const keys = list.map(o => `published:${o.id}`);
    const { data: cfg } = keys.length
      ? await supabase.from('app_config').select('key, mode:value->settings->>mode').in('key', keys)
      : { data: [] };
    const orgModes = Object.fromEntries((cfg || []).map(r => [r.key.replace('published:', ''), r.mode || null]));
    return { list, grps, orgModes };
  }, []);

  const load = useCallback(async () => {
    try {
      const { list, grps, orgModes } = await fetchAll();
      setOrgs(list);
      setGroups(grps);
      setModes(orgModes);
      setError(null);
    } catch (e) {
      setError(e?.message || 'Could not load organisations.');
      setOrgs([]);
    }
  }, [fetchAll]);

  useEffect(() => {
    let alive = true;
    fetchAll()
      .then(({ list, grps, orgModes }) => {
        if (!alive) return;
        setOrgs(list);
        setGroups(grps);
        setModes(orgModes);
      })
      .catch(e => { if (alive) { setError(e?.message || 'Could not load organisations.'); setOrgs([]); } });
    return () => { alive = false; };
  }, [fetchAll]);

  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  const groupById = useMemo(() => Object.fromEntries(groups.map(g => [g.id, g])), [groups]);
  const modeOf = (o) => resolveEffectiveMode(modes[o.id], o.group_id ? (groupById[o.group_id]?.mode || 'byo') : null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (orgs || [])
      .filter(o => showArchived || !o.deleted_at)
      .filter(o => !q || `${o.name} ${o.slug} ${o.partner_brand_name || ''}`.toLowerCase().includes(q))
      .sort((a, b) => Number(!!a.deleted_at) - Number(!!b.deleted_at) || a.name.localeCompare(b.name));
  }, [orgs, query, showArchived]);

  const liveCount = (orgs || []).filter(o => !o.deleted_at).length;
  const archivedCount = (orgs || []).length - liveCount;

  function toggleExpanded(id) {
    const next = expanded === id ? null : id;
    setExpanded(next);
    writeExpand(next);
  }

  async function afterChange(message) {
    await load();
    await org.refresh?.(org.activeOrgId);
    if (message) setNotice(message);
  }

  async function duplicate(o) {
    setBusyId(o.id);
    setError(null);
    try {
      const copy = await duplicateOrganization(o.id);
      await afterChange(`Created ${copy.name} (/${copy.slug}/). Settings and rewards were copied; customers, scans and claims start empty.`);
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

  return (
    <div className="ms-stack">
      <Segmented
        ariaLabel="Organisation settings"
        value={view}
        onChange={onView}
        options={[
          { id: 'organisations', label: 'Organisations', icon: Building2, count: liveCount },
          { id: 'groups', label: 'Groups', icon: Layers, count: groups.length },
          { id: 'regions', label: 'Regions', icon: Globe2 },
        ]}
      />

      {view === 'groups' && (
        <Card className="ms-legacy">
          <CardBody>
            {orgs === null ? <p className="ms-hint">Loading groups…</p> : <OrgGroupsPanel orgs={orgs} groups={groups} onChanged={() => afterChange()} />}
          </CardBody>
        </Card>
      )}

      {view === 'regions' && (
        <Card className="ms-legacy">
          <CardBody>
            {orgs === null ? <p className="ms-hint">Loading regions…</p> : <RegionsPanel orgs={orgs} onChanged={() => afterChange()} />}
          </CardBody>
        </Card>
      )}

      {view === 'organisations' && (
        <Card>
          <CardHeader
            title="Organisations"
            icon={Building2}
            ruled
            subtitle="Every venue: its profile, its programme, and whether it is live. Only masters can add or change them."
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
                {archivedCount > 0 && (
                  <ToggleChip pressed={showArchived} onClick={() => setShowArchived(v => !v)} icon={Archive}>
                    Archived ({archivedCount})
                  </ToggleChip>
                )}
                <Button icon={Smartphone} onClick={() => window.open('/mockup', '_blank', 'noopener')}>MockupMaster</Button>
                <Button variant="primary" icon={Plus} onClick={onAddOrg}>New organisation</Button>
              </>
            )}
          />
          <CardBody flush>
            {error && <p className="ms-error ms-pad" role="alert">{error}</p>}
            {notice && <p className="ms-ok ms-pad" role="status">{notice}</p>}
            {orgs === null ? (
              <p className="ms-hint ms-pad">Loading organisations…</p>
            ) : visible.length === 0 ? (
              <EmptyState icon={Building2} title={query ? 'No organisation matches' : 'No organisations yet'}
                action={!query && <Button variant="primary" icon={Plus} onClick={onAddOrg}>New organisation</Button>}>
                {query ? 'Try its name or URL.' : 'Create the first venue to get started.'}
              </EmptyState>
            ) : (
              <ul className="ms-orgs">
                {visible.map(o => {
                  const mode = modeOf(o);
                  const Glyph = MODE_GLYPH[mode] || Gift;
                  const group = o.group_id ? groupById[o.group_id] : null;
                  const region = regionForCountry(o.country);
                  const isActive = o.id === org.activeOrgId;
                  const archived = !!o.deleted_at;
                  const open = expanded === o.id && !archived;
                  return (
                    <li key={o.id} className={`ms-org${archived ? ' ms-org--archived' : ''}${open ? ' ms-org--open' : ''}`}>
                      <div className="ms-org__row">
                        <button type="button" className="ms-org__main" onClick={() => !archived && toggleExpanded(o.id)}
                          aria-expanded={open} disabled={archived}>
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
                          <span className="ms-org__chips">
                            <span className={`ms-mode-chip ms-mode-chip--${mode}`}><Glyph size={12} aria-hidden="true" />{ORG_MODE_META[mode]?.label}</span>
                            {group && <span className="ms-chip" title={`In the ${group.name} group`}><Layers size={11} aria-hidden="true" />{group.name}</span>}
                            <span className="ms-chip" title={region ? `${region.label} · ${region.currency}` : 'Set the country to pick a region'}>
                              <Globe2 size={11} aria-hidden="true" />
                              {region ? `${region.key} · ${region.currency}` : 'No region'}
                            </span>
                          </span>
                          {!archived && <ChevronDown className="ms-org__chev" size={16} aria-hidden="true" />}
                        </button>
                        <div className="ms-org__actions">
                          {archived ? (
                            <Button size="sm" icon={ArchiveRestore} disabled={busyId === o.id} onClick={() => restore(o)}>Restore</Button>
                          ) : (
                            <>
                              {isActive
                                ? <span className="ms-org__spacer" aria-hidden="true">Open</span>
                                : <Button size="sm" onClick={() => org.switchOrg(o.id)}>Open</Button>}
                              <Menu
                                trigger={({ toggle, open: menuOpen, id }) => (
                                  <Button variant="ghost" size="sm" icon={MoreHorizontal} aria-label={`${o.name} options`}
                                    aria-expanded={menuOpen} aria-controls={id} onClick={toggle} />
                                )}
                              >
                                <MenuItem icon={Settings} onClick={() => { if (!isActive) org.switchOrg(o.id); onNavigate?.('settings'); }}>
                                  Open its settings
                                </MenuItem>
                                <MenuItem icon={ExternalLink} onClick={() => window.open(`/${o.slug}/`, '_blank', 'noopener')}>
                                  Open the customer app
                                </MenuItem>
                                <MenuItem icon={Copy} disabled={busyId === o.id} onClick={() => duplicate(o)}>
                                  Duplicate
                                </MenuItem>
                                <MenuSeparator />
                                <MenuItem icon={Archive} danger disabled={liveCount <= 1} onClick={() => setArchiving(o)}>
                                  Archive
                                </MenuItem>
                              </Menu>
                            </>
                          )}
                        </div>
                      </div>
                      {open && (
                        <OrgEditor
                          key={o.updated_at || o.id}
                          org={o}
                          mode={mode}
                          group={group}
                          isActive={isActive}
                          onOpenOrg={() => { writeExpand(o.id); org.switchOrg(o.id); }}
                          onSaved={(msg) => afterChange(msg)}
                          draftState={draftState}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="ms-foot-note">
              Archiving hides a venue from the switcher and stops its customer app. Customers, claims and history
              are kept, and you can restore it.
            </p>
          </CardBody>
        </Card>
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
          The venue disappears from the switcher and its customer app stops opening at /{archiving?.slug}/.
          Customers, cups, claims and history stay in the database, and you can restore it at any time.
        </p>
      </Modal>
    </div>
  );
}

/* ── One organisation: profile and programme ─────────────────────────── */
function OrgEditor({ org: source, mode, group, isActive, onOpenOrg, onSaved, draftState }) {
  const ctx = useOrg();
  const [draft, setDraft] = useState(() => Object.fromEntries(PROFILE_FIELDS.map(k => [k, source[k] ?? ''])));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  const [modeTarget, setModeTarget] = useState(null);
  const [modeBusy, setModeBusy] = useState(false);

  const dirty = PROFILE_FIELDS.some(k => String(draft[k] ?? '') !== String(source[k] ?? ''));
  const set = (k) => (e) => setDraft(d => ({ ...d, [k]: e.target.value }));

  async function onLogo(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const url = await uploadRewardImage(file);
      if (!url) throw new Error('The logo could not be uploaded.');
      setDraft(d => ({ ...d, logo_url: url }));
    } catch (ex) {
      setError(ex?.message || 'The logo could not be uploaded.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function save() {
    if (!draft.name.trim()) { setError('The organisation needs a name.'); return; }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(draft.slug.trim())) { setError('The URL can use lowercase letters, numbers and dashes.'); return; }
    setSaving(true);
    setError(null);
    try {
      const clean = (v) => (typeof v === 'string' ? v.trim() || null : v ?? null);
      const patch = {
        name: draft.name.trim(),
        slug: draft.slug.trim(),
        partner_brand_name: clean(draft.partner_brand_name),
        email_domain_hint: clean(draft.email_domain_hint),
        logo_url: clean(draft.logo_url),
        logo_width: draft.logo_width === '' || draft.logo_width == null ? null : Number(draft.logo_width),
        brand_color: draft.brand_color || '#5B3FD6',
        legal_name: clean(draft.legal_name),
        kvk_number: clean(draft.kvk_number),
        btw_number: clean(draft.btw_number),
        address: clean(draft.address),
        postal_code: clean(draft.postal_code),
        city: clean(draft.city),
        country: clean(draft.country),
        contact_email: clean(draft.contact_email),
        contact_phone: clean(draft.contact_phone),
        website: clean(draft.website),
      };
      const updated = await updateOrg(source.id, patch);
      logAction({ action: 'org.update', targetType: 'organization', targetId: source.id, before: source, after: updated });
      await onSaved(`${updated.name} saved.`);
    } catch (e) {
      setError(/duplicate key|unique/i.test(e?.message || '') ? 'Another organisation already uses that URL.' : (e?.message || 'Could not save.'));
    } finally {
      setSaving(false);
    }
  }

  /* The programme model. tikkie_only is on the venue's own config; byo and
   * deposit belong to its group, so a grouped venue changes with its group. */
  async function changeMode(target) {
    if (!isActive || modeBusy) return;
    setModeBusy(true);
    setError(null);
    try {
      const orgId = source.id;
      const groupId = source.group_id || null;
      if (target === 'byo') {
        await setOrgMode(orgId, null);
        if (groupId) await setOrgGroupMode(groupId, 'byo');
        else {
          const grp = await createOrgGroup({ name: source.name || 'New group', mode: 'byo' });
          await setOrgGroupMembership(orgId, grp.id);
        }
      } else if (target === 'tikkie_only') {
        if (groupId) await setOrgGroupMembership(orgId, null);
        await setOrgMode(orgId, 'tikkie_only');
      } else {
        await setOrgMode(orgId, null);
        if (groupId) await setOrgGroupMode(groupId, 'deposit');
      }
      // Publish sends the whole draft, so the draft has to know the mode too.
      draftState?.updateDraft?.(d => {
        const settings = { ...d.settings };
        if (target === 'tikkie_only') settings.mode = 'tikkie_only'; else delete settings.mode;
        return { ...d, settings };
      });
      logAction({ action: 'org.mode', targetType: 'organization', targetId: orgId, before: { mode }, after: { mode: target } });
      try { window.dispatchEvent(new Event('pp-org-mode-changed')); } catch { /* ignore */ }
      await ctx.refresh?.(orgId);
      await onSaved(`${source.name} now runs ${ORG_MODE_META[target].label}.`);
    } catch (e) {
      setError(e?.message || 'Could not change the programme.');
    } finally {
      setModeBusy(false);
      setModeTarget(null);
    }
  }

  const region = regionForCountry(draft.country);
  const groupMembers = group?.members?.filter(m => !m.deleted_at) || [];

  return (
    <div className="ms-editor">
      <div className="ms-editor__grid">
        <section className="ms-editor__col" aria-label="Profile">
          <p className="ms-editor__heading">Profile</p>
          <div className="ms-logo">
            <OrgAvatar org={{ ...source, ...draft }} size={56} />
            <div className="ms-logo__controls">
              <div className="ms-logo__buttons">
                <Button size="sm" icon={ImageUp} disabled={uploading} onClick={() => fileRef.current?.click()}>
                  {uploading ? 'Uploading…' : draft.logo_url ? 'Replace logo' : 'Upload logo'}
                </Button>
                {draft.logo_url && <Button size="sm" variant="ghost" onClick={() => setDraft(d => ({ ...d, logo_url: '' }))}>Remove</Button>}
              </div>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={onLogo} />
              <label className="ms-logo__width">
                <span>Logo width in the app</span>
                <input type="range" min="40" max="200" step="2" value={draft.logo_width || 88}
                  onChange={e => setDraft(d => ({ ...d, logo_width: Number(e.target.value) }))} />
                <span className="ms-mono">{draft.logo_width ? `${draft.logo_width}px` : 'auto'}</span>
              </label>
            </div>
          </div>
          <div className="ms-fields">
            <Field label="Name" htmlFor={`o-name-${source.id}`}>
              <input id={`o-name-${source.id}`} className="ui-input" value={draft.name} onChange={set('name')} />
            </Field>
            <Field label="Customer app URL" htmlFor={`o-slug-${source.id}`} hint="Changing it breaks printed QR codes and saved links.">
              <div className="ms-prefix">
                <span className="ms-prefix__text">/</span>
                <input id={`o-slug-${source.id}`} className="ui-input" value={draft.slug} onChange={set('slug')} />
              </div>
            </Field>
            <Field label="Partner brand" htmlFor={`o-partner-${source.id}`}>
              <input id={`o-partner-${source.id}`} className="ui-input" value={draft.partner_brand_name} onChange={set('partner_brand_name')} />
            </Field>
            <Field label="Team email domain" htmlFor={`o-domain-${source.id}`} hint="Used to suggest the venue’s own staff.">
              <input id={`o-domain-${source.id}`} className="ui-input" value={draft.email_domain_hint} onChange={set('email_domain_hint')} placeholder="burgerking.nl" />
            </Field>
            <Field label="Brand colour" htmlFor={`o-color-${source.id}`}>
              <div className="ms-color">
                <input id={`o-color-${source.id}`} type="color" value={draft.brand_color || '#5B3FD6'} onChange={set('brand_color')} />
                <span className="ms-mono">{draft.brand_color || '—'}</span>
              </div>
            </Field>
          </div>
        </section>

        <section className="ms-editor__col" aria-label="Legal and contact">
          <p className="ms-editor__heading">Legal and contact</p>
          <div className="ms-fields">
            <Field label="Legal name" htmlFor={`o-legal-${source.id}`}>
              <input id={`o-legal-${source.id}`} className="ui-input" value={draft.legal_name} onChange={set('legal_name')} />
            </Field>
            <Field label="Region" htmlFor={`o-region-${source.id}`} hint="Sets the currency, payout provider and policy.">
              <select id={`o-region-${source.id}`} className="ui-select" value={region?.key || ''}
                onChange={e => { const r = DEFAULT_REGIONS[e.target.value]; setDraft(d => ({ ...d, country: r ? r.label : d.country })); }}>
                <option value="" disabled>Pick a region</option>
                {Object.values(DEFAULT_REGIONS).map(r => <option key={r.key} value={r.key}>{r.label} · {r.currency}</option>)}
              </select>
            </Field>
            <Field label="KvK" htmlFor={`o-kvk-${source.id}`}>
              <input id={`o-kvk-${source.id}`} className="ui-input" value={draft.kvk_number} onChange={set('kvk_number')} />
            </Field>
            <Field label="BTW" htmlFor={`o-btw-${source.id}`}>
              <input id={`o-btw-${source.id}`} className="ui-input" value={draft.btw_number} onChange={set('btw_number')} />
            </Field>
            <Field label="Street and number" htmlFor={`o-address-${source.id}`}>
              <input id={`o-address-${source.id}`} className="ui-input" value={draft.address} onChange={set('address')} />
            </Field>
            <Field label="Postal code" htmlFor={`o-postal-${source.id}`}>
              <input id={`o-postal-${source.id}`} className="ui-input" value={draft.postal_code} onChange={set('postal_code')} />
            </Field>
            <Field label="City" htmlFor={`o-city-${source.id}`}>
              <input id={`o-city-${source.id}`} className="ui-input" value={draft.city} onChange={set('city')} />
            </Field>
            <Field label="Contact email" htmlFor={`o-email-${source.id}`}>
              <input id={`o-email-${source.id}`} type="email" className="ui-input" value={draft.contact_email} onChange={set('contact_email')} />
            </Field>
            <Field label="Contact phone" htmlFor={`o-phone-${source.id}`}>
              <input id={`o-phone-${source.id}`} className="ui-input" value={draft.contact_phone} onChange={set('contact_phone')} />
            </Field>
            <Field label="Website" htmlFor={`o-web-${source.id}`}>
              <input id={`o-web-${source.id}`} className="ui-input" value={draft.website} onChange={set('website')} placeholder="https://" />
            </Field>
          </div>
        </section>
      </div>

      <div className="ms-editor__save">
        {error && <span className="ms-error" role="alert">{error}</span>}
        <Button variant="outline" disabled={!dirty || saving}
          onClick={() => setDraft(Object.fromEntries(PROFILE_FIELDS.map(k => [k, source[k] ?? ''])))}>
          Undo changes
        </Button>
        <Button variant="primary" disabled={!dirty || saving} onClick={save}>{saving ? 'Saving…' : 'Save profile'}</Button>
      </div>

      <section className="ms-programme" aria-label="Programme">
        <div className="ms-programme__head">
          <p className="ms-editor__heading">Programme</p>
          {!isActive && (
            <span className="ms-hint">
              Open this organisation to change its programme: its draft has to change with it.
              <Button size="sm" variant="ghost" onClick={onOpenOrg}>Open it</Button>
            </span>
          )}
        </div>
        <div className="ms-modes" role="radiogroup" aria-label="Programme">
          {['standard', 'byo', 'tikkie_only'].map(m => {
            const Glyph = MODE_GLYPH[m];
            const on = mode === m;
            return (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={on}
                className={`ms-mode${on ? ' ms-mode--on' : ''}`}
                disabled={!isActive || modeBusy}
                onClick={() => { if (!on) setModeTarget(m); }}
              >
                <span className={`ms-mode__glyph ms-mode__glyph--${m}`} aria-hidden="true"><Glyph size={17} /></span>
                <span className="ms-mode__label">{ORG_MODE_META[m].label}</span>
                <span className="ms-mode__blurb">{MODE_BLURB[m]}</span>
                {on && <span className="ms-mode__tag">Now</span>}
              </button>
            );
          })}
        </div>
        {group && (
          <p className="ms-note">
            In the <b>{group.name}</b> group{groupMembers.length > 1 ? ` with ${groupMembers.length - 1} other venue${groupMembers.length === 2 ? '' : 's'}` : ''}.
            Deposit Rewards and Bring Your Own belong to the group, so switching between them changes every venue in it.
            Deferred Tikkie takes this venue out of the group.
          </p>
        )}
      </section>

      {modeTarget && (
        <TypedConfirmModal
          title={`Switch ${source.name} to ${ORG_MODE_META[modeTarget].label}?`}
          intro="The programme decides what customers see and which dashboard tabs exist. Nothing is deleted, but the customer app changes straight away."
          word="switch"
          confirmLabel={`Switch to ${ORG_MODE_META[modeTarget].label}`}
          busy={modeBusy}
          onCancel={() => setModeTarget(null)}
          onConfirm={() => changeMode(modeTarget)}
        >
          <ul className="tcm-list">
            <li>Cups, balances, claims and payouts are <strong>kept</strong>.</li>
            {group && modeTarget !== 'tikkie_only' && (
              <li className="tcm-bad">This changes the whole <strong>{group.name}</strong> group{groupMembers.length > 1 ? `, ${groupMembers.length} venues` : ''}.</li>
            )}
            {modeTarget === 'byo' && !group && (
              <li className="tcm-bad">Bring Your Own needs a group, so this venue is <strong>put into a new group of its own</strong>.</li>
            )}
            {modeTarget === 'tikkie_only' && (
              <li className="tcm-bad">The customer app stops showing rewards: bin receipts go to the Tikkie wallet.{group ? ' The venue leaves its group.' : ''}</li>
            )}
            {mode === 'tikkie_only' && (
              <li className="tcm-bad">Bin receipts stop paying out through Tikkie, <strong>including receipts already printed</strong>.</li>
            )}
            {mode === 'byo' && (
              <li className="tcm-bad">Counter QR codes stop giving cups: <strong>printed counter QRs stop working</strong>.</li>
            )}
          </ul>
        </TypedConfirmModal>
      )}
    </div>
  );
}

const MODE_BLURB = {
  standard: 'Cup balance, rewards, direct refunds and receipt claims.',
  byo: 'Customers bring their own cup and scan the counter QR.',
  tikkie_only: 'Bin receipts fill a wallet, paid out as one Tikkie link.',
};
