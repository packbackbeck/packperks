import { useEffect, useMemo, useState } from 'react';
import {
  createOrgGroup,
  renameOrgGroup,
  setOrgGroupMode,
  setGroupPaymentMethod,
  deleteOrgGroup,
  setOrgGroupMembership,
  setOrgGroupActive,
  saveGroupCopy,
  resetGroupCopy,
  getGroupStats,
  setGroupMultiRegion,
} from '../lib/adminApi';
import { MODE_META, getCopyPreset, COPY_MODES } from '../../lib/copyPresets';
import { PAYMENT_METHODS, PAYMENT_METHOD_META, DEFAULT_PAYMENT_METHOD } from '../../lib/paymentMethods';
import { regionForCountry } from '../../lib/regions';
import TypedConfirmModal from '../shared/TypedConfirmModal';
import { useAdminMoney } from '../lib/adminMoney';

/* Merge a group's saved copy overrides (config.settings.copy) over its mode
 * preset → the full effective bundle. Mirrors the customer app's
 * composeGroupCopy so the admin edits exactly what customers will see. */
function effectiveCopy(group) {
  const preset = getCopyPreset(group?.mode);
  const ov = group?.config?.settings?.copy || {};
  return {
    heroHeadline:   ov.heroHeadline || preset.heroHeadline,
    heroSubtext:    ov.heroSubtext  || preset.heroSubtext,
    storesIntro:    ov.storesIntro  || preset.storesIntro,
    designCopy:     { ...preset.designCopy, ...(ov.designCopy || {}) },
    howItWorks:     (ov.howItWorks && Array.isArray(ov.howItWorks.steps)) ? ov.howItWorks : preset.howItWorks,
    terms:          (ov.terms && Array.isArray(ov.terms.points))          ? ov.terms      : preset.terms,
    crossOrgNotice: ov.crossOrgNotice || preset.crossOrgNotice,
    dailyCapReview: ov.dailyCapReview || preset.dailyCapReview,
    scanSuccess:    ov.scanSuccess    || preset.scanSuccess,
  };
}

const DESIGN_COPY_LABELS = {
  badgeText:         'Cups badge',
  shareButtonLabel:  'Share button',
  donateButtonLabel: 'Donate button',
  nextCupFreeLabel:  'Next-cup label',
  activityLabel:     'Activity label',
  refundButtonLabel: 'Cash-out button',
};

/* ─────────────────────────────────────────────────────────────────────
 * OrgGroupsPanel — Phase 3 store-group management, embedded in the
 * PackPerks-staff Organisations page.
 *
 * A group ties several venues together so a customer keeps one identity
 * across them (per-store balances + a shared Stores page, built in later
 * stages). Each group has a copy "mode":
 *   • Deposit & return — the original model
 *   • Bring your own cup — no deposit, no bin (Phase 3 BYO)
 * The mode selects the default customer copy; the panel previews that
 * copy so staff can confirm a BYO group actually reads bring-your-own.
 *
 * This panel is pure UI over adminApi: every mutation runs through
 * `run()` and then calls the parent's `onChanged` to reload the shared
 * orgs+groups data (so the org table's group chips stay in sync).
 * ───────────────────────────────────────────────────────────────────── */

function OrgSwatch({ org, size = 22 }) {
  if (org?.logo_url) {
    return <img src={org.logo_url} alt="" className="og-swatch og-swatch--img" style={{ width: size, height: size }} />;
  }
  return (
    <span className="og-swatch" style={{ width: size, height: size, background: org?.brand_color || '#FD6F46' }}>
      {(org?.name || 'O').charAt(0).toUpperCase()}
    </span>
  );
}

/* Read-only render of the effective customer copy (mode preset + any
 * saved overrides) so staff see exactly what the group will say. Pass a
 * `mode` (uses that mode's preset) or a full `copy` bundle. */
function ModePreview({ mode, copy }) {
  const p = copy || getCopyPreset(mode);
  return (
    <div className="og-preview">
      <div className="og-preview__hero">
        <span className="og-preview__eyebrow">Customer app preview</span>
        <div className="og-preview__headline">{p.heroHeadline}</div>
        <div className="og-preview__sub">{p.heroSubtext}</div>
      </div>
      <div className="og-preview__block">
        <div className="og-preview__label">{p.howItWorks.title}</div>
        <ol className="og-preview__steps">
          {p.howItWorks.steps.map((s, i) => (
            <li key={i}><strong>{s.title}.</strong> {s.body}</li>
          ))}
        </ol>
      </div>
      <div className="og-preview__block">
        <div className="og-preview__label">{p.terms.title}</div>
        <ul className="og-preview__terms">
          {p.terms.points.map((t, i) => <li key={i}>{t}</li>)}
        </ul>
      </div>
    </div>
  );
}

