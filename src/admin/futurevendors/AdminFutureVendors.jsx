import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle, Eye, EyeOff, Globe2, Hand, Inbox, MapPinOff, Minus, Pencil, Plus, Search, Settings2, Store, Trash2, Trophy, X,
} from 'lucide-react';
import { useOrg } from '../context/OrgContext';
import {
  listOrgGroups,
  setGroupNotYetStores,
  saveNotYetThreshold,
  saveNotYetVendors,
  getFutureVendorStats,
  getStoreRequests,
  deleteStoreRequest,
} from '../lib/adminApi';
import { getNotYetStores } from '../../lib/notYetStores';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, KpiTile, Modal, PageHeader, Segmented, Switch } from '../ui';
import './AdminFutureVendors.css';

/* ─────────────────────────────────────────────────────────────────────
 * AdminFutureVendors — manage a group's "coming soon" venues.
 *
 * Future vendors are nearby places that aren't on PackPerks yet. They show
 * as locked cards + map pins on the customer Stores page, where customers
 * tap "Request it" to signal demand. Everything is stored on the group
 * config, so it is shared across every store in the group.
 * ───────────────────────────────────────────────────────────────────── */

function groupRegion(group) {
  return /uae|dubai|emirat|abu\s*dhabi/i.test(`${group?.slug || ''} ${group?.name || ''}`) ? 'UAE' : 'NL';
}
function cityFromArea(area) {
  const parts = String(area || '').split(',').map(s => s.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}
function fmtWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return d.toLocaleDateString();
}
const BLANK = { name: '', area: '', lat: '', lng: '', color: '#E4572E', logo_url: '' };

