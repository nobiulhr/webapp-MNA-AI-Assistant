const CACHE_NAME = 'mna-ai-assistant-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/index.tsx',
  '/App.tsx',
  '/types.ts',
  '/components/ActionItemsList.tsx',
  '/components/ChatInput.tsx',
  '/components/ChatMessage.tsx',
  '/components/ExportOptions.tsx',
  '/components/Icons.tsx',
  '/services/geminiService.ts',
  '/icon.svg',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
});

self.addEventListener('fetch', (event) => {
  const reqUrl = new URL(event.request.url);

  // Always go to the network for API calls and external scripts.
  // Let the browser handle caching for those.
  if (reqUrl.protocol !== 'https' || reqUrl.hostname.includes('googleapis.com') || reqUrl.hostname.includes('aistudiocdn.com') || reqUrl.hostname.includes('tailwindcss.com')) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Cache hit - return response
        if (response) {
          return response;
        }

        // Not in cache, go to network.
        return fetch(event.request).then(
          (response) => {
            // We only want to cache valid responses.
            if (!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }

            // Clone the response to cache it.
            const responseToCache = response.clone();
            caches.open(CACHE_NAME)
              .then((cache) => {
                cache.put(event.request, responseToCache);
              });

            return response;
          }
        );
      })
  );
});

self.addEventListener('activate', (event) => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});