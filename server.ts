import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import http from "http";
import https from "https";
import axios from "axios";
import { server as wisp } from "@mercuryworkshop/wisp-js/server";
import * as cheerio from "cheerio";
import zlib from "zlib";
import { nexusConfig } from "./src/nexusConfig.js";
import { NexusController } from "./src/nexusController.js";

async function startServer() {
  const app = express();
  const PORT = nexusConfig.port;

  const httpAgent = new http.Agent({ keepAlive: true });
  const httpsAgent = new https.Agent({ keepAlive: true, rejectUnauthorized: false });

  // Wisp server setup
  const server = http.createServer(app);
  server.on("upgrade", (req, socket, head) => {
    if (req.url?.startsWith(nexusConfig.wispPath)) {
      wisp.routeRequest(req, socket as any, head);
    } else {
      socket.end();
    }
  });

  // API routes
  app.get("/api/status", (req, res) => {
    res.json(NexusController.getStatus());
  });

  // Serve static assets directly at the top to avoid ANY redirects or Vite interference
  // This is critical for Service Worker registration
  app.get("/sw.js", (req, res) => {
    try {
      const swPath = path.resolve(process.cwd(), "public", "sw.js");
      const content = fs.readFileSync(swPath);
      res.setHeader("Content-Type", "application/javascript");
      res.setHeader("Service-Worker-Allowed", "/");
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.status(200).send(content);
    } catch (e) {
      console.error("Failed to serve sw.js:", e);
      res.status(404).send("Service Worker not found");
    }
  });

  app.get("/nexus-client.js", (req, res) => {
    try {
      const clientPath = path.resolve(process.cwd(), "public", "nexus-client.js");
      const content = fs.readFileSync(clientPath);
      res.setHeader("Content-Type", "application/javascript");
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.status(200).send(content);
    } catch (e) {
      console.error("Failed to serve nexus-client.js:", e);
      res.status(404).send("Client script not found");
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
    const targetUrl = nexusConfig.decodeUrl(encodedUrl);

    if (!targetUrl) return res.status(400).send("Invalid URL");

    try {
      const url = new URL(targetUrl);
      
      // Clean up headers to avoid conflicts
      const proxyHeaders: any = {};
      const skipHeaders = ['host', 'connection', 'content-length', 'accept-encoding', 'cookie', 'referer', 'origin', 'cf-ray', 'cf-connecting-ip', 'x-forwarded-for', 'x-forwarded-proto'];
      Object.entries(req.headers).forEach(([key, value]) => {
        if (!skipHeaders.includes(key.toLowerCase())) {
          proxyHeaders[key] = value;
        }
      });

      const response = await axios({
        method: req.method,
        url: targetUrl,
        data: req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined,
        headers: {
          ...proxyHeaders,
          host: url.host,
          referer: url.origin,
          origin: url.origin,
          'accept-encoding': 'gzip, deflate, br',
        },
        responseType: 'arraybuffer',
        decompress: false,
        maxRedirects: 0,
        validateStatus: () => true,
        httpAgent,
        httpsAgent,
      });

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
          return res.redirect(`${nexusConfig.prefix}${nexusConfig.encodeUrl(redirectUrl)}`);
        } catch (e) {
          return res.redirect(response.headers.location);
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

        // Optimized rewriting
        const rewriteUrl = (val: string) => {
          if (!val || val.startsWith('data:') || val.startsWith('javascript:') || val.startsWith('blob:') || val.startsWith(nexusConfig.prefix)) return val;
          try {
            const absolute = new URL(val, targetUrl).href;
            return `${nexusConfig.prefix}${nexusConfig.encodeUrl(absolute)}`;
          } catch (e) {
            return val;
          }
        };

        $('[href]').each((_, el) => { $(el).attr('href', rewriteUrl($(el).attr('href')!)); });
        $('[src]').each((_, el) => { $(el).attr('src', rewriteUrl($(el).attr('src')!)); });
        $('[action]').each((_, el) => { $(el).attr('action', rewriteUrl($(el).attr('action')!)); });

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
        'content-length'
      ];

      Object.entries(response.headers).forEach(([key, value]) => {
        if (!forbiddenHeaders.includes(key.toLowerCase())) {
          res.set(key, value as string);
        }
      });

      // Handle cookies
      const setCookies = response.headers['set-cookie'];
      if (setCookies) {
        res.set('x-nexus-set-cookie', JSON.stringify(setCookies));
      }

      // Ensure no sniff for JS
      if (contentType.includes('javascript')) {
        res.set('X-Content-Type-Options', 'nosniff');
      }

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
