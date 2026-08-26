import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import './TypedConfirmModal.css';

/* ─────────────────────────────────────────────────────────────────────
 * TypedConfirmModal — a confirmation that makes you read it.
 *
 * Used for the changes that quietly rewrite what customers see: switching
 * an org's programme model, and moving an org in or out of a group. None
 * of these destroys data, which is exactly why they're dangerous — the
 * damage shows up later, in the wrong copy on a customer's screen or a
 * printed QR code that stopped working, with nothing in the UI to explain
 * why.
 *
 * So the modal spells out the consequences, and the confirm button stays
 * disabled until the admin types the action word. The typing isn't
 * ceremony: it's the pause that gets the consequence list actually read.
 * ───────────────────────────────────────────────────────────────────── */
export default function TypedConfirmModal({
  title,
  intro,
  word,            // the word the admin must type, e.g. "switch"
  confirmLabel,
  tone = 'warn',   // 'warn' | 'danger'
  busy = false,
  children,        // the consequence content
  onConfirm,
  onCancel,
}) {
  const [typed, setTyped] = useState('');
  const ok = typed.trim().toLowerCase() === String(word).toLowerCase();

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && !busy) onCancel?.();
      if (e.key === 'Enter' && ok && !busy) onConfirm?.();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [ok, busy, onConfirm, onCancel]);

  return createPortal(
    <div className="tcm-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`tcm tcm--${tone}`}>
        <header className="tcm__head">
          <h2 className="tcm__title">{title}</h2>
          {intro && <p className="tcm__intro">{intro}</p>}
        </header>

        <div className="tcm__body">{children}</div>

        <div className="tcm__gate">
          <label className="tcm__gate-label" htmlFor="tcm-input">
            Type <strong>{word}</strong> to confirm
          </label>
          <input
            id="tcm-input"
            className="tcm__input"
            value={typed}
            onChange={e => setTyped(e.target.value)}
            placeholder={word}
            autoFocus
            autoComplete="off"
            spellCheck="false"
            disabled={busy}
          />
        </div>

        <footer className="tcm__foot">
          <button type="button" className="tcm__btn tcm__btn--ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="tcm__btn tcm__btn--go"
            onClick={onConfirm}
            disabled={!ok || busy}
          >
            {busy ? 'Working…' : (confirmLabel || 'Confirm')}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
