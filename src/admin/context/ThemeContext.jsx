import { useCallback, useEffect, useMemo, useState } from 'react';
import { daylightPhase, msUntilPhaseChange } from '../lib/daylight';
import { ThemeCtx } from './themeCtx';

/* ─────────────────────────────────────────────────────────────────────
 * Light or dark, for the dashboard only.
 *
 * The choice is per browser (localStorage), never per account, so it
 * never travels to another person's screen. Masters decide in Master
 * Settings → Workspace whether the switch exists at all, and whether the
 * dashboard follows the local sunrise and sunset.
 *
 * `data-theme` goes on <html>, not on `.admin-app`: menus and modals
 * portal to <body>, outside the shell, and would otherwise stay light.
 * The customer app never sets it, so its pages are unaffected.
 * ───────────────────────────────────────────────────────────────────── */

const STORAGE_KEY = 'pp-admin-theme';

/* What this browser chose, and the daylight phase it was in at the time.
 * Automatic mode hands control back at the next sunrise or sunset, so one
 * late-night switch to dark doesn't keep the dashboard dark for good. */
function readChoice() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    if (raw === 'light' || raw === 'dark') return { theme: raw, phase: null };
    const parsed = JSON.parse(raw);
    return parsed?.theme === 'light' || parsed?.theme === 'dark' ? parsed : null;
  } catch { return null; }
}

function writeChoice(choice) {
  try {
    if (choice) localStorage.setItem(STORAGE_KEY, JSON.stringify(choice));
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* private mode: the choice just doesn't outlive the tab */ }
}

/* A choice made in a different daylight phase is spent once automatic
 * mode is on. Dropping it here — rather than in an effect — keeps phase
 * and choice in one update, so there is no cascading render. */
function freshChoice(choice, phase, auto) {
  if (!auto || !choice?.phase || choice.phase === phase) return choice;
  writeChoice(null);
  return null;
}

export function ThemeProvider({ auto = false, children }) {
  const [state, setState] = useState(() => {
    const phase = daylightPhase();
    return { phase, choice: freshChoice(readChoice(), phase, auto) };
  });
  const { phase, choice } = state;
  const theme = choice?.theme || (auto && phase === 'night' ? 'dark' : 'light');

  /* Re-check at the next sunrise or sunset while the tab stays open. */
  useEffect(() => {
    if (!auto) return undefined;
    const id = setTimeout(() => setState((s) => {
      const next = daylightPhase();
      return { phase: next, choice: freshChoice(s.choice, next, true) };
    }), msUntilPhaseChange());
    return () => clearTimeout(id);
  }, [auto, phase]);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    return () => root.removeAttribute('data-theme');
  }, [theme]);

  const setTheme = useCallback((next) => {
    const entry = { theme: next, phase: daylightPhase() };
    writeChoice(entry);
    setState((s) => ({ ...s, choice: entry }));
  }, []);

  const value = useMemo(
    () => ({ theme, auto, setTheme, toggle: () => setTheme(theme === 'dark' ? 'light' : 'dark') }),
    [theme, auto, setTheme],
  );

  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}
