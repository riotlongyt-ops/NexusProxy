import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import axios from "axios";
import cors from "cors";
import http from "http";
import cookieParser from "cookie-parser";
import { CookieJar } from "tough-cookie";
import { createBareServer } from "@tomphttp/bare-server-node";
import * as cheerio from "cheerio";
import { v4 as uuidv4 } from "uuid";

// In-memory cookie jars indexed by session ID
const cookieJars: Record<string, CookieJar> = {};

async function startServer() {
  const app = express();
  const bare = createBareServer("/bare/");
  const PORT = 3000;

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
          const origin = new URL(currentTargetUrl).origin;
          
          function proxyUrl(url) {
            if (!url || typeof url !== 'string') return url;
            if (url.startsWith('data:') || url.startsWith('javascript:') || url.startsWith('blob:') || url.includes(proxyBase)) return url;
            try {
              const absolute = new URL(url, window.location.href).href;
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
          Object.defineProperty(document, 'referrer', { get: () => origin });

          // Intercept document.cookie
          const cookieDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie') || 
                                 Object.getOwnPropertyDescriptor(HTMLDocument.prototype, 'cookie');
          if (cookieDescriptor && cookieDescriptor.configurable) {
            Object.defineProperty(document, 'cookie', {
              get: function() { return cookieDescriptor.get.call(document); },
              set: function(val) { return cookieDescriptor.set.call(document, val); }
            });
          }

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
            if (action && !action.includes(proxyBase)) {
              form.action = proxyUrl(action);
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
            if (['script', 'img', 'iframe', 'link', 'source', 'video', 'audio'].includes(tag)) {
              const originalSetAttribute = el.setAttribute;
              el.setAttribute = function(name, value) {
                if (['src', 'href', 'action', 'data'].includes(name.toLowerCase())) {
                  value = proxyUrl(value);
                }
                return originalSetAttribute.call(this, name, value);
              };
              
              if (tag === 'script' || tag === 'img' || tag === 'iframe') {
                Object.defineProperty(el, 'src', {
                  get: function() { return el.getAttribute('src'); },
                  set: function(val) { el.setAttribute('src', val); }
                });
              }
              if (tag === 'link' || tag === 'a') {
                Object.defineProperty(el, 'href', {
                  get: function() { return el.getAttribute('href'); },
                  set: function(val) { el.setAttribute('href', val); }
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
  app.all("/api/proxy", async (req, res) => {
    const targetUrl = (req.query.url || req.body.url) as string;
    if (!targetUrl) {
      return res.status(400).send("URL is required");
    }

    const sessionId = req.cookies['SessionID'];
    if (!cookieJars[sessionId]) {
      cookieJars[sessionId] = new CookieJar();
    }
    const jar = cookieJars[sessionId];

    try {
      const url = new URL(targetUrl);
      const cookieString = await jar.getCookieString(targetUrl);

      const response = await axios({
        method: req.method,
        url: targetUrl,
        data: req.method !== 'GET' ? req.body : undefined,
        headers: {
          ...req.headers,
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
      });

      // Handle Redirects
      if (response.status >= 300 && response.status < 400 && response.headers.location) {
        const redirectUrl = new URL(response.headers.location, targetUrl).href;
        // Ensure the redirect itself is proxied
        return res.redirect(`/api/proxy?url=${encodeURIComponent(redirectUrl)}`);
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
      } else if (response.status >= 400 && !contentType.includes('javascript') && !contentType.includes('css')) {
        const isScriptRequest = targetUrl.endsWith('.js') || req.headers.accept?.includes('javascript');
        if (isScriptRequest) {
          res.set('Content-Type', 'application/javascript');
          return res.status(response.status).send(`/* Proxy Error: ${response.status} */`);
        }
      }

      res.status(response.status).send(data);
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
