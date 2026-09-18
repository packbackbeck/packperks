import { useCallback, useRef } from 'react';
import { flushSync } from 'react-dom';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from './context/themeCtx';
import './ThemeToggle.css';

/* The round button in the bottom-right corner that swaps the dashboard
 * between light and dark.
 *
 * The change is painted as a circle growing out of the button itself,
 * using the View Transitions API: the new theme is rendered underneath and
 * revealed through an expanding clip-path. Browsers without the API (and
 * anyone who asked for less motion) just get the instant swap. */
export default function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const btnRef = useRef(null);

  const onClick = useCallback(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced || typeof document.startViewTransition !== 'function') {
      toggle();
      return;
    }

    const rect = btnRef.current?.getBoundingClientRect();
    const x = rect ? rect.left + rect.width / 2 : window.innerWidth;
    const y = rect ? rect.top + rect.height / 2 : window.innerHeight;
    // Distance to the farthest corner, plus 8%. A decelerating curve on an
    // exact radius spends its last stretch crawling the final sliver of
    // screen, which reads as a snap; the margin means the corner is
    // covered at about 80% of the run and the rest is imperceptible.
    const corner = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    const radius = corner * 1.08;

    const transition = document.startViewTransition(() => flushSync(toggle));
    transition.ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        {
          duration: 650,
          // Close to linear, so the circle's edge travels at a steady
          // speed and the sweep reads as one continuous movement.
          easing: 'cubic-bezier(0.25, 0.25, 0.5, 0.9)',
          pseudoElement: '::view-transition-new(root)',
        },
      );
    }).catch(() => { /* the transition was skipped; the theme still changed */ });
  }, [toggle]);

  const dark = theme === 'dark';
  return (
    <button
      ref={btnRef}
      type="button"
      className="theme-toggle"
      onClick={onClick}
      aria-pressed={dark}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={dark ? 'Light mode' : 'Dark mode'}
    >
      {dark ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
    </button>
  );
}
