/* Web-push / notification helpers for the Tikkie "notify me when it's ready" flow.
 *
 * Feasibility (answered honestly in the UI):
 *   • Android / Chrome — full web push, works with the app open or closed.
 *   • iPhone / iPad — web push ONLY once the app is added to the Home Screen
 *     (installed PWA, iOS 16.4+). A normal Safari tab can't receive push, so we
 *     detect that and let the UI show an "Add to Home Screen" hint.
 *   • Email stays the universal fallback (we already have the address).
 *
 * The actual push SUBSCRIPTION + server SENDER (VAPID keys) is Phase 2 — here we
 * only register the service worker and request permission so the user's choice
 * is captured now. */

export function isPushSupported() {
  return typeof window !== 'undefined'
    && 'Notification' in window
    && 'serviceWorker' in navigator
    && 'PushManager' in window;
}

function isStandalone() {
  try {
    return window.matchMedia?.('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
  } catch { return false; }
}

export function isIOS() {
  const ua = navigator.userAgent || '';
  return /iP(hone|ad|od)/.test(ua)
    // iPadOS 13+ reports as Mac; disambiguate by touch support.
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

// iPhone/iPad can only receive web push once installed to the Home Screen.
export function iosNeedsInstall() {
  return isIOS() && !isStandalone();
}

export function getPermissionState() {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission; // 'default' | 'granted' | 'denied'
}

// Ask the browser for notification permission (and make sure the SW is
// registered). Returns the resulting permission string. The real push
// subscription is added in Phase 2 once VAPID keys + a sender exist.
export async function requestPushPermission() {
  if (!isPushSupported()) return 'unsupported';
  try {
    if ('serviceWorker' in navigator) {
      try { await navigator.serviceWorker.register('/sw.js'); } catch { /* non-fatal */ }
    }
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

// Stub — returns null until a VAPID public key + a push sender exist (Phase 2).
export async function subscribePush() {
  return null;
}
