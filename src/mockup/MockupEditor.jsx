import { useRef } from 'react';
import { DEFAULT_PALETTE } from './mockupTemplate';

/* ─────────────────────────────────────────────────────────────────────
 * MockupEditor — every control that shapes the mockup config. Emits
 * changes via onChange(prev => next). Grouped: Brand, Hero, Progress,
 * Rewards (max 3 + 1 selected), Palette, Sections.
 * ───────────────────────────────────────────────────────────────────── */

const PALETTE_FIELDS = [
  ['background', 'Background'], ['primary', 'Primary'], ['accent', 'Accent'],
  ['accentDeep', 'Accent deep'], ['surface', 'Surface'], ['text', 'Text'],
  ['textMuted', 'Muted text'], ['success', 'Success'],
];

function readFileAsDataUrl(file, cb) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => cb(e.target.result);
  reader.readAsDataURL(file);
}

/* Colour swatch + hex text, kept in sync. The swatch is a real colour preview
 * (the native picker sits transparent on top of it). */
function ColorField({ label, value, onChange }) {
  const hex = /^#[0-9a-fA-F]{6}$/.test(value || '') ? value : '#000000';
  return (
    <label className="mk-field mk-field--color">
      <span className="mk-field__label">{label}</span>
      <span className="mk-color">
        <span className="mk-color__swatch" style={{ background: hex }}>
          <input type="color" value={hex} onChange={e => onChange(e.target.value)} aria-label={`${label} colour`} />
        </span>
        <input type="text" className="mk-color__hex" value={value || ''} onChange={e => onChange(e.target.value)} placeholder="#000000" />
      </span>
    </label>
  );
}

function ImageField({ label, value, onChange }) {
  const fileRef = useRef(null);
  return (
    <div className="mk-field">
      <span className="mk-field__label">{label}</span>
      <div className="mk-image">
        <input
          type="text"
          className="mk-input"
          value={/^data:/.test(value || '') ? '' : (value || '')}
          onChange={e => onChange(e.target.value)}
          placeholder={/^data:/.test(value || '') ? 'Uploaded image' : 'Paste image URL…'}
        />
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => readFileAsDataUrl(e.target.files?.[0], onChange)} />
        <button type="button" className="mk-btn mk-btn--ghost mk-btn--sm" onClick={() => fileRef.current?.click()}>Upload</button>
        {value && <button type="button" className="mk-btn mk-btn--ghost mk-btn--sm" onClick={() => onChange('')} title="Clear">×</button>}
      </div>
    </div>
  );
}

