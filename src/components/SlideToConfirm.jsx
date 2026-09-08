import { useRef, useState } from 'react';
import './SlideToConfirm.css';

/* ─────────────────────────────────────────────────────────────────────
 * SlideToConfirm — a drag-across control for actions that must not fire
 * on a stray tap: sending money, taking cups off a balance.
 *
 * Reports progress (0–1) as the thumb moves so the surrounding screen can
 * react, and fires onComplete once, when the thumb is dragged past the
 * threshold and released. Letting go early snaps it back: an unfinished
 * slide is not a confirmation.
 * ───────────────────────────────────────────────────────────────────── */

const THUMB = 64;   // px, matches the CSS
const DONE  = 0.88; // fraction of the track that counts as committed

export default function SlideToConfirm({ label, color, disabled = false, onProgress, onComplete }) {
  const trackRef = useRef(null);
  const draggingRef = useRef(false);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);

  const set = (p) => { setProgress(p); onProgress?.(p); };

  function fractionAt(clientX) {
    const el = trackRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left - THUMB / 2) / (r.width - THUMB)));
  }
  function onDown(e) {
    if (done || disabled) return;
    draggingRef.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    set(fractionAt(e.clientX));
  }
  function onMove(e) {
    if (!draggingRef.current || done) return;
    set(fractionAt(e.clientX));
  }
  function onUp() {
    if (!draggingRef.current || done) return;
    draggingRef.current = false;
    if (progress >= DONE) {
      setDone(true);
      set(1);
      onComplete?.();
    } else {
      set(0);
    }
  }

  return (
    <div
      className={`stc${done ? ' stc--done' : ''}${disabled ? ' stc--disabled' : ''}`}
      ref={trackRef}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      role="slider"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
      style={{ '--stc-color': color }}
    >
      <div className="stc__fill" style={{ width: `${progress * 100}%` }} />
      <span className="stc__label" style={{ opacity: Math.max(0, 1 - progress * 1.6) }}>{label}</span>
      <div className="stc__thumb" style={{ left: `calc(${progress} * (100% - ${THUMB}px))` }}>
        {done ? (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
        )}
      </div>
    </div>
  );
}
