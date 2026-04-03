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

  // Override navigator.userAgent to match server
  Object.defineProperty(navigator, 'userAgent', {
    get() { return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'; }
  });
  Object.defineProperty(navigator, 'webdriver', { get() { return false; } });
  Object.defineProperty(navigator, 'languages', { get() { return ['en-US', 'en']; } });
  Object.defineProperty(navigator, 'language', { get() { return 'en-US'; } });
  
  // Override screen properties
  Object.defineProperty(window.screen, 'width', { get() { return 1920; } });
  Object.defineProperty(window.screen, 'height', { get() { return 1080; } });
  Object.defineProperty(window.screen, 'availWidth', { get() { return 1920; } });
  Object.defineProperty(window.screen, 'availHeight', { get() { return 1040; } });
  Object.defineProperty(window.screen, 'colorDepth', { get() { return 24; } });
  Object.defineProperty(window.screen, 'pixelDepth', { get() { return 24; } });
  
  // Override window size
  Object.defineProperty(window, 'innerWidth', { get() { return 1920; } });
  Object.defineProperty(window, 'innerHeight', { get() { return 1080; } });
  Object.defineProperty(window, 'outerWidth', { get() { return 1920; } });
  Object.defineProperty(window, 'outerHeight', { get() { return 1080; } });
  Object.defineProperty(navigator, 'platform', { get() { return 'Win32'; } });
  Object.defineProperty(navigator, 'deviceMemory', { get() { return 8; } });
  Object.defineProperty(navigator, 'hardwareConcurrency', { get() { return 8; } });
  
  // Override timezone
  const originalResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
  Intl.DateTimeFormat.prototype.resolvedOptions = function() {
    const options = originalResolvedOptions.call(this);
    options.timeZone = 'America/New_York';
    return options;
  };

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

  // Cookie handling
  const originalCookie = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
  if (originalCookie && originalCookie.configurable) {
    Object.defineProperty(document, 'cookie', {
      get() {
        return originalCookie.get.call(this);
      },
      set(val) {
        // We can't easily sync cookies to the server-side axios jar from here without a fetch
        // But we can at least set them in the browser
        return originalCookie.set.call(this, val);
      }
    });
  }

  // Intercept getAttribute/setAttribute
  const originalGetAttribute = Element.prototype.getAttribute;
  Element.prototype.getAttribute = function(name) {
    const val = originalGetAttribute.call(this, name);
    if (val && typeof val === 'string' && val.includes(config.prefix)) {
      try {
        const encoded = val.split(config.prefix)[1];
        return config.decodeUrl(encoded);
      } catch(e) {}
    }
    return val;
  };

  const originalSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function(name, value) {
    const proxiedAttrs = ['src', 'href', 'action', 'srcset', 'data-src', 'data-href'];
    if (proxiedAttrs.includes(name.toLowerCase())) {
      value = window.nexusProxyUrl(value);
    }
    return originalSetAttribute.call(this, name, value);
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
      else if (prop === 'assign' || prop === 'replace') return false;
      else baseUrl[prop] = value;
      return true;
    }
  });

  // Override globals
  window.__nexus_location = locationProxy;
  
  // Intercept top and parent location
  try {
    Object.defineProperty(window, 'location', { get() { return locationProxy; }, set(v) { locationProxy.href = v; } });
    Object.defineProperty(document, 'location', { get() { return locationProxy; }, set(v) { locationProxy.href = v; } });
    
    // Prevent frame-busting
    Object.defineProperty(window, 'top', { get() { return window; } });
    Object.defineProperty(window, 'parent', { get() { return window; } });
    Object.defineProperty(window, 'self', { get() { return window; } });
    
    // Intercept document.domain
    Object.defineProperty(document, 'domain', {
      get() { return baseUrl.hostname; },
      set(v) { /* ignore or handle if needed */ }
    });

    // Namespace storage
    const storageProxy = (original) => new Proxy(original, {
      get(target, prop) {
        if (typeof target[prop] === 'function') return target[prop].bind(target);
        const key = `__nexus_${baseUrl.hostname}_${prop}`;
        return target.getItem(key) || target[prop];
      },
      set(target, prop, value) {
        const key = `__nexus_${baseUrl.hostname}_${prop}`;
        target.setItem(key, value);
        return true;
      }
    });

    Object.defineProperty(window, 'localStorage', { get() { return storageProxy(window.localStorage); } });
    Object.defineProperty(window, 'sessionStorage', { get() { return storageProxy(window.sessionStorage); } });
    
    // Intercept document.referrer
    Object.defineProperty(document, 'referrer', {
      get() { return baseUrl.origin; }
    });
  } catch(e) {}
  
  // Intercept element properties
  const rewriteProperty = (obj, prop) => {
    const original = Object.getOwnPropertyDescriptor(obj, prop);
    if (!original || !original.configurable) return;

    Object.defineProperty(obj, prop, {
      get() {
        const val = original.get.call(this);
        if (val && typeof val === 'string' && val.includes(config.prefix)) {
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

  rewriteProperty(HTMLAnchorElement.prototype, 'href');
  rewriteProperty(HTMLImageElement.prototype, 'src');
  rewriteProperty(HTMLScriptElement.prototype, 'src');
  rewriteProperty(HTMLLinkElement.prototype, 'href');
  rewriteProperty(HTMLIFrameElement.prototype, 'src');
  rewriteProperty(HTMLFormElement.prototype, 'action');

  // Intercept fetch
  const originalFetch = window.fetch;
  window.fetch = function(input, init) {
    if (typeof input === 'string') {
      input = window.nexusProxyUrl(input);
    } else if (input instanceof URL) {
      input = window.nexusProxyUrl(input);
    } else if (input instanceof Request) {
      input = new Request(window.nexusProxyUrl(input.url), input);
    }

    // Forward cookies to the proxy
    if (init && !init.headers) init.headers = {};
    if (init && init.headers) {
      if (init.headers instanceof Headers) {
        init.headers.set('x-nexus-cookies', document.cookie);
      } else {
        init.headers['x-nexus-cookies'] = document.cookie;
      }
    } else if (!init) {
      init = { headers: { 'x-nexus-cookies': document.cookie } };
    }

    return originalFetch.call(this, input, init);
  };

  // Intercept Worker
  const originalWorker = window.Worker;
  window.Worker = function(url, options) {
    if (typeof url === 'string') {
      url = window.nexusProxyUrl(url);
    } else if (url instanceof URL) {
      url = window.nexusProxyUrl(url);
    }
    return new originalWorker(url, options);
  };
  window.Worker.prototype = originalWorker.prototype;

  // Intercept createObjectURL
  const originalCreateObjectURL = URL.createObjectURL;
  URL.createObjectURL = function(obj) {
    const url = originalCreateObjectURL.call(this, obj);
    // We don't necessarily need to proxy blob URLs unless they are used in a context that requires it,
    // but we should track them if needed.
    return url;
  };

  // Intercept requestPointerLock
  const originalRequestPointerLock = Element.prototype.requestPointerLock;
  if (originalRequestPointerLock) {
    Element.prototype.requestPointerLock = function(options) {
      try {
        return originalRequestPointerLock.call(this, options);
      } catch (e) {
        console.warn('Nexus: Pointer lock failed:', e);
      }
    };
  }

  // Intercept requestFullscreen
  const originalRequestFullscreen = Element.prototype.requestFullscreen || Element.prototype.webkitRequestFullscreen || Element.prototype.mozRequestFullScreen || Element.prototype.msRequestFullscreen;
  if (originalRequestFullscreen) {
    Element.prototype.requestFullscreen = function(options) {
      try {
        return originalRequestFullscreen.call(this, options);
      } catch (e) {
        console.warn('Nexus: Fullscreen failed:', e);
      }
    };
  }

  // Intercept AudioContext
  const originalAudioContext = window.AudioContext || window.webkitAudioContext;
  if (originalAudioContext) {
    const ProxyAudioContext = function(options) {
      const ctx = new originalAudioContext(options);
      return ctx;
    };
    ProxyAudioContext.prototype = originalAudioContext.prototype;
    window.AudioContext = ProxyAudioContext;
    window.webkitAudioContext = ProxyAudioContext;
  }

  // Intercept getContext for Canvas
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function(type, attributes) {
    if (type === 'webgl' || type === 'webgl2') {
      if (attributes) {
        // Ensure preserveDrawingBuffer is handled if needed for some games
      }
    }
    return originalGetContext.call(this, type, attributes);
  };

  // Intercept XHR
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...args) {
    const proxiedUrl = window.nexusProxyUrl(url);
    const res = originalOpen.call(this, method, proxiedUrl, ...args);
    this.setRequestHeader('x-nexus-cookies', document.cookie);
    return res;
  };

  // Intercept sendBeacon
  const originalSendBeacon = navigator.sendBeacon;
  navigator.sendBeacon = function(url, data) {
    return originalSendBeacon.call(this, window.nexusProxyUrl(url), data);
  };

  // Wisp/Bare-mux WebSocket Interception
  try {
    const { BareMuxConnection } = await import('https://cdn.jsdelivr.net/npm/@mercuryworkshop/bare-mux@1.1.0/dist/index.mjs');
    const connection = new BareMuxConnection('/baremux/');
    
    try {
      // Switch to scramjet for better YouTube and dynamic site support
      await connection.setTransport('https://cdn.jsdelivr.net/npm/@mercuryworkshop/scramjet@1.0.0/dist/index.mjs', [{ wisp: config.wispUrl }]);
      console.log('Nexus: Scramjet transport initialized (client)');
    } catch (e) {
      console.error('Nexus: Failed to initialize scramjet transport, falling back to epoxy:', e);
      try {
        await connection.setTransport('https://cdn.jsdelivr.net/npm/@mercuryworkshop/epoxy-tls@1.1.0/dist/index.mjs', [{ wisp: config.wispUrl }]);
        console.log('Nexus: Epoxy transport initialized (fallback client)');
      } catch (e2) {
        console.error('Nexus: All client transports failed:', e2);
      }
    }

    const originalWebSocket = window.WebSocket;
    window.WebSocket = function(url, protocols) {
      try {
        const absolute = new URL(url, baseUrl).href;
        return connection.WebSocket(absolute, protocols);
      } catch (e) {
        return new originalWebSocket(url, protocols);
      }
    };
    window.WebSocket.prototype = originalWebSocket.prototype;
  } catch (e) {
    console.warn('Nexus: Bare-mux WebSocket proxying failed:', e);
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
