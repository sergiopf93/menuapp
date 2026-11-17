// MenuApp Service Worker
const CACHE = 'menuapp-v2';
const APP_URL = new URL('./', self.location.href);
const OFFLINE_URLS = [
  './', 'index.html', 'manifest.json',
  'assets/icons/icon.svg', 'assets/icons/icon-192.png', 'assets/icons/icon-512.png',
  'css/main.css', 'css/components/menu.css', 'css/components/compra.css',
  'css/components/inventario.css', 'css/components/platos.css', 'css/components/configuracion.css',
  'js/utils/storage.js', 'js/utils/dates.js', 'js/utils/ui.js',
  'js/auth-config.js', 'js/auth.js', 'js/drive.js', 'js/sync.js', 'js/app.js',
  'js/modules/notificaciones.js', 'js/modules/articulos.js', 'js/modules/inventario.js',
  'js/modules/platos.js', 'js/modules/menu.js', 'js/modules/compra.js',
  'js/modules/historial.js', 'js/modules/configuracion.js', 'data/supermercados.json',
].map(path => new URL(path, APP_URL).href);

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(OFFLINE_URLS)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('menuapp-') && key !== CACHE)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.pathname.startsWith('/auth/')) return;
  if (request.method !== 'GET' || url.origin !== APP_URL.origin ||
      !url.pathname.startsWith(APP_URL.pathname)) return;

  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response.ok) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE).then(cache => cache.put(request, copy))
          .catch(err => console.warn('[SW] No se pudo actualizar la caché:', err.message)));
      }
      return response;
    } catch {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      if (request.mode === 'navigate') {
        const index = await cache.match(new URL('index.html', APP_URL).href);
        if (index) return index;
      }
      return new Response('Recurso no disponible sin conexión.', {
        status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
  })());
});
