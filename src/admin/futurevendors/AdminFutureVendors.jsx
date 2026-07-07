import { useEffect, useState } from 'react';
import { useOrg } from '../context/OrgContext';
import {
  listOrgGroups,
  setGroupNotYetStores,
  saveNotYetThreshold,
  saveNotYetVendors,
  getFutureVendorStats,
} from '../lib/adminApi';
import { getNotYetStores } from '../../lib/notYetStores';
import './AdminFutureVendors.css';

/* ─────────────────────────────────────────────────────────────────────
 * AdminFutureVendors — dedicated page for a group's "coming soon" venues.
 *
 * Future vendors are nearby places that aren't on PackPerks yet. They show
 * as locked cards + map pins on the customer Stores page, where customers
 * tap "Request it" to signal demand. Everything here is stored on the group
 * config, so it is shared by (syncs across) every store in the group.
 *
 * The page follows the org switcher's active group by default; when the
 * account spans several groups a selector lets you manage each one.
 * ───────────────────────────────────────────────────────────────────── */

function groupRegion(group) {
  return /uae|dubai|emirat|abu\s*dhabi/i.test(`${group?.slug || ''} ${group?.name || ''}`) ? 'UAE' : 'NL';
}

const BLANK_ADD = { name: '', area: '', lat: '', lng: '', color: '', logo_url: '' };

