/* ─────────────────────────────────────────────────────────────────────
 * Add to Home Screen — what the sheet needs to know about this browser.
 *
 * A venue switches it on in Master Settings (organizations.add_to_home:
 * null = off, 'home' = a tab under the cup progress, 'account' = a row
 * under Help). The customer app asks this module three things:
 *
 *   addToHomePlacement(org) — where it sits, or null (also null when the
 *     app is already running from the Home Screen, where it would be
 *     pointless).
 *   phoneKind()            — 'ios' | 'android' | 'other', for the first tab
 *     of the instructions. iPadOS that reports itself as a Mac counts as iOS.
 *   install prompt         — Chrome on Android fires `beforeinstallprompt`
 *     once, early. It is caught here at import time, so the sheet can offer
 *     a one-tap install where the browser allows it and fall back to the
 *     pictures everywhere else (Safari never fires it).
 * ───────────────────────────────────────────────────────────────────── */

const PLACEMENTS = new Set(['home', 'account']);

let deferredPrompt = null;
const listeners = new Set();
const notify = () => listeners.forEach(fn => { try { fn(); } catch { /* ignore */ } });

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // keep Chrome's own mini-infobar out of the way; the sheet offers it
    deferredPrompt = e;
    notify();
  });
  window.addEventListener('appinstalled', () => { deferredPrompt = null; notify(); });
}

/** True when the app was opened from the Home Screen. */
export function isStandalone() {
  if (typeof window === 'undefined') return false;
  try {
    if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
    if (window.matchMedia?.('(display-mode: fullscreen)').matches) return true;
  } catch { /* ignore */ }
  return window.navigator?.standalone === true;
}

/** Where the venue shows it, or null. */
export function addToHomePlacement(org) {
  const p = org?.add_to_home;
  if (!PLACEMENTS.has(p)) return null;
  return isStandalone() ? null : p;
}

/** 'ios' | 'android' | 'other' */
export function phoneKind() {
  if (typeof navigator === 'undefined') return 'other';
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return 'ios'; // iPadOS desktop mode
  if (/Android/i.test(ua)) return 'android';
  return 'other';
}

/** Chrome on iPhone keeps Share in the address bar, not behind •••. */
export function isIosChrome() {
  if (typeof navigator === 'undefined') return false;
  return /CriOS/i.test(navigator.userAgent || '');
}

export function canPromptInstall() {
  return !!deferredPrompt;
}

/** Subscribe to the prompt becoming (un)available. Returns an unsubscribe. */
export function onInstallPromptChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Show the browser's own install dialog. Resolves 'accepted' | 'dismissed' | null. */
export async function promptInstall() {
  const e = deferredPrompt;
  if (!e) return null;
  deferredPrompt = null; // a prompt can only be used once
  notify();
  try {
    await e.prompt();
    const choice = await e.userChoice;
    return choice?.outcome || null;
  } catch {
    return null;
  }
}
