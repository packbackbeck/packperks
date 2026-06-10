import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useOrg } from '../context/OrgContext';
import { getRewardBudget, saveRewardBudget } from '../lib/adminApi';
import RewardBudgetMonitor from '../shared/RewardBudgetMonitor';
import QuickLinks from '../shared/QuickLinks';
import './AdminSettings.css';

/* ─────────────────────────────────────────────────────────────────────
 * AdminSettings — platform configuration page.
 *
 * Layout (left → right):
 *
 *   ┌──────────────┐  ┌──────────────────────────────────────────────┐
 *   │  TOC nav     │  │  Sectioned card stack                         │
 *   │  (sticky)    │  │  · Payout rates                               │
 *   │  · Rates     │  │  · App copy                                   │
 *   │  · Copy      │  │  · Cup rules                                  │
 *   │  · Rules     │  │  · Feature flags                              │
 *   │  · Flags     │  │  · Legal links                                │
 *   │  · Legal     │  │                                               │
 *   └──────────────┘  └──────────────────────────────────────────────┘
 *
 * The TOC nav is anchor-based — clicking scrolls to the matching card
 * with smooth behaviour. Each section is a fully visible card with an
 * icon swatch, title, description, and a list of fields. This pattern
 * mirrors AdminOrg and AdminSupport so the dashboard feels consistent.
 *
 * Every edit auto-saves to the local draft via the parent's updateDraft;
 * a small status pill near the header confirms that with "Auto-saved".
 */

const SECTIONS = [
  {
    id: 'rates',
    title: 'Payout rates',
    desc: 'How many euros each returned cup is worth to your customers.',
    tone: 'orange',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="1" x2="12" y2="23" />
        <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
      </svg>
    ),
  },
  {
    id: 'copy',
    title: 'App copy',
    desc: 'Text shown to customers across the user-facing app.',
    tone: 'purple',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
        <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
      </svg>
    ),
  },
  {
    id: 'rules',
    title: 'Cup rules',
    desc: 'Limits around scans, shares, and IBAN validation.',
    tone: 'cream',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8h1a4 4 0 010 8h-1" />
        <path d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z" />
        <line x1="6" y1="1" x2="6" y2="4" /><line x1="10" y1="1" x2="10" y2="4" /><line x1="14" y1="1" x2="14" y2="4" />
      </svg>
    ),
  },
  {
    id: 'flags',
    title: 'Feature flags',
    desc: 'Switch optional features and maintenance mode on or off.',
    tone: 'orange',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
        <line x1="4" y1="22" x2="4" y2="15" />
      </svg>
    ),
  },
  {
    id: 'legal',
    title: 'Legal links',
    desc: 'External URLs surfaced in the app footer.',
    tone: 'slate',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
    ),
  },
  {
    id: 'budget',
    title: 'Reward budget',
    desc: 'Cap how much cashback this organisation pays out. Customers never see the amount.',
    tone: 'orange',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a10 10 0 100 20 10 10 0 000-20z" />
        <path d="M12 6v6l4 2" />
      </svg>
    ),
  },
];

const FEATURE_FLAGS = [
  { key: 'featureCupSharing',    label: 'Cup sharing',     desc: 'Customers can share cups with friends via QR.' },
  { key: 'featureDonations',     label: 'Donations',       desc: 'Customers can donate cups to a charity partner.' },
  { key: 'featureDirectRefunds', label: 'Direct refunds',  desc: 'Customers can withdraw cups as cash at the lower rate.' },
];

/* ── Reusable form atoms ─────────────────────────────────────────── */

