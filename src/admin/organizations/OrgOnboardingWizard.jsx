import { useState, useEffect, useMemo, useCallback } from 'react';
import { ArrowLeft, ArrowRight, Building2, Check, Plus, Trash2, TriangleAlert, X } from 'lucide-react';
import { createOrganization, listOrgGroups, isOrgSlugAvailable } from '../lib/adminApi';
import { useOrg } from '../context/OrgContext';
import { ORG_MODELS, ORG_MODEL_ORDER } from '../lib/orgModes';
import { getCopyPreset } from '../../lib/copyPresets';
import { getAllRegions } from '../../lib/regions';
import { Badge, Button, Switch } from '../ui';
import { MODE_GLYPH } from '../master/orgShared';
import './OrgOnboardingWizard.css';
import { useAdminMoney, adminMoney } from '../lib/adminMoney';

/* ─────────────────────────────────────────────────────────────────────
 * OrgOnboardingWizard — the flow PackPerks staff use to add a client org.
 *
 * The first question is the one that changes every later answer: WHICH
 * PROGRAMME MODEL is this org running?
 *
 *   • Deposit Rewards  → deposit. SmartBin, full app.
 *   • Bring Your Own   → byo. Bring-your-own cup.
 *   • Deferred Tikkie  → tikkie_only. Bin receipt → wallet → Tikkie link.
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

const EMPTY_INVITE = () => ({ email: '', role: 'manager', method: 'email' });

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
  { id: 'model',     title: 'Programme' },
  { id: 'group',     title: 'Group', when: (m) => !!m && ORG_MODELS[m].group !== 'never' },
  { id: 'brand',     title: 'Brand' },
  { id: 'legal',     title: 'Company details', optional: true },
  { id: 'location',  title: 'First location', optional: true },
  { id: 'economics', title: 'Cup value' },
  { id: 'rewards',   title: 'Starter rewards', optional: true, when: (m) => !!m && ORG_MODELS[m].steps.rewards },
  { id: 'copy',      title: 'Customer copy', optional: true, when: (m) => !!m && ORG_MODELS[m].steps.copy },
  { id: 'features',  title: 'Features', when: (m) => !!m && ORG_MODELS[m].steps.features },
  { id: 'invites',   title: 'Team', optional: true },
  { id: 'review',    title: 'Review' },
];

const MODEL_TONE = { deposit: 'standard', byo: 'byo', tikkie_only: 'tikkie_only' };

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
    <div className="oow-backdrop" role="dialog" aria-modal="true" aria-label="New organisation">
      <div className="oow-modal">
        <header className="oow-header">
          <span className="oow-header__icon" aria-hidden="true"><Building2 size={19} /></span>
          <div className="oow-header__titles">
            <h2 className="oow-header__title">New organisation</h2>
            <p className="oow-header__sub">
              {/* The model decides how many steps there are, so quoting a
                  total before it's picked would just be wrong. */}
              Step {stepIdx + 1}{model ? ` of ${steps.length}` : ''}
              {model && <> · {model.label}</>}
            </p>
          </div>
          <Button variant="ghost" size="sm" icon={X} aria-label="Close" onClick={onClose} disabled={busy} />
        </header>

        <div className="oow-progress" aria-hidden="true">
          <span className="oow-progress__fill" style={{ width: `${((stepIdx + 1) / steps.length) * 100}%` }} />
        </div>

        <div className="oow-main">
          <nav className="oow-rail" aria-label="Steps">
            <ol>
              {steps.map((s, i) => {
                const state = i < stepIdx ? 'done' : i === stepIdx ? 'active' : 'todo';
                return (
                  <li key={s.id} className={`oow-rail__item oow-rail__item--${state}`} aria-current={state === 'active' ? 'step' : undefined}>
                    <button type="button" className="oow-rail__btn" disabled={i >= stepIdx || busy} onClick={() => setStepIdx(i)}>
                      <span className="oow-rail__dot" aria-hidden="true">{state === 'done' ? <Check size={12} /> : i + 1}</span>
                      <span className="oow-rail__label">{s.title}</span>
                    </button>
                  </li>
                );
              })}
              {!model && <li className="oow-rail__item oow-rail__item--hint">More steps once you pick a programme</li>}
            </ol>
          </nav>

          <div className="oow-body" key={step?.id}>
            <h3 className="oow-title">
              {step?.title}
              {step?.optional && <Badge tone="neutral">Optional</Badge>}
            </h3>
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
              <StepCopy data={data.copy} grouped={data.group.choice !== 'none'} onChange={(patch) => updateSection('copy', patch)} />
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
        </div>

        <footer className="oow-footer">
          <Button
            variant="outline"
            icon={ArrowLeft}
            onClick={() => setStepIdx(i => Math.max(0, i - 1))}
            disabled={busy || stepIdx === 0}
          >
            Back
          </Button>
          <span className="oow-footer__msg" role={error ? 'alert' : undefined}>{error}</span>
          {!isLast ? (
            <Button variant="primary" iconRight={ArrowRight} onClick={goNext} disabled={!canAdvance || busy}>
              Continue
            </Button>
          ) : (
            <Button variant="primary" icon={Check} onClick={handleSubmit} disabled={busy}>
              {busy ? 'Creating…' : 'Create organisation'}
            </Button>
          )}
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
        Which programme will this venue run? It decides how customers are paid, which dashboard
        tabs exist, and what the rest of this wizard asks.
      </p>
      <div className="oow-models" role="radiogroup" aria-label="Programme">
        {ORG_MODEL_ORDER.map(key => {
          const m = ORG_MODELS[key];
          const on = value === key;
          const Glyph = MODE_GLYPH[MODEL_TONE[key]];
          return (
            <button
              type="button"
              key={key}
              role="radio"
              aria-checked={on}
              className={`oow-model${on ? ' oow-model--on' : ''}`}
              onClick={() => onChange(key)}
            >
              <span className="oow-model__head">
                <span className={`oow-model__glyph oow-model__glyph--${MODEL_TONE[key]}`} aria-hidden="true"><Glyph size={17} /></span>
                <span className="oow-model__titles">
                  <span className="oow-model__label">{m.label}</span>
                  <span className="oow-model__tag">{m.tagline}</span>
                </span>
                <span className={`oow-radio${on ? ' oow-radio--on' : ''}`} aria-hidden="true" />
              </span>
              <span className="oow-model__body"><b>Customer app:</b> {m.customer}</span>
              <span className="oow-model__body"><b>Dashboard:</b> {m.dashboard}</span>
              <span className="oow-model__foot">
                {m.group === 'required' && 'Always in a group'}
                {m.group === 'optional' && 'On its own or in a group'}
                {m.group === 'never'    && 'Never in a group'}
              </span>
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
            A Bring Your Own venue <strong>must</strong> be in a group. The group tells the counter
            QR scanner this is a Bring Your Own programme; without it, every scan is refused.
          </>
        ) : (
          <>
            Venues in a group share one customer profile and one market page. Pick a group, start a
            new one, or keep this venue on its own.
          </>
        )}
      </p>

      <div className="oow-choices" role="radiogroup" aria-label="Group">
        {!required && (
          <ChoiceRow
            on={value.choice === 'none'}
            title="No group"
            hint="The venue has its own address and its own customer balances. You can add it to a group later."
            onClick={() => onChange({ choice: 'none', id: null })}
          />
        )}

        {matching.map(g => (
          <ChoiceRow
            key={g.id}
            on={value.choice === 'existing' && value.id === g.id}
            title={g.name}
            hint={`/${g.slug}/ · ${g.members.length} venue${g.members.length === 1 ? '' : 's'} in this group`}
            onClick={() => onChange({ choice: 'existing', id: g.id })}
          />
        ))}

        <ChoiceRow
          on={value.choice === 'new'}
          title="New group"
          hint={`Starts a ${model?.label} group with this venue in it.`}
          onClick={() => onChange({ choice: 'new', id: null, name: value.name || orgName || '' })}
        >
          {value.choice === 'new' && (
            <Field label="Group name" required>
              <input
                type="text"
                value={value.name}
                onChange={e => onChange({ name: e.target.value })}
                placeholder="Amsterdam cafés"
                autoFocus
              />
            </Field>
          )}
        </ChoiceRow>
      </div>

      {hiddenCount > 0 && (
        <p className="oow-note">
          {hiddenCount} other group{hiddenCount === 1 ? ' is' : 's are'} not listed: they run a
          different programme, and mixing programmes in one group would show customers the wrong app.
        </p>
      )}
    </div>
  );
}

