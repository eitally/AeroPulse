/* eslint-disable no-restricted-globals */
// THRESH Service Worker Web Push & Notification Click Handler

self.addEventListener('push', (event) => {
  let payload = {
    title: 'THRESH Team Update',
    body: 'Open THRESH to read your new message.',
    url: '/?openMessages=1',
    tag: 'thresh-team-message',
    isEmergency: false,
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      if (parsed && typeof parsed === 'object') {
        payload = {
          title: String(parsed.title || payload.title),
          body: String(parsed.body || payload.body),
          url: String(parsed.url || payload.url),
          tag: String(parsed.tag || payload.tag),
          isEmergency: Boolean(parsed.isEmergency),
        };
      }
    } catch {
      const text = event.data.text();
      if (text) {
        payload.body = String(text).slice(0, 140);
      }
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      tag: payload.tag,
      renotify: Boolean(payload.isEmergency),
      data: { url: payload.url },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl =
    (event.notification.data && typeof event.notification.data.url === 'string'
      ? event.notification.data.url
      : '/?openMessages=1') || '/?openMessages=1';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        for (const client of windowClients) {
          if (client && 'focus' in client) {
            client.focus();
            if ('postMessage' in client) {
              client.postMessage({ type: 'THRESH_OPEN_URL', url: targetUrl });
            }
            return client;
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
        return undefined;
      })
  );
});
