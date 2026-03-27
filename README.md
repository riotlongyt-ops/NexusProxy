# Nexus Browser

A modern, web-based browser with a built-in proxy to bypass CORS and frame restrictions.

## Features
- **Tabbed Browsing**: Open multiple sites at once.
- **Proxy Mode**: Built-in Express proxy to load sites that block iframes.
- **Device Toggles**: Switch between Desktop and Mobile views.
- **PWA Support**: Installable as a standalone app on desktop and mobile.
- **Vercel Ready**: Includes configuration for easy deployment to Vercel.

## Local Setup (Offline Use)
1. Clone or download this project.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the server:
   ```bash
   npm run dev
   ```
4. Open `http://localhost:3000` in your browser.

## Deployment
- **Vercel**: Simply push to a GitHub repo and connect to Vercel. The `vercel.json` and `api/proxy.ts` are already configured.
- **Netlify**: Similar to Vercel, but you may need to adapt the proxy to a Netlify Function.
