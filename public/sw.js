self.addEventListener('install', (event) => {
  self.skipWaiting();
});

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
      credentials: 'omit'
    })
  );
});
