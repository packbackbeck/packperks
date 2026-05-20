import { useState, useEffect, useMemo } from 'react';
import { createOrganization } from '../lib/adminApi';
import { useOrg } from '../context/OrgContext';
import './OrgOnboardingWizard.css';

/* ─────────────────────────────────────────────────────────────────────
 * OrgOnboardingWizard — 9-step modal flow for PackPerks staff to add
 * a brand-new client organisation. The output is everything the
 * dashboard + user-app need to function as that brand: data row,
 * locations, published rewards/settings, and optional team invites.
 *
 * Steps:
 *   1. Brand identity   — name, slug, partner brand, email hint,
 *                          colour, logo URL
 *   2. Legal & contact  — KVK, BTW, address, contact email/phone, web
 *   3. First location   — name, address, status (optional/skippable)
 *   4. Cup economics    — refund/cashback rates, max-per-scan/share
 *   5. Starter rewards  — add 0..N rewards (optional)
 *   6. App copy         — hero headline/subtext, donation copy, URLs
 *   7. Feature flags    — sharing, donations, direct refunds toggles
 *   8. Team invites     — invite by email or generate link (optional)
 *   9. Review & launch  — summary of everything + Create button
 *
 * On successful creation: the OrgContext is refreshed, we switch into
 * the new org, and the modal closes.
 *
 * Validation is intentionally loose for the prototype: only step 1's
 * name+slug are required; everything else can be edited later from
 * the org details / settings pages.
 * ───────────────────────────────────────────────────────────────────── */

const TOTAL_STEPS = 9;

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
    heroHeadline: 'Collect Cups & Get Rewards',
    heroSubtext: 'We pool your packaging returns into one cashback payout.',
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

