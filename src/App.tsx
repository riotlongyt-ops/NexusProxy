import React, { useState, useEffect } from 'react';
import { 
  Search, 
  Settings, 
  Gamepad2, 
  LayoutGrid, 
  Layers,
  ExternalLink,
  ChevronDown,
  Pin,
  X,
  Plus,
  Trash2,
  Globe,
  Youtube,
  Shield,
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
  { name: 'ChatGPT', url: 'https://chat.openai.com', icon: 'https://www.google.com/s2/favicons?domain=openai.com&sz=128' },
  { name: 'Character AI', url: 'https://character.ai', icon: 'https://www.google.com/s2/favicons?domain=character.ai&sz=128' },
];

const games = [
  { name: '1v1.LOL', url: 'https://1v1.lol', icon: 'https://www.google.com/s2/favicons?domain=1v1.lol&sz=128' },
  { name: '2048', url: 'https://play2048.co', icon: 'https://www.google.com/s2/favicons?domain=play2048.co&sz=128' },
  { name: '3 Slices', url: 'https://www.coolmathgames.com/0-3-slices', icon: 'https://www.google.com/s2/favicons?domain=coolmathgames.com&sz=128' },
  { name: 'Agar.io', url: 'https://agar.io', icon: 'https://www.google.com/s2/favicons?domain=agar.io&sz=128' },
  { name: 'Slope', url: 'https://slopegame.online', icon: 'https://www.google.com/s2/favicons?domain=slopegame.online&sz=128' },
  { name: 'Shell Shockers', url: 'https://shellshock.io', icon: 'https://www.google.com/s2/favicons?domain=shellshock.io&sz=128' },
  { name: 'Krunker', url: 'https://krunker.io', icon: 'https://www.google.com/s2/favicons?domain=krunker.io&sz=128' },
  { name: 'Zombs Royale', url: 'https://zombsroyale.io', icon: 'https://www.google.com/s2/favicons?domain=zombsroyale.io&sz=128' },
];

