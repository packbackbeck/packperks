import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/* A bottom sheet on phones, a centred card on wider screens. Closes on the
 * backdrop, the close button and Escape, and gives focus back after. */
export default function Sheet({ open, onClose, title, children, labelledBy }) {
  const panel = useRef(null);
  // The latest onClose, so a parent re-render doesn't re-run the effect
  // below (which would pull focus out of whatever is being typed in).
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });

  useEffect(() => {
    if (!open) return undefined;
    const before = document.activeElement;
    const onKey = (e) => { if (e.key === 'Escape') closeRef.current?.(); };
    document.addEventListener('keydown', onKey);
    const t = setTimeout(() => panel.current?.focus(), 30);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      before?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="st-sheet" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div
        ref={panel}
        className="st-sheet__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : title}
        tabIndex={-1}
      >
        <span className="st-sheet__handle" aria-hidden="true" />
        <button type="button" className="st-sheet__close" onClick={onClose} aria-label="Close">
          <X size={18} aria-hidden="true" />
        </button>
        {children}
      </div>
    </div>,
    document.querySelector('.st-app') || document.body,
  );
}
