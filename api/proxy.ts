import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { CookieJar } from 'tough-cookie';
import http from 'http';
import https from 'https';

const httpAgent = new http.Agent({ keepAlive: true, timeout: 60000 });
const httpsAgent = new https.Agent({ keepAlive: true, timeout: 60000, rejectUnauthorized: false });

// Vercel functions are stateless, so we'd ideally use a database for cookies,
// but for this demo we'll use a simple in-memory jar (limited to the current instance)
const jar = new CookieJar();

function rewriteContent(content: string, baseUrl: string, proxyUrlBase: string): string {
  const $ = cheerio.load(content);
  
  const rewriteAttr = (selector: string, attr: string) => {
    $(selector).each((_, el) => {
      const val = $(el).attr(attr);
      if (val && !val.startsWith('data:') && !val.startsWith('javascript:')) {
        try {
          const absolute = new URL(val, baseUrl).href;
          $(el).attr(attr, `${proxyUrlBase}?url=${encodeURIComponent(absolute)}`);
        } catch (e) {}
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const targetUrl = req.query.url as string;
  if (!targetUrl) return res.status(400).send("URL is required");

  try {
    const url = new URL(targetUrl);
    const cookieString = await jar.getCookieString(targetUrl);

    const makeRequest = async (retries = 2): Promise<any> => {
      try {
        return await axios({
          method: req.method,
          url: targetUrl,
          data: req.method !== 'GET' ? req.body : undefined,
          headers: {
            ...req.headers,
            host: url.host,
            cookie: cookieString,
            'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
            referer: url.origin,
            origin: url.origin,
            'accept-encoding': 'identity',
          },
          responseType: 'arraybuffer',
          maxRedirects: 0,
          validateStatus: () => true,
          timeout: 30000,
          httpAgent,
          httpsAgent,
        });
      } catch (err: any) {
        const isNetworkError = ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENOTFOUND'].includes(err.code) || err.message?.includes('socket hang up');
        if (retries > 0 && isNetworkError) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          return makeRequest(retries - 1);
        }
        throw err;
      }
    };

    const response = await makeRequest();

    if (response.status >= 300 && response.status < 400 && response.headers.location) {
      const redirectUrl = new URL(response.headers.location, targetUrl).href;
      return res.redirect(`/api/proxy?url=${encodeURIComponent(redirectUrl)}`);
    }

    const setCookies = response.headers['set-cookie'];
    if (setCookies) {
      for (const cookie of setCookies) await jar.setCookie(cookie, targetUrl);
    }

    const contentType = response.headers['content-type'] || '';
    Object.entries(response.headers).forEach(([key, value]) => {
      if (!['content-encoding', 'transfer-encoding', 'set-cookie', 'content-security-policy', 'x-frame-options', 'location'].includes(key.toLowerCase())) {
        res.setHeader(key, value as string);
      }
    });

    let data = response.data;
    if (contentType.includes('text/html')) {
      data = Buffer.from(rewriteContent(data.toString('utf-8'), targetUrl, '/api/proxy'), 'utf-8');
    } else if (contentType.includes('text/css')) {
      let css = data.toString('utf-8');
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
    }

    res.status(response.status).send(data);
  } catch (error: any) {
    res.status(500).send("Error fetching URL: " + error.message);
  }
}
