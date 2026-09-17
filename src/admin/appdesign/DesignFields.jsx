import { useId, useState } from 'react';
import { Pipette } from 'lucide-react';
import { pickerValue, toHex } from './colorUtils';

/* Small form pieces shared by the Design & copy panels. */

/* A colour swatch that opens the system picker, with a hex field beside it.
 * Only a valid hex is saved; anything else snaps back when the field loses
 * focus. `value` may also be a CSS gradient (guide backgrounds): the swatch
 * paints it and the hex field stays empty until a colour is picked. */
export function ColourInput({ value, onChange, label, size = 'md', emptyLabel = 'Pick a colour', disabled }) {
  const id = useId();
  const hex = toHex(value);
  const shown = hex || '';
  const [text, setText] = useState(shown);
  const [seen, setSeen] = useState(shown);
  if (shown !== seen) {
    setSeen(shown);
    setText(shown);
  }

  // Six digits save as you type; a three-digit shorthand saves on blur, so
  // typing "5b3fd6" never stops at "#55BB33" halfway.
  function commitText(next) {
    setText(next);
    if (/^#[0-9a-f]{6}$/i.test(next) && toHex(next) !== hex) onChange(toHex(next));
  }
  function finishText() {
    const h = toHex(text);
    if (h && h !== hex) onChange(h);
    else setText(shown);
  }

  return (
    <div className={`dz-colour dz-colour--${size}`}>
      <label className="dz-colour__chip" style={{ background: value || 'transparent' }} title={`Pick ${label.toLowerCase()}`}>
        <input
          type="color"
          value={pickerValue(value, '#cccccc')}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          aria-label={`${label}: pick a colour`}
          disabled={disabled}
        />
        <Pipette size={size === 'sm' ? 12 : 14} aria-hidden="true" />
      </label>
      <div className="dz-colour__hex">
        {(hex || !value) && <span aria-hidden="true">#</span>}
        <input
          id={id}
          type="text"
          value={text.replace('#', '')}
          onChange={(e) => commitText(`#${e.target.value.replace(/[^0-9a-f]/gi, '').slice(0, 6)}`)}
          onFocus={(e) => e.target.select()}
          onBlur={finishText}
          placeholder={hex ? '' : (value ? 'Gradient' : emptyLabel)}
          spellCheck="false"
          autoComplete="off"
          maxLength={6}
          aria-label={`${label}: hex code`}
          disabled={disabled}
        />
      </div>
    </div>
  );
}

/* A text field with a character count that warns gently as it grows.
 * `soft` is where wrapping starts on small phones, `hard` where it
 * breaks the layout. */
export function CountedField({
  label, value, onChange, soft, hard, multiline = false, placeholder, hint, emptyNote,
  badge, onFocus, action, maxLength, rows = 3,
}) {
  const id = useId();
  const v = value || '';
  const len = v.length;
  const state = len > hard ? 'over' : len > soft ? 'long' : 'ok';
  let message = hint;
  let tone = 'muted';
  if (state === 'over') { message = 'Too long for most phones. It will wrap or get cut off.'; tone = 'danger'; }
  else if (state === 'long') { message = 'Getting long. It may wrap on small phones.'; tone = 'warning'; }
  else if (!len && emptyNote) { message = emptyNote; tone = 'warning'; }

  const Tag = multiline ? 'textarea' : 'input';
  return (
    <div className={`dz-field dz-field--${state}`}>
      <div className="dz-field__top">
        <label className="dz-field__label" htmlFor={id}>{label}</label>
        {badge}
        <span className={`dz-count dz-count--${state}`} aria-label={`${len} of ${soft} characters`}>
          {len}<span>/{soft}</span>
        </span>
      </div>
      <Tag
        id={id}
        className={multiline ? 'ui-textarea dz-field__area' : 'ui-input'}
        {...(multiline ? { rows } : { type: 'text' })}
        value={v}
        placeholder={placeholder}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
      />
      {(message || action) && (
        <div className="dz-field__foot">
          {message && <span className={`dz-field__msg dz-field__msg--${tone}`}>{message}</span>}
          {action}
        </div>
      )}
    </div>
  );
}

export function Callout({ tone = 'info', icon: Icon, title, children, action }) {
  return (
    <div className={`dz-callout dz-callout--${tone}`} role={tone === 'warning' ? 'note' : undefined}>
      {Icon && <Icon size={17} aria-hidden="true" className="dz-callout__icon" />}
      <div className="dz-callout__main">
        {title && <p className="dz-callout__title">{title}</p>}
        {children && <p className="dz-callout__text">{children}</p>}
      </div>
      {action && <div className="dz-callout__action">{action}</div>}
    </div>
  );
}
