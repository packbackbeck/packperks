import { useState } from 'react';
import {
  Banknote, ChevronRight, Globe2, Map as MapIcon, Pencil, Plus, Send, Store, Tags, Trash2, TriangleAlert,
} from 'lucide-react';
import { saveRegionsConfig } from '../lib/adminApi';
import { DEFAULT_REGIONS, formatCurrency, getAllRegions, normalizeRegion, regionForCountry } from '../../lib/regions';
import { paymentProviderOptions } from '../../lib/payments';
import { COUNTRIES } from '../../lib/onboarding';
import { OrgAvatar } from '../context/OrgSwitcher';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Modal, Segmented, Switch } from '../ui';
import Drawer from './Drawer';
import { Callout, DiscardModal, SaveFooter, Sec } from './OrgBits';
import { payoutPromise, plural, providerInfo } from './orgShared';

const BUILT_IN = Object.keys(DEFAULT_REGIONS);

/* Regions: the currency, payout provider and payout promise for every venue
 * whose country falls in one. Built-in regions ship in code; edits and new
 * regions are stored in app_config `published:regions` and laid over them. */
export default function RegionsPanel({ orgs, cfg, onSaved, onEditOrg }) {
  const [editing, setEditing] = useState(null);   // region key
  const [creating, setCreating] = useState(null); // { key, label, currency }
  const [createError, setCreateError] = useState(null);
  const [busy, setBusy] = useState(false);

  // The registry already has the stored overlay applied (OrganisationsPanel).
  const regions = cfg ? getAllRegions() : [];
  const venuesByRegion = { none: [] };
  (orgs || []).filter(o => !o.deleted_at).forEach(o => {
    const k = regionForCountry(o.country)?.key || 'none';
    (venuesByRegion[k] ||= []).push(o);
  });

  async function persist(next, message) {
    setBusy(true);
    try {
      await saveRegionsConfig(next);
      await onSaved(next, message);
      return null;
    } catch (e) {
      return e?.message || 'Could not save the regions.';
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    const key = creating.key.trim().toUpperCase();
    if (!/^[A-Z]{2,4}$/.test(key)) { setCreateError('The code is 2 to 4 letters, like SA.'); return; }
    if (regions.some(r => r.key === key)) { setCreateError(`${key} already exists.`); return; }
    if (!/^[A-Z]{3}$/.test(creating.currency.trim().toUpperCase())) { setCreateError('The currency is a 3-letter code, like SAR.'); return; }
    const region = normalizeRegion(key, {
      label: creating.label.trim() || key,
      currency: creating.currency.trim().toUpperCase(),
      symbol: creating.currency.trim().toUpperCase(),
      currencyLocale: 'en',
      provider: 'none',
      countries: [key],
      onboardingKeys: [],
      map: { lat: 0, lng: 0, zoom: 6 },
      payoutStyle: 'direct',
      enabled: false,
    });
    setCreateError(null);
    const err = await persist({ ...(cfg || {}), [key]: region }, `${region.label} is added. Customers can’t pick it until you switch it on.`);
    if (err) { setCreateError(err); return; }
    setCreating(null);
    setEditing(key);
  }

  const editRegion = editing && regions.find(r => r.key === editing);
  const unassigned = venuesByRegion.none || [];

  return (
    <Card>
      <CardHeader
        title="Regions"
        icon={Globe2}
        ruled
        subtitle="A region sets the currency, the payout provider and what customers are promised, for every venue whose country is in it."
        actions={(
          <Button variant="primary" icon={Plus} onClick={() => { setCreateError(null); setCreating({ key: '', label: '', currency: '' }); }}>
            New region
          </Button>
        )}
      />
      <CardBody flush>
        {unassigned.length > 0 && (
          <div className="ms-pad">
            <Callout tone="warn" title={`${plural(unassigned.length, 'venue')} match no region`}>
              {unassigned.map((o, i) => (
                <span key={o.id}>
                  {i > 0 && ', '}
                  <button type="button" className="ms-link" onClick={() => onEditOrg(o.id)}>{o.name}</button>
                </span>
              ))}
              . They fall back to the Netherlands. Pick a region in each venue’s profile.
            </Callout>
          </div>
        )}
        {cfg === null ? (
          <p className="ms-hint ms-pad ms-pad--b">Loading regions…</p>
        ) : regions.length === 0 ? (
          <EmptyState icon={Globe2} title="No regions" />
        ) : (
          <div className="ms-table-wrap">
            <table className="ui-table ms-grid">
              <thead>
                <tr>
                  <th>Region</th>
                  <th>Money</th>
                  <th>Payouts</th>
                  <th>Customers are told</th>
                  <th>In customer picker</th>
                  <th className="ui-num">Venues</th>
                  <th aria-label="Open" />
                </tr>
              </thead>
              <tbody>
                {regions.map(r => {
                  const p = providerInfo(r.provider);
                  const venues = venuesByRegion[r.key] || [];
                  return (
                    <tr key={r.key} className="ms-grid__row" onClick={() => setEditing(r.key)}>
                      <td>
                        <button type="button" className="ms-grid__name" onClick={(e) => { e.stopPropagation(); setEditing(r.key); }}>
                          <span className="ms-flag" aria-hidden="true">{r.flag || r.key}</span>
                          <span className="ms-grid__titles">
                            <b>{r.label}</b>
                            <span className="ms-mono">{r.key}{BUILT_IN.includes(r.key) ? ' · built in' : ''}</span>
                          </span>
                        </button>
                      </td>
                      <td>
                        <span className="ms-grid__titles">
                          <b>{r.currency}</b>
                          <span className="ms-dim">{formatCurrency(4.8, r.currency, r.currencyLocale)}</span>
                        </span>
                      </td>
                      <td>
                        <span className="ms-grid__titles">
                          <span>{p.label}</span>
                          <span><Badge tone={p.live ? 'success' : 'warning'}>{p.live ? 'Live' : 'Not live'}</Badge></span>
                        </span>
                      </td>
                      <td>{r.payoutStyle === 'link' ? `A ${r.payoutNoun} to collect` : 'Cashback is sent to them'}</td>
                      <td>{r.enabled ? <Badge tone="success">Shown</Badge> : <Badge tone="neutral">Hidden</Badge>}</td>
                      <td className="ui-num">{venues.length}</td>
                      <td className="ms-row-actions"><ChevronRight size={16} className="ms-dim" aria-hidden="true" /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="ms-foot-note">
          A venue belongs to a region through its country, which you set in the venue’s profile.
          Saved regions reach the customer app without a deploy.
        </p>
      </CardBody>

      {editRegion && (
        <RegionEditor
          key={editRegion.key}
          region={editRegion}
          stored={cfg?.[editRegion.key]}
          venues={venuesByRegion[editRegion.key] || []}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={(stored) => persist({ ...(cfg || {}), [editRegion.key]: stored }, `${stored.label} saved.`)}
          onDelete={async () => {
            const next = { ...(cfg || {}) };
            delete next[editRegion.key];
            const err = await persist(next, `${editRegion.label} is deleted.`);
            if (!err) setEditing(null);
            return err;
          }}
          onEditOrg={(id) => { setEditing(null); onEditOrg(id); }}
        />
      )}

      <Modal
        open={!!creating}
        onClose={() => !busy && setCreating(null)}
        title="New region"
        subtitle="It starts hidden from customers, with no payout provider. Set it up, then switch it on."
        icon={Globe2}
        footer={(
          <>
            {createError && <span className="ms-error ms-foot-error" role="alert">{createError}</span>}
            <Button variant="outline" onClick={() => setCreating(null)} disabled={busy}>Cancel</Button>
            <Button variant="primary" onClick={create} disabled={busy || !creating?.key.trim()}>{busy ? 'Adding…' : 'Add region'}</Button>
          </>
        )}
      >
        {creating && (
          <div className="ms-fields">
            <Field label="Code" htmlFor="new-region-key" hint="2 to 4 letters, usually the country code.">
              <input id="new-region-key" className="ui-input ms-upper" autoFocus value={creating.key} placeholder="SA" maxLength={4}
                onChange={e => setCreating(c => ({ ...c, key: e.target.value }))} />
            </Field>
            <Field label="Currency" htmlFor="new-region-cur" hint="The 3-letter code.">
              <input id="new-region-cur" className="ui-input ms-upper" value={creating.currency} placeholder="SAR" maxLength={3}
                onChange={e => setCreating(c => ({ ...c, currency: e.target.value }))} />
            </Field>
            <div className="ms-span-2">
              <Field label="Name" htmlFor="new-region-label" hint="Venues in this region can use this name as their country.">
                <input id="new-region-label" className="ui-input" value={creating.label} placeholder="Saudi Arabia"
                  onChange={e => setCreating(c => ({ ...c, label: e.target.value }))} />
              </Field>
            </div>
          </div>
        )}
      </Modal>
    </Card>
  );
}

/* ── One region ───────────────────────────────────────────────────── */
function toForm(r) {
  return {
    label: r.label || '',
    flag: r.flag || '',
    enabled: r.enabled !== false,
    currency: r.currency || '',
    symbol: r.symbol || '',
    currencyLocale: r.currencyLocale || '',
    provider: r.provider || 'none',
    payoutStyle: r.payoutStyle || 'direct',
    collectLabel: r.collectLabel || '',
    payoutNoun: r.payoutNoun || '',
    countries: (r.countries || []).join(', '),
    onboardingKeys: [...(r.onboardingKeys || [])],
    lat: String(r.map?.lat ?? ''),
    lng: String(r.map?.lng ?? ''),
    zoom: String(r.map?.zoom ?? ''),
  };
}

const FORM_LABELS = {
  label: 'Name', flag: 'Flag', enabled: 'Customer picker', currency: 'Currency', symbol: 'Symbol',
  currencyLocale: 'Number format', provider: 'Payout provider', payoutStyle: 'Payout promise',
  collectLabel: 'Collect button', payoutNoun: 'Payout name', countries: 'Country codes',
  onboardingKeys: 'Onboarding answer', lat: 'Map latitude', lng: 'Map longitude', zoom: 'Map zoom',
};

function RegionEditor({ region, stored, venues, busy, onClose, onSave, onDelete, onEditOrg }) {
  const [form, setForm] = useState(() => toForm(region));
  const stamp = JSON.stringify(region);
  const [seen, setSeen] = useState(stamp);
  if (stamp !== seen) { setSeen(stamp); setForm(toForm(region)); }
  const [error, setError] = useState(null);
  const [askDiscard, setAskDiscard] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const base = toForm(region);
  const changes = Object.keys(FORM_LABELS)
    .filter(k => JSON.stringify(form[k]) !== JSON.stringify(base[k]))
    .map(k => FORM_LABELS[k]);
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));
  const id = (k) => `rg-${k}-${region.key}`;
  const builtIn = BUILT_IN.includes(region.key);
  const provider = providerInfo(form.provider);
  const currency = form.currency.trim().toUpperCase();
  let example;
  try { example = formatCurrency(4.8, currency || 'EUR', form.currencyLocale.trim() || 'en'); } catch { example = '—'; }
  const knownOnboarding = COUNTRIES.map(c => c.key);
  const otherOnboarding = form.onboardingKeys.filter(k => !knownOnboarding.includes(k));

  async function save() {
    if (!form.label.trim()) { setError('Give the region a name.'); return; }
    if (!/^[A-Z]{3}$/.test(currency)) { setError('The currency is a 3-letter code, like EUR.'); return; }
    const lat = Number(form.lat); const lng = Number(form.lng); const zoom = Number(form.zoom);
    if (![lat, lng, zoom].every(Number.isFinite)) { setError('The map position needs numbers.'); return; }
    try { new Intl.NumberFormat(form.currencyLocale.trim() || 'en', { style: 'currency', currency }); } catch {
      setError('That number format or currency is not recognised.'); return;
    }
    const countries = form.countries.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    /* normalizeRegion carries every field the app reads; anything else already
     * stored for this region is kept underneath it. */
    const next = {
      ...(stored || {}),
      ...normalizeRegion(region.key, {
        ...region,
        label: form.label.trim(),
        flag: form.flag.trim(),
        enabled: form.enabled,
        currency,
        symbol: form.symbol.trim() || currency,
        currencyLocale: form.currencyLocale.trim() || 'en',
        provider: form.provider,
        payoutStyle: form.payoutStyle,
        collectLabel: form.collectLabel.trim() || undefined,
        payoutNoun: form.payoutNoun.trim() || undefined,
        countries: countries.length ? countries : [region.key],
        onboardingKeys: form.onboardingKeys,
        map: { lat, lng, zoom },
      }),
    };
    setError(null);
    const err = await onSave(next);
    if (err) setError(err);
  }

  function toggleOnboarding(key, on) {
    setForm(f => ({ ...f, onboardingKeys: on ? [...f.onboardingKeys, key] : f.onboardingKeys.filter(k => k !== key) }));
  }

  return (
    <>
      <Drawer
        open
        onClose={() => (changes.length ? setAskDiscard(true) : onClose())}
        label={`Edit ${region.label}`}
        lead={<span className="ms-flag ms-flag--lg" aria-hidden="true">{region.flag || region.key}</span>}
        title={region.label}
        subtitle={<span className="ms-mono">{region.key}{builtIn ? ' · built in' : ''}</span>}
        badges={(
          <>
            <span className="ms-chip"><Banknote size={11} aria-hidden="true" />{region.currency}</span>
            <Badge tone={providerInfo(region.provider).live ? 'success' : 'warning'}>
              {providerInfo(region.provider).live ? 'Payouts live' : 'Payouts not live'}
            </Badge>
            <Badge tone={region.enabled ? 'success' : 'neutral'}>{region.enabled ? 'Customers can pick it' : 'Hidden from customers'}</Badge>
            <span className="ms-chip"><Store size={11} aria-hidden="true" />{plural(venues.length, 'venue')}</span>
          </>
        )}
        footer={(
          <SaveFooter
            changes={changes}
            saving={busy}
            error={error}
            onDiscard={() => { setForm(base); setError(null); }}
            onSave={save}
            saveLabel="Save region"
          />
        )}
      >
        <div className="ms-secs">
          <Sec title="Name" icon={Globe2}>
            <div className="ms-fields">
              <Field label="Name" htmlFor={id('label')} hint="A venue whose country is this name belongs here.">
                <input id={id('label')} className="ui-input" value={form.label} onChange={set('label')} />
              </Field>
              <Field label="Flag" htmlFor={id('flag')} hint="An emoji, shown in the customer’s region picker.">
                <input id={id('flag')} className="ui-input" value={form.flag} onChange={set('flag')} placeholder="🇳🇱" />
              </Field>
            </div>
            <div className="ms-switchrow">
              <div>
                <p className="ms-switchrow__title">Customers can pick this region</p>
                <p className="ms-switchrow__hint">In Edit profile. Venues in the region work either way.</p>
              </div>
              <Switch checked={form.enabled} label="Customers can pick this region" onChange={(on) => setForm(f => ({ ...f, enabled: on }))} />
            </div>
          </Sec>

          <Sec title="Money" icon={Banknote} hint="How amounts look in the customer app and in this dashboard.">
            <div className="ms-fields ms-fields--3">
              <Field label="Currency" htmlFor={id('currency')}>
                <input id={id('currency')} className="ui-input ms-upper" maxLength={3} value={form.currency} onChange={set('currency')} />
              </Field>
              <Field label="Symbol" htmlFor={id('symbol')}>
                <input id={id('symbol')} className="ui-input" value={form.symbol} onChange={set('symbol')} placeholder={currency} />
              </Field>
              <Field label="Number format" htmlFor={id('locale')} hint="A locale code.">
                <input id={id('locale')} className="ui-input" value={form.currencyLocale} onChange={set('currencyLocale')} placeholder="en-IE" />
              </Field>
            </div>
            <p className="ms-note">4.80 shows as <b>{example}</b>.</p>
          </Sec>

          <Sec title="Payouts" icon={Send} hint="Who pays approved cashback, and what customers are promised before it arrives.">
            <Field label="Payout provider" htmlFor={id('provider')}>
              <select id={id('provider')} className="ui-select" value={form.provider} onChange={set('provider')}>
                {paymentProviderOptions().map(p => (
                  <option key={p.key} value={p.key}>{p.label}{p.live ? '' : ' (not live)'}</option>
                ))}
                {!paymentProviderOptions().some(p => p.key === form.provider) && <option value={form.provider}>{form.provider} (unknown)</option>}
              </select>
            </Field>
            {!provider.live && (
              <Callout tone="warn" title="No live payout provider">
                Approved claims in this region can’t be paid out automatically.
              </Callout>
            )}
            <div className="ui-field">
              <span className="ui-field__label">What customers are promised</span>
              <Segmented
                ariaLabel="What customers are promised"
                value={form.payoutStyle}
                onChange={(v) => setForm(f => ({ ...f, payoutStyle: v }))}
                options={[
                  { id: 'direct', label: 'The cashback is sent to them' },
                  { id: 'link', label: 'A link to collect it' },
                ]}
              />
              <span className="ui-field__hint">
                Customers read: “Once your receipt is approved, {payoutPromise(form.payoutStyle, form.payoutNoun.trim())}.”
              </span>
            </div>
            {form.payoutStyle === 'link' && !provider.live && (
              <Callout tone="warn" title="This promises a link nobody can send yet">
                Keep “The cashback is sent to them” until a live provider can send links here.
              </Callout>
            )}
            <div className="ms-fields">
              <Field label="Collect button" htmlFor={id('collect')} hint="On the wallet and on approved claims.">
                <input id={id('collect')} className="ui-input" value={form.collectLabel} onChange={set('collectLabel')} placeholder="Collect your cashback" />
              </Field>
              <Field label="Payout name" htmlFor={id('noun')} hint="Used in “we’ll send you a …”.">
                <input id={id('noun')} className="ui-input" value={form.payoutNoun} onChange={set('payoutNoun')} placeholder="payment link" />
              </Field>
            </div>
          </Sec>

          <Sec title="Which venues and customers belong here" icon={Tags}>
            <Field label="Country codes" htmlFor={id('countries')} hint="Separated by commas. A venue whose country is one of these codes, or the name above, is in this region.">
              <input id={id('countries')} className="ui-input ms-upper" value={form.countries} onChange={set('countries')} placeholder="NL, NLD" />
            </Field>
            <div className="ui-field">
              <span className="ui-field__label">Onboarding answer</span>
              <div className="ms-checks">
                {COUNTRIES.map(c => (
                  <label key={c.key} className="ms-check">
                    <input type="checkbox" checked={form.onboardingKeys.includes(c.key)} onChange={e => toggleOnboarding(c.key, e.target.checked)} />
                    <span>{c.emoji} {c.label}</span>
                  </label>
                ))}
              </div>
              <span className="ui-field__hint">
                A new customer who picks this country when they start is placed in this region.
                {otherOnboarding.length > 0 && ` Also kept: ${otherOnboarding.join(', ')}.`}
              </span>
            </div>
          </Sec>

          <Sec title="Market page map" icon={MapIcon} hint="Where the map on the market page starts for customers in this region.">
            <div className="ms-fields ms-fields--3">
              <Field label="Latitude" htmlFor={id('lat')}>
                <input id={id('lat')} className="ui-input" type="number" step="0.01" value={form.lat} onChange={set('lat')} />
              </Field>
              <Field label="Longitude" htmlFor={id('lng')}>
                <input id={id('lng')} className="ui-input" type="number" step="0.01" value={form.lng} onChange={set('lng')} />
              </Field>
              <Field label="Zoom" htmlFor={id('zoom')} hint="1 is the world, 18 a street.">
                <input id={id('zoom')} className="ui-input" type="number" step="1" min="1" max="18" value={form.zoom} onChange={set('zoom')} />
              </Field>
            </div>
          </Sec>

          <Sec title={`Venues in ${region.label}`} icon={Store} hint="To move a venue, change the region in its profile.">
            {venues.length === 0 ? (
              <p className="ms-empty-line">No venues yet.</p>
            ) : (
              <ul className="ms-venues">
                {venues.map(o => (
                  <li key={o.id} className="ms-venue">
                    <OrgAvatar org={o} size={28} />
                    <span className="ms-venue__text">
                      <span className="ms-venue__name">{o.name}</span>
                      <span className="ms-venue__meta"><span className="ms-mono">/{o.slug}/</span><span>· country “{o.country}”</span></span>
                    </span>
                    <Button size="sm" variant="ghost" icon={Pencil} onClick={() => onEditOrg(o.id)}>Edit</Button>
                  </li>
                ))}
              </ul>
            )}
          </Sec>

          {builtIn ? (
            <p className="ms-note">{region.label} is built in: you can change it, but not delete it.</p>
          ) : (
            <Sec
              title="Delete region"
              icon={Trash2}
              danger
              hint={venues.length
                ? `${plural(venues.length, 'venue')} in this region fall back to the Netherlands when it is gone.`
                : 'No venue uses it.'}
              action={<Button size="sm" variant="danger-ghost" icon={Trash2} disabled={busy} onClick={() => setDeleting(true)}>Delete region</Button>}
            />
          )}
        </div>
      </Drawer>

      <DiscardModal open={askDiscard} onKeep={() => setAskDiscard(false)} onDiscard={() => { setAskDiscard(false); onClose(); }} />

      <Modal
        open={deleting}
        onClose={() => !busy && setDeleting(false)}
        title={`Delete ${region.label}?`}
        icon={TriangleAlert}
        iconTone="rose"
        footer={(
          <>
            <Button variant="outline" onClick={() => setDeleting(false)} disabled={busy}>Cancel</Button>
            <Button variant="danger" disabled={busy} onClick={async () => {
              const err = await onDelete();
              if (err) setError(err);
              setDeleting(false);
            }}>Delete region</Button>
          </>
        )}
      >
        <p className="ms-modal-text">
          {venues.length
            ? `${plural(venues.length, 'venue')} (${venues.map(v => v.name).join(', ')}) then show euros and pay out through Tikkie, like the Netherlands.`
            : 'No venue is in this region.'}
          {' '}Customers who picked it fall back too.
        </p>
      </Modal>
    </>
  );
}
