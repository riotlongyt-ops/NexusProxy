import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import axios from "axios";
import cors from "cors";
import http from "http";
import https from "https";
import cookieParser from "cookie-parser";
import { CookieJar } from "tough-cookie";
import { createBareServer } from "@tomphttp/bare-server-node";
import * as cheerio from "cheerio";
import { v4 as uuidv4 } from "uuid";

// In-memory cookie jars indexed by session ID
const cookieJars: Record<string, CookieJar> = {};

// Simple in-memory cache for proxy requests
const proxyCache = new Map<string, { data: Buffer, headers: any, status: number, timestamp: number }>();
const CACHE_TTL = 1000 * 60 * 5; // 5 minutes

async function startServer() {
  const app = express();
  const bare = createBareServer("/bare/");
  const PORT = 3000;

  const httpAgent = new http.Agent({ keepAlive: true, timeout: 60000 });
  const httpsAgent = new https.Agent({ keepAlive: true, timeout: 60000, rejectUnauthorized: false });

  app.use(cors({
    origin: true,
    credentials: true
  }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  // Middleware to ensure a session ID exists
  app.use((req, res, next) => {
    if (!req.cookies['SessionID']) {
      const newSessionId = uuidv4();
      res.cookie('SessionID', newSessionId, { 
        httpOnly: true, 
        sameSite: 'none', 
        secure: true,
        path: '/',
        maxAge: 1000 * 60 * 60 * 24 * 7 // 1 week
      });
      // Also set it on the request object so the current request can use it
      req.cookies['SessionID'] = newSessionId;
    }
    next();
  });

  // Helper to rewrite URLs in HTML
  function rewriteContent(content: string, baseUrl: string, proxyUrlBase: string): string {
    const $ = cheerio.load(content);
    
    const rewriteAttr = (selector: string, attr: string) => {
      $(selector).each((_, el) => {
        const val = $(el).attr(attr);
        if (val && !val.startsWith('data:') && !val.startsWith('javascript:')) {
          try {
            const absolute = new URL(val, baseUrl).href;
            $(el).attr(attr, `${proxyUrlBase}?url=${encodeURIComponent(absolute)}`);
          } catch (e) {
            // Ignore invalid URLs
          }
        }
      });
    };

    const rewriteCSS = (css: string) => {
      return css.replace(/url\(['"]?([^'"]+)['"]?\)/g, (match, url) => {
        if (url.startsWith('data:') || url.startsWith('blob:')) return match;
        try {
          const absolute = new URL(url, baseUrl).href;
          return `url("${proxyUrlBase}?url=${encodeURIComponent(absolute)}")`;
        } catch (e) {
          return match;
        }
      });
    };

    rewriteAttr('a', 'href');
    rewriteAttr('img', 'src');
    rewriteAttr('script', 'src');
    rewriteAttr('link', 'href');
    rewriteAttr('form', 'action');
    rewriteAttr('iframe', 'src');
    rewriteAttr('source', 'src');
    rewriteAttr('video', 'src');
    rewriteAttr('audio', 'src');
    rewriteAttr('area', 'href');
    rewriteAttr('embed', 'src');
    rewriteAttr('track', 'src');
    rewriteAttr('object', 'data');
    rewriteAttr('base', 'href');

    // Handle srcset
    $('img[srcset], source[srcset]').each((_, el) => {
      const srcset = $(el).attr('srcset');
      if (srcset) {
        const rewritten = srcset.split(',').map(part => {
          const trimmed = part.trim();
          if (!trimmed) return part;
          const parts = trimmed.split(/\s+/);
          const url = parts[0];
          const size = parts.slice(1).join(' ');
          try {
            const absolute = new URL(url, baseUrl).href;
            return `${proxyUrlBase}?url=${encodeURIComponent(absolute)}${size ? ' ' + size : ''}`;
          } catch (e) {
            return part;
          }
        }).join(', ');
        $(el).attr('srcset', rewritten);
      }
    });

    // Rewrite inline styles
    $('[style]').each((_, el) => {
      const style = $(el).attr('style') || '';
      $(el).attr('style', rewriteCSS(style));
    });

    // Rewrite <style> tags
    $('style').each((_, el) => {
      const css = $(el).text();
      $(el).text(rewriteCSS(css));
    });

    // Inject a script to handle dynamic navigation, fetch, and XHR within the iframe
    $('head').prepend(`
      <script>
        (function() {
          const proxyBase = "${proxyUrlBase}";
          const currentTargetUrl = "${baseUrl}";
          const targetOrigin = new URL(currentTargetUrl).origin;
          const targetHostname = new URL(currentTargetUrl).hostname;
          
          function proxyUrl(url) {
            if (!url || typeof url !== 'string') return url;
            if (url.startsWith('data:') || url.startsWith('javascript:') || url.startsWith('blob:') || url.includes(proxyBase)) return url;
            try {
              const absolute = new URL(url, currentTargetUrl).href;
              return proxyBase + "?url=" + encodeURIComponent(absolute);
            } catch (e) {
              return url;
            }
          }

          // Intercept fetch
          const originalFetch = window.fetch;
          window.fetch = function(input, init) {
            if (typeof input === 'string') {
              input = proxyUrl(input);
            } else if (input instanceof Request) {
              const newRequest = new Request(proxyUrl(input.url), input);
              input = newRequest;
            }
            return originalFetch.call(this, input, init);
          };

          // Intercept XMLHttpRequest
          const originalOpen = XMLHttpRequest.prototype.open;
          XMLHttpRequest.prototype.open = function(method, url, ...args) {
            return originalOpen.call(this, method, proxyUrl(url), ...args);
          };

          // Intercept Web Workers
          const originalWorker = window.Worker;
          window.Worker = function(url, options) {
            return new originalWorker(proxyUrl(url), options);
          };

          // Intercept navigator.sendBeacon
          const originalSendBeacon = navigator.sendBeacon;
          navigator.sendBeacon = function(url, data) {
            return originalSendBeacon.call(navigator, proxyUrl(url), data);
          };

          // Intercept EventSource
          const originalEventSource = window.EventSource;
          window.EventSource = function(url, config) {
            return new originalEventSource(proxyUrl(url), config);
          };

          // Intercept WebSocket (Basic wrapper)
          const originalWebSocket = window.WebSocket;
          window.WebSocket = function(url, protocols) {
            // Note: Bare server handles WS better, but this is a fallback
            if (typeof url === 'string' && !url.includes(proxyBase)) {
               // We don't have a WS proxy endpoint here, but we could add one
            }
            return new originalWebSocket(url, protocols);
          };

          // Intercept localStorage and sessionStorage
          const storagePrefix = "__nexus_" + targetHostname + "_";
          const wrapStorage = (storage) => {
            const originalGetItem = storage.getItem;
            const originalSetItem = storage.setItem;
            const originalRemoveItem = storage.removeItem;
            const originalKey = storage.key;
            const originalClear = storage.clear;

            storage.getItem = function(key) { return originalGetItem.call(storage, storagePrefix + key); };
            storage.setItem = function(key, val) { return originalSetItem.call(storage, storagePrefix + key, val); };
            storage.removeItem = function(key) { return originalRemoveItem.call(storage, storagePrefix + key); };
            storage.clear = function() {
              const keys = [];
              for (let i = 0; i < storage.length; i++) {
                const k = originalKey.call(storage, i);
                if (k && k.startsWith(storagePrefix)) keys.push(k);
              }
              keys.forEach(k => originalRemoveItem.call(storage, k));
            };
          };
          wrapStorage(window.localStorage);
          wrapStorage(window.sessionStorage);

          // Intercept window.open
          const originalOpenWindow = window.open;
          window.open = function(url, target, features) {
            return originalOpenWindow.call(this, proxyUrl(url), target, features);
          };

          // Intercept location.replace and location.assign
          const originalReplace = window.location.replace;
          window.location.replace = function(url) {
            return originalReplace.call(window.location, proxyUrl(url));
          };
          const originalAssign = window.location.assign;
          window.location.assign = function(url) {
            return originalAssign.call(window.location, proxyUrl(url));
          };

          // Frame busting protection
          Object.defineProperty(window, 'top', { get: () => window });
          Object.defineProperty(window, 'parent', { get: () => window });
          Object.defineProperty(document, 'referrer', { get: () => targetOrigin });

          // Spoof location properties where possible
          const targetLocation = new URL(currentTargetUrl);
          try {
            Object.defineProperty(document, 'domain', { 
              get: () => targetLocation.hostname,
              set: (v) => v 
            });
          } catch (e) {}

          // Intercept clicks
          window.addEventListener('click', (e) => {
            const link = e.target.closest('a');
            if (link && link.href && !link.href.startsWith('javascript:')) {
              const href = link.getAttribute('href');
              if (href && !href.startsWith('#') && !href.includes(proxyBase)) {
                e.preventDefault();
                window.location.href = proxyUrl(href);
              }
            }
          }, true);

          // Intercept form submissions
          window.addEventListener('submit', (e) => {
            const form = e.target;
            const action = form.getAttribute('action');
            const method = (form.getAttribute('method') || 'GET').toUpperCase();
            
            if (action && !action.includes(proxyBase)) {
              const proxiedAction = proxyUrl(action);
              if (method === 'GET') {
                try {
                  const urlObj = new URL(proxiedAction, window.location.href);
                  const targetUrl = urlObj.searchParams.get('url');
                  if (targetUrl) {
                    const existing = form.querySelector('input[name="url"]');
                    if (existing) existing.remove();
                    
                    const hidden = document.createElement('input');
                    hidden.type = 'hidden';
                    hidden.name = 'url';
                    hidden.value = targetUrl;
                    form.appendChild(hidden);
                    form.action = proxyBase;
                    return;
                  }
                } catch (e) {}
              }
              form.action = proxiedAction;
            }
          }, true);

          // Notify parent of URL change
          if (window.parent !== window) {
            const urlParam = new URLSearchParams(window.location.search).get('url');
            window.parent.postMessage({ 
              type: 'PROXY_URL_CHANGE', 
              url: urlParam || window.location.href 
            }, '*');
          }

          // Handle dynamic element creation
          const originalCreateElement = document.createElement;
          document.createElement = function(tagName, options) {
            const el = originalCreateElement.call(this, tagName, options);
            const tag = tagName.toLowerCase();
            if (['script', 'img', 'iframe', 'link', 'source', 'video', 'audio', 'embed', 'object', 'area'].includes(tag)) {
              const originalSetAttribute = el.setAttribute;
              el.setAttribute = function(name, value) {
                const lowerName = name.toLowerCase();
                if (['src', 'href', 'action', 'data', 'srcset'].includes(lowerName)) {
                  if (lowerName === 'srcset') {
                    value = value.split(',').map(part => {
                      const trimmed = part.trim();
                      if (!trimmed) return part;
                      const parts = trimmed.split(/\\s+/);
                      return proxyUrl(parts[0]) + (parts[1] ? ' ' + parts[1] : '');
                    }).join(', ');
                  } else {
                    value = proxyUrl(value);
                  }
                }
                return originalSetAttribute.call(this, name, value);
              };
              
              const props = {
                'script': 'src', 'img': 'src', 'iframe': 'src', 'source': 'src', 'video': 'src', 'audio': 'src', 'embed': 'src',
                'link': 'href', 'a': 'href', 'area': 'href',
                'object': 'data'
              };
              if (props[tag]) {
                const prop = props[tag];
                Object.defineProperty(el, prop, {
                  get: function() { return el.getAttribute(prop); },
                  set: function(val) { el.setAttribute(prop, val); }
                });
              }
            }
            return el;
          };

        })();
      </script>
    `);

    return $.html();
  }

  // Enhanced Proxy Endpoint
  app.all("/api/proxy*", async (req, res) => {
    let targetUrl = (req.query.url || req.body.url) as string;
    
    // If URL is missing, try to infer it from the path or referer
    if (!targetUrl) {
      const fullPath = req.originalUrl.split('?')[0];
      const relativePath = fullPath.replace('/api/proxy', '');
      const referer = req.headers.referer;

      if (referer && referer.includes('/api/proxy')) {
        try {
          const refererUrl = new URL(referer);
          let baseTargetUrl = refererUrl.searchParams.get('url');
          if (baseTargetUrl) {
            const query = req.originalUrl.split('?')[1];
            // If the path is just the proxy endpoint, it means the 'url' param was lost
            // during a GET form submission. We should use the baseTargetUrl as the base.
            let targetPath = relativePath;
            if (relativePath === '/api/proxy' || relativePath === '/api/proxy/' || !relativePath) {
              targetPath = ''; 
            }
            targetUrl = new URL(targetPath + (query ? '?' + query : ''), baseTargetUrl).href;
            // If we inferred it, we don't need to redirect, just continue with the inferred targetUrl
          }
        } catch (e) {
          // Ignore
        }
      }
      
      if (!targetUrl) {
        return res.status(400).send("URL is required");
      }
    }

    const sessionId = req.cookies['SessionID'];
    if (!cookieJars[sessionId]) {
      cookieJars[sessionId] = new CookieJar();
    }
    const jar = cookieJars[sessionId];

    try {
      new URL(targetUrl);
    } catch (e) {
      return res.status(400).send("Invalid URL: " + targetUrl);
    }

    try {
      const url = new URL(targetUrl);
      const cacheKey = `${req.method}:${targetUrl}:${sessionId}`;
      
      // Check cache for GET requests
      if (req.method === 'GET') {
        const cached = proxyCache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
          Object.entries(cached.headers).forEach(([key, value]) => {
            res.set(key, value as string);
          });
          return res.status(cached.status).send(cached.data);
        }
      }

      const cookieString = await jar.getCookieString(targetUrl);

      const { host, origin, referer, ...otherHeaders } = req.headers;

      // Simple retry logic for network errors
      const makeRequest = async (retries = 2): Promise<any> => {
        try {
          return await axios({
            method: req.method,
            url: targetUrl,
            data: req.method !== 'GET' ? req.body : undefined,
            headers: {
              ...otherHeaders,
              host: url.host,
              cookie: cookieString,
              'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
              referer: url.origin,
              origin: url.origin,
              'accept-encoding': 'identity',
            },
            responseType: 'arraybuffer',
            maxRedirects: 0, // Handle redirects manually
            validateStatus: () => true,
            timeout: 30000, // 30 seconds timeout
            httpAgent,
            httpsAgent,
          });
        } catch (err: any) {
          const isNetworkError = ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENOTFOUND'].includes(err.code) || err.message?.includes('socket hang up');
          if (retries > 0 && isNetworkError) {
            console.log(`Retrying request to ${targetUrl} due to ${err.code || err.message}. Retries left: ${retries}`);
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s before retry
            return makeRequest(retries - 1);
          }
          throw err;
        }
      };

      const response = await makeRequest();

      // Handle Redirects
      if (response.status >= 300 && response.status < 400 && response.headers.location) {
        const redirectUrl = new URL(response.headers.location, targetUrl).href;
        const proxiedRedirect = `/api/proxy?url=${encodeURIComponent(redirectUrl)}`;
        
        // Forward the exact redirect status code
        res.set('Location', proxiedRedirect);
        return res.status(response.status).send();
      }

      // Handle Set-Cookie from the target response
      const setCookies = response.headers['set-cookie'];
      if (setCookies) {
        if (Array.isArray(setCookies)) {
          for (const cookie of setCookies) {
            await jar.setCookie(cookie, targetUrl);
          }
        } else {
          await jar.setCookie(setCookies, targetUrl);
        }
      }

      const contentType = response.headers['content-type'] || '';
      
      // Forward headers with better filtering
      const forbiddenHeaders = [
        'content-encoding', 'transfer-encoding', 'set-cookie', 
        'content-security-policy', 'x-frame-options', 'location',
        'host', 'connection', 'keep-alive', 'proxy-authenticate', 
        'proxy-authorization', 'te', 'trailers', 'upgrade',
        'cross-origin-resource-policy', 'cross-origin-opener-policy', 'cross-origin-embedder-policy',
        'strict-transport-security', 'x-content-type-options', 'x-xss-protection'
      ];

      Object.entries(response.headers).forEach(([key, value]) => {
        if (!forbiddenHeaders.includes(key.toLowerCase())) {
          res.set(key, value as string);
        }
      });

      // Add CORS headers to allow cross-origin requests from the iframe
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.set('Access-Control-Allow-Headers', '*');
      res.set('Access-Control-Expose-Headers', '*');
      res.set('Access-Control-Allow-Credentials', 'true');

      // Handle cookies from the response (redundant with above but ensuring it's robust)
      const setCookieHeader = response.headers['set-cookie'];
      if (setCookieHeader) {
        if (Array.isArray(setCookieHeader)) {
          await Promise.all(setCookieHeader.map(cookie => jar.setCookie(cookie, targetUrl)));
        } else {
          await jar.setCookie(setCookieHeader, targetUrl);
        }
      }

      let data = response.data;
      if (contentType.includes('text/html')) {
        const html = data.toString('utf-8');
        const rewritten = rewriteContent(html, targetUrl, '/api/proxy');
        data = Buffer.from(rewritten, 'utf-8');
      } else if (contentType.includes('text/css')) {
        let css = data.toString('utf-8');
        // Simple CSS rewrite for external files
        css = css.replace(/url\(['"]?([^'"]+)['"]?\)/g, (match, url) => {
          if (url.startsWith('data:') || url.startsWith('blob:')) return match;
          try {
            const absolute = new URL(url, targetUrl).href;
            return `url("/api/proxy?url=${encodeURIComponent(absolute)}")`;
          } catch (e) {
            return match;
          }
        });
        data = Buffer.from(css, 'utf-8');
      } else if (contentType.includes('javascript') || contentType.includes('application/x-javascript')) {
        let js = data.toString('utf-8');
        // Simple JS rewrite for absolute imports/exports and some common patterns
        // This is a bit aggressive but helps with ES6 modules
        js = js.replace(/(import|export)\s+.*?\s+from\s+['"]([^'"]+)['"]/g, (match, type, url) => {
          if (url.startsWith('http') || url.startsWith('//')) {
            try {
              const absolute = new URL(url, targetUrl).href;
              return match.replace(url, `/api/proxy?url=${encodeURIComponent(absolute)}`);
            } catch (e) {
              return match;
            }
          }
          return match;
        });
        // Handle dynamic imports
        js = js.replace(/import\(['"]([^'"]+)['"]\)/g, (match, url) => {
          try {
            const absolute = new URL(url, targetUrl).href;
            return `import("/api/proxy?url=${encodeURIComponent(absolute)}")`;
          } catch (e) {
            return match;
          }
        });
        data = Buffer.from(js, 'utf-8');
      } else if (response.status >= 400 && !contentType.includes('javascript') && !contentType.includes('css')) {
        const isScriptRequest = targetUrl.endsWith('.js') || req.headers.accept?.includes('javascript');
        if (isScriptRequest) {
          res.set('Content-Type', 'application/javascript');
          return res.status(response.status).send(`/* Proxy Error: ${response.status} */`);
        }
      }

      res.status(response.status).send(data);

      // Cache successful GET responses
      if (req.method === 'GET' && response.status === 200) {
        const cacheHeaders: Record<string, string> = {};
        Object.entries(response.headers).forEach(([key, value]) => {
          if (!forbiddenHeaders.includes(key.toLowerCase())) {
            cacheHeaders[key] = value as string;
          }
        });
        proxyCache.set(cacheKey, {
          data,
          headers: cacheHeaders,
          status: response.status,
          timestamp: Date.now()
        });
        
        // Cleanup old cache entries occasionally
        if (proxyCache.size > 1000) {
          const now = Date.now();
          for (const [key, val] of proxyCache.entries()) {
            if (now - val.timestamp > CACHE_TTL) proxyCache.delete(key);
          }
        }
      }
    } catch (error: any) {
      console.error("Proxy Error:", error.message);
      res.status(500).send(`
        <div style="font-family: sans-serif; padding: 2rem; background: #1a1a1a; color: #ff4444; border-radius: 1rem;">
          <h2 style="margin-top: 0;">Proxy Error</h2>
          <p>${error.message}</p>
          <button onclick="location.reload()" style="padding: 0.5rem 1rem; background: #444; color: white; border: none; border-radius: 0.5rem; cursor: pointer;">Retry</button>
        </div>
      `);
    }
  });

  // Endpoint to get cookies for the current session
  app.get("/api/cookies", async (req, res) => {
    const sessionId = req.cookies['SessionID'];
    if (!sessionId || !cookieJars[sessionId]) {
      return res.json([]);
    }
    const jar = cookieJars[sessionId];
    const cookies = await jar.getCookies("http://localhost"); // Get all cookies (simplified)
    // Actually, tough-cookie's getCookies requires a URL. 
    // To get ALL cookies, we might need to iterate or use a different method.
    // For this demo, we'll return a list of all cookies in the jar.
    const allCookies = await new Promise((resolve) => {
      (jar.store as any).getAllCookies((err: any, cookies: any) => {
        if (err) resolve([]);
        else resolve(cookies);
      });
    });
    res.json(allCookies);
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      if (req.path.startsWith('/api')) return;
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Create the HTTP server and handle routing manually to ensure Bare and Express coexist perfectly
  const server = http.createServer();

  server.on("request", (req, res) => {
    if (bare.shouldRoute(req)) {
      bare.routeRequest(req, res);
    } else {
      app(req, res);
    }
  });

  server.on("upgrade", (req, socket, head) => {
    if (bare.shouldRoute(req)) {
      bare.routeUpgrade(req, socket, head);
    } else {
      socket.end();
    }
  });

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Nexus Browser (Node.js) running at http://localhost:${PORT}`);
    console.log(`Bare Server active at /bare/`);
  });
}

startServer().catch(err => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
