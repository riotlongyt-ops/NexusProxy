import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import http from "http";
import https from "https";
import axios from "axios";
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import { server as wisp } from "@mercuryworkshop/wisp-js/server";
import { createBareServer } from "@tomphttp/bare-server-node";
import * as cheerio from "cheerio";
import zlib from "zlib";
import { nexusConfig } from "./src/nexusConfig.js";
import { NexusController } from "./src/nexusController.js";

// Setup axios with cookie support
const jar = new CookieJar();
const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true, rejectUnauthorized: false });

// Use raw axios to avoid agent conflicts with axios-cookiejar-support
const client = axios.create({ 
  httpAgent,
  httpsAgent
});

async function startServer() {
  const app = express();
  const PORT = nexusConfig.port;
  const bare = createBareServer("/bare/");

  // Serve static assets directly at the top to avoid ANY redirects or Vite interference
  // This is critical for Service Worker registration
  app.get('/sw.js', (req, res) => {
    const swPath = path.resolve(process.cwd(), 'public', 'sw.js');
    if (fs.existsSync(swPath)) {
      res.setHeader("Service-Worker-Allowed", "/");
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.setHeader("Content-Type", "application/javascript");
      res.sendFile(swPath);
    } else {
      res.status(404).send("Service Worker not found");
    }
  });

  app.get('/nexus-client.js', (req, res) => {
    const clientPath = path.resolve(process.cwd(), 'public', 'nexus-client.js');
    if (fs.existsSync(clientPath)) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.setHeader("Content-Type", "application/javascript");
      res.sendFile(clientPath);
    } else {
      res.status(404).send("Nexus client not found");
    }
  });

  app.use(express.static(path.join(process.cwd(), 'public')));

  // Wisp server setup
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
    } else if (req.url?.startsWith(nexusConfig.wispPath)) {
      wisp.routeRequest(req, socket as any, head);
    } else {
      socket.end();
    }
  });

  // API routes
  app.get("/api/status", (req, res) => {
    res.json(NexusController.getStatus());
  });

  app.get("/api/config", (req, res) => {
    res.json({
      prefix: nexusConfig.prefix,
      wispUrl: (req.protocol === 'https' ? 'wss://' : 'ws://') + req.get('host') + nexusConfig.wispPath,
      encodeUrl: nexusConfig.encodeUrl.toString(),
      decodeUrl: nexusConfig.decodeUrl.toString()
    });
  });

  // Serve Bare-Mux worker
  app.get("/baremux/worker.js", async (req, res) => {
    try {
      const response = await axios.get("https://cdn.jsdelivr.net/npm/@mercuryworkshop/bare-mux@1.1.0/dist/worker.js");
      res.set("Content-Type", "application/javascript");
      res.send(response.data);
    } catch (e) {
      res.status(500).send("Failed to fetch bare-mux worker");
    }
  });

  app.get("/api/suggestions", async (req, res) => {
    const query = req.query.q;
    if (!query) return res.json([]);

    try {
      const response = await axios.get(`https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(query as string)}`, {
        httpAgent,
        httpsAgent,
      });
      // Google returns [query, [suggestions]]
      res.json(response.data[1] || []);
    } catch (error) {
      res.json([]);
    }
  });

  // Proxy Route
  app.all(`${nexusConfig.prefix}*`, express.raw({ type: '*/*', limit: '50mb' }), async (req, res) => {
    const encodedUrl = req.path.split(nexusConfig.prefix)[1];
    let targetUrl = nexusConfig.decodeUrl(encodedUrl);

    if (!targetUrl) return res.status(400).send("Invalid URL");

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.set('Access-Control-Allow-Headers', '*');
      return res.status(204).end();
    }

    try {
      if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
        // If it looks like a domain, prepend https://
        if (targetUrl.includes('.') && !targetUrl.includes(' ')) {
          targetUrl = 'https://' + targetUrl;
        } else {
          // Otherwise it's probably a search query or malformed
          throw new Error(`Invalid URL format: ${targetUrl}`);
        }
      }
      
      const url = new URL(targetUrl);
      
      // Clean up headers to avoid conflicts
      const proxyHeaders: any = {};
      const skipHeaders = ['host', 'connection', 'content-length', 'accept-encoding', 'cf-ray', 'cf-connecting-ip', 'x-forwarded-for', 'x-forwarded-proto', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform'];
      
      Object.entries(req.headers).forEach(([key, value]) => {
        if (!skipHeaders.includes(key.toLowerCase())) {
          proxyHeaders[key] = value;
        }
      });

      // Handle cookies from custom header
      if (req.headers['x-nexus-cookies']) {
        const clientCookies = req.headers['x-nexus-cookies'] as string;
        clientCookies.split(';').forEach(cookie => {
          try {
            jar.setCookieSync(cookie.trim(), targetUrl);
          } catch (e) {}
        });
      }

      // Handle referer correctly
      if (req.headers['referer']) {
        try {
          const refUrl = new URL(req.headers['referer']);
          if (refUrl.pathname.startsWith(nexusConfig.prefix)) {
            const encodedRef = refUrl.pathname.split(nexusConfig.prefix)[1];
            proxyHeaders['referer'] = nexusConfig.decodeUrl(encodedRef);
          } else {
            proxyHeaders['referer'] = url.origin;
          }
        } catch (e) {
          proxyHeaders['referer'] = url.origin;
        }
      } else {
        proxyHeaders['referer'] = url.origin;
      }

      // Handle cookies manually since we removed axios-cookiejar-support wrapper
      const cookieString = jar.getCookieStringSync(targetUrl);
      
      const response = await client({
        method: req.method,
        url: targetUrl,
        data: req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined,
        headers: {
          ...proxyHeaders,
          host: url.host,
          origin: url.origin,
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'accept-encoding': 'gzip, deflate, br',
          'cookie': cookieString,
        },
        responseType: 'arraybuffer',
        decompress: false,
        maxRedirects: 0,
        validateStatus: () => true,
      });

      // Update cookie jar manually
      const setCookies = response.headers['set-cookie'];
      if (setCookies) {
        const cookies = Array.isArray(setCookies) ? setCookies : [setCookies];
        cookies.forEach(cookie => {
          try {
            jar.setCookieSync(cookie, targetUrl);
          } catch (e) {}
        });
      }

      // Handle decompression manually
      let data = Buffer.from(response.data);
      const contentEncoding = response.headers['content-encoding'];
      
      if (contentEncoding) {
        try {
          if (contentEncoding.includes('gzip')) {
            data = zlib.gunzipSync(data);
          } else if (contentEncoding.includes('deflate')) {
            try {
              data = zlib.inflateSync(data);
            } catch (e) {
              data = zlib.inflateRawSync(data);
            }
          } else if (contentEncoding.includes('br')) {
            data = zlib.brotliDecompressSync(data);
          }
        } catch (e: any) {
          console.warn(`Nexus: Decompression failed for ${targetUrl}: ${e.message}`);
        }
      }

      // Handle Redirects
      if (response.status >= 300 && response.status < 400 && response.headers.location) {
        try {
          const redirectUrl = new URL(response.headers.location, targetUrl).href;
          res.setHeader('Location', `${nexusConfig.prefix}${nexusConfig.encodeUrl(redirectUrl)}`);
          return res.status(response.status).end();
        } catch (e) {
          res.setHeader('Location', response.headers.location);
          return res.status(response.status).end();
        }
      }

      const contentType = response.headers['content-type'] || '';

      if (contentType.includes('text/html')) {
        const html = data.toString('utf-8');
        const $ = cheerio.load(html);

        // Inject emulator script and SW registration
        $('head').prepend(`
          <script src="/nexus-client.js"></script>
          <script>
            if ('serviceWorker' in navigator) {
              navigator.serviceWorker.register('/sw.js', { 
                scope: '${nexusConfig.prefix}',
                type: 'module'
              }).then(reg => {
                console.log('Nexus SW registered:', reg);
              });
            }
          </script>
        `);

        // Optimized rewriting for initial load
        const rewriteUrl = (val: string) => {
          if (!val || val.startsWith('data:') || val.startsWith('javascript:') || val.startsWith('blob:') || val.startsWith(nexusConfig.prefix)) return val;
          try {
            // Handle relative URLs
            const absolute = new URL(val, targetUrl).href;
            return `${nexusConfig.prefix}${nexusConfig.encodeUrl(absolute)}`;
          } catch (e) {
            return val;
          }
        };

        $('[href]').each((_, el) => { $(el).attr('href', rewriteUrl($(el).attr('href')!)); });
        $('[src]').each((_, el) => { $(el).attr('src', rewriteUrl($(el).attr('src')!)); });
        $('[action]').each((_, el) => { $(el).attr('action', rewriteUrl($(el).attr('action')!)); });
        $('[data-src]').each((_, el) => { $(el).attr('data-src', rewriteUrl($(el).attr('data-src')!)); });
        $('[data-href]').each((_, el) => { $(el).attr('data-href', rewriteUrl($(el).attr('data-href')!)); });

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
              return `${rewriteUrl(url)}${size ? ' ' + size : ''}`;
            }).join(', ');
            $(el).attr('srcset', rewritten);
          }
        });

        // Rewrite inline styles
        $('[style]').each((_, el) => {
          const style = $(el).attr('style') || '';
          const rewritten = style.replace(/url\(['"]?([^'"]+)['"]?\)/g, (match, url) => {
            return `url("${rewriteUrl(url)}")`;
          });
          $(el).attr('style', rewritten);
        });

        // Rewrite <style> tags
        $('style').each((_, el) => {
          let css = $(el).text();
          css = css.replace(/url\(['"]?([^'"]+)['"]?\)/g, (match, url) => {
            return `url("${rewriteUrl(url)}")`;
          });
          $(el).text(css);
        });

        // Rewrite <meta> tags for redirects
        $('meta[http-equiv="refresh"]').each((_, el) => {
          const content = $(el).attr('content');
          if (content) {
            const parts = content.split(';');
            if (parts.length > 1 && parts[1].trim().toLowerCase().startsWith('url=')) {
              const url = parts[1].trim().substring(4);
              $(el).attr('content', `${parts[0]}; url=${rewriteUrl(url)}`);
            }
          }
        });

        data = Buffer.from($.html(), 'utf-8');
      } else if (contentType.includes('text/css')) {
        const rewriteUrl = (val: string) => {
          if (!val || val.startsWith('data:') || val.startsWith('javascript:') || val.startsWith('blob:') || val.startsWith(nexusConfig.prefix)) return val;
          try {
            const absolute = new URL(val, targetUrl).href;
            return `${nexusConfig.prefix}${nexusConfig.encodeUrl(absolute)}`;
          } catch (e) {
            return val;
          }
        };
        let css = data.toString('utf-8');
        css = css.replace(/url\(['"]?([^'"]+)['"]?\)/g, (match, url) => {
          return `url("${rewriteUrl(url)}")`;
        });
        data = Buffer.from(css, 'utf-8');
      } else if (contentType.includes('application/javascript') || contentType.includes('text/javascript')) {
        let js = data.toString('utf-8');
        // Basic JS rewriting for location proxying
        js = js.replace(/window\.location/g, 'window.__nexus_location');
        js = js.replace(/document\.location/g, 'window.__nexus_location');
        // Only replace location. if it's not preceded by a dot (to avoid property access)
        js = js.replace(/(?<!\.)location\./g, 'window.__nexus_location.');
        data = Buffer.from(js, 'utf-8');
      }

      // Forward headers
      const forbiddenHeaders = [
        'content-encoding', 'transfer-encoding', 'content-security-policy', 
        'x-frame-options', 'location', 'set-cookie', 'strict-transport-security',
        'content-length', 'x-content-type-options'
      ];

      Object.entries(response.headers).forEach(([key, value]) => {
        if (!forbiddenHeaders.includes(key.toLowerCase())) {
          res.set(key, value as string);
        }
      });

      // Enable SharedArrayBuffer and cross-origin isolation for games
      res.set('Cross-Origin-Opener-Policy', 'same-origin');
      res.set('Cross-Origin-Embedder-Policy', 'require-corp');
      res.set('Cross-Origin-Resource-Policy', 'cross-origin');
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.set('Access-Control-Allow-Headers', '*');
      res.set('Access-Control-Expose-Headers', '*');
      res.set('Access-Control-Allow-Credentials', 'true');

      // Handle cookies
      const clientSetCookies = response.headers['set-cookie'];
      if (clientSetCookies) {
        const rewrittenCookies = (Array.isArray(clientSetCookies) ? clientSetCookies : [clientSetCookies]).map(cookie => {
          // Remove Domain and Secure attributes to allow them to work on local/dev domains
          return cookie
            .replace(/Domain=[^;]+;?/gi, '')
            .replace(/Secure;?/gi, '')
            .replace(/SameSite=[^;]+;?/gi, 'SameSite=Lax');
        });
        res.set('Set-Cookie', rewrittenCookies);
        res.set('x-nexus-set-cookie', JSON.stringify(clientSetCookies));
      }

      res.set('X-Nexus-Proxied', 'true');
      res.status(response.status).send(data);
    } catch (error: any) {
      console.error("Proxy Error:", error.message);
      res.status(500).send(`Proxy Error: ${error.message}`);
    }
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
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Nexus Server running on port ${PORT}`);
  });
}

startServer();
