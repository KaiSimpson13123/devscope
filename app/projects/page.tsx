'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  FolderGit2,
  Plus,
  Pin,
  EyeOff,
  Eye,
  GitBranch,
  Bot,
  Cpu,
  Coins,
  Edit3,
  Check,
  X,
} from 'lucide-react';
import { useLiveStream } from '@/components/AppShell';
import { formatRelativeTime, formatNumber, formatEstimatedCost } from '@/components/format';

interface EnrichedProject {
  id: string;
  name: string;
  localPath: string;
  githubRepo: string | null;
  currentBranch: string | null;
  changedFileCount: number;
  uncommittedSummary: string | null;
  lastBuildStatus: string;
  lastActivityAt: string | null;
  monitoringHealth: string;
  excluded: boolean;
  pinned: boolean;
  isGitRepo: boolean;
  activeSessionsCount: number;
  sessionsCount: number;
  runningProcessesCount: number;
  totalTokens: number;
  estimatedCostUsd: number | null;
  recentCommits: Array<{ sha: string; shortSha: string; message: string; author: string; date: string }>;
  recentEvents: Array<{ id: string; title: string; category: string; timestamp: string }>;
}

export default function ProjectsPage() {
  const { lastEventTick } = useLiveStream();
  const [projects, setProjects] = useState<EnrichedProject[]>([]);
  const [includeExcluded, setIncludeExcluded] = useState(false);
  const [selectedProjId, setSelectedProjId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPath, setNewPath] = useState('');
  const [newRepo, setNewRepo] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [loading, setLoading] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);

  const loadProjects = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects?includeExcluded=${includeExcluded}`);
      if (res.ok) {
        const data = await res.json();
        setProjects(data.projects || []);
        if (!selectedProjId && data.projects?.length > 0) {
          setSelectedProjId(data.projects[0].id);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [includeExcluded, selectedProjId]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects, lastEventTick]);

  const handleRegisterProject = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newName.trim(),
        localPath: newPath.trim(),
        githubRepo: newRepo.trim() || null,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setFormError(data.error || 'Failed to register project');
      return;
    }
    setNewName('');
    setNewPath('');
    setNewRepo('');
    setShowAddForm(false);
    void loadProjects();
  };

  const handleUpdateProject = async (id: string, patch: Record<string, unknown>) => {
    await fetch('/api/projects', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...patch }),
    });
    setEditingId(null);
    void loadProjects();
  };

  const selectedProj = projects.find((p) => p.id === selectedProjId) ?? projects[0] ?? null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-zinc-200 dark:border-zinc-800/80">
        <div>
          <h1 className="text-lg font-semibold tracking-tight flex items-center gap-2">
            <FolderGit2 className="w-5 h-5 text-emerald-500" />
            Project Intelligence & Workspaces
          </h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Comprehensive workspace state combining Git status, active agent sessions, processes, and AI usage.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIncludeExcluded((prev) => !prev)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs font-medium"
          >
            {includeExcluded ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            {includeExcluded ? 'Showing Excluded' : 'Hide Excluded'}
          </button>

          <button
            onClick={() => setShowAddForm((prev) => !prev)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950 text-xs font-medium"
          >
            <Plus className="w-3.5 h-3.5" /> Register Workspace
          </button>
        </div>
      </div>

      {/* Manual Project Registration Form */}
      {showAddForm && (
        <form
          onSubmit={(e) => void handleRegisterProject(e)}
          className="p-4 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 space-y-3 text-xs"
        >
          <div className="font-semibold">Register Local Workspace Directory</div>
          {formError && <div className="text-red-500 font-mono">{formError}</div>}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-zinc-500 mb-1">Project Name</label>
              <input
                type="text"
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. my-service"
                className="w-full px-2.5 py-1.5 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 outline-none"
              />
            </div>
            <div>
              <label className="block text-zinc-500 mb-1">Absolute Local Path</label>
              <input
                type="text"
                required
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
                placeholder="C:\Users\KaiSi\my-service"
                className="w-full px-2.5 py-1.5 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 font-mono outline-none"
              />
            </div>
            <div>
              <label className="block text-zinc-500 mb-1">GitHub Repo (Optional)</label>
              <input
                type="text"
                value={newRepo}
                onChange={(e) => setNewRepo(e.target.value)}
                placeholder="owner/repo"
                className="w-full px-2.5 py-1.5 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 font-mono outline-none"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              className="px-3 py-1.5 rounded bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950 font-medium"
            >
              Register Project
            </button>
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="px-3 py-1.5 rounded border border-zinc-200 dark:border-zinc-800"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Projects Table + Project Intelligence Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-7 rounded border border-zinc-200 dark:border-zinc-800/90 bg-white dark:bg-zinc-900/40 overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 text-xs font-semibold uppercase tracking-wider">
            Detected Workspaces ({projects.length})
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 text-[11px] font-mono uppercase text-zinc-500 bg-zinc-50/50 dark:bg-zinc-900/60">
                  <th className="py-2 px-3">Project</th>
                  <th className="py-2 px-3">Branch / Changes</th>
                  <th className="py-2 px-3">Sessions / Procs</th>
                  <th className="py-2 px-3">Health</th>
                  <th className="py-2 px-3 text-right">Controls</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200/60 dark:divide-zinc-800/60">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-zinc-500">
                      Loading workspace intelligence...
                    </td>
                  </tr>
                ) : (
                  projects.map((p) => {
                    const selected = selectedProj?.id === p.id;
                    return (
                      <tr
                        key={p.id}
                        onClick={() => setSelectedProjId(p.id)}
                        className={`cursor-pointer transition-colors ${
                          selected
                            ? 'bg-sky-500/10 dark:bg-sky-500/10'
                            : 'hover:bg-zinc-50 dark:hover:bg-zinc-900/60'
                        } ${p.excluded ? 'opacity-50' : ''}`}
                      >
                        <td className="py-2.5 px-3">
                          {editingId === p.id ? (
                            <div
                              className="flex items-center gap-1"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <input
                                type="text"
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                className="px-2 py-0.5 rounded border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-xs"
                              />
                              <button
                                onClick={() => void handleUpdateProject(p.id, { name: editName })}
                                className="p-1 text-emerald-500"
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => setEditingId(null)}
                                className="p-1 text-zinc-400"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5 font-medium text-zinc-900 dark:text-zinc-100">
                              {p.pinned && <Pin className="w-3 h-3 text-sky-500" />}
                              <span>{p.name}</span>
                            </div>
                          )}
                          <div className="font-mono text-[11px] text-zinc-500 truncate max-w-[230px]">
                            {p.localPath}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[11px]">
                          <div>{p.currentBranch || '—'}</div>
                          <div className="text-[10px] text-zinc-500">
                            {p.changedFileCount > 0 ? `${p.changedFileCount} changed` : 'Clean'}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[11px] text-zinc-500">
                          <div>{p.sessionsCount} sessions</div>
                          <div>{p.runningProcessesCount} processes</div>
                        </td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`px-1.5 py-0.5 rounded font-mono text-[10px] uppercase ${
                              p.monitoringHealth === 'healthy'
                                ? 'bg-emerald-500/10 text-emerald-500'
                                : 'bg-amber-500/10 text-amber-500'
                            }`}
                          >
                            {p.monitoringHealth}
                          </span>
                        </td>
                        <td
                          className="py-2.5 px-3 text-right"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="inline-flex items-center gap-1">
                            <button
                              onClick={() => {
                                setEditingId(p.id);
                                setEditName(p.name);
                              }}
                              title="Rename project"
                              className="p-1 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() =>
                                void handleUpdateProject(p.id, { pinned: !p.pinned })
                              }
                              title={p.pinned ? 'Unpin project' : 'Pin project'}
                              className={`p-1 ${
                                p.pinned ? 'text-sky-500' : 'text-zinc-400 hover:text-zinc-200'
                              }`}
                            >
                              <Pin className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() =>
                                void handleUpdateProject(p.id, { excluded: !p.excluded })
                              }
                              title={p.excluded ? 'Include in monitoring' : 'Exclude from monitoring'}
                              className="p-1 text-zinc-400 hover:text-amber-500"
                            >
                              {p.excluded ? (
                                <Eye className="w-3.5 h-3.5" />
                              ) : (
                                <EyeOff className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Project Detail Inspector (5 cols) */}
        <div className="lg:col-span-5 rounded border border-zinc-200 dark:border-zinc-800/90 bg-white dark:bg-zinc-900/40 p-4 space-y-4 text-xs">
          {!selectedProj ? (
            <div className="text-zinc-500 py-12 text-center">
              Select a project workspace to inspect its activity history, commits, and AI usage.
            </div>
          ) : (
            <>
              <div className="border-b border-zinc-200 dark:border-zinc-800 pb-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold">{selectedProj.name}</h2>
                  <span className="font-mono text-[11px] text-zinc-500">
                    {formatRelativeTime(selectedProj.lastActivityAt)}
                  </span>
                </div>
                <div className="font-mono text-[11px] text-zinc-500 mt-1 break-all">
                  {selectedProj.localPath}
                </div>
                {selectedProj.githubRepo && (
                  <div className="font-mono text-[11px] text-sky-500 mt-0.5">
                    GitHub: {selectedProj.githubRepo}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2.5 font-mono text-[11px]">
                <div className="p-2.5 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/60">
                  <div className="text-[10px] text-zinc-500 uppercase flex items-center gap-1">
                    <GitBranch className="w-3 h-3" /> Branch & Files
                  </div>
                  <div className="mt-1 font-semibold">
                    {selectedProj.currentBranch || 'No Git'} ({selectedProj.changedFileCount} dirty)
                  </div>
                </div>

                <div className="p-2.5 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/60">
                  <div className="text-[10px] text-zinc-500 uppercase flex items-center gap-1">
                    <Bot className="w-3 h-3" /> Agent Sessions
                  </div>
                  <div className="mt-1 font-semibold">
                    {selectedProj.activeSessionsCount} active / {selectedProj.sessionsCount} total
                  </div>
                </div>

                <div className="p-2.5 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/60">
                  <div className="text-[10px] text-zinc-500 uppercase flex items-center gap-1">
                    <Cpu className="w-3 h-3" /> Running Processes
                  </div>
                  <div className="mt-1 font-semibold">
                    {selectedProj.runningProcessesCount} active
                  </div>
                </div>

                <div className="p-2.5 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/60">
                  <div className="text-[10px] text-zinc-500 uppercase flex items-center gap-1">
                    <Coins className="w-3 h-3" /> AI Usage
                  </div>
                  <div className="mt-1 font-semibold">
                    {formatNumber(selectedProj.totalTokens)} tok (
                    {formatEstimatedCost(selectedProj.estimatedCostUsd)})
                  </div>
                </div>
              </div>

              {/* Project Activity History */}
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">
                  Project Activity History ({selectedProj.recentEvents.length})
                </div>
                {selectedProj.recentEvents.length === 0 ? (
                  <div className="text-zinc-500 font-mono text-[11px]">
                    No events recorded for this project yet.
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-56 overflow-y-auto">
                    {selectedProj.recentEvents.map((ev) => (
                      <div
                        key={ev.id}
                        className="p-2 rounded border border-zinc-200/70 dark:border-zinc-800 bg-zinc-50/40 dark:bg-zinc-900/50 flex items-center justify-between gap-2"
                      >
                        <span className="truncate">{ev.title}</span>
                        <span className="font-mono text-[10px] text-zinc-500 shrink-0">
                          {formatRelativeTime(ev.timestamp)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
