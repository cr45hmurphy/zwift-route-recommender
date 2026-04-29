const CACHE_NAME = 'zwiftbuckets-v2';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/assets/favicon.svg',
  '/assets/style.css',
  '/app/app.js',
  '/app/core/portal.js',
  '/app/core/profile.js',
  '/app/core/routes.js',
  '/app/core/scorer.js',
  '/app/core/segments.js',
  '/app/core/timelines.js',
  '/app/core/ui.js',
  '/app/core/xert.js',
  '/app/data/mock-data.js',
  '/app/data/route-timelines-data.js',
  '/app/data/routes-data.js',
  '/app/data/segments-data.js',
  '/app/data/zwift-metadata.js',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Never intercept Xert API calls — always needs a live auth token
  if (url.hostname === 'www.xertonline.com') return;

  // CDN resources: network-first, fall back to cache
  if (url.hostname !== self.location.hostname && url.hostname !== 'localhost') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // App shell and static assets: network-first, fall back to cache for offline
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
