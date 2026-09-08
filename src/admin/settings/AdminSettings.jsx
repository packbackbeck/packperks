import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useOrg } from '../context/OrgContext';
import { getRewardBudget, saveRewardBudget, getGroupHideLiveVendors, setGroupHideLiveVendors, getOrgMode, setOrgMode, createOrgGroup, setOrgGroupMembership, setOrgGroupMode, getByoCap, saveByoCap } from '../lib/adminApi';
import { ORG_MODE_META, resolveEffectiveMode } from '../lib/orgModes';
import RewardBudgetMonitor from '../shared/RewardBudgetMonitor';
import QuickLinks from '../shared/QuickLinks';
import TypedConfirmModal from '../shared/TypedConfirmModal';
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

export const SECTIONS = [
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
    desc: 'Limits around scans and shares.',
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
    id: 'limits',
    title: 'Limits & caps',
    desc: 'Hold caps, daily caps, balance resets, and the reward budget — plus the message each shows when hit.',
    tone: 'orange',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a10 10 0 100 20 10 10 0 000-20z" />
        <path d="M12 6v6l4 2" />
      </svg>
    ),
  },
];

/* Which settings sections apply to an EFFECTIVE org mode (see
 * resolveEffectiveMode). Deposit Rewards and Bring Your Own both run the
 * full app so they keep all five sections — the FIELDS inside adapt (BYO
 * swaps bin-batch scan rules for its daily auto-credit cap). Redirect
 * Refund (tikkie-only) has no app, no cup balance and no rewards, so App
 * copy, Cup rules and Limits & caps disappear entirely: rates carries the
 * single refund rate + per-receipt cap, flags carries the mode picker and
 * maintenance mode. */
export function settingsSectionsForMode(mode) {
  if (mode !== 'tikkie_only') return SECTIONS;
  return SECTIONS.filter(s => s.id === 'rates' || s.id === 'flags');
}

const FEATURE_FLAGS = [
  { key: 'featureCupSharing',    label: 'Cup sharing',     desc: 'Customers can share cups with friends via QR.' },
  { key: 'featureDonations',     label: 'Donations',       desc: 'Customers can donate cups to a charity partner.' },
  { key: 'featureDirectRefunds', label: 'Direct refunds',  desc: 'Customers can withdraw cups as cash at the lower rate.' },
  {
    key: 'featureSmartSorting',
    label: 'Smart sorting',
    desc: 'Feature the reward closest to the customer\u2019s cup balance instead of the same flagship reward for everyone \u2014 ideally one they are a single cup away from. A first-timer holding one cup sees a goal they can finish on their next visit, not a distant one. Customers who pick a reward themselves keep it.',
  },
];

/* ── Reusable form atoms ─────────────────────────────────────────── */

