import { useEffect, useMemo, useState } from 'react';
import { getRegionsConfig, saveRegionsConfig, setOrgRegion } from '../lib/adminApi';
import { DEFAULT_REGIONS, normalizeRegion, setRegions, regionForCountry, formatMoney } from '../../lib/regions';
import { paymentProviderOptions, PAYMENT_PROVIDERS } from '../../lib/payments';

/* ─────────────────────────────────────────────────────────────────────
 * RegionsPanel — platform-level region management, embedded at the TOP of
 * the Organisations page (the Region → Group → Org hierarchy).
 *
 * A region decides, for every vendor tagged to it: the currency shown in the
 * app, the map focus, and which payout provider pays cashback. The built-in
 * NL/AE regions ship in code; anything an admin adds/edits here is saved to
 * app_config `published:regions` and merged over that seed — so a new region
 * needs no deploy. Assigning an org to a region sets its country.
 * ───────────────────────────────────────────────────────────────────── */

const BUILT_IN = Object.keys(DEFAULT_REGIONS); // NL, AE — can be edited/disabled, not deleted

/* Merge the saved overlay over the code defaults → the full display list. */
function mergeRegions(cfg) {
  const keys = [...new Set([...Object.keys(DEFAULT_REGIONS), ...Object.keys(cfg || {})])];
  const out = {};
  keys.forEach((k) => { out[k] = normalizeRegion(k, { ...(DEFAULT_REGIONS[k] || {}), ...(cfg?.[k] || {}) }); });
  return out;
}

function providerLabel(key) {
  return PAYMENT_PROVIDERS[key]?.label || (key ? `${key} (not configured)` : 'None');
}
function providerLive(key) {
  return !!PAYMENT_PROVIDERS[key]?.edgeFunction;
}

const chip = (bg, color) => ({
  display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px',
  borderRadius: 999, fontSize: 11.5, fontWeight: 700, background: bg, color,
});

