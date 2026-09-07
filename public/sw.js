const CACHE_NAME = 'ginote-v4';

function appUrl(path) {
  return new URL(path, self.registration.scope).href;
}

function fetchAndCache(request) {
  const fetched = fetch(request);
  const cacheUpdate = fetched.then((response) => {
    if (!response.ok) return;
    const copy = response.clone();
    return caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
  });

  return { fetched, cacheUpdate };
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
    const { fetched, cacheUpdate } = fetchAndCache(request);
    event.waitUntil(cacheUpdate.catch(() => {}));
    event.respondWith(
      fetched
        .catch(async () => (
          await caches.match(request)
          || await caches.match(appUrl('./index.html'))
          || await caches.match(appUrl('./'))
        ))
    );
    return;
  }

  const { fetched, cacheUpdate } = fetchAndCache(request);
  event.waitUntil(cacheUpdate.catch(() => {}));
  event.respondWith(
    caches.match(request).then((cached) => cached || fetched)
  );
});
