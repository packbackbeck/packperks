import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_DESIGN, mergeDesign } from './designDefaults';
import { extractColorsFromFile } from './extractColors';
import { saveAppConfig } from '../../lib/api';
import { uploadRewardImage } from '../lib/adminApi';
import { GUIDE_ICONS, GUIDE_ICON_KEYS } from '../../components/HowItWorks';
import { useOrg } from '../context/OrgContext';
import { logAction } from '../auth/actionLog';
import './AdminAppDesign.css';

/* ─────────────────────────────────────────────────────────────────────
 * AdminAppDesign — per-org "skin" editor for the user-facing web app.
 *
 * Layout:
 *   ┌───────────────────────── header ─────────────────────────┐
 *   │  App Design                       [Revert] [Save changes]│
 *   ├───────────────────── 2/3 controls ──────┬── 1/3 preview ─┤
 *   │                                          │                │
 *   │  ┌──── tabs ────┐                        │   live mock-up │
 *   │  Colors │ Copy │ Sections │ Smart Import │   of the user  │
 *   │                                          │   app, painted │
 *   │  …form for current tab…                  │   with the     │
 *   │                                          │   draft palette│
 *   └──────────────────────────────────────────┴────────────────┘
 *
 * Data flow:
 *   • The draft lives in `draftState.draft.settings.design` (per-org
 *     via useAdminDraft → org-keyed localStorage). Every change runs
 *     through draftState.updateDraft so it autosaves locally as the
 *     admin tinkers.
 *   • Save → publishes the whole settings/rewards bundle via
 *     publishDraft (writes app_config row `published:<orgId>` so the
 *     user app picks it up on next load).
 *   • Revert → snaps the draft back to whatever is currently published.
 *
 * Independence between orgs: useAdminDraft re-keys localStorage on org
 * switch, so KFC's palette never bleeds into BK's even before publish.
 * ───────────────────────────────────────────────────────────────────── */

const TABS = [
  { id: 'colors',   label: 'Colors' },
  { id: 'copy',     label: 'Copy' },
  { id: 'sections', label: 'Sections' },
  { id: 'guide',    label: 'Guide stories' },
  { id: 'import',   label: 'Smart import' },
];

const TAB_STORAGE_KEY = 'pp_admin_appdesign_tab';

