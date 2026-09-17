import { useCallback, useEffect, useState } from 'react';
import { MapPin, MapPinPlus, Pencil, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Modal } from '../ui';
import { deleteLocation, upsertLocation } from '../lib/adminApi';
import { logAction } from '../auth/actionLog';

const BLANK = { name: '', address: '', postal_code: '', city: '', phone: '', status: 'active' };

/* The venue's locations: where cups come back. Counter QR codes and the
 * scan-by-location chart use them. */
export default function LocationsPanel({ canEdit, org }) {
  const orgId = org.activeOrgId;
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null); // location draft
  const [removing, setRemoving] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) return;
    const { data, error: e } = await supabase.from('locations').select('*').eq('org_id', orgId).order('name');
    if (e) setError(e.message);
    setRows(data || []);
  }, [orgId]);

  useEffect(() => {
    let alive = true;
    if (!orgId) return undefined;
    supabase.from('locations').select('*').eq('org_id', orgId).order('name')
      .then(({ data, error: e }) => {
        if (!alive) return;
        if (e) setError(e.message);
        setRows(data || []);
      });
    return () => { alive = false; };
  }, [orgId]);

  async function save() {
    if (!editing?.name?.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const before = editing.id ? rows.find(r => r.id === editing.id) : null;
      const payload = {
        ...(editing.id ? { id: editing.id } : {}),
        name: editing.name.trim(),
        address: editing.address?.trim() || null,
        postal_code: editing.postal_code?.trim() || null,
        city: editing.city?.trim() || null,
        phone: editing.phone?.trim() || null,
        status: editing.status || 'active',
      };
      const saved = await upsertLocation(orgId, payload);
      logAction({
        action: editing.id ? 'location.update' : 'location.create',
        targetType: 'location',
        targetId: saved.id,
        before,
        after: saved,
      });
      setEditing(null);
      await load();
    } catch (e) {
      setError(e?.message || 'Could not save the location.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!removing) return;
    setBusy(true);
    setError(null);
    try {
      await deleteLocation(removing.id);
      logAction({ action: 'location.delete', targetType: 'location', targetId: removing.id, before: removing });
      setRemoving(null);
      await load();
    } catch (e) {
      setError(e?.message || 'Could not delete the location.');
    } finally {
      setBusy(false);
    }
  }

  const set = (k) => (e) => setEditing(d => ({ ...d, [k]: e.target.value }));

  return (
    <div className="st-stack">
      <Card>
        <CardHeader
          title="Locations"
          icon={MapPin}
          subtitle="Where customers return cups. Counter QR codes and the location chart use these."
          actions={canEdit && (
            <Button variant="primary" size="sm" icon={MapPinPlus} onClick={() => setEditing({ ...BLANK })}>
              Add location
            </Button>
          )}
        />
        <CardBody flush>
          {error && <p className="st-error st-pad" role="alert">{error}</p>}
          {rows === null ? (
            <p className="st-hint st-pad">Loading locations…</p>
          ) : rows.length === 0 ? (
            <EmptyState icon={MapPin} title="No locations yet">
              Add the places where customers return cups. A venue with one counter needs one location.
            </EmptyState>
          ) : (
            <div className="st-table-wrap">
              <table className="ui-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Address</th>
                    <th>Phone</th>
                    <th>Status</th>
                    {canEdit && <th aria-label="Actions" />}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.id}>
                      <td><b>{r.name}</b></td>
                      <td>{[r.address, r.postal_code, r.city].filter(Boolean).join(', ') || '—'}</td>
                      <td className="st-mono">{r.phone || '—'}</td>
                      <td>
                        <Badge tone={r.status === 'active' ? 'success' : 'neutral'}>
                          {r.status === 'active' ? 'Open' : 'Closed'}
                        </Badge>
                      </td>
                      {canEdit && (
                        <td className="st-row-actions">
                          <Button variant="ghost" size="sm" icon={Pencil} aria-label={`Edit ${r.name}`} onClick={() => setEditing({ ...BLANK, ...r })} />
                          <Button variant="danger-ghost" size="sm" icon={Trash2} aria-label={`Delete ${r.name}`} onClick={() => setRemoving(r)} />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <Modal
        open={!!editing}
        onClose={() => !busy && setEditing(null)}
        title={editing?.id ? `Edit ${editing.name || 'location'}` : 'Add a location'}
        icon={MapPin}
        footer={(
          <>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={busy}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={busy || !editing?.name?.trim()}>
              {busy ? 'Saving…' : 'Save location'}
            </Button>
          </>
        )}
      >
        {editing && (
          <div className="st-fields">
            <Field label="Name" htmlFor="loc-name">
              <input id="loc-name" className="ui-input" autoFocus value={editing.name} onChange={set('name')} placeholder="e.g. Amsterdam Damrak" />
            </Field>
            <Field label="Status" htmlFor="loc-status">
              <select id="loc-status" className="ui-select" value={editing.status} onChange={set('status')}>
                <option value="active">Open</option>
                <option value="inactive">Closed</option>
              </select>
            </Field>
            <Field label="Street and number" htmlFor="loc-address">
              <input id="loc-address" className="ui-input" value={editing.address || ''} onChange={set('address')} />
            </Field>
            <Field label="Postal code" htmlFor="loc-postal">
              <input id="loc-postal" className="ui-input" value={editing.postal_code || ''} onChange={set('postal_code')} />
            </Field>
            <Field label="City" htmlFor="loc-city">
              <input id="loc-city" className="ui-input" value={editing.city || ''} onChange={set('city')} />
            </Field>
            <Field label="Phone" htmlFor="loc-phone">
              <input id="loc-phone" className="ui-input" value={editing.phone || ''} onChange={set('phone')} placeholder="+31 …" />
            </Field>
          </div>
        )}
      </Modal>

      <Modal
        open={!!removing}
        onClose={() => !busy && setRemoving(null)}
        title={`Delete ${removing?.name || 'this location'}?`}
        subtitle="This can’t be undone."
        icon={Trash2}
        iconTone="rose"
        footer={(
          <>
            <Button variant="outline" onClick={() => setRemoving(null)} disabled={busy}>Cancel</Button>
            <Button variant="danger" onClick={remove} disabled={busy}>{busy ? 'Deleting…' : 'Delete location'}</Button>
          </>
        )}
      >
        <p className="st-modal-text">
          Scans recorded here stay, but they no longer count toward a location. Counter QR codes printed
          for it may stop working. If the location is only closed for now, set its status to Closed instead.
        </p>
      </Modal>
    </div>
  );
}
