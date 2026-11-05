import { useLayoutEffect } from 'react';

/* ─────────────────────────────────────────────────────────────────────
 * Put each [data-bl] text element's first baseline exactly on its value,
 * in points from the nearest [data-origin] (or the app root).
 *
 * The KFC screens were matched to screenshots by where each line of text
 * SITS, not by its box, and a box's offset to its baseline depends on the
 * font. So the layout is measured once the real fonts are in, with a
 * zero-size inline-block as the probe. Scaling is read off the app root,
 * so it works inside the scaled phone and full-screen alike.
 * ───────────────────────────────────────────────────────────────────── */
export function useBaselines(rootRef, deps = []) {
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const place = () => {
      const k = root.getBoundingClientRect().width / 393;
      if (!k) return;
      root.querySelectorAll('[data-bl]').forEach((el) => {
        const originEl = el.parentElement?.closest('[data-origin]') || root;
        el.style.top = '0px';
        const probe = document.createElement('span');
        probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
        el.prepend(probe);
        const y = (probe.getBoundingClientRect().top - originEl.getBoundingClientRect().top) / k;
        probe.remove();
        el.style.top = `${(parseFloat(el.dataset.bl) - y).toFixed(3)}px`;
      });
    };
    place();
    document.fonts?.ready.then(place);
    document.fonts?.addEventListener?.('loadingdone', place);
    return () => document.fonts?.removeEventListener?.('loadingdone', place);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