/* Combined group stats — totals + per-store breakdown. */
function GroupStats({ stats, loading }) {
  const { money } = useAdminMoney();
  if (loading) return <p className="og-hint">Loading stats…</p>;
  if (!stats) return <p className="og-hint">No stats yet.</p>;
  const t = stats.totals;
  const tiles = [
    { label: 'Stores',   value: t.stores },
    { label: 'Members',  value: t.users },
    { label: 'Cups now', value: t.cups },
    { label: 'Lifetime', value: t.lifetime },
    { label: 'Claims',   value: t.claims },
    { label: 'Payout',   value: money(t.payout || 0) },
  ];
  return (
    <div className="og-stats">
      <div className="og-stats__tiles">
        {tiles.map(x => (
          <div key={x.label} className="og-stat">
            <div className="og-stat__value">{x.value}</div>
            <div className="og-stat__label">{x.label}</div>
          </div>
        ))}
      </div>
      {stats.perStore.length > 1 && (
        <table className="og-stats__table">
          <thead>
            <tr><th>Store</th><th>Members</th><th>Cups</th><th>Lifetime</th><th>Claims</th><th>Payout</th></tr>
          </thead>
          <tbody>
            {stats.perStore.map(s => (
              <tr key={s.orgId}>
                <td>{s.name}</td>
                <td>{s.users}</td>
                <td>{s.cups}</td>
                <td>{s.lifetime}</td>
                <td>{s.claims}</td>
                <td>{money(s.payout || 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* Field helpers for the copy editor. */
function Field({ label, value, onChange, textarea, rows = 2, placeholder }) {
  return (
    <label className="og-cf">
      <span className="og-cf__label">{label}</span>
      {textarea
        ? <textarea className="og-cf__input" rows={rows} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} />
        : <input className="og-cf__input" type="text" value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} />}
    </label>
  );
}

/* Full customer-copy editor (A6). Manages a local draft initialised from
 * the group's effective copy; Save writes the whole bundle as overrides. */
function CopyEditor({ initial, busy, onSave, onReset, onCancel }) {
  const [d, setD] = useState(() => JSON.parse(JSON.stringify(initial)));

  const set = (patch) => setD(prev => ({ ...prev, ...patch }));
  const setStep = (i, key, val) => setD(prev => {
    const steps = prev.howItWorks.steps.map((s, idx) => idx === i ? { ...s, [key]: val } : s);
    return { ...prev, howItWorks: { ...prev.howItWorks, steps } };
  });
  const setNotice = (which, key, val) => setD(prev => ({ ...prev, [which]: { ...prev[which], [key]: val } }));

  function save() {
    // Normalise terms points from the textarea (one per line).
    const bundle = {
      ...d,
      terms: { ...d.terms, points: (d._termsText ?? d.terms.points.join('\n')).split('\n').map(s => s.trim()).filter(Boolean) },
    };
    delete bundle._termsText;
    onSave(bundle);
  }

  return (
    <div className="og-editor">
      <div className="og-editor__group">
        <div className="og-editor__gtitle">Hero</div>
        <Field label="Headline" value={d.heroHeadline} onChange={v => set({ heroHeadline: v })} />
        <Field label="Subtext" textarea value={d.heroSubtext} onChange={v => set({ heroSubtext: v })} />
        <Field
          label="Stores page intro"
          textarea
          rows={3}
          value={d.storesIntro || ''}
          onChange={v => set({ storesIntro: v })}
          placeholder="Shown under the logo on the multi-venue Stores page."
        />
      </div>

      <div className="og-editor__group">
        <div className="og-editor__gtitle">How it works</div>
        <Field label="Section title" value={d.howItWorks.title} onChange={v => set({ howItWorks: { ...d.howItWorks, title: v } })} />
        {d.howItWorks.steps.map((s, i) => (
          <div key={i} className="og-editor__step">
            <Field label={`Step ${i + 1} title`} value={s.title} onChange={v => setStep(i, 'title', v)} />
            <Field label={`Step ${i + 1} body`} textarea value={s.body} onChange={v => setStep(i, 'body', v)} />
          </div>
        ))}
      </div>

      <div className="og-editor__group">
        <div className="og-editor__gtitle">Terms</div>
        <Field label="Title" value={d.terms.title} onChange={v => set({ terms: { ...d.terms, title: v } })} />
        <Field label="Intro" textarea value={d.terms.intro} onChange={v => set({ terms: { ...d.terms, intro: v } })} />
        <Field
          label="Points (one per line)"
          textarea
          rows={5}
          value={d._termsText ?? d.terms.points.join('\n')}
          onChange={v => set({ _termsText: v })}
        />
      </div>

      <div className="og-editor__group">
        <div className="og-editor__gtitle">Messages</div>
        <Field label="Scan success · title" value={d.scanSuccess.title} onChange={v => setNotice('scanSuccess', 'title', v)} />
        <Field label="Scan success · body" textarea value={d.scanSuccess.body} onChange={v => setNotice('scanSuccess', 'body', v)} />
        <Field label="Different-store note · title" value={d.crossOrgNotice.title} onChange={v => setNotice('crossOrgNotice', 'title', v)} />
        <Field label="Different-store note · body" textarea value={d.crossOrgNotice.body} onChange={v => setNotice('crossOrgNotice', 'body', v)} />
        <Field label="Held-for-review · title" value={d.dailyCapReview.title} onChange={v => setNotice('dailyCapReview', 'title', v)} />
        <Field label="Held-for-review · body" textarea value={d.dailyCapReview.body} onChange={v => setNotice('dailyCapReview', 'body', v)} />
      </div>

      <div className="og-editor__group">
        <div className="og-editor__gtitle">Button labels</div>
        <div className="og-editor__grid">
          {Object.keys(d.designCopy).map(k => (
            <Field
              key={k}
              label={DESIGN_COPY_LABELS[k] || k}
              value={d.designCopy[k]}
              onChange={v => set({ designCopy: { ...d.designCopy, [k]: v } })}
            />
          ))}
        </div>
      </div>

      <div className="og-editor__actions">
        <button className="og-link og-link--danger" onClick={onReset} disabled={busy} title="Discard overrides and revert to the mode's default copy">
          Reset to default
        </button>
        <div className="og-editor__actions-right">
          <button className="ao-btn ao-btn--ghost ao-btn--sm" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="ao-btn ao-btn--primary ao-btn--sm" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save copy'}</button>
        </div>
      </div>
    </div>
  );
}

/* Two-button segmented mode picker. */
function ModePicker({ value, onChange, disabled, idPrefix }) {
  return (
    <div className="og-modepicker" role="radiogroup" aria-label="Copy mode">
      {COPY_MODES.map(m => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={value === m}
          className={`og-modeopt ${value === m ? 'og-modeopt--on' : ''}`}
          disabled={disabled}
          onClick={() => onChange(m)}
          id={idPrefix ? `${idPrefix}-${m}` : undefined}
        >
          <span className="og-modeopt__label">{MODE_META[m].label}</span>
          <span className="og-modeopt__blurb">{MODE_META[m].blurb}</span>
        </button>
      ))}
    </div>
  );
}


/* How every venue in the group settles a reward, unless it sets its own.
 * Switching it changes what customers are asked to do at the till, so the
 * choice is confirmed rather than applied on the first click. */
function PaymentPicker({ value, memberCount, disabled, onPick }) {
  const current = value || DEFAULT_PAYMENT_METHOD;
  return (
    <div className="og-paypicker" role="radiogroup" aria-label="Payment method">
      {PAYMENT_METHODS.map(m => (
        <button
          key={m.key}
          type="button"
          role="radio"
          aria-checked={current === m.key}
          className={`og-paytile ${current === m.key ? 'og-paytile--on' : ''}`}
          disabled={disabled}
          onClick={() => { if (m.key !== current) onPick(m.key); }}
        >
          <span className="og-paytile__head">
            <span className="og-paytile__label">{m.label}</span>
            {current === m.key && <span className="og-paytile__badge">In use</span>}
          </span>
          <span className="og-paytile__blurb">{m.blurb}</span>
          <span className="og-paytile__detail">{m.detail}</span>
        </button>
      ))}
      <p className="og-paypicker__note">
        Applies to {memberCount === 1 ? 'the venue' : `all ${memberCount} venues`} in this group that
        have not chosen their own method.
      </p>
    </div>
  );
}

function PaymentConfirm({ from, to, memberCount, busy, onCancel, onConfirm }) {
  const next = PAYMENT_METHOD_META[to];
  const prev = PAYMENT_METHOD_META[from] || PAYMENT_METHOD_META[DEFAULT_PAYMENT_METHOD];
  return (
    <div className="og-modal" role="dialog" aria-modal="true" aria-label="Change payment method">
      <div className="og-modal__backdrop" onClick={busy ? undefined : onCancel} />
      <div className="og-modal__card">
        <div className="og-modal__warn" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>
        <h3 className="og-modal__title">Switch to {next.label}?</h3>
        <p className="og-modal__body">
          Customers at {memberCount === 1 ? 'this venue' : `all ${memberCount} venues`} will stop
          using <strong>{prev.label}</strong> and start using <strong>{next.label}</strong> the next
          time they open the app.
        </p>
        <p className="og-modal__body og-modal__body--muted">
          {to === 'voucher'
            ? 'Rewards will be handed over at the counter. No receipt is uploaded, nothing is checked, and no money is sent — so staff need to know to take the phone and slide.'
            : 'Rewards will be paid out after review. Customers will need an email address, will have to photograph a receipt, and every claim will arrive here for approval.'}
        </p>
        <p className="og-modal__body og-modal__body--muted">
          Claims already recorded are not affected.
        </p>
        <div className="og-modal__actions">
          <button type="button" className="ao-btn" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className="ao-btn ao-btn--primary" onClick={onConfirm} disabled={busy}>
            {busy ? 'Switching…' : `Switch to ${next.short}`}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function OrgGroupsPanel({ orgs = [], groups = [], onChanged }) {
  const [creating, setCreating]   = useState(false);
  const [newName, setNewName]     = useState('');
  const [newMode, setNewMode]     = useState('byo'); // groups are the BYO feature → default BYO
  const [expandedId, setExpandedId] = useState(null);
  const [renamingId, setRenamingId] = useState(null);
  const [renameVal, setRenameVal]   = useState('');
  const [renameSlug, setRenameSlug] = useState('');
  const [addSel, setAddSel]         = useState({});     // groupId → orgId queued to add
  const [previewOpen, setPreviewOpen] = useState({});   // groupId → show copy preview
  const [confirmDelete, setConfirmDelete] = useState(null); // {id, name}
  const [payConfirm, setPayConfirm] = useState(null);       // {groupId, from, to, members}
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState(null);
  const [editingCopyId, setEditingCopyId] = useState(null); // group id whose copy editor is open
  const [statsById, setStatsById] = useState({});           // group id → stats
  const [statsLoadingId, setStatsLoadingId] = useState(null);

  const activeOrgs = useMemo(() => orgs.filter(o => !o.deleted_at), [orgs]);
  const ungrouped  = useMemo(() => activeOrgs.filter(o => !o.group_id), [activeOrgs]);

  // Lazily load a group's combined stats the first time it's expanded.
  useEffect(() => {
    if (!expandedId || statsById[expandedId]) return;
    let alive = true;
    setStatsLoadingId(expandedId);
    getGroupStats(expandedId)
      .then(s => { if (alive) setStatsById(prev => ({ ...prev, [expandedId]: s })); })
      .catch(e => console.warn('getGroupStats failed:', e))
      .finally(() => { if (alive) setStatsLoadingId(null); });
    return () => { alive = false; };
  }, [expandedId, statsById]);

  async function run(fn) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onChanged?.();
    } catch (e) {
      console.error('[OrgGroupsPanel]', e);
      setError(e.message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    run(async () => {
      const g = await createOrgGroup({ name, mode: newMode });
      setCreating(false);
      setNewName('');
      setNewMode('byo');
      if (g?.id) setExpandedId(g.id);
    });
  }

  function handleMode(groupId, mode) {
    // Switching mode resets copy overrides → close any open editor.
    setEditingCopyId(null);
    run(() => setOrgGroupMode(groupId, mode));
  }

  const payConfirmNode = payConfirm ? (
    <PaymentConfirm
      from={payConfirm.from}
      to={payConfirm.to}
      memberCount={payConfirm.members}
      busy={busy}
      onCancel={() => setPayConfirm(null)}
      onConfirm={handleConfirmPayment}
    />
  ) : null;

  function handleConfirmPayment() {
    const { groupId, to } = payConfirm;
    run(async () => {
      await setGroupPaymentMethod(groupId, to);
      setPayConfirm(null);
    });
  }

  function handleSaveCopy(groupId, bundle) {
    run(async () => {
      await saveGroupCopy(groupId, bundle);
      setEditingCopyId(null);
    });
  }

  function handleResetCopy(groupId) {
    run(async () => {
      await resetGroupCopy(groupId);
      setEditingCopyId(null);
    });
  }

  /* Moving an org in or out of a group rewrites what its customers see and
   * can silently kill printed QR codes, so both directions go through a
   * consequence list the admin has to type past. See membershipConfirm. */
  const [membershipConfirm, setMembershipConfirm] = useState(null);
  // { action: 'join'|'leave', orgId, groupId, org, group }

  function askAdd(groupId) {
    const orgId = addSel[groupId];
    if (!orgId) return;
    const org = orgs.find(o => o.id === orgId);
    const group = groups.find(g => g.id === groupId);
    setMembershipConfirm({ action: 'join', orgId, groupId, org, group });
  }

  function askRemove(org, group) {
    setMembershipConfirm({ action: 'leave', orgId: org.id, groupId: group?.id, org, group });
  }

  function confirmMembership() {
    const c = membershipConfirm;
    if (!c) return;
    run(async () => {
      await setOrgGroupMembership(c.orgId, c.action === 'join' ? c.groupId : null);
      if (c.action === 'join') setAddSel(s => ({ ...s, [c.groupId]: '' }));
      setMembershipConfirm(null);
    });
  }

  function handleToggleActive(org) {
    run(() => setOrgGroupActive(org.id, !org.group_active));
  }

  function handleMultiRegion(groupId, on) {
    run(() => setGroupMultiRegion(groupId, on));
  }

  // org id → country, for showing which regions a group's members span.
  const countryByOrg = useMemo(() => {
    const m = {};
    (orgs || []).forEach(o => { m[o.id] = o.country; });
    return m;
  }, [orgs]);

  function handleRename(groupId) {
    const name = renameVal.trim();
    if (!name) return;
    run(async () => {
      await renameOrgGroup(groupId, name, renameSlug.trim() || undefined);
      setRenamingId(null);
      setRenameVal('');
      setRenameSlug('');
    });
  }

  function handleDelete(groupId) {
    run(async () => {
      await deleteOrgGroup(groupId);
      setConfirmDelete(null);
      if (expandedId === groupId) setExpandedId(null);
    });
  }

  return (
    <section className="og-panel">
      <header className="og-panel__head">
        <div>
          <h2 className="og-panel__title">Store groups</h2>
          <p className="og-panel__sub">
            Group several venues so customers keep one account across them — each store still
            keeps its own cup balance. A group’s <strong>mode</strong> sets the default customer
            copy: choose <em>Bring your own cup</em> for the no-deposit model.
          </p>
        </div>
        {!creating && (
          <button className="ao-btn ao-btn--primary" onClick={() => setCreating(true)} disabled={busy}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            New group
          </button>
        )}
      </header>

      {error && <div className="ao-error">{error}</div>}

      {/* ── Create-group form (inline, A3: prompt for the default copy) ── */}
      {creating && (
        <div className="og-create">
          <div className="og-create__row">
            <label className="og-field">
              <span className="og-field__label">Group name</span>
              <input
                className="og-input"
                type="text"
                placeholder="e.g. Kaffa Coffee (Dubai + The Hague)"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                autoFocus
                onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
              />
            </label>
          </div>
          <div className="og-field">
            <span className="og-field__label">Copy mode</span>
            <ModePicker value={newMode} onChange={setNewMode} disabled={busy} idPrefix="new" />
          </div>
          <ModePreview mode={newMode} />
          <div className="og-create__actions">
            <button className="ao-btn ao-btn--ghost" onClick={() => { setCreating(false); setNewName(''); }} disabled={busy}>
              Cancel
            </button>
            <button className="ao-btn ao-btn--primary" onClick={handleCreate} disabled={busy || !newName.trim()}>
              {busy ? 'Creating…' : 'Create group'}
            </button>
          </div>
        </div>
      )}

      {/* ── Group list ── */}
      {groups.length === 0 && !creating ? (
        <div className="og-empty">
          <p>No store groups yet. Create one to link venues under a shared customer identity and a Bring-Your-Own copy set.</p>
        </div>
      ) : (
        <div className="og-list">
          {groups.map(group => {
            const meta = MODE_META[group.mode] || MODE_META.deposit;
            const members = group.members || [];
            const inStores = members.filter(m => m.group_active && !m.deleted_at).length;
            const isOpen = expandedId === group.id;
            const showPrev = !!previewOpen[group.id];
            return (
              <div key={group.id} className={`og-card ${isOpen ? 'og-card--open' : ''}`}>
                <button
                  type="button"
                  className="og-card__head"
                  onClick={() => setExpandedId(isOpen ? null : group.id)}
                  aria-expanded={isOpen}
                >
                  <span className="og-card__chev" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
                  <span className="og-card__name">{group.name}</span>
                  <span className={`og-badge og-badge--${group.mode}`}>{meta.label}</span>
                  <span className="og-card__count">
                    {members.length} {members.length === 1 ? 'store' : 'stores'}
                    {members.length > 0 && ` · ${inStores} in Stores list`}
                  </span>
                </button>

                {isOpen && (
                  <div className="og-card__body">
                    {/* Combined group stats */}
                    <div className="og-section">
                      <span className="og-section__title">Group stats</span>
                      <GroupStats stats={statsById[group.id]} loading={statsLoadingId === group.id} />
                    </div>

                    {/* Customer copy — mode template + editable overrides (A6) */}
                    <div className="og-section">
                      <div className="og-section__head">
                        <span className="og-section__title">Customer copy</span>
                        <div className="og-section__actions">
                          <button
                            type="button"
                            className="og-link"
                            onClick={() => setPreviewOpen(s => ({ ...s, [group.id]: !s[group.id] }))}
                          >
                            {showPrev ? 'Hide preview' : 'Preview'}
                          </button>
                          <button
                            type="button"
                            className="og-link"
                            onClick={() => setEditingCopyId(editingCopyId === group.id ? null : group.id)}
                          >
                            {editingCopyId === group.id ? 'Close editor' : 'Edit copy'}
                          </button>
                        </div>
                      </div>
                      <ModePicker value={group.mode} onChange={m => handleMode(group.id, m)} disabled={busy} idPrefix={`g-${group.id}`} />
                      {editingCopyId === group.id ? (
                        <CopyEditor
                          key={`${group.id}-${group.mode}`}
                          initial={effectiveCopy(group)}
                          busy={busy}
                          onSave={(bundle) => handleSaveCopy(group.id, bundle)}
                          onReset={() => handleResetCopy(group.id)}
                          onCancel={() => setEditingCopyId(null)}
                        />
                      ) : showPrev ? (
                        <ModePreview copy={effectiveCopy(group)} />
                      ) : null}
                    </div>

                    {/* Multi-region: flag a group whose vendors span regions */}
                    <div className="og-section">
                      <div className="og-section__head">
                        <span className="og-section__title">Regions</span>
                        <label className="og-toggle" title="Enable if this group's vendors span more than one region (different currencies + payout providers)">
                          <input
                            type="checkbox"
                            checked={!!group.config?.settings?.multiRegion}
                            onChange={e => handleMultiRegion(group.id, e.target.checked)}
                            disabled={busy}
                          />
                          <span className="og-toggle__track"><span className="og-toggle__thumb" /></span>
                          <span className="og-toggle__label">{group.config?.settings?.multiRegion ? 'Multi-region' : 'Single region'}</span>
                        </label>
                      </div>
                      {(() => {
                        const keys = [...new Set(members
                          .filter(m => !m.deleted_at)
                          .map(m => regionForCountry(countryByOrg[m.id])?.key)
                          .filter(Boolean))];
                        return (
                          <p className="og-hint">
                            {keys.length === 0
                              ? 'No regions yet — set each vendor’s country under Organisations → Regions.'
                              : <>Vendors here span: {keys.map(k => <code key={k} className="og-member__slug" style={{ marginRight: 6 }}>{k}</code>)}
                                 {keys.length > 1 && !group.config?.settings?.multiRegion && <strong> · turn on Multi-region.</strong>}</>}
                          </p>
                        );
                      })()}
                    </div>

                    {/* Members */}
                    <div className="og-section">
                      <span className="og-section__title">Stores in this group</span>
                      {members.length === 0 ? (
                        <p className="og-hint">No stores yet. Add one below.</p>
                      ) : (
                        <ul className="og-members">
                          {members.map(m => (
                            <li key={m.id} className={`og-member ${m.deleted_at ? 'og-member--deleted' : ''}`}>
                              <OrgSwatch org={m} />
                              <span className="og-member__name">
                                {m.name}
                                {m.deleted_at && <span className="og-member__tag">deleted</span>}
                              </span>
                              <code className="og-member__slug">/{m.slug}/</code>
                              <label className="og-toggle" title="Show this store in the group's Stores list">
                                <input
                                  type="checkbox"
                                  checked={!!m.group_active}
                                  onChange={() => handleToggleActive(m)}
                                  disabled={busy}
                                />
                                <span className="og-toggle__track"><span className="og-toggle__thumb" /></span>
                                <span className="og-toggle__label">{m.group_active ? 'In Stores list' : 'Hidden'}</span>
                              </label>
                              <button className="og-remove" onClick={() => askRemove(m, group)} disabled={busy} title="Remove from group">
                                Remove
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}

                      {/* How this group's venues settle rewards. */}
                      <div className="og-section">
                        <div className="og-section__head">
                          <h4 className="og-section__title">Payment method</h4>
                          <p className="og-section__sub">
                            How a reward is handed over and paid for. A venue can override this in its own Settings.
                          </p>
                        </div>
                        <PaymentPicker
                          value={group.config?.settings?.paymentMethod}
                          memberCount={(group.members || []).length}
                          disabled={busy}
                          onPick={(to) => setPayConfirm({
                            groupId: group.id,
                            from: group.config?.settings?.paymentMethod || DEFAULT_PAYMENT_METHOD,
                            to,
                            members: (group.members || []).length,
                          })}
                        />
                      </div>

                      {/* Add member */}
                      <div className="og-add">
                        <select
                          className="og-select"
                          value={addSel[group.id] || ''}
                          onChange={e => setAddSel(s => ({ ...s, [group.id]: e.target.value }))}
                          disabled={busy || ungrouped.length === 0}
                        >
                          <option value="">{ungrouped.length ? 'Add a store…' : 'No unassigned stores'}</option>
                          {ungrouped.map(o => (
                            <option key={o.id} value={o.id}>{o.name} (/{o.slug}/)</option>
                          ))}
                        </select>
                        <button className="ao-btn ao-btn--ghost" onClick={() => askAdd(group.id)} disabled={busy || !addSel[group.id]}>
                          Add
                        </button>
                      </div>
                    </div>

                    {/* Future vendors ("coming soon" venues) now live on their own
                        admin page — Sidebar → Future Vendors. */}

                    {/* Footer: rename / delete */}
                    <div className="og-card__foot">
                      {renamingId === group.id ? (
                        <div className="og-rename">
                          <label className="og-field" style={{ flex: 1, marginBottom: 0 }}>
                            <span className="og-field__label">Name</span>
                            <input
                              className="og-input og-input--sm"
                              value={renameVal}
                              onChange={e => setRenameVal(e.target.value)}
                              autoFocus
                              onKeyDown={e => { if (e.key === 'Enter') handleRename(group.id); }}
                            />
                          </label>
                          <label className="og-field" style={{ flex: 1, marginBottom: 0 }}>
                            <span className="og-field__label">URL slug (/{renameSlug || group.slug})</span>
                            <input
                              className="og-input og-input--sm"
                              value={renameSlug}
                              placeholder={group.slug}
                              onChange={e => setRenameSlug(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') handleRename(group.id); }}
                            />
                          </label>
                          <button className="ao-btn ao-btn--primary ao-btn--sm" onClick={() => handleRename(group.id)} disabled={busy || !renameVal.trim()}>Save</button>
                          <button className="ao-btn ao-btn--ghost ao-btn--sm" onClick={() => { setRenamingId(null); setRenameSlug(''); }} disabled={busy}>Cancel</button>
                        </div>
                      ) : (
                        <button className="og-link" onClick={() => { setRenamingId(group.id); setRenameVal(group.name); setRenameSlug(group.slug || ''); }} disabled={busy}>
                          Rename
                        </button>
                      )}
                      <button className="og-link og-link--danger" onClick={() => setConfirmDelete({ id: group.id, name: group.name })} disabled={busy}>
                        Delete group
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Delete confirm ── */}
      {membershipConfirm && (() => {
        const c = membershipConfirm;
        const joining = c.action === 'join';
        const gmode = c.group?.mode || 'deposit';
        const gname = c.group?.name || 'the group';
        const oname = c.org?.name || 'this org';
        const others = Math.max(0, (c.group?.members || []).length - (joining ? 0 : 1));
        return (
          <TypedConfirmModal
            title={joining ? `Move ${oname} into ${gname}?` : `Take ${oname} out of ${gname}?`}
            intro={joining
              ? 'A group is one shared programme: one mode, one customer identity, one market page. This changes what this venue\u2019s customers see straight away.'
              : 'The venue keeps working on its own, but everything it inherited from the group goes away.'}
            word={joining ? 'join' : 'leave'}
            confirmLabel={joining ? 'Move into group' : 'Take out of group'}
            tone={joining ? 'warn' : 'danger'}
            busy={busy}
            onCancel={() => setMembershipConfirm(null)}
            onConfirm={confirmMembership}
          >
            <ul className="tcm-list">
              {joining ? (
                <>
                  <li>
                    <strong>The group\u2019s mode takes over.</strong> {oname} will run as{' '}
                    <strong>{MODE_META[gmode]?.label || gmode}</strong>, and its customer copy will be
                    replaced by the group\u2019s. Its own mode can no longer be changed on its own.
                  </li>
                  <li>
                    <strong>Customers get one shared profile</strong> across the group — the name and
                    email they set at one venue follow them to the others.
                  </li>
                  <li>
                    <strong>Cup balances stay per venue.</strong> Nothing is merged: cups collected here
                    stay here, and cups at other venues stay there.
                  </li>
                  <li>{oname} starts appearing on the group\u2019s market page at <code>/{c.group?.slug || 'group'}/</code>.</li>
                  {gmode === 'byo' && (
                    <li>Counter QR codes start working for this venue, because BYO minting needs a BYO group.</li>
                  )}
                  {gmode !== 'byo' && (
                    <li className="tcm-bad">
                      This group is not a Bring Your Own group, so counter QR codes will <strong>not</strong> mint
                      cups for this venue.
                    </li>
                  )}
                </>
              ) : (
                <>
                  <li>
                    <strong>{oname} goes back to its own copy and its own mode</strong>, which you can then
                    change independently. The group keeps running for {others} other venue{others === 1 ? '' : 's'}.
                  </li>
                  {gmode === 'byo' && (
                    <li className="tcm-bad">
                      <strong>Its counter QR codes stop minting cups immediately.</strong> BYO scanning
                      requires membership of a BYO group, so every QR already printed and stuck to a
                      counter at this venue stops working the moment you confirm.
                    </li>
                  )}
                  <li className="tcm-bad">
                    <strong>The shared customer profile is broken for this venue.</strong> Customers keep
                    their cups and their account here, but their name and email no longer follow them
                    between this venue and the rest of the group.
                  </li>
                  <li>It disappears from the group\u2019s market page; its own <code>/{c.org?.slug || 'slug'}/</code> URL keeps working.</li>
                  <li><strong>No cups, claims or payouts are deleted.</strong> Balances stay exactly as they are.</li>
                </>
              )}
            </ul>
          </TypedConfirmModal>
        );
      })()}

      {confirmDelete && (
        <div className="ao-modal-backdrop" onClick={() => setConfirmDelete(null)}>
          <div className="ao-modal" onClick={e => e.stopPropagation()}>
            <h3>Delete group “{confirmDelete.name}”?</h3>
            <p>
              The stores in this group will be <strong>detached</strong> and keep working on their
              own — no user, cup, or claim data is touched. Only the grouping and its copy settings
              are removed.
            </p>
            <div className="ao-modal__actions">
              <button className="ao-btn ao-btn--ghost" onClick={() => setConfirmDelete(null)} disabled={busy}>Cancel</button>
              <button className="ao-btn ao-btn--danger" onClick={() => handleDelete(confirmDelete.id)} disabled={busy}>
                {busy ? 'Deleting…' : 'Delete group'}
              </button>
            </div>
          </div>
        </div>
      )}

      {payConfirmNode}
    </section>
  );
}
