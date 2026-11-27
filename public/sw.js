// Sellpert Service Worker
const CACHE_NAME = 'sellpert-v2';
const STATIC_CACHE = 'sellpert-static-v2';

// Cache static assets on install
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(['/', '/manifest.json']).catch(() => {});
    })
  );
  self.skipWaiting();
});

// Clean up old caches on activate
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME && k !== STATIC_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// Network-first for HTML/API, cache-first for static
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and cross-origin
  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  // Skip Supabase API calls
  if (url.hostname.includes('supabase')) return;

  // Static assets — cache first
  if (
    request.destination === 'image' ||
    request.destination === 'font' ||
    request.destination === 'style' ||
    request.destination === 'script' ||
    /\.(png|jpg|jpeg|svg|webp|woff2?|css|js)$/i.test(url.pathname)
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        return (
          cached ||
          fetch(request).then((res) => {
            // Never cache failed assets or an SPA HTML fallback as JavaScript/CSS.
            const type = res.headers.get('content-type') || '';
            const script = request.destination === 'script' || /\.js$/i.test(url.pathname);
            const style = request.destination === 'style' || /\.css$/i.test(url.pathname);
            if (res.ok && (!script || /(?:java|ecma)script/i.test(type)) && (!style || type.includes('text/css'))) {
              const clone = res.clone();
              event.waitUntil(caches.open(STATIC_CACHE).then((c) => c.put(request, clone)));
            }
            return res;
          })
        );
      })
    );
    return;
  }

  // HTML — network first, fall back to cache
  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok && res.headers.get('content-type')?.includes('text/html')) {
          const clone = res.clone();
          event.waitUntil(caches.open(CACHE_NAME).then((c) => c.put(request, clone)));
        }
        return res;
      })
      .catch(() => caches.match(request).then((c) => c || caches.match('/')))
  );
});

// Listen for skip-waiting messages
self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});
