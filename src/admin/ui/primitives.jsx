import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Info, X } from 'lucide-react';

/* Small, dependency-free building blocks for the admin. Styles: ui.css. */

export function Card({ as: Tag = 'section', className = '', children, ...rest }) {
  return <Tag className={`ui-card ${className}`} {...rest}>{children}</Tag>;
}

export function CardHeader({ title, subtitle, icon: Icon, actions, ruled = false, children }) {
  return (
    <div className={`ui-card__head${ruled ? ' ui-card__head--ruled' : ''}`}>
      <div className="ui-card__titles">
        <h2 className="ui-card__title">
          {Icon && <Icon size={16} aria-hidden="true" />}
          {title}
        </h2>
        {subtitle && <p className="ui-card__sub">{subtitle}</p>}
        {children}
      </div>
      {actions && <div className="ui-card__actions">{actions}</div>}
    </div>
  );
}

export function CardBody({ flush = false, className = '', children }) {
  return <div className={`ui-card__body${flush ? ' ui-card__body--flush' : ''} ${className}`}>{children}</div>;
}

export function CardFoot({ children }) {
  return <div className="ui-card__foot">{children}</div>;
}

export function PageHeader({ title, subtitle, children }) {
  return (
    <header className="ui-page-head">
      <div className="ui-page-head__titles">
        <h1 className="ui-page-head__title">{title}</h1>
        {subtitle && <p className="ui-page-head__sub">{subtitle}</p>}
      </div>
      {children && <div className="ui-page-head__controls">{children}</div>}
    </header>
  );
}

export function Button({ variant = 'outline', size, icon: Icon, iconRight: IconRight, block, className = '', children, ...rest }) {
  const iconOnly = !children && (Icon || IconRight);
  const cls = [
    'ui-btn',
    `ui-btn--${variant}`,
    size ? `ui-btn--${size}` : '',
    iconOnly ? 'ui-btn--icon' : '',
    block ? 'ui-btn--block' : '',
    className,
  ].filter(Boolean).join(' ');
  const s = size === 'sm' ? 14 : 15;
  return (
    <button type="button" className={cls} {...rest}>
      {Icon && <Icon size={s} aria-hidden="true" />}
      {children}
      {IconRight && <IconRight size={s} aria-hidden="true" />}
    </button>
  );
}

