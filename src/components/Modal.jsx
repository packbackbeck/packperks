import { useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import './Modal.css';

export default function Modal({ open, onClose, title, children }) {
  const overlayRef = useRef(null);
  const sheetRef = useRef(null);

  const handleEscape = useCallback((e) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      document.addEventListener('keydown', handleEscape);
      // Focus the sheet for screen readers
      sheetRef.current?.focus();
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open, handleEscape]);

  if (!open) return null;

  const handleOverlayClick = (e) => {
    if (e.target === overlayRef.current) onClose();
  };

  // Portal to <body> so `position: fixed` is relative to the VIEWPORT, not a
  // transformed ancestor (the app has animated/scaled containers). Without this,
  // on some larger screens the sheet anchored to the wrong box and its header
  // (title + ✕) scrolled off the top of the screen.
  return createPortal(
    <div
      className="modal-overlay"
      ref={overlayRef}
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div className="modal-sheet" ref={sheetRef} tabIndex={-1}>
        <div className="modal-sheet__drag-handle" aria-hidden="true" />
        <div className="modal-sheet__header">
          <h3 className="modal-sheet__title" id="modal-title">{title}</h3>
          <button
            className="modal-sheet__close"
            onClick={onClose}
            aria-label="Close dialog"
            type="button"
          >
            ✕
          </button>
        </div>
        <div className="modal-sheet__body">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
