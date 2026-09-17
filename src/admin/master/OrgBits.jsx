import { CircleCheck, Info, TriangleAlert, Zap } from 'lucide-react';
import { Button, Modal } from '../ui';
import { MODE_GLYPH, modeLabel } from './orgShared';

/* Small building blocks shared by the organisation, group and region editors. */

export function ModeChip({ mode, title }) {
  const Glyph = MODE_GLYPH[mode] || MODE_GLYPH.standard;
  return (
    <span className={`ms-mode-chip ms-mode-chip--${mode}`} title={title}>
      <Glyph size={12} aria-hidden="true" />
      {modeLabel(mode)}
    </span>
  );
}

/* One titled block inside an editor. `when` says when its changes land:
 * 'save' (with the Save button) or 'now' (straight away, after a confirm). */
export function Sec({ title, icon: Icon, hint, when, action, danger, children }) {
  return (
    <section className={`ms-sec${danger ? ' ms-sec--danger' : ''}`}>
      <div className="ms-sec__head">
        <div className="ms-sec__titles">
          <h3 className="ms-sec__title">
            {Icon && <Icon size={15} aria-hidden="true" />}
            {title}
            {when === 'now' && (
              <span className="ms-when ms-when--now" title="This change is made as soon as you confirm it.">
                <Zap size={11} aria-hidden="true" />Applies straight away
              </span>
            )}
            {when === 'save' && <span className="ms-when">Saved with the button below</span>}
          </h3>
          {hint && <p className="ms-sec__hint">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function ChoiceCard({ on, disabled, icon: Icon, tone, label, blurb, tag, onClick, children }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={!!on}
      disabled={disabled}
      className={`ms-choice${on ? ' ms-choice--on' : ''}`}
      onClick={onClick}
    >
      <span className="ms-choice__top">
        {Icon && <span className={`ms-choice__glyph ms-choice__glyph--${tone || 'plain'}`} aria-hidden="true"><Icon size={16} /></span>}
        <span className="ms-choice__label">{label}</span>
        {on && <span className="ms-choice__tag">{tag || 'In use'}</span>}
      </span>
      {blurb && <span className="ms-choice__blurb">{blurb}</span>}
      {children}
    </button>
  );
}

export function Callout({ tone = 'info', title, children, action }) {
  const Icon = tone === 'warn' ? TriangleAlert : tone === 'ok' ? CircleCheck : Info;
  return (
    <div className={`ms-callout ms-callout--${tone}`} role={tone === 'warn' ? 'alert' : 'note'}>
      <Icon size={16} aria-hidden="true" />
      <div className="ms-callout__main">
        {title && <p className="ms-callout__title">{title}</p>}
        {children && <div className="ms-callout__text">{children}</div>}
      </div>
      {action}
    </div>
  );
}

/* The drawer footer: what is unsaved, and the two buttons that act on it. */
export function SaveFooter({ changes, saving, error, onDiscard, onSave, saveLabel = 'Save changes', cleanText }) {
  const n = changes.length;
  return (
    <>
      <div className="ms-savestate" aria-live="polite">
        {error ? (
          <span className="ms-error" role="alert">{error}</span>
        ) : n > 0 ? (
          <span className="ms-savestate__dirty" title={changes.join(', ')}>
            <span className="ms-savestate__dot" aria-hidden="true" />
            {n === 1 ? `Unsaved: ${changes[0]}` : `${n} unsaved changes`}
          </span>
        ) : (
          <span className="ms-savestate__clean">{cleanText || 'Everything is saved.'}</span>
        )}
      </div>
      <Button variant="outline" disabled={!n || saving} onClick={onDiscard}>Discard</Button>
      <Button variant="primary" disabled={!n || saving} onClick={onSave}>{saving ? 'Saving…' : saveLabel}</Button>
    </>
  );
}

export function DiscardModal({ open, onKeep, onDiscard }) {
  return (
    <Modal
      open={open}
      onClose={onKeep}
      title="Close without saving?"
      icon={TriangleAlert}
      iconTone="amber"
      footer={(
        <>
          <Button variant="outline" onClick={onKeep}>Keep editing</Button>
          <Button variant="danger" onClick={onDiscard}>Discard changes</Button>
        </>
      )}
    >
      <p className="ms-modal-text">You changed some fields and did not save them. Closing throws those changes away.</p>
    </Modal>
  );
}
