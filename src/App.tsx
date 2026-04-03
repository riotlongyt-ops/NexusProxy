import React, { useState, useEffect } from 'react';
import { 
  Search, 
  Shield, 
  Settings, 
  X,
  Plus,
  Globe,
  Download,
  Trash2,
  RotateCw,
  Gamepad2,
  LayoutGrid,
  Youtube,
  Home,
  ExternalLink,
  Check,
  ChevronRight,
  Info
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// XOR Encoding logic (must match server.ts and sw.js)
const config = {
  prefix: '/nexus/',
  encodeUrl(url: string) {
    if (!url) return url;
    return btoa(
      url
        .split('')
        .map((char, ind) => (ind % 2 ? String.fromCharCode(char.charCodeAt(0) ^ 2) : char))
        .join('')
    ).replace(/\//g, '_').replace(/\+/g, '-').replace(/=/g, '');
  },
  decodeUrl(url: string) {
    if (!url) return url;
    let str = url.replace(/_/g, '/').replace(/-/g, '+');
    while (str.length % 4) str += '=';
    return atob(str)
      .split('')
      .map((char, ind) => (ind % 2 ? String.fromCharCode(char.charCodeAt(0) ^ 2) : char))
      .join('');
  },
};

const searchEngines: Record<string, string> = {
  google: 'https://www.google.com/search?q=',
  bing: 'https://www.bing.com/search?q=',
  duckduckgo: 'https://duckduckgo.com/?q=',
  brave: 'https://search.brave.com/search?q=',
};

const cloaks: Record<string, { title: string; icon: string }> = {
  none: { title: 'Nexus', icon: '/favicon.ico' },
  google: { title: 'Google', icon: 'https://www.google.com/favicon.ico' },
  drive: { title: 'My Drive - Google Drive', icon: 'https://ssl.gstatic.com/docs/doclist/images/drive_2022q3_32dp.png' },
  classroom: { title: 'Classes', icon: 'https://www.gstatic.com/classroom/favicon.png' },
  canvas: { title: 'Canvas', icon: 'https://du11hjcvx07p8.cloudfront.net/favicon.ico' },
  zoom: { title: 'Zoom', icon: 'https://st1.zoom.us/zoom.ico' },
};

const apps = [
  { name: 'Discord', url: 'https://discord.com', icon: 'https://assets-global.website-files.com/6257adef93867e3d0394e364/6257adef93867e07c394e395_Discord-Logo-Color.svg' },
  { name: 'Spotify', url: 'https://open.spotify.com', icon: 'https://www.google.com/s2/favicons?domain=spotify.com&sz=128' },
  { name: 'Reddit', url: 'https://www.reddit.com', icon: 'https://www.google.com/s2/favicons?domain=reddit.com&sz=128' },
  { name: 'Twitch', url: 'https://www.twitch.tv', icon: 'https://www.google.com/s2/favicons?domain=twitch.tv&sz=128' },
  { name: 'Twitter', url: 'https://twitter.com', icon: 'https://www.google.com/s2/favicons?domain=twitter.com&sz=128' },
  { name: 'TikTok', url: 'https://www.tiktok.com', icon: 'https://www.google.com/s2/favicons?domain=tiktok.com&sz=128' },
  { name: 'Instagram', url: 'https://www.instagram.com', icon: 'https://www.google.com/s2/favicons?domain=instagram.com&sz=128' },
  { name: 'Pinterest', url: 'https://www.pinterest.com', icon: 'https://www.google.com/s2/favicons?domain=pinterest.com&sz=128' },
];

const games = [
  { name: 'Crazy Games', url: 'https://www.crazygames.com', icon: 'https://www.google.com/s2/favicons?domain=crazygames.com&sz=128' },
  { name: 'Poki', url: 'https://poki.com', icon: 'https://www.google.com/s2/favicons?domain=poki.com&sz=128' },
  { name: '1v1.LOL', url: 'https://1v1.lol', icon: 'https://www.google.com/s2/favicons?domain=1v1.lol&sz=128' },
  { name: 'Slope', url: 'https://slopegame.online', icon: 'https://www.google.com/s2/favicons?domain=slopegame.online&sz=128' },
  { name: 'Shell Shockers', url: 'https://shellshock.io', icon: 'https://www.google.com/s2/favicons?domain=shellshock.io&sz=128' },
  { name: 'Zombs Royale', url: 'https://zombsroyale.io', icon: 'https://www.google.com/s2/favicons?domain=zombsroyale.io&sz=128' },
  { name: 'Krunker', url: 'https://krunker.io', icon: 'https://www.google.com/s2/favicons?domain=krunker.io&sz=128' },
  { name: 'Agar.io', url: 'https://agar.io', icon: 'https://www.google.com/s2/favicons?domain=agar.io&sz=128' },
];

export default function App() {
  const [urlInput, setUrlInput] = useState('');
  const [currentView, setCurrentView] = useState<'home' | 'apps' | 'games' | 'youtube' | 'settings'>('home');
  const [searchEngine, setSearchEngine] = useState(() => localStorage.getItem('nexus_search_engine') || 'google');
  const [tabCloak, setTabCloak] = useState(() => localStorage.getItem('nexus_tab_cloak') || 'none');
  const [proxyMode, setProxyMode] = useState(() => localStorage.getItem('nexus_proxy_mode') || 'sw');
  const [bareStatus, setBareStatus] = useState<'online' | 'offline' | 'checking'>('checking');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [cookies, setCookies] = useState<any[]>([]);
  const [vercelMode, setVercelMode] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showCookies, setShowCookies] = useState(false);
  const [showAddShortcut, setShowAddShortcut] = useState(false);
  const [newShortcutName, setNewShortcutName] = useState('');
  const [newShortcutUrl, setNewShortcutUrl] = useState('');

  const [shortcuts, setShortcuts] = useState<{ name: string; url: string }[]>(() => {
    const saved = localStorage.getItem('nexus_shortcuts');
    if (saved) return JSON.parse(saved);
    return [
      { name: 'Google', url: 'https://www.google.com' },
      { name: 'YouTube', url: 'https://www.youtube.com' },
      { name: 'DuckDuckGo', url: 'https://duckduckgo.com' },
    ];
  });
  useEffect(() => {
    localStorage.setItem('nexus_search_engine', searchEngine);
  }, [searchEngine]);

  useEffect(() => {
    localStorage.setItem('nexus_tab_cloak', tabCloak);
    const cloak = cloaks[tabCloak];
    if (cloak) {
      document.title = cloak.title;
      const link = (document.querySelector("link[rel*='icon']") as HTMLLinkElement) || document.createElement('link');
      link.type = 'image/x-icon';
      link.rel = 'shortcut icon';
      link.href = cloak.icon;
      document.getElementsByTagName('head')[0].appendChild(link);
    }
  }, [tabCloak]);

  useEffect(() => {
    localStorage.setItem('nexus_proxy_mode', proxyMode);
  }, [proxyMode]);

  const loadingSteps = [
    { title: 'Epoxy TLS Handshake', desc: 'Establishing secure client-side TLS tunnel...' },
    { title: 'Request Interception', desc: 'Registering Service Worker proxy...' },
    { title: 'Wisp Transport', desc: 'Tunnelling over WebSocket...' },
    { title: 'Content Rewriting', desc: 'Modifying HTML/JS on the fly...' },
    { title: 'Dynamic Rendering', desc: 'Serving proxied content...' }
  ];

  useEffect(() => {
    if (isLoading) {
      const interval = setInterval(() => {
        setLoadingStep(prev => {
          if (prev < loadingSteps.length - 1) return prev + 1;
          return prev;
        });
      }, 400);
      return () => clearInterval(interval);
    } else {
      setLoadingStep(0);
    }
  }, [isLoading]);

  useEffect(() => {
    localStorage.setItem('nexus_shortcuts', JSON.stringify(shortcuts));
  }, [shortcuts]);

  // Register Service Worker and handle query params
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { scope: '/' })
        .then((registration) => {
          console.log('Service Worker registered with scope:', registration.scope);
        })
        .catch((error) => {
          console.error('Service Worker registration failed:', error);
        });
    }

    const checkBare = async () => {
      try {
        const res = await fetch('/bare/', { method: 'GET' });
        if (res.status < 500) {
          setBareStatus('online');
        } else {
          setBareStatus('offline');
        }
      } catch (e) {
        setBareStatus('offline');
      }
    };
    checkBare();
  }, []);

  const fetchCookies = async () => {
    try {
      const res = await fetch('/api/cookies');
      const data = await res.json();
      setCookies(data);
    } catch (e) {
      console.error("Failed to fetch cookies", e);
    }
  };

  const navigateTo = (url: string) => {
    if (!url) return;
    
    setIsLoading(true);
    
    let finalUrl = url;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      if (url.includes('.') && !url.includes(' ')) {
        finalUrl = 'https://' + url;
      } else {
        const engine = searchEngines[searchEngine] || searchEngines.google;
        finalUrl = `${engine}${encodeURIComponent(url)}`;
      }
    }

    const encoded = config.encodeUrl(finalUrl);
    
    // Simulate the loading process for better UX
    setTimeout(() => {
      window.location.href = `/nexus/${encoded}`;
    }, 2000);
  };

  const addShortcut = () => {
    if (newShortcutName && newShortcutUrl) {
      let url = newShortcutUrl;
      if (!url.startsWith('http')) url = 'https://' + url;
      setShortcuts([...shortcuts, { name: newShortcutName, url }]);
      setNewShortcutName('');
      setNewShortcutUrl('');
      setShowAddShortcut(false);
    }
  };

  const removeShortcut = (e: React.MouseEvent, name: string) => {
    e.stopPropagation();
    setShortcuts(shortcuts.filter(s => s.name !== name));
  };

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    navigateTo(urlInput);
  };

  const downloadOffline = () => {
    const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Nexus Standalone | Unblocked</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;800&display=swap');
        body { font-family: 'Inter', sans-serif; background: #050505; color: white; overflow-x: hidden; }
        .glass { background: rgba(255, 255, 255, 0.03); backdrop-filter: blur(12px); border: 1px solid rgba(255, 255, 255, 0.05); }
        .input-focus:focus { border-color: rgba(59, 130, 246, 0.5); box-shadow: 0 0 20px rgba(59, 130, 246, 0.1); }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
    </style>
</head>
<body class="h-screen flex flex-col overflow-hidden">
    <div class="flex-1 relative overflow-y-auto no-scrollbar">
        <div class="w-full min-h-full flex flex-col items-center justify-center max-w-4xl mx-auto space-y-16 py-20">
            <div class="text-center space-y-6">
                <div class="w-24 h-24 bg-blue-600 rounded-[2rem] flex items-center justify-center mx-auto shadow-2xl shadow-blue-600/20 mb-4">
                    <svg class="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"></path></svg>
                </div>
                <h1 class="text-8xl font-black tracking-tighter text-white uppercase">NEXUS</h1>
                <p class="text-gray-500 text-xl font-medium tracking-wide">Fast, secure, and unblocked browsing.</p>
            </div>

            <div class="w-full max-w-2xl px-6">
                <div class="relative group">
                    <input id="urlInput" type="text" placeholder="Enter a URL or search the web..." class="w-full bg-white/5 border border-white/10 rounded-[2rem] py-6 pl-8 pr-32 text-xl focus:outline-none focus:border-blue-500 transition-all shadow-2xl backdrop-blur-xl">
                    <button onclick="navigate()" class="absolute right-3 top-3 bottom-3 px-10 bg-blue-600 hover:bg-blue-500 rounded-2xl font-black text-sm transition-all shadow-lg shadow-blue-600/20 uppercase tracking-widest">GO</button>
                </div>
            </div>

            <div id="shortcutGrid" class="grid grid-cols-2 sm:grid-cols-4 gap-6 w-full max-w-2xl px-6">
                <!-- Shortcuts injected here -->
            </div>

            <div class="glass p-8 rounded-[2rem] space-y-6 max-w-md mx-auto w-full">
                <div class="space-y-2 text-left">
                    <label class="text-[10px] font-bold text-gray-500 uppercase tracking-[0.2em] ml-1">Proxy Backend URL</label>
                    <input id="proxyInput" type="text" value="${window.location.origin}" class="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 text-sm focus:outline-none input-focus transition-all">
                </div>
                <p class="text-[10px] text-gray-500 text-center uppercase tracking-widest">Standalone mode uses direct proxying.</p>
            </div>
        </div>
    </div>

    <script>
        let shortcuts = JSON.parse(localStorage.getItem('nexus_shortcuts')) || [
            { name: 'Google', url: 'https://www.google.com' },
            { name: 'YouTube', url: 'https://www.youtube.com' },
            { name: 'DuckDuckGo', url: 'https://duckduckgo.com' }
        ];

        function renderShortcuts() {
            const grid = document.getElementById('shortcutGrid');
            grid.innerHTML = '';
            shortcuts.forEach(site => {
                const div = document.createElement('div');
                div.className = 'relative group';
                div.innerHTML = \`
                    <button onclick="navigate('\${site.url}')" class="w-full flex flex-col items-center gap-4 p-6 bg-white/5 hover:bg-white/10 rounded-[2rem] border border-white/5 transition-all group">
                        <img src="https://www.google.com/s2/favicons?domain=\${new URL(site.url).hostname}&sz=64" class="w-10 h-10 rounded-xl group-hover:scale-110 transition-transform shadow-lg" referrerPolicy="no-referrer">
                        <span class="text-xs font-bold text-gray-400 group-hover:text-white uppercase tracking-widest">\${site.name}</span>
                    </button>
                \`;
                grid.appendChild(div);
            });
        }

        function encodeUrl(url) {
            return btoa(url.split('').map((char, ind) => (ind % 2 ? String.fromCharCode(char.charCodeAt(0) ^ 2) : char)).join('')).replace(/\\//g, '_').replace(/\\+/g, '-').replace(/=/g, '');
        }

        function navigate(directUrl) {
            const input = directUrl || document.getElementById('urlInput').value;
            if (!input) return;
            
            const proxyBase = document.getElementById('proxyInput').value;
            let url = input;
            if (!url.startsWith('http')) {
                if (url.includes('.') && !url.includes(' ')) {
                    url = 'https://' + url;
                } else {
                    url = 'https://www.google.com/search?q=' + encodeURIComponent(url);
                }
            }
            
            const encoded = encodeUrl(url);
            window.location.href = proxyBase + "/nexus/" + encoded;
        }

        document.getElementById('urlInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') navigate();
        });

        renderShortcuts();
    </script>
</body>
</html>`;
    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'nexus-standalone.html';
    a.click();
  };

  const SidebarItem = ({ id, icon: Icon, label }: { id: typeof currentView; icon: any; label: string }) => (
    <button
      onClick={() => setCurrentView(id)}
      className={`w-full flex items-center gap-4 px-6 py-4 transition-all group relative ${currentView === id ? 'text-blue-500' : 'text-gray-500 hover:text-gray-300'}`}
    >
      {currentView === id && (
        <motion.div 
          layoutId="sidebar-active"
          className="absolute left-0 w-1 h-8 bg-blue-600 rounded-r-full"
        />
      )}
      <Icon className={`w-5 h-5 transition-transform group-hover:scale-110 ${currentView === id ? 'text-blue-500' : ''}`} />
      <span className="text-xs font-black uppercase tracking-widest">{label}</span>
    </button>
  );

  return (
    <div className="flex h-screen bg-[#050505] text-white font-sans overflow-hidden">
      {/* Sidebar */}
      <div className="w-64 bg-[#0a0a0a] border-r border-white/5 flex flex-col py-8 z-50">
        <div className="px-8 mb-12 flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-600/20">
            <Shield className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-2xl font-black tracking-tighter uppercase">NEXUS</h1>
        </div>

        <nav className="flex-1 space-y-2">
          <SidebarItem id="home" icon={Home} label="Home" />
          <SidebarItem id="apps" icon={LayoutGrid} label="Apps" />
          <SidebarItem id="games" icon={Gamepad2} label="Games" />
          <SidebarItem id="youtube" icon={Youtube} label="YouTube" />
          <div className="pt-8 mt-8 border-t border-white/5">
            <SidebarItem id="settings" icon={Settings} label="Settings" />
          </div>
        </nav>

        <div className="px-6 mt-auto">
          <div className="p-4 bg-white/5 rounded-2xl border border-white/5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Status</span>
              <div className={`w-2 h-2 rounded-full ${bareStatus === 'online' ? 'bg-green-500' : 'bg-red-500'}`} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Transport</span>
              <span className="text-[10px] font-black text-blue-500 uppercase tracking-widest">Epoxy</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 relative overflow-y-auto no-scrollbar bg-[radial-gradient(circle_at_top_right,rgba(37,99,235,0.05),transparent_40%)]">
        <AnimatePresence mode="wait">
          {currentView === 'home' && (
            <motion.div 
              key="home"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="w-full min-h-full flex flex-col items-center justify-center max-w-4xl mx-auto space-y-16 py-20"
            >
              <div className="text-center space-y-6">
                <h1 className="text-8xl font-black tracking-tighter text-white uppercase">
                  NEXUS
                </h1>
                <p className="text-gray-500 text-xl font-medium tracking-wide italic">The Interception-Based Web Proxy.</p>
              </div>

              <div className="w-full max-w-2xl px-6">
                <form onSubmit={handleUrlSubmit} className="relative group">
                  <input
                    type="text"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    placeholder="Enter a URL or search the web..."
                    className="w-full bg-white/5 border border-white/10 rounded-[2rem] py-6 pl-8 pr-32 text-xl focus:outline-none focus:border-blue-500 transition-all shadow-2xl backdrop-blur-xl"
                  />
                  <button 
                    type="submit"
                    className="absolute right-3 top-3 bottom-3 px-10 bg-blue-600 hover:bg-blue-500 rounded-2xl font-black text-sm transition-all shadow-lg shadow-blue-600/20 uppercase tracking-widest"
                  >
                    GO
                  </button>
                </form>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 w-full max-w-2xl px-6">
                {shortcuts.map((site) => (
                  <div key={site.name} className="relative group">
                    <button
                      onClick={() => navigateTo(site.url)}
                      className="w-full flex flex-col items-center gap-4 p-6 bg-white/5 hover:bg-white/10 rounded-[2rem] border border-white/5 transition-all group"
                    >
                      <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform shadow-lg">
                        <Globe className="w-6 h-6 text-gray-400 group-hover:text-white" />
                      </div>
                      <span className="text-xs font-bold text-gray-400 group-hover:text-white uppercase tracking-widest">{site.name}</span>
                    </button>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {currentView === 'apps' && (
            <motion.div 
              key="apps"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="w-full max-w-6xl mx-auto py-20 px-12"
            >
              <div className="mb-12">
                <h2 className="text-6xl font-black tracking-tighter uppercase mb-4">Apps</h2>
                <p className="text-gray-500 font-medium tracking-wide italic">Access your favorite web applications securely.</p>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-6">
                {apps.map((app) => (
                  <button
                    key={app.name}
                    onClick={() => navigateTo(app.url)}
                    className="flex flex-col items-center gap-6 p-8 bg-white/5 hover:bg-white/10 rounded-[2.5rem] border border-white/5 transition-all group"
                  >
                    <div className="w-20 h-20 bg-white/5 rounded-3xl flex items-center justify-center group-hover:scale-110 transition-transform shadow-2xl overflow-hidden p-4">
                      <img src={app.icon} alt={app.name} className="w-full h-full object-contain" referrerPolicy="no-referrer" />
                    </div>
                    <span className="text-sm font-black uppercase tracking-widest text-gray-400 group-hover:text-white">{app.name}</span>
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {currentView === 'games' && (
            <motion.div 
              key="games"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="w-full max-w-6xl mx-auto py-20 px-12"
            >
              <div className="mb-12">
                <h2 className="text-6xl font-black tracking-tighter uppercase mb-4">Games</h2>
                <p className="text-gray-500 font-medium tracking-wide italic">Unblocked gaming at your fingertips.</p>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-6">
                {games.map((game) => (
                  <button
                    key={game.name}
                    onClick={() => navigateTo(game.url)}
                    className="flex flex-col items-center gap-6 p-8 bg-white/5 hover:bg-white/10 rounded-[2.5rem] border border-white/5 transition-all group"
                  >
                    <div className="w-20 h-20 bg-white/5 rounded-3xl flex items-center justify-center group-hover:scale-110 transition-transform shadow-2xl overflow-hidden p-4">
                      <img src={game.icon} alt={game.name} className="w-full h-full object-contain" referrerPolicy="no-referrer" />
                    </div>
                    <span className="text-sm font-black uppercase tracking-widest text-gray-400 group-hover:text-white">{game.name}</span>
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {currentView === 'youtube' && (
            <motion.div 
              key="youtube"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="w-full min-h-full flex flex-col items-center justify-center max-w-4xl mx-auto space-y-12 py-20"
            >
              <div className="text-center space-y-6">
                <div className="w-24 h-24 bg-red-600 rounded-[2rem] flex items-center justify-center mx-auto shadow-2xl shadow-red-600/20 mb-4">
                  <Youtube className="w-12 h-12 text-white" />
                </div>
                <h2 className="text-6xl font-black tracking-tighter uppercase">YouTube</h2>
                <p className="text-gray-500 font-medium tracking-wide italic">Watch videos without restrictions.</p>
              </div>
              <button
                onClick={() => navigateTo('https://www.youtube.com')}
                className="px-12 py-6 bg-red-600 hover:bg-red-500 rounded-[2rem] text-xl font-black transition-all shadow-2xl shadow-red-600/20 uppercase tracking-widest flex items-center gap-4"
              >
                Launch YouTube
                <ExternalLink className="w-6 h-6" />
              </button>
            </motion.div>
          )}

          {currentView === 'settings' && (
            <motion.div 
              key="settings"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="w-full max-w-4xl mx-auto py-20 px-12"
            >
              <div className="mb-12">
                <h2 className="text-6xl font-black tracking-tighter uppercase mb-4">Settings</h2>
                <p className="text-gray-500 font-medium tracking-wide italic">Customize your Nexus experience.</p>
              </div>

              <div className="space-y-12">
                {/* Tab Cloak */}
                <section className="space-y-6">
                  <div className="flex items-center gap-3 px-2">
                    <Globe className="w-5 h-5 text-blue-500" />
                    <h3 className="text-xs font-black uppercase tracking-widest text-gray-400">Tab Cloaking</h3>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    {Object.entries(cloaks).map(([key, cloak]) => (
                      <button
                        key={key}
                        onClick={() => setTabCloak(key)}
                        className={`p-6 rounded-3xl border transition-all flex flex-col items-center gap-4 ${tabCloak === key ? 'bg-blue-600/10 border-blue-500/50' : 'bg-white/5 border-white/5 hover:bg-white/10'}`}
                      >
                        <img src={cloak.icon} alt={cloak.title} className="w-8 h-8 rounded-lg" referrerPolicy="no-referrer" />
                        <span className="text-[10px] font-bold uppercase tracking-widest text-center">{cloak.title}</span>
                        {tabCloak === key && <Check className="w-4 h-4 text-blue-500" />}
                      </button>
                    ))}
                  </div>
                </section>

                {/* Search Engine */}
                <section className="space-y-6">
                  <div className="flex items-center gap-3 px-2">
                    <Search className="w-5 h-5 text-blue-500" />
                    <h3 className="text-xs font-black uppercase tracking-widest text-gray-400">Search Engine</h3>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    {Object.keys(searchEngines).map((engine) => (
                      <button
                        key={engine}
                        onClick={() => setSearchEngine(engine)}
                        className={`p-6 rounded-3xl border transition-all flex flex-col items-center gap-4 ${searchEngine === engine ? 'bg-blue-600/10 border-blue-500/50' : 'bg-white/5 border-white/5 hover:bg-white/10'}`}
                      >
                        <span className="text-[10px] font-black uppercase tracking-widest">{engine}</span>
                        {searchEngine === engine && <Check className="w-4 h-4 text-blue-500" />}
                      </button>
                    ))}
                  </div>
                </section>

                {/* Proxy Management */}
                <section className="space-y-6">
                  <div className="flex items-center gap-3 px-2">
                    <Shield className="w-5 h-5 text-blue-500" />
                    <h3 className="text-xs font-black uppercase tracking-widest text-gray-400">Proxy Management</h3>
                  </div>
                  <div className="bg-white/5 rounded-[2.5rem] border border-white/5 p-8 space-y-8">
                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <p className="text-sm font-black uppercase tracking-widest">Service Worker Interception</p>
                        <p className="text-[10px] text-gray-500 font-medium">Standard proxy method using SW fetch events.</p>
                      </div>
                      <div className="w-12 h-6 bg-blue-600 rounded-full p-1 flex justify-end">
                        <div className="w-4 h-4 bg-white rounded-full" />
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <p className="text-sm font-black uppercase tracking-widest">Epoxy TLS Transport</p>
                        <p className="text-[10px] text-gray-500 font-medium">Enhanced client-side TLS stack for better compatibility.</p>
                      </div>
                      <div className="w-12 h-6 bg-blue-600 rounded-full p-1 flex justify-end">
                        <div className="w-4 h-4 bg-white rounded-full" />
                      </div>
                    </div>
                    <div className="pt-8 border-t border-white/5">
                      <button 
                        onClick={() => {
                          if (confirm('Clear all session data?')) {
                            localStorage.clear();
                            window.location.reload();
                          }
                        }}
                        className="w-full py-4 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-2xl text-xs font-black uppercase tracking-widest transition-all border border-red-500/20 flex items-center justify-center gap-3"
                      >
                        <Trash2 className="w-4 h-4" />
                        Clear All Data
                      </button>
                    </div>
                  </div>
                </section>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Loading Overlay */}
      <AnimatePresence>
        {isLoading && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[1000] bg-black/90 backdrop-blur-2xl flex flex-col items-center justify-center p-6"
          >
            <div className="w-full max-w-md space-y-12">
              <div className="text-center space-y-4">
                <motion.div 
                  animate={{ rotate: 360 }}
                  transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
                  className="w-20 h-20 bg-blue-600/20 rounded-[2rem] flex items-center justify-center mx-auto border border-blue-500/30"
                >
                  <RotateCw className="w-10 h-10 text-blue-500" />
                </motion.div>
                <h2 className="text-4xl font-black tracking-tighter uppercase">NEXUS LOADING</h2>
                <p className="text-gray-500 text-sm font-bold uppercase tracking-widest">Intercepting and Rewriting...</p>
              </div>

              <div className="space-y-6">
                {loadingSteps.map((step, index) => (
                  <motion.div 
                    key={index}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ 
                      opacity: index <= loadingStep ? 1 : 0.2, 
                      x: index <= loadingStep ? 0 : -20,
                      scale: index === loadingStep ? 1.05 : 1
                    }}
                    className={`flex items-center gap-6 p-4 rounded-2xl border transition-all ${index === loadingStep ? 'bg-blue-600/10 border-blue-500/30' : 'bg-white/5 border-white/5'}`}
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-black text-xs ${index <= loadingStep ? 'bg-blue-600 text-white' : 'bg-white/10 text-gray-500'}`}>
                      {index + 1}
                    </div>
                    <div className="flex-1">
                      <p className={`text-xs font-black uppercase tracking-widest ${index <= loadingStep ? 'text-white' : 'text-gray-600'}`}>{step.title}</p>
                      <p className="text-[10px] text-gray-500 font-medium">{step.desc}</p>
                    </div>
                    {index < loadingStep && (
                      <motion.div 
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        className="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center"
                      >
                        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>
                      </motion.div>
                    )}
                  </motion.div>
                ))}
              </div>

              <div className="w-full bg-white/5 h-1 rounded-full overflow-hidden">
                <motion.div 
                  initial={{ width: 0 }}
                  animate={{ width: `${((loadingStep + 1) / loadingSteps.length) * 100}%` }}
                  className="h-full bg-blue-600 shadow-[0_0_20px_rgba(37,99,235,0.5)]"
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
