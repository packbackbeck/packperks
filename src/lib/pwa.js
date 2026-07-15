/* ─────────────────────────────────────────────────────────────────────
 * pwa.js — "Add to Home Screen" install state for the customer app.
 *
 * Web install detection is inherently fuzzy, so we combine every signal:
 *   • display-mode: standalone  → the app is open AS the installed PWA (certain).
 *   • appinstalled event        → the user just installed it (set a hint flag).
 *   • beforeinstallprompt event → the browser considers it INSTALLABLE again,
 *                                  which means it is NOT currently installed —
 *                                  so we clear the hint flag. This is what lets
 *                                  us recover when a user deletes the app: the
 *                                  next beforeinstallprompt un-sticks "installed".
 *
 * The localStorage flag is only a hint (a deleted app can't be detected
 * directly), but the beforeinstallprompt reset keeps it honest over time.
 * ───────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useState } from 'react';
import { isIOS } from './notify';

const INSTALLED_KEY = 'packperks_pwa_installed';

export function isStandalone() {
  try {
    return window.matchMedia?.('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
  } catch { return false; }
}

function readInstalledHint() {
  if (isStandalone()) return true;
  try { return localStorage.getItem(INSTALLED_KEY) === '1'; } catch { return false; }
}

export function usePwaInstall() {
  const [deferred, setDeferred] = useState(null);   // stashed beforeinstallprompt event
  const [installed, setInstalled] = useState(readInstalledHint);

  useEffect(() => {
    const onBeforeInstall = (e) => {
      e.preventDefault();          // keep our own button in control
      setDeferred(e);
      // Installable again ⇒ not currently installed (e.g. the user deleted it).
      setInstalled(false);
      try { localStorage.removeItem(INSTALLED_KEY); } catch { /* ignore */ }
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
      try { localStorage.setItem(INSTALLED_KEY, '1'); } catch { /* ignore */ }
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);

    const mq = window.matchMedia?.('(display-mode: standalone)');
    const onDisplayChange = (e) => { if (e.matches) setInstalled(true); };
    mq?.addEventListener?.('change', onDisplayChange);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
      mq?.removeEventListener?.('change', onDisplayChange);
    };
  }, []);

  // Fire the native install prompt (Chrome/Edge/Android). Returns the outcome,
  // or 'unavailable' when there's no prompt (iOS Safari, Firefox, already
  // installed) — the caller then shows manual "Add to Home Screen" steps.
  const promptInstall = useCallback(async () => {
    if (!deferred) return 'unavailable';
    try {
      deferred.prompt();
      const { outcome } = await deferred.userChoice;
      if (outcome === 'accepted') {
        setInstalled(true);
        try { localStorage.setItem(INSTALLED_KEY, '1'); } catch { /* ignore */ }
      }
      setDeferred(null);
      return outcome;
    } catch {
      return 'unavailable';
    }
  }, [deferred]);

  return {
    installed,               // best-effort: is the app installed / running as PWA?
    canPrompt: !!deferred,   // a native install prompt is ready
    isIOS: isIOS(),          // iOS needs manual Share → Add to Home Screen
    promptInstall,
  };
}
