import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CalendarClock, Check, Eye, Info, Plus, RotateCcw, Star, Trash2, Upload, X } from 'lucide-react';
import { uploadRewardImage } from '../lib/adminApi';
import { Badge, Button, Field, Switch, ToggleChip } from '../ui';
import { rewardImageStyle, DEFAULT_IMAGE_FRAMING } from '../../utils/imageTransform';
import './RewardEditPanel.css';
import { useAdminMoney } from '../lib/adminMoney';

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

/* tone = the badge colour the reward list uses for the same status. */
const STATUS_META = {
  draft:     { label: 'Draft',     desc: 'Work in progress',             tone: 'warning' },
  scheduled: { label: 'Scheduled', desc: 'Starts on its scheduled date', tone: 'primary' },
  live:      { label: 'Live',      desc: 'Customers can claim it now',   tone: 'success' },
  paused:    { label: 'Paused',    desc: 'Temporarily off the menu',     tone: 'warning' },
  expired:   { label: 'Expired',   desc: 'Past its end date',            tone: 'neutral' },
  archived:  { label: 'Archived',  desc: 'Retired, kept for reporting',  tone: 'neutral' },
  // Backwards-compat alias: rows still on the old 'hidden' status
  // render as Paused until an admin edits + saves them.
  hidden:    { label: 'Paused',    desc: 'Temporarily off the menu',     tone: 'warning' },
};

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
  { id: 'content',   label: 'Content',   desc: 'Allergens' },
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

