# NEXUS Proxy

Nexus is a high-performance, interception-based web proxy designed to provide a seamless, unblocked browsing experience. Inspired by advanced proxy technologies like Scramjet and Ultraviolet, Nexus utilizes a multi-layered approach to bypass censorship and network restrictions.

## 🚀 Features

- **Advanced Interception**: Every request is intercepted by a dedicated Service Worker, allowing for real-time content modification and security checks.
- **Dynamic Rewriting**: Robust HTML, CSS, and JavaScript rewriting ensures that all links, resources, and API calls are correctly routed through the proxy tunnel.
- **Wisp Transport**: Efficient subresource and WebSocket transport via the Wisp protocol, providing low-latency and high-performance data transfer.
- **Epoxy TLS**: A secure, client-side TLS stack that bypasses traditional network-level blocks by establishing encrypted tunnels directly from the browser.
- **Location Proxying**: Comprehensive `window.location` and `document.location` proxying ensures that scripts on proxied pages function correctly.
- **Search Suggestions**: Full support for dynamic features like Google's search suggestions and autocomplete.
- **Tab Cloaking**: Built-in tab cloaking features to hide your browsing activity from prying eyes.
- **Standalone Mode**: Downloadable standalone HTML for offline or local use.

## 🛠️ Technical Overview

Nexus operates by combining several key technologies:

1.  **Service Worker (`sw.js`)**: Acts as the primary network-level interceptor, handling requests and applying rewriting logic before they reach the browser's network stack.
2.  **Client-Side Emulator (`nexus-client.js`)**: Injected into every proxied page to override browser APIs, handle property access, and ensure a consistent environment for proxied scripts.
3.  **Express Backend (`server.ts`)**: A robust Node.js backend that handles initial page requests, performs server-side rewriting, and manages Wisp/Bare connections.
4.  **Wisp Protocol**: Utilized for efficient WebSocket and subresource transport, reducing overhead and improving performance.

## 📦 Installation

To run Nexus locally:

1.  Clone the repository:
    ```bash
    git clone https://github.com/riotlongyt-ops/NexusProxy/
    ```
2.  Navigate to the project directory:
    ```bash
    cd NexusProxy
    ```
3.  Install dependencies:
    ```bash
    npm install
    ```
4.  Start the development server:
    ```bash
    npm run dev
    ```
5.  Open `http://localhost:3000` in your browser.

## 🌐 Deployment

Nexus is designed to be easily deployable to modern cloud platforms:

-   **Cloud Run / Docker**: The project includes a `Dockerfile` for easy containerization and deployment to Google Cloud Run or similar services.
-   **Vercel**: Configuration for Vercel is included, though some advanced features (like Wisp) may require a persistent backend.

## 🛡️ Disclaimer

Nexus is intended for educational and privacy-enhancing purposes. Please use it responsibly and in accordance with your local laws and regulations.