export default function App() {
  const [urlInput, setUrlInput] = useState('');
  const [currentView, setCurrentView] = useState<'home' | 'apps' | 'games' | 'tabs' | 'settings'>('home');
  const [searchEngine, setSearchEngine] = useState(() => localStorage.getItem('nexus_search_engine') || 'google');
  const [tabCloak, setTabCloak] = useState(() => localStorage.getItem('nexus_tab_cloak') || 'none');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [panicKey, setPanicKey] = useState(() => localStorage.getItem('nexus_panic_key') || '`');
  const [panicUrl, setPanicUrl] = useState(() => localStorage.getItem('nexus_panic_url') || 'https://classroom.google.com/');
  const [aboutBlank, setAboutBlank] = useState(() => localStorage.getItem('nexus_about_blank') === 'true');
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  const showSaveStatus = (msg: string) => {
    setSaveStatus(msg);
    setTimeout(() => setSaveStatus(null), 2000);
  };

  useEffect(() => {
    localStorage.setItem('nexus_about_blank', String(aboutBlank));
  }, [aboutBlank]);

  const openAboutBlank = () => {
    const win = window.open('about:blank', '_blank');
    if (!win) {
      alert('Popup blocked! Please allow popups for this site.');
      return;
    }
    win.document.body.style.margin = '0';
    win.document.body.style.height = '100vh';
    const iframe = win.document.createElement('iframe');
    iframe.style.border = 'none';
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.margin = '0';
    iframe.src = window.location.href;
    win.document.body.appendChild(iframe);
    window.location.replace('https://classroom.google.com');
  };

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
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === panicKey) {
        window.location.href = panicUrl;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [panicKey, panicUrl]);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { scope: '/', type: 'module' })
        .catch((error) => console.error('SW registration failed:', error));
    }
  }, []);

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
        setLoadingStep(prev => (prev < loadingSteps.length - 1 ? prev + 1 : prev));
      }, 400);
      return () => clearInterval(interval);
    } else {
      setLoadingStep(0);
    }
  }, [isLoading]);

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
    setTimeout(() => {
      window.location.href = `/nexus/${encoded}`;
    }, 1500);
  };

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    navigateTo(urlInput);
  };

  return (
    <div className="min-h-screen flex flex-col text-white font-sans selection:bg-white/20">
      {/* Background Shapes */}
      <div className="nexus-bg">
        <div className="wavy-shape rounded-none" />
        <div className="wavy-shape-2 rounded-none" />
      </div>

      {/* Header */}
      <header className="relative z-50 px-8 h-24 flex items-center justify-between">
        <button onClick={() => setCurrentView('home')} className="text-4xl font-black tracking-tighter hover:opacity-80 transition-opacity">
          NX
        </button>

        <nav className="flex items-center gap-8">
          <button 
            onClick={() => setCurrentView('games')} 
            className={`flex items-center gap-2 text-sm font-bold uppercase tracking-widest transition-colors ${currentView === 'games' ? 'text-white' : 'text-gray-500 hover:text-white'}`}
          >
            <Gamepad2 className="w-5 h-5" />
            Games
          </button>
          <button 
            onClick={() => setCurrentView('apps')} 
            className={`flex items-center gap-2 text-sm font-bold uppercase tracking-widest transition-colors ${currentView === 'apps' ? 'text-white' : 'text-gray-500 hover:text-white'}`}
          >
            <LayoutGrid className="w-5 h-5" />
            Apps
          </button>
          <button 
            onClick={() => setCurrentView('tabs')} 
            className={`flex items-center gap-2 text-sm font-bold uppercase tracking-widest transition-colors ${currentView === 'tabs' ? 'text-white' : 'text-gray-500 hover:text-white'}`}
          >
            <Layers className="w-5 h-5" />
            Tabs
          </button>
          <button 
            onClick={() => setCurrentView('settings')} 
            className={`flex items-center gap-2 text-sm font-bold uppercase tracking-widest transition-colors ${currentView === 'settings' ? 'text-white' : 'text-gray-500 hover:text-white'}`}
          >
            <Settings className="w-5 h-5" />
            Setting
          </button>
        </nav>
      </header>

      {/* Main Content */}
      <main className="relative z-10 flex-1 flex flex-col">
        <AnimatePresence mode="wait">
          {currentView === 'home' && (
            <motion.div 
              key="home"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex-1 flex flex-col items-center justify-center px-6 -mt-24"
            >
              <div className="text-center space-y-2 mb-12">
                <h1 className="text-[120px] font-black tracking-tighter leading-none">NEXUS</h1>
                <p className="text-gray-500 text-sm font-bold tracking-[0.3em]">gatekeep ts</p>
              </div>

              <form onSubmit={handleUrlSubmit} className="w-full max-w-2xl">
                <div className="relative group">
                  <input
                    type="text"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    placeholder="Search or enter a URL"
                    className="w-full bg-[#222] border-none rounded-none py-6 px-8 text-xl focus:outline-none focus:ring-2 focus:ring-white/10 transition-all text-center placeholder:text-gray-600"
                  />
                </div>
              </form>
            </motion.div>
          )}

          {(currentView === 'apps' || currentView === 'games') && (
            <motion.div 
              key={currentView}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 max-w-7xl mx-auto w-full py-12 px-8"
            >
              <div className="flex gap-4 mb-12">
                <div className="flex-1 relative">
                  <Search className="absolute left-6 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
                  <input 
                    type="text" 
                    placeholder="Search" 
                    className="w-full bg-[#222] rounded-none py-4 pl-16 pr-6 text-lg focus:outline-none"
                  />
                </div>
                <div className="relative">
                  <select className="appearance-none bg-[#222] rounded-none py-4 pl-8 pr-16 text-lg focus:outline-none cursor-pointer">
                    <option>All</option>
                    <option>Popular</option>
                    <option>New</option>
                  </select>
                  <ChevronDown className="absolute right-6 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500 pointer-events-none" />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-6">
                {(currentView === 'apps' ? apps : games).map((item) => (
                  <button
                    key={item.name}
                    onClick={() => navigateTo(item.url)}
                    className="aspect-square bg-[#222] rounded-none p-6 flex flex-col items-center justify-center gap-4 group relative hover:bg-[#2a2a2a] hover:ring-2 hover:ring-white/10 transition-all shadow-lg"
                  >
                    <Pin className="absolute top-4 right-4 w-4 h-4 text-gray-600 group-hover:text-white transition-colors" />
                    <div className="w-20 h-20 flex items-center justify-center">
                      <img src={item.icon} alt={item.name} className="max-w-full max-h-full object-contain rounded-none" referrerPolicy="no-referrer" />
                    </div>
                    <span className="text-sm font-bold text-gray-400 group-hover:text-white transition-colors text-center line-clamp-1">
                      {item.name}
                    </span>
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {currentView === 'tabs' && (
            <motion.div 
              key="tabs"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex-1 flex flex-col items-center justify-center px-6 -mt-24"
            >
              <div className="text-center space-y-6">
                <Layers className="w-24 h-24 text-gray-700 mx-auto" />
                <h2 className="text-6xl font-black tracking-tighter uppercase">No Tabs Open</h2>
                <p className="text-gray-500 font-medium tracking-wide italic">Your active proxy sessions will appear here.</p>
              </div>
            </motion.div>
          )}

          {currentView === 'settings' && (
            <motion.div 
              key="settings"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="flex-1 max-w-6xl mx-auto w-full py-12 px-8"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* About:Blank */}
                <div className="bg-[#222] p-8 rounded-none space-y-6">
                  <h3 className="text-xl font-bold">About:Blank</h3>
                  <p className="text-gray-500 text-sm">Cloak the site in an about:blank page and toggle about:blank on startup (enabled by default)</p>
                  <div className="flex items-center justify-between">
                    <div 
                      onClick={() => {
                        setAboutBlank(!aboutBlank);
                        showSaveStatus('About:Blank toggled');
                      }}
                      className={`w-12 h-6 rounded-none relative cursor-pointer transition-colors ${aboutBlank ? 'bg-white' : 'bg-white/10'}`}
                    >
                      <div className={`absolute top-1 w-4 h-4 rounded-none transition-all ${aboutBlank ? 'right-1 bg-black' : 'left-1 bg-white'}`} />
                    </div>
                    <button 
                      onClick={openAboutBlank}
                      className="px-6 py-3 bg-white/5 hover:bg-white/10 rounded-none font-bold transition-all"
                    >
                      Open Popup
                    </button>
                  </div>
                </div>

                {/* Set Panic Key */}
                <div className="bg-[#222] p-8 rounded-none space-y-6">
                  <h3 className="text-xl font-bold">Set Panic Key</h3>
                  <p className="text-gray-500 text-sm">Quick open another site with one press. Used for redirects when about:blank is opened.</p>
                  <div className="space-y-4">
                    <input 
                      type="text" 
                      value={panicKey}
                      onChange={(e) => setPanicKey(e.target.value)}
                      placeholder="Panic Key (e.g. `)"
                      className="w-full bg-white/5 rounded-none py-3 px-4 focus:outline-none text-center"
                    />
                    <input 
                      type="text" 
                      value={panicUrl}
                      onChange={(e) => setPanicUrl(e.target.value)}
                      placeholder="Panic URL"
                      className="w-full bg-white/5 rounded-none py-3 px-4 focus:outline-none text-center"
                    />
                    <button 
                      onClick={() => {
                        localStorage.setItem('nexus_panic_key', panicKey);
                        localStorage.setItem('nexus_panic_url', panicUrl);
                        showSaveStatus('Panic settings saved');
                      }}
                      className="w-full py-3 bg-white/5 hover:bg-white/10 rounded-none font-bold transition-all"
                    >
                      Save
                    </button>
                  </div>
                </div>

                {/* Tab Cloaker */}
                <div className="bg-[#222] p-8 rounded-none space-y-6">
                  <h3 className="text-xl font-bold">Tab Cloaker</h3>
                  <p className="text-gray-500 text-sm">Change the title and icon of the page.</p>
                  <select 
                    value={tabCloak}
                    onChange={(e) => setTabCloak(e.target.value)}
                    className="w-full bg-white/5 rounded-none py-3 px-4 focus:outline-none"
                  >
                    {Object.keys(cloaks).map(key => (
                      <option key={key} value={key}>{cloaks[key].title}</option>
                    ))}
                  </select>
                  <div className="flex gap-4">
                    <button 
                      onClick={() => showSaveStatus('Cloak saved')}
                      className="flex-1 py-3 bg-white/5 hover:bg-white/10 rounded-none font-bold transition-all"
                    >
                      Save
                    </button>
                    <button 
                      onClick={() => {
                        setTabCloak('none');
                        showSaveStatus('Cloak reset');
                      }} 
                      className="flex-1 py-3 bg-white/5 hover:bg-white/10 rounded-none font-bold transition-all"
                    >
                      Reset Cloak
                    </button>
                  </div>
                </div>

                {/* Search Engine */}
                <div className="bg-[#222] p-8 rounded-none space-y-6">
                  <h3 className="text-xl font-bold">Search Engine</h3>
                  <p className="text-gray-500 text-sm">Change the search engine when searching.</p>
                  <select 
                    value={searchEngine}
                    onChange={(e) => setSearchEngine(e.target.value)}
                    className="w-full bg-white/5 rounded-none py-3 px-4 focus:outline-none"
                  >
                    <option value="google">Google (Default)</option>
                    <option value="bing">Bing</option>
                    <option value="duckduckgo">DuckDuckGo</option>
                    <option value="brave">Brave</option>
                  </select>
                  <button 
                    onClick={() => showSaveStatus('Search engine saved')}
                    className="w-full py-3 bg-white/5 hover:bg-white/10 rounded-none font-bold transition-all"
                  >
                    Save
                  </button>
                </div>
              </div>

              {/* Save Notification */}
              <AnimatePresence>
                {saveStatus && (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 20 }}
                    className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-white text-black px-8 py-3 font-bold uppercase tracking-widest text-xs z-[100]"
                  >
                    {saveStatus}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Loading Overlay */}
      <AnimatePresence>
        {isLoading && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center p-6"
          >
            <div className="w-full max-w-md space-y-8 text-center">
              <div className="relative w-24 h-24 mx-auto">
                <motion.div 
                  animate={{ rotate: 360 }}
                  transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                  className="absolute inset-0 border-4 border-white/10 border-t-white rounded-full"
                />
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-black uppercase tracking-widest">{loadingSteps[loadingStep].title}</h2>
                <p className="text-gray-500 font-medium">{loadingSteps[loadingStep].desc}</p>
              </div>
              <div className="w-full h-1 bg-white/10 rounded-none overflow-hidden">
                <motion.div 
                  initial={{ width: 0 }}
                  animate={{ width: `${((loadingStep + 1) / loadingSteps.length) * 100}%` }}
                  className="h-full bg-white rounded-none"
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
