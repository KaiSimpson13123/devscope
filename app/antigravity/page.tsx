'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  Bot,
  CheckCircle2,
  AlertCircle,
  MinusCircle,
  Lock,
  Terminal,
  FileCode,
  ShieldAlert,
  RefreshCw,
} from 'lucide-react';
import { useLiveStream } from '@/components/AppShell';
import {
  formatRelativeTime,
  formatShortTimestamp,
  formatDuration,
  formatNumber,
  formatEstimatedCost,
} from '@/components/format';

interface CapabilityItem {
  key: string;
  label: string;
  status: 'exposed' | 'partial' | 'not_exposed';
  source: string;
  detail: string;
}

interface DiagnosticsData {
  connectorId: string;
  name: string;
  status: string;
  discoveredPaths: string[];
  cliBinaryPath: string | null;
  cliVersion: string | null;
  activeSurfaces: string[];
  sessionCount: number;
  activeSessionCount: number;
  mcpStatus: string;
  pluginsStatus: string;
  availableModels: string[];
  capabilities: CapabilityItem[];
  lastSyncedAt: string;
}

interface SessionItem {
  id: string;
  surface: string;
  projectId: string | null;
  workspacePath: string | null;
  title: string;
  objective: string | null;
  status: string;
  model: string;
  stepCount: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  totalTokens: number;
  estimatedCostUsd: number | null;
  reportedCostUsd: number | null;
  startedAt: string;
  lastActiveAt: string;
  durationSeconds: number;
  isLockedPresence: boolean;
  dataOrigin: string;
}

interface SessionDetailResponse {
  session: SessionItem;
  events: Array<{
    id: string;
    type: string;
    category: string;
    title: string;
    detail: string;
    source: string;
    timestamp: string;
  }>;
  tasks: Array<{
    id: string;
    title: string;
    status: string;
    progressText: string;
    commands: Array<{ command: string; summary?: string; status?: string; timestamp?: string }>;
    relevantFiles: string[];
  }>;
}

