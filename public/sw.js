// public/sw.js
import { BareMuxConnection } from 'https://cdn.jsdelivr.net/npm/@mercuryworkshop/bare-mux@1.1.0/dist/index.mjs';

const config = {
  prefix: '/nexus/',
  bareUrl: '/bare/',
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

const connection = new BareMuxConnection('/baremux/');
let proxyReady = false;

async function initProxy() {
  try {
    // Switch to scramjet for better YouTube and dynamic site support
    await connection.setTransport('https://cdn.jsdelivr.net/npm/@mercuryworkshop/scramjet@1.0.0/dist/index.mjs', [{ wisp: config.wispUrl }]);
    proxyReady = true;
    console.log('Nexus: Scramjet transport initialized');
  } catch (e) {
    console.error('Nexus: Failed to initialize scramjet transport, falling back to epoxy:', e);
    try {
      await connection.setTransport('https://cdn.jsdelivr.net/npm/@mercuryworkshop/epoxy-tls@1.1.0/dist/index.mjs', [{ wisp: config.wispUrl }]);
      proxyReady = true;
      console.log('Nexus: Epoxy transport initialized (fallback)');
    } catch (e2) {
      console.error('Nexus: All transports failed:', e2);
    }
  }
}

initProxy();

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Skip if it's a request to the proxy's own assets or internal API
  const internalApis = ['/api/status', '/api/suggestions', '/api/config', '/api/cookies', '/baremux/worker.js'];
  if (internalApis.includes(url.pathname) || 
      url.pathname === '/sw.js' || 
      url.pathname === '/nexus-client.js' || 
      url.pathname === '/' ||
      url.pathname.startsWith('/@vite') ||
      url.pathname.startsWith('/src/') ||
      url.pathname.startsWith('/node_modules/')) {
    return;
  }

  // If the request is already proxied via the server
  if (url.pathname.startsWith(config.prefix)) {
    const encodedTarget = url.pathname.split(config.prefix)[1];
    const targetUrl = config.decodeUrl(encodedTarget);
    
    if (targetUrl && targetUrl.startsWith('http')) {
      event.respondWith(
        (async () => {
          if (!proxyReady) await initProxy();
          try {
            // For subresources, we can try to use the connection for efficiency
            if (event.request.destination !== 'document') {
              const response = await connection.fetch(targetUrl, {
                method: event.request.method,
                headers: event.request.headers,
                body: event.request.method !== 'GET' && event.request.method !== 'HEAD' ? await event.request.blob() : undefined,
                redirect: 'follow'
              });
              
              const newHeaders = new Headers(response.headers);
              newHeaders.delete('content-security-policy');
              newHeaders.delete('x-frame-options');
              newHeaders.delete('strict-transport-security');
              
              // Handle cookies in SW
              if (response.headers.has('set-cookie')) {
                const setCookies = response.headers.get('set-cookie');
                const rewrittenCookies = setCookies.split(',').map(cookie => {
                  return cookie
                    .replace(/Domain=[^;]+;?/gi, '')
                    .replace(/Secure;?/gi, '')
                    .replace(/SameSite=[^;]+;?/gi, 'SameSite=Lax');
                });
                newHeaders.set('Set-Cookie', rewrittenCookies.join(', '));
              }
              
              return new Response(response.body, {
                status: response.status,
                statusText: response.statusText,
                headers: newHeaders
              });
            }
          } catch (e) {
            console.warn('Bare-mux fetch failed, falling back to server proxy:', e);
          }
          return fetch(event.request);
        })()
      );
      return;
    }
  }

  // Intercept requests from proxied pages that aren't already prefixed
  event.respondWith(
    (async () => {
      if (!proxyReady) await initProxy();
      
      let client = await self.clients.get(event.clientId);
      
      // Fallback for requests without clientId (e.g. some subresources)
      if (!client && event.request.referrer) {
        const referrerUrl = new URL(event.request.referrer);
        if (referrerUrl.pathname.startsWith(config.prefix)) {
          const encodedTarget = referrerUrl.pathname.split(config.prefix)[1];
          const targetBase = new URL(config.decodeUrl(encodedTarget));
          const absoluteTarget = new URL(event.request.url, targetBase).href;
          
          try {
            const response = await connection.fetch(absoluteTarget, {
              method: event.request.method,
              headers: event.request.headers,
              body: event.request.method !== 'GET' && event.request.method !== 'HEAD' ? await event.request.blob() : undefined,
              redirect: 'follow'
            });
            
            const newHeaders = new Headers(response.headers);
            newHeaders.delete('content-security-policy');
            newHeaders.delete('x-frame-options');
            newHeaders.delete('strict-transport-security');
            
            // Handle cookies in SW
            if (response.headers.has('set-cookie')) {
              const setCookies = response.headers.get('set-cookie');
              const rewrittenCookies = setCookies.split(',').map(cookie => {
                return cookie
                  .replace(/Domain=[^;]+;?/gi, '')
                  .replace(/Secure;?/gi, '')
                  .replace(/SameSite=[^;]+;?/gi, 'SameSite=Lax');
              });
              newHeaders.set('Set-Cookie', rewrittenCookies.join(', '));
            }
            
            return new Response(response.body, {
              status: response.status,
              statusText: response.statusText,
              headers: newHeaders
            });
          } catch (e) {
            const proxiedUrl = config.prefix + config.encodeUrl(absoluteTarget);
            return fetch(proxiedUrl);
          }
        }
      }

      if (client && client.url.includes(config.prefix)) {
        try {
          const clientUrl = new URL(client.url);
          const encodedTarget = clientUrl.pathname.split(config.prefix)[1];
          const targetBase = new URL(config.decodeUrl(encodedTarget));
          
          const absoluteTarget = new URL(event.request.url, targetBase).href;
          
          // Use Bare-mux directly for subresources
          try {
            const response = await connection.fetch(absoluteTarget, {
              method: event.request.method,
              headers: event.request.headers,
              body: event.request.method !== 'GET' && event.request.method !== 'HEAD' ? await event.request.blob() : undefined,
              redirect: 'follow'
            });
            
            const newHeaders = new Headers(response.headers);
            newHeaders.delete('content-security-policy');
            newHeaders.delete('x-frame-options');
            newHeaders.delete('strict-transport-security');
            
            // Handle cookies in SW
            if (response.headers.has('set-cookie')) {
              const setCookies = response.headers.get('set-cookie');
              const rewrittenCookies = setCookies.split(',').map(cookie => {
                return cookie
                  .replace(/Domain=[^;]+;?/gi, '')
                  .replace(/Secure;?/gi, '')
                  .replace(/SameSite=[^;]+;?/gi, 'SameSite=Lax');
              });
              newHeaders.set('Set-Cookie', rewrittenCookies.join(', '));
            }
            
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
