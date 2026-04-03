// public/nexus-client.js
(function() {
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

  const originalLocation = window.location;
  const encodedPart = originalLocation.pathname.split(config.prefix)[1];
  if (!encodedPart) return;

  const targetUrlStr = config.decodeUrl(encodedPart);
  const baseUrl = new URL(targetUrlStr);

  // Proxy URL function
  window.nexusProxyUrl = function(url) {
    if (!url || typeof url !== 'string') return url;
    if (url.startsWith('data:') || url.startsWith('javascript:') || url.startsWith('blob:') || url.includes(config.prefix)) return url;
    
    try {
      const absolute = new URL(url, baseUrl).href;
      return config.prefix + config.encodeUrl(absolute);
    } catch (e) {
      return url;
    }
  };

  // Location proxy
  const locationProxy = new Proxy({}, {
    get(target, prop) {
      if (prop === 'href') return baseUrl.href;
      if (prop === 'origin') return baseUrl.origin;
      if (prop === 'host') return baseUrl.host;
      if (prop === 'hostname') return baseUrl.hostname;
      if (prop === 'pathname') return baseUrl.pathname;
      if (prop === 'search') return baseUrl.search;
      if (prop === 'hash') return baseUrl.hash;
      if (prop === 'port') return baseUrl.port;
      if (prop === 'protocol') return baseUrl.protocol;
      if (prop === 'assign' || prop === 'replace') return (url) => originalLocation[prop](window.nexusProxyUrl(url));
      if (prop === 'reload') return () => originalLocation.reload();
      if (prop === 'toString') return () => baseUrl.href;
      return baseUrl[prop];
    },
    set(target, prop, value) {
      if (prop === 'href') originalLocation.href = window.nexusProxyUrl(value);
      else baseUrl[prop] = value;
      return true;
    }
  });

  // Override globals
  window.__nexus_location = locationProxy;
  
  // Intercept element creation
  const originalCreateElement = document.createElement;
  document.createElement = function(tagName, options) {
    const el = originalCreateElement.call(this, tagName, options);
    const tag = tagName.toLowerCase();
    
    if (['img', 'script', 'iframe', 'link', 'video', 'audio', 'source', 'form', 'a'].includes(tag)) {
      const originalSetAttribute = el.setAttribute;
      el.setAttribute = function(name, value) {
        if (['src', 'href', 'action', 'data'].includes(name) && value) {
          value = window.nexusProxyUrl(value);
        }
        return originalSetAttribute.call(this, name, value);
      };

      const prop = (tag === 'link' || tag === 'a') ? 'href' : (tag === 'form' ? 'action' : 'src');
      try {
        Object.defineProperty(el, prop, {
          get() { return el.getAttribute(prop); },
          set(val) { el.setAttribute(prop, val); }
        });
      } catch(e) {}
    }
    return el;
  };

  // Intercept fetch
  const originalFetch = window.fetch;
  window.fetch = function(input, init) {
    if (typeof input === 'string') {
      input = window.nexusProxyUrl(input);
    } else if (input instanceof Request) {
      input = new Request(window.nexusProxyUrl(input.url), input);
    }
    return originalFetch.call(this, input, init);
  };

  // Intercept XHR
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...args) {
    return originalOpen.call(this, method, window.nexusProxyUrl(url), ...args);
  };

  console.log("Nexus Emulator Active for:", baseUrl.href);
})();
