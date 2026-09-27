self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
// Never cache authenticated HTML, RPC, or chat content.
self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data?.json() || {}; } catch { /* show generic notification */ }
  event.waitUntil(self.registration.showNotification(payload.title || 'Smart ZCode', {
    body: payload.body || 'ZCode に更新があります。',
    icon: '/_smart/icon-192.png?v=3', badge: '/_smart/icon-192.png?v=3',
    tag: payload.tag || 'smart-zcode', requireInteraction: true,
    data: { url: '/', taskId: payload.taskId },
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => new URL(client.url).origin === self.location.origin);
    if (existing) { await existing.focus(); return; }
    await self.clients.openWindow('/');
  })());
});
