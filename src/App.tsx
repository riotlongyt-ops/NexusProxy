import React, { useState, useRef, useEffect } from 'react';
import { 
  Search, 
  ArrowLeft, 
  ArrowRight, 
  RotateCw, 
  Home, 
  Shield, 
  Settings, 
  History,
  ExternalLink,
  X,
  Plus,
  Monitor,
  Smartphone,
  Globe
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface Tab {
  id: string;
  url: string;
  title: string;
  favicon?: string;
}

export default function App() {
  const [tabs, setTabs] = useState<Tab[]>([
    { id: '1', url: '', title: 'Home' }
  ]);
  const [activeTabId, setActiveTabId] = useState('1');
  const [urlInput, setUrlInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'desktop' | 'mobile'>('desktop');
  const [useProxy, setUseProxy] = useState(true); // Default to true
  const [showSettings, setShowSettings] = useState(false);
  const [bareServerUrl, setBareServerUrl] = useState(`${window.location.origin}/bare/`);
  const [bareStatus, setBareStatus] = useState<'online' | 'offline' | 'checking'>('checking');
  const [cookies, setCookies] = useState<any[]>([]);
  
  const [showHome, setShowHome] = useState(true);
  const [showStartMenu, setShowStartMenu] = useState(false);
  
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

  useEffect(() => {
    localStorage.setItem('nexus_shortcuts', JSON.stringify(shortcuts));
  }, [shortcuts]);

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

  const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0];
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const getDisplayUrl = (url: string) => {
    if (url.includes('/api/proxy')) {
      try {
        const urlObj = new URL(url, window.location.origin);
        const target = urlObj.searchParams.get('url');
        if (target) return target;
        
        // If 'url' is missing but it's clearly a search (common after GET form submission)
        if (urlObj.searchParams.has('q')) {
          return `https://www.google.com/search${urlObj.search}`;
        }
      } catch (e) {
        return url;
      }
    }
    return url;
  };

  // Listen for messages from the proxied iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'PROXY_URL_CHANGE') {
        const newUrl = event.data.url;
        setUrlInput(newUrl);
        setTabs(prev => prev.map(t => t.id === activeTabId ? { 
          ...t, 
          url: `${window.location.origin}/api/proxy?url=${encodeURIComponent(newUrl)}`,
          title: newUrl.split('//')[1]?.split('/')[0] || newUrl 
        } : t));
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [activeTabId]);

  useEffect(() => {
    const checkBare = async () => {
      try {
        // Bare server root usually responds to TompHTTP requests, 
        // but we can check if the endpoint is reachable.
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

  const navigateTo = (url: string, forceProxy: boolean = false) => {
    if (!url) return;
    setShowHome(false);
    if (url.toLowerCase() === 'nexus://cookies') {
      fetchCookies();
      setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, url: 'nexus://cookies', title: 'Cookie Manager' } : t));
      setUrlInput('nexus://cookies');
      return;
    }

    let finalUrl = url;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      if (url.includes('.') && !url.includes(' ')) {
        finalUrl = 'https://' + url;
      } else {
        // Use the proxy for search results too, no more 'igu=1' fake proxy
        finalUrl = `https://www.google.com/search?q=${encodeURIComponent(url)}`;
      }
    }

    // Always use the proxy for everything
    const effectiveUrl = `${window.location.origin}/api/proxy?url=${encodeURIComponent(finalUrl)}`;

    const newTabs = tabs.map(t => {
      if (t.id === activeTabId) {
        return { ...t, url: effectiveUrl, title: finalUrl.split('//')[1]?.split('/')[0] || finalUrl };
      }
      return t;
    });
    setTabs(newTabs);
    setUrlInput(finalUrl);
    setIsLoading(true);
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
        #browser { background: white; }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
    </style>
</head>
<body class="h-screen flex flex-col overflow-hidden">
    <div class="h-16 bg-[#0a0a0a] border-b border-white/5 flex items-center px-6 gap-4 z-20">
        <div class="flex items-center gap-3 mr-4 cursor-pointer" onclick="goHome()">
            <div class="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-blue-600/20">
                <svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"></path></svg>
            </div>
            <span class="font-black tracking-tighter text-xl">NEXUS</span>
        </div>
        
        <div class="flex-1 max-w-3xl flex items-center gap-2">
            <input id="urlInput" type="text" placeholder="Search or enter address" class="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm focus:outline-none input-focus transition-all">
            <button onclick="navigate()" class="p-2 bg-blue-600 hover:bg-blue-500 rounded-xl transition-all shadow-lg shadow-blue-600/20">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg>
            </button>
        </div>

        <div class="flex items-center gap-2 ml-auto">
            <button onclick="goHome()" class="p-2 hover:bg-white/5 rounded-xl text-gray-400 transition-all">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"></path></svg>
            </button>
            <button onclick="document.getElementById('welcome').style.display = 'flex'" class="p-2 hover:bg-white/5 rounded-xl text-gray-400 transition-all">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
            </button>
        </div>
    </div>
    
    <div class="flex-1 relative overflow-hidden">
        <iframe id="browser" class="w-full h-full border-none" src="about:blank" allowfullscreen allow="fullscreen; geolocation; microphone; camera; midi; encrypted-media; clipboard-read; clipboard-write"></iframe>
        
        <div id="welcome" class="absolute inset-0 flex flex-col items-center justify-start py-20 bg-[#050505] z-10 overflow-y-auto no-scrollbar">
            <div class="text-center space-y-12 w-full max-w-4xl px-6">
                <div class="space-y-4">
                    <div class="w-20 h-20 bg-blue-600/20 rounded-[2rem] flex items-center justify-center mx-auto mb-4">
                        <svg class="w-10 h-10 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"></path></svg>
                    </div>
                    <h1 class="text-7xl font-black text-white tracking-tighter uppercase">Nexus <span class="text-blue-500">Standalone</span></h1>
                    <p class="text-gray-500 text-xl font-medium">The ultimate portable unblocker.</p>
                </div>

                <div id="shortcutGrid" class="grid grid-cols-2 sm:grid-cols-4 gap-4 w-full max-w-2xl mx-auto">
                    <!-- Shortcuts injected here -->
                </div>

                <div class="flex justify-center">
                    <button onclick="document.getElementById('addShortcutModal').style.display = 'flex'" class="flex flex-col items-center justify-center gap-3 p-4 bg-white/5 hover:bg-white/10 rounded-2xl border border-dashed border-white/20 transition-all group w-full max-w-[150px]">
                        <div class="w-8 h-8 bg-white/10 rounded-lg flex items-center justify-center group-hover:scale-110 transition-transform">
                            <svg class="w-5 h-5 text-gray-400 group-hover:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
                        </div>
                        <span class="text-xs font-semibold text-gray-400 group-hover:text-white">Add Shortcut</span>
                    </button>
                </div>

                <div class="glass p-8 rounded-[2rem] space-y-6 max-w-md mx-auto">
                    <div class="space-y-2 text-left">
                        <label class="text-[10px] font-bold text-gray-500 uppercase tracking-[0.2em] ml-1">Proxy Backend URL</label>
                        <input id="proxyInput" type="text" value="${window.location.origin}" class="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 text-sm focus:outline-none input-focus transition-all" placeholder="https://your-nexus-instance.run.app">
                    </div>
                    <button onclick="startBrowsing()" class="w-full py-4 bg-blue-600 hover:bg-blue-500 rounded-2xl text-lg font-black transition-all shadow-xl shadow-blue-600/20 uppercase tracking-widest">Connect Proxy</button>
                    <div class="flex items-center justify-center gap-2">
                        <p class="text-[10px] text-gray-600 font-bold uppercase tracking-widest">Session ID:</p>
                        <span id="sessionDisplay" class="text-[10px] text-blue-500 font-mono font-bold">Checking...</span>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <div id="addShortcutModal" class="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" style="display: none;">
        <div class="w-full max-w-md bg-[#1a1a1a] border border-white/10 rounded-[2rem] p-8 shadow-2xl space-y-6">
            <div class="flex items-center justify-between">
                <h2 class="text-2xl font-black tracking-tighter text-white uppercase">Add Shortcut</h2>
                <button onclick="document.getElementById('addShortcutModal').style.display = 'none'" class="p-2 hover:bg-white/5 rounded-xl transition-all">
                    <svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
            </div>
            <div class="space-y-4">
                <div class="space-y-2">
                    <label class="text-[10px] font-bold text-gray-500 uppercase tracking-[0.2em] ml-1">Name</label>
                    <input id="newShortcutName" type="text" placeholder="e.g. Google" class="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 text-sm focus:outline-none focus:border-blue-500 transition-all">
                </div>
                <div class="space-y-2">
                    <label class="text-[10px] font-bold text-gray-500 uppercase tracking-[0.2em] ml-1">URL</label>
                    <input id="newShortcutUrl" type="text" placeholder="e.g. google.com" class="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 text-sm focus:outline-none focus:border-blue-500 transition-all">
                </div>
            </div>
            <button onclick="addShortcutOffline()" class="w-full py-4 bg-blue-600 hover:bg-blue-500 rounded-2xl text-lg font-black transition-all shadow-xl shadow-blue-600/20 uppercase tracking-widest">Add Shortcut</button>
        </div>
    </div>

    <script>
        let PROXY_BASE = "";
        let shortcuts = JSON.parse(localStorage.getItem('nexus_shortcuts')) || [
            { name: 'Google', url: 'https://www.google.com' },
            { name: 'YouTube', url: 'https://www.youtube.com' },
            { name: 'DuckDuckGo', url: 'https://duckduckgo.com' },
            { name: 'Crazy Games', url: 'https://www.crazygames.com' },
            { name: 'Poki', url: 'https://poki.com' },
            { name: 'Discord', url: 'https://discord.com' },
            { name: 'Reddit', url: 'https://www.reddit.com' },
            { name: 'GitHub', url: 'https://github.com' }
        ];

        function renderShortcuts() {
            const grid = document.getElementById('shortcutGrid');
            grid.innerHTML = '';
            shortcuts.forEach(site => {
                const div = document.createElement('div');
                div.className = 'relative group';
                div.innerHTML = \`
                    <button onclick="navigate('\${site.url}')" class="w-full flex flex-col items-center gap-3 p-4 bg-white/5 hover:bg-white/10 rounded-2xl border border-white/5 transition-all">
                        <img src="https://www.google.com/s2/favicons?domain=\${new URL(site.url).hostname}&sz=64" class="w-8 h-8 rounded-lg group-hover:scale-110 transition-transform" referrerPolicy="no-referrer">
                        <span class="text-xs font-semibold text-gray-400 group-hover:text-white">\${site.name}</span>
                    </button>
                    <button onclick="removeShortcutOffline(event, '\${site.name}')" class="absolute top-2 right-2 p-1 bg-red-500/20 hover:bg-red-500 text-red-400 hover:text-white rounded-md opacity-0 group-hover:opacity-100 transition-all">
                        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                \`;
                grid.appendChild(div);
            });
        }

        function addShortcutOffline() {
            const name = document.getElementById('newShortcutName').value;
            let url = document.getElementById('newShortcutUrl').value;
            if (name && url) {
                if (!url.startsWith('http')) url = 'https://' + url;
                shortcuts.push({ name, url });
                localStorage.setItem('nexus_shortcuts', JSON.stringify(shortcuts));
                renderShortcuts();
                document.getElementById('addShortcutModal').style.display = 'none';
                document.getElementById('newShortcutName').value = '';
                document.getElementById('newShortcutUrl').value = '';
            }
        }

        function removeShortcutOffline(e, name) {
            e.stopPropagation();
            shortcuts = shortcuts.filter(s => s.name !== name);
            localStorage.setItem('nexus_shortcuts', JSON.stringify(shortcuts));
            renderShortcuts();
        }

        renderShortcuts();
        
        function getCookie(name) {
            const value = "; " + document.cookie;
            const parts = value.split("; " + name + "=");
            if (parts.length === 2) return parts.pop().split(";").shift();
        }

        function initSession() {
            let sessionId = getCookie('SessionID');
            if (!sessionId) {
                sessionId = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
                document.cookie = "SessionID=" + sessionId + "; path=/; max-age=" + (60*60*24*7);
            }
            document.getElementById('sessionDisplay').innerText = sessionId;
        }
        initSession();

        function startBrowsing() {
            const proxy = document.getElementById('proxyInput').value;
            PROXY_BASE = proxy.endsWith('/') ? proxy + 'api/proxy' : proxy + '/api/proxy';
            document.getElementById('welcome').style.display = 'none';
        }

        function goHome() {
            document.getElementById('welcome').style.display = 'flex';
            document.getElementById('browser').src = 'about:blank';
        }

        function navigate(directUrl) {
            const input = directUrl || document.getElementById('urlInput').value;
            if (!input) return;
            
            if (!PROXY_BASE) startBrowsing();

            let url = input;
            if (!url.startsWith('http')) {
                if (url.includes('.') && !url.includes(' ')) {
                    url = 'https://' + url;
                } else {
                    url = 'https://www.google.com/search?q=' + encodeURIComponent(url);
                }
            }
            
            document.getElementById('welcome').style.display = 'none';
            document.getElementById('browser').src = PROXY_BASE + "?url=" + encodeURIComponent(url);
            document.getElementById('urlInput').value = url;
        }

        window.addEventListener('message', (e) => {
            if (e.data?.type === 'PROXY_URL_CHANGE') {
                document.getElementById('urlInput').value = e.data.url;
            }
        });

        document.getElementById('urlInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') navigate();
        });
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

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    navigateTo(urlInput);
  };

  const addTab = () => {
    const newId = Math.random().toString(36).substr(2, 9);
    const newTab = { id: newId, url: 'https://www.google.com/search?igu=1', title: 'New Tab' };
    setTabs([...tabs, newTab]);
    setActiveTabId(newId);
    setUrlInput(newTab.url);
  };

  const closeTab = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (tabs.length === 1) return;
    const newTabs = tabs.filter(t => t.id !== id);
    setTabs(newTabs);
    if (activeTabId === id) {
      setActiveTabId(newTabs[newTabs.length - 1].id);
      setUrlInput(newTabs[newTabs.length - 1].url);
    }
  };

  const refresh = () => {
    if (iframeRef.current) {
      const currentUrl = activeTab.url;
      // Force reload by resetting src
      const tab = tabs.find(t => t.id === activeTabId);
      if (tab) {
        setTabs(tabs.map(t => t.id === activeTabId ? { ...t, url: '' } : t));
        setTimeout(() => {
          setTabs(tabs.map(t => t.id === activeTabId ? { ...t, url: currentUrl } : t));
        }, 10);
      }
    }
  };

  useEffect(() => {
    setUrlInput(getDisplayUrl(activeTab.url));
  }, [activeTabId, activeTab.url]);

  useEffect(() => {
    // When proxy mode changes, reload the current tab with the new mode
    const currentRawUrl = activeTab.url.includes('/api/proxy?url=') 
      ? decodeURIComponent(activeTab.url.split('url=')[1])
      : activeTab.url;
    
    if (currentRawUrl) {
      navigateTo(currentRawUrl);
    }
  }, [useProxy]);

  return (
    <div className="flex flex-col h-screen bg-[#1a1a1a] text-white font-sans overflow-hidden">
      {/* Tab Bar */}
      <div className="flex items-center bg-[#0f0f0f] px-2 pt-2 gap-1 overflow-x-auto no-scrollbar border-b border-white/10">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            onClick={() => setActiveTabId(tab.id)}
            className={`
              group flex items-center min-w-[120px] max-w-[200px] h-9 px-3 rounded-t-lg cursor-pointer transition-all
              ${activeTabId === tab.id ? 'bg-[#2a2a2a] text-white' : 'bg-transparent text-gray-400 hover:bg-white/5'}
            `}
          >
            <Globe className="w-3.5 h-3.5 mr-2 opacity-60" />
            <span className="text-xs truncate flex-1">{tab.title}</span>
            <button
              onClick={(e) => closeTab(tab.id, e)}
              className="ml-2 p-0.5 rounded-md hover:bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
        <button
          onClick={addTab}
          className="p-1.5 mb-2 rounded-md hover:bg-white/10 text-gray-400 transition-colors"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2 bg-[#2a2a2a] border-b border-white/5">
        <div className="flex items-center gap-1">
          <button className="p-2 rounded-full hover:bg-white/10 disabled:opacity-30" disabled>
            <ArrowLeft className="w-4 h-4" />
          </button>
          <button className="p-2 rounded-full hover:bg-white/10 disabled:opacity-30" disabled>
            <ArrowRight className="w-4 h-4" />
          </button>
          <button onClick={refresh} className="p-2 rounded-full hover:bg-white/10">
            <RotateCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={() => { setShowHome(true); setUrlInput(''); }} className="p-2 rounded-full hover:bg-white/10">
            <Home className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleUrlSubmit} className="flex-1 relative group">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-400 transition-colors">
            <Shield className="w-3.5 h-3.5" />
          </div>
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            className="w-full bg-[#1a1a1a] border border-white/10 rounded-full py-1.5 pl-9 pr-4 text-sm focus:outline-none focus:border-blue-500/50 transition-all"
            placeholder="Search or enter address"
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">
            <Search className="w-3.5 h-3.5" />
          </div>
        </form>

        <div className="flex items-center gap-1 border-l border-white/10 pl-3">
          <button 
            onClick={() => setViewMode('desktop')}
            className={`p-2 rounded-md transition-colors ${viewMode === 'desktop' ? 'bg-blue-500/20 text-blue-400' : 'hover:bg-white/10 text-gray-400'}`}
          >
            <Monitor className="w-4 h-4" />
          </button>
          <button 
            onClick={() => setViewMode('mobile')}
            className={`p-2 rounded-md transition-colors ${viewMode === 'mobile' ? 'bg-blue-500/20 text-blue-400' : 'hover:bg-white/10 text-gray-400'}`}
          >
            <Smartphone className="w-4 h-4" />
          </button>
          <button 
            onClick={() => setShowSettings(true)}
            className="p-2 rounded-md hover:bg-white/10 text-gray-400"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Browser Content */}
      <div className="flex-1 bg-[#121212] relative overflow-y-auto p-4">
        {showHome ? (
          <div className="w-full min-h-full flex flex-col items-center justify-start max-w-4xl mx-auto space-y-12 py-12">
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center space-y-4"
            >
              <h1 className="text-7xl font-black tracking-tighter text-white flex items-center gap-4">
                <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-600/20">
                  <Globe className="w-10 h-10" />
                </div>
                NEXUS
              </h1>
              <p className="text-gray-500 text-lg font-medium">Fast, secure, and unblocked browsing.</p>
            </motion.div>

            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.1 }}
              className="w-full max-w-2xl"
            >
              <form onSubmit={handleUrlSubmit} className="relative group">
                <input
                  type="text"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  placeholder="Enter a URL or search the web..."
                  className="w-full bg-[#1a1a1a] border-2 border-white/10 rounded-3xl py-6 pl-8 pr-32 text-xl focus:outline-none focus:border-blue-500 transition-all shadow-2xl"
                />
                <button 
                  type="submit"
                  className="absolute right-3 top-3 bottom-3 px-8 bg-blue-600 hover:bg-blue-500 rounded-2xl font-bold text-sm transition-all shadow-lg shadow-blue-600/20"
                >
                  GO
                </button>
              </form>
            </motion.div>

            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="grid grid-cols-2 sm:grid-cols-4 gap-4 w-full max-w-2xl"
            >
              {shortcuts.map((site) => (
                <div key={site.name} className="relative group">
                  <button
                    onClick={() => navigateTo(site.url)}
                    className="w-full flex flex-col items-center gap-3 p-4 bg-white/5 hover:bg-white/10 rounded-2xl border border-white/5 transition-all"
                  >
                    <img 
                      src={`https://www.google.com/s2/favicons?domain=${new URL(site.url).hostname}&sz=64`} 
                      alt={site.name} 
                      className="w-8 h-8 rounded-lg group-hover:scale-110 transition-transform" 
                      referrerPolicy="no-referrer" 
                    />
                    <span className="text-xs font-semibold text-gray-400 group-hover:text-white">{site.name}</span>
                  </button>
                  <button 
                    onClick={(e) => removeShortcut(e, site.name)}
                    className="absolute top-2 right-2 p-1 bg-red-500/20 hover:bg-red-500 text-red-400 hover:text-white rounded-md opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
              <button
                onClick={() => setShowAddShortcut(true)}
                className="flex flex-col items-center justify-center gap-3 p-4 bg-white/5 hover:bg-white/10 rounded-2xl border border-dashed border-white/20 transition-all group"
              >
                <div className="w-8 h-8 bg-white/10 rounded-lg flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Plus className="w-5 h-5 text-gray-400 group-hover:text-white" />
                </div>
                <span className="text-xs font-semibold text-gray-400 group-hover:text-white">Add Shortcut</span>
              </button>
            </motion.div>

            <div className="flex gap-4">
              <button 
                onClick={() => setShowSettings(true)}
                className="px-6 py-2 bg-white/5 hover:bg-white/10 rounded-xl text-sm font-medium border border-white/10 transition-all flex items-center gap-2"
              >
                <Settings className="w-4 h-4" />
                Settings
              </button>
              <button 
                onClick={() => navigateTo('nexus://cookies')}
                className="px-6 py-2 bg-white/5 hover:bg-white/10 rounded-xl text-sm font-medium border border-white/10 transition-all flex items-center gap-2"
              >
                <History className="w-4 h-4" />
                Sessions
              </button>
              <button 
                onClick={async () => {
                  if (confirm('Are you sure you want to clear your current session? This will delete all cookies.')) {
                    // We can just clear the cookie on the client side and reload
                    document.cookie = 'SessionID=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
                    window.location.reload();
                  }
                }}
                className="px-6 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-xl text-sm font-medium border border-red-500/10 transition-all flex items-center gap-2"
              >
                <X className="w-4 h-4" />
                Clear Session
              </button>
            </div>
          </div>
        ) : (
          <div 
            className={`
              bg-white rounded-lg shadow-2xl overflow-hidden transition-all duration-500 ease-in-out
              ${viewMode === 'desktop' ? 'w-full h-full' : 'w-[375px] h-[667px] mt-8'}
            `}
          >
            {activeTab.url ? (
              <iframe
                ref={iframeRef}
                src={activeTab.url}
                className="w-full h-full border-none"
                onLoad={() => setIsLoading(false)}
                title="Browser View"
                sandbox="allow-forms allow-modals allow-orientation-lock allow-pointer-lock allow-popups allow-popups-to-escape-sandbox allow-presentation allow-same-origin allow-scripts allow-top-navigation-by-user-activation"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-[#1a1a1a]">
                <RotateCw className="w-8 h-8 animate-spin text-blue-500" />
              </div>
            )}
          </div>
      )}

      {/* Info Overlay for CORS issues */}
        <AnimatePresence>
          {activeTab.url && !activeTab.url.includes('google.com') && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-blue-600 text-white px-4 py-2 rounded-full text-xs font-medium shadow-lg flex items-center gap-2"
            >
              <Shield className="w-3.5 h-3.5" />
              Some sites may block iframes. Use the proxy for better compatibility.
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Taskbar */}
      <div className="h-12 bg-[#0a0a0a] border-t border-white/5 flex items-center px-4 justify-between z-50">
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setShowStartMenu(!showStartMenu)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md transition-all ${showStartMenu ? 'bg-blue-600 text-white' : 'hover:bg-white/10 text-gray-400'}`}
          >
            <div className="w-5 h-5 bg-blue-500 rounded flex items-center justify-center">
              <Globe className="w-3 h-3 text-white" />
            </div>
            <span className="text-xs font-bold uppercase tracking-wider">Start</span>
          </button>
          
          <div className="h-6 w-[1px] bg-white/10 mx-2" />
          
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTabId(tab.id)}
              className={`px-4 py-1.5 rounded-md text-xs font-medium transition-all max-w-[150px] truncate ${activeTabId === tab.id ? 'bg-white/10 text-white border border-white/10' : 'text-gray-500 hover:bg-white/5'}`}
            >
              {tab.title}
            </button>
          ))}
        </div>
        
        <div className="flex items-center gap-4 text-gray-500 text-[10px] font-bold uppercase tracking-widest">
          <div className="flex items-center gap-2">
            <div className={`w-1.5 h-1.5 rounded-full ${bareStatus === 'online' ? 'bg-green-500' : 'bg-red-500'}`} />
            {bareStatus}
          </div>
          <div>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
        </div>
      </div>

      {/* Start Menu */}
      <AnimatePresence>
        {showStartMenu && (
          <>
            <div 
              className="fixed inset-0 z-40" 
              onClick={() => setShowStartMenu(false)} 
            />
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.95 }}
              className="fixed bottom-14 left-4 w-80 bg-[#1a1a1a] border border-white/10 rounded-2xl shadow-2xl z-50 overflow-hidden flex flex-col"
            >
              <div className="p-6 bg-blue-600 flex items-center gap-4">
                <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
                  <Globe className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="text-white font-bold">Nexus Browser</h3>
                  <p className="text-blue-100 text-xs">Guest Session</p>
                </div>
              </div>
              
              <div className="p-4 flex-1 space-y-2">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest px-2 mb-2">Applications</p>
                <button 
                  onClick={() => { setShowHome(true); setShowStartMenu(false); }}
                  className="w-full flex items-center gap-3 p-2 hover:bg-white/5 rounded-lg text-gray-300 hover:text-white transition-all"
                >
                  <Home className="w-4 h-4 text-blue-400" />
                  <span className="text-sm font-medium">Home Page</span>
                </button>
                <button 
                  onClick={() => { navigateTo('nexus://cookies'); setShowStartMenu(false); }}
                  className="w-full flex items-center gap-3 p-2 hover:bg-white/5 rounded-lg text-gray-300 hover:text-white transition-all"
                >
                  <History className="w-4 h-4 text-purple-400" />
                  <span className="text-sm font-medium">Cookie Manager</span>
                </button>
                <button 
                  onClick={() => { setShowSettings(true); setShowStartMenu(false); }}
                  className="w-full flex items-center gap-3 p-2 hover:bg-white/5 rounded-lg text-gray-300 hover:text-white transition-all"
                >
                  <Settings className="w-4 h-4 text-gray-400" />
                  <span className="text-sm font-medium">Settings</span>
                </button>
                
                <div className="h-[1px] bg-white/5 my-4" />
                
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest px-2 mb-2">Quick Links</p>
                <div className="grid grid-cols-3 gap-2 px-2">
                  {[
                    { name: 'Google', url: 'https://google.com', icon: 'https://www.google.com/favicon.ico' },
                    { name: 'YouTube', url: 'https://youtube.com', icon: 'https://www.youtube.com/favicon.ico' },
                    { name: 'Discord', url: 'https://discord.com', icon: 'https://discord.com/favicon.ico' },
                    { name: 'Reddit', url: 'https://reddit.com', icon: 'https://www.reddit.com/favicon.ico' },
                    { name: 'GitHub', url: 'https://github.com', icon: 'https://github.com/favicon.ico' },
                    { name: 'Twitter', url: 'https://twitter.com', icon: 'https://twitter.com/favicon.ico' },
                    { name: 'TikTok', url: 'https://tiktok.com', icon: 'https://www.tiktok.com/favicon.ico' },
                    { name: 'Spotify', url: 'https://spotify.com', icon: 'https://www.spotify.com/favicon.ico' },
                    { name: 'Netflix', url: 'https://netflix.com', icon: 'https://www.netflix.com/favicon.ico' },
                  ].map(link => (
                    <button
                      key={link.name}
                      onClick={() => { navigateTo(link.url); setShowStartMenu(false); }}
                      className="flex flex-col items-center gap-1 p-2 hover:bg-white/5 rounded-lg transition-all group"
                    >
                      <img src={link.icon} className="w-5 h-5 group-hover:scale-110 transition-transform" alt="" referrerPolicy="no-referrer" />
                      <span className="text-[10px] text-gray-500 group-hover:text-white truncate w-full text-center">{link.name}</span>
                    </button>
                  ))}
                </div>
              </div>
              
              <div className="p-4 bg-black/20 flex items-center justify-between">
                <button 
                  onClick={() => window.location.reload()}
                  className="p-2 hover:bg-white/5 rounded-lg text-gray-500 hover:text-white transition-all"
                >
                  <RotateCw className="w-4 h-4" />
                </button>
                <button 
                  onClick={() => {
                    if (confirm('Clear session and restart?')) {
                      document.cookie = 'SessionID=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
                      window.location.reload();
                    }
                  }}
                  className="p-2 hover:bg-red-500/10 rounded-lg text-gray-500 hover:text-red-400 transition-all"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Settings Modal */}
      <AnimatePresence>
        {showAddShortcut && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="w-full max-w-md bg-[#1a1a1a] border border-white/10 rounded-[2rem] p-8 shadow-2xl space-y-6"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-black tracking-tighter text-white">ADD SHORTCUT</h2>
                <button onClick={() => setShowAddShortcut(false)} className="p-2 hover:bg-white/5 rounded-xl transition-all">
                  <X className="w-5 h-5 text-gray-400" />
                </button>
              </div>
              
              <div className="space-y-4">
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
                className="w-full py-4 bg-blue-600 hover:bg-blue-500 rounded-2xl text-lg font-black transition-all shadow-xl shadow-blue-600/20 uppercase tracking-widest"
              >
                Add Shortcut
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-[#2a2a2a] w-full max-w-md rounded-2xl shadow-2xl overflow-hidden border border-white/10"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <Settings className="w-5 h-5 text-blue-400" />
                  Browser Settings
                </h2>
                <button 
                  onClick={() => setShowSettings(false)}
                  className="p-1.5 rounded-full hover:bg-white/10 text-gray-400"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-6">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-gray-400 uppercase tracking-wider flex justify-between">
                    Bare Server Location
                    <span className={`flex items-center gap-1 normal-case font-normal ${bareStatus === 'online' ? 'text-green-400' : bareStatus === 'offline' ? 'text-red-400' : 'text-yellow-400'}`}>
                      <div className={`w-1.5 h-1.5 rounded-full ${bareStatus === 'online' ? 'bg-green-400 animate-pulse' : bareStatus === 'offline' ? 'bg-red-400' : 'bg-yellow-400 animate-pulse'}`} />
                      {bareStatus === 'online' ? 'Server Online' : bareStatus === 'offline' ? 'Server Offline' : 'Checking...'}
                    </span>
                  </label>
                  <div className="flex gap-2">
                    <input 
                      type="text"
                      value={bareServerUrl}
                      onChange={(e) => setBareServerUrl(e.target.value)}
                      className="flex-1 bg-[#1a1a1a] border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500/50"
                      placeholder="https://your-bare-server.com/bare/"
                    />
                    <button 
                      onClick={() => setBareServerUrl(`${window.location.origin}/bare/`)}
                      className="px-3 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-xs transition-colors"
                    >
                      Default
                    </button>
                  </div>
                  <p className="text-[10px] text-gray-500">
                    The TompHTTP Bare server used for unblocking and proxying.
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Proxy Configuration
                  </label>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/5">
                      <div className="flex items-center gap-3">
                        <Shield className="w-5 h-5 text-orange-400" />
                        <div>
                          <div className="text-sm font-medium">Force Proxy Mode</div>
                          <div className="text-[10px] text-gray-500">Route all traffic through the local proxy</div>
                        </div>
                      </div>
                      <button 
                        onClick={() => setUseProxy(!useProxy)}
                        className={`w-10 h-5 rounded-full relative transition-colors ${useProxy ? 'bg-blue-500' : 'bg-gray-600'}`}
                      >
                        <motion.div 
                          animate={{ x: useProxy ? 22 : 2 }}
                          className="absolute top-1 w-3 h-3 bg-white rounded-full shadow-sm"
                        />
                      </button>
                    </div>

                    <div className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/5">
                      <div className="flex items-center gap-3">
                        <History className="w-5 h-5 text-purple-400" />
                        <div>
                          <div className="text-sm font-medium">Cookie Management</div>
                          <div className="text-[10px] text-gray-500">Clear stored session cookies</div>
                        </div>
                      </div>
                      <button 
                        onClick={() => {
                          // In a real app, we'd call an API to clear the server-side jar
                          alert('Cookies cleared for this session.');
                        }}
                        className="px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg text-xs font-medium transition-colors"
                      >
                        Clear Cookies
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="px-6 py-4 bg-[#1a1a1a] flex justify-between items-center border-t border-white/5">
                <button 
                  onClick={downloadOffline}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600/20 hover:bg-green-600/30 text-green-400 rounded-lg text-sm font-medium transition-colors"
                >
                  <Monitor className="w-4 h-4" />
                  Offline HTML
                </button>
                <button 
                  onClick={() => setShowSettings(false)}
                  className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  Save & Close
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Status Bar */}
      <div className="bg-[#0f0f0f] px-4 py-1 text-[10px] text-gray-500 flex justify-between border-t border-white/5">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${bareStatus === 'online' ? 'bg-green-500' : 'bg-red-500'}`} />
            Bare: {bareStatus === 'online' ? 'Active' : 'Inactive'}
          </span>
          <span className="opacity-50">|</span>
          <span className="flex items-center gap-1"><Shield className="w-2.5 h-2.5" /> Secure Connection</span>
        </div>
        <div className="flex items-center gap-3">
          <span>{activeTab.url}</span>
        </div>
      </div>
    </div>
  );
}
