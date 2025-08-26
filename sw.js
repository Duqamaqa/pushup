// Simple cache-first service worker for Daily Exercise Counter
const CACHE_NAME = 'app-cache-v3';
const ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
  // Chart.js CDN for history charts
  'https://cdn.jsdelivr.net/npm/chart.js',
  // Icons (data URLs from manifest). Caching data URLs is harmless and ensures availability.
  "data:image/svg+xml;utf8,<?xml version='1.0' encoding='UTF-8'?>\n<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512'>\n  <defs>\n    <linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>\n      <stop offset='0%' stop-color='%232563eb'/>\n      <stop offset='100%' stop-color='%231e40af'/>\n    </linearGradient>\n  </defs>\n  <rect width='512' height='512' rx='96' fill='url(%23g)'/>\n  <g transform='translate(0,8)'>\n    <circle cx='256' cy='248' r='168' fill='white' fill-opacity='0.15'/>\n    <path d='M176 256l48 48 112-112' fill='none' stroke='white' stroke-width='40' stroke-linecap='round' stroke-linejoin='round'/>\n  </g>\n</svg>",
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

  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req)
        .then((networkResp) => {
          // Update cache for same-origin requests
          if (networkResp && networkResp.status === 200 && req.url.startsWith(self.location.origin)) {
            const clone = networkResp.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return networkResp;
        })
        .catch(() => cached || Promise.reject('offline'));
      // If cached, return it immediately; otherwise wait for network
      return cached || fetchPromise;
    })
  );
});