function ChoiceRow({ on, title, hint, onClick, children }) {
  return (
    <div className={`oow-choice${on ? ' oow-choice--on' : ''}`}>
      <button type="button" className="oow-choice__btn" onClick={onClick} role="radio" aria-checked={on}>
        <span className={`oow-radio${on ? ' oow-radio--on' : ''}`} aria-hidden="true" />
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
      <p className="oow-step-intro">What the venue is called and where its customer app lives. Only the name and the address are required; you can change the rest later.</p>
      <div className="oow-row-2">
        <Field label="Name" required>
          <input
            type="text"
            value={data.name}
            onChange={e => onChange({ name: e.target.value })}
            placeholder="Big Coffee Co."
            autoFocus
          />
        </Field>
        <Field
          label="Customer app address"
          required
          hint={slugState === 'taken' ? null : 'Lowercase letters, numbers and dashes.'}
        >
          <div className="oow-prefix">
            <span className="oow-prefix__text">/</span>
            <input
              type="text"
              value={data.slug}
              onChange={e => onChange({ slug: slugify(e.target.value) })}
              placeholder="bigcoffee"
              className={slugState === 'taken' ? 'oow-input--bad' : ''}
            />
          </div>
          {slugState === 'taken' && (
            <span className="oow-inline-bad">That address is taken. Pick another.</span>
          )}
          {slugState === 'free' && (
            <span className="oow-inline-ok"><Check size={12} aria-hidden="true" /> /{data.slug}/ is free.</span>
          )}
        </Field>
      </div>
      <div className="oow-row-2">
        <Field label="Brand shown to customers" hint="Used in customer copy. Empty uses the name.">
          <input
            type="text"
            value={data.partner_brand_name}
            onChange={e => onChange({ partner_brand_name: e.target.value })}
            placeholder={data.name || 'Big Coffee Co.'}
          />
        </Field>
        <Field label="Team email domain" hint="Saved with the organisation for your reference.">
          <input
            type="text"
            value={data.email_domain_hint}
            onChange={e => onChange({ email_domain_hint: e.target.value })}
            placeholder="bigcoffee.nl"
          />
        </Field>
      </div>
      <div className="oow-row-2">
        <Field label="Brand colour" hint="Used when there is no logo.">
          <div className="oow-color-row">
            <input
              type="color"
              value={data.brand_color}
              onChange={e => onChange({ brand_color: e.target.value })}
              aria-label="Pick a brand colour"
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
        <Field label="Logo link" hint="Paste a link to the logo, or upload one later in Master settings → Organisations.">
          <input
            type="url"
            value={data.logo_url}
            onChange={e => onChange({ logo_url: e.target.value })}
            placeholder="https://"
          />
        </Field>
      </div>
    </div>
  );
}