function ToggleSwitch({ checked, onChange, ariaLabel, disabled = false }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      className={`toggle-switch ${checked ? 'toggle-switch--on' : ''}${disabled ? ' toggle-switch--locked' : ''}`}
      onClick={() => { if (!disabled) onChange(!checked); }}
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

export default function AdminSettings({ draftState, onNavigate, embedded = false }) {
  const { draft, updateDraft, statusLabel, published } = draftState;
  const settings = draft.settings;

  /* "Hide live vendors" lives on the GROUP config (the market page is a
   * group-scoped hub reading group settings), not the per-org draft — so
   * it's loaded/saved directly against app_config rather than through the
   * publish cycle. Shown only when the active org belongs to a group. */
  const { activeGroupId, activeOrgId, activeOrgMode, activeGroupMode, activeOrg, groupMembers, refresh } = useOrg();
  // The org's EFFECTIVE programme model: tikkie_only lives on the org
  // config, byo/deposit on the group config. Everything below — which
  // sections render, which rate fields show — keys off this one value.
  const effMode = resolveEffectiveMode(activeOrgMode, activeGroupMode);
  const isTikkieOnly = effMode === 'tikkie_only';
  const isByo = effMode === 'byo';
  const visibleSections = settingsSectionsForMode(effMode);

  /* BYO daily auto-credit cap — its own app_config row (byo:cap:<orgId>),
   * read live by the byo-mint edge function, so it saves directly. */
  const [byoCap, setByoCap] = useState(2);
  const [byoCapBusy, setByoCapBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (!isByo || !activeOrgId) return undefined;
    getByoCap(activeOrgId).then(v => { if (!cancelled) setByoCap(v ?? 2); }).catch(() => {});
    return () => { cancelled = true; };
  }, [isByo, activeOrgId]);
  async function changeByoCap(n) {
    const v = Math.max(1, Math.min(50, parseInt(n, 10) || 1));
    setByoCap(v);
    setByoCapBusy(true);
    try { await saveByoCap(activeOrgId, v); } catch { /* keep local; retry on next edit */ }
    setByoCapBusy(false);
  }
  const [hideLive, setHideLive] = useState(false);
  const [hideLiveBusy, setHideLiveBusy] = useState(false);

  /* Org operating mode (standard vs tikkie_only) — written straight to the
   * published config, like the group toggles above. */
  const [orgMode, setOrgModeState] = useState(null);
  const [orgModeBusy, setOrgModeBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (!activeOrgId) { setOrgModeState(null); return; }
    getOrgMode(activeOrgId)
      .then(m => { if (!cancelled) setOrgModeState(m); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [activeOrgId]);

  /* Switch the org between the three programme models.
   *
   *   standard    → clear the org-level mode; a grouped org's group flips
   *                 to 'deposit' (mind: that affects every member).
   *   byo         → needs a group (byo-mint refuses groupless orgs). A
   *                 grouped org flips its group to 'byo'; an ungrouped one
   *                 gets a fresh single-member group named after it.
   *   tikkie_only → org-level flag; only offered while ungrouped.
   */
  /* A grouped org can't change mode on its own: the mode lives on the
   * group config and applies to every venue in it. Requesting a switch
   * opens the explainer; nothing changes until the admin types the word. */
  const [modeConfirm, setModeConfirm] = useState(null); // target key | null

  async function changeOrgMode(next) {
    const target = next || 'standard';
    if (!activeOrgId || orgModeBusy || effMode === target) return;
    if (activeGroupId) return; // guarded in the UI too; belt and braces
    setOrgModeBusy(true);
    try {
      if (target === 'byo') {
        await setOrgMode(activeOrgId, null); // clear any tikkie flag first
        if (activeGroupId) {
          await setOrgGroupMode(activeGroupId, 'byo');
        } else {
          const grp = await createOrgGroup({ name: activeOrg?.name || 'New group', mode: 'byo' });
          await setOrgGroupMembership(activeOrgId, grp.id);
        }
      } else if (target === 'tikkie_only') {
        // Redirect Refund is never grouped — there's no app or market hub for
        // a grouped venue to redirect from. Detach first, otherwise an org
        // that passed through Bring Your Own is stuck in a group with no way
        // back to this mode.
        if (activeGroupId) await setOrgGroupMembership(activeOrgId, null);
        await setOrgMode(activeOrgId, 'tikkie_only');
      } else {
        await setOrgMode(activeOrgId, null);
        if (activeGroupId) await setOrgGroupMode(activeGroupId, 'deposit');
      }
      setOrgModeState(target === 'tikkie_only' ? 'tikkie_only' : null);
      /* Keep the DRAFT in sync too — Publish pushes draft.settings
       * wholesale, so a draft that never learned the mode would silently
       * revert the org on the next publish. */
      updateDraft(d => {
        const settings = { ...d.settings };
        if (target === 'tikkie_only') settings.mode = 'tikkie_only'; else delete settings.mode;
        return { ...d, settings };
      });
      // Group membership / group mode changed → the whole context re-reads.
      await refresh?.(activeOrgId);
      try { window.dispatchEvent(new Event('pp-org-mode-changed')); } catch { /* noop */ }
    } catch (e) {
      console.error('changeOrgMode failed:', e);
    } finally {
      setOrgModeBusy(false);
      setModeConfirm(null);
    }
  }
  useEffect(() => {
    let cancelled = false;
    if (!activeGroupId) { setHideLive(false); return; }
    getGroupHideLiveVendors(activeGroupId)
      .then(v => { if (!cancelled) setHideLive(!!v); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [activeGroupId]);

  async function toggleHideLive(next) {
    if (!activeGroupId || hideLiveBusy) return;
    setHideLive(next);            // optimistic
    setHideLiveBusy(true);
    try {
      await setGroupHideLiveVendors(activeGroupId, next);
    } catch {
      setHideLive(!next);        // roll back on failure
    } finally {
      setHideLiveBusy(false);
    }
  }

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
    <div className={`admin-settings${embedded ? ' admin-settings--embedded' : ''}`}>
      {/* Page header */}
      {!embedded && (
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
      )}

      <div className="as-layout">
        {/* Sticky TOC — hidden when embedded in the merged workspace, which
            provides a shared horizontal table of contents instead. */}
        {!embedded && (
        <nav className="as-toc" aria-label="Settings sections">
          {visibleSections.map(s => (
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
        )}

        {/* Section stack */}
        <div className="as-content">
          {/* ── Payout rates ── */}
          <SectionCard section={SECTIONS[0]}>
            {ratesChanged && !isTikkieOnly && (
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

            {!isTikkieOnly && (
            <Field
              label="Payment method"
              hint={settings.paymentMethod === 'voucher'
                ? 'Rewards are settled at the counter: the customer shows a live voucher, a staff member slides to confirm on their phone, and the cups leave the balance on the spot. No receipt, no AI check, no payout link.'
                : 'Rewards are paid as cashback: the customer uploads a receipt, it is checked, and a payout link is sent through the region\u2019s provider.'}
            >
              <select
                className="as-input"
                value={settings.paymentMethod || 'tikkie'}
                onChange={e => updateSetting('paymentMethod', e.target.value, 'Payment method')}
              >
                <option value="tikkie">Cashback link after review</option>
                <option value="voucher">Counter voucher (staff slide)</option>
              </select>
            </Field>
            )}

            {!isTikkieOnly && (
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
            )}

            {(!isByo || settings.featureDirectRefunds) && (
            <Field
              label={isTikkieOnly ? 'Refund rate' : 'Direct refund rate'}
              hint={isTikkieOnly
                ? 'The rate every bin receipt is paid out at: cups on the receipt × this amount.'
                : 'Paid when a customer cashes out instead of choosing a reward.'}
            >
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
            )}

            {isTikkieOnly && (
            <Field
              label="Max payout per receipt"
              hint="Safety ceiling for one bin receipt, whatever the cup count. The server enforces a hard €25 maximum on top of this."
            >
              <div className="as-input-prefix-wrap">
                <span className="as-input-prefix">€</span>
                <input
                  className="as-input as-input--prefix"
                  type="number" step="0.50" min="1" max="25"
                  value={settings.tikkieMaxPerReceipt ?? 25}
                  onChange={e => updateSetting('tikkieMaxPerReceipt', Math.min(25, Math.max(1, parseFloat(e.target.value) || 25)), 'per-receipt cap')}
                />
                <span className="as-input-suffix">per receipt</span>
              </div>
            </Field>
            )}

            {!isTikkieOnly && (
            <Field label="Receipt claim window" hint="How long a receipt stays claimable after purchase. The AI flags older receipts for review.">
              <div className="as-input-prefix-wrap">
                <input
                  className="as-input"
                  type="number"
                  step="1"
                  min="1"
                  max="365"
                  value={settings.receiptMaxAgeDays ?? 14}
                  onChange={e => updateSetting('receiptMaxAgeDays', parseInt(e.target.value, 10) || 14)}
                />
                <span className="as-input-suffix">days</span>
              </div>
            </Field>
            )}

            <div className="as-rate-preview">
              <div className="as-rate-preview__head">
                <span className="as-rate-preview__title">What customers will see</span>
                <span className="as-rate-preview__hint">Auto-updates as you edit above.</span>
              </div>
              <div className="as-rate-preview__grid">
                {isTikkieOnly ? (
                  [1, 3, 6, 10].map(n => (
                    <div key={n} className="as-rate-preview__cell">
                      <span className="as-rate-preview__cell-label">{n} cup{n === 1 ? '' : 's'} returned</span>
                      <span className="as-rate-preview__cell-val">€{(settings.refundRatePerCup * n).toFixed(2)}</span>
                    </div>
                  ))
                ) : (
                  <>
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
                  </>
                )}
              </div>
            </div>
          </SectionCard>

          {/* ── App copy ── */}
          {!isTikkieOnly && (
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
          )}

          {/* ── Cup rules ── */}
          {!isTikkieOnly && (
          <SectionCard section={SECTIONS[2]}>
            <div className="as-field-row">
              {isByo ? (
                <Field
                  label="Daily auto-credit cap"
                  hint={`Counter-QR scans credited automatically per customer per rolling 24h. Scans above it are held for review on the BYO QR Codes page.${byoCapBusy ? ' Saving…' : ''}`}
                >
                  <input
                    className="as-input as-input--short"
                    type="number" min="1" max="50"
                    value={byoCap}
                    onChange={e => changeByoCap(e.target.value)}
                  />
                </Field>
              ) : (
                <Field label="Cups awarded per scan" hint="Most bins emit one cup per scan.">
                  <input
                    className="as-input as-input--short"
                    type="number" min="1" max="10"
                    value={settings.maxCupsPerScan}
                    onChange={e => updateSetting('maxCupsPerScan', parseInt(e.target.value) || 1)}
                  />
                </Field>
              )}

              <Field label="Max cups per share" hint="Upper bound on a peer-to-peer transfer.">
                <input
                  className="as-input as-input--short"
                  type="number" min="1" max="50"
                  value={settings.maxCupsToShare}
                  onChange={e => updateSetting('maxCupsToShare', parseInt(e.target.value) || 1)}
                />
              </Field>
            </div>
          </SectionCard>
          )}

          {/* ── Feature flags ── */}
          <SectionCard section={SECTIONS[3]}>
            {/* Operating mode — the org's programme model. Written straight
                to the published/group config (no draft cycle): the customer
                app, byo-mint and bin-tikkie all read it live. */}
            <div className={`as-orgmode${isTikkieOnly ? ' as-orgmode--tikkie' : ''}`}>
              <div className="as-flag-row__info">
                <div className="as-flag-row__label">Operating mode</div>
                <div className="as-flag-row__desc">
                  {ORG_MODE_META[effMode === 'standard' ? 'standard' : effMode].blurb}
                </div>
              </div>
              <div className="as-orgmode__options" role="radiogroup" aria-label="Operating mode">
                {['standard', 'byo', 'tikkie_only'].map(m => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={effMode === m}
                    className={`as-orgmode__opt${effMode === m ? ' as-orgmode__opt--on' : ''}`}
                    disabled={orgModeBusy || !!activeGroupId}
                    title={activeGroupId
                      ? 'The mode belongs to the group, not this org — take it out of the group first.'
                      : undefined}
                    onClick={() => setModeConfirm(m === 'standard' ? 'standard' : m)}
                  >
                    {ORG_MODE_META[m].label}
                  </button>
                ))}
              </div>
              {activeGroupId && (
                <div className="as-orgmode__note">
                  <strong>This org is in a group, so its mode is locked here.</strong> A group runs one
                  mode across every venue in it{groupMembers.length > 1 ? ` — ${groupMembers.length - 1} other venue${groupMembers.length === 2 ? '' : 's'} would be affected` : ''},
                  so it can't be changed for one org on its own. To give this org its own mode, first
                  take it out of the group in <strong>Organisations → Store groups</strong>, then come
                  back here. To change the mode for the whole group, change it on the group itself.
                </div>
              )}
              {isTikkieOnly && (
                <div className="as-orgmode__note">
                  Customers scanning a bin receipt go straight to a Tikkie link — the app,
                  rewards and accounts are all bypassed. The payout per cup is the
                  “Refund rate” in the Rates section above. The dashboard shows only the
                  Receipt Generator and the Tikkie payouts log.
                </div>
              )}
            </div>

            <div className="as-flag-list">
              {/* Sharing, donations and direct refunds all act on a cup
                  balance inside the app — none of which a tikkie-only org
                  has. The mode picker above and maintenance mode below are
                  the only switches that still mean anything. */}
              {(isTikkieOnly ? [] : FEATURE_FLAGS).map(f => (
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

              {activeGroupId && (
                <label className="as-flag-row">
                  <div className="as-flag-row__info">
                    <div className="as-flag-row__label">Hide live vendors from the market page</div>
                    <div className="as-flag-row__desc">
                      Hides the currently participating venues from the multi-venue market page, so
                      customers only see the coming-soon (future) vendors. Affects the market page
                      only — individual store pages are unchanged. Applies to the whole group.
                    </div>
                  </div>
                  <ToggleSwitch
                    checked={hideLive}
                    disabled={hideLiveBusy}
                    onChange={toggleHideLive}
                    ariaLabel="Hide live vendors from the market page toggle"
                  />
                </label>
              )}

              {!isTikkieOnly && (
              <label className="as-flag-row">
                <div className="as-flag-row__info">
                  <div className="as-flag-row__label">Require email verification <span className="as-flag-row__lock">Always on</span></div>
                  <div className="as-flag-row__desc">
                    Every email — the first time a customer adds one and any time they change it — must be
                    confirmed with the 6-digit code we email. This is always enforced and can't be turned off.
                  </div>
                </div>
                <ToggleSwitch
                  checked
                  disabled
                  onChange={() => {}}
                  ariaLabel="Require email verification (always on)"
                />
              </label>
              )}
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

          {/* ── Limits & caps ── */}
          {!isTikkieOnly && (
          <SectionCard section={SECTIONS[4]}>
            {/* Max balance a customer may hold before they must redeem. */}
            <div className="as-limit-block">
              <Field
                label="Max cups a customer can hold"
                hint="When reached, they must spend cups before earning more. 0 = no limit."
              >
                <input
                  className="as-input as-input--short"
                  type="number" min="0" max="9999"
                  value={settings.maxHoldBalance ?? 0}
                  onChange={e => updateSetting('maxHoldBalance', Math.max(0, parseInt(e.target.value) || 0), 'hold cap')}
                />
              </Field>
              <Field label="Message when the hold cap is hit" hint="Shown when they try to earn past the cap.">
                <textarea
                  className="as-input as-input--textarea"
                  rows={2}
                  value={settings.holdCapMessage || ''}
                  onChange={e => updateSetting('holdCapMessage', e.target.value, 'hold-cap message')}
                  placeholder="You've reached the maximum number of cups you can hold. Redeem a reward first, then keep collecting."
                />
              </Field>
            </div>

            {/* Max cups earned per calendar day. */}
            <div className="as-limit-block">
              <Field
                label="Max cups per day"
                hint="Upper bound on cups a customer can earn in a single day. 0 = no limit."
              >
                <input
                  className="as-input as-input--short"
                  type="number" min="0" max="9999"
                  value={settings.maxCupsPerDay ?? 0}
                  onChange={e => updateSetting('maxCupsPerDay', Math.max(0, parseInt(e.target.value) || 0), 'daily cap')}
                />
              </Field>
              <Field label="Message when the daily cap is hit">
                <textarea
                  className="as-input as-input--textarea"
                  rows={2}
                  value={settings.dailyCapMessage || ''}
                  onChange={e => updateSetting('dailyCapMessage', e.target.value, 'daily-cap message')}
                  placeholder="You've reached today's cup limit. Come back tomorrow to keep collecting."
                />
              </Field>
            </div>

            {/* Rolling balance reset. */}
            <div className="as-limit-block">
              <Field
                label="Reset balances every (days)"
                hint="Unspent cups expire on this cycle. 0 = never expire."
              >
                <input
                  className="as-input as-input--short"
                  type="number" min="0" max="3650"
                  value={settings.balanceResetDays ?? 0}
                  onChange={e => updateSetting('balanceResetDays', Math.max(0, parseInt(e.target.value) || 0), 'reset interval')}
                />
              </Field>
              <Field
                label="Warning banner (shown ~1 week before reset)"
                hint="Leave blank to skip the pre-reset warning."
              >
                <textarea
                  className="as-input as-input--textarea"
                  rows={2}
                  value={settings.resetWarningMessage || ''}
                  onChange={e => updateSetting('resetWarningMessage', e.target.value, 'reset warning')}
                  placeholder="Heads up — unspent cups reset soon. Redeem yours before they expire!"
                />
              </Field>
            </div>

            {/* ── Reward budget (moved here) ── */}
            <div className="as-limit-block as-limit-block--budget">
              <p className="as-limit-block__head">Reward budget</p>
              <p className="as-limit-block__hint">
                Cap how much cashback this organisation pays out. Customers never see the amount.
              </p>
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
            </div>

            {/* ── Limits already set in code (read-only) ── */}
            <div className="as-limit-block as-limit-block--readonly">
              <p className="as-limit-block__head">Also enforced (set elsewhere or in code)</p>
              <ul className="as-limit-readonly-list">
                <li>
                  <span>Cups awarded per scan</span>
                  <strong>{settings.maxCupsPerScan ?? 1}</strong>
                  <em>Cup rules</em>
                </li>
                <li>
                  <span>Max cups per share</span>
                  <strong>{settings.maxCupsToShare ?? 1}</strong>
                  <em>Cup rules</em>
                </li>
                <li>
                  <span>BYO auto-credit</span>
                  <strong>2 / 24 h</strong>
                  <em>byo-mint (code)</em>
                </li>
              </ul>
            </div>
          </SectionCard>
          )}
        </div>
      </div>

      {modeConfirm && (
        <TypedConfirmModal
          title="Change the operating mode?"
          intro="The mode decides what customers see and what the dashboard shows. Nothing is deleted, but the customer-facing app changes immediately."
          word="switch"
          confirmLabel={`Switch to ${ORG_MODE_META[modeConfirm].label}`}
          busy={orgModeBusy}
          onCancel={() => setModeConfirm(null)}
          onConfirm={() => changeOrgMode(modeConfirm === 'standard' ? null : modeConfirm)}
        >
          <div className="tcm-modes">
            {['standard', 'byo', 'tikkie_only'].map(m => (
              <div key={m} className={`tcm-mode${modeConfirm === m ? ' tcm-mode--on' : ''}`}>
                <div className="tcm-mode__head">
                  <span className="tcm-mode__name">{ORG_MODE_META[m].label}</span>
                  {effMode === m && <span className="tcm-mode__tag">Now</span>}
                  {modeConfirm === m && effMode !== m && <span className="tcm-mode__tag">New</span>}
                </div>
                <p className="tcm-mode__desc">{ORG_MODE_META[m].blurb}</p>
              </div>
            ))}
          </div>
          <ul className="tcm-list">
            <li>Customer copy, the reward screens and the dashboard sections all change to match the new mode.</li>
            <li><strong>Cups, balances, claims and payouts are kept</strong> — nothing is deleted or reset.</li>
            {modeConfirm === 'byo' && (
              <li className="tcm-bad">
                Bring Your Own only works inside a group, so this org will be <strong>put into a new group of its own</strong>.
                After that its mode is locked to the group until you take it out again.
              </li>
            )}
            {modeConfirm === 'tikkie_only' && (
              <li className="tcm-bad">
                The customer app stops opening entirely for this org — bin receipts go straight to Tikkie.
                Rewards, accounts and the reward list become unreachable for customers.
              </li>
            )}
            {effMode === 'tikkie_only' && modeConfirm !== 'tikkie_only' && (
              <li className="tcm-bad">
                Bin receipts stop paying out via Tikkie. Any receipt printed from now on will open the
                normal app instead, and <strong>already-printed receipts will change behaviour too</strong>.
              </li>
            )}
            {effMode === 'byo' && (
              <li className="tcm-bad">
                Counter QR codes stop minting cups the moment this org leaves BYO —
                <strong> printed counter QRs will stop working</strong>.
              </li>
            )}
          </ul>
        </TypedConfirmModal>
      )}

      {!embedded && <QuickLinks currentPage="settings" onNavigate={onNavigate} />}

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
