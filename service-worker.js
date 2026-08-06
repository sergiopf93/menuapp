/**
 * MenuApp Service Worker
 * Gestiona la caché offline y las notificaciones programadas.
 * @version 1.0
 */

const CACHE_NAME = 'menuapp-v1';

/** Archivos estáticos que siempre deben estar disponibles offline */
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/main.css',
  '/js/utils/storage.js',
  '/js/utils/dates.js',
  '/js/utils/ui.js',
  '/js/auth.js',
  '/js/drive.js',
  '/js/sync.js',
  '/js/modules/inventario.js',
  '/js/modules/platos.js',
  '/js/modules/menu.js',
  '/js/modules/compra.js',
  '/js/modules/historial.js',
  '/js/modules/configuracion.js',
  '/js/app.js',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png',
];

// ─── Instalación: precarga todos los assets estáticos ───────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Precargando assets estáticos');
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// ─── Activación: elimina cachés antiguas ────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => {
            console.log('[SW] Eliminando caché antigua:', key);
            return caches.delete(key);
          })
      )
    )
  );
  self.clients.claim();
});

// ─── Intercepción de fetch: Cache First para assets, Network First para API ─
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Las llamadas a Google APIs siempre van a red
  if (url.hostname.includes('googleapis.com') || url.hostname.includes('google.com')) {
    return; // deja pasar sin interceptar
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        // Solo cachea respuestas válidas de nuestro propio origen
        if (
          response.ok &&
          response.type === 'basic' &&
          event.request.method === 'GET'
        ) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
        }
        return response;
      });
    })
  );
});

// ─── Notificaciones programadas ─────────────────────────────────────────────
/**
 * Comprueba las notificaciones pendientes almacenadas en IndexedDB.
 * Se ejecuta diariamente a las 8:00 desde el cliente mediante postMessage.
 */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CHECK_NOTIFICATIONS') {
    checkPendingNotifications(event.data.notifications || []);
  }
});

/**
 * @param {Array} notifications - Lista de notificaciones con { title, body, scheduledAt }
 */
function checkPendingNotifications(notifications) {
  const now = new Date();
  notifications.forEach((notif) => {
    const scheduledAt = new Date(notif.scheduledAt);
    const diffHours = (scheduledAt - now) / (1000 * 60 * 60);

    // Muestra notificaciones que deberían haberse mostrado hoy (±2 horas de margen)
    if (diffHours >= -2 && diffHours <= 0.5) {
      self.registration.showNotification(notif.title, {
        body: notif.body,
        icon: '/assets/icons/icon-192.png',
        badge: '/assets/icons/icon-192.png',
        tag: notif.id,
        data: { url: '/' },
        vibrate: [200, 100, 200],
      });
    }
  });
}

// ─── Click en notificación: abre la app ─────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === '/' && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});
