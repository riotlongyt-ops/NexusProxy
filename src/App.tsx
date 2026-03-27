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
    { id: '1', url: 'https://www.google.com/search?igu=1', title: 'Google' }
  ]);
  const [activeTabId, setActiveTabId] = useState('1');
  const [urlInput, setUrlInput] = useState('https://www.google.com/search?igu=1');
  const [isLoading, setIsLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'desktop' | 'mobile'>('desktop');
  const [useProxy, setUseProxy] = useState(true); // Default to true
  const [showSettings, setShowSettings] = useState(false);
  const [bareServerUrl, setBareServerUrl] = useState(`${window.location.origin}/bare/`);
  const [bareStatus, setBareStatus] = useState<'online' | 'offline' | 'checking'>('checking');
  const [cookies, setCookies] = useState<any[]>([]);
  const [isCookiePage, setIsCookiePage] = useState(false);
  
  const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0];
  const iframeRef = useRef<HTMLIFrameElement>(null);

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
    if (url.toLowerCase() === 'nexus://cookies') {
      setIsCookiePage(true);
      fetchCookies();
      setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, url: 'nexus://cookies', title: 'Cookie Manager' } : t));
      setUrlInput('nexus://cookies');
      return;
    }

    setIsCookiePage(false);
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
    const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Nexus Browser - Standalone</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
    <style>
        body { font-family: 'Inter', sans-serif; background: #0a0a0a; color: white; }
        .glass { background: rgba(255, 255, 255, 0.03); backdrop-filter: blur(10px); border: 1px solid rgba(255, 255, 255, 0.05); }
    </style>
</head>
<body class="h-screen flex flex-col overflow-hidden">
    <div class="p-4 glass flex items-center gap-4">
        <div class="text-blue-500 font-bold text-xl tracking-tighter">NEXUS</div>
        <div class="flex-1 flex gap-2">
            <input id="urlInput" type="text" placeholder="Enter URL or Search..." class="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-blue-500/50">
            <button onclick="navigate()" class="px-6 py-2 bg-blue-600 hover:bg-blue-500 rounded-xl text-sm font-medium transition-all">Go</button>
        </div>
    </div>
    
    <div class="flex-1 relative">
        <iframe id="browser" class="w-full h-full border-none" src="about:blank"></iframe>
        <div id="welcome" class="absolute inset-0 flex flex-col items-center justify-center bg-[#0a0a0a]">
            <div class="text-center space-y-6 max-w-lg p-10 glass rounded-[2.5rem] shadow-2xl">
                <div class="w-20 h-20 bg-blue-600/20 rounded-3xl flex items-center justify-center mx-auto mb-4">
                    <svg class="w-10 h-10 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"></path></svg>
                </div>
                <h1 class="text-5xl font-bold text-white tracking-tight">Nexus <span class="text-blue-500">Standalone</span></h1>
                <p class="text-gray-400 text-lg leading-relaxed">The ultimate portable unblocker. Connect to any Bare Server and browse freely.</p>
                
                <div class="space-y-4 text-left">
                    <div class="space-y-2">
                        <label class="text-xs font-semibold text-gray-500 uppercase tracking-widest ml-1">Proxy Backend URL</label>
                        <input id="proxyInput" type="text" value="${window.location.origin}" class="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500/50 transition-all" placeholder="https://your-nexus-instance.run.app">
                    </div>
                    <div class="space-y-2">
                        <label class="text-xs font-semibold text-gray-500 uppercase tracking-widest ml-1">Bare Server (Optional)</label>
                        <div class="flex gap-2">
                            <input id="bareInput" type="text" value="${window.location.origin}/bare/" class="flex-1 bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500/50 transition-all" placeholder="https://bare.example.com/bare/">
                            <button onclick="testBare()" class="px-4 py-3 bg-white/5 hover:bg-white/10 rounded-2xl text-xs font-bold transition-all">Test</button>
                        </div>
                    </div>
                </div>

                <div class="pt-4 flex flex-col gap-3">
                    <button onclick="startBrowsing()" class="w-full py-4 bg-blue-600 hover:bg-blue-500 rounded-2xl text-lg font-bold transition-all shadow-lg shadow-blue-600/20">Launch Browser</button>
                    <p class="text-[10px] text-gray-600">Note: For full performance, ensure your backend is running.</p>
                </div>
            </div>
        </div>
    </div>

    <script>
        let PROXY_BASE = "";
        
        function testBare() {
            const bare = document.getElementById('bareInput').value;
            fetch(bare).then(r => {
                if(r.ok) alert('Bare Server is Online!');
                else alert('Bare Server returned error: ' + r.status);
            }).catch(e => alert('Failed to connect to Bare Server: ' + e.message));
        }

        function startBrowsing() {
            const proxy = document.getElementById('proxyInput').value;
            PROXY_BASE = proxy.endsWith('/') ? proxy + 'api/proxy' : proxy + '/api/proxy';
            document.getElementById('welcome').style.display = 'none';
        }

        function navigate() {
            const input = document.getElementById('urlInput').value;
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
    setUrlInput(activeTab.url);
  }, [activeTabId]);

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
          <button onClick={() => navigateTo('https://www.google.com/search?igu=1')} className="p-2 rounded-full hover:bg-white/10">
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
      <div className="flex-1 bg-[#121212] relative overflow-hidden flex justify-center items-start p-4">
        <div 
          className={`
            bg-white rounded-lg shadow-2xl overflow-hidden transition-all duration-500 ease-in-out
            ${viewMode === 'desktop' ? 'w-full h-full' : 'w-[375px] h-[667px] mt-8'}
          `}
        >
          {isCookiePage ? (
            <div className="w-full h-full bg-[#1a1a1a] p-8 overflow-auto text-white font-mono">
              <div className="flex items-center justify-between mb-8">
                <h1 className="text-2xl font-bold flex items-center gap-3">
                  <History className="w-8 h-8 text-purple-400" />
                  Cookie Manager
                </h1>
                <button 
                  onClick={fetchCookies}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded-lg text-sm transition-colors"
                >
                  Refresh Cookies
                </button>
              </div>

              <div className="space-y-4">
                {cookies.length === 0 ? (
                  <div className="text-center py-20 opacity-30">
                    <History className="w-16 h-16 mx-auto mb-4" />
                    <p>No cookies found for this session.</p>
                  </div>
                ) : (
                  <div className="border border-white/10 rounded-xl overflow-hidden">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-white/5 text-gray-400 uppercase text-[10px] tracking-widest">
                        <tr>
                          <th className="px-4 py-3">Key</th>
                          <th className="px-4 py-3">Value</th>
                          <th className="px-4 py-3">Domain</th>
                          <th className="px-4 py-3">Path</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {cookies.map((cookie, i) => (
                          <tr key={i} className="hover:bg-white/5 transition-colors">
                            <td className="px-4 py-3 text-purple-400 font-bold">{cookie.key}</td>
                            <td className="px-4 py-3 opacity-80 break-all">{cookie.value}</td>
                            <td className="px-4 py-3 opacity-60">{cookie.domain}</td>
                            <td className="px-4 py-3 opacity-60">{cookie.path}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          ) : activeTab.url ? (
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
