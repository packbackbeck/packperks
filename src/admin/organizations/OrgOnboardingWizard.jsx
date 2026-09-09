import { useState, useEffect, useMemo, useCallback } from 'react';
import { createOrganization, listOrgGroups, isOrgSlugAvailable } from '../lib/adminApi';
import { useOrg } from '../context/OrgContext';
import { ORG_MODELS, ORG_MODEL_ORDER } from '../lib/orgModes';
import { getCopyPreset } from '../../lib/copyPresets';
import './OrgOnboardingWizard.css';
import { useAdminMoney, adminMoney } from '../lib/adminMoney';

/* ─────────────────────────────────────────────────────────────────────
 * OrgOnboardingWizard — the flow PackPerks staff use to add a client org.
 *
 * The first question is the one that changes every later answer: WHICH
 * PROGRAMME MODEL is this org running?
 *
 *   • Direct refund + rewards  → deposit. SmartBin, full app.
 *   • Rewards only             → byo. Bring-your-own cup.
 *   • Direct refund only       → tikkie_only. Bin receipt → Tikkie link.
 *
 * The model decides the second question (group placement) and then prunes
 * the rest of the wizard: a tikkie-only org has no rewards, no app copy
 * and no feature flags to set, so it never sees those steps. Defaults for
 * rates, copy and features are seeded from the model rather than from a
 * one-size-fits-all constant.
 *
 * Two rules the wizard enforces because the backend does:
 *   • BYO REQUIRES a group — byo-mint rejects an org whose group config
 *     isn't mode 'byo', so a groupless BYO org can't mint a single cup.
 *   • Tikkie-only is NEVER grouped — there's no app or hub to belong to.
 *
 * Only the brand name + slug are hard requirements; the slug is checked
 * for collisions live, so a clash surfaces on step 3 rather than as a raw
 * database error after the final click.
 * ───────────────────────────────────────────────────────────────────── */

function slugify(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '')
    .slice(0, 60);
}

const EMPTY_REWARD = () => ({
  name: '',
  cupsNeeded: 6,
  euros: 5,
  image: '',
  description: '',
  bgColor: '#FD6F46',
});

const EMPTY_INVITE = () => ({ email: '', role: 'admin', method: 'email' });

const EMPTY_DATA = {
  model: null,
  group: { choice: 'none', id: null, name: '' },
  brand: {
    name: '',
    slug: '',
    partner_brand_name: '',
    email_domain_hint: '',
    brand_color: '#FD6F46',
    logo_url: '',
  },
  legal: {
    legal_name: '',
    kvk_number: '',
    btw_number: '',
    address: '',
    postal_code: '',
    city: '',
    country: 'Netherlands',
    contact_email: '',
    contact_phone: '',
    website: '',
  },
  location: {
    name: '',
    address: '',
    postal_code: '',
    city: '',
    phone: '',
    status: 'active',
    skipped: false,
  },
  economics: {
    cashbackRatePerCup: 1.25,
    refundRatePerCup: 1.00,
    maxCupsPerScan: 1,
    maxCupsToShare: 10,
  },
  rewards: [],
  copy: {
    heroHeadline: '',
    heroSubtext: '',
    donationRecipient: '',
    donationDescription: '',
    privacyUrl: '',
    termsUrl: '',
    cookieUrl: '',
  },
  features: {
    featureCupSharing: true,
    featureDonations: true,
    featureDirectRefunds: true,
  },
  invites: [],
};

/* Every possible step, in order. `when` prunes the list for the chosen
 * model, so the progress bar and the step numbers always reflect the
 * steps this particular org will actually go through. */
const ALL_STEPS = [
  { id: 'model',     title: 'Programme model' },
  { id: 'group',     title: 'Group placement', when: (m) => !!m && ORG_MODELS[m].group !== 'never' },
  { id: 'brand',     title: 'Brand identity' },
  { id: 'legal',     title: 'Legal & contact details', optional: true },
  { id: 'location',  title: 'First location', optional: true },
  { id: 'economics', title: 'Cup economics' },
  { id: 'rewards',   title: 'Starter rewards', optional: true, when: (m) => !!m && ORG_MODELS[m].steps.rewards },
  { id: 'copy',      title: 'App copy', optional: true, when: (m) => !!m && ORG_MODELS[m].steps.copy },
  { id: 'features',  title: 'Feature flags', when: (m) => !!m && ORG_MODELS[m].steps.features },
  { id: 'invites',   title: 'Team invites', optional: true },
  { id: 'review',    title: 'Review & launch' },
];

