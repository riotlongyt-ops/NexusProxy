// public/sw.js
const config = {
  prefix: '/nexus/',
  encodeUrl: (url) => {
    if (!url) return url;
    const xored = url.split('').map((char, i) => i % 2 ? String.fromCharCode(char.charCodeAt(0) ^ 2) : char).join('');
    return btoa(xored).replace(/\//g, '_').replace(/\+/g, '-').replace(/=/g, '');
  },
  decodeUrl: (url) => {
    if (!url) return url;
    try {
      let str = url.replace(/_/g, '/').replace(/-/g, '+');
      while (str.length % 4) str += '=';
      const decoded = atob(str);
      return decoded.split('').map((char, i) => i % 2 ? String.fromCharCode(char.charCodeAt(0) ^ 2) : char).join('');
    } catch (e) {
      return url;
    }
  }
};

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Skip if it's a request to the proxy's own assets or API
  if (url.pathname.startsWith('/api/') || url.pathname === '/sw.js' || url.pathname === '/nexus-client.js' || url.pathname === '/') {
    return;
  }

  // If the request is already proxied, let it through
  if (url.pathname.startsWith(config.prefix)) {
    return;
  }

  // Intercept requests from proxied pages
  event.respondWith(
    self.clients.get(event.clientId).then(client => {
      if (client && client.url.includes(config.prefix)) {
        try {
          const clientUrl = new URL(client.url);
          const encodedTarget = clientUrl.pathname.split(config.prefix)[1];
          const targetBase = new URL(config.decodeUrl(encodedTarget));
          
          const absoluteTarget = new URL(event.request.url, targetBase).href;
          const proxiedUrl = config.prefix + config.encodeUrl(absoluteTarget);
          
          return fetch(proxiedUrl, {
            method: event.request.method,
            headers: event.request.headers,
            body: event.request.method !== 'GET' && event.request.method !== 'HEAD' ? event.request.blob() : undefined,
            redirect: 'manual'
          });
        } catch (e) {
          console.error('Nexus SW Error:', e);
        }
      }
      
      return fetch(event.request);
    })
  );
});
