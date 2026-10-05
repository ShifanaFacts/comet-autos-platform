/*
 * The app's service worker — deliberately small.
 *
 * It caches nothing from the app itself: every screen holds live workshop
 * and customer data behind a sign-in, and a stale copy of a job or an
 * invoice is worse than none. It only keeps one static "You're offline"
 * page, shown when a screen can't be reached, instead of the browser's
 * dinosaur. Uploads, forms and data requests pass straight through.
 */

const CACHE = 'garage-offline-v1';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: 'reload' })))
      // No room to keep it (private browsing, a full phone) is no reason to
      // refuse the worker: pages still load, only the offline page is missing.
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  // Only full page loads. Everything else is left to the browser.
  if (event.request.mode !== 'navigate' || event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request).catch(async () =>
      ((await caches.match(OFFLINE_URL).catch(() => undefined)) ?? Response.error()),
    ),
  );
});

/*
 * Push notifications (lib/notifications/push.ts sends them).
 *
 * When the app is open on screen, the page itself plays the chime and the
 * spoken announcement and updates the bell — so the phone's own banner is
 * skipped. Otherwise the notification is shown with the phone's sound and
 * vibration. Tapping it opens the app at the right place and marks it read.
 */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: event.data ? event.data.text() : 'New notification' };
  }
  const title = data.title || 'New notification';
  const url = data.id ? `/notifications/${data.id}/open` : data.href || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const visible = windows.filter((client) => client.visibilityState === 'visible');
      for (const client of windows) client.postMessage({ type: 'notification', payload: data });
      if (visible.length > 0) return undefined;
      return self.registration.showNotification(title, {
        body: data.body || '',
        icon: '/app-icons/icon-192.png',
        badge: '/app-icons/icon-192.png',
        tag: data.kind || 'general',
        renotify: true,
        requireInteraction: data.kind === 'CHECK_OUT_REMINDER' || data.kind === 'CHECK_IN_REMINDER',
        vibrate: [200, 100, 200, 100, 300],
        data: { url },
      });
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => 'focus' in client);
      if (open) {
        return open.focus().then((client) => (client && 'navigate' in client ? client.navigate(url) : undefined));
      }
      return self.clients.openWindow(url);
    }),
  );
});
