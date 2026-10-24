'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  Activity,
  Pause,
  Play,
  RefreshCw,
  Download,
  Filter,
  FileDiff,
  FolderCog,
} from 'lucide-react';
import { useLiveStream } from '@/components/AppShell';
import { formatShortTimestamp, formatRelativeTime } from '@/components/format';

interface EventItem {
  id: string;
  type: string;
  category: string;
  title: string;
  detail: string;
  source: string;
  dataOrigin: string;
  severity: string;
  projectId: string | null;
  sessionId: string | null;
  filePath: string | null;
  timestamp: string;
}

interface FileChangeItem {
  id: string;
  filePath: string;
  relativePath: string;
  changeType: string;
  source: string;
  timestamp: string;
}

interface MonitoringStatus {
  running: boolean;
  paused: boolean;
  watchedPaths: string[];
  watchedProjectsCount: number;
  lastFullSyncAt: string | null;
  eventsIngestedSession: number;
}

export default function ActivityPage() {
  const { lastEventTick, monitoringPaused, togglePause, triggerRefresh, isRefreshing } =
    useLiveStream();

  const [events, setEvents] = useState<EventItem[]>([]);
  const [fileChanges, setFileChanges] = useState<FileChangeItem[]>([]);
  const [monitoring, setMonitoring] = useState<MonitoringStatus | null>(null);
  const [category, setCategory] = useState('all');
  const [severity, setSeverity] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [scopeInput, setScopeInput] = useState('');

  const loadActivity = useCallback(async () => {
    const params = new URLSearchParams();
    if (category !== 'all') params.set('category', category);
    if (severity !== 'all') params.set('severity', severity);
    if (search.trim()) params.set('search', search.trim());
    params.set('limit', '200');

    try {
      const res = await fetch(`/api/activity?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setEvents(data.events || []);
        setFileChanges(data.fileChanges || []);
        setMonitoring(data.monitoring || null);
      }
    } finally {
      setLoading(false);
    }
  }, [category, severity, search]);

  useEffect(() => {
    void loadActivity();
  }, [loadActivity, lastEventTick]);

  const handleSaveScope = async (e: React.FormEvent) => {
    e.preventDefault();
    const paths = scopeInput
      .split(/\r?\n|,/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (paths.length === 0) return;

    await fetch('/api/activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set_scope', scopePaths: paths }),
    });
    setScopeOpen(false);
    void loadActivity();
  };

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-zinc-200 dark:border-zinc-800/80">
        <div>
          <h1 className="text-lg font-semibold tracking-tight flex items-center gap-2">
            <Activity className="w-5 h-5 text-sky-500" />
            Live Development Activity
          </h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Debounced Chokidar filesystem watchers, Git commit observers, and Antigravity tool telemetry.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => void togglePause()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            {monitoringPaused ? (
              <>
                <Play className="w-3.5 h-3.5 text-emerald-500" /> Resume Watcher
              </>
            ) : (
              <>
                <Pause className="w-3.5 h-3.5 text-amber-500" /> Pause Watcher
              </>
            )}
          </button>

          <button
            onClick={() => void triggerRefresh()}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-sky-500' : ''}`} />
            Refresh
          </button>

          <button
            onClick={() => {
              setScopeInput((monitoring?.watchedPaths || []).join('\n'));
              setScopeOpen((prev) => !prev);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <FolderCog className="w-3.5 h-3.5 text-zinc-400" />
            Monitoring Scope ({monitoring?.watchedProjectsCount ?? 0})
          </button>

          <a
            href="/api/export?type=activity&format=csv"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs font-mono hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <Download className="w-3.5 h-3.5" /> CSV
          </a>
          <a
            href="/api/export?type=activity&format=json"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs font-mono hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <Download className="w-3.5 h-3.5" /> JSON
          </a>
        </div>
      </div>

      {/* Monitoring Scope Editor Drawer */}
      {scopeOpen && (
        <form
          onSubmit={(e) => void handleSaveScope(e)}
          className="p-4 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 space-y-3 text-xs"
        >
          <div className="font-semibold">Configure Monitored Workspace Roots</div>
          <p className="text-zinc-500">
            Enter one directory path per line. Exclusions for <code className="font-mono">.git</code>,{' '}
            <code className="font-mono">node_modules</code>, <code className="font-mono">.next</code>,{' '}
            <code className="font-mono">.devscope</code>, and build caches are enforced automatically.
          </p>
          <textarea
            rows={4}
            value={scopeInput}
            onChange={(e) => setScopeInput(e.target.value)}
            className="w-full p-2.5 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 font-mono text-xs outline-none"
          />
          <div className="flex items-center gap-2">
            <button
              type="submit"
              className="px-3 py-1.5 rounded bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 font-medium"
            >
              Update Scope
            </button>
            <button
              type="button"
              onClick={() => setScopeOpen(false)}
              className="px-3 py-1.5 rounded border border-zinc-200 dark:border-zinc-800"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-3 p-3 rounded border border-zinc-200 dark:border-zinc-800/90 bg-white dark:bg-zinc-900/40 text-xs">
        <div className="flex items-center gap-1.5 text-zinc-500">
          <Filter className="w-3.5 h-3.5" />
          <span className="font-medium">Category:</span>
        </div>
        {['all', 'agent', 'command', 'filesystem', 'git', 'task', 'process', 'system'].map((cat) => (
          <button
            key={cat}
            onClick={() => setCategory(cat)}
            className={`px-2.5 py-1 rounded font-mono text-[11px] uppercase transition-colors ${
              category === cat
                ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950'
                : 'bg-zinc-100 dark:bg-zinc-800/70 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800'
            }`}
          >
            {cat}
          </button>
        ))}

        <div className="ml-auto flex items-center gap-2">
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
            className="px-2.5 py-1 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-xs outline-none font-mono"
          >
            <option value="all">All Severities</option>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="error">Error</option>
          </select>

          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter timeline..."
            className="px-2.5 py-1 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-xs outline-none w-48"
          />
        </div>
      </div>

      {/* Main Grid: Activity Timeline Table (8 cols) + Recent File Changes (4 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-8 rounded border border-zinc-200 dark:border-zinc-800/90 bg-white dark:bg-zinc-900/40 overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between text-xs">
            <span className="font-semibold uppercase tracking-wider">
              Observed Events ({events.length})
            </span>
            <span className="font-mono text-[11px] text-zinc-500">
              Deduplicated by SHA-1 & time window
            </span>
          </div>

          {loading ? (
            <div className="p-8 text-xs text-zinc-500 text-center">Loading activity timeline...</div>
          ) : events.length === 0 ? (
            <div className="p-8 text-xs text-zinc-500 text-center">
              No activity events match the current filter.
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[640px] overflow-y-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="sticky top-0 bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 text-[11px] font-mono uppercase text-zinc-500">
                  <tr>
                    <th className="py-2 px-3">Timestamp</th>
                    <th className="py-2 px-3">Category</th>
                    <th className="py-2 px-3">Event & Detail</th>
                    <th className="py-2 px-3">Source</th>
                    <th className="py-2 px-3">Origin</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200/60 dark:divide-zinc-800/60">
                  {events.map((ev) => (
                    <tr key={ev.id} className="hover:bg-zinc-50/80 dark:hover:bg-zinc-900/60">
                      <td className="py-2.5 px-3 font-mono text-[11px] text-zinc-500 whitespace-nowrap tabular-nums">
                        {formatShortTimestamp(ev.timestamp)}
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`px-1.5 py-0.5 rounded font-mono text-[10px] uppercase ${
                            ev.severity === 'error'
                              ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                              : ev.severity === 'warning'
                              ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                              : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
                          }`}
                        >
                          {ev.category}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 max-w-md">
                        <div className="font-medium text-zinc-900 dark:text-zinc-100">
                          {ev.title}
                        </div>
                        {ev.detail && (
                          <div className="font-mono text-[11px] text-zinc-500 truncate mt-0.5">
                            {ev.detail}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[11px] text-zinc-500 whitespace-nowrap">
                        {ev.source}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[10px] uppercase text-zinc-500">
                        {ev.dataOrigin}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Recent File Changes Panel (4 cols) */}
        <div className="lg:col-span-4 rounded border border-zinc-200 dark:border-zinc-800/90 bg-white dark:bg-zinc-900/40 overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between text-xs">
            <span className="font-semibold uppercase tracking-wider flex items-center gap-1.5">
              <FileDiff className="w-4 h-4 text-emerald-500" /> Recent File Operations
            </span>
          </div>

          <div className="divide-y divide-zinc-200/60 dark:divide-zinc-800/60 max-h-[640px] overflow-y-auto">
            {fileChanges.length === 0 ? (
              <div className="p-6 text-xs text-zinc-500 text-center">
                No file changes recorded yet.
              </div>
            ) : (
              fileChanges.map((fc) => (
                <div key={fc.id} className="px-4 py-2.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-medium truncate text-zinc-900 dark:text-zinc-100">
                      {fc.relativePath}
                    </span>
                    <span
                      className={`px-1.5 py-0.5 rounded font-mono text-[10px] uppercase shrink-0 ${
                        fc.changeType === 'created'
                          ? 'bg-emerald-500/10 text-emerald-500'
                          : fc.changeType === 'deleted'
                          ? 'bg-red-500/10 text-red-500'
                          : 'bg-sky-500/10 text-sky-500'
                      }`}
                    >
                      {fc.changeType}
                    </span>
                  </div>
                  <div className="font-mono text-[10px] text-zinc-500 truncate mt-0.5">
                    {fc.filePath}
                  </div>
                  <div className="flex items-center justify-between text-[10px] font-mono text-zinc-400 mt-1">
                    <span>{fc.source}</span>
                    <span>{formatRelativeTime(fc.timestamp)}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
