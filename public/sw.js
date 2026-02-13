/* Difficulty Adjustment PWA Service Worker */

const VERSION = 'pwa-v1';

// App shell (keep small; avoid caching huge HTML blobs that change often)
const SHELL = [
  '/',
  '/style.css',
  '/shared.css',
  '/app.js',
  '/manifest.webmanifest',
  '/icon.svg'
];

// API endpoints we want to be resilient. We'll do stale-while-revalidate.
const API_CACHE = 'api-' + VERSION;
const SHELL_CACHE = 'shell-' + VERSION;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => {
      if (k !== SHELL_CACHE && k !== API_CACHE) return caches.delete(k);
    }));
    await self.clients.claim();
  })());
});

function isApiRequest(url) {
  return url.pathname.startsWith('/api/');
}

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle GET
  if (req.method !== 'GET') return;

  // Only same-origin
  if (!isSameOrigin(url)) return;

  // Stale-while-revalidate for API
  if (isApiRequest(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(API_CACHE);
      const cached = await cache.match(req);

      const fetchPromise = fetch(req).then((resp) => {
        // Cache successful JSON responses. Avoid caching obvious errors.
        if (resp && resp.ok) {
          cache.put(req, resp.clone());
        }
        return resp;
      }).catch(() => null);

      // If we have cached, return it immediately; update in background.
      if (cached) {
        event.waitUntil(fetchPromise);
        return cached;
      }

      // Otherwise, go network first; if it fails, show a minimal fallback.
      const net = await fetchPromise;
      if (net) return net;
      return new Response(JSON.stringify({ error: 'offline' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    })());
    return;
  }

  // Cache-first for shell assets
  if (SHELL.includes(url.pathname) || url.pathname.endsWith('.css') || url.pathname.endsWith('.js') || url.pathname.endsWith('.svg')) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
      const resp = await fetch(req);
      if (resp && resp.ok) cache.put(req, resp.clone());
      return resp;
    })());
    return;
  }

  // Default: network
});
