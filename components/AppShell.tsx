'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Bot,
  Activity,
  GitBranch,
  Coins,
  Cpu,
  FolderGit2,
  CheckSquare,
  AlertTriangle,
  Settings,
  Search,
  Bell,
  Sun,
  Moon,
  Pause,
  Play,
  RefreshCw,
  Radio,
  Menu,
  X,
  Terminal,
} from 'lucide-react';
import { formatRelativeTime } from './format';

interface LiveStreamContextValue {
  sseConnected: boolean;
  monitoringPaused: boolean;
  lastEventTick: number;
  isRefreshing: boolean;
  triggerRefresh: () => Promise<void>;
  togglePause: () => Promise<void>;
}

const LiveStreamContext = createContext<LiveStreamContextValue>({
  sseConnected: false,
  monitoringPaused: false,
  lastEventTick: 0,
  isRefreshing: false,
  triggerRefresh: async () => {},
  togglePause: async () => {},
});

export function useLiveStream() {
  return useContext(LiveStreamContext);
}

const NAV_ITEMS = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/antigravity', label: 'Antigravity', icon: Bot },
  { href: '/activity', label: 'Live Activity', icon: Activity },
  { href: '/github', label: 'GitHub & Git', icon: GitBranch },
  { href: '/usage', label: 'AI Usage & Cost', icon: Coins },
  { href: '/processes', label: 'Processes & Perf', icon: Cpu },
  { href: '/projects', label: 'Projects', icon: FolderGit2 },
  { href: '/tasks', label: 'Tasks & History', icon: CheckSquare },
  { href: '/errors', label: 'Error Centre', icon: AlertTriangle },
  { href: '/settings', label: 'Settings', icon: Settings },
];

interface SearchModalResult {
  projects: Array<{ id: string; name: string; localPath: string; currentBranch: string | null }>;
  repositories: Array<{ id: string; fullName: string; localPath: string; currentBranch: string }>;
  tasks: Array<{ id: string; title: string; status: string; source: string }>;
  events: Array<{ id: string; title: string; source: string; timestamp: string; category: string }>;
  errors: Array<{ id: string; title: string; severity: string; source: string }>;
  fileChanges: Array<{ id: string; relativePath: string; changeType: string; timestamp: string }>;
}

interface NotificationItem {
  id: string;
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
  read: boolean;
  createdAt: string;
  link: string | null;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [darkMode, setDarkMode] = useState(true);
  const [sseConnected, setSseConnected] = useState(false);
  const [monitoringPaused, setMonitoringPaused] = useState(false);
  const [lastEventTick, setLastEventTick] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Global search modal state
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchModalResult | null>(null);
  const [searching, setSearching] = useState(false);

  // Notifications popover state
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  // Initialize theme
  useEffect(() => {
    const saved = localStorage.getItem('devscope-theme');
    const isDark = saved ? saved === 'dark' : true;
    setDarkMode(isDark);
    document.documentElement.classList.toggle('dark', isDark);
  }, []);