export default function MockupEditor({ config, onChange }) {
  const set = (patch) => onChange(prev => ({ ...prev, ...patch }));
  const setPalette = (key, v) => onChange(prev => ({ ...prev, palette: { ...prev.palette, [key]: v } }));
  const setSection = (key, v) => onChange(prev => ({ ...prev, sections: { ...prev.sections, [key]: v } }));
  const setReward = (i, patch) => onChange(prev => ({
    ...prev,
    rewards: prev.rewards.map((r, idx) => (idx === i ? { ...r, ...patch } : r)),
  }));

  return (
    <div className="mk-editor">
      {/* ── Brand ── */}
      <section className="mk-group">
        <h3 className="mk-group__title">Brand</h3>
        <label className="mk-field">
          <span className="mk-field__label">Store name</span>
          <input className="mk-input" value={config.orgName} onChange={e => set({ orgName: e.target.value })} placeholder="e.g. Sunrise Coffee" />
        </label>
        <label className="mk-field">
          <span className="mk-field__label">Brand label <em>(optional, “PackBack × ___”)</em></span>
          <input className="mk-input" value={config.partnerBrandName} onChange={e => set({ partnerBrandName: e.target.value })} placeholder="Defaults to store name" />
        </label>
        <ImageField label="Logo" value={config.logoUrl} onChange={v => set({ logoUrl: v })} />
        <div className="mk-row">
          <label className="mk-field">
            <span className="mk-field__label">Logo width (px)</span>
            <input className="mk-input" type="number" min="40" max="240" value={config.logoWidth} onChange={e => set({ logoWidth: e.target.value })} placeholder="auto" />
          </label>
          <ColorField label="Brand colour" value={config.brandColor} onChange={v => set({ brandColor: v })} />
        </div>
      </section>

      {/* ── Hero ── */}
      <section className="mk-group">
        <h3 className="mk-group__title">Hero</h3>
        <label className="mk-field">
          <span className="mk-field__label">Headline</span>
          <input className="mk-input" value={config.heroHeadline} onChange={e => set({ heroHeadline: e.target.value })} />
        </label>
        <label className="mk-field">
          <span className="mk-field__label">Subtext</span>
          <textarea className="mk-input mk-textarea" rows={2} value={config.heroSubtext} onChange={e => set({ heroSubtext: e.target.value })} />
        </label>
      </section>

      {/* ── Progress ── */}
      <section className="mk-group">
        <h3 className="mk-group__title">Cups collected</h3>
        <div className="mk-slider">
          <input
            type="range" min="0" max={Math.max(1, config.rewards[config.selectedIndex]?.cupsNeeded || 6)} step="1"
            value={Math.min(config.cupsCollected, config.rewards[config.selectedIndex]?.cupsNeeded || 6)}
            onChange={e => set({ cupsCollected: Number(e.target.value) })}
          />
          <input
            type="number" className="mk-input mk-slider__num" min="0" max="99"
            value={config.cupsCollected}
            onChange={e => set({ cupsCollected: Math.max(0, Number(e.target.value) || 0) })}
            aria-label="Cups collected"
          />
        </div>
        <p className="mk-hint">Drag the slider, or type a custom amount (even beyond the goal, to show a fully unlocked reward).</p>
      </section>

      {/* ── Rewards ── */}
      <section className="mk-group">
        <h3 className="mk-group__title">Rewards <span className="mk-count">max 3 · pick 1 featured</span></h3>
        {config.rewards.map((r, i) => (
          <div key={i} className={`mk-reward${config.selectedIndex === i ? ' is-selected' : ''}`}>
            <div className="mk-reward__head">
              <label className="mk-radio">
                <input type="radio" name="mk-selected" checked={config.selectedIndex === i} onChange={() => set({ selectedIndex: i })} />
                <span>Featured</span>
              </label>
              <span className="mk-reward__n">Reward {i + 1}</span>
            </div>
            <label className="mk-field">
              <span className="mk-field__label">Name</span>
              <input className="mk-input" value={r.name} onChange={e => setReward(i, { name: e.target.value })} placeholder="e.g. Flat White" />
            </label>
            <ImageField label="Image" value={r.image} onChange={v => setReward(i, { image: v })} />
            <div className="mk-row">
              <label className="mk-field mk-field--sm">
                <span className="mk-field__label">Cups needed</span>
                <input className="mk-input" type="number" min="1" max="12" value={r.cupsNeeded} onChange={e => setReward(i, { cupsNeeded: Number(e.target.value) })} />
              </label>
              <label className="mk-field mk-field--sm">
                <span className="mk-field__label">Value € <em>(auto)</em></span>
                <input className="mk-input" type="number" min="0" step="0.5" value={r.euros} onChange={e => setReward(i, { euros: e.target.value })} placeholder="auto" />
              </label>
              <ColorField label="Tile colour" value={r.bgColor} onChange={v => setReward(i, { bgColor: v })} />
            </div>
            <label className="mk-field">
              <span className="mk-field__label">Tag <em>(optional)</em></span>
              <input className="mk-input" value={r.tags} onChange={e => setReward(i, { tags: e.target.value })} placeholder="e.g. BARISTA" />
            </label>
          </div>
        ))}
      </section>

      {/* ── Palette ── */}
      <details className="mk-group mk-details">
        <summary className="mk-group__title">Colour palette</summary>
        <div className="mk-palette">
          {PALETTE_FIELDS.map(([key, label]) => (
            <ColorField key={key} label={label} value={config.palette[key]} onChange={v => setPalette(key, v)} />
          ))}
        </div>
        <button type="button" className="mk-btn mk-btn--ghost mk-btn--sm" onClick={() => onChange(prev => ({ ...prev, palette: { ...DEFAULT_PALETTE } }))}>
          Reset palette
        </button>
      </details>

      {/* ── Sections ── */}
      <details className="mk-group mk-details">
        <summary className="mk-group__title">Header sections</summary>
        <label className="mk-toggle">
          <input type="checkbox" checked={config.sections.showPackbackLogo !== false} onChange={e => setSection('showPackbackLogo', e.target.checked)} />
          <span>Show PackBack logo</span>
        </label>
        <label className="mk-toggle">
          <input type="checkbox" checked={config.sections.showBrandLogo !== false} onChange={e => setSection('showBrandLogo', e.target.checked)} />
          <span>Show brand logo</span>
        </label>
      </details>
    </div>
  );
}
