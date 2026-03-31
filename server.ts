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
import wisp from "wisp-server-node";

// In-memory cookie jars indexed by session ID
const cookieJars: Record<string, CookieJar> = {};

// Simple in-memory cache for proxy requests
const proxyCache = new Map<string, { data: Buffer, headers: any, status: number, timestamp: number }>();
const CACHE_TTL = 1000 * 60 * 5; // 5 minutes

// XOR encoding/decoding for "random unique" URLs
const config = {
  prefix: '/nexus/',
  encodeUrl: (url: string) => {
    if (!url) return url;
    const xored = url.split('').map((char, i) => i % 2 ? String.fromCharCode(char.charCodeAt(0) ^ 2) : char).join('');
    return Buffer.from(xored).toString('base64').replace(/\//g, '_').replace(/\+/g, '-').replace(/=/g, '');
  },
  decodeUrl: (url: string) => {
    if (!url) return url;
    try {
      let str = url.replace(/_/g, '/').replace(/-/g, '+');
      while (str.length % 4) str += '=';
      const decoded = Buffer.from(str, 'base64').toString('utf-8');
      return decoded.split('').map((char, i) => i % 2 ? String.fromCharCode(char.charCodeAt(0) ^ 2) : char).join('');
    } catch (e) {
      return url;
    }
  }
};

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
            $(el).attr(attr, `${config.prefix}${config.encodeUrl(absolute)}`);
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
          return `url("${config.prefix}${config.encodeUrl(absolute)}")`;
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
    rewriteAttr('use', 'href');
    rewriteAttr('use', 'xlink:href');
    rewriteAttr('image', 'href');
    rewriteAttr('image', 'xlink:href');

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
            return `${config.prefix}${config.encodeUrl(absolute)}${size ? ' ' + size : ''}`;
          } catch (e) {
            return part;
          }
        }).join(', ');
        $(el).attr('srcset', rewritten);
      }
    });

    // Handle meta tags (refresh, og:image, etc.)
    $('meta[property="og:image"], meta[property="og:url"], meta[name="twitter:image"]').each((_, el) => {
      const content = $(el).attr('content');
      if (content && !content.startsWith('data:')) {
        try {
          const absolute = new URL(content, baseUrl).href;
          $(el).attr('content', `${config.prefix}${config.encodeUrl(absolute)}`);
        } catch (e) {}
      }
    });

    // Handle meta refresh
    $('meta[http-equiv="refresh"]').each((_, el) => {
      const content = $(el).attr('content');
      if (content) {
        const parts = content.split(';');
        if (parts.length > 1) {
          const urlPart = parts[1].trim();
          if (urlPart.toLowerCase().startsWith('url=')) {
            const url = urlPart.slice(4);
            try {
              const absolute = new URL(url, baseUrl).href;
              $(el).attr('content', `${parts[0]}; url=${config.prefix}${config.encodeUrl(absolute)}`);
            } catch (e) {}
          }
        }
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

    // Rewrite <script> tags to shadow location and other globals
    $('script').each((_, el) => {
      const script = $(el).text();
      if (script && !$(el).attr('src')) {
        $(el).text(`
          (function() {
            const __nexus_original_location = window.location;
            const location = new Proxy(__nexus_original_location, {
              get(target, prop) {
                if (prop === 'href') return "${baseUrl}";
                if (prop === 'origin') return "${new URL(baseUrl).origin}";
                if (prop === 'host') return "${new URL(baseUrl).host}";
                if (prop === 'hostname') return "${new URL(baseUrl).hostname}";
                if (prop === 'assign' || prop === 'replace') return (url) => __nexus_original_location[prop](window.proxyUrl(url));
                return target[prop];
              },
              set(target, prop, value) {
                if (prop === 'href') __nexus_original_location.href = window.proxyUrl(value);
                else target[prop] = value;
                return true;
              }
            });
            try {
              ${script}
            } catch (e) {
              console.error("Nexus Script Error:", e);
            }
          })();
        `);
      }
    });

    // Inject the sliding navigation bar and interception script
    $('body').prepend(`
      <div id="__nexus_nav_trigger" style="position: fixed; top: 0; left: 0; width: 100%; height: 10px; z-index: 1000000; cursor: pointer;"></div>
      <div id="__nexus_nav_bar" style="position: fixed; top: 0; left: 0; width: 100%; height: 60px; background: #0a0a0a; border-bottom: 1px solid rgba(255,255,255,0.1); z-index: 1000001; transform: translateY(-100%); transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1); display: flex; align-items: center; padding: 0 20px; gap: 15px; font-family: sans-serif; color: white; box-shadow: 0 4px 20px rgba(0,0,0,0.5);">
        <div style="display: flex; align-items: center; gap: 10px;">
          <button onclick="window.location.href='/'" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: white; padding: 8px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center;" title="Home">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          </button>
          <button onclick="window.history.back()" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: white; padding: 8px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center;" title="Back">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
          </button>
        </div>
        <div style="flex: 1; display: flex; align-items: center; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; padding: 0 15px;">
          <input id="__nexus_url_input" type="text" value="${baseUrl}" style="width: 100%; background: transparent; border: none; color: white; font-size: 14px; outline: none; padding: 10px 0;" placeholder="Search or enter address">
        </div>
        <div style="display: flex; align-items: center; gap: 10px;">
          <button id="__nexus_add_shortcut" style="background: #2563eb; border: none; color: white; padding: 8px 15px; border-radius: 8px; cursor: pointer; font-size: 12px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px;" title="Add Shortcut">Add Shortcut</button>
          <button id="__nexus_view_cookies" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: white; padding: 8px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center;" title="Cookies">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5"/><path d="M8.5 8.5v.01"/><path d="M16 15.5v.01"/><path d="M12 12v.01"/><path d="M11 17v.01"/><path d="M7 13v.01"/></svg>
          </button>
          <button id="__nexus_view_settings" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: white; padding: 8px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center;" title="Settings">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
        </div>
      </div>
      <style>
        #__nexus_nav_trigger:hover + #__nexus_nav_bar, #__nexus_nav_bar:hover {
          transform: translateY(0) !important;
        }
      </style>
      <script>
        (function() {
          const navBar = document.getElementById('__nexus_nav_bar');
          const urlInput = document.getElementById('__nexus_url_input');
          const addShortcutBtn = document.getElementById('__nexus_add_shortcut');
          const viewCookiesBtn = document.getElementById('__nexus_view_cookies');
          const viewSettingsBtn = document.getElementById('__nexus_view_settings');

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

          urlInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
              let url = urlInput.value;
              if (!url.startsWith('http')) {
                if (url.includes('.') && !url.includes(' ')) url = 'https://' + url;
                else url = 'https://www.google.com/search?q=' + encodeURIComponent(url);
              }
              window.location.href = config.prefix + config.encodeUrl(url);
            }
          });

          addShortcutBtn.addEventListener('click', () => {
            const name = prompt('Shortcut Name:', document.title || 'New Shortcut');
            if (name) {
              const shortcuts = JSON.parse(localStorage.getItem('nexus_shortcuts') || '[]');
              shortcuts.push({ name, url: "${baseUrl}" });
              localStorage.setItem('nexus_shortcuts', JSON.stringify(shortcuts));
              alert('Shortcut added!');
            }
          });

          viewCookiesBtn.addEventListener('click', () => {
            window.location.href = '/?cookies=true';
          });

          viewSettingsBtn.addEventListener('click', () => {
            window.location.href = '/?settings=true';
          });

          // Interception logic
          window.proxyUrl = function(url) {
            if (!url || typeof url !== 'string') return url;
            if (url.startsWith('data:') || url.startsWith('javascript:') || url.startsWith('blob:') || url.includes(config.prefix)) return url;
            try {
              const absolute = new URL(url, "${baseUrl}").href;
              return config.prefix + config.encodeUrl(absolute);
            } catch (e) {
              return url;
            }
          }

          function proxyUrl(url) {
            return window.proxyUrl(url);
          }

          // Storage isolation
          try {
            const hostname = new URL("${baseUrl}").hostname;
            const storagePrefix = "__nexus_storage_" + hostname + "_";
            
            const wrapStorage = (storage, prefix) => {
              return {
                getItem: (key) => storage.getItem(prefix + key),
                setItem: (key, value) => storage.setItem(prefix + key, value),
                removeItem: (key) => storage.removeItem(prefix + key),
                clear: () => {
                  Object.keys(storage).forEach(key => {
                    if (key.startsWith(prefix)) storage.removeItem(key);
                  });
                },
                key: (index) => {
                  const keys = Object.keys(storage).filter(k => k.startsWith(prefix));
                  return keys[index] ? keys[index].slice(prefix.length) : null;
                },
                get length() {
                  return Object.keys(storage).filter(k => k.startsWith(prefix)).length;
                }
              };
            };

            // Attempt to override storage
            const originalLS = window.localStorage;
            const originalSS = window.sessionStorage;
            const nexusLS = wrapStorage(originalLS, storagePrefix);
            const nexusSS = wrapStorage(originalSS, storagePrefix);

            // We can't redefine window.localStorage directly in most browsers, 
            // but we can try to shadow it in the current scope or use a proxy.
            // For now, we'll just provide them as global variables that scripts might use.
            window.nexusLocalStorage = nexusLS;
            window.nexusSessionStorage = nexusSS;
          } catch (e) {
            console.error("Storage isolation error:", e);
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

          // Intercept clicks
          window.addEventListener('click', (e) => {
            const link = e.target.closest('a');
            if (link && link.href && !link.href.startsWith('javascript:')) {
              const href = link.getAttribute('href');
              if (href && !href.startsWith('#') && !href.includes(config.prefix)) {
                e.preventDefault();
                window.location.href = proxyUrl(href);
              }
            }
          }, true);

          // Intercept form submissions
          window.addEventListener('submit', (e) => {
            const form = e.target;
            const action = form.getAttribute('action');
            if (action && !action.includes(config.prefix)) {
              form.action = proxyUrl(action);
            }
          }, true);

          // Intercept location and navigation
          const originalLocation = window.location;
          const locationHandler = {
            get(target, prop) {
              if (prop === 'href') return config.decodeUrl(originalLocation.pathname.slice(config.prefix.length)) || originalLocation.href;
              if (prop === 'assign' || prop === 'replace') return (url) => originalLocation[prop](proxyUrl(url));
              return target[prop];
            },
            set(target, prop, value) {
              if (prop === 'href') originalLocation.href = proxyUrl(value);
              else target[prop] = value;
              return true;
            }
          };

          // We can't actually replace window.location, but we can try to shadow it for scripts
          // by wrapping the execution or using other tricks. For now, we'll focus on 
          // intercepting APIs that scripts use to navigate.

          // Intercept history
          const originalPushState = history.pushState;
          history.pushState = function(state, title, url) {
            return originalPushState.call(this, state, title, url ? proxyUrl(url) : url);
          };

          const originalReplaceState = history.replaceState;
          history.replaceState = function(state, title, url) {
            return originalReplaceState.call(this, state, title, url ? proxyUrl(url) : url);
          };

          // Intercept dynamic element creation
          const originalCreateElement = document.createElement;
          document.createElement = function(tagName, options) {
            const el = originalCreateElement.call(this, tagName, options);
            if (tagName.toLowerCase() === 'img' || tagName.toLowerCase() === 'script' || tagName.toLowerCase() === 'iframe') {
              const originalSetAttribute = el.setAttribute;
              el.setAttribute = function(name, value) {
                if ((name === 'src' || name === 'href') && value) {
                  value = proxyUrl(value);
                }
                return originalSetAttribute.call(this, name, value);
              };
              Object.defineProperty(el, 'src', {
                get() { return el.getAttribute('src'); },
                set(val) { el.setAttribute('src', val); }
              });
            }
            return el;
          };
        })();
      </script>
    `);

    return $.html();
  }

  // XOR encoded service route
  app.get("/nexus/:encodedUrl", async (req, res) => {
    const encodedUrl = req.params.encodedUrl;
    const targetUrl = config.decodeUrl(encodedUrl);
    
    if (!targetUrl) return res.status(400).send("Invalid URL");

    res.redirect(`/api/proxy?url=${encodeURIComponent(targetUrl)}`);
  });

  // Enhanced Proxy Endpoint
  app.all("/api/proxy*", express.raw({ type: '*/*', limit: '10mb' }), async (req, res) => {
    let targetUrl = (req.query.url || req.headers['x-nexus-target']) as string;
    
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
    if (req.url?.startsWith("/wisp/")) {
      wisp.routeRequest(req, socket as any, head);
    } else if (bare.shouldRoute(req)) {
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
