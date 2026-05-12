import { useState, useEffect } from 'react';
import './RewardEditPanel.css';

const AVAILABLE_TAGS = ['FREE', 'PLANT-BASED', 'NEW', 'LIMITED', 'POPULAR'];
const STATUS_OPTIONS = ['live', 'hidden', 'draft'];

export default function RewardEditPanel({ reward, onChange, onSetFeatured, onArchive }) {
  const [form, setForm] = useState(reward);

  useEffect(() => {
    setForm(reward);
  }, [reward.id]);

  function update(field, value) {
    const updated = { ...form, [field]: value };
    setForm(updated);
    onChange(updated);
  }

  function updateNutrition(index, key, value) {
    const nutrition = form.nutrition.map((row, i) =>
      i === index ? { ...row, [key]: value } : row
    );
    update('nutrition', nutrition);
  }

  function addNutritionRow() {
    update('nutrition', [...(form.nutrition || []), { label: '', value: '' }]);
  }

  function removeNutritionRow(index) {
    update('nutrition', form.nutrition.filter((_, i) => i !== index));
  }

  function toggleTag(tag) {
    const tags = form.tags || [];
    update('tags', tags.includes(tag) ? tags.filter(t => t !== tag) : [...tags, tag]);
  }

  function toggleDiscount() {
    const enabled = !form.discountEnabled;
    const pct = form.discountPercent || 10;
    const cleanTags = (form.tags || []).filter(t => !/^\d+%\s*OFF$/i.test(t));
    const newTags = enabled ? [...cleanTags, `${pct}% OFF`] : cleanTags;
    const updated = { ...form, discountEnabled: enabled, discountPercent: pct, tags: newTags };
    setForm(updated);
    onChange(updated);
  }

  function updateDiscountPct(pct) {
    const cleanTags = (form.tags || []).filter(t => !/^\d+%\s*OFF$/i.test(t));
    const newTags = form.discountEnabled ? [...cleanTags, `${pct}% OFF`] : cleanTags;
    const updated = { ...form, discountPercent: pct, tags: newTags };
    setForm(updated);
    onChange(updated);
  }

  const STATUS_META = {
    live:   { label: 'Live',   desc: 'Visible to all users', color: '#16A34A' },
    hidden: { label: 'Hidden', desc: 'Not shown in app',     color: '#6B7280' },
    draft:  { label: 'Draft',  desc: 'Preview only',         color: '#B8922A' },
  };

  return (
    <div className="rep">
      {/* Header */}
      <div className="rep__header">
        <div className="rep__header-left">
          <div className="rep__thumb" style={{ background: form.bgColor || '#F5F4F0' }}>
            {form.image && <img src={typeof form.image === 'string' ? form.image : ''} alt={form.name} />}
          </div>
          <div>
            <div className="rep__reward-name">{form.name || 'Untitled Reward'}</div>
            <div className="rep__reward-meta">€{(form.euros || 0).toFixed(2)} · {form.cupsNeeded || 0} cups</div>
          </div>
        </div>
        <div className="rep__header-actions">
          {!form.featured && (
            <button className="rep__btn rep__btn--ghost" onClick={onSetFeatured} title="Set as featured reward">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
              </svg>
              Set featured
            </button>
          )}
          {form.featured && (
            <span className="rep__featured-badge">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
              </svg>
              Featured
            </span>
          )}
          <button className="rep__btn rep__btn--danger" onClick={onArchive}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
              <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
            </svg>
            Archive
          </button>
        </div>
      </div>

      <div className="rep__body">
        {/* Status */}
        <section className="rep__section">
          <div className="rep__section-title">Status</div>
          <div className="rep__status-row">
            {STATUS_OPTIONS.map(s => {
              const meta = STATUS_META[s];
              return (
                <button
                  key={s}
                  className={`rep__status-btn ${form.status === s ? 'rep__status-btn--active' : ''}`}
                  style={form.status === s ? { borderColor: meta.color, color: meta.color, background: `${meta.color}12` } : {}}
                  onClick={() => update('status', s)}
                >
                  <span className="rep__status-label">{meta.label}</span>
                  <span className="rep__status-desc">{meta.desc}</span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Basic info */}
        <section className="rep__section">
          <div className="rep__section-title">Basic Info</div>
          <div className="rep__field">
            <label className="rep__label">Name</label>
            <input className="rep__input" value={form.name || ''} onChange={e => update('name', e.target.value)} placeholder="e.g. Chicken Sandwich" />
          </div>
          <div className="rep__field">
            <label className="rep__label">Description</label>
            <textarea className="rep__textarea" rows={3} value={form.description || ''} onChange={e => update('description', e.target.value)} placeholder="Short product description shown in the app…" />
          </div>
          <div className="rep__row">
            <div className="rep__field">
              <label className="rep__label">Price (€)</label>
              <input className="rep__input" type="number" step="0.01" min="0" value={form.euros || ''} onChange={e => update('euros', parseFloat(e.target.value) || 0)} placeholder="5.49" />
            </div>
            <div className="rep__field">
              <label className="rep__label">Cups needed</label>
              <input className="rep__input" type="number" min="1" max="20" value={form.cupsNeeded || ''} onChange={e => update('cupsNeeded', parseInt(e.target.value) || 1)} placeholder="3" />
            </div>
          </div>
        </section>

        {/* Visuals */}
        <section className="rep__section">
          <div className="rep__section-title">Visuals</div>
          <div className="rep__field">
            <label className="rep__label">Background color</label>
            <div className="rep__color-row">
              <input
                type="color"
                className="rep__color-picker"
                value={form.bgColor || '#FEA01E'}
                onChange={e => update('bgColor', e.target.value)}
              />
              <input
                className="rep__input rep__input--mono"
                value={form.bgColor || '#FEA01E'}
                onChange={e => update('bgColor', e.target.value)}
                placeholder="#FEA01E"
              />
              <div className="rep__color-preview" style={{ background: form.bgColor || '#FEA01E' }} />
            </div>
          </div>
          <div className="rep__field">
            <label className="rep__label">Image URL</label>
            <input className="rep__input rep__input--mono" value={typeof form.image === 'string' ? form.image : ''} onChange={e => update('image', e.target.value)} placeholder="https://…" />
            {form.image && typeof form.image === 'string' && form.image.startsWith('http') && (
              <div className="rep__image-preview">
                <img src={form.image} alt="preview" onError={e => e.target.style.display = 'none'} />
              </div>
            )}
          </div>
        </section>

        {/* Tags */}
        <section className="rep__section">
          <div className="rep__section-title">Tags</div>
          <div className="rep__tags-row">
            {AVAILABLE_TAGS.map(tag => (
              <button
                key={tag}
                className={`rep__tag ${(form.tags || []).includes(tag) ? 'rep__tag--active' : ''}`}
                onClick={() => toggleTag(tag)}
              >
                {tag}
              </button>
            ))}
          </div>
        </section>

        {/* Partial Discount */}
        <section className="rep__section">
          <div className="rep__section-title-row">
            <div className="rep__section-title">Partial Discount</div>
            <button
              className={`rep__feature-toggle${form.discountEnabled ? ' rep__feature-toggle--on' : ''}`}
              onClick={toggleDiscount}
            >
              {form.discountEnabled ? 'On' : 'Off'}
            </button>
          </div>
          <p className="rep__field-hint">Adds a "X% OFF" tag to this reward. Off by default.</p>
          {form.discountEnabled && (
            <div className="rep__discount-row">
              <input
                type="number"
                min="1"
                max="99"
                className="rep__input rep__input--sm"
                style={{ width: 72 }}
                value={form.discountPercent || 10}
                onChange={e => updateDiscountPct(Math.min(99, Math.max(1, parseInt(e.target.value) || 10)))}
              />
              <span className="rep__discount-label">% off — tag: <strong>{form.discountPercent || 10}% OFF</strong></span>
            </div>
          )}
        </section>

        {/* Nutrition */}
        <section className="rep__section">
          <div className="rep__section-title-row">
            <div className="rep__section-title">Nutrition</div>
            <button className="rep__add-row" onClick={addNutritionRow}>+ Add row</button>
          </div>
          <div className="rep__nutrition-table">
            <div className="rep__nutrition-thead">
              <span>Nutrient</span>
              <span>Value</span>
              <span />
            </div>
            {(form.nutrition || []).map((row, i) => (
              <div key={i} className="rep__nutrition-row">
                <input
                  className="rep__input rep__input--sm"
                  value={row.label}
                  onChange={e => updateNutrition(i, 'label', e.target.value)}
                  placeholder="Energy"
                />
                <input
                  className="rep__input rep__input--sm"
                  value={row.value}
                  onChange={e => updateNutrition(i, 'value', e.target.value)}
                  placeholder="498 kcal"
                />
                <button className="rep__rm-row" onClick={() => removeNutritionRow(i)}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* Allergy info */}
        <section className="rep__section rep__section--last">
          <div className="rep__section-title">Allergen Info</div>
          <div className="rep__field">
            <textarea
              className="rep__textarea"
              rows={2}
              value={form.allergyInfo || ''}
              onChange={e => update('allergyInfo', e.target.value)}
              placeholder="Contains: Gluten (wheat), Eggs…"
            />
          </div>
        </section>
      </div>
    </div>
  );
}