  const toggleTheme = () => {
    const next = !darkMode;
    setDarkMode(next);
    localStorage.setItem('devscope-theme', next ? 'dark' : 'light');
    document.documentElement.classList.toggle('dark', next);
  };

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch('/api/search?q=');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.notifications)) {
          setNotifications(data.notifications);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void fetchNotifications();
  }, [fetchNotifications, lastEventTick]);

  // Connect to SSE stream with automatic reconnection & polling fallback
  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimer: NodeJS.Timeout | null = null;
    let fallbackPollTimer: NodeJS.Timeout | null = null;

    const connect = () => {
      try {
        es = new EventSource('/api/stream');
        es.onopen = () => {
          setSseConnected(true);
        };
        es.addEventListener('monitoring_status', (e) => {
          setSseConnected(true);
          try {
            const parsed = JSON.parse((e as MessageEvent).data);
            setMonitoringPaused(Boolean(parsed.paused));
          } catch {
            // ignore
          }
        });
        es.addEventListener('activity', () => {
          setLastEventTick(Date.now());
        });
        es.addEventListener('refresh', () => {
          setLastEventTick(Date.now());
        });
        es.addEventListener('notification', () => {
          setLastEventTick(Date.now());
        });
        es.onerror = () => {
          setSseConnected(false);
          if (es) es.close();
          reconnectTimer = setTimeout(connect, 5000);
        };
      } catch {
        setSseConnected(false);
      }
    };

    connect();

    // Polling fallback every 20s if SSE disconnects
    fallbackPollTimer = setInterval(() => {
      setLastEventTick(Date.now());
    }, 20000);

    return () => {
      if (es) es.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (fallbackPollTimer) clearInterval(fallbackPollTimer);
    };
  }, []);

  // Keyboard shortcut Ctrl+K / Cmd+K for global search
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      } else if (e.key === 'Escape') {
        setSearchOpen(false);
        setNotifOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Run search when query changes
  useEffect(() => {
    if (!searchOpen) return;
    if (!searchQuery.trim()) {
      setSearchResults(null);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(searchQuery.trim())}`);
        if (res.ok) {
          const data = await res.json();
          setSearchResults(data.results);
        }
      } finally {
        setSearching(false);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [searchQuery, searchOpen]);

  const triggerRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await fetch('/api/activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'refresh' }),
      });
      setLastEventTick(Date.now());
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  const togglePause = useCallback(async () => {
    const nextAction = monitoringPaused ? 'resume' : 'pause';
    const res = await fetch('/api/activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: nextAction }),
    });
    if (res.ok) {
      const data = await res.json();
      setMonitoringPaused(Boolean(data.status?.paused));
      setLastEventTick(Date.now());
    }
  }, [monitoringPaused]);

  const markNotificationsRead = async () => {
    await fetch('/api/search', { method: 'POST' });
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <LiveStreamContext.Provider
      value={{
        sseConnected,
        monitoringPaused,
        lastEventTick,
        isRefreshing,
        triggerRefresh,
        togglePause,
      }}
    >
      <div className="min-h-screen flex bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
        {/* Sidebar Navigation */}
        <aside
          className={`fixed inset-y-0 left-0 z-40 w-56 flex flex-col border-r border-zinc-200 dark:border-zinc-800/80 bg-white dark:bg-zinc-950 transition-transform lg:translate-x-0 ${
            mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <div className="h-14 px-4 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800/80">
            <Link href="/" className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-950 flex items-center justify-center">
                <Terminal className="w-4 h-4" />
              </div>
              <div>
                <div className="text-sm font-semibold tracking-tight leading-none">DevScope</div>
                <div className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400 mt-0.5">
                  LOCAL OPS MONITOR
                </div>
              </div>
            </Link>
            <button
              onClick={() => setMobileMenuOpen(false)}
              className="lg:hidden p-1 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
              aria-label="Close navigation"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <nav className="flex-1 px-2.5 py-3 space-y-0.5 overflow-y-auto">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active =
                item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center gap-2.5 px-2.5 py-2 rounded text-xs font-medium transition-colors ${
                    active
                      ? 'bg-zinc-900 text-white dark:bg-zinc-800/90 dark:text-zinc-100'
                      : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900 hover:text-zinc-900 dark:hover:text-zinc-200'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>

          {/* Localhost Binding & Telemetry Footer */}
          <div className="p-3 border-t border-zinc-200 dark:border-zinc-800/80 text-[11px] space-y-1.5 bg-zinc-50/60 dark:bg-zinc-900/30">
            <div className="flex items-center justify-between">
              <span className="text-zinc-500 dark:text-zinc-400">Stream</span>
              <span className="inline-flex items-center gap-1.5 font-mono">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    monitoringPaused
                      ? 'bg-amber-500'
                      : sseConnected
                      ? 'bg-emerald-500'
                      : 'bg-sky-500'
                  }`}
                />
                {monitoringPaused ? 'PAUSED' : sseConnected ? 'SSE LIVE' : 'POLLING'}
              </span>
            </div>
            <div className="flex items-center justify-between text-zinc-500 dark:text-zinc-400">
              <span>Bind</span>
              <span className="font-mono text-zinc-700 dark:text-zinc-300">127.0.0.1</span>
            </div>
          </div>
        </aside>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col lg:pl-56 min-w-0">
          {/* Top Operational Header */}
          <header className="sticky top-0 z-30 h-14 px-4 lg:px-6 flex items-center justify-between gap-3 border-b border-zinc-200 dark:border-zinc-800/80 bg-white/95 dark:bg-zinc-950/95 backdrop-blur">
            <div className="flex items-center gap-3 min-w-0">
              <button
                onClick={() => setMobileMenuOpen(true)}
                className="lg:hidden p-1.5 rounded border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400"
                aria-label="Open navigation"
              >
                <Menu className="w-4 h-4" />
              </button>

              {/* Global Search Bar Trigger */}
              <button
                onClick={() => setSearchOpen(true)}
                className="flex items-center gap-2.5 px-3 py-1.5 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/70 text-xs text-zinc-500 dark:text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors w-56 sm:w-80"
              >
                <Search className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">Search projects, commits, tasks, events...</span>
                <kbd className="ml-auto hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-mono bg-zinc-200/70 dark:bg-zinc-800 rounded text-zinc-600 dark:text-zinc-400">
                  Ctrl+K
                </kbd>
              </button>
            </div>

            {/* Right Controls: Monitoring Pause/Resume, Sync, Notifications, Theme */}
            <div className="flex items-center gap-2">
              <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 text-xs">
                <Radio
                  className={`w-3.5 h-3.5 ${
                    monitoringPaused
                      ? 'text-amber-500'
                      : sseConnected
                      ? 'text-emerald-500'
                      : 'text-sky-500'
                  }`}
                />
                <span className="text-zinc-600 dark:text-zinc-400 font-medium">
                  {monitoringPaused ? 'Monitoring Paused' : 'Live Watcher Active'}
                </span>
              </div>

              <button
                onClick={() => void togglePause()}
                title={monitoringPaused ? 'Resume live monitoring' : 'Pause live monitoring'}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-zinc-200 dark:border-zinc-800 text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
              >
                {monitoringPaused ? (
                  <>
                    <Play className="w-3.5 h-3.5 text-emerald-500" />
                    <span className="hidden sm:inline">Resume</span>
                  </>
                ) : (
                  <>
                    <Pause className="w-3.5 h-3.5 text-amber-500" />
                    <span className="hidden sm:inline">Pause</span>
                  </>
                )}
              </button>

              <button
                onClick={() => void triggerRefresh()}
                disabled={isRefreshing}
                title="Refresh all connectors and workspaces"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-zinc-200 dark:border-zinc-800 text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-sky-500' : ''}`} />
                <span className="hidden sm:inline">{isRefreshing ? 'Syncing' : 'Refresh'}</span>
              </button>

              {/* Notifications Dropdown */}
              <div className="relative">
                <button
                  onClick={() => setNotifOpen((prev) => !prev)}
                  className="relative p-1.5 rounded border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
                  aria-label="Notifications"
                >
                  <Bell className="w-4 h-4 text-zinc-600 dark:text-zinc-400" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-600 text-white text-[10px] font-mono flex items-center justify-center">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </button>

                {notifOpen && (
                  <div className="absolute right-0 mt-2 w-80 sm:w-96 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-lg z-50">
                    <div className="px-3 py-2 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                      <span className="text-xs font-semibold">System Notifications</span>
                      {unreadCount > 0 && (
                        <button
                          onClick={() => void markNotificationsRead()}
                          className="text-[11px] text-sky-600 dark:text-sky-400 hover:underline"
                        >
                          Mark all read
                        </button>
                      )}
                    </div>
                    <div className="max-h-80 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800/60">
                      {notifications.length === 0 ? (
                        <div className="p-4 text-xs text-zinc-500 text-center">
                          No alert notifications recorded.
                        </div>
                      ) : (
                        notifications.map((n) => (
                          <div
                            key={n.id}
                            className={`p-3 text-xs ${
                              !n.read ? 'bg-zinc-50 dark:bg-zinc-800/40' : ''
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium text-zinc-900 dark:text-zinc-100">
                                {n.title}
                              </span>
                              <span className="text-[10px] font-mono text-zinc-500 shrink-0">
                                {formatRelativeTime(n.createdAt)}
                              </span>
                            </div>
                            <p className="text-zinc-600 dark:text-zinc-400 mt-1 line-clamp-2">
                              {n.message}
                            </p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>

              <button
                onClick={toggleTheme}
                className="p-1.5 rounded border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
                title={darkMode ? 'Switch to light theme' : 'Switch to dark theme'}
                aria-label="Toggle theme"
              >
                {darkMode ? (
                  <Sun className="w-4 h-4 text-zinc-400 hover:text-zinc-100" />
                ) : (
                  <Moon className="w-4 h-4 text-zinc-600 hover:text-zinc-900" />
                )}
              </button>
            </div>
          </header>

          {/* Page Content */}
          <main className="flex-1 p-4 lg:p-6 max-w-[1600px] w-full mx-auto">{children}</main>
        </div>

        {/* Global Search Modal */}
        {searchOpen && (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center pt-16 px-4">
            <div className="w-full max-w-2xl rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xl overflow-hidden">
              <div className="p-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center gap-2.5">
                <Search className="w-4 h-4 text-zinc-400" />
                <input
                  type="text"
                  autoFocus
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search projects, repositories, tasks, events, errors, or files..."
                  className="flex-1 bg-transparent text-sm outline-none text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
                />
                <button
                  onClick={() => setSearchOpen(false)}
                  className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="max-h-[65vh] overflow-y-auto p-3 space-y-4 text-xs">
                {searching && <div className="text-zinc-500 py-4 text-center">Searching local SQLite index...</div>}

                {!searching && !searchResults && (
                  <div className="text-zinc-500 py-6 text-center">
                    Type a keyword to search across workspaces, Git repositories, tasks, activity events, and errors.
                  </div>
                )}

                {!searching && searchResults && (
                  <>
                    {searchResults.projects.length > 0 && (
                      <div>
                        <div className="text-[11px] font-mono uppercase text-zinc-500 mb-1.5">
                          Projects ({searchResults.projects.length})
                        </div>
                        <div className="space-y-1">
                          {searchResults.projects.map((p) => (
                            <Link
                              key={p.id}
                              href="/projects"
                              onClick={() => setSearchOpen(false)}
                              className="flex items-center justify-between p-2 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"
                            >
                              <span className="font-medium">{p.name}</span>
                              <span className="font-mono text-zinc-500 text-[11px]">{p.localPath}</span>
                            </Link>
                          ))}
                        </div>
                      </div>
                    )}

                    {searchResults.repositories.length > 0 && (
                      <div>
                        <div className="text-[11px] font-mono uppercase text-zinc-500 mb-1.5">
                          Git Repositories ({searchResults.repositories.length})
                        </div>
                        <div className="space-y-1">
                          {searchResults.repositories.map((r) => (
                            <Link
                              key={r.id}
                              href="/github"
                              onClick={() => setSearchOpen(false)}
                              className="flex items-center justify-between p-2 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"
                            >
                              <span className="font-medium">{r.fullName}</span>
                              <span className="font-mono text-zinc-500 text-[11px]">{r.currentBranch}</span>
                            </Link>
                          ))}
                        </div>
                      </div>
                    )}

                    {searchResults.tasks.length > 0 && (
                      <div>
                        <div className="text-[11px] font-mono uppercase text-zinc-500 mb-1.5">
                          Tasks ({searchResults.tasks.length})
                        </div>
                        <div className="space-y-1">
                          {searchResults.tasks.map((t) => (
                            <Link
                              key={t.id}
                              href="/tasks"
                              onClick={() => setSearchOpen(false)}
                              className="flex items-center justify-between p-2 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"
                            >
                              <span className="font-medium truncate max-w-md">{t.title}</span>
                              <span className="font-mono text-zinc-500 text-[11px] uppercase">{t.status}</span>
                            </Link>
                          ))}
                        </div>
                      </div>
                    )}

                    {searchResults.events.length > 0 && (
                      <div>
                        <div className="text-[11px] font-mono uppercase text-zinc-500 mb-1.5">
                          Activity Events ({searchResults.events.length})
                        </div>
                        <div className="space-y-1">
                          {searchResults.events.slice(0, 8).map((ev) => (
                            <Link
                              key={ev.id}
                              href="/activity"
                              onClick={() => setSearchOpen(false)}
                              className="flex items-center justify-between p-2 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800"
                            >
                              <span className="truncate max-w-md">{ev.title}</span>
                              <span className="font-mono text-zinc-500 text-[11px]">
                                {formatRelativeTime(ev.timestamp)}
                              </span>
                            </Link>
                          ))}
                        </div>
                      </div>
                    )}

                    {searchResults.errors.length > 0 && (
                      <div>
                        <div className="text-[11px] font-mono uppercase text-zinc-500 mb-1.5">
                          Errors ({searchResults.errors.length})
                        </div>
                        <div className="space-y-1">
                          {searchResults.errors.map((er) => (
                            <Link
                              key={er.id}
                              href="/errors"
                              onClick={() => setSearchOpen(false)}
                              className="flex items-center justify-between p-2 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-red-600 dark:text-red-400"
                            >
                              <span className="truncate max-w-md">{er.title}</span>
                              <span className="font-mono text-[11px] uppercase">{er.severity}</span>
                            </Link>
                          ))}
                        </div>
                      </div>
                    )}

                    {searchResults.projects.length === 0 &&
                      searchResults.repositories.length === 0 &&
                      searchResults.tasks.length === 0 &&
                      searchResults.events.length === 0 &&
                      searchResults.errors.length === 0 && (
                        <div className="text-zinc-500 py-6 text-center">
                          No matching records found for &ldquo;{searchQuery}&rdquo;.
                        </div>
                      )}
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </LiveStreamContext.Provider>
  );
}
