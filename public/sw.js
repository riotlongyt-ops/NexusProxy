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

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    
    if (url.pathname.startsWith(config.prefix)) {
        const targetUrl = config.decodeUrl(url.pathname.slice(config.prefix.length));
        if (targetUrl) {
            event.respondWith(handleRequest(event.request, targetUrl));
        }
    }
});

async function handleRequest(request, targetUrl) {
    try {
        const proxyUrl = `/api/proxy?url=${encodeURIComponent(targetUrl)}`;
        
        const headers = new Headers(request.headers);
        headers.set('X-Nexus-Target', targetUrl);

        const init = {
            method: request.method,
            headers: headers,
            redirect: 'manual'
        };

        if (request.method !== 'GET' && request.method !== 'HEAD') {
            init.body = await request.arrayBuffer();
        }

        const response = await fetch(proxyUrl, init);

        // Handle redirects
        if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get('Location');
            if (location) {
                const absoluteLocation = new URL(location, targetUrl).href;
                const redirectUrl = new URL(config.prefix + config.encodeUrl(absoluteLocation), self.location.origin).href;
                return Response.redirect(redirectUrl, response.status);
            }
        }

        return response;
    } catch (error) {
        return new Response('Proxy Error: ' + error.message, { status: 500 });
    }
}
