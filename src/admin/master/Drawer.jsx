import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Button, Tabs } from '../ui';

/* A panel that slides in from the right, for editing one item from a list.
 * Rendered into the dashboard root, like Modal, so it sits above the top
 * bar and keeps the admin's tokens. Dialogs opened from inside it stack on
 * top; Escape then closes the dialog, not the drawer. */
export default function Drawer({
  open, onClose, title, subtitle, lead, badges, actions,
  tabs, tab, onTab, footer, children, label,
}) {
  const panel = useRef(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('.ui-modal-scrim, .tcm-backdrop')) return;
      closeRef.current?.();
    };
    document.addEventListener('keydown', onKey);
    panel.current?.focus({ preventScroll: true });
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;
  const host = document.querySelector('.admin-app') || document.body;
  return createPortal(
    <div className="ms-drawer-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <aside ref={panel} className="ms-drawer" role="dialog" aria-modal="true" aria-label={label || (typeof title === 'string' ? title : undefined)} tabIndex={-1}>
        <header className={`ms-drawer__head${tabs ? ' ms-drawer__head--tabs' : ''}`}>
          <div className="ms-drawer__top">
            {lead && <span className="ms-drawer__lead">{lead}</span>}
            <div className="ms-drawer__titles">
              <h2 className="ms-drawer__title">{title}</h2>
              {subtitle && <p className="ms-drawer__sub">{subtitle}</p>}
            </div>
            <div className="ms-drawer__actions">
              {actions}
              <Button variant="ghost" size="sm" icon={X} aria-label="Close" onClick={onClose} />
            </div>
          </div>
          {badges && <div className="ms-drawer__badges">{badges}</div>}
          {tabs && (
            <div className="ms-drawer__tabs">
              <Tabs tabs={tabs} value={tab} onChange={onTab} ariaLabel="Sections" />
            </div>
          )}
        </header>
        <div className="ms-drawer__body" key={tab || 'body'}>{children}</div>
        {footer && <footer className="ms-drawer__foot">{footer}</footer>}
      </aside>
    </div>,
    host,
  );
}
