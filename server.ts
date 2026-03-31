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
  const wispInstance = wisp as any;
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
        if (val && !val.startsWith('data:') && !val.startsWith('javascript:') && !val.startsWith(config.prefix)) {
          // CAPTCHA bypass
          if (val.includes('google.com/recaptcha') || val.includes('gstatic.com/recaptcha') || val.includes('hcaptcha.com')) {
            return;
          }
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
        if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith(config.prefix)) return match;
        // CAPTCHA bypass
        if (url.includes('google.com/recaptcha') || url.includes('gstatic.com/recaptcha') || url.includes('hcaptcha.com')) {
          return match;
        }
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
          <button id="__nexus_home_btn" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: white; padding: 8px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center;" title="Home">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          </button>
          <button id="__nexus_back_btn" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: white; padding: 8px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center;" title="Back">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
          </button>
          <button id="__nexus_forward_btn" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: white; padding: 8px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center;" title="Forward">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
          </button>
          <button id="__nexus_reload_btn" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: white; padding: 8px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center;" title="Reload">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>
          </button>
        </div>
        <div style="flex: 1; display: flex; align-items: center; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; padding: 0 15px;">
          <input id="__nexus_url_input" type="text" value="${baseUrl}" style="width: 100%; background: transparent; border: none; color: white; font-size: 14px; outline: none; padding: 10px 0;" placeholder="Search or enter address">
        </div>
        <div style="display: flex; align-items: center; gap: 10px;">
          <button id="__nexus_view_network" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: white; padding: 8px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center;" title="Network Interceptor">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/></svg>
          </button>
          <button id="__nexus_add_shortcut" style="background: #2563eb; border: none; color: white; padding: 8px 15px; border-radius: 8px; cursor: pointer; font-size: 12px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px;" title="Add Shortcut">Add Shortcut</button>
          <button id="__nexus_view_cookies" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: white; padding: 8px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center;" title="Cookies">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5"/><path d="M8.5 8.5v.01"/><path d="M16 15.5v.01"/><path d="M12 12v.01"/><path d="M11 17v.01"/><path d="M7 13v.01"/></svg>
          </button>
          <button id="__nexus_view_settings" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: white; padding: 8px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center;" title="Settings">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
        </div>
      </div>
      <div id="__nexus_network_log" style="position: fixed; top: 60px; right: 20px; width: 350px; max-height: 400px; background: #0a0a0a; border: 1px solid rgba(255,255,255,0.1); border-radius: 15px; z-index: 1000002; display: none; flex-direction: column; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.8); font-family: monospace;">
        <div style="padding: 12px 15px; background: rgba(255,255,255,0.05); border-bottom: 1px solid rgba(255,255,255,0.1); display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 10px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px;">Network Interceptor</span>
          <button id="__nexus_clear_log" style="background: transparent; border: none; color: #ff4444; font-size: 10px; cursor: pointer; font-weight: bold;">CLEAR</button>
        </div>
        <div id="__nexus_log_content" style="flex: 1; overflow-y: auto; padding: 10px; font-size: 10px; color: #888;">
          <div style="padding: 10px; text-align: center;">No requests intercepted yet.</div>
        </div>
      </div>
      <style>
        #__nexus_nav_trigger:hover + #__nexus_nav_bar, #__nexus_nav_bar:hover {
          transform: translateY(0) !important;
        }
        .__nexus_log_entry {
          padding: 8px;
          border-bottom: 1px solid rgba(255,255,255,0.05);
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .__nexus_log_entry:hover {
          background: rgba(255,255,255,0.02);
        }
        .__nexus_method {
          font-weight: bold;
          color: #2563eb;
          margin-right: 8px;
        }
        .__nexus_url {
          word-break: break-all;
          color: #ccc;
        }
        .__nexus_status {
          font-size: 9px;
          color: #22c55e;
        }
      </style>
      <script>
        (function() {
          const config = {
            prefix: '/nexus/',
            encodeUrl: (url) => {
              if (!url) return url;
              const xored = url.split('').map((char, i) => i % 2 ? String.fromCharCode(char.charCodeAt(0) ^ 2) : char).join('');
              return btoa(xored).replace(/\\//g, '_').replace(/\\+/g, '-').replace(/=/g, '');
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

          window.proxyUrl = function(url) {
            if (!url || typeof url !== 'string') return url;
            if (url.startsWith('data:') || url.startsWith('javascript:') || url.startsWith('blob:') || url.includes(config.prefix)) return url;
            
            // CAPTCHA bypass logic
            if (url.includes('google.com/recaptcha') || url.includes('gstatic.com/recaptcha') || url.includes('hcaptcha.com')) {
              return url;
            }

            try {
              const absolute = new URL(url, "${baseUrl}").href;
              return config.prefix + config.encodeUrl(absolute);
            } catch (e) {
              return url;
            }
          };

          function navigate(url) {
            if (!url) return;
            if (!url.startsWith('http')) {
              if (url.includes('.') && !url.includes(' ')) url = 'https://' + url;
              else url = 'https://www.google.com/search?q=' + encodeURIComponent(url);
            }
            window.top.location.href = window.proxyUrl(url);
          }

          // UI Handlers
          console.log("Nexus Interception Script Active");
          
          const attachHandler = (id, handler) => {
            const el = document.getElementById(id);
            if (el) el.onclick = handler;
            else console.warn("Nexus: Element not found:", id);
          };

          attachHandler('__nexus_home_btn', () => window.top.location.href = '/');
          attachHandler('__nexus_back_btn', () => window.history.back());
          attachHandler('__nexus_forward_btn', () => window.history.forward());
          attachHandler('__nexus_reload_btn', () => window.location.reload());
          
          const urlInput = document.getElementById('__nexus_url_input');
          if (urlInput) {
            urlInput.onkeypress = (e) => {
              if (e.key === 'Enter') navigate(e.target.value);
            };
          }

          attachHandler('__nexus_view_network', () => {
            const log = document.getElementById('__nexus_network_log');
            log.style.display = log.style.display === 'none' ? 'flex' : 'none';
          });

          attachHandler('__nexus_clear_log', () => {
            document.getElementById('__nexus_log_content').innerHTML = '<div style="padding: 10px; text-align: center;">No requests intercepted yet.</div>';
          });

          attachHandler('__nexus_add_shortcut', () => {
            const name = prompt('Shortcut Name:', document.title || 'New Shortcut');
            if (name) {
              const shortcuts = JSON.parse(localStorage.getItem('nexus_shortcuts') || '[]');
              shortcuts.push({ name, url: "${baseUrl}" });
              localStorage.setItem('nexus_shortcuts', JSON.stringify(shortcuts));
              alert('Shortcut added!');
            }
          });

          attachHandler('__nexus_view_cookies', () => window.top.location.href = '/?cookies=true');
          attachHandler('__nexus_view_settings', () => window.top.location.href = '/?settings=true');

          function logRequest(method, url) {
            const logContent = document.getElementById('__nexus_log_content');
            if (logContent.children.length === 1 && logContent.children[0].textContent.includes('No requests')) {
              logContent.innerHTML = '';
            }
            const entry = document.createElement('div');
            entry.className = '__nexus_log_entry';
            entry.innerHTML = '<div><span class="__nexus_method">' + method + '</span><span class="__nexus_url">' + url.split("?")[0].slice(-40) + '</span></div><div class="__nexus_status">INTERCEPTED</div>';
            logContent.prepend(entry);
            if (logContent.children.length > 50) logContent.lastChild.remove();
          }

          // WebSocket Interception for Wisp
          const originalWebSocket = window.WebSocket;
          window.WebSocket = function(url, protocols) {
            logRequest('WS', url);
            if (typeof url === 'string' && !url.startsWith('ws://localhost') && !url.startsWith('wss://localhost') && !url.includes('/wisp/')) {
              try {
                const absolute = new URL(url, "${baseUrl}").href;
                const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
                const wispUrl = protocol + window.location.host + '/wisp/?url=' + encodeURIComponent(absolute);
                return new originalWebSocket(wispUrl, protocols);
              } catch (e) {
                return new originalWebSocket(url, protocols);
              }
            }
            return new originalWebSocket(url, protocols);
          };
          window.WebSocket.prototype = originalWebSocket.prototype;

          // Interception
          const originalFetch = window.fetch;
          window.fetch = function(input, init) {
            let url = typeof input === 'string' ? input : input.url;
            logRequest(init?.method || 'GET', url);
            if (typeof input === 'string') input = window.proxyUrl(input);
            else if (input instanceof Request) input = new Request(window.proxyUrl(input.url), input);
            return originalFetch.call(this, input, init);
          };

          const originalOpen = XMLHttpRequest.prototype.open;
          XMLHttpRequest.prototype.open = function(method, url, ...args) {
            logRequest(method, url);
            return originalOpen.call(this, method, window.proxyUrl(url), ...args);
          };

          window.addEventListener('click', (e) => {
            const link = e.target.closest('a');
            if (link && link.href && !link.href.startsWith('javascript:') && !link.href.startsWith('#')) {
              const href = link.getAttribute('href');
              if (href && !href.includes(config.prefix)) {
                e.preventDefault();
                navigate(href);
              }
            }
          }, true);

          window.addEventListener('submit', (e) => {
            const form = e.target;
            const action = form.getAttribute('action');
            if (action && !action.includes(config.prefix)) {
              form.action = window.proxyUrl(action);
            }
          }, true);

          const originalPushState = history.pushState;
          history.pushState = function(state, title, url) {
            return originalPushState.call(this, state, title, url ? window.proxyUrl(url) : url);
          };

          const originalReplaceState = history.replaceState;
          history.replaceState = function(state, title, url) {
            return originalReplaceState.call(this, state, title, url ? window.proxyUrl(url) : url);
          };

          const originalCreateElement = document.createElement;
          document.createElement = function(tagName, options) {
            const el = originalCreateElement.call(this, tagName, options);
            const tag = tagName.toLowerCase();
            if (['img', 'script', 'iframe', 'link', 'video', 'audio', 'source'].includes(tag)) {
              const originalSetAttribute = el.setAttribute;
              el.setAttribute = function(name, value) {
                if (['src', 'href', 'action', 'data'].includes(name) && value) {
                  value = window.proxyUrl(value);
                }
                return originalSetAttribute.call(this, name, value);
              };
              const prop = (tag === 'link' || tag === 'a') ? 'href' : 'src';
              try {
                Object.defineProperty(el, prop, {
                  get() { return el.getAttribute(prop); },
                  set(val) { el.setAttribute(prop, val); }
                });
              } catch(e) {}
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
            // Normalize baseTargetUrl
            if (baseTargetUrl.startsWith('//')) baseTargetUrl = 'https:' + baseTargetUrl;
            else if (!baseTargetUrl.startsWith('http')) baseTargetUrl = 'https://' + baseTargetUrl;
            
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

    // Normalize targetUrl
    if (targetUrl) {
      if (targetUrl.startsWith('//')) {
        targetUrl = 'https:' + targetUrl;
      } else if (!targetUrl.startsWith('http') && (targetUrl.includes('.') || targetUrl.includes(':'))) {
        targetUrl = 'https://' + targetUrl;
      }
    }

    try {
      new URL(targetUrl);
    } catch (e) {
      return res.status(400).send(`
        <div style="font-family: sans-serif; padding: 2rem; background: #1a1a1a; color: #ff4444; border-radius: 1rem;">
          <h2 style="margin-top: 0;">Proxy Error</h2>
          <p>Invalid URL: ${targetUrl}</p>
          <p style="color: #888; font-size: 0.8rem;">Please ensure the URL is absolute (includes http:// or https://)</p>
          <button onclick="window.top.location.href='/'" style="padding: 0.5rem 1rem; background: #444; color: white; border: none; border-radius: 0.5rem; cursor: pointer;">Go Home</button>
        </div>
      `);
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
        let redirectUrl = response.headers.location;
        try {
          redirectUrl = new URL(redirectUrl, targetUrl).href;
        } catch (e) {
          // If it's not a valid URL, try to fix it if it's relative
          if (redirectUrl.startsWith('/')) {
            const origin = new URL(targetUrl).origin;
            redirectUrl = origin + redirectUrl;
          }
        }
        
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
      wispInstance.routeRequest(req, socket as any, head);
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
