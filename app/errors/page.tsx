'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  RotateCcw,
  Filter,
} from 'lucide-react';
import { useLiveStream } from '@/components/AppShell';
import { formatShortTimestamp, formatRelativeTime } from '@/components/format';

interface ErrorItem {
  id: string;
  projectId: string | null;
  sessionId: string | null;
  taskId: string | null;
  source: string;
  category: string;
  severity: 'warning' | 'error' | 'critical';
  title: string;
  message: string;
  diagnostics: Record<string, unknown>;
  status: 'open' | 'acknowledged' | 'resolved';
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  occurrenceCount: number;
}

export default function ErrorsPage() {
  const { lastEventTick } = useLiveStream();
  const [errors, setErrors] = useState<ErrorItem[]>([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selectedError, setSelectedError] = useState<ErrorItem | null>(null);
  const [resolutionNote, setResolutionNote] = useState('');

  const loadErrors = useCallback(async () => {
    const params = new URLSearchParams();
    if (statusFilter !== 'all') params.set('status', statusFilter);
    if (severityFilter !== 'all') params.set('severity', severityFilter);
    if (search.trim()) params.set('search', search.trim());
    const res = await fetch(`/api/errors?${params.toString()}`);
    if (res.ok) {
      const data = await res.json();
      setErrors(data.errors || []);
      if (!selectedError && data.errors?.length > 0) {
        setSelectedError(data.errors[0]);
      }
    }
  }, [statusFilter, severityFilter, search, selectedError]);

  useEffect(() => {
    void loadErrors();
  }, [loadErrors, lastEventTick]);

  const handleAction = async (id: string, action: 'acknowledge' | 'resolve' | 'reopen') => {
    const res = await fetch('/api/errors', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        action,
        resolutionNote: resolutionNote.trim() || undefined,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      setSelectedError(data.error);
      setResolutionNote('');
      void loadErrors();
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-zinc-200 dark:border-zinc-800/80">
        <div>
          <h1 className="text-lg font-semibold tracking-tight flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            Error & Reliability Centre
          </h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Tracks failed commands, builds, integration warnings, permission issues, and missing workspace gaps.
          </p>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-2 p-3 rounded border border-zinc-200 dark:border-zinc-800/90 bg-white dark:bg-zinc-900/40 text-xs">
        <Filter className="w-3.5 h-3.5 text-zinc-500" />
        {['all', 'open', 'acknowledged', 'resolved'].map((st) => (
          <button
            key={st}
            onClick={() => setStatusFilter(st)}
            className={`px-2.5 py-1 rounded font-mono text-[11px] uppercase ${
              statusFilter === st
                ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950'
                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
            }`}
          >
            {st}
          </button>
        ))}

        <select
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value)}
          className="px-2.5 py-1 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 font-mono text-xs"
        >
          <option value="all">All Severities</option>
          <option value="warning">Warning</option>
          <option value="error">Error</option>
          <option value="critical">Critical</option>
        </select>

        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search errors..."
          className="ml-auto px-2.5 py-1 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-xs outline-none w-56"
        />
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-6 rounded border border-zinc-200 dark:border-zinc-800/90 bg-white dark:bg-zinc-900/40 overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 text-xs font-semibold uppercase tracking-wider">
            Recorded Issues ({errors.length})
          </div>

          <div className="divide-y divide-zinc-200/60 dark:divide-zinc-800/60 max-h-[600px] overflow-y-auto">
            {errors.length === 0 ? (
              <div className="p-8 text-xs text-zinc-500 text-center">
                No issues match the current filter.
              </div>
            ) : (
              errors.map((err) => {
                const selected = selectedError?.id === err.id;
                return (
                  <button
                    key={err.id}
                    onClick={() => setSelectedError(err)}
                    className={`w-full text-left px-4 py-3 text-xs transition-colors ${
                      selected
                        ? 'bg-sky-500/10 dark:bg-sky-500/10 border-l-2 border-sky-500'
                        : 'hover:bg-zinc-50 dark:hover:bg-zinc-900/60'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
                        {err.title}
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded font-mono text-[10px] uppercase shrink-0 ${
                          err.status === 'resolved'
                            ? 'bg-emerald-500/10 text-emerald-500'
                            : err.severity === 'error' || err.severity === 'critical'
                            ? 'bg-red-500/10 text-red-500'
                            : 'bg-amber-500/10 text-amber-500'
                        }`}
                      >
                        {err.status} · {err.severity}
                      </span>
                    </div>
                    <div className="mt-1 font-mono text-[11px] text-zinc-500 truncate">
                      {err.message}
                    </div>
                    <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-zinc-400">
                      <span>
                        {err.source} · {err.category} ({err.occurrenceCount}x)
                      </span>
                      <span>{formatRelativeTime(err.lastSeenAt)}</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Error Diagnostic & Resolution Inspector */}
        <div className="lg:col-span-6 rounded border border-zinc-200 dark:border-zinc-800/90 bg-white dark:bg-zinc-900/40 p-4 space-y-4 text-xs">
          {!selectedError ? (
            <div className="text-zinc-500 py-12 text-center">
              Select an issue to inspect diagnostics and manage resolution status.
            </div>
          ) : (
            <>
              <div className="border-b border-zinc-200 dark:border-zinc-800 pb-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold">{selectedError.title}</h2>
                  <span className="font-mono text-[10px] uppercase px-2 py-0.5 rounded bg-zinc-200 dark:bg-zinc-800">
                    {selectedError.status}
                  </span>
                </div>
                <div className="mt-1 font-mono text-[11px] text-zinc-500">
                  Source: {selectedError.source} · Category: {selectedError.category} · Occurrences:{' '}
                  {selectedError.occurrenceCount}
                </div>
                <div className="mt-0.5 font-mono text-[11px] text-zinc-500">
                  First seen: {formatShortTimestamp(selectedError.firstSeenAt)} · Last seen:{' '}
                  {formatShortTimestamp(selectedError.lastSeenAt)}
                </div>
              </div>

              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-1">
                  Diagnostic Output (Redacted)
                </div>
                <pre className="p-3 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-950 text-zinc-200 font-mono text-[11px] overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap">
                  {selectedError.message}
                </pre>
              </div>

              {Object.keys(selectedError.diagnostics || {}).length > 0 && (
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-1">
                    Metadata Context
                  </div>
                  <pre className="p-2.5 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 font-mono text-[11px] overflow-x-auto">
                    {JSON.stringify(selectedError.diagnostics, null, 2)}
                  </pre>
                </div>
              )}

              {/* Resolution Controls */}
              <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800 space-y-2.5">
                <input
                  type="text"
                  value={resolutionNote}
                  onChange={(e) => setResolutionNote(e.target.value)}
                  placeholder="Optional resolution note..."
                  className="w-full px-2.5 py-1.5 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 outline-none"
                />
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => void handleAction(selectedError.id, 'acknowledge')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    <Eye className="w-3.5 h-3.5 text-amber-500" /> Acknowledge
                  </button>
                  <button
                    onClick={() => void handleAction(selectedError.id, 'resolve')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-600 text-white font-medium hover:bg-emerald-500"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" /> Mark Resolved
                  </button>
                  {selectedError.status !== 'open' && (
                    <button
                      onClick={() => void handleAction(selectedError.id, 'reopen')}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-zinc-200 dark:border-zinc-800"
                    >
                      <RotateCcw className="w-3.5 h-3.5" /> Reopen
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