export default function AdminFutureVendors() {
  const { activeGroup } = useOrg();
  const [groups, setGroups] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = async () => {
    try {
      const gs = await listOrgGroups();
      setGroups(gs || []);
    } catch (e) {
      setError(e.message || 'Failed to load groups.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  // Default the selection to the org switcher's active group (keeps the page in
  // sync with whatever group the admin is looking at), else the first group.
  useEffect(() => {
    if (selectedId && groups.some(g => g.id === selectedId)) return;
    setSelectedId(activeGroup?.id || groups[0]?.id || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, activeGroup]);

  const group = groups.find(g => g.id === selectedId) || null;
  const showNotYet = group?.config?.settings?.showNotYetStores !== false;

  async function run(fn) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e.message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="afv">
      <header className="afv__head">
        <span className="afv__eyebrow">Phase 3 · Stores</span>
        <h1 className="afv__title">Future vendors</h1>
        <p className="afv__sub">
          Nearby places that aren’t on PackPerks yet. They appear as locked “coming soon”
          cards and map pins on the customer Stores page, where customers tap “Request it”
          to signal demand. These settings sync across every store in the group.
        </p>
      </header>

      {loading ? (
        <p className="afv__muted">Loading groups…</p>
      ) : groups.length === 0 ? (
        <div className="afv__empty">
          <p className="afv__empty-title">No groups yet</p>
          <p className="afv__muted">Future vendors are a group-level feature. Create a group under Organizations first.</p>
        </div>
      ) : !group ? (
        <p className="afv__muted">Select a group to manage its future vendors.</p>
      ) : (
        <>
          <div className="afv__toolbar">
            {groups.length > 1 && (
              <label className="afv__groupsel">
                <span className="afv__groupsel-label">Group</span>
                <select className="afv__select" value={selectedId || ''} onChange={e => setSelectedId(e.target.value)}>
                  {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </label>
            )}
            <span className="afv__region" title="Which curated venue set seeds this group">
              {groupRegion(group) === 'UAE' ? 'United Arab Emirates' : 'Netherlands'}
            </span>
          </div>

          {error && <p className="afv__error">{error}</p>}

          {/* Setting — toggle the whole feature on/off for the group */}
          <div className="afv__card afv__togglecard">
            <div className="afv__toggle-txt">
              <strong>Show coming-soon venues</strong>
              <span>Locked cards &amp; map pins on the Stores page for “{group.name}”. When off, customers see only live stores.</span>
            </div>
            <label className="afv__toggle" title="Toggle coming-soon venues on the customer Stores page">
              <input
                type="checkbox"
                checked={showNotYet}
                onChange={e => run(() => setGroupNotYetStores(group.id, e.target.checked))}
                disabled={busy}
              />
              <span className="afv__toggle-track"><span className="afv__toggle-thumb" /></span>
            </label>
          </div>

          <ThresholdSetting
            key={`thresh-${group.id}`}
            group={group}
            busy={busy}
            onSave={(n) => run(() => saveNotYetThreshold(group.id, n))}
          />

          <VendorManager
            key={group.id}
            group={group}
            busy={busy}
            enabled={showNotYet}
            onSave={(vendors) => run(() => saveNotYetVendors(group.id, vendors))}
          />
        </>
      )}
    </div>
  );
}

/* The "request goal" — how many customer requests a venue needs before it
 * reads as "Coming soon" on the customer Stores page. */
function ThresholdSetting({ group, busy, onSave }) {
  const current = group?.config?.settings?.notYetThreshold ?? 10;
  const [val, setVal] = useState(String(current));
  useEffect(() => { setVal(String(current)); }, [current]);
  const commit = () => {
    const n = Math.max(1, Math.round(Number(val) || 10));
    setVal(String(n));
    if (n !== current) onSave(n);
  };
  return (
    <div className="afv__card afv__togglecard">
      <div className="afv__toggle-txt">
        <strong>Request goal</strong>
        <span>How many “Request it” taps a venue needs before it reads as “Coming soon”. Shown as a progress bar (e.g. 4/{val || 10}) on each locked card.</span>
      </div>
      <input
        type="number" className="afv__thresh" min="1" max="999"
        value={val}
        onChange={e => setVal(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        disabled={busy}
        aria-label="Request goal"
      />
    </div>
  );
}

/* The editable vendor list + full request stats for one group. */
function VendorManager({ group, busy, enabled, onSave }) {
  const region = groupRegion(group);
  const seed = () => {
    const saved = group?.config?.settings?.notYetVendors;
    return (Array.isArray(saved) && saved.length) ? saved : getNotYetStores(region);
  };
  const [rows, setRows] = useState(() => seed().map((v, i) => ({ ...v, _k: `s${i}` })));
  const [stats, setStats] = useState(null);
  const [adding, setAdding] = useState(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => { getFutureVendorStats(region).then(setStats).catch(() => setStats({})); }, [region]);

  const update = (k, patch) => { setRows(rs => rs.map(r => (r._k === k ? { ...r, ...patch } : r))); setDirty(true); };
  const remove = (k) => { setRows(rs => rs.filter(r => r._k !== k)); setDirty(true); };
  const addRow = () => {
    if (!adding?.name?.trim()) return;
    setRows(rs => [...rs, {
      _k: `n${rs.length}-${adding.name}`,
      name: adding.name.trim(), area: (adding.area || '').trim(),
      lat: adding.lat === '' ? null : parseFloat(adding.lat),
      lng: adding.lng === '' ? null : parseFloat(adding.lng),
      color: (adding.color || '').trim(), logo_url: (adding.logo_url || '').trim(),
    }]);
    setAdding(null); setDirty(true);
  };
  const save = () => {
    onSave(rows.map(({ _k, ...v }) => ({
      name: v.name, area: v.area || '',
      lat: v.lat ?? null, lng: v.lng ?? null,
      color: v.color || '', logo_url: v.logo_url || '',
    })));
    setDirty(false);
  };
  const discard = () => { setRows(seed().map((v, i) => ({ ...v, _k: `s${i}` }))); setAdding(null); setDirty(false); };

  // Full request ranking — every venue that's been requested, most first.
  const ranked = stats ? Object.entries(stats).sort((a, b) => b[1] - a[1]) : [];
  const totalReq = ranked.reduce((s, [, n]) => s + n, 0);
  const maxReq = ranked.length ? ranked[0][1] : 0;

  return (
    <div className="afv__manager">
      {/* Requests overview — full ranked list of user click counts */}
      <section className="afv__card">
        <div className="afv__card-head">
          <h2 className="afv__card-title">Requests</h2>
          <span className="afv__card-meta">{totalReq} total · {ranked.length} venue{ranked.length === 1 ? '' : 's'}</span>
        </div>
        {stats == null ? (
          <p className="afv__muted">Loading requests…</p>
        ) : ranked.length === 0 ? (
          <p className="afv__muted">No requests yet. Counts appear here as customers tap “Request it”.</p>
        ) : (
          <ol className="afv__ranklist">
            {ranked.map(([name, n], i) => (
              <li key={name} className="afv__rank">
                <span className="afv__rank-num">{i + 1}</span>
                <span className="afv__rank-name" title={name}>{name}</span>
                <span className="afv__rank-bar"><span style={{ width: `${maxReq ? Math.round((n / maxReq) * 100) : 0}%` }} /></span>
                <span className="afv__rank-n">{n}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* Vendor list editor — name, area, location, colour, logo */}
      <section className="afv__card">
        <div className="afv__card-head">
          <h2 className="afv__card-title">Vendors <span className="afv__count">{rows.length}</span></h2>
          <div className="afv__card-actions">
            {!enabled && <span className="afv__badge">Hidden from customers</span>}
            {!adding && <button className="afv__btn afv__btn--ghost" onClick={() => setAdding({ ...BLANK_ADD })} disabled={busy}>+ Add vendor</button>}
          </div>
        </div>

        {adding && (
          <div className="afv__add">
            <div className="afv__add-grid">
              <input className="afv__input" value={adding.name} onChange={e => setAdding(a => ({ ...a, name: e.target.value }))} placeholder="Venue name" autoFocus />
              <input className="afv__input" value={adding.area} onChange={e => setAdding(a => ({ ...a, area: e.target.value }))} placeholder="Area (e.g. De Pijp, Amsterdam)" />
              <input className="afv__input" value={adding.lat} onChange={e => setAdding(a => ({ ...a, lat: e.target.value }))} placeholder="Latitude" />
              <input className="afv__input" value={adding.lng} onChange={e => setAdding(a => ({ ...a, lng: e.target.value }))} placeholder="Longitude" />
              <input className="afv__input" value={adding.color} onChange={e => setAdding(a => ({ ...a, color: e.target.value }))} placeholder="#brand colour" />
              <input className="afv__input" value={adding.logo_url} onChange={e => setAdding(a => ({ ...a, logo_url: e.target.value }))} placeholder="Logo URL (optional)" />
            </div>
            <div className="afv__add-actions">
              <button className="afv__btn afv__btn--primary" onClick={addRow} disabled={!adding.name.trim()}>Add vendor</button>
              <button className="afv__btn afv__btn--ghost" onClick={() => setAdding(null)}>Cancel</button>
            </div>
          </div>
        )}

        <ul className="afv__list">
          {rows.map(r => (
            <li key={r._k} className="afv__row">
              <span className="afv__swatch" style={{ background: r.color || '#B0A897' }}>
                {r.logo_url
                  ? <img src={r.logo_url} alt="" onError={e => { e.currentTarget.style.display = 'none'; }} />
                  : (r.name || 'S').charAt(0).toUpperCase()}
              </span>
              <div className="afv__fields">
                <div className="afv__fieldrow">
                  <input className="afv__input afv__input--name" value={r.name || ''} onChange={e => update(r._k, { name: e.target.value })} placeholder="Venue name" />
                  <input className="afv__input" value={r.area || ''} onChange={e => update(r._k, { area: e.target.value })} placeholder="Area" />
                </div>
                <div className="afv__fieldrow">
                  <input className="afv__input afv__input--num" value={r.lat ?? ''} onChange={e => update(r._k, { lat: e.target.value === '' ? null : parseFloat(e.target.value) })} placeholder="lat" />
                  <input className="afv__input afv__input--num" value={r.lng ?? ''} onChange={e => update(r._k, { lng: e.target.value === '' ? null : parseFloat(e.target.value) })} placeholder="lng" />
                  <input className="afv__input afv__input--color" value={r.color || ''} onChange={e => update(r._k, { color: e.target.value })} placeholder="#colour" />
                  <input className="afv__input afv__input--logo" value={r.logo_url || ''} onChange={e => update(r._k, { logo_url: e.target.value })} placeholder="Logo URL" />
                </div>
              </div>
              <span className="afv__reqs" title="Requests">{stats && stats[r.name] ? `♥ ${stats[r.name]}` : ''}</span>
              <button className="afv__del" onClick={() => remove(r._k)} title="Remove vendor" disabled={busy}>×</button>
            </li>
          ))}
        </ul>

        {dirty && (
          <div className="afv__save">
            <button className="afv__btn afv__btn--primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
            <button className="afv__btn afv__btn--ghost" onClick={discard} disabled={busy}>Discard</button>
            <span className="afv__save-hint">Unsaved changes</span>
          </div>
        )}
      </section>
    </div>
  );
}
