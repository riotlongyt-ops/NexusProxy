import React, { useState, useEffect } from 'react';
import { 
  Search, 
  Shield, 
  Settings, 
  History,
  X,
  Plus,
  Globe,
  Download,
  Trash2,
  RotateCw
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

export default function App() {
  const [urlInput, setUrlInput] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showCookies, setShowCookies] = useState(false);
  const [vercelMode, setVercelMode] = useState(() => localStorage.getItem('vercelMode') === 'true');

  useEffect(() => {
    localStorage.setItem('vercelMode', vercelMode.toString());
  }, [vercelMode]);
  const [bareStatus, setBareStatus] = useState<'online' | 'offline' | 'checking'>('checking');

  useEffect(() => {
    const checkBare = async () => {
      try {
        const res = await fetch('/bare/');
        if (res.ok) setBareStatus('online');
        else setBareStatus('offline');
      } catch {
        setBareStatus('offline');
      }
    };
    checkBare();
  }, []);

  const [cookies, setCookies] = useState<any[]>([]);
  
  const [shortcuts, setShortcuts] = useState<{ name: string; url: string }[]>(() => {
    const saved = localStorage.getItem('nexus_shortcuts');
    if (saved) return JSON.parse(saved);
    return [
      { name: 'Google', url: 'https://www.google.com' },
      { name: 'YouTube', url: 'https://www.youtube.com' },
      { name: 'DuckDuckGo', url: 'https://duckduckgo.com' },
      { name: 'Crazy Games', url: 'https://www.crazygames.com' },
      { name: 'Poki', url: 'https://poki.com' },
      { name: 'Discord', url: 'https://discord.com' },
      { name: 'Reddit', url: 'https://www.reddit.com' },
      { name: 'GitHub', url: 'https://github.com' },
    ];
  });
  const [showAddShortcut, setShowAddShortcut] = useState(false);
  const [newShortcutName, setNewShortcutName] = useState('');
  const [newShortcutUrl, setNewShortcutUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);

  const loadingSteps = [
    { title: 'Request Interception', desc: 'Registering Service Worker proxy...' },
    { title: 'URL Encoding', desc: 'XOR-Base64 codec transformation...' },
    { title: 'Wisp Transport', desc: 'Establishing WebSocket tunnel...' },
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
    const params = new URLSearchParams(window.location.search);
    if (params.get('settings') === 'true') setShowSettings(true);
    if (params.get('cookies') === 'true') {
      setShowCookies(true);
      fetchCookies();
    }

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { scope: '/' })
        .then((registration) => {
          console.log('Service Worker registered with scope:', registration.scope);
        })
        .catch((error) => {
          console.error('Service Worker registration failed:', error);
        });
    }
  }, []);

  useEffect(() => {
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
        finalUrl = `https://www.google.com/search?q=${encodeURIComponent(url)}`;
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

  return (
    <div className="flex flex-col h-screen bg-[#050505] text-white font-sans overflow-hidden">
      {/* Home Screen Content */}
      <div className="flex-1 relative overflow-y-auto no-scrollbar">
        <div className="w-full min-h-full flex flex-col items-center justify-center max-w-4xl mx-auto space-y-16 py-20">
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center space-y-6"
          >
            <div className="w-24 h-24 bg-blue-600 rounded-[2rem] flex items-center justify-center mx-auto shadow-2xl shadow-blue-600/20 mb-4">
              <Globe className="w-12 h-12 text-white" />
            </div>
            <h1 className="text-8xl font-black tracking-tighter text-white uppercase">
              NEXUS
            </h1>
            <p className="text-gray-500 text-xl font-medium tracking-wide">Fast, secure, and unblocked browsing.</p>
          </motion.div>

          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1 }}
            className="w-full max-w-2xl px-6"
          >
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
          </motion.div>

          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="grid grid-cols-2 sm:grid-cols-4 gap-6 w-full max-w-2xl px-6"
          >
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
                <button 
                  onClick={(e) => removeShortcut(e, site.name)}
                  className="absolute top-3 right-3 p-1.5 bg-red-500/20 hover:bg-red-500 text-red-400 hover:text-white rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
            <button
              onClick={() => setShowAddShortcut(true)}
              className="flex flex-col items-center justify-center gap-4 p-6 bg-white/5 hover:bg-white/10 rounded-[2rem] border border-dashed border-white/20 transition-all group"
            >
              <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform">
                <Plus className="w-6 h-6 text-gray-400 group-hover:text-white" />
              </div>
              <span className="text-xs font-bold text-gray-400 group-hover:text-white uppercase tracking-widest">Add Shortcut</span>
            </button>
          </motion.div>

          <div className="flex gap-6">
            <button 
              onClick={() => setShowSettings(true)}
              className="px-8 py-3 bg-white/5 hover:bg-white/10 rounded-2xl text-sm font-bold border border-white/10 transition-all flex items-center gap-3 uppercase tracking-widest"
            >
              <Settings className="w-4 h-4" />
              Settings
            </button>
            <button 
              onClick={downloadOffline}
              className="px-8 py-3 bg-white/5 hover:bg-white/10 rounded-2xl text-sm font-bold border border-white/10 transition-all flex items-center gap-3 uppercase tracking-widest"
            >
              <Download className="w-4 h-4" />
              Offline
            </button>
          </div>

          {/* Loading Process Section */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="w-full max-w-2xl px-6 pt-12"
          >
            <div className="glass p-10 rounded-[2.5rem] space-y-8">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-blue-600/20 rounded-xl flex items-center justify-center">
                  <Shield className="w-5 h-5 text-blue-500" />
                </div>
                <h2 className="text-2xl font-black tracking-tighter uppercase">The Loading Process</h2>
              </div>
              
              <div className="grid gap-6 text-left">
                <div className="space-y-2">
                  <h3 className="text-[10px] font-bold text-blue-500 uppercase tracking-[0.2em]">Request Interception</h3>
                  <p className="text-sm text-gray-400 leading-relaxed">Registers a Service Worker that acts as a programmable network proxy, intercepting all outgoing fetch and asset requests before they reach the browser's standard network layer.</p>
                </div>
                
                <div className="space-y-2">
                  <h3 className="text-[10px] font-bold text-blue-500 uppercase tracking-[0.2em]">URL Encoding/Decoding</h3>
                  <p className="text-sm text-gray-400 leading-relaxed">Real website URLs are encoded into "proxy URLs" using custom XOR-Base64 codecs. When you enter a site, it's converted into a path like <code className="bg-white/5 px-2 py-0.5 rounded text-blue-400">/nexus/encoded_string</code>.</p>
                </div>
                
                <div className="space-y-2">
                  <h3 className="text-[10px] font-bold text-blue-500 uppercase tracking-[0.2em]">Wisp Protocol Transport</h3>
                  <p className="text-sm text-gray-400 leading-relaxed">To move data past restrictive firewalls, Nexus uses the Wisp protocol to tunnel multiple TCP/UDP connections over a single WebSocket connection, masking traffic as standard web activity.</p>
                </div>
                
                <div className="space-y-2">
                  <h3 className="text-[10px] font-bold text-blue-500 uppercase tracking-[0.2em]">Content Rewriting</h3>
                  <p className="text-sm text-gray-400 leading-relaxed">A JavaScript rewriter modifies HTML, CSS, and JS on the fly, ensuring all links, scripts, and media are routed back through the Nexus proxy instead of connecting directly to original servers.</p>
                </div>
                
                <div className="space-y-2">
                  <h3 className="text-[10px] font-bold text-blue-500 uppercase tracking-[0.2em]">Dynamic Rendering</h3>
                  <p className="text-sm text-gray-400 leading-relaxed">The Service Worker serves modified content back to the browser tab, allowing the site to function normally even though every request is being proxied.</p>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Status Bar */}
      <div className="h-10 bg-[#0a0a0a] border-t border-white/5 flex items-center px-6 justify-between text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
            <div className={`w-1.5 h-1.5 rounded-full ${bareStatus === 'online' ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]'}`} />
            Bare Server: {bareStatus}
          </div>
          <div className="flex items-center gap-3">
            <div className={`w-1.5 h-1.5 rounded-full ${bareStatus === 'online' ? 'bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]' : 'bg-gray-500'}`} />
            Wisp Protocol: {bareStatus === 'online' ? 'Active' : 'Standby'}
          </div>
        </div>
        <div>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
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
                        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"></path></svg>
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

      {/* Modals */}
      <AnimatePresence>
        {showAddShortcut && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="w-full max-w-md bg-[#111] border border-white/10 rounded-[2.5rem] p-10 shadow-2xl space-y-8"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-3xl font-black tracking-tighter text-white uppercase">Add Shortcut</h2>
                <button onClick={() => setShowAddShortcut(false)} className="p-2 hover:bg-white/5 rounded-xl transition-all">
                  <X className="w-6 h-6 text-gray-400" />
                </button>
              </div>
              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.2em] ml-1">Name</label>
                  <input 
                    type="text" 
                    value={newShortcutName}
                    onChange={(e) => setNewShortcutName(e.target.value)}
                    placeholder="e.g. Google" 
                    className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 text-sm focus:outline-none focus:border-blue-500 transition-all" 
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.2em] ml-1">URL</label>
                  <input 
                    type="text" 
                    value={newShortcutUrl}
                    onChange={(e) => setNewShortcutUrl(e.target.value)}
                    placeholder="e.g. google.com" 
                    className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 text-sm focus:outline-none focus:border-blue-500 transition-all" 
                  />
                </div>
              </div>
              <button 
                onClick={addShortcut}
                className="w-full py-5 bg-blue-600 hover:bg-blue-500 rounded-2xl text-lg font-black transition-all shadow-xl shadow-blue-600/20 uppercase tracking-widest"
              >
                Add Shortcut
              </button>
            </motion.div>
          </div>
        )}

        {showCookies && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="w-full max-w-2xl bg-[#111] border border-white/10 rounded-[2.5rem] p-10 shadow-2xl space-y-8 max-h-[80vh] overflow-y-auto no-scrollbar"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-3xl font-black tracking-tighter text-white uppercase">Cookie Manager</h2>
                <button onClick={() => setShowCookies(false)} className="p-2 hover:bg-white/5 rounded-xl transition-all">
                  <X className="w-6 h-6 text-gray-400" />
                </button>
              </div>
              
              <div className="space-y-6">
                <div className="flex items-center justify-between bg-white/5 p-6 rounded-3xl border border-white/5">
                  <div>
                    <p className="text-sm font-bold text-white">Active Session Cookies</p>
                    <p className="text-xs text-gray-500">These cookies are stored in your current proxy session.</p>
                  </div>
                  <button 
                    onClick={fetchCookies}
                    className="p-3 bg-blue-600/10 hover:bg-blue-600/20 text-blue-500 rounded-xl transition-all"
                  >
                    <RotateCw className="w-5 h-5" />
                  </button>
                </div>

                <div className="space-y-3">
                  {cookies.length > 0 ? (
                    cookies.map((c, i) => (
                      <div key={i} className="bg-white/5 rounded-2xl p-6 border border-white/5 space-y-2 group">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-black text-blue-500 uppercase tracking-widest">{c.domain || 'Global'}</span>
                          <span className="text-[10px] font-bold text-gray-600 uppercase tracking-widest">{c.key}</span>
                        </div>
                        <p className="text-xs font-mono break-all text-gray-400 bg-black/20 p-3 rounded-xl">{c.value}</p>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-20 bg-white/5 rounded-[2rem] border border-dashed border-white/10">
                      <p className="text-sm font-bold text-gray-600 uppercase tracking-widest">No cookies found</p>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {showSettings && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="w-full max-w-2xl bg-[#111] border border-white/10 rounded-[2.5rem] p-10 shadow-2xl space-y-8 max-h-[80vh] overflow-y-auto no-scrollbar"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-3xl font-black tracking-tighter text-white uppercase">Settings</h2>
                <button onClick={() => setShowSettings(false)} className="p-2 hover:bg-white/5 rounded-xl transition-all">
                  <X className="w-6 h-6 text-gray-400" />
                </button>
              </div>
              
              <div className="space-y-10">
                <section className="space-y-4">
                  <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.2em] ml-1">General Settings</h3>
                  <div className="bg-white/5 rounded-3xl p-6 space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-bold text-white uppercase tracking-widest">Vercel Mode</p>
                        <p className="text-[10px] text-gray-500 uppercase tracking-widest">Optimizes proxy for Vercel's serverless environment.</p>
                      </div>
                      <button 
                        onClick={() => setVercelMode(!vercelMode)}
                        className={`w-14 h-8 rounded-full p-1 transition-all ${vercelMode ? 'bg-blue-600' : 'bg-white/10'}`}
                      >
                        <div className={`w-6 h-6 bg-white rounded-full transition-all transform ${vercelMode ? 'translate-x-6' : 'translate-x-0'}`} />
                      </button>
                    </div>
                  </div>
                </section>

                <section className="space-y-4">
                  <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.2em] ml-1">Session Management</h3>
                  <div className="bg-white/5 rounded-3xl p-6 space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-bold text-white">Clear All Cookies</p>
                        <p className="text-xs text-gray-500">Reset your browsing session and delete all site data.</p>
                      </div>
                      <button 
                        onClick={() => {
                          if (confirm('Are you sure? This will clear all cookies.')) {
                            document.cookie = 'SessionID=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
                            window.location.reload();
                          }
                        }}
                        className="p-3 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-xl transition-all"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                </section>

                <section className="space-y-4">
                  <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.2em] ml-1">Proxy Information</h3>
                  <div className="bg-white/5 rounded-3xl p-6 space-y-4">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-bold text-white">Service Worker Status</p>
                      <span className="text-xs font-bold text-green-500 uppercase tracking-widest">Active</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-bold text-white">Encoding Method</p>
                      <span className="text-xs font-bold text-blue-500 uppercase tracking-widest">XOR-Base64</span>
                    </div>
                  </div>
                </section>

                <section className="space-y-4">
                  <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.2em] ml-1">Active Cookies</h3>
                  <button 
                    onClick={fetchCookies}
                    className="w-full py-4 bg-white/5 hover:bg-white/10 rounded-2xl text-xs font-bold uppercase tracking-widest transition-all border border-white/5"
                  >
                    Load Cookies
                  </button>
                  {cookies.length > 0 && (
                    <div className="space-y-2">
                      {cookies.map((c, i) => (
                        <div key={i} className="bg-white/5 rounded-2xl p-4 text-[10px] font-mono break-all border border-white/5">
                          <span className="text-blue-400">{c.domain}</span>: {c.key}={c.value}
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