/* ─── Step: legal & contact ───────────────────────────────────────── */
function StepLegal({ data, onChange }) {
  const regions = getAllRegions();
  const known = regions.some(r => r.label === data.country);
  return (
    <div className="oow-form">
      <p className="oow-step-intro">For invoices and contracts. Everything here is optional except the region, which sets the currency and the payout provider.</p>
      <Field label="Region" hint="Netherlands pays out through Tikkie. You can change it later.">
        <select value={data.country} onChange={e => onChange({ country: e.target.value })}>
          {!known && <option value={data.country}>{data.country || 'Pick a region'}</option>}
          {regions.map(r => <option key={r.key} value={r.label}>{r.flag ? `${r.flag} ` : ''}{r.label} · {r.currency}</option>)}
        </select>
      </Field>
      <Field label="Legal name">
        <input type="text" value={data.legal_name} onChange={e => onChange({ legal_name: e.target.value })} placeholder="Big Coffee B.V." />
      </Field>
      <div className="oow-row-2">
        <Field label="KvK number">
          <input type="text" value={data.kvk_number} onChange={e => onChange({ kvk_number: e.target.value })} placeholder="12345678" />
        </Field>
        <Field label="BTW number">
          <input type="text" value={data.btw_number} onChange={e => onChange({ btw_number: e.target.value })} placeholder="NL000000000B01" />
        </Field>
      </div>
      <Field label="Street and number">
        <input type="text" value={data.address} onChange={e => onChange({ address: e.target.value })} placeholder="Damrak 1" />
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
        <div className="oow-empty">
          <p>Skipped. You can add locations later in Settings → Locations.</p>
          <Button size="sm" icon={Plus} onClick={() => onChange({ skipped: false })}>Add a location after all</Button>
        </div>
      </div>
    );
  }
  return (
    <div className="oow-form">
      <p className="oow-step-intro">
        The first physical venue. Counter QR codes and reports are grouped by location.{' '}
        <button type="button" className="oow-skip" onClick={() => onChange({ skipped: true })}>Skip this step</button>
      </p>
      <Field label="Location name">
        <input type="text" value={data.name} onChange={e => onChange({ name: e.target.value })} placeholder="Big Coffee Damrak" />
      </Field>
      <Field label="Street and number">
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
          A bin receipt is paid out as one Tikkie link: the cups on the receipt times the rate
          below. There is no app, no sharing and no reward goal to set.
        </p>
        <Field label="Refund per cup" hint="The customer gets this for every cup on the receipt.">
          <div className="oow-prefix">
            <span className="oow-prefix__text">{symbol}</span>
            <input
              type="number" step="0.05" min="0"
              value={data.refundRatePerCup}
              onChange={e => onChange({ refundRatePerCup: parseFloat(e.target.value) || 0 })}
              autoFocus
            />
          </div>
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
      <p className="oow-step-intro">What a cup is worth, and the limits that keep scanning fair.</p>
      <div className="oow-row-2">
        <Field label="Cashback per cup" hint="What a cup is worth toward a reward.">
          <div className="oow-prefix">
            <span className="oow-prefix__text">{symbol}</span>
            <input type="number" step="0.05" min="0" value={data.cashbackRatePerCup} onChange={e => onChange({ cashbackRatePerCup: parseFloat(e.target.value) || 0 })} />
          </div>
        </Field>
        <Field
          label="Direct refund per cup"
          hint={features.featureDirectRefunds
            ? 'Paid when a customer cashes out instead of choosing a reward.'
            : 'Direct refunds are off for this programme, so this rate is not used for now.'}
        >
          <div className="oow-prefix">
            <span className="oow-prefix__text">{symbol}</span>
            <input
              type="number" step="0.05" min="0"
              value={data.refundRatePerCup}
              onChange={e => onChange({ refundRatePerCup: parseFloat(e.target.value) || 0 })}
              disabled={!features.featureDirectRefunds}
            />
          </div>
        </Field>
      </div>
      <div className="oow-row-2">
        <Field label="Most cups per scan" hint="Scans above this are held for review.">
          <input type="number" step="1" min="1" value={data.maxCupsPerScan} onChange={e => onChange({ maxCupsPerScan: parseInt(e.target.value, 10) || 1 })} />
        </Field>
        <Field label="Most cups per share" hint="The limit on gifting cups to someone else.">
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
      <p className="oow-step-intro">What customers unlock by collecting cups. The first one is featured on the home screen. You can also add rewards later in Rewards &amp; offers.</p>
      {rewards.length === 0 && (
        <div className="oow-empty">
          <p>No starter rewards yet.</p>
          <Button size="sm" icon={Plus} onClick={add}>Add the first reward</Button>
        </div>
      )}
      {rewards.map((r, i) => (
        <div key={i} className="oow-card">
          <div className="oow-card__head">
            <span className="oow-card__title">Reward {i + 1}{i === 0 && <Badge tone="warning">Featured</Badge>}</span>
            <Button variant="danger-ghost" size="sm" icon={Trash2} onClick={() => removeAt(i)} aria-label={`Remove reward ${i + 1}`} />
          </div>
          <div className="oow-row-2">
            <Field label="Name">
              <input type="text" value={r.name} onChange={e => updateAt(i, { name: e.target.value })} placeholder="Free coffee" />
            </Field>
            <Field label="Cups needed">
              <input type="number" min="1" value={r.cupsNeeded} onChange={e => updateAt(i, { cupsNeeded: parseInt(e.target.value, 10) || 1 })} />
            </Field>
          </div>
          <div className="oow-row-2">
            <Field label="Cashback value">
              <div className="oow-prefix">
                <span className="oow-prefix__text">{symbol}</span>
                <input type="number" step="0.01" min="0" value={r.euros} onChange={e => updateAt(i, { euros: parseFloat(e.target.value) || 0 })} />
              </div>
            </Field>
            <Field label="Image link">
              <input type="url" value={r.image} onChange={e => updateAt(i, { image: e.target.value })} placeholder="https://" />
            </Field>
          </div>
          <Field label="Description">
            <textarea value={r.description} onChange={e => updateAt(i, { description: e.target.value })} placeholder="A short line for the reward card." rows={2} />
          </Field>
        </div>
      ))}
      {rewards.length > 0 && (
        <Button icon={Plus} onClick={add} className="oow-add">Add another reward</Button>
      )}
    </div>
  );
}

