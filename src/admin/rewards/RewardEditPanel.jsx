import { useCallback, useEffect, useRef, useState } from 'react';
import { uploadRewardImage } from '../lib/adminApi';
import { rewardImageStyle, DEFAULT_IMAGE_FRAMING } from '../../utils/imageTransform';
import './RewardEditPanel.css';

const AVAILABLE_TAGS = ['FREE', 'PLANT-BASED', 'NEW', 'LIMITED', 'POPULAR'];
/* P-43: full reward lifecycle enum. Previously only three states
 * (live / hidden / draft) which collapsed several distinct moments
 * into the same chip. The new set:
 *
 *   draft     — work-in-progress, never shown to customers.
 *   scheduled — set up but starts later (e.g. promo for next month).
 *   live      — currently visible + claimable in the user app.
 *   paused    — temporarily off the menu (out of stock at the supplier).
 *               Existing customers with cups spent on it still see
 *               their pending claims process normally.
 *   expired   — past its end date; treated like archived but kept
 *               separate so admins can spot "did it really hit the
 *               campaign end I set" at a glance.
 *   archived  — manually retired, kept for historical reporting.
 *
 * Backwards compat: existing rewards with status='hidden' get treated
 * as 'paused' by the helpers so the visual rendering stays sane until
 * an admin edits them. */
const STATUS_OPTIONS = ['draft', 'scheduled', 'live', 'paused', 'expired', 'archived'];

/* P-44: tabs inside the editor. The previous single-column form was
 * a 700-pixel scroll of status → basic info → visuals → tags →
 * discount → nutrition → allergens. Splitting into tabs lets the
 * admin focus on one job at a time and shortens the scan path:
 *
 *   Setup       — status, basic info, economics, visuals, tags
 *   Promotion   — featured / discount toggles + claim rules
 *   Content     — customer-facing nutrition + allergen details
 *
 * State for the active tab lives at the editor level so navigating
 * away and back to the same reward keeps you on the last tab. */
const REWARD_TABS = [
  { id: 'setup',     label: 'Setup',     desc: 'Status, price, visuals' },
  { id: 'promotion', label: 'Promotion', desc: 'Featured, discount, tags' },
  { id: 'content',   label: 'Content',   desc: 'Nutrition + allergens' },
];

/* <input type="datetime-local"> wants `YYYY-MM-DDTHH:mm` in the user's
 * local timezone. We store ISO strings (with tz info) under
 * reward.releaseAt / reward.expiresAt so the auto-transition code can
 * compare them to `new Date()` reliably. These two helpers bridge
 * between the two shapes. */