export default function OrgOnboardingWizard({ onClose, onCreated }) {
  const [stepIdx, setStepIdx] = useState(0);
  const [data, setData]   = useState(EMPTY_DATA);
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState(null);
  const { refresh, switchOrg } = useOrg();

  const steps = useMemo(
    () => ALL_STEPS.filter(s => !s.when || s.when(data.model)),
    [data.model],
  );
  const step = steps[Math.min(stepIdx, steps.length - 1)];
  const isLast = stepIdx === steps.length - 1;
  const model = data.model ? ORG_MODELS[data.model] : null;

  /* ── Groups (with their modes) for the group step ── */
  const [groups, setGroups] = useState([]);
  const [groupsLoading, setGroupsLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    listOrgGroups()
      .then(g => { if (alive) setGroups(g); })
      .catch(() => {})
      .finally(() => { if (alive) setGroupsLoading(false); });
    return () => { alive = false; };
  }, []);

  /* ── Slug: auto-derive from the name, then check availability ── */
  const [slugTouched, setSlugTouched] = useState(false);
  useEffect(() => {
    if (slugTouched || !data.brand.name) return;
    setData(d => ({ ...d, brand: { ...d.brand, slug: slugify(d.brand.name) } }));
  }, [data.brand.name, slugTouched]);

  // 'idle' | 'checking' | 'free' | 'taken'
  const [slugState, setSlugState] = useState('idle');
  useEffect(() => {
    const slug = data.brand.slug;
    if (!slug) { setSlugState('idle'); return undefined; }
    setSlugState('checking');
    const t = setTimeout(() => {
      isOrgSlugAvailable(slug)
        .then(free => setSlugState(free ? 'free' : 'taken'))
        .catch(() => setSlugState('idle'));
    }, 400);
    return () => clearTimeout(t);
  }, [data.brand.slug]);

  /* Picking a model reseeds every model-dependent default: rates, feature
   * flags, and the hero copy preset. Done here (an explicit user action)
   * rather than in an effect, so later manual edits are never clobbered. */
  function chooseModel(key) {
    const m = ORG_MODELS[key];
    const preset = key === 'tikkie_only' ? null : getCopyPreset(key);
    setData(d => ({
      ...d,
      model: key,
      group: m.group === 'never'
        ? { choice: 'none', id: null, name: '' }
        : d.group,
      economics: {
        ...d.economics,
        cashbackRatePerCup: m.defaults.cashbackRatePerCup,
        refundRatePerCup:   m.defaults.refundRatePerCup,
      },
      features: {
        featureCupSharing:    m.defaults.featureCupSharing,
        featureDonations:     m.defaults.featureDonations,
        featureDirectRefunds: m.defaults.featureDirectRefunds,
      },
      copy: {
        ...d.copy,
        heroHeadline: preset?.heroHeadline || '',
        heroSubtext:  preset?.heroSubtext  || '',
      },
    }));
  }

  const canAdvance = useMemo(() => {
    switch (step?.id) {
      case 'model':
        return !!data.model;
      case 'group': {
        if (model?.group === 'required') {
          return data.group.choice === 'existing'
            ? !!data.group.id
            : (data.group.choice === 'new' && !!data.group.name.trim());
        }
        if (data.group.choice === 'existing') return !!data.group.id;
        if (data.group.choice === 'new') return !!data.group.name.trim();
        return true;
      }
      case 'brand':
        return !!data.brand.name.trim() && !!data.brand.slug.trim() && slugState !== 'taken';
      default:
        return true;
    }
  }, [step, data, model, slugState]);

  function updateSection(section, patch) {
    setData(d => ({ ...d, [section]: { ...d[section], ...patch } }));
  }

  const goNext = useCallback(() => {
    setStepIdx(i => Math.min(steps.length - 1, i + 1));
  }, [steps.length]);

  /* Escape closes; Enter advances (but not from a textarea, where it's a
   * newline, and not while a step is incomplete). */
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && !busy) { onClose?.(); return; }
      if (e.key === 'Enter' && !busy && !isLast && canAdvance) {
        if (e.target?.tagName === 'TEXTAREA') return;
        e.preventDefault();
        goNext();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, isLast, canAdvance, goNext, onClose]);

  async function handleSubmit() {
    setBusy(true);
    setError(null);
    try {
      const usesRewards = !!model?.steps.rewards;
      const payload = {
        model: data.model,
        group: data.group,
        brand: data.brand,
        legal: data.legal,
        location: data.location.skipped ? null : data.location,
        economics: data.economics,
        rewards: usesRewards ? data.rewards : [],
        copy: data.copy,
        features: data.features,
        invites: data.invites.filter(i => i.email || i.method === 'link'),
      };
      const result = await createOrganization(payload);
      await refresh(result.org.id);
      switchOrg(result.org.id);
      onCreated?.(result);
    } catch (e) {
      console.error('createOrganization failed:', e);
      setError(e.message || 'Could not create the organisation.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="oow-backdrop" role="dialog" aria-modal="true" aria-label="Add organisation">
      <div className="oow-modal">
        <header className="oow-header">
          <div>
            <div className="oow-eyebrow">
              {/* The model decides how many steps there are, so quoting a
                  total before it's picked would just be wrong. */}
              Add organisation · Step {stepIdx + 1}{model ? ` of ${steps.length}` : ''}
              {model && <span className="oow-eyebrow__chip">{model.label}</span>}
            </div>
            <h2 className="oow-title">
              {step?.title}
              {step?.optional && <span className="oow-title__opt">Optional</span>}
            </h2>
          </div>
          <button className="oow-close" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </header>

        <div className="oow-progress">
          {steps.map((s, i) => (
            <span
              key={s.id}
              className={`oow-progress__seg ${i < stepIdx ? 'oow-progress__seg--done' : ''} ${i === stepIdx ? 'oow-progress__seg--active' : ''}`}
              title={s.title}
            />
          ))}
        </div>

        <div className="oow-body">
          {step?.id === 'model' && (
            <StepModel value={data.model} onChange={chooseModel} />
          )}
          {step?.id === 'group' && (
            <StepGroup
              model={model}
              modelKey={data.model}
              value={data.group}
              groups={groups}
              loading={groupsLoading}
              orgName={data.brand.name}
              onChange={(patch) => updateSection('group', patch)}
            />
          )}
          {step?.id === 'brand' && (
            <StepBrand
              data={data.brand}
              slugState={slugState}
              onChange={(patch) => {
                if (patch.slug !== undefined) setSlugTouched(true);
                updateSection('brand', patch);
              }}
            />
          )}
          {step?.id === 'legal' && (
            <StepLegal data={data.legal} onChange={(patch) => updateSection('legal', patch)} />
          )}
          {step?.id === 'location' && (
            <StepLocation data={data.location} onChange={(patch) => updateSection('location', patch)} />
          )}
          {step?.id === 'economics' && (
            <StepEconomics
              data={data.economics}
              modelKey={data.model}
              features={data.features}
              onChange={(patch) => updateSection('economics', patch)}
            />
          )}
          {step?.id === 'rewards' && (
            <StepRewards
              rewards={data.rewards}
              onChange={(next) => setData(d => ({ ...d, rewards: next }))}
            />
          )}
          {step?.id === 'copy' && (
            <StepCopy data={data.copy} onChange={(patch) => updateSection('copy', patch)} />
          )}
          {step?.id === 'features' && (
            <StepFeatures
              data={data.features}
              modelKey={data.model}
              onChange={(patch) => updateSection('features', patch)}
            />
          )}
          {step?.id === 'invites' && (
            <StepInvites
              invites={data.invites}
              onChange={(next) => setData(d => ({ ...d, invites: next }))}
            />
          )}
          {step?.id === 'review' && (
            <StepReview data={data} model={model} groups={groups} steps={steps} />
          )}
        </div>

        {error && <div className="oow-error">{error}</div>}

        <footer className="oow-footer">
          <button
            type="button"
            className="oow-btn oow-btn--ghost"
            onClick={() => setStepIdx(i => Math.max(0, i - 1))}
            disabled={busy || stepIdx === 0}
          >
            Back
          </button>
          <div className="oow-footer__right">
            {!isLast ? (
              <button
                type="button"
                className="oow-btn oow-btn--primary"
                onClick={goNext}
                disabled={!canAdvance || busy}
              >
                Continue
              </button>
            ) : (
              <button
                type="button"
                className="oow-btn oow-btn--primary"
                onClick={handleSubmit}
                disabled={busy}
              >
                {busy ? 'Creating…' : 'Create organisation'}
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}

/* ─── Step: programme model ───────────────────────────────────────── */
function StepModel({ value, onChange }) {
  return (
    <div className="oow-form">
      <p className="oow-step-intro">
        What is this org actually running? This decides how customers get paid, which
        pages the dashboard shows, and what the rest of this wizard asks you.
      </p>
      <div className="oow-models">
        {ORG_MODEL_ORDER.map(key => {
          const m = ORG_MODELS[key];
          const on = value === key;
          return (
            <button
              type="button"
              key={key}
              className={`oow-model${on ? ' oow-model--on' : ''}`}
              onClick={() => onChange(key)}
              aria-pressed={on}
            >
              <div className="oow-model__head">
                <span className="oow-model__label">{m.label}</span>
                <span className="oow-model__tag">{m.tagline}</span>
                {on && (
                  <span className="oow-model__check" aria-hidden="true">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </span>
                )}
              </div>
              <p className="oow-model__body"><strong>Customer:</strong> {m.customer}</p>
              <p className="oow-model__body"><strong>Dashboard:</strong> {m.dashboard}</p>
              <div className="oow-model__foot">
                {m.group === 'required' && 'Must belong to a group'}
                {m.group === 'optional' && 'Can stand alone or join a group'}
                {m.group === 'never'    && 'Always standalone — never grouped'}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Step: group placement ───────────────────────────────────────── */
function StepGroup({ model, modelKey, value, groups, loading, orgName, onChange }) {
  const required = model?.group === 'required';
  // Only groups whose mode matches this model can host it: the group config
  // is what supplies the customer copy, and for BYO it's what byo-mint
  // checks before minting a cup.
  const matching = groups.filter(g => g.mode === modelKey);
  const hiddenCount = groups.length - matching.length;

  // A BYO org with nowhere to go defaults to creating a group, prefilled
  // with the org's name, so the required path is never a dead end.
  useEffect(() => {
    if (!required) return;
    if (value.choice === 'none') {
      onChange(matching.length > 0
        ? { choice: 'existing', id: matching[0].id }
        : { choice: 'new', name: orgName || '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [required, loading, matching.length]);

  if (loading) return <div className="oow-form"><p className="oow-step-intro">Loading groups…</p></div>;

  return (
    <div className="oow-form">
      <p className="oow-step-intro">
        {required ? (
          <>
            A bring-your-own org <strong>must</strong> sit in a group. The group config is what
            tells the counter-QR scanner this is a BYO programme — without it, scans are
            rejected and no cup is ever added.
          </>
        ) : (
          <>
            Groups let several venues share one customer profile and appear together on the
            market page. Pick one, start a new one, or leave this org standalone.
          </>
        )}
      </p>

      <div className="oow-choices">
        {!required && (
          <ChoiceRow
            on={value.choice === 'none'}
            title="No group — standalone"
            hint="The org gets its own URL and its own customer balances. You can move it into a group later."
            onClick={() => onChange({ choice: 'none', id: null })}
          />
        )}

        {matching.map(g => (
          <ChoiceRow
            key={g.id}
            on={value.choice === 'existing' && value.id === g.id}
            title={g.name}
            hint={`/${g.slug}/ · ${g.members.length} venue${g.members.length === 1 ? '' : 's'} already in this group`}
            onClick={() => onChange({ choice: 'existing', id: g.id })}
          />
        ))}

        <ChoiceRow
          on={value.choice === 'new'}
          title="Create a new group"
          hint={`Starts a fresh ${model?.label.toLowerCase()} group with this org as its first venue.`}
          onClick={() => onChange({ choice: 'new', id: null, name: value.name || orgName || '' })}
        >
          {value.choice === 'new' && (
            <Field label="Group name" required>
              <input
                type="text"
                value={value.name}
                onChange={e => onChange({ name: e.target.value })}
                placeholder="e.g. Amsterdam Cafés"
                autoFocus
              />
            </Field>
          )}
        </ChoiceRow>
      </div>

      {hiddenCount > 0 && (
        <p className="oow-note">
          {hiddenCount} other group{hiddenCount === 1 ? ' is' : 's are'} hidden here — they run a
          different model, and mixing models inside one group would give customers the wrong app.
        </p>
      )}
    </div>
  );
}

function ChoiceRow({ on, title, hint, onClick, children }) {
  return (
    <div className={`oow-choice${on ? ' oow-choice--on' : ''}`}>
      <button type="button" className="oow-choice__btn" onClick={onClick} aria-pressed={on}>
        <span className={`oow-choice__radio${on ? ' oow-choice__radio--on' : ''}`} aria-hidden="true" />
        <span>
          <span className="oow-choice__title">{title}</span>
          {hint && <span className="oow-choice__hint">{hint}</span>}
        </span>
      </button>
      {children && <div className="oow-choice__extra">{children}</div>}
    </div>
  );
}

/* ─── Step: brand identity ────────────────────────────────────────── */
function StepBrand({ data, slugState, onChange }) {
  return (
    <div className="oow-form">
      <p className="oow-step-intro">Tell us what to call this organisation. Name and URL slug are the only required fields — everything else can be edited later.</p>
      <Field label="Organisation name" required>
        <input
          type="text"
          value={data.name}
          onChange={e => onChange({ name: e.target.value })}
          placeholder="e.g. Big Coffee Co."
          autoFocus
        />
      </Field>
      <Field
        label="URL slug"
        required
        hint="Lowercase, no spaces. This is the customer URL: /bigcoffee/"
      >
        <input
          type="text"
          value={data.slug}
          onChange={e => onChange({ slug: slugify(e.target.value) })}
          placeholder="bigcoffee"
          className={slugState === 'taken' ? 'oow-input--bad' : ''}
        />
        {slugState === 'taken' && (
          <span className="oow-inline-bad">That slug is already taken — pick another.</span>
        )}
        {slugState === 'free' && (
          <span className="oow-inline-ok">/{data.slug}/ is available.</span>
        )}
      </Field>
      <Field label="Partner brand display name" hint="The brand name shown in user-facing copy ('We're partnered with __').">
        <input
          type="text"
          value={data.partner_brand_name}
          onChange={e => onChange({ partner_brand_name: e.target.value })}
          placeholder="e.g. Big Coffee Co."
        />
      </Field>
      <Field label="Team email domain hint" hint="Shown as the placeholder in admin invite/login forms.">
        <input
          type="text"
          value={data.email_domain_hint}
          onChange={e => onChange({ email_domain_hint: e.target.value })}
          placeholder="e.g. bigcoffee.nl"
        />
      </Field>
      <Field label="Primary brand color">
        <div className="oow-color-row">
          <input
            type="color"
            value={data.brand_color}
            onChange={e => onChange({ brand_color: e.target.value })}
          />
          <input
            type="text"
            value={data.brand_color}
            onChange={e => onChange({ brand_color: e.target.value })}
            placeholder="#FD6F46"
            className="oow-color-input"
          />
        </div>
      </Field>
      <Field label="Logo URL" hint="Paste a URL to a logo image, or leave blank and add it later from the org details page.">
        <input
          type="url"
          value={data.logo_url}
          onChange={e => onChange({ logo_url: e.target.value })}
          placeholder="https://example.com/logo.png"
        />
      </Field>
    </div>
  );
}

/* ─── Step: legal & contact ───────────────────────────────────────── */
function StepLegal({ data, onChange }) {
  return (
    <div className="oow-form">
      <p className="oow-step-intro">Used on receipts, invoices, and contract paperwork. All optional — fill in what you have today.</p>
      <Field label="Legal entity name">
        <input type="text" value={data.legal_name} onChange={e => onChange({ legal_name: e.target.value })} placeholder="e.g. Big Coffee B.V." />
      </Field>
      <div className="oow-row-2">
        <Field label="KVK number">
          <input type="text" value={data.kvk_number} onChange={e => onChange({ kvk_number: e.target.value })} placeholder="12345678" />
        </Field>
        <Field label="BTW number">
          <input type="text" value={data.btw_number} onChange={e => onChange({ btw_number: e.target.value })} placeholder="NL000000000B01" />
        </Field>
      </div>
      <Field label="Registered address">
        <input type="text" value={data.address} onChange={e => onChange({ address: e.target.value })} placeholder="Damrak 1" />
      </Field>
      <div className="oow-row-3">
        <Field label="Postal code">
          <input type="text" value={data.postal_code} onChange={e => onChange({ postal_code: e.target.value })} placeholder="1012 LG" />
        </Field>
        <Field label="City">
          <input type="text" value={data.city} onChange={e => onChange({ city: e.target.value })} placeholder="Amsterdam" />
        </Field>
        <Field label="Country" hint="Sets the payout provider: Netherlands pays via Tikkie.">
          <input type="text" value={data.country} onChange={e => onChange({ country: e.target.value })} placeholder="Netherlands" />
        </Field>
      </div>
      <div className="oow-row-2">
        <Field label="Contact email">
          <input type="email" value={data.contact_email} onChange={e => onChange({ contact_email: e.target.value })} placeholder="ops@bigcoffee.nl" />
        </Field>
        <Field label="Contact phone">
          <input type="tel" value={data.contact_phone} onChange={e => onChange({ contact_phone: e.target.value })} placeholder="+31 …" />
        </Field>
      </div>
      <Field label="Website">
        <input type="url" value={data.website} onChange={e => onChange({ website: e.target.value })} placeholder="https://bigcoffee.nl" />
      </Field>
    </div>
  );
}

/* ─── Step: first location ────────────────────────────────────────── */
function StepLocation({ data, onChange }) {
  if (data.skipped) {
    return (
      <div className="oow-form">
        <p className="oow-step-intro">Skipped — you can add locations later from the Org details page.</p>
        <button type="button" className="oow-btn oow-btn--ghost" onClick={() => onChange({ skipped: false })}>
          Add a location after all
        </button>
      </div>
    );
  }
  return (
    <div className="oow-form">
      <p className="oow-step-intro">Add the first physical venue. Locations are what per-venue QR codes and reports are grouped by. <button type="button" className="oow-skip" onClick={() => onChange({ skipped: true })}>Skip this step</button></p>
      <Field label="Location name">
        <input type="text" value={data.name} onChange={e => onChange({ name: e.target.value })} placeholder="e.g. Big Coffee Amsterdam Damrak" />
      </Field>
      <Field label="Address">
        <input type="text" value={data.address} onChange={e => onChange({ address: e.target.value })} placeholder="Damrak 70" />
      </Field>
      <div className="oow-row-2">
        <Field label="Postal code">
          <input type="text" value={data.postal_code} onChange={e => onChange({ postal_code: e.target.value })} placeholder="1012 LG" />
        </Field>
        <Field label="City">
          <input type="text" value={data.city} onChange={e => onChange({ city: e.target.value })} placeholder="Amsterdam" />
        </Field>
      </div>
      <div className="oow-row-2">
        <Field label="Phone">
          <input type="tel" value={data.phone} onChange={e => onChange({ phone: e.target.value })} placeholder="+31 …" />
        </Field>
        <Field label="Status">
          <select value={data.status} onChange={e => onChange({ status: e.target.value })}>
            <option value="active">Active</option>
            <option value="pilot">Pilot</option>
            <option value="closed">Closed</option>
          </select>
        </Field>
      </div>
    </div>
  );
}

/* ─── Step: cup economics ─────────────────────────────────────────── */
function StepEconomics({ data, modelKey, features, onChange }) {
  const { money, symbol } = useAdminMoney();
  const isTikkie = modelKey === 'tikkie_only';
  // Tikkie-only settles on ONE rate — the refund rate. bin-tikkie reads it.
  const rate = Number(isTikkie ? data.refundRatePerCup : data.cashbackRatePerCup) || 0;

  if (isTikkie) {
    // One number matters here: what a returned cup is worth. Every receipt
    // mints one Tikkie link, paid straight out of the venue's cashback
    // account — there is no per-link charge to weigh against it.
    const examples = [1, 4, 10];
    return (
      <div className="oow-form">
        <p className="oow-step-intro">
          A bin receipt is paid out as one Tikkie link: cups on the receipt × the rate below.
          Nothing else on this screen applies — there's no app, no sharing and no reward goals.
        </p>
        <Field label={`Refund per cup (${symbol})`} hint="The customer receives this for every cup on the receipt.">
          <input
            type="number" step="0.05" min="0"
            value={data.refundRatePerCup}
            onChange={e => onChange({ refundRatePerCup: parseFloat(e.target.value) || 0 })}
            autoFocus
          />
        </Field>
        <div className="oow-econ-preview">
          <div className="oow-econ-preview__head">What the customer gets</div>
          {examples.map(n => (
            <div key={n} className="oow-econ-preview__row">
              <span>{n} cup{n === 1 ? '' : 's'} returned</span>
              <strong>{money(n * rate)}</strong>
            </div>
          ))}
        </div>

      </div>
    );
  }

  return (
    <div className="oow-form">
      <p className="oow-step-intro">How much each cup is worth, and the per-scan limits that keep abuse in check.</p>
      <div className="oow-row-2">
        <Field label={`Cashback rate (${symbol} per cup)`} hint="What a cup is worth toward a reward payout.">
          <input type="number" step="0.05" min="0" value={data.cashbackRatePerCup} onChange={e => onChange({ cashbackRatePerCup: parseFloat(e.target.value) || 0 })} />
        </Field>
        <Field
          label={`Refund rate (${symbol} per cup)`}
          hint={features.featureDirectRefunds
            ? 'Used for the direct cash-out path (lower value, no reward unlock).'
            : 'Direct refunds are off for this model, so this rate is unused for now.'}
        >
          <input
            type="number" step="0.05" min="0"
            value={data.refundRatePerCup}
            onChange={e => onChange({ refundRatePerCup: parseFloat(e.target.value) || 0 })}
            disabled={!features.featureDirectRefunds}
          />
        </Field>
      </div>
      <div className="oow-row-2">
        <Field label="Max cups per scan" hint="Anti-fraud guardrail — scans above this are held for review.">
          <input type="number" step="1" min="1" value={data.maxCupsPerScan} onChange={e => onChange({ maxCupsPerScan: parseInt(e.target.value, 10) || 1 })} />
        </Field>
        <Field label="Max cups per share" hint="Cap on peer-to-peer cup gifting.">
          <input type="number" step="1" min="1" value={data.maxCupsToShare} onChange={e => onChange({ maxCupsToShare: parseInt(e.target.value, 10) || 1 })} />
        </Field>
      </div>
    </div>
  );
}

/* ─── Step: starter rewards ───────────────────────────────────────── */
function StepRewards({ rewards, onChange }) {
  const { symbol } = useAdminMoney();
  function updateAt(i, patch) {
    const next = [...rewards];
    next[i] = { ...next[i], ...patch };
    onChange(next);
  }
  function removeAt(i) {
    const next = [...rewards];
    next.splice(i, 1);
    onChange(next);
  }
  function add() { onChange([...rewards, EMPTY_REWARD()]); }

  return (
    <div className="oow-form">
      <p className="oow-step-intro">The rewards a customer unlocks by collecting cups. The first one is featured on the home screen. You can leave this empty and add them later from the Rewards tab.</p>
      {rewards.length === 0 && (
        <div className="oow-empty">No starter rewards yet. <button type="button" className="oow-skip" onClick={add}>Add the first one</button></div>
      )}
      {rewards.map((r, i) => (
        <div key={i} className="oow-reward-card">
          <div className="oow-reward-card__head">
            <strong>Reward {i + 1}{i === 0 && <span className="oow-reward-card__badge">Featured</span>}</strong>
            <button type="button" className="oow-remove" onClick={() => removeAt(i)} aria-label="Remove">×</button>
          </div>
          <div className="oow-row-2">
            <Field label="Name">
              <input type="text" value={r.name} onChange={e => updateAt(i, { name: e.target.value })} placeholder="e.g. Free Coffee" />
            </Field>
            <Field label="Cups needed">
              <input type="number" min="1" value={r.cupsNeeded} onChange={e => updateAt(i, { cupsNeeded: parseInt(e.target.value, 10) || 1 })} />
            </Field>
          </div>
          <div className="oow-row-2">
            <Field label={`Cashback value (${symbol})`}>
              <input type="number" step="0.01" min="0" value={r.euros} onChange={e => updateAt(i, { euros: parseFloat(e.target.value) || 0 })} />
            </Field>
            <Field label="Image URL">
              <input type="url" value={r.image} onChange={e => updateAt(i, { image: e.target.value })} placeholder="https://…" />
            </Field>
          </div>
          <Field label="Description">
            <textarea value={r.description} onChange={e => updateAt(i, { description: e.target.value })} placeholder="Short blurb shown on the reward card." rows={2} />
          </Field>
        </div>
      ))}
      {rewards.length > 0 && (
        <button type="button" className="oow-btn oow-btn--ghost" onClick={add}>+ Add another reward</button>
      )}
    </div>
  );
}

/* ─── Step: app copy ──────────────────────────────────────────────── */
function StepCopy({ data, onChange }) {
  return (
    <div className="oow-form">
      <p className="oow-step-intro">Customer-facing copy on the home screen — prefilled from the model you picked. All editable later from Settings.</p>
      <Field label="Hero headline">
        <input type="text" value={data.heroHeadline} onChange={e => onChange({ heroHeadline: e.target.value })} />
      </Field>
      <Field label="Hero subtext">
        <textarea value={data.heroSubtext} onChange={e => onChange({ heroSubtext: e.target.value })} rows={2} />
      </Field>
      <div className="oow-row-2">
        <Field label="Donation recipient">
          <input type="text" value={data.donationRecipient} onChange={e => onChange({ donationRecipient: e.target.value })} placeholder="e.g. Plastic Soup Foundation" />
        </Field>
        <Field label="Donation description">
          <input type="text" value={data.donationDescription} onChange={e => onChange({ donationDescription: e.target.value })} placeholder="What the partner charity does." />
        </Field>
      </div>
      <div className="oow-row-3">
        <Field label="Privacy URL">
          <input type="url" value={data.privacyUrl} onChange={e => onChange({ privacyUrl: e.target.value })} placeholder="https://…/privacy" />
        </Field>
        <Field label="Terms URL">
          <input type="url" value={data.termsUrl} onChange={e => onChange({ termsUrl: e.target.value })} placeholder="https://…/terms" />
        </Field>
        <Field label="Cookies URL">
          <input type="url" value={data.cookieUrl} onChange={e => onChange({ cookieUrl: e.target.value })} placeholder="https://…/cookies" />
        </Field>
      </div>
    </div>
  );
}

/* ─── Step: feature flags ─────────────────────────────────────────── */
function StepFeatures({ data, modelKey, onChange }) {
  const byo = modelKey === 'byo';
  return (
    <div className="oow-form">
      <p className="oow-step-intro">Optional features, preset for this model. All flippable later from Settings.</p>
      <ToggleRow
        label="Cup sharing"
        hint="Lets customers gift cups to each other via QR code."
        value={data.featureCupSharing}
        onChange={(v) => onChange({ featureCupSharing: v })}
      />
      <ToggleRow
        label="Donations"
        hint="Lets customers donate cups to a partner charity."
        value={data.featureDonations}
        onChange={(v) => onChange({ featureDonations: v })}
      />
      <ToggleRow
        label="Direct refunds"
        hint={byo
          ? 'Off for a rewards-only programme — turning it on lets customers cash out instead of working toward a reward.'
          : 'Lets customers cash out cups directly, skipping the reward.'}
        value={data.featureDirectRefunds}
        onChange={(v) => onChange({ featureDirectRefunds: v })}
      />
    </div>
  );
}

/* ─── Step: team invites ──────────────────────────────────────────── */
function StepInvites({ invites, onChange }) {
  function updateAt(i, patch) {
    const next = [...invites];
    next[i] = { ...next[i], ...patch };
    onChange(next);
  }
  function removeAt(i) {
    const next = [...invites];
    next.splice(i, 1);
    onChange(next);
  }
  function add() { onChange([...invites, EMPTY_INVITE()]); }

  return (
    <div className="oow-form">
      <p className="oow-step-intro">Invite the client's team. Owners and admins can spend money (approving payouts); managers and checkers can't. You can also do this later from Settings → Team.</p>
      {invites.length === 0 && (
        <div className="oow-empty">No invites queued. <button type="button" className="oow-skip" onClick={add}>Add an invite</button></div>
      )}
      {invites.map((inv, i) => (
        <div key={i} className="oow-invite-row">
          <Field label="Email">
            <input
              type="email"
              value={inv.email}
              onChange={e => updateAt(i, { email: e.target.value })}
              placeholder="teammate@example.com"
              disabled={inv.method === 'link'}
            />
          </Field>
          <Field label="Role">
            <select value={inv.role} onChange={e => updateAt(i, { role: e.target.value })}>
              <option value="admin">Admin</option>
              <option value="manager">Manager</option>
              <option value="checker">Checker</option>
            </select>
          </Field>
          <Field label="Method">
            <select value={inv.method} onChange={e => updateAt(i, { method: e.target.value })}>
              <option value="email">Email link</option>
              <option value="link">Shareable link</option>
            </select>
          </Field>
          <button type="button" className="oow-remove" onClick={() => removeAt(i)} aria-label="Remove">×</button>
        </div>
      ))}
      {invites.length > 0 && (
        <button type="button" className="oow-btn oow-btn--ghost" onClick={add}>+ Add another invite</button>
      )}
    </div>
  );
}

/* ─── Step: review ────────────────────────────────────────────────── */
function StepReview({ data, model, groups, steps }) {
  const isTikkie = data.model === 'tikkie_only';
  const groupLabel = (() => {
    if (data.group.choice === 'new') return `${data.group.name} (new group)`;
    if (data.group.choice === 'existing') {
      return groups.find(g => g.id === data.group.id)?.name || 'Selected group';
    }
    return 'Standalone — no group';
  })();

  const rows = [
    ['Model', model?.label || '—'],
    ...(model?.group === 'never' ? [] : [['Group', groupLabel]]),
    ['Organisation', data.brand.name || '—'],
    ['Customer URL', data.brand.slug ? `/${data.brand.slug}/` : '—'],
    ['Brand colour', data.brand.brand_color],
    ['Legal name', data.legal.legal_name || '(not set)'],
    ['First location', data.location.skipped || !data.location.name ? '(skipped)' : data.location.name],
    isTikkie
      ? ['Refund', `${adminMoney(data.economics.refundRatePerCup)} per cup`]
      : ['Cashback / refund', `${adminMoney(data.economics.cashbackRatePerCup)} / ${adminMoney(data.economics.refundRatePerCup)} per cup`],
    ...(steps.some(s => s.id === 'rewards')
      ? [['Starter rewards', data.rewards.length === 0 ? '(none)' : `${data.rewards.length} reward(s)`]]
      : []),
    ...(steps.some(s => s.id === 'features')
      ? [['Features', [
          data.features.featureCupSharing && 'sharing',
          data.features.featureDonations && 'donations',
          data.features.featureDirectRefunds && 'direct refunds',
        ].filter(Boolean).join(', ') || 'none']]
      : []),
    ['Team invites', data.invites.length === 0 ? '(none)' : `${data.invites.length} invite(s)`],
  ];

  return (
    <div className="oow-form">
      <p className="oow-step-intro">
        Final check. <strong>Create organisation</strong> provisions everything and switches you into the new org.
      </p>
      <div className="oow-review">
        {rows.map(([k, v]) => (
          <div key={k} className="oow-review__row">
            <span className="oow-review__k">{k}</span>
            <span className="oow-review__v">{v}</span>
          </div>
        ))}
      </div>
      {isTikkie && (
        <p className="oow-note">
          Next step after creating: point the smart bin at this org, then print a test receipt
          from the Receipt Generator to confirm the Tikkie link works end to end.
        </p>
      )}
    </div>
  );
}

/* ─── Shared form primitives ──────────────────────────────────────── */
function Field({ label, hint, required, children }) {
  return (
    <label className="oow-field">
      <span className="oow-field__label">
        {label}
        {required && <span className="oow-field__req">*</span>}
      </span>
      {children}
      {hint && <span className="oow-field__hint">{hint}</span>}
    </label>
  );
}

function ToggleRow({ label, hint, value, onChange }) {
  return (
    <div className="oow-toggle-row">
      <div>
        <div className="oow-toggle-row__label">{label}</div>
        {hint && <div className="oow-toggle-row__hint">{hint}</div>}
      </div>
      <button
        type="button"
        className={`oow-toggle ${value ? 'oow-toggle--on' : ''}`}
        onClick={() => onChange(!value)}
        aria-pressed={value}
      >
        <span className="oow-toggle__dot" />
      </button>
    </div>
  );
}
