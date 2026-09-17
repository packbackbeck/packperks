import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/* ─────────────────────────────────────────────────────────────────────
 * A picker wheel like the one on an iPhone: scroll or swipe the numbers,
 * the one in the middle band is chosen. Tap the chosen number to type it
 * instead. Arrow keys work when the wheel has focus.
 * ───────────────────────────────────────────────────────────────────── */

const ITEM = 36;

export default function CupWheel({ value, max, onChange, disabled, id }) {
  const wheel = useRef(null);
  const settleTimer = useRef(0);
  const frame = useRef(0);
  const lastValue = useRef(value);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const cancelTyping = useRef(false);

  const paint = useCallback(() => {
    const el = wheel.current;
    if (!el) return;
    const centre = el.scrollTop + el.clientHeight / 2;
    // Only the number inside each row turns; the rows themselves stay put,
    // so scroll snapping measures them where they really are.
    const items = el.children;
    for (let i = 0; i < items.length; i++) {
      const itemCentre = ITEM + i * ITEM + ITEM / 2;
      const d = (itemCentre - centre) / ITEM;
      const a = Math.min(Math.abs(d), 3);
      const num = items[i].firstElementChild;
      if (!num) continue;
      num.style.transform = `rotateX(${(-d * 24).toFixed(2)}deg) scale(${(1 - a * 0.07).toFixed(3)})`;
      num.style.opacity = String(Math.max(0.12, 1 - a * 0.42).toFixed(3));
    }
  }, []);

  /* Scroll to the value when it changes from outside the wheel. */
  useLayoutEffect(() => {
    const el = wheel.current;
    if (!el) return;
    const target = (value - 1) * ITEM;
    if (Math.abs(el.scrollTop - target) > 1) el.scrollTop = target;
    lastValue.current = value;
    paint();
  }, [value, paint]);

  useEffect(() => () => {
    clearTimeout(settleTimer.current);
    cancelAnimationFrame(frame.current);
  }, []);

  function settle() {
    const el = wheel.current;
    if (!el) return;
    const next = Math.min(max, Math.max(1, Math.round(el.scrollTop / ITEM) + 1));
    if (next !== lastValue.current) {
      lastValue.current = next;
      navigator.vibrate?.(6);
      onChange(next);
    }
  }

  function onScroll() {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(paint);
    clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(settle, 90);
  }

  function pick(n) {
    if (disabled) return;
    if (n === value) {
      setDraft(String(value));
      setTyping(true);
      return;
    }
    wheel.current?.scrollTo({ top: (n - 1) * ITEM, behavior: 'smooth' });
  }

  function onKeyDown(e) {
    if (disabled) return;
    const step = { ArrowUp: -1, ArrowDown: 1, PageUp: -5, PageDown: 5 }[e.key];
    if (step) {
      e.preventDefault();
      onChange(Math.min(max, Math.max(1, value + step)));
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      onChange(e.key === 'Home' ? 1 : max);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      setDraft(String(value));
      setTyping(true);
    }
  }

  function commitTyped() {
    setTyping(false);
    if (cancelTyping.current) { cancelTyping.current = false; return; }
    const n = parseInt(draft, 10);
    if (Number.isFinite(n)) onChange(Math.min(max, Math.max(1, n)));
  }

  return (
    <div className={`st-wheel${disabled ? ' st-wheel--disabled' : ''}`}>
      <div className="st-wheel__band" aria-hidden="true" />
      <div
        ref={wheel}
        id={id}
        className="st-wheel__list"
        role="spinbutton"
        tabIndex={disabled ? -1 : 0}
        aria-valuemin={1}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={`${value} ${value === 1 ? 'cup' : 'cups'}`}
        aria-label="Number of cups"
        aria-disabled={disabled || undefined}
        onScroll={onScroll}
        onKeyDown={onKeyDown}
        style={{ paddingBlock: ITEM }}
      >
        {Array.from({ length: max }, (_, i) => i + 1).map(n => (
          <div
            key={n}
            className={`st-wheel__item${n === value ? ' st-wheel__item--on' : ''}`}
            style={{ height: ITEM }}
            onClick={() => pick(n)}
          >
            <span className="st-wheel__num">{n}</span>
          </div>
        ))}
      </div>
      {typing && (
        <input
          className="st-wheel__input"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={2}
          value={draft}
          aria-label="Type the number of cups"
          autoFocus
          onFocus={e => e.target.select()}
          onChange={e => setDraft(e.target.value.replace(/\D/g, ''))}
          onBlur={commitTyped}
          onKeyDown={e => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') { cancelTyping.current = true; e.currentTarget.blur(); }
          }}
        />
      )}
    </div>
  );
}
