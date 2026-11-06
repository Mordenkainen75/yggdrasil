// Lets the installed game open with no connection. Serves the saved copy
// straight away and refreshes that copy in the background.
const CACHE = 'wyrmhole-v1';

// Saves the whole game at install, so it works offline from the very first
// launch. Built files have generated names, so they're read from index.html.
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const html = await (await fetch('./', { cache: 'no-cache' })).text();
      const built = [...html.matchAll(/(?:\.\/)?assets\/[^"']+/g)].map((m) => m[0]);
      await cache.addAll(['./', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', ...built]);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || !event.request.url.startsWith(self.location.origin)) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      // ignoreVary: the page loads scripts with an Origin header that the saved
      // copies lack, and a strict match would miss them when offline.
      const saved = await cache.match(event.request, { ignoreVary: true, ignoreSearch: event.request.mode === 'navigate' })
        ?? (event.request.mode === 'navigate' ? await cache.match('./', { ignoreVary: true }) : undefined);
      const fresh = fetch(event.request)
        .then((response) => {
          if (response.ok) cache.put(event.request, response.clone());
          return response;
        })
        .catch(() => saved ?? Response.error());
      return saved ?? fresh;
    }),
  );
});