/* ─── Step: app copy ──────────────────────────────────────────────── */
function StepCopy({ data, grouped, onChange }) {
  return (
    <div className="oow-form">
      <p className="oow-step-intro">
        The words on the customer’s home screen, filled in for the programme you picked. You can change them later in Design &amp; copy.
        {grouped && ' A venue in a group shows the group’s headline instead.'}
      </p>
      <Field label="Headline">
        <input type="text" value={data.heroHeadline} onChange={e => onChange({ heroHeadline: e.target.value })} />
      </Field>
      <Field label="Subtext">
        <textarea value={data.heroSubtext} onChange={e => onChange({ heroSubtext: e.target.value })} rows={2} />
      </Field>
      <div className="oow-row-2">
        <Field label="Donation recipient">
          <input type="text" value={data.donationRecipient} onChange={e => onChange({ donationRecipient: e.target.value })} placeholder="Plastic Soup Foundation" />
        </Field>
        <Field label="What the charity does">
          <input type="text" value={data.donationDescription} onChange={e => onChange({ donationDescription: e.target.value })} />
        </Field>
      </div>
      <div className="oow-row-3">
        <Field label="Privacy policy link">
          <input type="url" value={data.privacyUrl} onChange={e => onChange({ privacyUrl: e.target.value })} placeholder="https://" />
        </Field>
        <Field label="Terms link">
          <input type="url" value={data.termsUrl} onChange={e => onChange({ termsUrl: e.target.value })} placeholder="https://" />
        </Field>
        <Field label="Cookie policy link">
          <input type="url" value={data.cookieUrl} onChange={e => onChange({ cookieUrl: e.target.value })} placeholder="https://" />
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
      <p className="oow-step-intro">Set for the programme you picked. You can change them later in Settings → Features.</p>
      <div className="oow-toggles">
        <ToggleRow
          label="Cup sharing"
          hint="Customers can give cups to each other with a QR code."
          value={data.featureCupSharing}
          onChange={(v) => onChange({ featureCupSharing: v })}
        />
        <ToggleRow
          label="Donations"
          hint="Customers can donate cups to a partner charity."
          value={data.featureDonations}
          onChange={(v) => onChange({ featureDonations: v })}
        />
        <ToggleRow
          label="Direct refunds"
          hint={byo
            ? 'Off for Bring Your Own: turning it on lets customers cash out instead of working toward a reward.'
            : 'Customers can cash out their cups instead of choosing a reward.'}
          value={data.featureDirectRefunds}
          onChange={(v) => onChange({ featureDirectRefunds: v })}
        />
      </div>
    </div>
  );
}

