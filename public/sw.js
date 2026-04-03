// public/sw.js
import { WispClient } from 'https://cdn.jsdelivr.net/npm/@mercuryworkshop/wisp-js@1.1.0/dist/index.mjs';

const config = {
  prefix: '/nexus/',
  wispUrl: (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/wisp/',
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

let wisp = new WispClient(config.wispUrl);

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Skip if it's a request to the proxy's own assets or internal API
  const internalApis = ['/api/status', '/api/suggestions', '/api/cookies'];
  if (internalApis.includes(url.pathname) || 
      url.pathname === '/sw.js' || 
      url.pathname === '/nexus-client.js' || 
      url.pathname === '/' ||
      url.pathname.startsWith('/@vite') ||
      url.pathname.startsWith('/src/') ||
      url.pathname.startsWith('/node_modules/')) {
    return;
  }

  // If the request is already proxied via the server, we can try to hijack it for efficiency
  if (url.pathname.startsWith(config.prefix)) {
    const encodedTarget = url.pathname.split(config.prefix)[1];
    const targetUrl = config.decodeUrl(encodedTarget);
    
    if (targetUrl && targetUrl.startsWith('http')) {
      event.respondWith(
        (async () => {
          try {
            // Use Wisp for efficiency if it's not a main document request
            if (event.request.destination !== 'document') {
              const headers = new Headers(event.request.headers);
              const targetURL = new URL(targetUrl);
              
              // Sanitize headers for the target
              headers.set('Host', targetURL.host);
              if (headers.has('Origin')) headers.set('Origin', targetURL.origin);
              if (headers.has('Referer')) headers.set('Referer', targetURL.origin);

              const response = await wisp.fetch(targetUrl, {
                method: event.request.method,
                headers: headers,
                body: event.request.method !== 'GET' && event.request.method !== 'HEAD' ? await event.request.blob() : undefined,
                redirect: 'follow'
              });
              
              // Forward headers correctly
              const newHeaders = new Headers(response.headers);
              newHeaders.delete('content-security-policy');
              newHeaders.delete('x-frame-options');
              newHeaders.delete('strict-transport-security');
              
              return new Response(response.body, {
                status: response.status,
                statusText: response.statusText,
                headers: newHeaders
              });
            }
          } catch (e) {
            console.warn('Wisp fetch failed, falling back to server proxy:', e);
          }
          return fetch(event.request);
        })()
      );
      return;
    }
  }

  // Intercept requests from proxied pages that aren't already prefixed
  // This is the core "Scramjet-like" interception
  event.respondWith(
    (async () => {
      const client = await self.clients.get(event.clientId);
      if (client && client.url.includes(config.prefix)) {
        try {
          const clientUrl = new URL(client.url);
          const encodedTarget = clientUrl.pathname.split(config.prefix)[1];
          const targetBase = new URL(config.decodeUrl(encodedTarget));
          
          const absoluteTarget = new URL(event.request.url, targetBase).href;
          const targetURL = new URL(absoluteTarget);
          
          // Use Wisp directly for subresources
          try {
            const headers = new Headers(event.request.headers);
            headers.set('Host', targetURL.host);
            if (headers.has('Origin')) headers.set('Origin', targetURL.origin);
            if (headers.has('Referer')) headers.set('Referer', targetURL.origin);

            const response = await wisp.fetch(absoluteTarget, {
              method: event.request.method,
              headers: headers,
              body: event.request.method !== 'GET' && event.request.method !== 'HEAD' ? await event.request.blob() : undefined,
              redirect: 'follow'
            });
            
            const newHeaders = new Headers(response.headers);
            newHeaders.delete('content-security-policy');
            newHeaders.delete('x-frame-options');
            newHeaders.delete('strict-transport-security');
            
            return new Response(response.body, {
              status: response.status,
              statusText: response.statusText,
              headers: newHeaders
            });
          } catch (e) {
            // Fallback to server proxy
            const proxiedUrl = config.prefix + config.encodeUrl(absoluteTarget);
            return fetch(proxiedUrl);
          }
        } catch (e) {
          console.error('Nexus SW Error:', e);
        }
      }
      
      return fetch(event.request);
    })()
  );
});
