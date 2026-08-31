import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useOrg } from '../context/OrgContext';
import {
  listSmartbinLocations,
  saveSmartbinLocation,
  deleteSmartbinLocation,
  geocodeAddress,
} from '../lib/adminApi';
import './AdminSmartBins.css';

/* ─────────────────────────────────────────────────────────────────────
 * AdminSmartBins — the venue list behind the Redirect Refund home map.
 *
 * BYO has Future Vendors; this is its Redirect Refund counterpart, with
 * one important difference: these venues are MACHINES. A bin is either
 * live (collecting today) or coming soon, it has an address customers
 * navigate to, and it may be tied to a machine_id in smartbin_keys.
 *
 * Addresses are geocoded on demand (free, keyless) so nobody has to hunt
 * for coordinates; the preview map shows exactly what the customer sees,
 * which is the fastest way to catch a pin that landed in the wrong town.
 * ───────────────────────────────────────────────────────────────────── */

const BLANK = { name: '', address: '', lat: '', lng: '', status: 'live', machine_id: '', active: true };

const IconEdit = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z" /></svg>
);
const IconTrash = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
);

/* Preview of the customer's map — same layer, same pin. */
function PreviewMap({ bins }) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);

  useEffect(() => {
    if (!elRef.current || mapRef.current) return;
    const map = L.map(elRef.current, {
      center: [52.15, 5.3], zoom: 7, zoomControl: true, attributionControl: false, scrollWheelZoom: false,
    });
    L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', {
      subdomains: 'ab', maxZoom: 19,
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; layerRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current, layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const pins = bins.filter(b => b.lat != null && b.lng != null && b.active !== false);
    pins.forEach(b => {
      const soon = b.status === 'coming_soon';
      L.marker([b.lat, b.lng], {
        icon: L.divIcon({
          className: 'asb__pin',
          html: `<div class="asb__pin-dot${soon ? ' asb__pin-dot--soon' : ''}">♻︎</div>`,
          iconSize: [28, 28], iconAnchor: [14, 14],
        }),
      }).addTo(layer).bindTooltip(b.name || 'Bin');
    });
    if (pins.length === 1) map.setView([pins[0].lat, pins[0].lng], 13);
    else if (pins.length) map.fitBounds(pins.map(b => [b.lat, b.lng]), { padding: [24, 24], maxZoom: 13 });
  }, [bins]);

  return <div ref={elRef} className="asb__map" aria-label="Smart bin map preview" />;
}

/* Add / edit sheet. Geocode fills coordinates from the address; the admin
 * can always override them by hand. */
