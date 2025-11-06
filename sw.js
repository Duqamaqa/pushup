// PWA SW: precache core, runtime SWR for Chart.js
// Checklist: lazy Chart.js, cache v8, SWR for CDN
const CACHE_NAME = 'app-cache-v44';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Do not include any versioned commit files in precache
    const requests = ASSETS.map((url) =>
      url.startsWith('http') ? new Request(url, { mode: 'no-cors' }) : url
    );
    await cache.addAll(requests);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    for (const c of clients) {
      try { c.postMessage({ type: 'sw-updated' }); } catch {}
    }
  })());
});

// Cache-first, then update in background (stale-while-revalidate-ish)
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // only cache GET

  const url = new URL(req.url);
  // Always bypass cache for version.json so About stays current
  if (url.pathname.endsWith('/version.json') || url.pathname === '/version.json') {
    event.respondWith(fetch(event.request, { cache: 'no-store' }));
    return;
  }
  // Always bypass cache for commit files (versioned or fallback)
  if (/commit(\.[0-9a-f]+)?\.js$/.test(url.pathname)) {
    event.respondWith(fetch(event.request, { cache: 'no-store' }));
    return;
  }
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
