import type { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { CookieJar } from 'tough-cookie';

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

  // Handle srcset
  $('img[srcset], source[srcset]').each((_, el) => {
    const srcset = $(el).attr('srcset');
    if (srcset) {
      const rewritten = srcset.split(',').map(part => {
        const [url, size] = part.trim().split(/\s+/);
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
        function proxyUrl(url) {
          if (!url || url.startsWith('data:') || url.startsWith('javascript:') || url.includes(proxyBase)) return url;
          try { return proxyBase + "?url=" + encodeURIComponent(new URL(url, window.location.href).href); } catch (e) { return url; }
        }
        const originalFetch = window.fetch;
        window.fetch = function(input, init) {
          if (typeof input === 'string') input = proxyUrl(input);
          else if (input instanceof Request) input = new Request(proxyUrl(input.url), input);
          return originalFetch.call(this, input, init);
        };
        const originalOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(method, url, ...args) {
          return originalOpen.call(this, method, proxyUrl(url), ...args);
        };
        window.addEventListener('click', (e) => {
          const link = e.target.closest('a');
          if (link && link.href && !link.href.startsWith('javascript:') && !link.href.includes(proxyBase)) {
            e.preventDefault();
            window.location.href = proxyUrl(link.getAttribute('href'));
          }
        }, true);
        window.addEventListener('submit', (e) => {
          const form = e.target;
          const method = (form.method || 'GET').toUpperCase();
          if (method === 'GET') {
            const action = form.getAttribute('action') || '';
            const absoluteAction = new URL(action, window.location.href).href;
            let urlInput = form.querySelector('input[name="url"]');
            if (!urlInput) {
              urlInput = document.createElement('input');
              urlInput.type = 'hidden';
              urlInput.name = 'url';
              form.appendChild(urlInput);
            }
            urlInput.value = absoluteAction;
            form.action = proxyBase;
          } else {
            if (form.action && !form.action.includes(proxyBase)) form.action = proxyUrl(form.getAttribute('action'));
          }
        }, true);
        function notifyParent() {
          if (window.parent !== window) {
            const urlParam = new URLSearchParams(window.location.search).get('url');
            window.parent.postMessage({ type: 'PROXY_URL_CHANGE', url: urlParam || window.location.href }, '*');
          }
        }
        window.addEventListener('popstate', notifyParent);
        notifyParent();
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

    const response = await axios({
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
    });

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
