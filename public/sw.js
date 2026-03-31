self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Don't intercept requests to the proxy itself or the main app
  if (url.pathname.startsWith('/api/proxy') || url.origin === self.location.origin) {
    return;
  }

  // Intercept and proxy all other requests
  const proxiedUrl = `/api/proxy?url=${encodeURIComponent(event.request.url)}`;
  
  event.respondWith(
    fetch(proxiedUrl, {
      method: event.request.method,
      headers: event.request.headers,
      body: event.request.method !== 'GET' && event.request.method !== 'HEAD' ? event.request.blob() : undefined,
      mode: 'cors',
      credentials: 'include'
    }).catch(async (error) => {
      // If the fetch fails (e.g. offline), try to return the offline page
      const cache = await caches.open('nexus-offline');
      const cachedResponse = await cache.match('/offline.html');
      if (cachedResponse) return cachedResponse;
      
      // If not in cache, try to fetch it directly (might still fail if offline)
      return fetch('/offline.html').catch(() => {
        return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
      });
    })
  );
});

// Cache the offline page on install
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open('nexus-offline').then((cache) => {
      return cache.addAll(['/offline.html']);
    })
  );
  self.skipWaiting();
});