/* options: [{ id, label, icon?, title?, count? }] */
export function Segmented({ options, value, onChange, iconOnly = false, ariaLabel }) {
  return (
    <div className="ui-seg" role="group" aria-label={ariaLabel}>
      {options.map(o => {
        const Icon = o.icon;
        return (
          <button
            key={o.id}
            type="button"
            className={`ui-seg__btn${iconOnly ? ' ui-seg__btn--icon' : ''}`}
            aria-pressed={value === o.id}
            aria-label={iconOnly ? o.label : undefined}
            title={o.title || (iconOnly ? o.label : undefined)}
            onClick={() => onChange(o.id)}
          >
            {Icon && <Icon size={14} aria-hidden="true" />}
            {!iconOnly && o.label}
            {o.count != null && <span className="ui-seg__count">{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function ToggleChip({ pressed, onClick, icon: Icon, children, ...rest }) {
  return (
    <button type="button" className="ui-toggle-chip" aria-pressed={!!pressed} onClick={onClick} {...rest}>
      {Icon && <Icon size={14} aria-hidden="true" />}
      {children}
    </button>
  );
}

export function Switch({ checked, onChange, label, disabled, tone, id }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={!!checked}
      aria-label={label}
      disabled={disabled}
      className={`ui-switch${tone === 'danger' ? ' ui-switch--danger' : ''}`}
      onClick={() => !disabled && onChange?.(!checked)}
    />
  );
}

export function Badge({ tone = 'neutral', icon: Icon, children, title }) {
  return (
    <span className={`ui-badge ui-badge--${tone}`} title={title}>
      {Icon && <Icon size={11} aria-hidden="true" />}
      {children}
    </span>
  );
}

export function BetaChip({ title = 'Still in beta: it works, but expect changes.' }) {
  return <span className="ui-beta" title={title}>Beta</span>;
}

/* Hover/focus explanation next to a number. The trigger is a focusable
 * span, not a button: it often sits inside a clickable tile. */
export function InfoTip({ label, children, formula, note }) {
  return (
    <span className="ui-tip" onClick={e => e.stopPropagation()}>
      <span role="button" tabIndex={0} className="ui-tip__trigger" aria-label={`About ${label}`}>
        <Info size={14} aria-hidden="true" />
      </span>
      <span className="ui-tip__bubble" role="tooltip">
        {note && <span className="ui-tip__note">{note}</span>}
        {children}
        {formula && <span className="ui-tip__formula">{formula}</span>}
      </span>
    </span>
  );
}

/* tabs: [{ id, label, icon?, count? }] */
export function Tabs({ tabs, value, onChange, ariaLabel }) {
  return (
    <div className="ui-tabs" role="tablist" aria-label={ariaLabel}>
      {tabs.map(t => {
        const Icon = t.icon;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={value === t.id}
            className="ui-tabs__btn"
            onClick={() => onChange(t.id)}
          >
            {Icon && <Icon size={14} aria-hidden="true" />}
            {t.label}
            {t.count != null && <span className="ui-tabs__count">{t.count}</span>}
            {t.beta && <BetaChip />}
          </button>
        );
      })}
    </div>
  );
}

export function Field({ label, hint, htmlFor, children }) {
  return (
    <div className="ui-field">
      {label && <label className="ui-field__label" htmlFor={htmlFor}>{label}</label>}
      {children}
      {hint && <span className="ui-field__hint">{hint}</span>}
    </div>
  );
}

/* A dropdown menu anchored to its trigger. `trigger` is a render function
 * receiving { open, toggle, id }. Closes on outside click and Escape. */
export function Menu({ trigger, children, align = 'right', up = false, className = '' }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const id = useId();
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className={`ui-menu-wrap ${className}`} ref={wrap}>
      {trigger({ open, toggle: () => setOpen(o => !o), id })}
      {open && (
        <div
          id={id}
          role="menu"
          className={`ui-menu ui-menu--${align}${up ? ' ui-menu--up' : ''}`}
          onClick={(e) => { if (e.target.closest('[data-menu-close]')) setOpen(false); }}
        >
          {typeof children === 'function' ? children({ close: () => setOpen(false) }) : children}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ icon: Icon, children, onClick, checked, danger, keepOpen, ...rest }) {
  return (
    <button
      type="button"
      role={checked === undefined ? 'menuitem' : 'menuitemradio'}
      aria-checked={checked === undefined ? undefined : checked}
      className={`ui-menu__item${danger ? ' ui-menu__item--danger' : ''}`}
      onClick={onClick}
      data-menu-close={keepOpen ? undefined : ''}
      {...rest}
    >
      {Icon && <Icon size={15} aria-hidden="true" />}
      <span style={{ flex: 1, minWidth: 0 }}>{children}</span>
    </button>
  );
}

export function MenuLabel({ children }) {
  return <div className="ui-menu__label">{children}</div>;
}

export function MenuSeparator() {
  return <div className="ui-menu__sep" role="separator" />;
}

export function EmptyState({ icon: Icon, title, children, boxed = false, action }) {
  return (
    <div className={`ui-empty${boxed ? ' ui-empty--boxed' : ''}`}>
      {Icon && <span className="ui-empty__icon"><Icon size={20} aria-hidden="true" /></span>}
      {title && <p className="ui-empty__title">{title}</p>}
      {children && <p className="ui-empty__text">{children}</p>}
      {action}
    </div>
  );
}

export function Modal({ open, onClose, title, subtitle, icon: Icon, iconTone = 'violet', wide, children, footer }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  /* Rendered at the root of the dashboard (not inside the page) so it sits
   * above the fixed top bar and sidebar, and keeps the admin's tokens. */
  const host = (typeof document !== 'undefined' && (document.querySelector('.admin-app') || document.body)) || null;
  const dialog = (
    <div className="ui-modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className={`ui-modal${wide ? ' ui-modal--wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="ui-modal__head">
          {Icon && <span className={`ui-modal__icon ui-tone--${iconTone}`}><Icon size={19} aria-hidden="true" /></span>}
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 className="ui-modal__title">{title}</h3>
            {subtitle && <p className="ui-modal__sub">{subtitle}</p>}
          </div>
          <Button variant="ghost" size="sm" icon={X} aria-label="Close" onClick={onClose} />
        </div>
        <div className="ui-modal__body">{children}</div>
        {footer && <div className="ui-modal__foot">{footer}</div>}
      </div>
    </div>
  );
  return host ? createPortal(dialog, host) : dialog;
}
