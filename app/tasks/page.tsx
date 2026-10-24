'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  CheckSquare,
  Plus,
  Terminal,
  FileCode,
  AlertCircle,
  Clock,
  Info,
} from 'lucide-react';
import { useLiveStream } from '@/components/AppShell';
import { formatRelativeTime, formatDuration, formatShortTimestamp } from '@/components/format';

interface TaskItem {
  id: string;
  title: string;
  description: string;
  projectId: string | null;
  sessionId: string | null;
  source: 'antigravity' | 'manual' | 'integration';
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'unknown';
  progressText: string;
  startTime: string;
  endTime: string | null;
  durationSeconds: number | null;
  relevantFiles: string[];
  commands: Array<{ command: string; summary?: string; status?: string; timestamp?: string }>;
  errors: string[];
}

interface TaskEvent {
  id: string;
  type: string;
  category: string;
  title: string;
  detail: string;
  source: string;
  timestamp: string;
}

export default function TasksPage() {
  const { lastEventTick } = useLiveStream();
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [taskEvents, setTaskEvents] = useState<TaskEvent[]>([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newProjectId, setNewProjectId] = useState('');
  const [newStatus, setNewStatus] = useState<'queued' | 'running' | 'completed'>('running');

  const loadTasks = useCallback(async () => {
    const params = new URLSearchParams();
    if (statusFilter !== 'all') params.set('status', statusFilter);
    if (sourceFilter !== 'all') params.set('source', sourceFilter);
    const res = await fetch(`/api/tasks?${params.toString()}`);
    if (res.ok) {
      const data = await res.json();
      setTasks(data.tasks || []);
      setProjects(data.projects || []);
      if (!selectedTaskId && data.tasks?.length > 0) {
        setSelectedTaskId(data.tasks[0].id);
      }
    }
  }, [statusFilter, sourceFilter, selectedTaskId]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks, lastEventTick]);

  useEffect(() => {
    if (!selectedTaskId) return;
    const loadDetail = async () => {
      const res = await fetch(`/api/tasks?taskId=${encodeURIComponent(selectedTaskId)}`);
      if (res.ok) {
        const data = await res.json();
        setTaskEvents(data.events || []);
      }
    };
    void loadDetail();
  }, [selectedTaskId, lastEventTick]);

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: newTitle.trim(),
        description: newDesc.trim(),
        projectId: newProjectId || null,
        status: newStatus,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      setNewTitle('');
      setNewDesc('');
      setShowCreateModal(false);
      setSelectedTaskId(data.task.id);
      void loadTasks();
    }
  };

  const handleUpdateStatus = async (id: string, status: TaskItem['status']) => {
    await fetch('/api/tasks', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    });
    void loadTasks();
  };

  const selectedTask = tasks.find((t) => t.id === selectedTaskId) ?? tasks[0] ?? null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-zinc-200 dark:border-zinc-800/80">
        <div>
          <h1 className="text-lg font-semibold tracking-tight flex items-center gap-2">
            <CheckSquare className="w-5 h-5 text-sky-500" />
            Task Tracking & Execution History
          </h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Combines observed Antigravity agent tasks with manually tracked tasks and full event timelines.
          </p>
        </div>

        <button
          onClick={() => setShowCreateModal((prev) => !prev)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950 text-xs font-medium"
        >
          <Plus className="w-3.5 h-3.5" /> Create Manual Task
        </button>
      </div>

      {/* Honest Completion Rule Notice */}
      <div className="p-3 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/40 flex items-center gap-2.5 text-xs text-zinc-600 dark:text-zinc-400">
        <Info className="w-4 h-4 text-sky-500 shrink-0" />
        <span>
          <strong>Status Policy:</strong> DevScope does not infer successful task completion merely because an agent
          becomes idle. Idle sessions without an explicit completion artifact are labeled{' '}
          <code className="font-mono">unknown</code> until verified or updated.
        </span>
      </div>

      {/* Create Manual Task Form */}
      {showCreateModal && (
        <form
          onSubmit={(e) => void handleCreateTask(e)}
          className="p-4 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 space-y-3 text-xs"
        >
          <div className="font-semibold">Create Manually Tracked Task</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-zinc-500 mb-1">Task Title</label>
              <input
                type="text"
                required
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="e.g. Verify database migration index"
                className="w-full px-2.5 py-1.5 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 outline-none"
              />
            </div>
            <div>
              <label className="block text-zinc-500 mb-1">Project</label>
              <select
                value={newProjectId}
                onChange={(e) => setNewProjectId(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 outline-none"
              >
                <option value="">Unassigned</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-zinc-500 mb-1">Initial Status</label>
              <select
                value={newStatus}
                onChange={(e) => setNewStatus(e.target.value as 'queued' | 'running' | 'completed')}
                className="w-full px-2.5 py-1.5 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 outline-none"
              >
                <option value="queued">Queued</option>
                <option value="running">Running</option>
                <option value="completed">Completed</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-zinc-500 mb-1">Description / Notes</label>
            <input
              type="text"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Optional task objective or acceptance criteria"
              className="w-full px-2.5 py-1.5 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 outline-none"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              className="px-3 py-1.5 rounded bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950 font-medium"
            >
              Save Task
            </button>
            <button
              type="button"
              onClick={() => setShowCreateModal(false)}
              className="px-3 py-1.5 rounded border border-zinc-200 dark:border-zinc-800"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-2 p-3 rounded border border-zinc-200 dark:border-zinc-800/90 bg-white dark:bg-zinc-900/40 text-xs">
        {['all', 'running', 'queued', 'completed', 'failed', 'cancelled', 'unknown'].map((st) => (
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
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          className="ml-auto px-2.5 py-1 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 font-mono text-xs"
        >
          <option value="all">All Sources</option>
          <option value="antigravity">Antigravity Observed</option>
          <option value="manual">Manual Tasks</option>
        </select>
      </div>

      {/* Tasks List + Full Task Timeline Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-5 rounded border border-zinc-200 dark:border-zinc-800/90 bg-white dark:bg-zinc-900/40 overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 text-xs font-semibold uppercase tracking-wider">
            Tasks ({tasks.length})
          </div>
          <div className="divide-y divide-zinc-200/60 dark:divide-zinc-800/60 max-h-[620px] overflow-y-auto">
            {tasks.map((t) => {
              const selected = selectedTask?.id === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setSelectedTaskId(t.id)}
                  className={`w-full text-left px-4 py-3 text-xs transition-colors ${
                    selected
                      ? 'bg-sky-500/10 dark:bg-sky-500/10 border-l-2 border-sky-500'
                      : 'hover:bg-zinc-50 dark:hover:bg-zinc-900/60'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
                      {t.title}
                    </span>
                    <span
                      className={`px-1.5 py-0.5 rounded font-mono text-[10px] uppercase shrink-0 ${
                        t.status === 'running'
                          ? 'bg-sky-500/10 text-sky-500'
                          : t.status === 'completed'
                          ? 'bg-emerald-500/10 text-emerald-500'
                          : t.status === 'failed'
                          ? 'bg-red-500/10 text-red-500'
                          : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-500'
                      }`}
                    >
                      {t.status}
                    </span>
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-zinc-500 truncate">
                    {t.progressText}
                  </div>
                  <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-zinc-400">
                    <span>Source: {t.source}</span>
                    <span>
                      {formatDuration(t.durationSeconds)} · {formatRelativeTime(t.startTime)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Task Detail & Event Timeline (7 cols) */}
        <div className="lg:col-span-7 rounded border border-zinc-200 dark:border-zinc-800/90 bg-white dark:bg-zinc-900/40 p-4 space-y-4 text-xs">
          {!selectedTask ? (
            <div className="text-zinc-500 py-12 text-center">
              Select a task to inspect its execution history, relevant files, and event timeline.
            </div>
          ) : (
            <>
              <div className="border-b border-zinc-200 dark:border-zinc-800 pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold">{selectedTask.title}</h2>
                  <p className="text-zinc-500 mt-0.5">{selectedTask.description}</p>
                </div>

                <div className="flex items-center gap-1.5 font-mono text-[11px]">
                  {(['running', 'completed', 'failed', 'cancelled'] as const).map((st) => (
                    <button
                      key={st}
                      onClick={() => void handleUpdateStatus(selectedTask.id, st)}
                      className={`px-2 py-1 rounded border text-[10px] uppercase ${
                        selectedTask.status === st
                          ? 'border-sky-500 bg-sky-500/10 text-sky-500'
                          : 'border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100'
                      }`}
                    >
                      {st}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2.5 font-mono text-[11px]">
                <div className="p-2.5 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/60">
                  <div className="text-[10px] text-zinc-500 uppercase">Start Time</div>
                  <div className="mt-1">{formatShortTimestamp(selectedTask.startTime)}</div>
                </div>
                <div className="p-2.5 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/60">
                  <div className="text-[10px] text-zinc-500 uppercase">Duration</div>
                  <div className="mt-1">{formatDuration(selectedTask.durationSeconds)}</div>
                </div>
                <div className="p-2.5 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/60">
                  <div className="text-[10px] text-zinc-500 uppercase">Progress</div>
                  <div className="mt-1 truncate" title={selectedTask.progressText}>
                    {selectedTask.progressText}
                  </div>
                </div>
              </div>

              {/* Commands */}
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-1.5 flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5" /> Observed Commands (
                  {selectedTask.commands.length})
                </div>
                <div className="space-y-1 max-h-40 overflow-y-auto font-mono text-[11px]">
                  {selectedTask.commands.length === 0 ? (
                    <div className="text-zinc-500">No commands recorded for this task.</div>
                  ) : (
                    selectedTask.commands.map((c, idx) => (
                      <div
                        key={idx}
                        className="p-2 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950"
                      >
                        <div className="text-[10px] text-zinc-500">{c.summary}</div>
                        <div className="truncate text-zinc-800 dark:text-zinc-200">$ {c.command}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Relevant Files */}
              {selectedTask.relevantFiles.length > 0 && (
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-1.5 flex items-center gap-1.5">
                    <FileCode className="w-3.5 h-3.5" /> Relevant Files (
                    {selectedTask.relevantFiles.length})
                  </div>
                  <div className="max-h-28 overflow-y-auto space-y-0.5 font-mono text-[11px] text-zinc-500">
                    {selectedTask.relevantFiles.map((f) => (
                      <div key={f} className="truncate">
                        {f}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Task Event Timeline */}
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-1.5 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" /> Task Event Timeline ({taskEvents.length})
                </div>
                <div className="space-y-1.5 max-h-56 overflow-y-auto">
                  {taskEvents.map((ev) => (
                    <div
                      key={ev.id}
                      className="p-2 rounded border border-zinc-200/70 dark:border-zinc-800 bg-zinc-50/40 dark:bg-zinc-900/50 flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="font-medium truncate">{ev.title}</div>
                        {ev.detail && (
                          <div className="font-mono text-[10px] text-zinc-500 truncate">
                            {ev.detail}
                          </div>
                        )}
                      </div>
                      <span className="font-mono text-[10px] text-zinc-500 shrink-0">
                        {formatShortTimestamp(ev.timestamp)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
