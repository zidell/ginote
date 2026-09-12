const CACHE_NAME = 'ginote-v5';

function appUrl(path) {
  return new URL(path, self.registration.scope).href;
}

async function fetchAndCache(request) {
  const response = await fetch(request);

  if (response.ok) {
    try {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    } catch {
      // A cache write must never make a successful network response fail.
    }
  }

  return response;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll([
      appUrl('./'),
      appUrl('./index.html'),
      appUrl('./manifest.webmanifest'),
      appUrl('./icon.svg'),
      appUrl('./icon-192.png'),
      appUrl('./icon-512.png'),
      appUrl('./apple-touch-icon.png')
    ]))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetchAndCache(request)
        .catch(async () => (
          await caches.match(request)
          || await caches.match(appUrl('./index.html'))
          || await caches.match(appUrl('./'))
        ))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetchAndCache(request))
  );
});
