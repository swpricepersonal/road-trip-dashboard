/* Service worker: cache the app shell so the dashboard opens instantly
   (and works with no signal) — live API calls always go to the network. */

const CACHE = 'rtd-v4';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/bus.js',
  './js/util.js',
  './js/settings.js',
  './js/gps.js',
  './js/trip.js',
  './js/store.js',
  './js/sim.js',
  './js/charts.js',
  './js/map.js',
  './js/weather.js',
  './js/planes.js',
  './js/sun.js',
  './js/milestones.js',
  './vendor/uplot/uPlot.iife.min.js',
  './vendor/uplot/uPlot.min.css',
  './vendor/leaflet/leaflet.js',
  './vendor/leaflet/leaflet.css',
  './vendor/suncalc/suncalc.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Same-origin shell files: network-first so a deploy is picked up on next
  // load, falling back to cache when offline. `cache: 'no-cache'` forces
  // revalidation with the server (GitHub Pages sends max-age=600, which
  // would otherwise let the browser serve a stale deploy for up to 10 min
  // even though we're asking the network first).
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(e.request, { cache: 'no-cache' })
        .then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
          return resp;
        })
        .catch(() => caches.match(e.request, { ignoreSearch: true }))
    );
  }
  // Cross-origin (APIs, map tiles): straight to network, no SW involvement.
});
