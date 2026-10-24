'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  Cpu,
  RefreshCw,
  ShieldCheck,
  Skull,
  Server,
  HardDrive,
  X,
} from 'lucide-react';
import { useLiveStream } from '@/components/AppShell';
import { formatBytes, formatDuration } from '@/components/format';

interface ProcessItem {
  id: string;
  pid: number;
  name: string;
  executable: string;
  commandLine: string;
  workingDirectory: string;
  projectId: string | null;
  category: string;
  cpuPercent: number;
  memoryBytes: number;
  parentPid: number | null;
  listeningPorts: number[];
  startTime: string | null;
  uptimeSeconds: number;
  status: string;
  observedAt: string;
}

interface PerformanceOverview {
  hostname: string;
  platform: string;
  arch: string;
  cpuModel: string;
  cpuCores: number;
  systemMemoryTotalBytes: number;
  systemMemoryFreeBytes: number;
  systemMemoryUsedBytes: number;
  systemMemoryUsagePercent: number;
  devscopeRssBytes: number;
  devscopeHeapUsedBytes: number;
  devscopeUptimeSeconds: number;
  activeDevProcessesCount: number;
  totalDevProcessesMemoryBytes: number;
}

export default function ProcessesPage() {
  const { lastEventTick } = useLiveStream();
  const [processes, setProcesses] = useState<ProcessItem[]>([]);
  const [performance, setPerformance] = useState<PerformanceOverview | null>(null);
  const [projectsMap, setProjectsMap] = useState<Record<string, string>>({});
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [terminateTarget, setTerminateTarget] = useState<ProcessItem | null>(null);
  const [confirmPidInput, setConfirmPidInput] = useState('');
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const loadProcesses = useCallback(async () => {
    try {
      const res = await fetch('/api/processes');
      if (res.ok) {
        const data = await res.json();
        setProcesses(data.processes || []);
        setPerformance(data.performance || null);
        const map: Record<string, string> = {};
        for (const p of data.projects || []) {
          map[p.id] = p.name;
        }
        setProjectsMap(map);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProcesses();
  }, [loadProcesses, lastEventTick]);

  const handleConfirmTerminate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!terminateTarget) return;
    const res = await fetch('/api/processes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pid: terminateTarget.pid,
        confirmPid: Number(confirmPidInput),
        reason: 'Manual termination from DevScope Process Monitor',
      }),
    });
    const data = await res.json();
    setActionMessage(data.message || data.error);
    setTerminateTarget(null);
    setConfirmPidInput('');
    void loadProcesses();
  };

  const filtered = processes.filter((p) => {
    if (categoryFilter !== 'all' && p.category !== categoryFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        p.commandLine.toLowerCase().includes(q) ||
        String(p.pid).includes(q) ||
        p.listeningPorts.some((port) => String(port).includes(q))
      );
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-zinc-200 dark:border-zinc-800/80">
        <div>
          <h1 className="text-lg font-semibold tracking-tight flex items-center gap-2">
            <Cpu className="w-5 h-5 text-sky-500" />
            Terminal & Development Process Monitoring
          </h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Live OS process inspection, listening TCP port discovery, and command-line secret redaction.
          </p>
        </div>

        <button
          onClick={() => void loadProcesses()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Rescan Processes
        </button>
      </div>

      {/* System Performance Overview Strip */}
      {performance && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 font-mono text-xs">
          <div className="p-3.5 rounded border border-zinc-200 dark:border-zinc-800/90 bg-white dark:bg-zinc-900/50">
            <div className="text-[10px] text-zinc-500 uppercase flex items-center justify-between">
              <span>Host CPU</span>
              <Cpu className="w-3.5 h-3.5 text-sky-500" />
            </div>
            <div className="mt-1.5 font-semibold truncate">{performance.cpuModel}</div>
            <div className="mt-1 text-[11px] text-zinc-500">
              {performance.cpuCores} logical cores · {performance.platform}
            </div>
          </div>

          <div className="p-3.5 rounded border border-zinc-200 dark:border-zinc-800/90 bg-white dark:bg-zinc-900/50">
            <div className="text-[10px] text-zinc-500 uppercase flex items-center justify-between">
              <span>System Memory</span>
              <HardDrive className="w-3.5 h-3.5 text-emerald-500" />
            </div>
            <div className="mt-1.5 font-semibold tabular-nums">
              {formatBytes(performance.systemMemoryUsedBytes)} /{' '}
              {formatBytes(performance.systemMemoryTotalBytes)} (
              {performance.systemMemoryUsagePercent}%)
            </div>
            <div className="mt-1 text-[11px] text-zinc-500">
              Free: {formatBytes(performance.systemMemoryFreeBytes)}
            </div>
          </div>

          <div className="p-3.5 rounded border border-zinc-200 dark:border-zinc-800/90 bg-white dark:bg-zinc-900/50">
            <div className="text-[10px] text-zinc-500 uppercase flex items-center justify-between">
              <span>Dev Processes Footprint</span>
              <Server className="w-3.5 h-3.5 text-amber-500" />
            </div>
            <div className="mt-1.5 font-semibold tabular-nums">
              {performance.activeDevProcessesCount} processes (
              {formatBytes(performance.totalDevProcessesMemoryBytes)})
            </div>
            <div className="mt-1 text-[11px] text-zinc-500">
              Node, Python, Git, Antigravity, Build tools
            </div>
          </div>

          <div className="p-3.5 rounded border border-zinc-200 dark:border-zinc-800/90 bg-white dark:bg-zinc-900/50">
            <div className="text-[10px] text-zinc-500 uppercase flex items-center justify-between">
              <span>DevScope Overhead</span>
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
            </div>
            <div className="mt-1.5 font-semibold tabular-nums">
              RSS: {formatBytes(performance.devscopeRssBytes)}
            </div>
            <div className="mt-1 text-[11px] text-zinc-500">
              Heap: {formatBytes(performance.devscopeHeapUsedBytes)} · Uptime:{' '}
              {formatDuration(performance.devscopeUptimeSeconds)}
            </div>
          </div>
        </div>
      )}

      {actionMessage && (
        <div className="p-3 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900 text-xs font-mono flex items-center justify-between">
          <span>{actionMessage}</span>
          <button onClick={() => setActionMessage(null)}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-2 p-3 rounded border border-zinc-200 dark:border-zinc-800/90 bg-white dark:bg-zinc-900/40 text-xs">
        {['all', 'antigravity', 'server', 'node', 'python', 'git', 'build', 'other'].map((cat) => (
          <button
            key={cat}
            onClick={() => setCategoryFilter(cat)}
            className={`px-2.5 py-1 rounded font-mono text-[11px] uppercase ${
              categoryFilter === cat
                ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950'
                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
            }`}
          >
            {cat}
          </button>
        ))}

        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search PID, port, or command..."
          className="ml-auto px-2.5 py-1 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-xs outline-none w-60"
        />
      </div>

      {/* Process Table */}
      <div className="rounded border border-zinc-200 dark:border-zinc-800/90 bg-white dark:bg-zinc-900/40 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800 text-[11px] font-mono uppercase text-zinc-500 bg-zinc-50/50 dark:bg-zinc-900/60">
                <th className="py-2 px-3">PID / PPID</th>
                <th className="py-2 px-3">Process</th>
                <th className="py-2 px-3">Category</th>
                <th className="py-2 px-3">Project / Working Dir</th>
                <th className="py-2 px-3">Ports</th>
                <th className="py-2 px-3 text-right">Memory</th>
                <th className="py-2 px-3 text-right">Uptime</th>
                <th className="py-2 px-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200/60 dark:divide-zinc-800/60 font-mono text-[11px]">
              {loading ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-zinc-500">
                    Scanning OS process table...
                  </td>
                </tr>
              ) : (
                filtered.map((proc) => (
                  <tr key={proc.id} className="hover:bg-zinc-50/80 dark:hover:bg-zinc-900/60">
                    <td className="py-2.5 px-3 tabular-nums">
                      <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                        {proc.pid}
                      </div>
                      <div className="text-[10px] text-zinc-500">
                        PPID: {proc.parentPid ?? '—'}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 max-w-md">
                      <div className="font-sans font-medium text-zinc-900 dark:text-zinc-100">
                        {proc.name}
                      </div>
                      <div
                        className="text-[11px] text-zinc-500 truncate"
                        title={proc.commandLine}
                      >
                        {proc.commandLine}
                      </div>
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 uppercase text-[10px]">
                        {proc.category}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 max-w-[220px]">
                      {proc.projectId && projectsMap[proc.projectId] ? (
                        <div className="font-sans font-medium text-sky-500">
                          {projectsMap[proc.projectId]}
                        </div>
                      ) : null}
                      <div className="text-[10px] text-zinc-500 truncate">
                        {proc.workingDirectory}
                      </div>
                    </td>
                    <td className="py-2.5 px-3">
                      {proc.listeningPorts.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {proc.listeningPorts.map((port) => (
                            <span
                              key={port}
                              className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-500 text-[10px]"
                            >
                              :{port}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-zinc-400">—</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums">
                      {formatBytes(proc.memoryBytes)}
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-zinc-500">
                      {formatDuration(proc.uptimeSeconds)}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <button
                        onClick={() => {
                          setTerminateTarget(proc);
                          setConfirmPidInput('');
                        }}
                        className="px-2 py-1 rounded border border-red-500/30 text-red-500 hover:bg-red-500/10 text-[10px]"
                      >
                        Terminate
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Explicit Confirmation Modal for Process Termination */}
      {terminateTarget && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <form
            onSubmit={(e) => void handleConfirmTerminate(e)}
            className="w-full max-w-md rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-4 text-xs"
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold text-sm flex items-center gap-2 text-red-500">
                <Skull className="w-4 h-4" /> Confirm Process Termination
              </span>
              <button type="button" onClick={() => setTerminateTarget(null)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-zinc-600 dark:text-zinc-400">
              DevScope safety constraints require explicit PID confirmation before terminating a local process.
            </p>
            <div className="p-2.5 rounded bg-zinc-100 dark:bg-zinc-950 font-mono text-[11px] space-y-1">
              <div>
                Process: <strong>{terminateTarget.name}</strong> (PID: {terminateTarget.pid})
              </div>
              <div className="truncate">Command: {terminateTarget.commandLine}</div>
            </div>
            <div>
              <label className="block text-zinc-500 mb-1">
                Type PID <code className="font-mono font-bold">{terminateTarget.pid}</code> to confirm:
              </label>
              <input
                type="number"
                required
                value={confirmPidInput}
                onChange={(e) => setConfirmPidInput(e.target.value)}
                className="w-full px-3 py-1.5 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 font-mono outline-none"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setTerminateTarget(null)}
                className="px-3 py-1.5 rounded border border-zinc-200 dark:border-zinc-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={Number(confirmPidInput) !== terminateTarget.pid}
                className="px-3 py-1.5 rounded bg-red-600 text-white font-medium disabled:opacity-40"
              >
                Terminate Process
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
