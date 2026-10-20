/* Sabbir Hub — service worker (optional enhancement; the site works without it).
 * Strategy:
 *   - Pre-cache the app shell (HTML, manifest, icons, offline page).
 *   - Page navigations: network first, then cached shell, then offline.html.
 *   - Same-origin static files: stale-while-revalidate.
 *   - Cross-origin requests (the Apps Script API, Drive images): NEVER touched here.
 *     The page keeps its own copy of the last project list in localStorage.
 * Bump CACHE_VERSION (v1 -> v2 …) whenever you change index.html, config.js or anything in assets/ so every
 * visitor gets the new files. Without a bump, returning visitors still get the update on their NEXT visit
 * (stale-while-revalidate), never a broken mix.
 */
const CACHE_VERSION = 'v1';
const CACHE_NAME = 'sabbir-hub-shell-' + CACHE_VERSION;
const SHELL = ['./', 'index.html', 'config.js', 'assets/hub.css', 'assets/hub.js', 'offline.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('sabbir-hub-shell-') && k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') { return; }
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) { return; }          // API + images: browser handles them

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put('index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('index.html').then((hit) => hit || caches.match('offline.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((hit) => {
      const network = fetch(req).then((res) => {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {}); }
        return res;
      }).catch(() => hit);
      return hit || network;
    })
  );
});
