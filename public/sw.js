/* PackPerks service worker — minimal scaffolding for web push + install.
 *
 * It intentionally has NO fetch/cache handler (so it can't break the app or
 * HMR); it only takes control cleanly and knows how to show + open a push
 * notification. The actual push SUBSCRIPTION + server sender (VAPID) is wired
 * in Phase 2 — this is the receiving half, ready ahead of time. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch { data = { body: event.data && event.data.text() }; }
  const title = data.title || 'PackPerks';
  const options = {
    body: data.body || 'Your cashback is ready to collect.',
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) { client.navigate(url); return client.focus(); }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    }),
  );
});
