/*
 * Minimaler Service Worker: macht Planfood installierbar (u. a. für das Teilen-Menü auf Android).
 * Er speichert bewusst nichts zwischen – jede Anfrage geht direkt ans Netz, damit Updates sofort ankommen.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  // nur eigene Seiten durchreichen; fremde Anfragen (GitHub, Nährwert-Datenbanken) laufen normal
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(fetch(event.request));
});
