/* Skyview — service worker.
   App-shell model: every file of the app is cached together under one version name, so the page can never run
   with half-old, half-new files. To ship an update, change VERSION (and the list below if files were added).
   Weather, geocoding and photo requests are cross-origin and are never touched here.
   This file keeps its name (sw.js) on purpose: the previous app (Nimbus) registered the same path, so browsers that have it
   find this version there, install it beside the old one and offer the update. */
const VERSION = '1.0.0';
const CACHE = `skyview-shell-${VERSION}`;

const PRECACHE = [
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/boot.js',
  'js/app.js',
  'js/util.js',
  'js/store.js',
  'js/api.js',
  'js/i18n.js',
  'js/lang/fa.js',
  'js/lang/en.js',
  'js/insights.js',
  'js/icons.js',
  'js/charts.js',
  'js/fx.js',
  'js/ui.js',
  'js/places.js',
  'js/photos.js',
  'data/cities.js',
  'fonts/Vazirmatn-Variable.woff2',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png',
];

const INDEX = new URL('index.html', self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await Promise.all(
        PRECACHE.map(async (path) => {
          // `reload` skips the HTTP cache so a new version is never assembled from stale files
          const res = await fetch(new Request(new URL(path, self.registration.scope), { cache: 'reload' }));
          if (!res.ok) throw new Error(`precache failed: ${path} (${res.status})`);
          await cache.put(path, res);
        }),
      );
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        // the previous generation (nimbus-shell-*) and older Skyview versions go; nothing else is touched
        if ((key.startsWith('nimbus-') || key.startsWith('skyview-')) && key !== CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Page loads are answered with the cached shell, even offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cached = await caches.match(INDEX, { cacheName: CACHE });
        if (cached) return cached;
        try {
          return await fetch(request);
        } catch {
          return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(request, { cacheName: CACHE });
      if (cached) return cached;
      try {
        return await fetch(request);
      } catch {
        return Response.error();
      }
    })(),
  );
});
