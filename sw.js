/*
 * Minimaler Service Worker: macht Planfood installierbar (u. a. für das Teilen-Menü auf Android).
 * Er speichert bewusst nichts zwischen – jede Anfrage geht direkt ans Netz, damit Updates sofort ankommen.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