/* ─── Step: team invites ──────────────────────────────────────────── */
/* The role values are admin_roles keys. Manager and Viewer see only the new
 * organisation; a master sees every organisation. */
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
      <p className="oow-step-intro">
        Invite people to the dashboard. A master is PackBack staff and sees every organisation, so
        pick Manager or Viewer for the venue’s own team. You can also do this later in Master settings → People.
      </p>
      {invites.length === 0 && (
        <div className="oow-empty">
          <p>No one invited yet.</p>
          <Button size="sm" icon={Plus} onClick={add}>Invite someone</Button>
        </div>
      )}
      {invites.map((inv, i) => (
        <div key={i} className="oow-card">
          <div className="oow-invite-row">
            <Field label="Email">
              <input
                type="email"
                value={inv.email}
                onChange={e => updateAt(i, { email: e.target.value })}
                placeholder="name@company.com"
                disabled={inv.method === 'link'}
              />
            </Field>
            <Field label="Role">
              <select value={inv.role} onChange={e => updateAt(i, { role: e.target.value })}>
                <option value="manager">Manager (this organisation)</option>
                <option value="viewer">Viewer (this organisation)</option>
                <option value="master">Master (every organisation)</option>
              </select>
            </Field>
            <Field label="How">
              <select value={inv.method} onChange={e => updateAt(i, { method: e.target.value })}>
                <option value="email">Email</option>
                <option value="link">Shareable link</option>
              </select>
            </Field>
            <Button variant="danger-ghost" size="sm" icon={Trash2} onClick={() => removeAt(i)} aria-label={`Remove invite ${i + 1}`} className="oow-invite-row__remove" />
          </div>
          {inv.role === 'master' && (
            <p className="oow-warn">
              <TriangleAlert size={14} aria-hidden="true" />
              A master sees and changes every organisation, including payouts. Only pick it for PackBack staff.
            </p>
          )}
        </div>
      ))}
      {invites.length > 0 && (
        <Button icon={Plus} onClick={add} className="oow-add">Invite someone else</Button>
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
    return 'No group';
  })();

  const rows = [
    ['Programme', model?.label || '—'],
    ...(model?.group === 'never' ? [] : [['Group', groupLabel]]),
    ['Name', data.brand.name || '—'],
    ['Customer app', data.brand.slug ? `/${data.brand.slug}/` : '—'],
    ['Brand colour', data.brand.brand_color],
    ['Region', data.legal.country || '—'],
    ['Legal name', data.legal.legal_name || 'Not set'],
    ['First location', data.location.skipped || !data.location.name ? 'Skipped' : data.location.name],
    isTikkie
      ? ['Refund', `${adminMoney(data.economics.refundRatePerCup)} per cup`]
      : ['Cashback / refund', `${adminMoney(data.economics.cashbackRatePerCup)} / ${adminMoney(data.economics.refundRatePerCup)} per cup`],
    ...(steps.some(s => s.id === 'rewards')
      ? [['Starter rewards', data.rewards.length === 0 ? 'None' : `${data.rewards.length}`]]
      : []),
    ...(steps.some(s => s.id === 'features')
      ? [['Features', [
          data.features.featureCupSharing && 'sharing',
          data.features.featureDonations && 'donations',
          data.features.featureDirectRefunds && 'direct refunds',
        ].filter(Boolean).join(', ') || 'none']]
      : []),
    ['Invitations', data.invites.length === 0 ? 'None' : `${data.invites.length}`],
  ];

  return (
    <div className="oow-form">
      <p className="oow-step-intro">
        Check the details. <strong>Create organisation</strong> sets everything up and opens the new venue in the dashboard.
      </p>
      <dl className="oow-review">
        {rows.map(([k, v]) => (
          <div key={k} className="oow-review__row">
            <dt className="oow-review__k">{k}</dt>
            <dd className="oow-review__v">
              {k === 'Brand colour' && <span className="oow-swatch" style={{ background: v }} aria-hidden="true" />}
              {v}
            </dd>
          </div>
        ))}
      </dl>
      {isTikkie && (
        <p className="oow-note">
          Next: point the smart bin at this venue, then print a test receipt from the Receipt
          generator to check the Tikkie link works end to end.
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
        {required && <span className="oow-field__req" aria-hidden="true">*</span>}
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
      <Switch checked={value} onChange={onChange} label={label} />
    </div>
  );
}