function ToggleSwitch({ checked, onChange, ariaLabel }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      className={`toggle-switch ${checked ? 'toggle-switch--on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle-switch__thumb" />
    </button>
  );
}

/* Convert a settings key (camelCase) into a human label for the
 * auto-save toast. We could thread an explicit label through every
 * updateSetting call, and we do for the ones whose key isn't already
 * legible, but the fallback handles most cases automatically. */
function prettifyKey(key) {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, c => c.toUpperCase())
    .replace(/\bRate Per Cup\b/, 'rate')
    .trim();
}

function Field({ label, hint, htmlFor, children }) {
  return (
    <div className="as-field">
      <div className="as-field__label-wrap">
        <label className="as-field__label" htmlFor={htmlFor}>{label}</label>
        {hint && <span className="as-field__hint">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function SectionCard({ section, children }) {
  return (
    <section id={`s-${section.id}`} className="as-card">
      <header className="as-card__head">
        <span className={`as-card__icon as-card__icon--${section.tone}`}>{section.icon}</span>
        <div>
          <h2 className="as-card__title">{section.title}</h2>
          <p className="as-card__desc">{section.desc}</p>
        </div>
      </header>
      <div className="as-card__body">
        {children}
      </div>
    </section>
  );
}

/* ── Page ────────────────────────────────────────────────────────── */

/* Reward budget control + monitor. Self-contained: reads and writes the
 * admin-only org_reward_budgets table directly (not the draft config), so the
 * cap takes effect immediately and the amount never ships to the customer. */
function RewardBudgetSection() {
  const { activeOrg } = useOrg();
  const orgId = activeOrg?.id;
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [cap, setCap] = useState('200');
  const [spent, setSpent] = useState(0);
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    if (!orgId) { setLoading(false); return; }
    setLoading(true);
    getRewardBudget(orgId)
      .then(b => {
        if (!alive) return;
        setEnabled(b.enabled);
        setCap(String(b.cap));
        setSpent(b.spent);
        setLoading(false);
      })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [orgId]);

  const capNum = Math.max(0, parseFloat(cap) || 0);

  async function handleSave() {
    if (!orgId) return;
    setSaving(true); setError(null); setSavedOk(false);
    try {
      await saveRewardBudget(orgId, { cap: capNum, enabled });
      const fresh = await getRewardBudget(orgId);
      setSpent(fresh.spent);
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 2500);
    } catch (e) {
      setError(e?.message || 'Could not save the budget.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="as-budget__loading">Loading budget…</p>;

  return (
    <>
      <Field
        label="Cap reward spending"
        hint="When the cap is reached, customers cannot claim cashback. They see a neutral “rewards paused” message and never see any figure."
      >
        <ToggleSwitch checked={enabled} onChange={setEnabled} ariaLabel="Enable reward budget cap" />
      </Field>

      <Field label="Budget cap (€)" hint="Total cashback this organisation will pay out before claiming pauses.">
        <input
          className="as-input"
          type="number"
          min="0"
          step="10"
          value={cap}
          onChange={e => setCap(e.target.value)}
          disabled={!enabled}
          placeholder="200"
        />
      </Field>

      <RewardBudgetMonitor cap={capNum} enabled={enabled} spent={spent} title="Budget monitor" />

      <div className="as-budget__actions">
        <button className="as-budget__save" type="button" onClick={handleSave} disabled={saving || !orgId}>
          {saving ? 'Saving…' : 'Save budget'}
        </button>
        {savedOk && <span className="as-budget__ok">Saved</span>}
        {error && <span className="as-budget__err">{error}</span>}
      </div>
    </>
  );
}

export default function AdminSettings({ draftState, onNavigate }) {
  const { draft, updateDraft, statusLabel, published } = draftState;
  const settings = draft.settings;

  /* Rate-change warning (P-19).
   *
   * Editing cashback / refund rates retroactively affects every claim
   * that hasn't been approved yet — those claims sit at status=pending
   * and pull their payout amount from the rate at approval time, not
   * the rate at submission time.
   *
   * To make that impact visible we:
   *   1. Compare the draft rate vs the last-published rate.
   *   2. Count pending cashback claims via a lightweight COUNT query.
   *   3. When the rate has drifted, render a banner explaining what
   *      will happen if Publish is hit right now.
   *
   * We don't actually implement effective-dating — that's a bigger
   * schema change — but the banner alone prevents the silent-money-
   * movement footgun the external review called out. */
  const publishedSettings = published?.settings;
  const pubCashback = publishedSettings?.cashbackRatePerCup ?? settings.cashbackRatePerCup;
  const pubRefund   = publishedSettings?.refundRatePerCup   ?? settings.refundRatePerCup;
  const cashbackChanged = Math.abs(settings.cashbackRatePerCup - pubCashback) > 0.001;
  const refundChanged   = Math.abs(settings.refundRatePerCup   - pubRefund)   > 0.001;
  const ratesChanged = cashbackChanged || refundChanged;

  const [pendingCounts, setPendingCounts] = useState({ cashback: null, refund: null });
  useEffect(() => {
    // Pull pending counts once per page mount. Cheap (COUNT only), no
    // realtime needed — when the admin returns to Settings later, the
    // figure refreshes.
    let cancelled = false;
    Promise.all([
      supabase.from('claims').select('id', { count: 'exact', head: true }).eq('status', 'pending').eq('type', 'cashback'),
      supabase.from('claims').select('id', { count: 'exact', head: true }).eq('status', 'pending').eq('type', 'direct_refund'),
    ]).then(([cb, rf]) => {
      if (cancelled) return;
      setPendingCounts({ cashback: cb.count ?? 0, refund: rf.count ?? 0 });
    });
    return () => { cancelled = true; };
  }, []);

  /* Auto-save feedback (P-18).
   *
   * The previous behaviour was: type a new value, click elsewhere, see
   * nothing. The status pill at the top read "Auto-saved" but it was
   * too subtle to function as a confirmation. The toast adds an
   * unmissable inline ping after every edit:
   *
   *   "Saved · Cashback rate"
   *
   * It fades 2.4s after the most-recent edit so quick successive
   * changes still leave only the last one visible. */
  const [savedToast, setSavedToast] = useState(null); // { label, ts } | null

  function updateSetting(key, value, label) {
    updateDraft(prev => ({
      ...prev,
      settings: { ...prev.settings, [key]: value },
    }));
    setSavedToast({ label: label || prettifyKey(key), ts: Date.now() });
  }

  useEffect(() => {
    if (!savedToast) return;
    const t = setTimeout(() => setSavedToast(null), 2400);
    return () => clearTimeout(t);
  }, [savedToast]);

  // Highlight whichever section is closest to the top of the viewport,
  // so the TOC stays in sync as the admin scrolls. We listen with
  // IntersectionObserver — cheaper than scroll-position math and only
  // fires when a section's threshold crosses.
  const [activeId, setActiveId] = useState('rates');
  useEffect(() => {
    const els = SECTIONS.map(s => document.getElementById(`s-${s.id}`)).filter(Boolean);
    if (els.length === 0) return;
    const io = new IntersectionObserver(
      entries => {
        // Pick the topmost intersecting section.
        const visible = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id.replace('s-', ''));
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0 },
    );
    els.forEach(el => io.observe(el));
    return () => io.disconnect();
  }, []);

  function jumpTo(id) {
    const el = document.getElementById(`s-${id}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div className="admin-settings">
      {/* Page header */}
      <header className="as-header">
        <div className="as-header__text">
          <span className="as-header__eyebrow">Configuration</span>
          <h1 className="as-header__title">Settings</h1>
          <p className="as-header__sub">
            Tune payout rates, app copy, feature flags, and legal links.
            Every change auto-saves to your draft — hit <strong>Publish</strong> in
            the top bar to push it live to customers.
          </p>
        </div>
        <div className="as-header__status">
          <span className={`as-status-pill${statusLabel?.toLowerCase().includes('published') ? ' as-status-pill--live' : ''}`}>
            <span className="as-status-pill__dot" />
            {statusLabel || 'Up to date'}
          </span>
        </div>
      </header>

      <div className="as-layout">
        {/* Sticky TOC */}
        <nav className="as-toc" aria-label="Settings sections">
          {SECTIONS.map(s => (
            <button
              key={s.id}
              type="button"
              className={`as-toc__item${activeId === s.id ? ' as-toc__item--active' : ''}`}
              onClick={() => jumpTo(s.id)}
            >
              <span className={`as-toc__icon as-toc__icon--${s.tone}`}>{s.icon}</span>
              <span className="as-toc__label">{s.title}</span>
            </button>
          ))}
        </nav>

        {/* Section stack */}
        <div className="as-content">
          {/* ── Payout rates ── */}
          <SectionCard section={SECTIONS[0]}>
            {ratesChanged && (
              <div className="as-rate-warn">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                <div>
                  <strong>Rate change will affect pending claims.</strong>
                  <p>
                    {cashbackChanged && (
                      <>Cashback: €{pubCashback.toFixed(2)} → <strong>€{settings.cashbackRatePerCup.toFixed(2)}</strong>/cup. </>
                    )}
                    {refundChanged && (
                      <>Refund: €{pubRefund.toFixed(2)} → <strong>€{settings.refundRatePerCup.toFixed(2)}</strong>/cup. </>
                    )}
                    When you hit <strong>Publish</strong>, every claim still pending at that moment
                    will be approved at the new rate — not the rate that was live when the customer
                    submitted it.{' '}
                    {pendingCounts.cashback != null && (
                      <>
                        Right now there {pendingCounts.cashback === 1 ? 'is' : 'are'}{' '}
                        <strong>{pendingCounts.cashback}</strong> pending cashback claim
                        {pendingCounts.cashback === 1 ? '' : 's'}
                        {pendingCounts.refund > 0 && <> and <strong>{pendingCounts.refund}</strong> pending refund{pendingCounts.refund === 1 ? '' : 's'}</>}
                        .
                      </>
                    )}
                  </p>
                </div>
              </div>
            )}

            <Field label="Cashback rate" hint="Paid when a customer redeems for a food reward.">
              <div className="as-input-prefix-wrap">
                <span className="as-input-prefix">€</span>
                <input
                  className="as-input as-input--prefix"
                  type="number"
                  step="0.05"
                  min="0"
                  max="5"
                  value={settings.cashbackRatePerCup}
                  onChange={e => updateSetting('cashbackRatePerCup', parseFloat(e.target.value) || 0)}
                />
                <span className="as-input-suffix">per cup</span>
              </div>
            </Field>

            <Field label="Direct refund rate" hint="Paid when a customer cashes out instead of choosing a reward.">
              <div className="as-input-prefix-wrap">
                <span className="as-input-prefix">€</span>
                <input
                  className="as-input as-input--prefix"
                  type="number"
                  step="0.05"
                  min="0"
                  max="5"
                  value={settings.refundRatePerCup}
                  onChange={e => updateSetting('refundRatePerCup', parseFloat(e.target.value) || 0)}
                />
                <span className="as-input-suffix">per cup</span>
              </div>
            </Field>

            <div className="as-rate-preview">
              <div className="as-rate-preview__head">
                <span className="as-rate-preview__title">What customers will see</span>
                <span className="as-rate-preview__hint">Auto-updates as you edit above.</span>
              </div>
              <div className="as-rate-preview__grid">
                <div className="as-rate-preview__cell">
                  <span className="as-rate-preview__cell-label">3 cups · cashback</span>
                  <span className="as-rate-preview__cell-val">€{(settings.cashbackRatePerCup * 3).toFixed(2)}</span>
                </div>
                <div className="as-rate-preview__cell">
                  <span className="as-rate-preview__cell-label">6 cups · cashback</span>
                  <span className="as-rate-preview__cell-val">€{(settings.cashbackRatePerCup * 6).toFixed(2)}</span>
                </div>
                <div className="as-rate-preview__cell as-rate-preview__cell--muted">
                  <span className="as-rate-preview__cell-label">3 cups · direct refund</span>
                  <span className="as-rate-preview__cell-val">€{(settings.refundRatePerCup * 3).toFixed(2)}</span>
                </div>
                <div className="as-rate-preview__cell as-rate-preview__cell--accent">
                  <span className="as-rate-preview__cell-label">Cashback uplift</span>
                  <span className="as-rate-preview__cell-val">
                    +€{((settings.cashbackRatePerCup - settings.refundRatePerCup)).toFixed(2)}/cup
                  </span>
                </div>
              </div>
            </div>
          </SectionCard>

          {/* ── App copy ── */}
          <SectionCard section={SECTIONS[1]}>
            <Field label="Hero headline" hint="Top of the user app homepage.">
              <input className="as-input" value={settings.heroHeadline} onChange={e => updateSetting('heroHeadline', e.target.value)} placeholder="Collect Cups & Get Rewards" />
            </Field>

            <Field label="Hero subtext" hint="One or two short sentences under the headline.">
              <textarea className="as-input as-input--textarea" rows={3} value={settings.heroSubtext} onChange={e => updateSetting('heroSubtext', e.target.value)} />
            </Field>

            <Field label="Donation recipient">
              <input className="as-input" value={settings.donationRecipient} onChange={e => updateSetting('donationRecipient', e.target.value)} placeholder="Plastic Soup Foundation" />
            </Field>

            <Field label="Donation description" hint="Shown on the donate confirmation screen.">
              <textarea className="as-input as-input--textarea" rows={3} value={settings.donationDescription} onChange={e => updateSetting('donationDescription', e.target.value)} />
            </Field>
          </SectionCard>

          {/* ── Cup rules ── */}
          <SectionCard section={SECTIONS[2]}>
            <div className="as-field-row">
              <Field label="Cups awarded per scan" hint="Most bins emit one cup per scan.">
                <input
                  className="as-input as-input--short"
                  type="number" min="1" max="10"
                  value={settings.maxCupsPerScan}
                  onChange={e => updateSetting('maxCupsPerScan', parseInt(e.target.value) || 1)}
                />
              </Field>

              <Field label="Max cups per share" hint="Upper bound on a peer-to-peer transfer.">
                <input
                  className="as-input as-input--short"
                  type="number" min="1" max="50"
                  value={settings.maxCupsToShare}
                  onChange={e => updateSetting('maxCupsToShare', parseInt(e.target.value) || 1)}
                />
              </Field>

              <Field label="Min IBAN length" hint="Validates the IBAN on profile setup.">
                <input
                  className="as-input as-input--short"
                  type="number" min="10" max="34"
                  value={settings.minIbanLength}
                  onChange={e => updateSetting('minIbanLength', parseInt(e.target.value) || 15)}
                />
              </Field>
            </div>
          </SectionCard>

          {/* ── Feature flags ── */}
          <SectionCard section={SECTIONS[3]}>
            <div className="as-flag-list">
              {FEATURE_FLAGS.map(f => (
                <label key={f.key} className="as-flag-row">
                  <div className="as-flag-row__info">
                    <div className="as-flag-row__label">{f.label}</div>
                    <div className="as-flag-row__desc">{f.desc}</div>
                  </div>
                  <ToggleSwitch
                    checked={!!settings[f.key]}
                    onChange={v => updateSetting(f.key, v)}
                    ariaLabel={`${f.label} toggle`}
                  />
                </label>
              ))}

              <label className="as-flag-row">
                <div className="as-flag-row__info">
                  <div className="as-flag-row__label">Require email verification</div>
                  <div className="as-flag-row__desc">
                    On: customers confirm a code the first time they add an email (current behaviour).
                    Off: any email is saved instantly with no code, and customers can change it freely.
                    Restoring an account on a new device always requires a code.
                  </div>
                </div>
                <ToggleSwitch
                  checked={settings.requireEmailVerification !== false}
                  onChange={v => updateSetting('requireEmailVerification', v, 'email verification')}
                  ariaLabel="Require email verification toggle"
                />
              </label>
            </div>

            {/* Maintenance mode lives in its own block — disruptive switch. */}
            <div className={`as-maintenance${settings.maintenanceMode ? ' as-maintenance--on' : ''}`}>
              <div className="as-maintenance__row">
                <div className="as-maintenance__info">
                  <div className="as-maintenance__label">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                      <line x1="12" y1="9" x2="12" y2="13" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    Maintenance mode
                  </div>
                  <div className="as-maintenance__desc">
                    Shows a banner across the user app and blocks new scans / claims.
                  </div>
                </div>
                <ToggleSwitch
                  checked={!!settings.maintenanceMode}
                  onChange={v => updateSetting('maintenanceMode', v)}
                  ariaLabel="Maintenance mode toggle"
                />
              </div>
              {settings.maintenanceMode && (
                <div className="as-maintenance__warn">
                  Customers currently can't claim or scan. Toggle off when you're ready.
                </div>
              )}
            </div>
          </SectionCard>

          {/* ── Legal links ── */}
          <SectionCard section={SECTIONS[4]}>
            <Field label="Privacy policy URL">
              <input className="as-input as-input--mono" value={settings.privacyUrl} onChange={e => updateSetting('privacyUrl', e.target.value)} placeholder="https://packperks.nl/privacy" />
            </Field>

            <Field label="Terms of service URL">
              <input className="as-input as-input--mono" value={settings.termsUrl} onChange={e => updateSetting('termsUrl', e.target.value)} placeholder="https://packperks.nl/terms" />
            </Field>

            <Field label="Cookie policy URL">
              <input className="as-input as-input--mono" value={settings.cookieUrl} onChange={e => updateSetting('cookieUrl', e.target.value)} placeholder="https://packperks.nl/cookies" />
            </Field>
          </SectionCard>

          {/* ── Reward budget ── */}
          <SectionCard section={SECTIONS[5]}>
            <RewardBudgetSection />

            <div className="as-budget-copy">
              <p className="as-budget-copy__head">Message shown when the cap is reached</p>
              <p className="as-budget-copy__hint">
                Shown to customers when claiming is paused. It never reveals the amount or that a
                budget exists. This text follows the normal Publish flow (Save draft, then Publish).
              </p>
              <Field label="Title">
                <input
                  className="as-input"
                  value={settings.budgetPausedTitle || ''}
                  onChange={e => updateSetting('budgetPausedTitle', e.target.value, 'paused message title')}
                  placeholder="Rewards are paused for a moment"
                />
              </Field>
              <Field label="Body">
                <textarea
                  className="as-input as-input--textarea"
                  rows={3}
                  value={settings.budgetPausedBody || ''}
                  onChange={e => updateSetting('budgetPausedBody', e.target.value, 'paused message body')}
                  placeholder="We're handling a high number of reward claims right now, so claiming is briefly unavailable. Please try again a little later."
                />
              </Field>
            </div>
          </SectionCard>
        </div>
      </div>

      <QuickLinks currentPage="settings" onNavigate={onNavigate} />

      {/* Auto-save confirmation toast — fades after the most-recent
       *  edit, keyed on `ts` so quick successive saves re-trigger the
       *  animation instead of stacking. */}
      {savedToast && (
        <div className="as-toast" key={savedToast.ts} role="status" aria-live="polite">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6L9 17l-5-5" />
          </svg>
          <span><strong>Saved</strong> · {savedToast.label}</span>
        </div>
      )}
    </div>
  );
}