export default function RegionsPanel({ orgs = [], onChanged }) {
  const [cfg, setCfg] = useState(null);       // saved overlay object
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(null);   // region key
  const [draft, setDraft] = useState(null);         // draft for the expanded region
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [addSel, setAddSel] = useState({});         // regionKey → orgId to assign

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const c = await getRegionsConfig();
      setCfg(c || {});
      setRegions(c || {});   // so the admin's own region resolution knows added regions
    } catch (e) {
      setError(e.message || 'Failed to load regions.');
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const regions = useMemo(() => mergeRegions(cfg || {}), [cfg]);

  // org id lists per region (by the org's country).
  const orgsByRegion = useMemo(() => {
    const m = {};
    (orgs || []).filter(o => !o.deleted_at).forEach((o) => {
      const rk = regionForCountry(o.country)?.key || null;
      if (!rk) { (m.__unassigned ||= []).push(o); return; }
      (m[rk] ||= []).push(o);
    });
    return m;
  }, [orgs, cfg]);

  const unassigned = orgsByRegion.__unassigned || [];

  async function persist(nextCfg) {
    setBusy(true); setError(null);
    try {
      await saveRegionsConfig(nextCfg);
      setCfg(nextCfg);
      setRegions(nextCfg);
      await onChanged?.();
    } catch (e) {
      setError(e.message || 'Could not save.');
    } finally { setBusy(false); }
  }

  function openEditor(key) {
    if (expanded === key) { setExpanded(null); setDraft(null); return; }
    const r = regions[key];
    setExpanded(key);
    setDraft({
      label: r.label, flag: r.flag, currency: r.currency, symbol: r.symbol,
      currencyLocale: r.currencyLocale, provider: r.provider,
      countries: r.countries.join(', '), onboardingKeys: r.onboardingKeys.join(', '),
      lat: r.map.lat, lng: r.map.lng, zoom: r.map.zoom, enabled: r.enabled,
    });
  }

  function draftToStored(d) {
    return {
      label: d.label?.trim() || undefined,
      flag: d.flag?.trim() || undefined,
      currency: (d.currency || 'EUR').trim().toUpperCase(),
      symbol: d.symbol?.trim() || undefined,
      currencyLocale: d.currencyLocale?.trim() || undefined,
      provider: d.provider || 'none',
      countries: String(d.countries || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean),
      onboardingKeys: String(d.onboardingKeys || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
      map: { lat: Number(d.lat) || 0, lng: Number(d.lng) || 0, zoom: Number(d.zoom) || 7 },
      enabled: d.enabled !== false,
    };
  }

  async function saveRegion(key) {
    const next = { ...(cfg || {}), [key]: draftToStored(draft) };
    await persist(next);
    setExpanded(null); setDraft(null);
  }

  async function deleteRegion(key) {
    if (BUILT_IN.includes(key)) return; // built-ins can only be disabled
    const next = { ...(cfg || {}) };
    delete next[key];
    await persist(next);
    if (expanded === key) { setExpanded(null); setDraft(null); }
  }

  async function addRegion() {
    const key = newKey.trim().toUpperCase();
    if (!key || !/^[A-Z]{2,4}$/.test(key)) { setError('Region code must be 2–4 letters (e.g. SA).'); return; }
    if (regions[key]) { setError(`Region ${key} already exists.`); return; }
    const next = {
      ...(cfg || {}),
      [key]: draftToStored({ label: newLabel.trim() || key, currency: 'USD', provider: 'none', zoom: 6, countries: key, enabled: true }),
    };
    await persist(next);
    setCreating(false); setNewKey(''); setNewLabel('');
    setExpanded(key); openEditor(key);
  }

  async function assignOrg(regionKey) {
    const orgId = addSel[regionKey];
    if (!orgId) return;
    const country = (regions[regionKey].countries[0]) || regionKey;
    setBusy(true); setError(null);
    try {
      await setOrgRegion(orgId, country);
      setAddSel(s => ({ ...s, [regionKey]: '' }));
      await onChanged?.();
    } catch (e) { setError(e.message || 'Could not assign.'); }
    finally { setBusy(false); }
  }

  const set = (patch) => setDraft(d => ({ ...d, ...patch }));

  return (
    <section className="og-panel">
      <header className="og-panel__head">
        <div>
          <span className="og-eyebrow">Multi-regional · platform</span>
          <h2 className="og-panel__title">Regions</h2>
          <p className="og-panel__sub">
            A region sets the <strong>currency</strong>, <strong>map focus</strong> and
            <strong> payout provider</strong> for every vendor tagged to it. Netherlands and UAE
            ship built-in; add more here — no deploy needed. Assigning an org to a region sets its
            country, which the customer app reads to pick currency + payment.
          </p>
        </div>
        {!creating && (
          <button className="ao-btn ao-btn--primary" onClick={() => setCreating(true)} disabled={busy}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            New region
          </button>
        )}
      </header>

      {error && <div className="ao-error">{error}</div>}

      {creating && (
        <div className="og-create">
          <div className="og-create__row" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <label className="og-field" style={{ marginBottom: 0 }}>
              <span className="og-field__label">Region code (2–4 letters)</span>
              <input className="og-input og-input--sm" style={{ textTransform: 'uppercase', maxWidth: 160 }}
                placeholder="e.g. SA" value={newKey} onChange={e => setNewKey(e.target.value)} autoFocus />
            </label>
            <label className="og-field" style={{ marginBottom: 0, flex: 1, minWidth: 200 }}>
              <span className="og-field__label">Name</span>
              <input className="og-input og-input--sm" placeholder="e.g. Saudi Arabia"
                value={newLabel} onChange={e => setNewLabel(e.target.value)} />
            </label>
          </div>
          <div className="og-create__actions">
            <button className="ao-btn ao-btn--ghost" onClick={() => { setCreating(false); setNewKey(''); setNewLabel(''); setError(null); }} disabled={busy}>Cancel</button>
            <button className="ao-btn ao-btn--primary" onClick={addRegion} disabled={busy || !newKey.trim()}>Create region</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="ao-skeleton">Loading regions…</div>
      ) : (
        <div className="og-list">
          {Object.values(regions).map((r) => {
            const isOpen = expanded === r.key;
            const rOrgs = orgsByRegion[r.key] || [];
            const live = providerLive(r.provider);
            return (
              <div key={r.key} className={`og-card ${isOpen ? 'og-card--open' : ''}`}>
                <button type="button" className="og-card__head" onClick={() => openEditor(r.key)} aria-expanded={isOpen}>
                  <span className="og-card__chev" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
                  <span className="og-card__name">{r.flag} {r.label}</span>
                  <code className="og-member__slug">{r.key}</code>
                  <span style={chip('#F1E9DA', '#6B6154')}>{r.symbol} {r.currency}</span>
                  <span style={chip(live ? '#E3F3E8' : '#FBEAE6', live ? '#1A8737' : '#C0392B')} title={live ? 'Payout provider is live' : 'No live payout adapter for this region yet'}>
                    {providerLabel(r.provider)}
                  </span>
                  {!r.enabled && <span style={chip('#EEE', '#999')}>disabled</span>}
                  <span className="og-card__count">{rOrgs.length} {rOrgs.length === 1 ? 'vendor' : 'vendors'}</span>
                </button>

                {isOpen && draft && (
                  <div className="og-card__body">
                    <div className="og-section">
                      <span className="og-section__title">Region settings</span>
                      <div className="og-editor__grid">
                        <label className="og-cf"><span className="og-cf__label">Name</span>
                          <input className="og-cf__input" value={draft.label} onChange={e => set({ label: e.target.value })} /></label>
                        <label className="og-cf"><span className="og-cf__label">Flag emoji</span>
                          <input className="og-cf__input" value={draft.flag} onChange={e => set({ flag: e.target.value })} placeholder="🇸🇦" /></label>
                        <label className="og-cf"><span className="og-cf__label">Currency code</span>
                          <input className="og-cf__input" style={{ textTransform: 'uppercase' }} value={draft.currency} onChange={e => set({ currency: e.target.value })} placeholder="SAR" /></label>
                        <label className="og-cf"><span className="og-cf__label">Currency symbol</span>
                          <input className="og-cf__input" value={draft.symbol} onChange={e => set({ symbol: e.target.value })} placeholder="﷼" /></label>
                        <label className="og-cf"><span className="og-cf__label">Number locale</span>
                          <input className="og-cf__input" value={draft.currencyLocale} onChange={e => set({ currencyLocale: e.target.value })} placeholder="en-SA" /></label>
                        <label className="og-cf"><span className="og-cf__label">Payout provider</span>
                          <select className="og-cf__input" value={draft.provider} onChange={e => set({ provider: e.target.value })}>
                            {paymentProviderOptions().map(p => (
                              <option key={p.key} value={p.key}>{p.label}{p.edgeFunction ? '' : ' — pending'}</option>
                            ))}
                          </select></label>
                      </div>
                      <div className="og-editor__grid">
                        <label className="og-cf"><span className="og-cf__label">Countries (comma-sep codes)</span>
                          <input className="og-cf__input" value={draft.countries} onChange={e => set({ countries: e.target.value })} placeholder="SA, SAU" /></label>
                        <label className="og-cf"><span className="og-cf__label">Onboarding keys</span>
                          <input className="og-cf__input" value={draft.onboardingKeys} onChange={e => set({ onboardingKeys: e.target.value })} placeholder="saudi" /></label>
                        <label className="og-cf"><span className="og-cf__label">Map latitude</span>
                          <input className="og-cf__input" type="number" step="0.01" value={draft.lat} onChange={e => set({ lat: e.target.value })} /></label>
                        <label className="og-cf"><span className="og-cf__label">Map longitude</span>
                          <input className="og-cf__input" type="number" step="0.01" value={draft.lng} onChange={e => set({ lng: e.target.value })} /></label>
                        <label className="og-cf"><span className="og-cf__label">Map zoom</span>
                          <input className="og-cf__input" type="number" step="1" min="1" max="18" value={draft.zoom} onChange={e => set({ zoom: e.target.value })} /></label>
                        <label className="og-toggle" style={{ alignSelf: 'end' }} title="Offer this region in onboarding + new assignments">
                          <input type="checkbox" checked={draft.enabled} onChange={e => set({ enabled: e.target.checked })} />
                          <span className="og-toggle__track"><span className="og-toggle__thumb" /></span>
                          <span className="og-toggle__label">{draft.enabled ? 'Enabled' : 'Disabled'}</span>
                        </label>
                      </div>
                      <p className="og-hint">Example: <strong>{formatMoney(4.8, r.key)}</strong> renders in this region.</p>
                    </div>

                    {/* Vendors in this region + assignment */}
                    <div className="og-section">
                      <span className="og-section__title">Vendors in this region</span>
                      {rOrgs.length === 0 ? (
                        <p className="og-hint">No vendors yet. Assign one below (sets its country to {r.countries[0] || r.key}).</p>
                      ) : (
                        <ul className="og-members">
                          {rOrgs.map(o => (
                            <li key={o.id} className="og-member">
                              <span className="og-swatch" style={{ width: 22, height: 22, background: o.brand_color || '#FD6F46' }}>{(o.name || 'O').charAt(0).toUpperCase()}</span>
                              <span className="og-member__name">{o.name}</span>
                              <code className="og-member__slug">/{o.slug}/</code>
                              <span className="og-member__tag">{o.country || '—'}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="og-add">
                        <select className="og-select" value={addSel[r.key] || ''} onChange={e => setAddSel(s => ({ ...s, [r.key]: e.target.value }))} disabled={busy}>
                          <option value="">Assign a vendor to this region…</option>
                          {(orgs || []).filter(o => !o.deleted_at).map(o => (
                            <option key={o.id} value={o.id}>{o.name} (/{o.slug}/{o.country ? ` · ${o.country}` : ''})</option>
                          ))}
                        </select>
                        <button className="ao-btn ao-btn--ghost" onClick={() => assignOrg(r.key)} disabled={busy || !addSel[r.key]}>Assign</button>
                      </div>
                    </div>

                    <div className="og-card__foot">
                      {!BUILT_IN.includes(r.key) ? (
                        <button className="og-link og-link--danger" onClick={() => deleteRegion(r.key)} disabled={busy}>Delete region</button>
                      ) : <span className="og-hint">Built-in region (can be edited or disabled, not deleted).</span>}
                      <button className="ao-btn ao-btn--primary ao-btn--sm" onClick={() => saveRegion(r.key)} disabled={busy}>{busy ? 'Saving…' : 'Save region'}</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {unassigned.length > 0 && (
        <p className="og-hint" style={{ marginTop: 10 }}>
          <strong>{unassigned.length}</strong> vendor{unassigned.length === 1 ? '' : 's'} without a recognised region
          ({unassigned.map(o => o.name).join(', ')}). Assign each to a region above.
        </p>
      )}
    </section>
  );
}
