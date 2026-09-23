import { useEffect } from 'react';

/* ─────────────────────────────────────────────────────────────────────
 * Make a section end where the window ends.
 *
 * Heatmap and Session replay are one big thing to look at, so the phone
 * should be as tall as the screen allows and the card should not run off
 * the bottom. How much room that is depends on everything above it — the
 * page header, the tab strip, the capture bar, the card's own header —
 * and those differ by venue, by role and by how long the subtitle wraps.
 * A constant was always going to be wrong somewhere, and was: it left the
 * card hanging 180px below the fold on a real dashboard.
 *
 * So measure. The section's offset inside the PAGE is stable whatever the
 * scroll position is, and the room left is the window minus that. The
 * result goes on the element as `--uf-fit`, which the stylesheet uses for
 * its height.
 * ───────────────────────────────────────────────────────────────────── */
export default function useFitHeight(ref, { min = 460, gap = 22 } = {}) {
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof window === 'undefined') return undefined;

    const apply = () => {
      // Where this section starts in the page, not in the viewport.
      const top = el.getBoundingClientRect().top + window.scrollY;
      const room = window.innerHeight - top - gap;
      el.style.setProperty('--uf-fit', `${Math.max(min, Math.round(room))}px`);
    };

    apply();
    // The header above it can reflow (a longer subtitle, a wrapped tab
    // strip), so watch the page rather than only the window.
    const ro = new ResizeObserver(apply);
    ro.observe(document.body);
    window.addEventListener('resize', apply);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', apply);
    };
  }, [ref, min, gap]);
}