export default function RewardEditPanel({ reward, onChange, onSetFeatured, onArchive, cashbackRate = 1.25, readOnly = false }) {
  const { money, symbol } = useAdminMoney();
  /* Edit-buffer pattern: the form holds its own internal draft so a
   * keystroke doesn't push an update to the parent on every character
   * (which would re-sort the list and thrash this panel). Instead the
   * buffer is auto-committed to the parent draft on a short debounce and
   * flushed on reward switch / tab hide / unmount (see the auto-save block
   * below). `dirty` tracks whether the buffer is ahead of the last commit.
   * There is no manual Save button — everything saves automatically. */
  const [form, setForm] = useState(reward);
  const [activeTab, setActiveTab] = useState('setup');
  const [dirty, setDirty] = useState(false);
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
    const f = formRef.current;
    // Fields are edited as raw strings (so numbers type normally); coerce them
    // back to numbers before committing to the draft. Block committing an
    // incomplete reward — an empty/invalid price or cups keeps the last valid
    // draft value instead of saving a broken 0/1.
    const eurosNum = Number(f.euros);
    const cupsNum = parseInt(f.cupsNeeded, 10);
    if (!(eurosNum > 0) || !(cupsNum >= 1)) return;
    const numOrNull = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
    const committed = {
      ...f,
      euros: eurosNum,
      cupsNeeded: cupsNum,
      cogs: numOrNull(f.cogs),
      subsidy: numOrNull(f.subsidy) ?? 0,
    };
    onChangeRef.current(committed);
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

  // Required-field validity for the raw-string price/cups inputs. Empty or
  // non-positive → highlight the field + block the commit (see flush()).
  const priceInvalid = form.euros === '' || form.euros == null || !(Number(form.euros) > 0);
  const cupsInvalid = form.cupsNeeded === '' || form.cupsNeeded == null || !(parseInt(form.cupsNeeded, 10) >= 1);


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

  const framingIsDefault = (form.imageScale ?? 1) === 1 && (form.imageX ?? 0) === 0
    && (form.imageY ?? 0) === 0 && (form.imageRotate ?? 0) === 0;

  return (
    <div className="rep">
      {/* Header, save state and tabs stay in view while the form scrolls. */}
      <div className="rep__top">
        <div className="rep__header">
          <div className="rep__header-left">
            <div className="rep__thumb" style={{ background: form.bgColor || 'var(--ui-soft)' }}>
              {form.image && <img src={typeof form.image === 'string' ? form.image : ''} alt={form.name} style={rewardImageStyle(form)} />}
            </div>
            <div className="rep__header-text">
              <div className="rep__reward-name">{form.name || 'Untitled reward'}</div>
              <div className="rep__reward-meta">{money(Number(form.euros) || 0)} · {parseInt(form.cupsNeeded, 10) || 0} cups</div>
            </div>
          </div>
          <div className="rep__header-actions">
            {form.featured ? (
              <Badge tone="warning" icon={Star}>Featured</Badge>
            ) : !readOnly && (
              <Button size="sm" icon={Star} onClick={onSetFeatured} title="Set as featured reward">
                Set featured
              </Button>
            )}
            {!readOnly && (
              <Button variant="danger-ghost" size="sm" icon={Trash2} onClick={onArchive}>
                Delete
              </Button>
            )}
          </div>
        </div>

        {/* Auto-save status. Every edit is committed to the draft on its own
         *  (debounced, and flushed on tab switch / unmount), so there is no
         *  manual Save button. This just shows the live state and reminds the
         *  admin that going live still needs Publish. */}
        <div className={`rep__save-bar${dirty ? ' rep__save-bar--saving' : ''}`} role="status" aria-live="polite">
          {readOnly ? (
            <><Eye size={14} aria-hidden="true" className="rep__save-bar__ok" /> You can view this reward but not change it.</>
          ) : dirty ? (
            <><span className="rep__save-bar__dot" aria-hidden="true" /> Saving…</>
          ) : (
            <><Check size={14} aria-hidden="true" className="rep__save-bar__ok" /> All changes saved to your draft. Publish puts them live.</>
          )}
        </div>

        {/* P-44: tab strip — sits between the header and the body so
         *  the admin sees status changes before they scroll. */}
        <div className="rep__tabs">
          <div className="ui-tabs" role="tablist" aria-label="Reward sections">
            {REWARD_TABS.map(t => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={activeTab === t.id}
                className="ui-tabs__btn"
                onClick={() => setActiveTab(t.id)}
                title={t.desc}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* View-only roles: the form is a disabled fieldset; the tabs above
       *  stay usable so every section can be read. */}
      <fieldset className="rep__body" disabled={readOnly}>
       {activeTab === 'setup' && (
        <>
        {/* Status */}
        <section className="rep__section">
          <h3 className="rep__section-title">Status</h3>
          <div className="rep__status-row">
            {STATUS_OPTIONS.map(s => {
              const meta = STATUS_META[s];
              const on = form.status === s;
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={on}
                  className={`rep__status-btn rep__status-btn--${meta.tone}${on ? ' rep__status-btn--on' : ''}`}
                  onClick={() => update('status', s)}
                >
                  <span className="rep__status-label">
                    <span className="rep__status-dot" aria-hidden="true" />
                    {meta.label}
                  </span>
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
              <span className="rep__schedule-title">
                <CalendarClock size={15} aria-hidden="true" />
                Release window
                <span className="rep__optional">optional</span>
              </span>
              <span className="rep__schedule-sub">
                When set, the reward switches to <strong>Live</strong> on the release date and
                to <strong>Expired</strong> once the expiry date has passed.
              </span>
            </div>
            <div className="rep__grid">
              <Field label="Release on" htmlFor="rep-release">
                <input
                  id="rep-release"
                  type="datetime-local"
                  className="ui-input"
                  value={toLocalDatetimeValue(form.releaseAt)}
                  onChange={e => update('releaseAt', fromLocalDatetimeValue(e.target.value))}
                />
              </Field>
              <Field label="Expires on" htmlFor="rep-expires">
                <input
                  id="rep-expires"
                  type="datetime-local"
                  className="ui-input"
                  value={toLocalDatetimeValue(form.expiresAt)}
                  onChange={e => update('expiresAt', fromLocalDatetimeValue(e.target.value))}
                />
              </Field>
            </div>
            {form.releaseAt && new Date(form.releaseAt) > new Date() && form.status !== 'scheduled' && (
              <p className="rep__callout rep__callout--info">
                <Info size={14} aria-hidden="true" />
                <span>
                  Set the status to <strong>Scheduled</strong> so customers don’t see this reward before {new Date(form.releaseAt).toLocaleString('en-GB')}.
                </span>
              </p>
            )}
            {form.expiresAt && new Date(form.expiresAt) < new Date() && form.status !== 'expired' && form.status !== 'archived' && (
              <p className="rep__callout rep__callout--warn">
                <AlertTriangle size={14} aria-hidden="true" />
                <span>
                  This reward’s expiry date has passed. It will switch to <strong>Expired</strong> on its own.
                </span>
              </p>
            )}
          </div>
        </section>

        {/* Basic info */}
        <section className="rep__section">
          <h3 className="rep__section-title">Basic info</h3>
          <div className="rep__stack">
            <Field label="Name" htmlFor="rep-name">
              <input id="rep-name" className="ui-input" value={form.name || ''} onChange={e => update('name', e.target.value)} placeholder="e.g. Chicken Sandwich" />
            </Field>
            <Field label="Description" htmlFor="rep-desc">
              <textarea id="rep-desc" className="ui-textarea" rows={3} value={form.description || ''} onChange={e => update('description', e.target.value)} placeholder="Short product description shown in the app…" />
            </Field>
            <div className="rep__grid">
              <Field label={`Price (${symbol})`} htmlFor="rep-price">
                {/* Store the raw string so a number can be typed/cleared normally
                 *  (the old `parseFloat(..) || 0` forced 0 and ate decimals).
                 *  Required: an empty or non-positive price highlights + blocks. */}
                <input
                  id="rep-price"
                  className={`ui-input${priceInvalid ? ' rep__input--error' : ''}`}
                  type="number" step="0.01" min="0" inputMode="decimal"
                  aria-invalid={priceInvalid || undefined}
                  value={form.euros ?? ''}
                  onChange={e => update('euros', e.target.value)}
                  placeholder="5.49"
                />
                {priceInvalid && <span className="rep__field-error">Enter a price above {money(0)}.</span>}
              </Field>
              <Field label="Cups needed" htmlFor="rep-cups">
                <input
                  id="rep-cups"
                  className={`ui-input${cupsInvalid ? ' rep__input--error' : ''}`}
                  type="number" min="1" max="20" inputMode="numeric"
                  aria-invalid={cupsInvalid || undefined}
                  value={form.cupsNeeded ?? ''}
                  onChange={e => update('cupsNeeded', e.target.value)}
                  placeholder="3"
                />
                {cupsInvalid && <span className="rep__field-error">Enter how many cups this costs.</span>}
              </Field>
            </div>
            <div className="rep__grid">
              <Field
                label={<>Cost to make ({symbol}) <span className="rep__optional">optional</span></>}
                htmlFor="rep-cogs"
              >
                {/* COGS — the real cost to produce the product. Admin-only: it
                 *  feeds Reward economics and is NEVER shown in the customer app. */}
                <input
                  id="rep-cogs"
                  className="ui-input"
                  type="number" step="0.01" min="0" inputMode="decimal"
                  value={form.cogs ?? ''}
                  onChange={e => update('cogs', e.target.value)}
                  placeholder="1.20"
                  title="Your actual cost to produce this reward (cost of goods). Admin only — never shown to customers. Used by Reward economics."
                />
              </Field>
              <Field label={`Partner subsidy (${symbol})`} htmlFor="rep-subsidy">
                <input
                  id="rep-subsidy"
                  className="ui-input"
                  type="number" step="0.01" min="0" inputMode="decimal"
                  value={form.subsidy ?? ''}
                  onChange={e => update('subsidy', e.target.value)}
                  placeholder="0.00"
                  title="Optional cash the partner adds on top of what cups fund. Use to close the funding gap on premium rewards."
                />
              </Field>
            </div>

            {/* How many of this product the customer must buy for the cashback
             *  receipt to validate. Optional — defaults to 1. Read by the
             *  verify-receipt function, which sums the matching line-item
             *  quantities and only passes when the total meets this number. */}
            <Field
              label="Items required on receipt"
              htmlFor="rep-qty"
              hint="How many of this product the receipt must show to unlock the reward. Leave at 1 for a single item; set 2 for a “buy two” offer, and so on."
            >
              <input
                id="rep-qty"
                className="ui-input rep__input--short"
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
            </Field>
          </div>

          {/* Economics panel — surfaces the funding-gap math the
           *  external review flagged. Without this, an admin could
           *  publish a €5.49 reward at 3 cups (€3.75 cashback) and not
           *  realise the customer is being short-changed by €1.74. */}
          <RewardEconomicsPanel form={form} cashbackRate={cashbackRate} />
        </section>

        {/* Visuals */}
        <section className="rep__section">
          <h3 className="rep__section-title">Visuals</h3>
          <div className="rep__stack">
            <Field label="Background colour" htmlFor="rep-bg">
              <div className="rep__color-row">
                <input
                  type="color"
                  className="rep__color-picker"
                  aria-label="Pick a background colour"
                  value={form.bgColor || '#FEA01E'}
                  onChange={e => update('bgColor', e.target.value)}
                />
                <input
                  id="rep-bg"
                  className="ui-input rep__input--mono"
                  value={form.bgColor || '#FEA01E'}
                  onChange={e => update('bgColor', e.target.value)}
                  placeholder="#FEA01E"
                />
              </div>
            </Field>
            <Field label="Image" htmlFor="rep-image">
              <div className="rep__image-row">
                <input
                  id="rep-image"
                  className="ui-input rep__input--mono"
                  value={typeof form.image === 'string' ? form.image : ''}
                  onChange={e => update('image', e.target.value)}
                  placeholder="https://… or upload"
                />
                <Button
                  icon={Upload}
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingImage}
                  title="Upload an image from this device"
                >
                  {uploadingImage ? 'Uploading…' : 'Upload from device'}
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageFile}
                  style={{ display: 'none' }}
                />
              </div>
              {imageError && <span className="rep__field-error">{imageError}</span>}
            </Field>
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
                      <label className="rep__slider-label" htmlFor="img-x">Move sideways</label>
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
                      <label className="rep__slider-label" htmlFor="img-y">Move up or down</label>
                      <span className="rep__slider-val">{form.imageY ?? 0}%</span>
                    </div>
                    <input
                      id="img-y"
                      type="range" min="-100" max="100" step="1"
                      value={form.imageY ?? 0}
                      onChange={e => update('imageY', parseInt(e.target.value, 10))}
                    />
                  </div>
                  <div className="rep__slider">
                    <div className="rep__slider-head">
                      <label className="rep__slider-label" htmlFor="img-rotate">Rotate</label>
                      <span className="rep__slider-val">{form.imageRotate ?? 0}°</span>
                    </div>
                    <input
                      id="img-rotate"
                      type="range" min="-180" max="180" step="1"
                      value={form.imageRotate ?? 0}
                      onChange={e => update('imageRotate', parseInt(e.target.value, 10))}
                    />
                  </div>
                  <div>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={RotateCcw}
                      onClick={() => { setForm(prev => ({ ...prev, ...DEFAULT_IMAGE_FRAMING })); setDirty(true); }}
                      disabled={framingIsDefault}
                    >
                      Reset framing
                    </Button>
                  </div>
                </div>
                <div className="rep__image-preview-wrap">
                  <div className="rep__image-preview" style={{ background: form.bgColor || '#F8F4EC' }}>
                    <img src={form.image} alt="preview" style={rewardImageStyle(form)} onError={e => e.target.style.display = 'none'} />
                  </div>
                  <span className="rep__image-caption">As customers see it</span>
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
          <h3 className="rep__section-title">Tags</h3>
          <p className="rep__hint">
            Tags show as pills over the description on the reward card. Add your own or pick a preset.
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
                    <X size={11} aria-hidden="true" />
                  </button>
                </span>
              ))
            )}
          </div>

          {/* Add a custom tag. */}
          <div className="rep__tag-add">
            <input
              type="text"
              className="ui-input rep__tag-add-input"
              aria-label="New tag"
              value={newTag}
              maxLength={24}
              placeholder="Add a tag (e.g. SPICY)"
              onChange={e => setNewTag(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); addTag(newTag); }
              }}
            />
            <Button icon={Plus} onClick={() => addTag(newTag)} disabled={!newTag.trim()}>
              Add
            </Button>
          </div>

          {/* Preset quick-adds. */}
          <div className="rep__tags-presets-label">Presets</div>
          <div className="rep__tags-row">
            {AVAILABLE_TAGS.map(tag => (
              <ToggleChip
                key={tag}
                pressed={(form.tags || []).includes(tag)}
                onClick={() => toggleTag(tag)}
              >
                {tag}
              </ToggleChip>
            ))}
          </div>
        </section>

        {/* Partial Discount */}
        <section className="rep__section rep__section--last">
          <div className="rep__section-title-row">
            <div>
              <h3 className="rep__section-title">Partial discount</h3>
              <p className="rep__hint rep__hint--flush">Adds an “X% OFF” tag to this reward. Off by default.</p>
            </div>
            <Switch
              checked={!!form.discountEnabled}
              onChange={() => toggleDiscount()}
              label="Partial discount"
            />
          </div>
          {form.discountEnabled && (
            <div className="rep__discount-row">
              <span className="ui-input-affix rep__discount-input">
                <input
                  type="number"
                  min="1"
                  max="99"
                  className="ui-input"
                  aria-label="Discount percentage"
                  value={form.discountPercent || 10}
                  onChange={e => updateDiscountPct(Math.min(99, Math.max(1, parseInt(e.target.value) || 10)))}
                />
                <span className="ui-input-affix__suffix">%</span>
              </span>
              <span className="rep__discount-label">
                Customers see the tag <span className="rep__tag-chip rep__tag-chip--static">{form.discountPercent || 10}% OFF</span>
              </span>
            </div>
          )}
        </section>

        </>
       )}

       {activeTab === 'content' && (
        <>
        {/* Allergy info */}
        <section className="rep__section rep__section--last">
          <h3 className="rep__section-title">Allergen info</h3>
          <Field htmlFor="rep-allergy" hint="Shown to customers on the reward’s detail sheet.">
            <textarea
              id="rep-allergy"
              className="ui-textarea"
              rows={3}
              value={form.allergyInfo || ''}
              onChange={e => update('allergyInfo', e.target.value)}
              placeholder="Contains: Gluten (wheat), Eggs…"
            />
          </Field>
        </section>
        </>
       )}
      </fieldset>
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
  const { money } = useAdminMoney();
  const price = Number(form.euros) || 0;
  const cups = Number(form.cupsNeeded) || 0;
  const subsidy = Number(form.subsidy) || 0;
  // COGS — your real cost to produce the reward. Admin-only, never shown to
  // customers. Drives the gross-margin readout below.
  const cogs = Number(form.cogs) || 0;
  const hasCogs = cogs > 0;
  const margin = +(price - cogs).toFixed(2);
  const marginPct = price > 0 ? Math.round((margin / price) * 100) : 0;
  const cupsFunded = +(cups * cashbackRate).toFixed(2);
  const totalFunded = +(cupsFunded + subsidy).toFixed(2);
  const gap = +(price - totalFunded).toFixed(2);
  // Tolerate tiny floating-point dust — anything within 0.05 of fully
  // funded counts as fully funded (avoids "0.01 underfunded" noise).
  const tone = price === 0 ? 'unset' : Math.abs(gap) <= 0.05 ? 'ok' : gap > 0 ? 'under' : 'over';

  return (
    <div className={`rep-econ rep-econ--${tone}`}>
      <div className="rep-econ__head">
        <span className="rep-econ__title">Reward economics</span>
        {tone === 'unset' && <Badge tone="neutral">Add a price to see the gap</Badge>}
        {tone === 'ok'    && <Badge tone="success" icon={Check}>Fully funded</Badge>}
        {tone === 'under' && <Badge tone="warning" icon={AlertTriangle}>Underfunded by {money(gap)}</Badge>}
        {tone === 'over'  && <Badge tone="primary">Over-funded by {money(Math.abs(gap))}</Badge>}
      </div>

      <div className="rep-econ__grid">
        <div className="rep-econ__cell">
          <span className="rep-econ__cell-label">Product price</span>
          <span className="rep-econ__cell-val">{money(price)}</span>
        </div>
        <div className="rep-econ__cell">
          <span className="rep-econ__cell-label">Cups funding</span>
          <span className="rep-econ__cell-val">{money(cupsFunded)}</span>
          <span className="rep-econ__cell-sub">{cups} × {money(cashbackRate)}</span>
        </div>
        <div className="rep-econ__cell">
          <span className="rep-econ__cell-label">Partner subsidy</span>
          <span className="rep-econ__cell-val">{money(subsidy)}</span>
        </div>
        {hasCogs && (
          <div className="rep-econ__cell">
            <span className="rep-econ__cell-label">Cost to make</span>
            <span className="rep-econ__cell-val">{money(cogs)}</span>
            <span className="rep-econ__cell-sub">Admin only</span>
          </div>
        )}
        <div className={`rep-econ__cell rep-econ__cell--gap rep-econ__cell--gap-${tone}`}>
          <span className="rep-econ__cell-label">
            {tone === 'under' ? 'Funding gap' : tone === 'over' ? 'Over-funded' : 'Gap'}
          </span>
          <span className="rep-econ__cell-val">
            {tone === 'unset' ? '—' : money(Math.abs(gap))}
          </span>
          {tone === 'under' && (
            <span className="rep-econ__cell-sub">Customer absorbs this</span>
          )}
        </div>
      </div>

      {tone === 'under' && (
        <p className="rep-econ__hint">
          This reward pays {money(totalFunded)} cashback against a {money(price)} product.
          Either raise cups needed, add a partner subsidy, or accept that the
          customer covers {money(gap)} themselves on top of the cashback.
        </p>
      )}

      {hasCogs && (
        <p className={`rep-econ__margin rep-econ__margin--${margin >= 0 ? 'pos' : 'neg'}`}>
          <span className="rep-econ__margin-label">Gross margin</span>
          <span className="rep-econ__margin-val">
            {money(margin)}{price > 0 ? ` · ${marginPct}%` : ''}
          </span>
          <span className="rep-econ__margin-note">
            {money(price)} price − {money(cogs)} to make. This cost is never shown to customers.
          </span>
        </p>
      )}
    </div>
  );
}
