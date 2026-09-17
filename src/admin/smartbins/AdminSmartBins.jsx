import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { AlertCircle, Clock, LocateFixed, Map as MapIcon, MapPin, MapPinOff, Pencil, Plus, Recycle, Search, Trash2, X } from 'lucide-react';
import { useOrg } from '../context/OrgContext';
import {
  listSmartbinLocations,
  saveSmartbinLocation,
  deleteSmartbinLocation,
  geocodeAddress,
} from '../lib/adminApi';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, KpiTile, Modal, PageHeader } from '../ui';
import './AdminSmartBins.css';

/* ─────────────────────────────────────────────────────────────────────
 * AdminSmartBins — the venue list behind the Deferred Tikkie home map.
 *
 * BYO has Future Vendors; this is its Deferred Tikkie counterpart, with
 * one important difference: these venues are MACHINES. A bin is either
 * live (collecting today) or coming soon, it has an address customers
 * navigate to, and it may be tied to a machine_id in smartbin_keys.
 *
 * Addresses are geocoded on demand (free, keyless) so nobody has to hunt
 * for coordinates; the preview map shows exactly what the customer sees,
 * which is the fastest way to catch a pin that landed in the wrong town.
 * ───────────────────────────────────────────────────────────────────── */

const BLANK = { name: '', address: '', lat: '', lng: '', status: 'live', machine_id: '', active: true };

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
    <Modal
      open
      onClose={() => { if (!busy) onCancel(); }}
      title={row.id ? 'Edit smart bin' : 'Add smart bin'}
      subtitle="Saves straight away. Customers see the change on their map."
      icon={Recycle}
      iconTone="emerald"
      footer={(
        <>
          <Button variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={() => onSave(form)} disabled={busy || !valid}>
            {busy ? 'Saving…' : 'Save bin'}
          </Button>
        </>
      )}
    >
      <Field label="Name" htmlFor="asb-name">
        <input id="asb-name" className="ui-input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="Amsterdam Zuid" autoFocus />
      </Field>

      <Field label="Address" htmlFor="asb-address">
        <div className="asb__field-row">
          <input id="asb-address" className="ui-input" value={form.address} onChange={e => set('address', e.target.value)} placeholder="Leidseplein 7, 1017 PR Amsterdam" />
          <Button icon={LocateFixed} onClick={locate} disabled={busy || geo === 'busy' || !form.address.trim()}>
            {geo === 'busy' ? 'Finding…' : 'Find on map'}
          </Button>
        </div>
        {geo && geo !== 'busy' && (
          <span className={`asb__hint${geo === 'miss' ? ' asb__hint--warn' : ' asb__hint--ok'}`}>
            {geo === 'miss' ? 'No match. Enter the coordinates by hand.' : `Matched: ${geo}`}
          </span>
        )}
      </Field>

      <div className="asb__field-grid">
        <Field label="Latitude" htmlFor="asb-lat">
          <input id="asb-lat" className="ui-input" value={form.lat} onChange={e => set('lat', e.target.value)} inputMode="decimal" placeholder="52.3411" />
        </Field>
        <Field label="Longitude" htmlFor="asb-lng">
          <input id="asb-lng" className="ui-input" value={form.lng} onChange={e => set('lng', e.target.value)} inputMode="decimal" placeholder="4.8887" />
        </Field>
      </div>
      <p className="asb__hint">Without coordinates the bin stays in this list but never appears on the customer map.</p>

      <div className="asb__field-grid">
        <Field label="Status" htmlFor="asb-status">
          <select id="asb-status" className="ui-select" value={form.status} onChange={e => set('status', e.target.value)}>
            <option value="live">Live — collecting now</option>
            <option value="coming_soon">Coming soon</option>
          </select>
        </Field>
        <Field label={<>Machine ID <span className="asb__optional">optional</span></>} htmlFor="asb-machine">
          <input id="asb-machine" className="ui-input asb__mono-input" value={form.machine_id} onChange={e => set('machine_id', e.target.value)} placeholder="cc1346074f8f…" />
        </Field>
      </div>

      <label className="asb__check">
        <input type="checkbox" checked={form.active !== false} onChange={e => set('active', e.target.checked)} />
        <span>Show on the customer map</span>
      </label>
    </Modal>
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

  const kpis = [
    { id: 'live', label: 'Live bins', icon: Recycle, tone: 'emerald', value: live, description: 'Collecting cups now' },
    { id: 'soon', label: 'Coming soon', icon: Clock, tone: 'amber', value: soon, description: 'Shown as coming soon' },
    { id: 'nopin', label: 'Missing coordinates', icon: MapPinOff, tone: noPin ? 'rose' : 'slate', value: noPin, description: 'Not on the customer map' },
  ];

  return (
    <div className="ui-page asb">
      <PageHeader
        title="Smart bins"
        subtitle="The bins customers see on the “Smart bins near you” map, with the address they navigate to. Add one per machine; a bin without coordinates stays off the map."
      >
        <Button variant="primary" icon={Plus} onClick={() => setEditing({ ...BLANK })} disabled={busy || loading}>
          Add bin
        </Button>
      </PageHeader>

      {error && (
        <p className="asb__error" role="alert">
          <AlertCircle size={15} aria-hidden="true" />{error}
        </p>
      )}

      <div className="ui-kpis asb__kpis">
        {kpis.map((m, i) => <KpiTile key={m.id} metric={m} index={i} interactive={false} />)}
      </div>

      <Card>
        <CardHeader title="Customer map preview" icon={MapIcon} subtitle="The same map and pins customers see." />
        <CardBody>
          <PreviewMap bins={rows} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={<>Locations <span className="asb__count">{rows.length}</span></>}
          icon={MapPin}
          ruled
          actions={(
            <span className="asb__search">
              <Search size={14} aria-hidden="true" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search bins" aria-label="Search bins" />
              {q && (
                <button type="button" className="asb__search-clear" aria-label="Clear search" onClick={() => setQ('')}>
                  <X size={12} />
                </button>
              )}
            </span>
          )}
        />
        <CardBody flush>
          {loading ? (
            <p className="asb__loading">Loading bins…</p>
          ) : visible.length === 0 ? (
            <EmptyState icon={q ? Search : Recycle} title={q ? 'No matches' : 'No bins yet'}>
              {q ? 'No bins match your search.' : 'Add the first one with Add bin.'}
            </EmptyState>
          ) : (
            <ul className="asb__list">
              {visible.map(r => {
                const pinned = r.lat != null && r.lng != null;
                const soonRow = r.status === 'coming_soon';
                return (
                  <li key={r.id} className={`asb__row${r.active === false ? ' asb__row--off' : ''}`}>
                    <span className={`asb__rowpin ui-tone--${soonRow ? 'amber' : 'emerald'}`} aria-hidden="true">
                      <Recycle size={15} />
                    </span>
                    <div className="asb__rowinfo">
                      <span className="asb__rowname">{r.name}</span>
                      <span className="asb__rowmeta">
                        {r.address || 'No address'}
                        {!pinned && <span className="asb__warn"> · no map pin</span>}
                        {r.machine_id && <span className="asb__mono"> · {r.machine_id.slice(0, 10)}…</span>}
                      </span>
                    </div>
                    <Badge tone={r.active === false ? 'neutral' : soonRow ? 'warning' : 'success'}>
                      {r.active === false ? 'Hidden' : soonRow ? 'Coming soon' : 'Live'}
                    </Badge>
                    <div className="asb__rowactions">
                      <Button variant="ghost" size="sm" icon={Pencil} onClick={() => setEditing(r)} disabled={busy} title="Edit bin" aria-label={`Edit ${r.name}`} />
                      <Button variant="danger-ghost" size="sm" icon={Trash2} onClick={() => setConfirmDel(r)} disabled={busy} title="Remove bin" aria-label={`Remove ${r.name}`} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      {editing && (
        <BinEditor
          row={editing}
          busy={busy}
          onCancel={() => setEditing(null)}
          onSave={(form) => run(async () => { await saveSmartbinLocation({ ...form, org_id: activeOrgId }); setEditing(null); })}
        />
      )}

      <Modal
        open={!!confirmDel}
        onClose={() => { if (!busy) setConfirmDel(null); }}
        title={`Remove “${confirmDel?.name || 'this bin'}”?`}
        subtitle="It disappears from the customer map immediately. Payouts already made at this bin are unaffected."
        icon={Trash2}
        iconTone="rose"
        footer={(
          <>
            <Button variant="outline" onClick={() => setConfirmDel(null)} disabled={busy}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => run(async () => { await deleteSmartbinLocation(confirmDel.id); setConfirmDel(null); })}
              disabled={busy}
            >
              {busy ? 'Removing…' : 'Remove bin'}
            </Button>
          </>
        )}
      >
        <p className="asb__modal-text">If the bin is only out of action for a while, edit it and switch off “Show on the customer map” instead.</p>
      </Modal>
    </div>
  );
}