function toLocalDatetimeValue(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60_000);
  return local.toISOString().slice(0, 16);
}
function fromLocalDatetimeValue(local) {
  if (!local) return null;
  // The input gives us a naive local datetime; the Date ctor parses
  // it as local, so the resulting ISO carries the right UTC moment.
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export default function RewardEditPanel({ reward, onChange, onSetFeatured, onArchive, cashbackRate = 1.25 }) {
  /* Edit-buffer pattern: the form holds its own internal draft and
   * does NOT propagate every keystroke up to the parent. That fixes
   * two bugs the previous live-save version had:
   *
   *   1. Every keystroke triggered an `updateDraft` in the parent,
   *      which re-sorted the rewards list, which re-rendered the
   *      whole edit panel — losing the user's scroll position + tab
   *      state, and on some flows snapping them back to the first
   *      reward in the list.
   *   2. There was no way to bail out of an edit. Once you typed, it
   *      was saved.
   *
   * The form now stays internal. `dirty` tracks whether anything has
   * been changed since the last commit, and Save / Reset commit or
   * discard the in-flight changes. The parent's `onChange` is called
   * exactly once per Save click. */
  const [form, setForm] = useState(reward);
  const [activeTab, setActiveTab] = useState('setup');
  const [dirty, setDirty] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [newTag, setNewTag] = useState('');

  /* ── Auto-save ───────────────────────────────────────────────────────
   * The form is still an internal buffer (so typing doesn't thrash the
   * parent list on every keystroke), but we now auto-commit it up to the
   * draft so edits are never lost. The commit is debounced while the admin
   * is actively typing, and flushed immediately whenever the buffer is about
   * to disappear: switching to another reward, the panel unmounting, or the
   * browser tab being hidden. Refs keep the flush closure from going stale. */
  const formRef = useRef(form);
  const dirtyRef = useRef(dirty);
  const onChangeRef = useRef(onChange);
  // Sync the refs after each commit (not during render) so the stable flush
  // closure always sees the latest values. flush only ever runs post-commit
  // (timeouts, listeners, effect cleanup), so the one-render lag is harmless.
  useEffect(() => {
    formRef.current = form;
    dirtyRef.current = dirty;
    onChangeRef.current = onChange;
  });

  const flush = useCallback(() => {
    if (!dirtyRef.current) return;
    onChangeRef.current(formRef.current);
    dirtyRef.current = false;
    setDirty(false);
  }, []);

  useEffect(() => {
    setForm(reward);
    setActiveTab('setup');
    setDirty(false);
    setNewTag('');
    // Leaving this reward (selection change or unmount): commit its pending
    // edits first so nothing is dropped.
    return () => { flush(); };
  }, [reward.id, flush]);

  // Debounced auto-commit while staying on the same reward.
  useEffect(() => {
    if (!dirty) return undefined;
    const t = setTimeout(flush, 600);
    return () => clearTimeout(t);
  }, [form, dirty, flush]);

  // Commit the moment the tab is hidden / the page is being unloaded, so a
  // tab switch or accidental close can't strand unsaved edits.
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
    };
  }, [flush]);

  function update(field, value) {
    setForm(prev => ({ ...prev, [field]: value }));
    setDirty(true);
  }

  function updateNutrition(index, key, value) {
    setForm(prev => ({
      ...prev,
      nutrition: (prev.nutrition || []).map((row, i) =>
        i === index ? { ...row, [key]: value } : row
      ),
    }));
    setDirty(true);
  }

  function addNutritionRow() {
    setForm(prev => ({
      ...prev,
      nutrition: [...(prev.nutrition || []), { label: '', value: '' }],
    }));
    setDirty(true);
  }

  function removeNutritionRow(index) {
    setForm(prev => ({
      ...prev,
      nutrition: (prev.nutrition || []).filter((_, i) => i !== index),
    }));
    setDirty(true);
  }

  function toggleTag(tag) {
    setForm(prev => {
      const tags = prev.tags || [];
      return { ...prev, tags: tags.includes(tag) ? tags.filter(t => t !== tag) : [...tags, tag] };
    });
    setDirty(true);
  }

  /* Free-form custom tags. These render over the description on the
   * featured-reward card in the user app (featured-reward__tag). The
   * preset buttons above are convenience shortcuts; this lets an admin
   * type any label. Tags are normalised (trimmed, uppercased) and
   * de-duplicated case-insensitively so "Vegan" and "vegan" don't both
   * show up. */
  function addTag(raw) {
    // Strip pipes — tags are stored pipe-delimited in the CSV import/export.
    const value = (raw || '').replace(/\|/g, ' ').trim().toUpperCase();
    if (!value) return;
    setForm(prev => {
      const tags = prev.tags || [];
      if (tags.some(t => t.toUpperCase() === value)) return prev;
      return { ...prev, tags: [...tags, value] };
    });
    setDirty(true);
    setNewTag('');
  }

  function removeTag(tag) {
    setForm(prev => ({ ...prev, tags: (prev.tags || []).filter(t => t !== tag) }));
    setDirty(true);
  }

  function toggleDiscount() {
    setForm(prev => {
      const enabled = !prev.discountEnabled;
      const pct = prev.discountPercent || 10;
      const cleanTags = (prev.tags || []).filter(t => !/^\d+%\s*OFF$/i.test(t));
      const newTags = enabled ? [...cleanTags, `${pct}% OFF`] : cleanTags;
      return { ...prev, discountEnabled: enabled, discountPercent: pct, tags: newTags };
    });
    setDirty(true);
  }

  function updateDiscountPct(pct) {
    setForm(prev => {
      const cleanTags = (prev.tags || []).filter(t => !/^\d+%\s*OFF$/i.test(t));
      const newTags = prev.discountEnabled ? [...cleanTags, `${pct}% OFF`] : cleanTags;
      return { ...prev, discountPercent: pct, tags: newTags };
    });
    setDirty(true);
  }

  function handleSave() {
    onChange(form);
    setDirty(false);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1600);
  }

  function handleReset() {
    setForm(reward);
    setDirty(false);
  }

  /* Image upload from the user's device. Uploads to the public
   * reward-images bucket and writes the resulting public URL into
   * the form's `image` field. Loading state lives inline rather than
   * propagating up — the parent doesn't care about the upload
   * lifecycle, only the final URL once Save is pressed. */
  const fileInputRef = useRef(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [imageError, setImageError] = useState(null);
  async function handleImageFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageError(null);
    setUploadingImage(true);
    try {
      const url = await uploadRewardImage(file);
      if (!url) throw new Error('Upload returned no URL.');
      setForm(prev => ({ ...prev, image: url }));
      setDirty(true);
    } catch (err) {
      setImageError(err.message || 'Upload failed. Try a smaller image or paste a URL instead.');
    } finally {
      setUploadingImage(false);
      // Allow re-selecting the same file.
      if (e.target) e.target.value = '';
    }
  }

  const STATUS_META = {
    draft:     { label: 'Draft',     desc: 'Work in progress',           color: '#B8922A' },
    scheduled: { label: 'Scheduled', desc: 'Starts on its scheduled date', color: '#5333A5' },
    live:      { label: 'Live',      desc: 'Customers can claim it now',   color: '#16A34A' },
    paused:    { label: 'Paused',    desc: 'Temporarily off the menu',     color: '#FD6F46' },
    expired:   { label: 'Expired',   desc: 'Past its end date',            color: '#7A7166' },
    archived:  { label: 'Archived',  desc: 'Retired, kept for reporting',  color: '#6B7280' },
    // Backwards-compat alias: rows still on the old 'hidden' status
    // render as Paused until an admin edits + saves them.
    hidden:    { label: 'Paused',    desc: 'Temporarily off the menu',     color: '#FD6F46' },
  };

  return (
    <div className="rep">
      {/* Header */}
      <div className="rep__header">
        <div className="rep__header-left">
          <div className="rep__thumb" style={{ background: form.bgColor || '#F8F4EC' }}>
            {form.image && <img src={typeof form.image === 'string' ? form.image : ''} alt={form.name} style={rewardImageStyle(form)} />}
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

      {/* Save bar — explicit commit replaces the previous live-save
       *  behaviour. Sits between the header and the tab strip so
       *  pending changes get a constant reminder. When clean it
       *  collapses to a calm "Saved" or "Up to date" line. */}
      <div className={`rep__save-bar${dirty ? ' rep__save-bar--dirty' : ''}`}>
        {dirty ? (
          <>
            <span className="rep__save-bar__msg">
              <span className="rep__save-bar__dot" />
              You have unsaved changes
            </span>
            <div className="rep__save-bar__actions">
              <button
                type="button"
                className="rep__btn rep__btn--ghost rep__save-bar__discard"
                onClick={handleReset}
              >
                Discard
              </button>
              <button
                type="button"
                className="rep__btn rep__btn--primary"
                onClick={handleSave}
              >
                Save changes
              </button>
            </div>
          </>
        ) : (
          <span className="rep__save-bar__msg rep__save-bar__msg--clean">
            {savedFlash ? '✓ Saved — remember to hit Publish to push live.' : 'No unsaved changes.'}
          </span>
        )}
      </div>

      {/* P-44: tab strip — sits between the header and the body so
       *  the admin sees status changes before they scroll. */}
      <div className="rep__tabs" role="tablist">
        {REWARD_TABS.map(t => (
          <button
            key={t.id}
            role="tab"
            aria-selected={activeTab === t.id}
            className={`rep__tab${activeTab === t.id ? ' rep__tab--active' : ''}`}
            onClick={() => setActiveTab(t.id)}
            title={t.desc}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="rep__body">
       {activeTab === 'setup' && (
        <>
        {/* Status */}
        <section className="rep__section">
          <div className="rep__section-title">Status</div>
          <div className="rep__status-row">
            {STATUS_OPTIONS.map(s => {
              const meta = STATUS_META[s];
              return (
                <button
                  key={s}
                  type="button"
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

          {/* Release + expiry windows.
           *
           * Always shown so admins can pre-pick dates on a draft and
           * then flip to "scheduled" without rediscovering this section.
           * Auto-transition logic in AdminRewards reads these on mount
           * and flips status: draft/scheduled → live once releaseAt
           * has passed, and live → expired once expiresAt has. */}
          <div className="rep__schedule">
            <div className="rep__schedule-head">
              <span className="rep__schedule-title">Release window</span>
              <span className="rep__schedule-sub">
                Optional — when set, the reward auto-flips to <strong>live</strong> at the release
                date and to <strong>expired</strong> after the expiry date passes.
              </span>
            </div>
            <div className="rep__schedule-row">
              <div className="rep__field rep__field--inline">
                <label className="rep__label">Release on</label>
                <input
                  type="datetime-local"
                  className="rep__input"
                  value={toLocalDatetimeValue(form.releaseAt)}
                  onChange={e => update('releaseAt', fromLocalDatetimeValue(e.target.value))}
                />
              </div>
              <div className="rep__field rep__field--inline">
                <label className="rep__label">Expires on</label>
                <input
                  type="datetime-local"
                  className="rep__input"
                  value={toLocalDatetimeValue(form.expiresAt)}
                  onChange={e => update('expiresAt', fromLocalDatetimeValue(e.target.value))}
                />
              </div>
            </div>
            {form.releaseAt && new Date(form.releaseAt) > new Date() && form.status !== 'scheduled' && (
              <p className="rep__schedule-hint">
                Tip: switch status to <strong>Scheduled</strong> so customers don't see this reward before {new Date(form.releaseAt).toLocaleString('en-GB')}.
              </p>
            )}
            {form.expiresAt && new Date(form.expiresAt) < new Date() && form.status !== 'expired' && form.status !== 'archived' && (
              <p className="rep__schedule-hint rep__schedule-hint--warn">
                This reward's expiry date has passed. Save changes to auto-flip it to <strong>Expired</strong>.
              </p>
            )}
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
            <div className="rep__field">
              <label className="rep__label">Partner subsidy (€)</label>
              <input
                className="rep__input"
                type="number"
                step="0.01"
                min="0"
                value={form.subsidy ?? ''}
                onChange={e => update('subsidy', parseFloat(e.target.value) || 0)}
                placeholder="0.00"
                title="Optional cash the partner (e.g. Burger King) adds on top of what cups fund. Use to close the funding gap on premium rewards."
              />
            </div>
          </div>

          {/* How many of this product the customer must buy for the cashback
           *  receipt to validate. Optional — defaults to 1. Read by the
           *  verify-receipt function, which sums the matching line-item
           *  quantities and only passes when the total meets this number. */}
          <div className="rep__field">
            <label className="rep__label">Items required on receipt</label>
            <input
              className="rep__input"
              type="number"
              min="1"
              max="50"
              step="1"
              value={form.requiredQty ?? ''}
              onChange={e => {
                const n = parseInt(e.target.value, 10);
                update('requiredQty', Number.isFinite(n) && n > 0 ? n : 1);
              }}
              placeholder="1"
              title="How many of this product the receipt must show to unlock the reward."
            />
            <p className="rep__field-hint">
              How many of this product the receipt must show to unlock the reward.
              Leave at 1 for a single item. Set to 2 for a “buy two” offer, and so on.
            </p>
          </div>

          {/* Economics panel — surfaces the funding-gap math the
           *  external review flagged. Without this, an admin could
           *  publish a €5.49 reward at 3 cups (€3.75 cashback) and not
           *  realise the customer is being short-changed by €1.74. */}
          <RewardEconomicsPanel form={form} cashbackRate={cashbackRate} />
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
            <label className="rep__label">Image</label>
            <div className="rep__image-row">
              <input
                className="rep__input rep__input--mono"
                value={typeof form.image === 'string' ? form.image : ''}
                onChange={e => update('image', e.target.value)}
                placeholder="https://… or upload"
              />
              <button
                type="button"
                className="rep__btn rep__btn--ghost rep__image-upload"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingImage}
                title="Upload an image from this device"
              >
                {uploadingImage ? 'Uploading…' : 'Upload from device'}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageFile}
                style={{ display: 'none' }}
              />
            </div>
            {imageError && <span className="rep__image-err">{imageError}</span>}
            {form.image && typeof form.image === 'string' && form.image.length > 0 && (
              <div className="rep__image-adjust">
                {/* Sliders on the left control how the picture sits inside its
                    box; the square preview on the right is exactly what the
                    customer app shows. Values persist on the reward. */}
                <div className="rep__image-controls">
                  <div className="rep__slider">
                    <div className="rep__slider-head">
                      <label className="rep__slider-label" htmlFor="img-size">Size</label>
                      <span className="rep__slider-val">{Math.round((form.imageScale ?? 1) * 100)}%</span>
                    </div>
                    <input
                      id="img-size"
                      type="range" min="0.5" max="3" step="0.05"
                      value={form.imageScale ?? 1}
                      onChange={e => update('imageScale', parseFloat(e.target.value))}
                    />
                  </div>
                  <div className="rep__slider">
                    <div className="rep__slider-head">
                      <label className="rep__slider-label" htmlFor="img-x">Move X</label>
                      <span className="rep__slider-val">{form.imageX ?? 0}%</span>
                    </div>
                    <input
                      id="img-x"
                      type="range" min="-100" max="100" step="1"
                      value={form.imageX ?? 0}
                      onChange={e => update('imageX', parseInt(e.target.value, 10))}
                    />
                  </div>
                  <div className="rep__slider">
                    <div className="rep__slider-head">
                      <label className="rep__slider-label" htmlFor="img-y">Move Y</label>
                      <span className="rep__slider-val">{form.imageY ?? 0}%</span>
                    </div>
                    <input
                      id="img-y"
                      type="range" min="-100" max="100" step="1"
                      value={form.imageY ?? 0}
                      onChange={e => update('imageY', parseInt(e.target.value, 10))}
                    />
                  </div>
                  <button
                    type="button"
                    className="rep__image-reset"
                    onClick={() => { setForm(prev => ({ ...prev, ...DEFAULT_IMAGE_FRAMING })); setDirty(true); }}
                    disabled={(form.imageScale ?? 1) === 1 && (form.imageX ?? 0) === 0 && (form.imageY ?? 0) === 0}
                  >
                    Reset framing
                  </button>
                </div>
                <div className="rep__image-preview" style={{ background: form.bgColor || '#F8F4EC' }}>
                  <img src={form.image} alt="preview" style={rewardImageStyle(form)} onError={e => e.target.style.display = 'none'} />
                </div>
              </div>
            )}
          </div>
        </section>

        </>
       )}

       {activeTab === 'promotion' && (
        <>
        {/* Tags */}
        <section className="rep__section">
          <div className="rep__section-title">Tags</div>
          <p className="rep__field-hint">
            These show as pills over the description on the reward card. Add your own or tap a preset.
          </p>

          {/* Current tags — each removable. */}
          <div className="rep__tags-current">
            {(form.tags || []).length === 0 ? (
              <span className="rep__tags-empty">No tags yet.</span>
            ) : (
              (form.tags || []).map(tag => (
                <span key={tag} className="rep__tag-chip">
                  {tag}
                  <button
                    type="button"
                    className="rep__tag-chip-remove"
                    onClick={() => removeTag(tag)}
                    aria-label={`Remove tag ${tag}`}
                    title={`Remove "${tag}"`}
                  >
                    ×
                  </button>
                </span>
              ))
            )}
          </div>

          {/* Add a custom tag. */}
          <div className="rep__tag-add">
            <input
              type="text"
              className="rep__input rep__tag-add-input"
              value={newTag}
              maxLength={24}
              placeholder="Add a tag (e.g. SPICY)"
              onChange={e => setNewTag(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); addTag(newTag); }
              }}
            />
            <button
              type="button"
              className="rep__tag-add-btn"
              onClick={() => addTag(newTag)}
              disabled={!newTag.trim()}
            >
              Add
            </button>
          </div>

          {/* Preset quick-adds. */}
          <div className="rep__tags-presets-label">Presets</div>
          <div className="rep__tags-row">
            {AVAILABLE_TAGS.map(tag => (
              <button
                key={tag}
                type="button"
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

        </>
       )}

       {activeTab === 'content' && (
        <>
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
        </>
       )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 * RewardEconomicsPanel — funding-gap calculator.
 *
 * Renders four cells:
 *   • Product price    — what the customer would normally pay
 *   • Cups funding     — cups_needed × cashback_rate
 *   • Partner subsidy  — cash partner adds (set on the reward)
 *   • Gap              — price − cups_funding − subsidy
 *
 * A green "fully funded" badge means the reward is paid for entirely
 * by cups + subsidy. A red "underfunded" badge means the customer
 * isn't getting full product value out of the reward — they'd need to
 * top up or accept less cashback.
 *
 * The panel intentionally lives inline in the edit form rather than as
 * a separate tab — economics is the most-important thing to surface
 * while someone is actually setting up the reward. */
function RewardEconomicsPanel({ form, cashbackRate }) {
  const price = Number(form.euros) || 0;
  const cups = Number(form.cupsNeeded) || 0;
  const subsidy = Number(form.subsidy) || 0;
  const cupsFunded = +(cups * cashbackRate).toFixed(2);
  const totalFunded = +(cupsFunded + subsidy).toFixed(2);
  const gap = +(price - totalFunded).toFixed(2);
  // Tolerate tiny floating-point dust — anything within €0.05 of fully
  // funded counts as fully funded (avoids "0.01 underfunded" noise).
  const tone = price === 0 ? 'unset' : Math.abs(gap) <= 0.05 ? 'ok' : gap > 0 ? 'under' : 'over';

  return (
    <div className={`rep-econ rep-econ--${tone}`}>
      <div className="rep-econ__head">
        <span className="rep-econ__title">Reward economics</span>
        <span className={`rep-econ__badge rep-econ__badge--${tone}`}>
          {tone === 'unset' && 'Add a price to see the gap'}
          {tone === 'ok'    && '✓ Fully funded'}
          {tone === 'under' && `⚠ Underfunded by €${gap.toFixed(2)}`}
          {tone === 'over'  && `Over-funded by €${Math.abs(gap).toFixed(2)}`}
        </span>
      </div>

      <div className="rep-econ__grid">
        <div className="rep-econ__cell">
          <span className="rep-econ__cell-label">Product price</span>
          <span className="rep-econ__cell-val">€{price.toFixed(2)}</span>
        </div>
        <div className="rep-econ__cell">
          <span className="rep-econ__cell-label">Cups funding</span>
          <span className="rep-econ__cell-val">€{cupsFunded.toFixed(2)}</span>
          <span className="rep-econ__cell-sub">{cups} × €{cashbackRate.toFixed(2)}</span>
        </div>
        <div className="rep-econ__cell">
          <span className="rep-econ__cell-label">Partner subsidy</span>
          <span className="rep-econ__cell-val">€{subsidy.toFixed(2)}</span>
        </div>
        <div className={`rep-econ__cell rep-econ__cell--gap rep-econ__cell--gap-${tone}`}>
          <span className="rep-econ__cell-label">
            {tone === 'under' ? 'Funding gap' : tone === 'over' ? 'Over-funded' : 'Gap'}
          </span>
          <span className="rep-econ__cell-val">
            {tone === 'unset' ? '—' : `€${Math.abs(gap).toFixed(2)}`}
          </span>
          {tone === 'under' && (
            <span className="rep-econ__cell-sub">Customer absorbs this</span>
          )}
        </div>
      </div>

      {tone === 'under' && (
        <p className="rep-econ__hint">
          This reward pays €{totalFunded.toFixed(2)} cashback against a €{price.toFixed(2)} product.
          Either raise cups needed, add a partner subsidy, or accept that the
          customer covers €{gap.toFixed(2)} themselves on top of the cashback.
        </p>
      )}
    </div>
  );
}