export default function AdminAppDesign({ draftState }) {
  const { activeOrg } = useOrg();
  /* Tab persisted to localStorage so it survives any incidental
   * remounts (admin sidebar nav, org switch, HMR in dev). Without
   * this, editing a non-Colors tab would occasionally bounce the
   * user back to the Colors tab because parent state changes
   * recreated the active panel — confusing and frustrating to debug. */
  const [tab, setTab] = useState(() => {
    if (typeof window === 'undefined') return 'colors';
    try {
      const stored = localStorage.getItem(TAB_STORAGE_KEY);
      return stored && TABS.some(t => t.id === stored) ? stored : 'colors';
    } catch { return 'colors'; }
  });
  useEffect(() => {
    try { localStorage.setItem(TAB_STORAGE_KEY, tab); } catch { /* private mode etc */ }
  }, [tab]);

  const [saving, setSaving] = useState(false);
  const [saveOk, setSaveOk] = useState(false);
  const [error, setError] = useState(null);

  const settings = draftState?.draft?.settings || {};
  const design = useMemo(() => mergeDesign(settings.design), [settings.design]);

  function patchDesign(group, patch) {
    draftState.updateDraft(prev => {
      const merged = mergeDesign(prev.settings?.design);
      const next = {
        ...prev,
        settings: {
          ...prev.settings,
          design: {
            ...merged,
            [group]: { ...merged[group], ...patch },
          },
        },
      };
      return next;
    });
    setSaveOk(false);
  }

  function replaceColors(nextColors) {
    draftState.updateDraft(prev => {
      const merged = mergeDesign(prev.settings?.design);
      return {
        ...prev,
        settings: {
          ...prev.settings,
          design: { ...merged, colors: { ...merged.colors, ...nextColors } },
        },
      };
    });
    setSaveOk(false);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaveOk(false);
    try {
      // publishDraft writes the whole rewards+settings snapshot to
      // Supabase. Side-effect we want: any user-facing tab open at
      // /<slug>/ will pull this on next refresh.
      draftState.publishDraft('App Design update');
      logAction({
        action: 'design.publish',
        targetType: 'organization',
        targetId: activeOrg?.id,
        after: { design },
      });
      setSaveOk(true);
      setTimeout(() => setSaveOk(false), 2200);
    } catch (e) {
      setError(e.message || 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  function handleRevert() {
    if (!draftState?.published) {
      // No published baseline yet — reset to the canonical defaults.
      draftState.updateDraft(prev => ({
        ...prev,
        settings: { ...prev.settings, design: { ...DEFAULT_DESIGN } },
      }));
    } else {
      // Snap back to whatever the last publish was.
      draftState.updateDraft(prev => ({
        ...prev,
        settings: {
          ...prev.settings,
          design: mergeDesign(draftState.published.settings?.design),
        },
      }));
    }
    setSaveOk(false);
    setError(null);
  }

  function handleResetToDefaults() {
    draftState.updateDraft(prev => ({
      ...prev,
      settings: { ...prev.settings, design: { ...DEFAULT_DESIGN } },
    }));
    setSaveOk(false);
  }

  return (
    <div className="aad">
      <header className="aad__header">
        <div>
          <h1 className="aad__title">User app appearance</h1>
          <p className="aad__sub">
            Customise the palette, copy and visible sections of the customer-facing
            app for <strong>{activeOrg?.name || 'this organisation'}</strong>. Each
            org has its own design — switching the active org loads its own draft.
          </p>
        </div>
        <div className="aad__actions">
          {saveOk && <span className="aad__ok">Saved</span>}
          {error && <span className="aad__error">{error}</span>}
          <button className="aad__btn aad__btn--ghost" onClick={handleRevert} disabled={saving}>
            Revert
          </button>
          <button className="aad__btn aad__btn--primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </header>

      <div className="aad__layout">
        <div className="aad__controls">
          <div className="aad__tabs" role="tablist">
            {TABS.map(t => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                className={`aad__tab ${tab === t.id ? 'aad__tab--active' : ''}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="aad__pane">
            {tab === 'colors' && (
              <ColorsPanel
                colors={design.colors}
                onPatch={(p) => patchDesign('colors', p)}
                onResetToDefaults={handleResetToDefaults}
              />
            )}
            {tab === 'copy' && (
              <CopyPanel copy={design.copy} onPatch={(p) => patchDesign('copy', p)} />
            )}
            {tab === 'sections' && (
              <SectionsPanel sections={design.sections} onPatch={(p) => patchDesign('sections', p)} />
            )}
            {tab === 'guide' && (
              <GuidePanel steps={design.guide?.steps || []} onChange={(steps) => patchDesign('guide', { steps })} />
            )}
            {tab === 'import' && (
              <SmartImportPanel onApply={replaceColors} />
            )}
          </div>
        </div>

        <aside className="aad__preview">
          <div className="aad__preview-label">Live preview</div>
          <DevicePreview design={design} org={activeOrg} />
          <p className="aad__preview-help">
            Reflects the current draft. Open the customer app at <code>/{activeOrg?.slug}/</code>
            after saving to see it live.
          </p>
        </aside>
      </div>
    </div>
  );
}

/* ─── Colors panel ────────────────────────────────────────────────── */
/* ─── Colors panel ──────────────────────────────────────────────────
 * Tokens are grouped into three logical sets — Brand, Surface, Text +
 * one State swatch — instead of one flat list. Designers think in
 * "what role does this colour play", not "alphabetical list of vars".
 *
 * Each row also surfaces a tiny contrast preview ("Aa" on the swatch
 * background) and a 4.5:1 / 3:1 pass/fail chip when relevant. That
 * catches the common mistake of picking a too-light text colour or
 * a too-dark background. */
function ColorsPanel({ colors, onPatch, onResetToDefaults }) {
  const GROUPS = [
    {
      title: 'Brand',
      hint: "These three drive everything that should look distinctly yours — CTAs, the progress bar, highlight pills, the 'FREE' badge. Accent + Deep accent together paint the cup-progress gradient.",
      fields: [
        { key: 'primary',    label: 'Primary',     hint: 'Dark CTAs, headings, strokes.',                       pairTextOn: 'surface' },
        { key: 'accent',     label: 'Accent · gradient start', hint: 'Highlight chips + left end of the progress gradient.', pairTextOn: 'surface' },
        { key: 'accentDeep', label: 'Deep accent · gradient end', hint: '"FREE" pills + right end of the progress gradient.', pairTextOn: 'surface' },
      ],
    },
    {
      title: 'Surface',
      hint: 'The two layers your content sits on. Background is the page; surface is each card or sheet.',
      fields: [
        { key: 'background', label: 'Background',  hint: 'Page backdrop. Keep it light.' },
        { key: 'surface',    label: 'Surface',     hint: 'Cards & sheets. Usually white.' },
      ],
    },
    {
      title: 'Text',
      hint: 'How readable the app feels. Aim for 4.5:1 contrast on body text.',
      fields: [
        { key: 'text',       label: 'Body text',   hint: 'Main reading colour.',          pairBg: 'background' },
        { key: 'textMuted',  label: 'Muted text',  hint: 'Secondary copy & captions.',     pairBg: 'background' },
      ],
    },
    {
      title: 'State',
      hint: 'Reserved tone for positive feedback (cup added, claim approved).',
      fields: [
        { key: 'success',    label: 'Success',     hint: 'Unlocked states, success ticks.' },
      ],
    },
  ];
  return (
    <div className="aad-colors">
      <div className="aad-section-head">
        <h2>Palette</h2>
        <button className="aad__link" onClick={onResetToDefaults} type="button">Reset to defaults</button>
      </div>
      <div className="aad-colors__groups">
        {GROUPS.map(group => (
          <div key={group.title} className="aad-colors__group">
            <div className="aad-colors__group-head">
              <span className="aad-colors__group-title">{group.title}</span>
              <span className="aad-colors__group-hint">{group.hint}</span>
            </div>
            <div className="aad-colors__grid">
              {group.fields.map(f => (
                <ColorField
                  key={f.key}
                  label={f.label}
                  hint={f.hint}
                  value={colors[f.key] || '#000000'}
                  onChange={(v) => onPatch({ [f.key]: v })}
                  pairTextOn={f.pairTextOn ? colors[f.pairTextOn] : null}
                  pairBg={f.pairBg ? colors[f.pairBg] : null}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ColorField({ label, hint, value, onChange, pairTextOn, pairBg }) {
  // Contrast hint — only shown when the field has a "paired" colour
  // it'll commonly sit on (e.g. text on background, accent on surface).
  // No paired colour → no chip. Calculation is the standard WCAG
  // relative-luminance ratio.
  const otherSide = pairBg || pairTextOn;
  const contrast = otherSide ? wcagContrast(value, otherSide) : null;
  const contrastBand = contrast == null ? null
                    : contrast >= 4.5 ? 'aa'
                    : contrast >= 3   ? 'aa-large'
                    : 'fail';

  return (
    <div className="aad-color">
      <div className="aad-color__head">
        <span className="aad-color__label">{label}</span>
        {contrast != null && (
          <span
            className={`aad-color__contrast aad-color__contrast--${contrastBand}`}
            title={
              contrastBand === 'aa'       ? `Contrast ${contrast.toFixed(1)}:1 — passes WCAG AA for body text`
              : contrastBand === 'aa-large' ? `Contrast ${contrast.toFixed(1)}:1 — passes WCAG AA for large text only`
              : `Contrast ${contrast.toFixed(1)}:1 — fails WCAG AA. Pick a darker or lighter tone.`
            }
          >
            {contrast.toFixed(1)}:1
          </span>
        )}
      </div>

      {/* Preview tile — shows the swatch with a paired-color "Aa" so
          the admin sees the actual feel before they tweak. */}
      <div
        className="aad-color__preview"
        style={{
          background: pairBg || value,
          color: pairBg ? value : (pairTextOn || '#FFFFFF'),
        }}
      >
        Aa
      </div>

      <div className="aad-color__row">
        <input
          type="color"
          value={normHex(value)}
          onChange={e => onChange(e.target.value.toUpperCase())}
          className="aad-color__picker"
          aria-label={`${label} colour picker`}
        />
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value.toUpperCase())}
          className="aad-color__hex"
          spellCheck="false"
        />
      </div>
      {hint && <p className="aad-color__hint">{hint}</p>}
    </div>
  );
}

function normHex(v) {
  if (typeof v !== 'string') return '#000000';
  const m = v.trim().match(/^#?([0-9a-f]{6})$/i);
  return m ? '#' + m[1] : '#000000';
}

/* WCAG relative-luminance contrast ratio between two hex colours.
 * Returns null when either input can't be parsed (so callers can
 * hide the chip rather than show a misleading number). */
function wcagContrast(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la == null || lb == null) return null;
  const lighter = Math.max(la, lb);
  const darker  = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff;
  const chan = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}

/* ─── Copy panel ──────────────────────────────────────────────────
 * Grouped by where the copy lives in the user app: Header, Actions,
 * Activity. Char counts on each input warn when the label would
 * overflow the button it lives in — soft warning at 18 chars,
 * hard at 24 (matches the widest practical phone button width). */
function CopyPanel({ copy, onPatch }) {
  const GROUPS = [
    {
      title: 'Header',
      hint: 'Shown in the cup-balance tile at the top of every screen.',
      fields: [
        { key: 'badgeText', label: 'Cup balance label', maxSoft: 12, maxHard: 16, hint: 'Used by the cup-balance tile screen-reader label.' },
      ],
    },
    {
      title: 'Action buttons',
      hint: 'CTA labels on the customer profile screen.',
      fields: [
        { key: 'shareButtonLabel',   label: 'Share a cup',        maxSoft: 18, maxHard: 24 },
        { key: 'donateButtonLabel',  label: 'Donate',             maxSoft: 18, maxHard: 24 },
        { key: 'nextCupFreeLabel',   label: '"Next cup free"',    maxSoft: 18, maxHard: 24 },
        { key: 'refundButtonLabel',  label: 'Direct refund',      maxSoft: 22, maxHard: 28 },
      ],
    },
    {
      title: 'Sections',
      hint: 'Labels for the long-form sections on the profile screen.',
      fields: [
        { key: 'activityLabel', label: 'Activity feed heading', maxSoft: 20, maxHard: 28 },
      ],
    },
  ];

  return (
    <div className="aad-copy">
      <div className="aad-section-head">
        <h2>App copy</h2>
        <span className="aad__hint-inline">Headline, subhead, and donation copy live under <strong>Settings</strong>.</span>
      </div>
      <div className="aad-copy__groups">
        {GROUPS.map(group => (
          <div key={group.title} className="aad-copy__group">
            <div className="aad-copy__group-head">
              <span className="aad-copy__group-title">{group.title}</span>
              <span className="aad-copy__group-hint">{group.hint}</span>
            </div>
            <div className="aad-copy__list">
              {group.fields.map(f => {
                const value = copy[f.key] || '';
                const overSoft = value.length > f.maxSoft;
                const overHard = value.length > f.maxHard;
                return (
                  <label key={f.key} className="aad-copy__row">
                    <span className="aad-copy__label">
                      {f.label}
                      {f.hint && <span className="aad-copy__hint">{f.hint}</span>}
                    </span>
                    <span className="aad-copy__input-wrap">
                      <input
                        type="text"
                        value={value}
                        onChange={e => onPatch({ [f.key]: e.target.value })}
                        className={`aad-copy__input ${overHard ? 'aad-copy__input--overflow' : ''}`}
                        placeholder={DEFAULT_DESIGN.copy[f.key]}
                        maxLength={f.maxHard + 8}
                      />
                      <span
                        className={`aad-copy__count ${overHard ? 'aad-copy__count--bad' : overSoft ? 'aad-copy__count--warn' : ''}`}
                        title={overHard
                          ? 'Likely to overflow the button on mobile'
                          : overSoft ? 'Getting long — may wrap on small screens'
                          : ''}
                      >
                        {value.length}/{f.maxSoft}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Sections panel ──────────────────────────────────────────────── */
function SectionsPanel({ sections, onPatch }) {
  const rows = [
    { key: 'showPackbackLogo',   label: 'PackBack logo',         hint: 'The "PackBack" wordmark on the left of the header lockup. Hiding it also removes the × separator.' },
    { key: 'showBrandLogo',      label: 'Brand / restaurant logo', hint: 'The partner logo (BK, KFC, etc.) on the right of the header lockup.' },
    { key: 'showShareCup',       label: 'Share a cup',           hint: 'Peer-to-peer cup transfer entry point.' },
    { key: 'showDonate',         label: 'Donate cups',           hint: 'Donation CTA in the bottom actions.' },
    { key: 'showNextCupForFree', label: '"Next cup for free"',    hint: 'Quick-share variant for the bottom row.' },
    { key: 'showDirectRefund',   label: 'Direct refund',         hint: 'Quick cashout button on the home screen.' },
    { key: 'showActivity',       label: 'Activity / history',    hint: 'Recent cup + reward activity feed.' },
    { key: 'showImpact',         label: 'Impact metrics',        hint: 'Lifetime cups + plastic-avoided card in the customer profile.' },
  ];
  return (
    <div className="aad-sections">
      <div className="aad-section-head">
        <h2>Visible UI sections</h2>
        <span className="aad__hint-inline">Per-org. Feature flags (sharing, donations, refunds) still live in Quick Settings.</span>
      </div>
      <div className="aad-sections__list">
        {rows.map(r => (
          <div key={r.key} className="aad-section-row">
            <div>
              <div className="aad-section-row__label">{r.label}</div>
              {r.hint && <div className="aad-section-row__hint">{r.hint}</div>}
            </div>
            <Toggle
              value={!!sections[r.key]}
              onChange={(v) => onPatch({ [r.key]: v })}
              label={r.label}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function Toggle({ value, onChange, label }) {
  return (
    <button
      type="button"
      className={`aad-toggle ${value ? 'aad-toggle--on' : ''}`}
      onClick={() => onChange(!value)}
      aria-pressed={value}
      aria-label={`${label} ${value ? 'on' : 'off'}`}
    >
      <span className="aad-toggle__dot" />
    </button>
  );
}

/* ─── Guide stories panel ─────────────────────────────────────────────
 * Edits the How-it-works walkthrough (the full-screen "stories" guide).
 * Steps live under design.guide.steps. An empty list means "use the
 * built-in / group-mode guide"; adding steps here fully replaces it.
 * Each step carries a title, body text, an optional image, an icon and
 * an accent colour. */
function GuidePanel({ steps, onChange }) {
  const list = Array.isArray(steps) ? steps : [];

  function update(i, patch) {
    onChange(list.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }
  function add() {
    const n = list.length;
    onChange([
      ...list,
      {
        key: `step-${n + 1}-${n}`,
        title: '',
        text: '',
        image: '',
        icon: GUIDE_ICON_KEYS[n % GUIDE_ICON_KEYS.length],
        accent: '#E08A53',
        bg: '',
      },
    ]);
  }
  function remove(i) { onChange(list.filter((_, idx) => idx !== i)); }
  function move(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  }

  return (
    <div className="aad-guide">
      <div className="aad-section-head">
        <h2>Guide stories</h2>
        <span className="aad__hint-inline">
          The full-screen walkthrough customers open from “How it works”. Empty = the built-in guide.
        </span>
      </div>

      {list.length === 0 && (
        <p className="aad-guide__empty">
          No custom steps yet — the app shows its built-in guide. Add a step to fully take over the walkthrough.
        </p>
      )}

      <div className="aad-guide__list">
        {list.map((s, i) => (
          <GuideStepEditor
            key={s.key || i}
            index={i}
            total={list.length}
            step={s}
            onUpdate={(patch) => update(i, patch)}
            onRemove={() => remove(i)}
            onMove={(dir) => move(i, dir)}
          />
        ))}
      </div>

      <button type="button" className="aad__btn aad__btn--ghost aad-guide__add" onClick={add}>
        + Add step
      </button>
    </div>
  );
}

function GuideStepEditor({ index, total, step, onUpdate, onRemove, onMove }) {
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState(null);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr(null); setUploading(true);
    try {
      const url = await uploadRewardImage(file);
      if (!url) throw new Error('Upload returned no URL.');
      onUpdate({ image: url });
    } catch (ex) {
      setErr(ex.message || 'Upload failed. Paste a URL instead.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const accent = step.accent || '#E08A53';

  return (
    <div className="aad-guide__step">
      <div className="aad-guide__step-head">
        <span className="aad-guide__step-num">Step {index + 1}</span>
        <div className="aad-guide__step-tools">
          <button type="button" className="aad-guide__icon-btn" onClick={() => onMove(-1)} disabled={index === 0} aria-label="Move up">↑</button>
          <button type="button" className="aad-guide__icon-btn" onClick={() => onMove(1)} disabled={index === total - 1} aria-label="Move down">↓</button>
          <button type="button" className="aad-guide__icon-btn aad-guide__icon-btn--danger" onClick={onRemove} aria-label="Remove step">✕</button>
        </div>
      </div>

      <div className="aad-guide__step-body">
        {/* Image */}
        <div className="aad-guide__media">
          <div className="aad-guide__thumb" style={{ background: step.bg || `${accent}22` }}>
            {step.image
              ? <img src={step.image} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
              : <IconPreview iconKey={step.icon} accent={accent} />}
          </div>
          <div className="aad-guide__media-actions">
            <button type="button" className="aad__btn aad__btn--ghost aad__btn--sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? 'Uploading…' : 'Upload image'}
            </button>
            <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} style={{ display: 'none' }} />
            {step.image && (
              <button type="button" className="aad__link" onClick={() => onUpdate({ image: '' })}>Clear</button>
            )}
          </div>
        </div>

        <div className="aad-guide__fields">
          <label className="aad-guide__f">
            <span>Title</span>
            <input type="text" value={step.title || ''} onChange={(e) => onUpdate({ title: e.target.value })} placeholder="Bring your own cup" />
          </label>
          <label className="aad-guide__f">
            <span>Text</span>
            <textarea rows={2} value={step.text ?? step.body ?? ''} onChange={(e) => onUpdate({ text: e.target.value })} placeholder="Short explanation shown under the title." />
          </label>
          <label className="aad-guide__f">
            <span>Image URL</span>
            <input type="text" value={step.image || ''} onChange={(e) => onUpdate({ image: e.target.value })} placeholder="https://… or upload above" />
          </label>
          {err && <span className="aad-guide__err">{err}</span>}

          <div className="aad-guide__row">
            <label className="aad-guide__f aad-guide__f--icon">
              <span>Icon</span>
              <div className="aad-guide__icons">
                {GUIDE_ICON_KEYS.map((k) => {
                  const Ic = GUIDE_ICONS[k];
                  const on = (step.icon || GUIDE_ICON_KEYS[index % GUIDE_ICON_KEYS.length]) === k;
                  return (
                    <button
                      key={k}
                      type="button"
                      className={`aad-guide__icon-opt ${on ? 'is-on' : ''}`}
                      style={on ? { borderColor: accent, color: accent } : undefined}
                      onClick={() => onUpdate({ icon: k })}
                      aria-label={k}
                      title={k}
                    >
                      <Ic />
                    </button>
                  );
                })}
              </div>
            </label>

            <label className="aad-guide__f aad-guide__f--color">
              <span>Accent</span>
              <span className="aad-guide__color">
                <input type="color" value={normHex(accent)} onChange={(e) => onUpdate({ accent: e.target.value.toUpperCase() })} />
                <input type="text" value={accent} onChange={(e) => onUpdate({ accent: e.target.value.toUpperCase() })} spellCheck="false" />
              </span>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}

/* Small live icon preview (used as the thumbnail fallback + swatch). */
function IconPreview({ iconKey, accent }) {
  const Ic = GUIDE_ICONS[iconKey] || GUIDE_ICONS[GUIDE_ICON_KEYS[0]];
  return <span className="aad-guide__iconpreview" style={{ color: accent }}><Ic /></span>;
}

/* ─── Smart import panel ──────────────────────────────────────────── */
function SmartImportPanel({ onApply }) {
  const fileRef = useRef(null);
  const [filePreview, setFilePreview] = useState(null);
  const [palette, setPalette] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr(null);
    setBusy(true);
    setPalette(null);
    setFilePreview(URL.createObjectURL(file));
    try {
      const colors = await extractColorsFromFile(file);
      setPalette(colors);
    } catch (ex) {
      setErr(ex.message || 'Could not read the image.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function handleApply() {
    if (!palette) return;
    onApply(palette);
  }

  return (
    <div className="aad-import">
      <div className="aad-section-head">
        <h2>Smart palette from image</h2>
      </div>
      <p className="aad-import__intro">
        Upload a logo, product photo, or brand reference. PackPerks samples it,
        builds a 6-colour palette (primary, accent, background, surface, text,
        muted text), and lets you apply it to the design in one click.
      </p>

      <div className="aad-import__zone">
        {filePreview ? (
          <img src={filePreview} alt="Source preview" className="aad-import__thumb" />
        ) : (
          <div className="aad-import__placeholder">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <circle cx="9" cy="9" r="2" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
            <span>No image yet</span>
          </div>
        )}
        <div className="aad-import__zone-actions">
          <button
            type="button"
            className="aad__btn aad__btn--primary"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
          >
            {busy ? 'Reading image…' : 'Upload image'}
          </button>
          <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} style={{ display: 'none' }} />
          {palette && (
            <button type="button" className="aad__btn aad__btn--ghost" onClick={() => { setPalette(null); setFilePreview(null); }}>
              Clear
            </button>
          )}
        </div>
      </div>

      {err && <div className="aad-import__error">{err}</div>}

      {palette && (
        <>
          <div className="aad-import__palette" aria-label="Extracted palette">
            {Object.entries(palette).map(([key, hex]) => (
              <div key={key} className="aad-import__chip">
                <span className="aad-import__chip-swatch" style={{ background: hex }} />
                <div>
                  <div className="aad-import__chip-key">{labelForKey(key)}</div>
                  <code className="aad-import__chip-hex">{hex}</code>
                </div>
              </div>
            ))}
          </div>
          <button className="aad__btn aad__btn--primary aad-import__apply" onClick={handleApply}>
            Apply these colors to the design
          </button>
        </>
      )}
    </div>
  );
}

function labelForKey(k) {
  const map = {
    primary: 'Primary', accent: 'Accent', background: 'Background',
    surface: 'Surface', text: 'Text', textMuted: 'Muted', success: 'Success',
  };
  return map[k] || k;
}

/* ─── Live preview (synchronous mock — no iframe, cannot reload) ────
 *
 * Final architecture decision: we DO NOT embed the real user app in
 * an iframe for this preview. Two iframe attempts both ended in
 * reload loops — between the inner app's Supabase auth listener,
 * Vite's HMR full-reload signals in dev, and the cookie-shared admin
 * session, there were too many ways for the embedded app to cycle.
 * Even with `?preview=1` short-circuits in the inner App.jsx, dev
 * HMR alone could re-trigger churn.
 *
 * This component hand-rolls a faithful approximation of the real
 * home-screen instead. It uses the SAME CSS variables and the SAME
 * gradient definitions as the live app (see FeaturedReward.css), so
 * the Accent + Deep accent colours genuinely paint a left-to-right
 * gradient on the progress strip. The visual is close enough to
 * verify any palette / copy / section choice before publishing —
 * and it updates instantly on every keystroke with zero reload risk.
 *
 * If the admin wants pixel-perfect verification, they can open the
 * customer URL at /<slug>/ in a separate tab after saving. */
function DevicePreview({ design, org }) {
  const c = design.colors;
  const copy = design.copy;
  const sections = design.sections;
  const orgName = org?.partner_brand_name || org?.name || 'Brand';
  const initial = (orgName || 'B').charAt(0).toUpperCase();

  // CSS-variable overrides scoped to JUST the preview subtree, so
  // we never repaint the admin shell itself with the customer
  // palette. These map exactly the way the runtime applyDesignColors
  // does on the real app's :root, just locally here.
  const scopedVars = {
    '--bk-brown':   c.primary,
    '--bk-orange':  c.accent,
    '--bk-red':     c.accentDeep,
    '--bk-cream':   c.background,
    '--white':      c.surface,
    '--black':      c.text,
    '--text-muted': c.textMuted,
    '--bk-green':   c.success,
    background:     c.background,
    color:          c.text,
  };

  return (
    <div className="aad-device">
      <div className="aad-device__notch" />
      <div className="aad-device__screen" style={scopedVars}>
        {/* Header — 3-tile cluster matching real Header.jsx layout. */}
        <div className="aad-preview__header">
          <div className="aad-preview__brand">
            {sections.showPackbackLogo !== false && (
              <span className="aad-preview__pp">PackBack</span>
            )}
            {sections.showPackbackLogo !== false && sections.showBrandLogo !== false && (
              <span className="aad-preview__x">×</span>
            )}
            {sections.showBrandLogo !== false && (
              org?.logo_url ? (
                <img src={org.logo_url} alt="" className="aad-preview__logo" />
              ) : (
                <span className="aad-preview__logo-chip" style={{ background: c.accent }}>
                  {initial}
                </span>
              )
            )}
          </div>
          <div className="aad-preview__tiles">
            <span className="aad-preview__tile" style={{ background: c.primary, color: c.surface }}>2 ☕</span>
            <span className="aad-preview__tile" style={{ background: c.accent, color: c.surface }}>+</span>
            <span className="aad-preview__tile" style={{ background: c.primary, color: c.surface }}>👤</span>
          </div>
        </div>

        <h2 className="aad-preview__headline">Collect Cups &amp; Get Rewards</h2>
        <p className="aad-preview__sub" style={{ color: c.textMuted }}>
          Return your cups to earn cashback.
        </p>

        {/* Progress bar — REAL gradient using both brand accent stops.
            Mirrors the .featured-reward__gradient rule from the live
            app's CSS so designers see the actual gradient flow. */}
        <div className="aad-preview__progress" style={{ background: c.accentDeep }}>
          <div
            className="aad-preview__progress-fill"
            style={{ background: `linear-gradient(90deg, ${c.accent} 0%, ${c.accent} 60%, ${c.accentDeep} 100%)` }}
          />
        </div>

        {/* Reward card */}
        <div className="aad-preview__reward" style={{ background: c.accentDeep }}>
          <div className="aad-preview__reward-thumb" style={{ background: c.accent }} />
          <div className="aad-preview__reward-body">
            <div className="aad-preview__reward-name" style={{ color: c.surface }}>Sample reward</div>
            <div className="aad-preview__reward-row">
              <span className="aad-preview__reward-pill" style={{ background: c.primary, color: c.surface }}>FREE</span>
              <span className="aad-preview__reward-pill aad-preview__reward-pill--ghost" style={{ color: c.surface, borderColor: c.surface }}>3 cups</span>
            </div>
          </div>
        </div>

        <button
          type="button"
          className="aad-preview__cta"
          style={{ background: c.primary, color: c.surface }}
          aria-hidden="true"
          tabIndex={-1}
        >
          Get €5.00 cashback
        </button>

        <div className="aad-preview__actions">
          {sections.showShareCup && (
            <span className="aad-preview__action" style={{ background: c.surface, color: c.text }}>
              {copy.shareButtonLabel || 'Share a cup'}
            </span>
          )}
          {sections.showDonate && (
            <span className="aad-preview__action" style={{ background: c.surface, color: c.text }}>
              {copy.donateButtonLabel || 'Donate'}
            </span>
          )}
          {sections.showNextCupForFree && (
            <span className="aad-preview__action" style={{ background: c.surface, color: c.text }}>
              {copy.nextCupFreeLabel || 'Next cup free'}
            </span>
          )}
        </div>

        {sections.showActivity && (
          <div className="aad-preview__activity" style={{ color: c.textMuted }}>
            ⌄ {copy.activityLabel || 'Activity'}
          </div>
        )}
      </div>
    </div>
  );
}