export default function OrgOnboardingWizard({ onClose, onCreated }) {
  const [step, setStep]   = useState(1);
  const [data, setData]   = useState(EMPTY_DATA);
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState(null);
  const { refresh, switchOrg } = useOrg();

  // Auto-derive slug from name unless the user manually edited it.
  const [slugTouched, setSlugTouched] = useState(false);
  useEffect(() => {
    if (slugTouched) return;
    if (!data.brand.name) return;
    setData(d => ({ ...d, brand: { ...d.brand, slug: slugify(d.brand.name) } }));
  }, [data.brand.name, slugTouched]);

  const canAdvance = useMemo(() => {
    switch (step) {
      case 1:
        return !!data.brand.name.trim() && !!data.brand.slug.trim();
      default:
        return true;
    }
  }, [step, data]);

  function updateSection(section, patch) {
    setData(d => ({ ...d, [section]: { ...d[section], ...patch } }));
  }

  async function handleSubmit() {
    setBusy(true);
    setError(null);
    try {
      const payload = {
        brand: data.brand,
        legal: data.legal,
        location: data.location.skipped ? null : data.location,
        economics: data.economics,
        rewards: data.rewards,
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
            <div className="oow-eyebrow">Add organisation · Step {step} of {TOTAL_STEPS}</div>
            <h2 className="oow-title">{STEP_TITLES[step - 1]}</h2>
          </div>
          <button className="oow-close" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </header>

        <div className="oow-progress">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => (
            <span
              key={i}
              className={`oow-progress__seg ${i + 1 < step ? 'oow-progress__seg--done' : ''} ${i + 1 === step ? 'oow-progress__seg--active' : ''}`}
            />
          ))}
        </div>

        <div className="oow-body">
          {step === 1 && (
            <Step1Brand
              data={data.brand}
              onChange={(patch) => {
                if (patch.slug !== undefined) setSlugTouched(true);
                updateSection('brand', patch);
              }}
            />
          )}
          {step === 2 && (
            <Step2Legal data={data.legal} onChange={(patch) => updateSection('legal', patch)} />
          )}
          {step === 3 && (
            <Step3Location data={data.location} onChange={(patch) => updateSection('location', patch)} />
          )}
          {step === 4 && (
            <Step4Economics data={data.economics} onChange={(patch) => updateSection('economics', patch)} />
          )}
          {step === 5 && (
            <Step5Rewards
              rewards={data.rewards}
              onChange={(next) => setData(d => ({ ...d, rewards: next }))}
            />
          )}
          {step === 6 && (
            <Step6Copy data={data.copy} onChange={(patch) => updateSection('copy', patch)} />
          )}
          {step === 7 && (
            <Step7Features data={data.features} onChange={(patch) => updateSection('features', patch)} />
          )}
          {step === 8 && (
            <Step8Invites
              invites={data.invites}
              onChange={(next) => setData(d => ({ ...d, invites: next }))}
            />
          )}
          {step === 9 && (
            <Step9Review data={data} />
          )}
        </div>

        {error && <div className="oow-error">{error}</div>}

        <footer className="oow-footer">
          <button
            type="button"
            className="oow-btn oow-btn--ghost"
            onClick={() => setStep(s => Math.max(1, s - 1))}
            disabled={busy || step === 1}
          >
            Back
          </button>
          <div className="oow-footer__right">
            {step < TOTAL_STEPS ? (
              <button
                type="button"
                className="oow-btn oow-btn--primary"
                onClick={() => setStep(s => Math.min(TOTAL_STEPS, s + 1))}
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

const STEP_TITLES = [
  'Brand identity',
  'Legal & contact details',
  'First location',
  'Cup economics',
  'Starter rewards',
  'App copy',
  'Feature flags',
  'Team invites',
  'Review & launch',
];

/* ─── Step 1: Brand identity ──────────────────────────────────────── */
function Step1Brand({ data, onChange }) {
  return (
    <div className="oow-form">
      <p className="oow-step-intro">Tell us what to call this organisation. Most fields can be edited later — name and URL slug are the only required ones.</p>
      <Field label="Organisation name" required>
        <input
          type="text"
          value={data.name}
          onChange={e => onChange({ name: e.target.value })}
          placeholder="e.g. Big Coffee Co."
          autoFocus
        />
      </Field>
      <Field label="URL slug" required hint="Lowercase, no spaces. Used in the user app URL e.g. /bigcoffee/">
        <input
          type="text"
          value={data.slug}
          onChange={e => onChange({ slug: slugify(e.target.value) })}
          placeholder="bigcoffee"
        />
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
      <Field label="Logo URL" hint="Paste a URL to a logo image. You can also leave blank and add it later from the org details page.">
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

/* ─── Step 2: Legal & contact ─────────────────────────────────────── */
function Step2Legal({ data, onChange }) {
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
        <Field label="Country">
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

/* ─── Step 3: First location ──────────────────────────────────────── */
function Step3Location({ data, onChange }) {
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
      <p className="oow-step-intro">Add the first physical location for this org. You can add more later. <button type="button" className="oow-skip" onClick={() => onChange({ skipped: true })}>Skip this step</button></p>
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

/* ─── Step 4: Cup economics ───────────────────────────────────────── */
function Step4Economics({ data, onChange }) {
  return (
    <div className="oow-form">
      <p className="oow-step-intro">How much each returned cup is worth, and the per-scan limits enforced in the user app.</p>
      <div className="oow-row-2">
        <Field label="Cashback rate (€ per cup)" hint="Used for the standard cashback-to-reward path.">
          <input type="number" step="0.05" min="0" value={data.cashbackRatePerCup} onChange={e => onChange({ cashbackRatePerCup: parseFloat(e.target.value) || 0 })} />
        </Field>
        <Field label="Refund rate (€ per cup)" hint="Used for the direct refund path (lower value, no menu unlock).">
          <input type="number" step="0.05" min="0" value={data.refundRatePerCup} onChange={e => onChange({ refundRatePerCup: parseFloat(e.target.value) || 0 })} />
        </Field>
      </div>
      <div className="oow-row-2">
        <Field label="Max cups per scan" hint="Anti-fraud guardrail.">
          <input type="number" step="1" min="1" value={data.maxCupsPerScan} onChange={e => onChange({ maxCupsPerScan: parseInt(e.target.value, 10) || 1 })} />
        </Field>
        <Field label="Max cups per share" hint="Cap on peer-to-peer cup gifting.">
          <input type="number" step="1" min="1" value={data.maxCupsToShare} onChange={e => onChange({ maxCupsToShare: parseInt(e.target.value, 10) || 1 })} />
        </Field>
      </div>
    </div>
  );
}

/* ─── Step 5: Starter rewards ─────────────────────────────────────── */
function Step5Rewards({ rewards, onChange }) {
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
      <p className="oow-step-intro">Add the rewards a customer can unlock by returning cups. You can leave this empty and add them later from the Rewards tab.</p>
      {rewards.length === 0 && (
        <div className="oow-empty">No starter rewards yet. <button type="button" className="oow-skip" onClick={add}>Add the first one</button></div>
      )}
      {rewards.map((r, i) => (
        <div key={i} className="oow-reward-card">
          <div className="oow-reward-card__head">
            <strong>Reward {i + 1}</strong>
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
            <Field label="Cashback value (€)">
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

/* ─── Step 6: App copy ────────────────────────────────────────────── */
function Step6Copy({ data, onChange }) {
  return (
    <div className="oow-form">
      <p className="oow-step-intro">Customer-facing copy that appears on the home screen. All editable later from the Settings tab.</p>
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

/* ─── Step 7: Feature flags ───────────────────────────────────────── */
function Step7Features({ data, onChange }) {
  return (
    <div className="oow-form">
      <p className="oow-step-intro">Turn optional features on or off for this org. Can be flipped any time from the sidebar's Quick Settings.</p>
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
        hint="Lets customers cash out cups directly (skip menu reward)."
        value={data.featureDirectRefunds}
        onChange={(v) => onChange({ featureDirectRefunds: v })}
      />
    </div>
  );
}

/* ─── Step 8: Team invites ────────────────────────────────────────── */
function Step8Invites({ invites, onChange }) {
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
      <p className="oow-step-intro">Invite teammates to this organisation. You can also do this later from Org → Team.</p>
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

/* ─── Step 9: Review ──────────────────────────────────────────────── */
function Step9Review({ data }) {
  const stats = [
    ['Organisation', data.brand.name || '—'],
    ['URL slug',     data.brand.slug ? `/${data.brand.slug}/` : '—'],
    ['Brand colour', data.brand.brand_color],
    ['Legal name',   data.legal.legal_name || '(not set)'],
    ['First location', data.location.skipped || !data.location.name ? '(skipped)' : data.location.name],
    ['Cashback / refund', `€${data.economics.cashbackRatePerCup.toFixed(2)} / €${data.economics.refundRatePerCup.toFixed(2)} per cup`],
    ['Starter rewards', data.rewards.length === 0 ? '(none)' : `${data.rewards.length} reward(s)`],
    ['Features',     [
      data.features.featureCupSharing && 'sharing',
      data.features.featureDonations && 'donations',
      data.features.featureDirectRefunds && 'direct refunds',
    ].filter(Boolean).join(', ') || 'none'],
    ['Team invites', data.invites.length === 0 ? '(none)' : `${data.invites.length} invite(s)`],
  ];
  return (
    <div className="oow-form">
      <p className="oow-step-intro">Final check. Clicking <strong>Create organisation</strong> will provision everything and switch into the new org.</p>
      <div className="oow-review">
        {stats.map(([k, v]) => (
          <div key={k} className="oow-review__row">
            <span className="oow-review__k">{k}</span>
            <span className="oow-review__v">{v}</span>
          </div>
        ))}
      </div>
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
