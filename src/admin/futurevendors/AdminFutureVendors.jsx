import { useEffect, useMemo, useState } from 'react';
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

const IconEdit = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z" /></svg>
);
const IconTrash = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
);

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
    <div className="afv">
      <header className="afv__head">
        <div className="afv__head-main">
          <span className="afv__eyebrow">Stores</span>
          <h1 className="afv__title">Future vendors</h1>
          <p className="afv__sub">
            Nearby places that aren’t on PackPerks yet. They appear as locked “coming soon” cards and map
            pins on the customer Stores page — customers tap “Request it” to signal demand.
          </p>
        </div>
        {group && (
          <div className="afv__head-side">
            {groups.length > 1 && (
              <label className="afv__groupsel">
                <span>Group</span>
                <select value={selectedId || ''} onChange={e => setSelectedId(e.target.value)}>
                  {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </label>
            )}
            <span className="afv__region">{groupRegion(group) === 'UAE' ? 'United Arab Emirates' : 'Netherlands'}</span>
          </div>
        )}
      </header>

      {error && <p className="afv__error">{error}</p>}

      {loading ? (
        <p className="afv__muted">Loading…</p>
      ) : groups.length === 0 ? (
        <div className="afv__empty">
          <p className="afv__empty-title">No groups yet</p>
          <p className="afv__muted">Future vendors are a group-level feature. Create a group under Organizations first.</p>
        </div>
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

  return (
    <div className="afv__body">
      {/* ── At-a-glance ── */}
      <div className="afv__stats">
        <div className="afv__stat">
          <span className="afv__stat-n">{rows.length}</span>
          <span className="afv__stat-l">Vendors</span>
        </div>
        <div className="afv__stat">
          <span className="afv__stat-n">{stats == null ? '—' : totalReq}</span>
          <span className="afv__stat-l">Requests</span>
        </div>
        <div className="afv__stat afv__stat--wide">
          <span className="afv__stat-n afv__stat-n--sm" title={top ? top[0] : ''}>{top ? top[0] : '—'}</span>
          <span className="afv__stat-l">Most requested{top ? ` · ${top[1]}` : ''}</span>
        </div>
        <div className={`afv__stat afv__stat--status ${showNotYet ? 'is-live' : 'is-off'}`}>
          <span className="afv__stat-dot" />
          <span className="afv__stat-l">{showNotYet ? 'Live on Stores' : 'Hidden'}</span>
        </div>
      </div>

      {/* ── Settings ── */}
      <section className="afv__card">
        <h2 className="afv__card-title">Settings</h2>
        <div className="afv__setting">
          <div className="afv__setting-txt">
            <strong>Show coming-soon venues</strong>
            <span>Locked cards &amp; map pins on the customer Stores page for “{group.name}”. When off, customers see only live stores.</span>
          </div>
          <label className="afv__toggle">
            <input type="checkbox" checked={showNotYet} onChange={e => onToggle(e.target.checked)} disabled={busy} />
            <span className="afv__toggle-track"><span className="afv__toggle-thumb" /></span>
          </label>
        </div>
        <div className="afv__setting">
          <div className="afv__setting-txt">
            <strong>Request goal</strong>
            <span>How many “Request it” taps a venue needs before it reads “Coming soon”. Shown as a progress bar on each card.</span>
          </div>
          <ThresholdInput value={threshold} busy={busy} onSave={onThreshold} />
        </div>
      </section>

      {/* ── Vendors ── */}
      <section className="afv__card">
        <div className="afv__vhead">
          <h2 className="afv__card-title">Vendors <span className="afv__count">{rows.length}</span></h2>
          <div className="afv__vtools">
            <span className="afv__search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search vendors…" aria-label="Search vendors" />
            </span>
            <span className="afv__seg" role="group" aria-label="Sort">
              <button className={sort === 'requests' ? 'is-on' : ''} onClick={() => setSort('requests')}>Most wanted</button>
              <button className={sort === 'az' ? 'is-on' : ''} onClick={() => setSort('az')}>A–Z</button>
            </span>
            <button className="afv__btn afv__btn--primary" onClick={() => setEditing({ ...BLANK })} disabled={busy}>+ Add vendor</button>
          </div>
        </div>

        {visible.length === 0 ? (
          <div className="afv__vempty">{q ? 'No vendors match your search.' : 'No vendors yet — add one to get started.'}</div>
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
                      {!hasPin && <span className="afv__vwarn" title="No coordinates — this venue won’t show on the map"> · no map pin</span>}
                    </span>
                  </div>
                  <div className="afv__vprog" title={`${n} of ${threshold} requests`}>
                    <div className="afv__vbar"><span className={reached ? 'is-reached' : ''} style={{ width: `${Math.max(reached ? 100 : n ? 6 : 0, pct)}%` }} /></div>
                    <span className={`afv__vcount${reached ? ' afv__vcount--soon' : ''}`}>{reached ? 'Coming soon' : `${n}/${threshold}`}</span>
                  </div>
                  <div className="afv__vactions">
                    <button className="afv__iconbtn" onClick={() => setEditing(r)} disabled={busy} title="Edit vendor" aria-label="Edit vendor"><IconEdit /></button>
                    <button className="afv__iconbtn afv__iconbtn--del" onClick={() => removeVendor(r._k)} disabled={busy} title="Remove vendor" aria-label="Remove vendor"><IconTrash /></button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── Customer requests — free-text "Haven't found your store?" intake ── */}
      <section className="afv__card">
        <div className="afv__vhead afv__vhead--stack">
          <h2 className="afv__card-title">
            Customer requests
            {requests?.length ? <span className="afv__count">{requests.length}</span> : null}
          </h2>
          <p className="afv__reqsub">Stores customers typed in themselves on the market page — not on your list yet.</p>
        </div>
        {requests == null ? (
          <div className="afv__vempty">Loading…</div>
        ) : requests.length === 0 ? (
          <div className="afv__vempty">No customer requests yet.</div>
        ) : (
          <ul className="afv__reqlist">
            {requests.map(r => (
              <li key={r.name.toLowerCase()} className="afv__reqrow">
                {r.count > 1 && <span className="afv__reqcount" title={`Requested ${r.count} times`}>{r.count}×</span>}
                <div className="afv__reqinfo">
                  <span className="afv__reqname">{r.name}</span>
                  <span className="afv__reqmeta">Last requested {fmtWhen(r.lastAt)}</span>
                </div>
                <button
                  className="afv__btn afv__btn--ghost afv__btn--sm"
                  onClick={() => setEditing({ ...BLANK, name: r.name })}
                  disabled={busy}
                >
                  Add as vendor
                </button>
                <button
                  className="afv__iconbtn afv__iconbtn--del"
                  onClick={() => removeRequest(r.name)}
                  disabled={removing === r.name.toLowerCase()}
                  title="Delete request"
                  aria-label={`Delete request for ${r.name}`}
                >
                  <IconTrash />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {dirty && (
        <div className="afv__savebar" role="status">
          <span className="afv__savebar-txt">You have unsaved vendor changes</span>
          <div className="afv__savebar-actions">
            <button className="afv__btn afv__btn--ghost" onClick={discard} disabled={busy}>Discard</button>
            <button className="afv__btn afv__btn--primary" onClick={saveAll} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
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
    <div className="afv__stepper">
      <button className="afv__stepper-btn" onClick={() => commit(Number(val) - 1)} disabled={busy} aria-label="Decrease">−</button>
      <input
        type="number" min="1" max="999" value={val}
        onChange={e => setVal(e.target.value)}
        onBlur={e => commit(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        disabled={busy} aria-label="Request goal"
      />
      <button className="afv__stepper-btn" onClick={() => commit(Number(val) + 1)} disabled={busy} aria-label="Increase">+</button>
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

  return (
    <div className="afv__modal-back" onClick={onClose}>
      <div className="afv__modal" onClick={e => e.stopPropagation()}>
        <div className="afv__modal-head">
          <h3>{initial._k ? 'Edit vendor' : 'Add vendor'}</h3>
          <button className="afv__iconbtn" onClick={onClose} aria-label="Close">✕</button>
        </div>

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
          <label className="afv__field">
            <span>Name</span>
            <input value={v.name} onChange={e => set({ name: e.target.value })} placeholder="e.g. Bocca Coffee" autoFocus />
          </label>
          <label className="afv__field">
            <span>Area / city</span>
            <input value={v.area} onChange={e => set({ area: e.target.value })} placeholder="e.g. De Pijp, Amsterdam" />
          </label>
          <div className="afv__field-row">
            <label className="afv__field">
              <span>Latitude <em>(optional)</em></span>
              <input value={v.lat} onChange={e => set({ lat: e.target.value })} placeholder="52.3555" inputMode="decimal" />
            </label>
            <label className="afv__field">
              <span>Longitude <em>(optional)</em></span>
              <input value={v.lng} onChange={e => set({ lng: e.target.value })} placeholder="4.9066" inputMode="decimal" />
            </label>
          </div>
          <div className="afv__field-row">
            <label className="afv__field afv__field--color">
              <span>Brand colour</span>
              <span className="afv__colorpick">
                <span className="afv__colorpick-swatch" style={{ background: hex }}>
                  <input type="color" value={hex} onChange={e => set({ color: e.target.value })} aria-label="Brand colour" />
                </span>
                <input className="afv__colorpick-hex" value={v.color} onChange={e => set({ color: e.target.value })} placeholder="#E4572E" />
              </span>
            </label>
            <label className="afv__field">
              <span>Logo URL <em>(optional)</em></span>
              <input value={v.logo_url} onChange={e => set({ logo_url: e.target.value })} placeholder="https://…" />
            </label>
          </div>
          <p className="afv__field-hint">Coordinates place the pin on the map; without them the venue still shows in the list. Logo defaults to a coloured initial.</p>
        </div>

        <div className="afv__modal-foot">
          <button className="afv__btn afv__btn--ghost" onClick={onClose}>Cancel</button>
          <button className="afv__btn afv__btn--primary" onClick={submit} disabled={!valid}>{initial._k ? 'Save vendor' : 'Add vendor'}</button>
        </div>
      </div>
    </div>
  );
}
