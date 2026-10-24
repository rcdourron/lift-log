/* Lift Log service worker.
   Bump VERSION every time you change ANY file in this folder. That change is what
   makes the app show "New features available! [Tap to Update]" on your phone. */
const VERSION = '2026-10-24.5';
const CACHE = 'lift-log-' + VERSION;
const FONT_CACHE = 'lift-log-fonts';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './seed.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

// Download the new version in the background. It waits until you tap "Update".
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache =>
      cache.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' })))
    )
  );
});

// Tapping "Tap to Update" sends this message: switch to the new version now.
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// Once the new version takes over, delete every old cache, then take control
// of open screens (the page reloads itself when this happens).
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => k.startsWith('lift-log-') && k !== CACHE && k !== FONT_CACHE)
          .map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // App files: serve from the cache so the app opens with no signal.
  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate') {
      event.respondWith(
        caches.match('./index.html').then(hit => hit || fetch(req))
      );
      return;
    }
    event.respondWith(
      caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req))
    );
    return;
  }

  // Google Fonts: keep a copy for offline, refresh it when online.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith((async () => {
      const cache = await caches.open(FONT_CACHE);
      const hit = await cache.match(req);
      const net = fetch(req).then(res => {
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
        return res;
      }).catch(() => hit);
      return hit || net;
    })());
  }
});
