const STATIC_CACHE = 'esw-static-v1';
const STATIC_PATHS = ['/logo_factura.jpg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_PATHS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || request.mode === 'navigate') return;
  if (url.pathname.startsWith('/_next/static/') || STATIC_PATHS.includes(url.pathname)) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      const copy = response.clone();
      caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
      return response;
    })));
  }
});