function BinEditor({ row, busy, onSave, onCancel }) {
  const [form, setForm] = useState({ ...BLANK, ...row, lat: row.lat ?? '', lng: row.lng ?? '' });
  const [geo, setGeo] = useState(null);      // 'busy' | 'miss' | matched label
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function locate() {
    if (!form.address.trim()) return;
    setGeo('busy');
    const hit = await geocodeAddress(form.address);
    if (hit) {
      setForm(f => ({ ...f, lat: hit.lat, lng: hit.lng }));
      setGeo(hit.label);
    } else {
      setGeo('miss');
    }
  }

  const valid = form.name.trim().length > 0;

  return (
    <div className="asb__modal" role="dialog" aria-modal="true" aria-label={row.id ? 'Edit smart bin' : 'Add smart bin'}>
      <div className="asb__modal-back" onClick={onCancel} />
      <div className="asb__modal-card">
        <h2 className="asb__modal-title">{row.id ? 'Edit smart bin' : 'Add smart bin'}</h2>

        <label className="asb__field">
          <span>Name</span>
          <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="Amsterdam Zuid" autoFocus />
        </label>

        <label className="asb__field">
          <span>Address</span>
          <div className="asb__field-row">
            <input value={form.address} onChange={e => set('address', e.target.value)} placeholder="Leidseplein 7, 1017 PR Amsterdam" />
            <button type="button" className="asb__btn" onClick={locate} disabled={busy || geo === 'busy' || !form.address.trim()}>
              {geo === 'busy' ? 'Finding…' : 'Find on map'}
            </button>
          </div>
          {geo && geo !== 'busy' && (
            <span className={`asb__hint${geo === 'miss' ? ' asb__hint--warn' : ''}`}>
              {geo === 'miss' ? 'No match — enter the coordinates by hand.' : `Matched: ${geo}`}
            </span>
          )}
        </label>

        <div className="asb__field-grid">
          <label className="asb__field">
            <span>Latitude</span>
            <input value={form.lat} onChange={e => set('lat', e.target.value)} inputMode="decimal" placeholder="52.3411" />
          </label>
          <label className="asb__field">
            <span>Longitude</span>
            <input value={form.lng} onChange={e => set('lng', e.target.value)} inputMode="decimal" placeholder="4.8887" />
          </label>
        </div>
        <p className="asb__hint">Without coordinates the bin stays in this list but never appears on the customer map.</p>

        <div className="asb__field-grid">
          <label className="asb__field">
            <span>Status</span>
            <select value={form.status} onChange={e => set('status', e.target.value)}>
              <option value="live">Live — collecting now</option>
              <option value="coming_soon">Coming soon</option>
            </select>
          </label>
          <label className="asb__field">
            <span>Machine ID <em>(optional)</em></span>
            <input value={form.machine_id} onChange={e => set('machine_id', e.target.value)} placeholder="cc1346074f8f…" />
          </label>
        </div>

        <label className="asb__check">
          <input type="checkbox" checked={form.active !== false} onChange={e => set('active', e.target.checked)} />
          <span>Show on the customer map</span>
        </label>

        <div className="asb__modal-actions">
          <button type="button" className="asb__btn" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className="asb__btn asb__btn--primary" onClick={() => onSave(form)} disabled={busy || !valid}>
            {busy ? 'Saving…' : 'Save bin'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AdminSmartBins() {
  const { activeOrgId } = useOrg();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    if (!activeOrgId) return;
    setLoading(true);
    setError(null);
    try { setRows(await listSmartbinLocations(activeOrgId)); }
    catch (e) { setError(e?.message || 'Failed to load smart bins.'); }
    finally { setLoading(false); }
  }, [activeOrgId]);

  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(r => `${r.name || ''} ${r.address || ''}`.toLowerCase().includes(needle));
  }, [rows, q]);

  const live = rows.filter(r => r.status !== 'coming_soon' && r.active !== false).length;
  const soon = rows.filter(r => r.status === 'coming_soon' && r.active !== false).length;
  const noPin = rows.filter(r => r.lat == null || r.lng == null).length;

  async function run(fn) {
    setBusy(true); setError(null);
    try { await fn(); await load(); }
    catch (e) { setError(e?.message || 'Something went wrong.'); }
    finally { setBusy(false); }
  }

  return (
    <div className="asb">
      <header className="asb__head">
        <div>
          <h1 className="asb__title">Smart bins</h1>
          <p className="asb__sub">
            The bins customers see on the “Smart bins near you” map, with the address they navigate to.
            Add one per machine; a bin with no coordinates stays hidden from the map.
          </p>
        </div>
        <button className="asb__btn asb__btn--primary" onClick={() => setEditing({ ...BLANK })} disabled={busy || loading}>
          + Add bin
        </button>
      </header>

      {error && <div className="asb__error">{error}</div>}

      <div className="asb__stats">
        <div className="asb__stat"><span className="asb__stat-n">{live}</span><span className="asb__stat-l">Live bins</span></div>
        <div className="asb__stat"><span className="asb__stat-n">{soon}</span><span className="asb__stat-l">Coming soon</span></div>
        <div className="asb__stat"><span className="asb__stat-n">{noPin}</span><span className="asb__stat-l">Missing coordinates</span></div>
      </div>

      <section className="asb__card">
        <h2 className="asb__card-title">Customer map preview</h2>
        <PreviewMap bins={rows} />
      </section>

      <section className="asb__card">
        <div className="asb__listhead">
          <h2 className="asb__card-title">Locations <span className="asb__count">{rows.length}</span></h2>
          <span className="asb__search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search bins…" aria-label="Search bins" />
          </span>
        </div>

        {loading ? (
          <div className="asb__empty">Loading bins…</div>
        ) : visible.length === 0 ? (
          <div className="asb__empty">{q ? 'No bins match your search.' : 'No bins yet — add the first one.'}</div>
        ) : (
          <ul className="asb__list">
            {visible.map(r => {
              const pinned = r.lat != null && r.lng != null;
              return (
                <li key={r.id} className={`asb__row${r.active === false ? ' asb__row--off' : ''}`}>
                  <span className={`asb__rowpin${r.status === 'coming_soon' ? ' asb__rowpin--soon' : ''}`} aria-hidden="true">♻︎</span>
                  <div className="asb__rowinfo">
                    <span className="asb__rowname">{r.name}</span>
                    <span className="asb__rowmeta">
                      {r.address || 'No address'}
                      {!pinned && <span className="asb__warn"> · no map pin</span>}
                      {r.machine_id && <span className="asb__mono"> · {r.machine_id.slice(0, 10)}…</span>}
                    </span>
                  </div>
                  <span className={`asb__badge asb__badge--${r.active === false ? 'off' : r.status === 'coming_soon' ? 'soon' : 'live'}`}>
                    {r.active === false ? 'Hidden' : r.status === 'coming_soon' ? 'Coming soon' : 'Live'}
                  </span>
                  <div className="asb__rowactions">
                    <button className="asb__iconbtn" onClick={() => setEditing(r)} disabled={busy} title="Edit bin" aria-label="Edit bin"><IconEdit /></button>
                    <button className="asb__iconbtn asb__iconbtn--del" onClick={() => setConfirmDel(r)} disabled={busy} title="Remove bin" aria-label="Remove bin"><IconTrash /></button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {editing && (
        <BinEditor
          row={editing}
          busy={busy}
          onCancel={() => setEditing(null)}
          onSave={(form) => run(async () => { await saveSmartbinLocation({ ...form, org_id: activeOrgId }); setEditing(null); })}
        />
      )}

      {confirmDel && (
        <div className="asb__modal" role="dialog" aria-modal="true" aria-label="Remove smart bin">
          <div className="asb__modal-back" onClick={() => setConfirmDel(null)} />
          <div className="asb__modal-card asb__modal-card--sm">
            <h2 className="asb__modal-title">Remove “{confirmDel.name}”?</h2>
            <p className="asb__hint">
              It disappears from the customer map immediately. Payouts already made at this bin are unaffected.
            </p>
            <div className="asb__modal-actions">
              <button className="asb__btn" onClick={() => setConfirmDel(null)} disabled={busy}>Cancel</button>
              <button
                className="asb__btn asb__btn--danger"
                onClick={() => run(async () => { await deleteSmartbinLocation(confirmDel.id); setConfirmDel(null); })}
                disabled={busy}
              >
                {busy ? 'Removing…' : 'Remove bin'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
