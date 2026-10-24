'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  Bot,
  FolderGit2,
  GitBranch,
  Cpu,
  Coins,
  AlertTriangle,
  Activity,
  CheckCircle2,
  AlertCircle,
  ArrowUpRight,
  Lock,
  Clock,
  HardDrive,
} from 'lucide-react';
import { useLiveStream } from '@/components/AppShell';
import {
  formatRelativeTime,
  formatBytes,
  formatNumber,
  formatEstimatedCost,
  formatReportedCost,
  formatDuration,
} from '@/components/format';

interface OverviewResponse {
  monitoring: {
    running: boolean;
    paused: boolean;
    watchedPaths: string[];
    watchedProjectsCount: number;
    lastFullSyncAt: string | null;
  };
  databasePath: string;
  projects: Array<{
    id: string;
    name: string;
    localPath: string;
    githubRepo: string | null;
    currentBranch: string | null;
    changedFileCount: number;
    uncommittedSummary: string | null;
    lastActivityAt: string | null;
    monitoringHealth: string;
    isGitRepo: boolean;
  }>;
  repositories: Array<{
    id: string;
    name: string;
    fullName: string;
    currentBranch: string;
    workingTreeStatus: string;
    uncommittedCount: number;
    aheadCount: number;
    behindCount: number;
    htmlUrl: string | null;
  }>;
  sessions: Array<{
    id: string;
    surface: string;
    title: string;
    status: string;
    model: string;
    stepCount: number;
    totalTokens: number;
    estimatedCostUsd: number | null;
    lastActiveAt: string;
    durationSeconds: number;
    isLockedPresence: boolean;
  }>;
  recentEvents: Array<{
    id: string;
    type: string;
    category: string;
    title: string;
    detail: string;
    source: string;
    dataOrigin: string;
    severity: string;
    timestamp: string;
  }>;
  processes: Array<{
    id: string;
    pid: number;
    name: string;
    category: string;
    memoryBytes: number;
    listeningPorts: number[];
  }>;
  openErrorsCount: number;
  integrations: Array<{
    id: string;
    name: string;
    type: string;
    status: string;
    authSource: string;
    lastSuccessAt: string | null;
    lastError: string | null;
  }>;
  usage: {
    totals: {
      requestCount: number;
      totalTokens: number;
      estimatedCostUsd: number | null;
      reportedCostUsd: number | null;
    };
    currentSession: {
      sessionId: string | null;
      model: string;
      totalTokens: number;
      estimatedCostUsd: number | null;
    };
  };
  performance: {
    cpuModel: string;
    cpuCores: number;
    systemMemoryUsedBytes: number;
    systemMemoryTotalBytes: number;
    systemMemoryUsagePercent: number;
    devscopeRssBytes: number;
    activeDevProcessesCount: number;
  };
}

