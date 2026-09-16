/* PackPerks service worker.
 *
 * Kept only so the customer app stays installable to the home screen. It has
 * no fetch or cache handler, so it can't serve stale code or interfere with
 * HMR, and it no longer handles push: notifications are email only. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
