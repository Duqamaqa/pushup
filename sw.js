// PWA SW v4: precache core, runtime SWR for Chart.js
// Checklist: lazy Chart.js, cache v4, SWR for CDN
const CACHE_NAME = 'app-cache-v7';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      const requests = ASSETS.map((url) =>
        url.startsWith('http') ? new Request(url, { mode: 'no-cors' }) : url
      );
      return cache.addAll(requests);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k))))
    ).then(() => self.clients.claim())
  );
});

// Cache-first, then update in background (stale-while-revalidate-ish)
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // only cache GET

  const url = new URL(req.url);
  // Runtime SWR cache for Chart.js CDN
  if (url.href.startsWith('https://cdn.jsdelivr.net/npm/chart.js')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(req);
        const network = fetch(req).then((resp) => {
          if (resp && resp.status === 200) cache.put(req, resp.clone());
          return resp;
        }).catch(() => undefined);
        return cached || network || fetch(req);
      })
    );
    return;
  }

  // Cache-first for same-origin assets, then update in background
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req)
        .then((networkResp) => {
          if (networkResp && networkResp.status === 200 && url.origin === self.location.origin) {
            const clone = networkResp.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return networkResp;
        })
        .catch(() => cached || Promise.reject('offline'));
      return cached || fetchPromise;
    })
  );
});