export default function OverviewPage() {
  const { lastEventTick } = useLiveStream();
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    try {
      const res = await fetch('/api/overview');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as OverviewResponse;
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load overview telemetry');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview, lastEventTick]);

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-64 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse" />
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div
              key={idx}
              className="h-24 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="p-6 rounded border border-red-500/30 bg-red-500/5 text-sm text-red-600 dark:text-red-400">
        <div className="font-semibold">Failed to load DevScope Overview</div>
        <div className="mt-1">{error}</div>
      </div>
    );
  }

  if (!data) return null;

  const activeSessions = data.sessions.filter((s) => s.status === 'active' || s.isLockedPresence);
  const dirtyRepos = data.repositories.filter((r) => r.uncommittedCount > 0);

  return (
    <div className="space-y-6">
      {/* Page Title & Live Sync Timestamp */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-zinc-200 dark:border-zinc-800/80">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Operations Overview</h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Real-time local telemetry across Antigravity sessions, workspaces, Git repositories, and OS processes.
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs font-mono text-zinc-500 dark:text-zinc-400">
          <span>Watched: {data.monitoring.watchedProjectsCount} workspaces</span>
          <span>·</span>
          <span>Last sync: {formatRelativeTime(data.monitoring.lastFullSyncAt)}</span>
        </div>
      </div>

      {/* Top 6 KPI Metric Strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Link
          href="/antigravity"
          className="p-3.5 rounded border border-zinc-200 dark:border-zinc-800/90 bg-white dark:bg-zinc-900/50 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors"
        >
          <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
            <span>Agent Sessions</span>
            <Bot className="w-3.5 h-3.5 text-sky-500" />
          </div>
          <div className="mt-2 text-xl font-semibold font-mono tabular-nums">
            {activeSessions.length} <span className="text-xs font-normal text-zinc-500">active</span>
          </div>
          <div className="mt-1 text-[11px] text-zinc-500 truncate">
            {data.sessions.length} observed in ~/.gemini
          </div>
        </Link>

        <Link
          href="/projects"
          className="p-3.5 rounded border border-zinc-200 dark:border-zinc-800/90 bg-white dark:bg-zinc-900/50 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors"
        >
          <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
            <span>Workspaces</span>
            <FolderGit2 className="w-3.5 h-3.5 text-emerald-500" />
          </div>
          <div className="mt-2 text-xl font-semibold font-mono tabular-nums">
            {data.projects.length}
          </div>
          <div className="mt-1 text-[11px] text-zinc-500 truncate">
            {dirtyRepos.length} with uncommitted edits
          </div>
        </Link>

        <Link
          href="/github"
          className="p-3.5 rounded border border-zinc-200 dark:border-zinc-800/90 bg-white dark:bg-zinc-900/50 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors"
        >
          <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
            <span>Git Repositories</span>
            <GitBranch className="w-3.5 h-3.5 text-zinc-400" />
          </div>
          <div className="mt-2 text-xl font-semibold font-mono tabular-nums">
            {data.repositories.length}
          </div>
          <div className="mt-1 text-[11px] text-zinc-500 truncate">
            Auto-discovered locally
          </div>
        </Link>

        <Link
          href="/usage"
          className="p-3.5 rounded border border-zinc-200 dark:border-zinc-800/90 bg-white dark:bg-zinc-900/50 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors"
        >
          <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
            <span>Measured Tokens (30d)</span>
            <Coins className="w-3.5 h-3.5 text-amber-500" />
          </div>
          <div className="mt-2 text-xl font-semibold font-mono tabular-nums">
            {formatNumber(data.usage.totals.totalTokens)}
          </div>
          <div className="mt-1 text-[11px] text-zinc-500 truncate">
            {formatEstimatedCost(data.usage.totals.estimatedCostUsd)}
          </div>
        </Link>

        <Link
          href="/processes"
          className="p-3.5 rounded border border-zinc-200 dark:border-zinc-800/90 bg-white dark:bg-zinc-900/50 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors"
        >
          <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
            <span>Dev Processes</span>
            <Cpu className="w-3.5 h-3.5 text-sky-500" />
          </div>
          <div className="mt-2 text-xl font-semibold font-mono tabular-nums">
            {data.processes.length}
          </div>
          <div className="mt-1 text-[11px] text-zinc-500 truncate">
            RAM: {data.performance.systemMemoryUsagePercent}% system used
          </div>
        </Link>

        <Link
          href="/errors"
          className="p-3.5 rounded border border-zinc-200 dark:border-zinc-800/90 bg-white dark:bg-zinc-900/50 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors"
        >
          <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
            <span>Open Issues</span>
            <AlertTriangle
              className={`w-3.5 h-3.5 ${
                data.openErrorsCount > 0 ? 'text-amber-500' : 'text-emerald-500'
              }`}
            />
          </div>
          <div className="mt-2 text-xl font-semibold font-mono tabular-nums">
            {data.openErrorsCount}
          </div>
          <div className="mt-1 text-[11px] text-zinc-500 truncate">
            {data.openErrorsCount === 0 ? 'All connectors nominal' : 'View in Error Centre'}
          </div>
        </Link>
      </div>

      {/* Connector Health Strip */}
      <div className="rounded border border-zinc-200 dark:border-zinc-800/90 bg-white dark:bg-zinc-900/40 p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Connector & Subsystem Health
          </span>
          <Link
            href="/settings"
            className="text-xs text-sky-600 dark:text-sky-400 hover:underline inline-flex items-center gap-1"
          >
            Diagnostics <ArrowUpRight className="w-3 h-3" />
          </Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          {data.integrations.map((conn) => (
            <div
              key={conn.id}
              className="px-3 py-2 rounded border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/70 flex items-start justify-between gap-2 text-xs"
            >
              <div className="min-w-0">
                <div className="font-medium truncate flex items-center gap-1.5">
                  {conn.status === 'connected' ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  ) : (
                    <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  )}
                  <span className="truncate">{conn.name}</span>
                </div>
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
                  {conn.authSource}
                </div>
              </div>
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] font-mono uppercase shrink-0 ${
                  conn.status === 'connected'
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                    : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                }`}
              >
                {conn.status}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Main Two-Column Grid: Active Agent Sessions + Live Activity Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left 7 columns: Antigravity Sessions & Honest Telemetry */}
        <div className="lg:col-span-7 space-y-5">
          <div className="rounded border border-zinc-200 dark:border-zinc-800/90 bg-white dark:bg-zinc-900/40 overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bot className="w-4 h-4 text-sky-500" />
                <h2 className="text-xs font-semibold uppercase tracking-wider">
                  Antigravity Agent Sessions
                </h2>
              </div>
              <Link
                href="/antigravity"
                className="text-xs text-sky-600 dark:text-sky-400 hover:underline inline-flex items-center gap-1"
              >
                Inspect Telemetry <ArrowUpRight className="w-3 h-3" />
              </Link>
            </div>

            <div className="divide-y divide-zinc-200/70 dark:divide-zinc-800/70">
              {data.sessions.slice(0, 6).map((s) => (
                <div key={s.id} className="px-4 py-3 text-xs hover:bg-zinc-50/80 dark:hover:bg-zinc-900/80">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          s.status === 'active' || s.isLockedPresence
                            ? 'bg-emerald-500'
                            : s.status === 'error'
                            ? 'bg-red-500'
                            : 'bg-zinc-400 dark:bg-zinc-600'
                        }`}
                      />
                      <Link
                        href={`/antigravity?sessionId=${s.id}`}
                        className="font-medium text-zinc-900 dark:text-zinc-100 hover:text-sky-500 truncate"
                      >
                        {s.title}
                      </Link>
                      {s.isLockedPresence && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-[10px] font-mono">
                          <Lock className="w-2.5 h-2.5" /> LIVE LOCK
                        </span>
                      )}
                    </div>
                    <span className="font-mono text-[11px] text-zinc-500 shrink-0">
                      {formatRelativeTime(s.lastActiveAt)}
                    </span>
                  </div>

                  <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-500 dark:text-zinc-400 font-mono">
                    <span>ID: {s.id.slice(0, 8)}</span>
                    <span>Surface: {s.surface}</span>
                    <span>
                      Model:{' '}
                      <strong className="font-normal text-zinc-700 dark:text-zinc-300">
                        {s.model}
                      </strong>
                    </span>
                    <span>Steps: {s.stepCount}</span>
                    <span>Tokens: {formatNumber(s.totalTokens)}</span>
                    <span>Duration: {formatDuration(s.durationSeconds)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Detected Workspaces & Git Status Table */}
          <div className="rounded border border-zinc-200 dark:border-zinc-800/90 bg-white dark:bg-zinc-900/40 overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FolderGit2 className="w-4 h-4 text-emerald-500" />
                <h2 className="text-xs font-semibold uppercase tracking-wider">
                  Monitored Workspaces & Git Status
                </h2>
              </div>
              <Link
                href="/projects"
                className="text-xs text-sky-600 dark:text-sky-400 hover:underline inline-flex items-center gap-1"
              >
                All Projects ({data.projects.length}) <ArrowUpRight className="w-3 h-3" />
              </Link>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800 text-[11px] font-mono uppercase text-zinc-500 bg-zinc-50/50 dark:bg-zinc-900/60">
                    <th className="py-2 px-3">Project</th>
                    <th className="py-2 px-3">Branch</th>
                    <th className="py-2 px-3">Working Tree</th>
                    <th className="py-2 px-3">Health</th>
                    <th className="py-2 px-3 text-right">Last Activity</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200/60 dark:divide-zinc-800/60">
                  {data.projects.slice(0, 8).map((proj) => (
                    <tr
                      key={proj.id}
                      className="hover:bg-zinc-50/80 dark:hover:bg-zinc-900/60 transition-colors"
                    >
                      <td className="py-2.5 px-3">
                        <div className="font-medium text-zinc-900 dark:text-zinc-100">
                          {proj.name}
                        </div>
                        <div className="font-mono text-[11px] text-zinc-500 truncate max-w-[240px]">
                          {proj.localPath}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[11px]">
                        {proj.currentBranch || '—'}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[11px]">
                        {proj.changedFileCount > 0 ? (
                          <span className="text-amber-600 dark:text-amber-400">
                            {proj.changedFileCount} uncommitted
                          </span>
                        ) : (
                          <span className="text-emerald-600 dark:text-emerald-400">Clean</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-mono uppercase ${
                            proj.monitoringHealth === 'healthy'
                              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                              : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                          }`}
                        >
                          {proj.monitoringHealth}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-[11px] text-zinc-500 tabular-nums">
                        {formatRelativeTime(proj.lastActivityAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right 5 columns: Live Chronological Activity Feed + Honest Telemetry Summary */}
        <div className="lg:col-span-5 space-y-5">
          <div className="rounded border border-zinc-200 dark:border-zinc-800/90 bg-white dark:bg-zinc-900/40 overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-sky-500" />
                <h2 className="text-xs font-semibold uppercase tracking-wider">
                  Chronological Activity Stream
                </h2>
              </div>
              <Link
                href="/activity"
                className="text-xs text-sky-600 dark:text-sky-400 hover:underline inline-flex items-center gap-1"
              >
                Full Timeline <ArrowUpRight className="w-3 h-3" />
              </Link>
            </div>

            <div className="divide-y divide-zinc-200/60 dark:divide-zinc-800/60 max-h-[480px] overflow-y-auto">
              {data.recentEvents.slice(0, 14).map((ev) => (
                <div key={ev.id} className="px-4 py-2.5 text-xs hover:bg-zinc-50/70 dark:hover:bg-zinc-900/60">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
                      {ev.title}
                    </span>
                    <span className="font-mono text-[10px] text-zinc-500 shrink-0 tabular-nums">
                      {formatRelativeTime(ev.timestamp)}
                    </span>
                  </div>
                  {ev.detail && (
                    <div className="font-mono text-[11px] text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
                      {ev.detail}
                    </div>
                  )}
                  <div className="mt-1 flex items-center gap-2 text-[10px] font-mono text-zinc-400">
                    <span className="uppercase px-1 py-0.2 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
                      {ev.category}
                    </span>
                    <span>Source: {ev.source}</span>
                    <span>·</span>
                    <span>Origin: {ev.dataOrigin}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Honest Telemetry & System Resource Footprint Card */}
          <div className="rounded border border-zinc-200 dark:border-zinc-800/90 bg-white dark:bg-zinc-900/40 p-4 space-y-3 text-xs">
            <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-2">
              <span className="font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Telemetry Integrity & Local Overhead
              </span>
              <HardDrive className="w-4 h-4 text-zinc-400" />
            </div>

            <div className="space-y-1.5 font-mono text-[11px]">
              <div className="flex items-center justify-between">
                <span className="text-zinc-500">Active Session Model:</span>
                <span className="text-zinc-900 dark:text-zinc-100">
                  {data.usage.currentSession.model}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-500">Current Session Tokens:</span>
                <span className="text-zinc-900 dark:text-zinc-100 tabular-nums">
                  {formatNumber(data.usage.currentSession.totalTokens)} (Measured)
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-500">Estimated Cost (30d):</span>
                <span className="text-amber-600 dark:text-amber-400 tabular-nums">
                  {formatEstimatedCost(data.usage.totals.estimatedCostUsd)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-500">Provider Reported Cost:</span>
                <span className="text-zinc-500">
                  {formatReportedCost(data.usage.totals.reportedCostUsd)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-500">DevScope Server RSS:</span>
                <span className="text-zinc-900 dark:text-zinc-100 tabular-nums">
                  {formatBytes(data.performance.devscopeRssBytes)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-500">SQLite Storage:</span>
                <span className="text-zinc-500 truncate max-w-[220px]" title={data.databasePath}>
                  .devscope/devscope.db
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
