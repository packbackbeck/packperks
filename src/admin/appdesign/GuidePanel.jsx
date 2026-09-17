import { useRef, useState } from 'react';
import {
  BookOpen, ChevronDown, ChevronUp, CopyPlus, ImageUp, Plus, RotateCcw, Trash2, TriangleAlert,
} from 'lucide-react';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Modal } from '../ui';
import { uploadRewardImage } from '../lib/adminApi';
import { GUIDE_ICONS, GUIDE_ICON_KEYS } from '../../components/HowItWorks';
import { GUIDE_ICON_NAMES, GUIDE_TIPS_AFTER, resolveGuideStep } from './designModel';
import { Callout, ColourInput, CountedField } from './DesignFields';

/* Guide: the How-it-works story. No steps here means the app's built-in
 * guide; any step added here replaces it completely. Steps are stored under
 * settings.design.guide.steps as { key, title, text, image, icon, accent, bg }. */
export default function GuidePanel({ steps, builtIn, builtInFrom, isVoucher, activeIndex, readOnly, onChange, onActivate }) {
  const list = Array.isArray(steps) ? steps : [];
  const [confirm, setConfirm] = useState(null); // { kind: 'remove', index } | { kind: 'clear' }

  function update(i, patch) {
    onChange(list.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }
  function add() {
    const n = list.length;
    const base = resolveGuideStep({}, n);
    onChange([...list, {
      key: `step-${Date.now().toString(36)}`,
      title: '',
      text: '',
      image: '',
      icon: GUIDE_ICON_KEYS.includes(base.icon) ? base.icon : GUIDE_ICON_KEYS[n % GUIDE_ICON_KEYS.length],
      accent: base.accent,
      bg: '',
    }]);
    onActivate(n);
  }
  // Pictures and colours are copied too, so each step keeps its look when
  // the steps are reordered (empty ones follow the position instead).
  function copyBuiltIn() {
    onChange(builtIn.map((s, i) => ({
      key: `step-${i + 1}-${s.key || i}`,
      title: s.title || '',
      text: s.text || '',
      image: s.image || '',
      icon: s.icon || resolveGuideStep({}, i).icon,
      accent: s.accent || '',
      bg: s.bg || '',
    })));
    onActivate(0);
  }
  function move(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
    onActivate(j);
  }
  function remove(i) {
    onChange(list.filter((_, idx) => idx !== i));
    onActivate(Math.max(0, Math.min(i, list.length - 2)));
  }
  function askRemove(i) {
    const s = list[i];
    if (s.title || s.text || s.body || s.image) setConfirm({ kind: 'remove', index: i });
    else remove(i);
  }

  const lastIndex = list.length - 1;

  return (
    <div className="dz-stack">
      <Card>
        <CardHeader
          icon={BookOpen}
          title="How it works guide"
          subtitle="The full-screen story customers see when they tap a reward they haven’t unlocked yet."
          ruled
          actions={list.length
            ? <Badge tone="primary">{list.length} step{list.length !== 1 ? 's' : ''} of your own</Badge>
            : <Badge tone="neutral">Built-in guide</Badge>}
        />
        <CardBody>
          {isVoucher && list.length > 0 && (
            <Callout tone="warning" icon={TriangleAlert} title="Your last step is swapped at the counter">
              This venue hands out rewards at the counter, so the app replaces your last step with “Redeem it at the
              counter”. It keeps that step’s picture and colours.
            </Callout>
          )}

          {list.length === 0 ? (
            <EmptyState
              boxed
              icon={BookOpen}
              title="Customers see the built-in guide"
              action={!readOnly && (
                <div className="dz-empty-actions">
                  <Button variant="primary" icon={Plus} onClick={add}>Write your own step</Button>
                  <Button icon={CopyPlus} onClick={copyBuiltIn}>Start from the built-in steps</Button>
                </div>
              )}
            >
              {builtIn.length} steps{builtInFrom ? ` from the ${builtInFrom} group` : ''}: {builtIn.map(s => s.title).join(' · ')}.
              Steps you add here replace it completely.
            </EmptyState>
          ) : (
            <>
              <ol className="dz-steps">
                {list.map((s, i) => (
                  <GuideStep
                    key={s.key || i}
                    step={s}
                    index={i}
                    total={list.length}
                    active={i === activeIndex}
                    swapped={isVoucher && i === lastIndex}
                    readOnly={readOnly}
                    onUpdate={(patch) => update(i, patch)}
                    onMove={(dir) => move(i, dir)}
                    onRemove={() => askRemove(i)}
                    onActivate={() => onActivate(i)}
                  />
                ))}
              </ol>
              {!readOnly && (
                <div className="dz-steps__after">
                  <button type="button" className="dz-add-step" onClick={add}>
                    <Plus size={16} aria-hidden="true" /> Add a step
                  </button>
                  {list.length > GUIDE_TIPS_AFTER && (
                    <p className="dz-hint">Long guides lose people. Three to five steps work best.</p>
                  )}
                  <Button variant="ghost" size="sm" icon={RotateCcw} onClick={() => setConfirm({ kind: 'clear' })}>
                    Go back to the built-in guide
                  </Button>
                </div>
              )}
            </>
          )}
        </CardBody>
      </Card>

      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        icon={Trash2}
        iconTone="rose"
        title={confirm?.kind === 'clear' ? 'Remove all your steps?' : `Remove step ${(confirm?.index ?? 0) + 1}?`}
        footer={(
          <>
            <Button onClick={() => setConfirm(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                if (confirm?.kind === 'clear') { onChange([]); onActivate(0); }
                else if (confirm) remove(confirm.index);
                setConfirm(null);
              }}
            >
              {confirm?.kind === 'clear' ? 'Remove all steps' : 'Remove step'}
            </Button>
          </>
        )}
      >
        <p className="dz-modal-text">
          {confirm?.kind === 'clear'
            ? 'Your steps are removed from the draft. Once you publish, customers see the built-in guide again.'
            : 'Its title, text and picture are removed from the draft. Customers keep seeing it until you publish.'}
        </p>
      </Modal>
    </div>
  );
}

function GuideStep({ step, index, total, active, swapped, readOnly, onUpdate, onMove, onRemove, onActivate }) {
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState(null);
  const shown = resolveGuideStep(step, index);
  const base = resolveGuideStep({}, index);
  const Icon = GUIDE_ICONS[shown.icon] || GUIDE_ICONS.cup;
  // The app reads `body` before `text` (older steps carry `body`).
  const text = step.body ?? step.text ?? '';

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr(null);
    setUploading(true);
    try {
      const url = await uploadRewardImage(file);
      if (!url) throw new Error('The upload returned no link.');
      onUpdate({ image: url });
    } catch (ex) {
      setErr(`${ex.message || 'The upload failed.'} You can paste an image link instead.`);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <li className={`dz-step${active ? ' is-active' : ''}`}>
      <div className="dz-step__head">
        <span className="dz-step__num" style={{ background: shown.accent }}>{index + 1}</span>
        {/* Not a <button>: the read-only fieldset would disable it, and
            viewers still need to open steps. */}
        <div
          role="button"
          tabIndex={0}
          className="dz-step__toggle"
          aria-expanded={active}
          onClick={onActivate}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate(); } }}
        >
          <span className={`dz-step__heading${step.title ? '' : ' is-empty'}`}>{step.title || 'Untitled step'}</span>
          {!active && <span className="dz-step__snippet">{text || 'No text yet'}</span>}
        </div>
        {swapped && <Badge tone="warning">Replaced at the counter</Badge>}
        {!readOnly && (
          <div className="dz-step__tools">
            <Button variant="ghost" size="sm" icon={ChevronUp} aria-label={`Move step ${index + 1} up`} disabled={index === 0} onClick={() => onMove(-1)} />
            <Button variant="ghost" size="sm" icon={ChevronDown} aria-label={`Move step ${index + 1} down`} disabled={index === total - 1} onClick={() => onMove(1)} />
            <Button variant="danger-ghost" size="sm" icon={Trash2} aria-label={`Remove step ${index + 1}`} onClick={onRemove} />
          </div>
        )}
      </div>

      {active && (
      <div className="dz-step__body" onFocus={onActivate}>
        <div className="dz-step__media">
          <div className="dz-step__art" style={{ background: shown.bg }}>
            <div className="dz-step__art-card">
              <span className="dz-step__art-icon"><Icon /></span>
              {shown.image && (
                <img
                  key={shown.image}
                  src={shown.image}
                  alt=""
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
              )}
            </div>
          </div>
          <p className="dz-step__media-note">
            {!step.image
              ? `The built-in picture for step ${(index % 5) + 1}`
              : step.image.startsWith('/how-it-works/') ? 'A built-in picture' : 'Your picture'}
          </p>
          {!readOnly && (
            <div className="dz-step__media-actions">
              <Button size="sm" icon={ImageUp} disabled={uploading} onClick={() => fileRef.current?.click()}>
                {uploading ? 'Uploading…' : step.image ? 'Replace' : 'Upload'}
              </Button>
              {step.image && <Button size="sm" variant="ghost" onClick={() => onUpdate({ image: '' })}>Remove</Button>}
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={handleFile} />
            </div>
          )}
        </div>

        <div className="dz-step__fields">
          <CountedField
            label="Title"
            value={step.title || ''}
            soft={32}
            hard={48}
            placeholder="e.g. Collect your cups"
            emptyNote="Left empty, this step has no title."
            onChange={(v) => onUpdate({ title: v })}
          />
          <CountedField
            label="Text"
            value={text}
            soft={140}
            hard={220}
            multiline
            rows={3}
            placeholder="One or two sentences under the title."
            onChange={(v) => onUpdate({ text: v, body: undefined })}
          />
          <div className="ui-field">
            <label className="ui-field__label" htmlFor={`dz-img-${step.key || index}`}>Image link</label>
            <input
              id={`dz-img-${step.key || index}`}
              className="ui-input"
              type="url"
              value={step.image || ''}
              placeholder="https://… (or upload a picture)"
              onChange={(e) => onUpdate({ image: e.target.value.trim() })}
            />
            {err && <span className="dz-error">{err}</span>}
          </div>

          <div className="dz-step__look">
            <div className="ui-field">
              <span className="ui-field__label">Icon</span>
              <div className="dz-icons" role="group" aria-label="Icon">
                {GUIDE_ICON_KEYS.map(k => {
                  const Ic = GUIDE_ICONS[k];
                  const on = shown.icon === k;
                  return (
                    <button
                      key={k}
                      type="button"
                      className={`dz-icon-opt${on ? ' is-on' : ''}`}
                      style={on ? { color: shown.accent } : undefined}
                      aria-pressed={on}
                      title={GUIDE_ICON_NAMES[k] || k}
                      aria-label={GUIDE_ICON_NAMES[k] || k}
                      onClick={() => onUpdate({ icon: k })}
                    >
                      <Ic />
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="ui-field">
              <span className="ui-field__label">Icon colour</span>
              <ColourInput size="sm" label="Icon colour" value={shown.accent} onChange={(v) => onUpdate({ accent: v })} />
            </div>
            <div className="ui-field">
              <span className="ui-field__label dz-label-row">
                Background
                {!step.bg ? <span className="dz-muted">built-in</span> : !readOnly && step.bg !== base.bg && (
                  <button type="button" className="dz-link" title="Use the built-in background for this position" onClick={() => onUpdate({ bg: '' })}>
                    Reset
                  </button>
                )}
              </span>
              <ColourInput size="sm" label="Background" value={shown.bg} onChange={(v) => onUpdate({ bg: v })} />
            </div>
          </div>
        </div>
      </div>
      )}
    </li>
  );
}
