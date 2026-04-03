// public/nexus-client.js
(async function() {
  const config = {
    prefix: '/nexus/',
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

  const originalLocation = window.location;
  const encodedPart = originalLocation.pathname.split(config.prefix)[1];
  if (!encodedPart) return;

  const targetUrlStr = config.decodeUrl(encodedPart);
  const baseUrl = new URL(targetUrlStr);

  // Proxy URL function
  window.nexusProxyUrl = function(url) {
    if (!url) return url;
    if (url instanceof URL) url = url.href;
    if (typeof url !== 'string') return url;
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
      if (typeof baseUrl[prop] === 'function') return baseUrl[prop].bind(baseUrl);
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
  
  // Intercept element properties
  const rewriteProperty = (obj, prop, attr) => {
    const original = Object.getOwnPropertyDescriptor(obj, prop);
    if (!original || !original.configurable) return;

    Object.defineProperty(obj, prop, {
      get() {
        const val = original.get.call(this);
        if (val && val.includes(config.prefix)) {
          try {
            const encoded = val.split(config.prefix)[1];
            return config.decodeUrl(encoded);
          } catch(e) {}
        }
        return val;
      },
      set(val) {
        return original.set.call(this, window.nexusProxyUrl(val));
      }
    });
  };

  rewriteProperty(HTMLAnchorElement.prototype, 'href', 'href');
  rewriteProperty(HTMLImageElement.prototype, 'src', 'src');
  rewriteProperty(HTMLScriptElement.prototype, 'src', 'src');
  rewriteProperty(HTMLLinkElement.prototype, 'href', 'href');
  rewriteProperty(HTMLIFrameElement.prototype, 'src', 'src');
  rewriteProperty(HTMLFormElement.prototype, 'action', 'action');

  // Intercept fetch
  const originalFetch = window.fetch;
  window.fetch = function(input, init) {
    let url;
    if (typeof input === 'string') {
      url = input;
      input = window.nexusProxyUrl(input);
    } else if (input instanceof URL) {
      url = input.href;
      input = window.nexusProxyUrl(input);
    } else if (input instanceof Request) {
      url = input.url;
      input = new Request(window.nexusProxyUrl(input.url), input);
    }
    
    // Add some common headers if missing
    if (init && !init.headers) init.headers = {};
    if (init && init.headers && !init.headers['Referer']) {
      // We can't actually set Referer in browser fetch, but we can try to hint it
    }

    return originalFetch.call(this, input, init);
  };

  // Intercept XHR
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...args) {
    return originalOpen.call(this, method, window.nexusProxyUrl(url), ...args);
  };

  // Intercept cookies
  const originalCookie = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
  if (originalCookie && originalCookie.configurable) {
    Object.defineProperty(document, 'cookie', {
      get() {
        return originalCookie.get.call(this);
      },
      set(val) {
        return originalCookie.set.call(this, val);
      }
    });
  }

  // Intercept sendBeacon
  const originalSendBeacon = navigator.sendBeacon;
  navigator.sendBeacon = function(url, data) {
    return originalSendBeacon.call(this, window.nexusProxyUrl(url), data);
  };

  // Wisp WebSocket Interception
  try {
    const { WispClient } = await import('https://cdn.jsdelivr.net/npm/@mercuryworkshop/wisp-js@1.1.0/dist/index.mjs');
    const wisp = new WispClient(config.wispUrl);

    const originalWebSocket = window.WebSocket;
    window.WebSocket = function(url, protocols) {
      console.log('Nexus: Proxying WebSocket to:', url);
      try {
        const absolute = new URL(url, baseUrl).href;
        return wisp.WebSocket(absolute, protocols);
      } catch (e) {
        return new originalWebSocket(url, protocols);
      }
    };
    window.WebSocket.prototype = originalWebSocket.prototype;
  } catch (e) {
    console.warn('Nexus: Wisp WebSocket proxying failed:', e);
  }

  // History API proxy
  const originalPushState = history.pushState;
  history.pushState = function(state, title, url) {
    if (url) url = window.nexusProxyUrl(url);
    return originalPushState.call(this, state, title, url);
  };

  const originalReplaceState = history.replaceState;
  history.replaceState = function(state, title, url) {
    if (url) url = window.nexusProxyUrl(url);
    return originalReplaceState.call(this, state, title, url);
  };

  console.log("Nexus Emulator Active for:", baseUrl.href);
})();