export default function AntigravityPage() {
  const { lastEventTick } = useLiveStream();
  const [diagnostics, setDiagnostics] = useState<DiagnosticsData | null>(null);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [sessionDetail, setSessionDetail] = useState<SessionDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const loadAntigravityData = useCallback(async () => {
    try {
      const res = await fetch('/api/antigravity');
      if (res.ok) {
        const data = await res.json();
        setDiagnostics(data.diagnostics);
        setSessions(data.sessions || []);
        if (!selectedSessionId && data.sessions?.length > 0) {
          setSelectedSessionId(data.sessions[0].id);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [selectedSessionId]);

  useEffect(() => {
    void loadAntigravityData();
  }, [loadAntigravityData, lastEventTick]);

  useEffect(() => {
    if (!selectedSessionId) return;
    let active = true;
    const fetchDetail = async () => {
      const res = await fetch(`/api/antigravity?sessionId=${encodeURIComponent(selectedSessionId)}`);
      if (res.ok && active) {
        const json = (await res.json()) as SessionDetailResponse;
        setSessionDetail(json);
      }
    };
    void fetchDetail();
    return () => {
      active = false;
    };
  }, [selectedSessionId, lastEventTick]);

  const handleResync = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/antigravity', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setDiagnostics(data.diagnostics);
        setSessions(data.sessions || []);
      }
    } finally {
      setSyncing(false);
    }
  };

  if (loading && !diagnostics) {
    return <div className="text-xs text-zinc-500 py-8">Inspecting local ~/.gemini environment...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-zinc-200 dark:border-zinc-800/80">
        <div>
          <h1 className="text-lg font-semibold tracking-tight flex items-center gap-2">
            <Bot className="w-5 h-5 text-sky-500" />
            Antigravity Integration & Session Telemetry
          </h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Direct local inspection of ~/.gemini/antigravity-cli, ~/.gemini/antigravity-ide, and agy.exe agentapi.
          </p>
        </div>

        <button
          onClick={() => void handleResync()}
          disabled={syncing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin text-sky-500' : ''}`} />
          {syncing ? 'Scanning ~/.gemini...' : 'Rescan Environment'}
        </button>
      </div>

      {/* Environment Discovery & Honest Integration Status Matrix */}
      {diagnostics && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Discovered Environment Details */}
          <div className="lg:col-span-5 rounded border border-zinc-200 dark:border-zinc-800/90 bg-white dark:bg-zinc-900/40 p-4 space-y-3 text-xs">
            <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-2">
              <span className="font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Discovered Local Environment
              </span>
              <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 font-mono text-[10px] uppercase">
                {diagnostics.status}
              </span>
            </div>

            <div className="space-y-2 font-mono text-[11px]">
              <div>
                <div className="text-zinc-500">CLI Binary & Version:</div>
                <div className="text-zinc-900 dark:text-zinc-100 truncate">
                  {diagnostics.cliBinaryPath || 'Not found'} ({diagnostics.cliVersion})
                </div>
              </div>
              <div>
                <div className="text-zinc-500">Active Surfaces:</div>
                <div className="text-zinc-900 dark:text-zinc-100">
                  {diagnostics.activeSurfaces.join(', ')}
                </div>
              </div>
              <div>
                <div className="text-zinc-500">Discovered AppData Paths:</div>
                <ul className="mt-0.5 space-y-0.5 text-zinc-700 dark:text-zinc-300">
                  {diagnostics.discoveredPaths.map((p) => (
                    <li key={p} className="truncate">
                      • {p}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex justify-between pt-1">
                <span className="text-zinc-500">MCP Status:</span>
                <span className="text-zinc-800 dark:text-zinc-200">{diagnostics.mcpStatus}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Plugins:</span>
                <span className="text-zinc-800 dark:text-zinc-200">{diagnostics.pluginsStatus}</span>
              </div>
            </div>

            <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800 text-[11px] text-zinc-500 flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 text-sky-500 shrink-0 mt-0.5" />
              <span>
                DevScope observes tool executions, commands, file operations, and measured step token counts. Internal chain-of-thought reasoning is never extracted or displayed.
              </span>
            </div>
          </div>

          {/* Honest Capability Matrix */}
          <div className="lg:col-span-7 rounded border border-zinc-200 dark:border-zinc-800/90 bg-white dark:bg-zinc-900/40 p-4 space-y-3 text-xs">
            <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-2">
              <span className="font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Honest Telemetry Capability Matrix
              </span>
              <span className="text-[11px] font-mono text-zinc-500">
                Verified against installed environment
              </span>
            </div>

            <div className="divide-y divide-zinc-200/60 dark:divide-zinc-800/60">
              {diagnostics.capabilities.map((cap) => (
                <div key={cap.key} className="py-2 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium flex items-center gap-1.5">
                      {cap.status === 'exposed' ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      ) : cap.status === 'partial' ? (
                        <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      ) : (
                        <MinusCircle className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                      )}
                      <span>{cap.label}</span>
                    </div>
                    <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                      {cap.detail}
                    </div>
                    <div className="text-[10px] font-mono text-zinc-400 mt-0.5">
                      Source: {cap.source}
                    </div>
                  </div>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono uppercase shrink-0 ${
                      cap.status === 'exposed'
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                        : cap.status === 'partial'
                        ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                        : 'bg-zinc-500/10 text-zinc-500 border border-zinc-500/20'
                    }`}
                  >
                    {cap.status.replace('_', ' ')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Sessions List + Session Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Session Selector Table (5 cols) */}
        <div className="lg:col-span-5 rounded border border-zinc-200 dark:border-zinc-800/90 bg-white dark:bg-zinc-900/40 overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider">
              Discovered Sessions ({sessions.length})
            </span>
          </div>

          <div className="divide-y divide-zinc-200/60 dark:divide-zinc-800/60 max-h-[600px] overflow-y-auto">
            {sessions.map((s) => {
              const selected = s.id === selectedSessionId;
              return (
                <button
                  key={s.id}
                  onClick={() => setSelectedSessionId(s.id)}
                  className={`w-full text-left px-4 py-3 text-xs transition-colors ${
                    selected
                      ? 'bg-sky-500/10 dark:bg-sky-500/10 border-l-2 border-sky-500'
                      : 'hover:bg-zinc-50 dark:hover:bg-zinc-900/60'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
                      {s.title}
                    </span>
                    {s.isLockedPresence ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-500 text-[10px] font-mono shrink-0">
                        <Lock className="w-2.5 h-2.5" /> ACTIVE
                      </span>
                    ) : (
                      <span className="text-[10px] font-mono uppercase text-zinc-500 shrink-0">
                        {s.status}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] font-mono text-zinc-500">
                    <span>{s.id.slice(0, 8)}</span>
                    <span>{s.surface}</span>
                    <span>{s.model}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[11px] font-mono text-zinc-400">
                    <span>{formatNumber(s.totalTokens)} tokens</span>
                    <span>{formatRelativeTime(s.lastActiveAt)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Selected Session Telemetry Inspector (7 cols) */}
        <div className="lg:col-span-7 rounded border border-zinc-200 dark:border-zinc-800/90 bg-white dark:bg-zinc-900/40 p-4 space-y-4 text-xs">
          {!sessionDetail ? (
            <div className="text-zinc-500 py-12 text-center">
              Select an Antigravity session on the left to inspect its transcript telemetry, tool calls, and token usage.
            </div>
          ) : (
            <>
              <div className="border-b border-zinc-200 dark:border-zinc-800 pb-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {sessionDetail.session.title}
                  </h2>
                  <span className="font-mono text-[11px] text-zinc-500">
                    {sessionDetail.session.id}
                  </span>
                </div>
                <p className="text-zinc-500 dark:text-zinc-400 mt-1">
                  Workspace: <span className="font-mono">{sessionDetail.session.workspacePath || 'Not exposed'}</span>
                </p>
              </div>

              {/* Honest Telemetry Fields Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 font-mono">
                <div className="p-2.5 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/60">
                  <div className="text-[10px] text-zinc-500 uppercase">Model</div>
                  <div className="mt-1 font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                    {sessionDetail.session.model}
                  </div>
                </div>
                <div className="p-2.5 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/60">
                  <div className="text-[10px] text-zinc-500 uppercase">Measured Tokens</div>
                  <div className="mt-1 font-semibold text-zinc-900 dark:text-zinc-100 tabular-nums">
                    {formatNumber(sessionDetail.session.totalTokens)}
                  </div>
                </div>
                <div className="p-2.5 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/60">
                  <div className="text-[10px] text-zinc-500 uppercase">Estimated Cost</div>
                  <div className="mt-1 font-semibold text-amber-600 dark:text-amber-400 tabular-nums">
                    {formatEstimatedCost(sessionDetail.session.estimatedCostUsd)}
                  </div>
                </div>
                <div className="p-2.5 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/60">
                  <div className="text-[10px] text-zinc-500 uppercase">Elapsed Duration</div>
                  <div className="mt-1 font-semibold text-zinc-900 dark:text-zinc-100 tabular-nums">
                    {formatDuration(sessionDetail.session.durationSeconds)}
                  </div>
                </div>
              </div>

              {/* Task Progress & Commands */}
              {sessionDetail.tasks[0] && (
                <div className="space-y-3">
                  <div className="p-3 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50/40 dark:bg-zinc-900/40 flex items-center justify-between">
                    <div>
                      <span className="text-zinc-500">Task Progress: </span>
                      <span className="font-mono font-medium">
                        {sessionDetail.tasks[0].progressText}
                      </span>
                    </div>
                    <span className="font-mono text-[10px] uppercase px-2 py-0.5 rounded bg-zinc-200 dark:bg-zinc-800">
                      Status: {sessionDetail.tasks[0].status}
                    </span>
                  </div>

                  {/* Executed Terminal Commands */}
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-1.5 flex items-center gap-1.5">
                      <Terminal className="w-3.5 h-3.5" /> Initiated Terminal Commands (
                      {sessionDetail.tasks[0].commands.length})
                    </div>
                    {sessionDetail.tasks[0].commands.length === 0 ? (
                      <div className="text-zinc-500 font-mono text-[11px]">
                        No terminal commands recorded in this session transcript.
                      </div>
                    ) : (
                      <div className="space-y-1.5 max-h-48 overflow-y-auto">
                        {sessionDetail.tasks[0].commands.map((cmd, idx) => (
                          <div
                            key={idx}
                            className="p-2 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 font-mono text-[11px]"
                          >
                            <div className="flex items-center justify-between text-zinc-500 text-[10px]">
                              <span>{cmd.summary || 'run_command'}</span>
                              <span>{formatShortTimestamp(cmd.timestamp)}</span>
                            </div>
                            <div className="mt-0.5 text-zinc-800 dark:text-zinc-200 break-all">
                              $ {cmd.command}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Files Inspected or Modified */}
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-1.5 flex items-center gap-1.5">
                      <FileCode className="w-3.5 h-3.5" /> Files Touched (
                      {sessionDetail.tasks[0].relevantFiles.length})
                    </div>
                    <div className="max-h-36 overflow-y-auto space-y-1 font-mono text-[11px] text-zinc-600 dark:text-zinc-400">
                      {sessionDetail.tasks[0].relevantFiles.map((file) => (
                        <div key={file} className="truncate">
                          {file}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