export default function AdminFutureVendors() {
  const { activeGroup } = useOrg();
  const [groups, setGroups] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = async () => {
    try { setGroups(await listOrgGroups() || []); }
    catch (e) { setError(e.message || 'Failed to load groups.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (selectedId && groups.some(g => g.id === selectedId)) return;
    setSelectedId(activeGroup?.id || groups[0]?.id || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, activeGroup]);

  const group = groups.find(g => g.id === selectedId) || null;

  async function run(fn) {
    setBusy(true); setError(null);
    try { await fn(); await load(); }
    catch (e) { setError(e.message || 'Something went wrong.'); }
    finally { setBusy(false); }
  }

  return (
    <div className="ui-page afv">
      <PageHeader
        title="Future vendors"
        subtitle="Nearby places that aren’t on PackPerks yet. Customers see them as locked “coming soon” cards and map pins on the Stores page, and tap “Request it” to ask for them."
      >
        {group && (
          <>
            {groups.length > 1 && (
              <label className="afv__groupsel">
                <span>Group</span>
                <select className="ui-select" value={selectedId || ''} onChange={e => setSelectedId(e.target.value)}>
                  {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </label>
            )}
            <Badge tone="neutral" icon={Globe2}>
              {groupRegion(group) === 'UAE' ? 'United Arab Emirates' : 'Netherlands'}
            </Badge>
          </>
        )}
      </PageHeader>

      {error && (
        <p className="afv__error" role="alert">
          <AlertCircle size={15} aria-hidden="true" />{error}
        </p>
      )}

      {loading ? (
        <p className="afv__muted">Loading…</p>
      ) : groups.length === 0 ? (
        <Card>
          <EmptyState icon={Store} title="No groups yet">
            Future vendors belong to a group of venues. A master can create one in Master Settings → Organisations → Groups.
          </EmptyState>
        </Card>
      ) : !group ? (
        <p className="afv__muted">Select a group to manage its future vendors.</p>
      ) : (
        <Manager
          key={group.id}
          group={group}
          busy={busy}
          showNotYet={group.config?.settings?.showNotYetStores !== false}
          threshold={Math.max(1, Number(group.config?.settings?.notYetThreshold) || 10)}
          onToggle={(on) => run(() => setGroupNotYetStores(group.id, on))}
          onThreshold={(n) => run(() => saveNotYetThreshold(group.id, n))}
          onSaveVendors={(v) => run(() => saveNotYetVendors(group.id, v))}
        />
      )}
    </div>
  );
}

function Manager({ group, busy, showNotYet, threshold, onToggle, onThreshold, onSaveVendors }) {
  const region = groupRegion(group);
  const seed = () => {
    const saved = group?.config?.settings?.notYetVendors;
    return ((Array.isArray(saved) && saved.length) ? saved : getNotYetStores(region)).map((v, i) => ({ ...v, _k: `s${i}` }));
  };
  const [rows, setRows] = useState(seed);
  const [stats, setStats] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState(null);   // row (edit) or BLANK (add)
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('requests');    // 'requests' | 'az'

  const [requests, setRequests] = useState(null);
  const [removing, setRemoving] = useState(null);

  useEffect(() => { getFutureVendorStats(region).then(setStats).catch(() => setStats({})); }, [region]);
  useEffect(() => { getStoreRequests(region).then(setRequests).catch(() => setRequests([])); }, [region]);

  const removeRequest = async (name) => {
    setRemoving(name.toLowerCase());
    try {
      await deleteStoreRequest(name);
      setRequests(rs => (rs || []).filter(r => r.name.toLowerCase() !== name.toLowerCase()));
    } catch { /* leave the row so the admin can retry */ }
    finally { setRemoving(null); }
  };

  const reqOf = (name) => (stats && stats[name]) || 0;
  const totalReq = stats ? Object.values(stats).reduce((a, b) => a + b, 0) : 0;
  const top = stats && Object.keys(stats).length ? Object.entries(stats).sort((a, b) => b[1] - a[1])[0] : null;

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows
      .filter(r => !needle || `${r.name || ''} ${r.area || ''}`.toLowerCase().includes(needle))
      .sort((a, b) => sort === 'az'
        ? (a.name || '').localeCompare(b.name || '')
        : (reqOf(b.name) - reqOf(a.name)) || (a.name || '').localeCompare(b.name || ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, sort, stats]);

  const saveVendor = (data) => {
    setRows(rs => editing?._k
      ? rs.map(r => (r._k === editing._k ? { ...r, ...data } : r))
      : [...rs, { ...data, _k: `n${Date.now()}` }]);
    setDirty(true); setEditing(null);
  };
  const removeVendor = (k) => { setRows(rs => rs.filter(r => r._k !== k)); setDirty(true); };
  const saveAll = () => {
    onSaveVendors(rows.map(({ _k, ...v }) => ({
      name: v.name, area: v.area || '', lat: v.lat ?? null, lng: v.lng ?? null,
      color: v.color || '', logo_url: v.logo_url || '',
    })));
    setDirty(false);
  };
  const discard = () => { setRows(seed()); setDirty(false); };

  const kpis = [
    { id: 'vendors', label: 'Vendors', icon: Store, tone: 'violet', value: rows.length, description: 'Coming-soon venues on the list' },
    { id: 'requests', label: 'Requests', icon: Hand, tone: 'sky', value: stats == null ? '—' : totalReq, description: '“Request it” taps from customers' },
    { id: 'top', label: 'Most requested', icon: Trophy, tone: 'amber', value: top ? top[0] : '—', description: top ? `${top[1]} request${top[1] === 1 ? '' : 's'}` : 'No requests yet' },
    {
      id: 'status',
      label: 'On the Stores page',
      icon: showNotYet ? Eye : EyeOff,
      tone: showNotYet ? 'emerald' : 'slate',
      value: showNotYet ? 'Showing' : 'Hidden',
      description: showNotYet ? 'Customers see these venues' : 'Customers see live stores only',
    },
  ];

  return (
    <div className="afv__body">
      {/* ── At-a-glance ── */}
      <div className="ui-kpis afv__kpis">
        {kpis.map((m, i) => <KpiTile key={m.id} metric={m} index={i} interactive={false} />)}
      </div>

      {/* ── Settings ── */}
      <Card>
        <CardHeader title="Settings" icon={Settings2} subtitle={`For every venue in ${group.name}.`} ruled />
        <CardBody>
          <div className="afv__setting">
            <div className="afv__setting-txt">
              <label className="afv__setting-title" htmlFor="afv-show">Show coming-soon venues</label>
              <span>Locked cards and map pins on the customer Stores page. When off, customers see only live stores.</span>
            </div>
            <Switch
              id="afv-show"
              checked={showNotYet}
              onChange={next => onToggle(next)}
              disabled={busy}
              label="Show coming-soon venues"
            />
          </div>
          <div className="afv__setting">
            <div className="afv__setting-txt">
              <span className="afv__setting-title" id="afv-goal-label">Request goal</span>
              <span>How many “Request it” taps a venue needs before its card reads “Coming soon”. Each card shows its progress.</span>
            </div>
            <ThresholdInput value={threshold} busy={busy} onSave={onThreshold} />
          </div>
        </CardBody>
      </Card>

      {/* ── Vendors ── */}
      <Card>
        <CardHeader
          title={<>Vendors <span className="afv__count">{rows.length}</span></>}
          icon={Store}
          ruled
          actions={(
            <>
              <span className="afv__search">
                <Search size={14} aria-hidden="true" />
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search vendors" aria-label="Search vendors" />
                {q && (
                  <button type="button" className="afv__search-clear" aria-label="Clear search" onClick={() => setQ('')}>
                    <X size={12} />
                  </button>
                )}
              </span>
              <Segmented
                ariaLabel="Sort vendors"
                value={sort}
                onChange={setSort}
                options={[{ id: 'requests', label: 'Most wanted' }, { id: 'az', label: 'A–Z' }]}
              />
              <Button variant="primary" icon={Plus} onClick={() => setEditing({ ...BLANK })} disabled={busy}>
                Add vendor
              </Button>
            </>
          )}
        />

        <CardBody flush>
          {visible.length === 0 ? (
            <EmptyState icon={q ? Search : Store} title={q ? 'No matches' : 'No vendors yet'}>
              {q ? 'No vendors match your search.' : 'Add one to get started.'}
            </EmptyState>
          ) : (
            <ul className="afv__vlist">
              {visible.map(r => {
                const n = reqOf(r.name);
                const pct = Math.min(100, Math.round((n / threshold) * 100));
                const reached = n >= threshold;
                const hasPin = r.lat != null && r.lng != null;
                return (
                  <li key={r._k} className="afv__vrow">
                    <span className="afv__vlogo" style={{ background: r.color || '#B0A897' }}>
                      {r.logo_url
                        ? <img src={r.logo_url} alt="" onError={e => { e.currentTarget.style.display = 'none'; }} />
                        : (r.name || 'S').charAt(0).toUpperCase()}
                    </span>
                    <div className="afv__vinfo">
                      <span className="afv__vname">{r.name || 'Untitled venue'}</span>
                      <span className="afv__vmeta">
                        {cityFromArea(r.area) || r.area || 'No area'}
                        {!hasPin && (
                          <span className="afv__vwarn" title="No coordinates — this venue won’t show on the map">
                            <MapPinOff size={12} aria-hidden="true" /> no map pin
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="afv__vprog" title={`${n} of ${threshold} requests`}>
                      <div className="ui-bar afv__vbar">
                        <span
                          className={`ui-bar__fill${reached ? ' afv__vbar--reached' : ''}`}
                          style={{ display: 'block', width: `${Math.max(reached ? 100 : n ? 6 : 0, pct)}%` }}
                        />
                      </div>
                      <span className={`afv__vcount${reached ? ' afv__vcount--soon' : ''}`}>{reached ? 'Coming soon' : `${n} of ${threshold}`}</span>
                    </div>
                    <div className="afv__vactions">
                      <Button variant="ghost" size="sm" icon={Pencil} onClick={() => setEditing(r)} disabled={busy} title="Edit vendor" aria-label={`Edit ${r.name || 'vendor'}`} />
                      <Button variant="danger-ghost" size="sm" icon={Trash2} onClick={() => removeVendor(r._k)} disabled={busy} title="Remove vendor" aria-label={`Remove ${r.name || 'vendor'}`} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      {/* ── Customer requests — free-text "Haven't found your store?" intake ── */}
      <Card>
        <CardHeader
          title={<>Customer requests {requests?.length ? <span className="afv__count">{requests.length}</span> : null}</>}
          icon={Inbox}
          subtitle="Stores customers typed in themselves on the market page that aren’t on your list yet."
          ruled
        />
        <CardBody flush>
          {requests == null ? (
            <p className="afv__muted afv__pad">Loading…</p>
          ) : requests.length === 0 ? (
            <EmptyState icon={Inbox} title="No customer requests yet" />
          ) : (
            <ul className="afv__vlist">
              {requests.map(r => (
                <li key={r.name.toLowerCase()} className="afv__vrow">
                  <span className={`afv__reqcount${r.count > 1 ? '' : ' afv__reqcount--one'}`} title={`Requested ${r.count} time${r.count === 1 ? '' : 's'}`}>
                    {r.count}×
                  </span>
                  <div className="afv__vinfo">
                    <span className="afv__vname">{r.name}</span>
                    <span className="afv__vmeta">Last requested {fmtWhen(r.lastAt)}</span>
                  </div>
                  <div className="afv__vactions">
                    <Button
                      size="sm"
                      icon={Plus}
                      onClick={() => setEditing({ ...BLANK, name: r.name })}
                      disabled={busy}
                    >
                      Add as vendor
                    </Button>
                    <Button
                      variant="danger-ghost"
                      size="sm"
                      icon={Trash2}
                      onClick={() => removeRequest(r.name)}
                      disabled={removing === r.name.toLowerCase()}
                      title="Delete request"
                      aria-label={`Delete request for ${r.name}`}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {dirty && (
        <div className="afv__savebar" role="status">
          <span className="afv__savebar-txt">You have unsaved vendor changes</span>
          <div className="afv__savebar-actions">
            <Button variant="ghost" className="afv__savebar-ghost" onClick={discard} disabled={busy}>Discard</Button>
            <Button variant="primary" onClick={saveAll} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</Button>
          </div>
        </div>
      )}

      {editing && (
        <VendorEditor
          initial={editing}
          onClose={() => setEditing(null)}
          onSave={saveVendor}
        />
      )}
    </div>
  );
}

/* Request-goal stepper — syncs to the saved value, commits on blur/enter. */
function ThresholdInput({ value, busy, onSave }) {
  const [val, setVal] = useState(String(value));
  useEffect(() => { setVal(String(value)); }, [value]);
  const commit = (nRaw) => {
    const n = Math.max(1, Math.min(999, Math.round(Number(nRaw) || 10)));
    setVal(String(n));
    if (n !== value) onSave(n);
  };
  return (
    <div className="afv__stepper" role="group" aria-labelledby="afv-goal-label">
      <button type="button" className="afv__stepper-btn" onClick={() => commit(Number(val) - 1)} disabled={busy} aria-label="Decrease"><Minus size={15} aria-hidden="true" /></button>
      <input
        type="number" min="1" max="999" value={val}
        onChange={e => setVal(e.target.value)}
        onBlur={e => commit(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        disabled={busy} aria-label="Request goal"
      />
      <button type="button" className="afv__stepper-btn" onClick={() => commit(Number(val) + 1)} disabled={busy} aria-label="Increase"><Plus size={15} aria-hidden="true" /></button>
    </div>
  );
}

/* Focused add/edit dialog with a live preview. */
function VendorEditor({ initial, onClose, onSave }) {
  const [v, setV] = useState(() => ({
    name: initial.name || '', area: initial.area || '',
    lat: initial.lat ?? '', lng: initial.lng ?? '',
    color: initial.color || '#E4572E', logo_url: initial.logo_url || '',
  }));
  const set = (patch) => setV(p => ({ ...p, ...patch }));
  const valid = v.name.trim().length > 0;
  const submit = () => {
    if (!valid) return;
    onSave({
      name: v.name.trim(), area: v.area.trim(),
      lat: v.lat === '' ? null : parseFloat(v.lat),
      lng: v.lng === '' ? null : parseFloat(v.lng),
      color: v.color.trim(), logo_url: v.logo_url.trim(),
    });
  };
  const hex = /^#[0-9a-fA-F]{6}$/.test(v.color) ? v.color : '#B0A897';
  const isEdit = !!initial._k;

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? 'Edit vendor' : 'Add vendor'}
      subtitle="Saved with the rest of your list when you press Save changes."
      icon={Store}
      footer={(
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!valid}>{isEdit ? 'Save vendor' : 'Add vendor'}</Button>
        </>
      )}
    >
      <div className="afv__preview">
        <span className="afv__vlogo afv__vlogo--lg" style={{ background: hex }}>
          {v.logo_url ? <img src={v.logo_url} alt="" onError={e => { e.currentTarget.style.display = 'none'; }} /> : (v.name || 'S').charAt(0).toUpperCase()}
        </span>
        <div className="afv__preview-txt">
          <strong>{v.name || 'Vendor name'}</strong>
          <span>{cityFromArea(v.area) || v.area || 'Area / city'}</span>
        </div>
      </div>

      <div className="afv__form">
        <Field label="Name" htmlFor="afv-name">
          <input id="afv-name" className="ui-input" value={v.name} onChange={e => set({ name: e.target.value })} placeholder="e.g. Bocca Coffee" autoFocus />
        </Field>
        <Field label="Area or city" htmlFor="afv-area">
          <input id="afv-area" className="ui-input" value={v.area} onChange={e => set({ area: e.target.value })} placeholder="e.g. De Pijp, Amsterdam" />
        </Field>
        <Field label={<>Latitude <span className="afv__optional">optional</span></>} htmlFor="afv-lat">
          <input id="afv-lat" className="ui-input" value={v.lat} onChange={e => set({ lat: e.target.value })} placeholder="52.3555" inputMode="decimal" />
        </Field>
        <Field label={<>Longitude <span className="afv__optional">optional</span></>} htmlFor="afv-lng">
          <input id="afv-lng" className="ui-input" value={v.lng} onChange={e => set({ lng: e.target.value })} placeholder="4.9066" inputMode="decimal" />
        </Field>
        <Field label="Brand colour" htmlFor="afv-color">
          <span className="afv__colorpick">
            <span className="afv__colorpick-swatch" style={{ background: hex }}>
              <input type="color" value={hex} onChange={e => set({ color: e.target.value })} aria-label="Pick a brand colour" />
            </span>
            <input id="afv-color" className="ui-input afv__colorpick-hex" value={v.color} onChange={e => set({ color: e.target.value })} placeholder="#E4572E" />
          </span>
        </Field>
        <Field label={<>Logo URL <span className="afv__optional">optional</span></>} htmlFor="afv-logo">
          <input id="afv-logo" className="ui-input" value={v.logo_url} onChange={e => set({ logo_url: e.target.value })} placeholder="https://…" />
        </Field>
      </div>
      <p className="afv__field-hint">
        Coordinates place the pin on the map; without them the venue still shows in the list. Without a logo, the card shows a coloured initial.
      </p>
    </Modal>
  );
}
