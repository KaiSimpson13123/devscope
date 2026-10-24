'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  GitBranch,
  GitCommit,
  GitPullRequest,
  CircleDot,
  PlayCircle,
  ExternalLink,
  RefreshCw,
  FileDiff,
  CheckCircle2,
  AlertCircle,
  Users,
} from 'lucide-react';
import { useLiveStream } from '@/components/AppShell';
import { formatRelativeTime } from '@/components/format';

interface RepoRecord {
  id: string;
  name: string;
  owner: string;
  fullName: string;
  localPath: string;
  remoteUrl: string;
  htmlUrl: string | null;
  defaultBranch: string;
  currentBranch: string;
  workingTreeStatus: string;
  aheadCount: number;
  behindCount: number;
  uncommittedCount: number;
  openIssuesCount: number | null;
  openPrsCount: number | null;
  workflowStatus: string;
  deploymentStatus: string;
  recentCommits: Array<{
    sha: string;
    shortSha: string;
    message: string;
    author: string;
    date: string;
  }>;
  contributors: Array<{ name: string; commits: number }>;
  openIssues: Array<{
    number: number;
    title: string;
    state: string;
    author: string;
    updatedAt: string;
    url: string;
  }>;
  openPrs: Array<{
    number: number;
    title: string;
    state: string;
    author: string;
    branch?: string;
    updatedAt: string;
    url: string;
  }>;
  workflows: Array<{
    id: number;
    name: string;
    status: string;
    conclusion: string | null;
    branch: string;
    url: string;
    createdAt: string;
  }>;
  changedFiles: Array<{ status: string; path: string }>;
  lastSyncedAt: string;
}

interface AuthStatus {
  authenticated: boolean;
  source: string;
  username: string | null;
  rateLimitRemaining: number | null;
  error: string | null;
}

export default function GitHubPage() {
  const { lastEventTick } = useLiveStream();
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [repos, setRepos] = useState<RepoRecord[]>([]);
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);
  const [diffText, setDiffText] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const loadGitHubData = useCallback(async () => {
    const res = await fetch('/api/github');
    if (res.ok) {
      const data = await res.json();
      setAuth(data.auth);
      setRepos(data.repositories || []);
      if (!selectedRepoId && data.repositories?.length > 0) {
        setSelectedRepoId(data.repositories[0].id);
      }
    }
  }, [selectedRepoId]);

  useEffect(() => {
    void loadGitHubData();
  }, [loadGitHubData, lastEventTick]);

  const handleRefresh = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/github', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setAuth(data.auth);
        setRepos(data.repositories || []);
      }
    } finally {
      setSyncing(false);
    }
  };

  const inspectDiff = async (repoId: string, file?: string) => {
    setLoadingDiff(true);
    setSelectedFile(file || 'All uncommitted changes');
    try {
      const params = new URLSearchParams({ action: 'diff', repoId });
      if (file) params.set('file', file);
      const res = await fetch(`/api/github?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setDiffText(data.diff);
      }
    } finally {
      setLoadingDiff(false);
    }
  };

  const selectedRepo = repos.find((r) => r.id === selectedRepoId) ?? repos[0] ?? null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-zinc-200 dark:border-zinc-800/80">
        <div>
          <h1 className="text-lg font-semibold tracking-tight flex items-center gap-2">
            <GitBranch className="w-5 h-5 text-emerald-500" />
            GitHub & Local Git Repositories
          </h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Automatic local Git discovery, working-tree diff inspection, and authenticated GitHub API telemetry.
          </p>
        </div>

        <button
          onClick={() => void handleRefresh()}
          disabled={syncing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin text-sky-500' : ''}`} />
          {syncing ? 'Syncing Git & GitHub...' : 'Refresh Repositories'}
        </button>
      </div>

      {/* Authentication Status Strip */}
      {auth && (
        <div className="p-3.5 rounded border border-zinc-200 dark:border-zinc-800/90 bg-white dark:bg-zinc-900/40 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2.5">
            {auth.authenticated ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
            )}
            <div>
              <span className="font-semibold">
                {auth.authenticated
                  ? `Authenticated to GitHub as @${auth.username}`
                  : 'Local Git Mode (GitHub Remote API Unauthenticated)'}
              </span>
              <span className="ml-2 font-mono text-[11px] text-zinc-500">
                Source: {auth.source}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4 font-mono text-[11px] text-zinc-500">
            <span>Discovered Repos: {repos.length}</span>
            {auth.rateLimitRemaining !== null && (
              <span>API Rate Limit Remaining: {auth.rateLimitRemaining}</span>
            )}
          </div>
        </div>
      )}

      {/* Repositories Table */}
      <div className="rounded border border-zinc-200 dark:border-zinc-800/90 bg-white dark:bg-zinc-900/40 overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between text-xs">
          <span className="font-semibold uppercase tracking-wider">
            Linked & Discovered Repositories ({repos.length})
          </span>
          <span className="text-zinc-500 text-[11px]">Click any repository to inspect diffs, commits, PRs & CI</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800 text-[11px] font-mono uppercase text-zinc-500 bg-zinc-50/50 dark:bg-zinc-900/60">
                <th className="py-2 px-3">Repository</th>
                <th className="py-2 px-3">Branch (Default)</th>
                <th className="py-2 px-3">Working Tree</th>
                <th className="py-2 px-3">Ahead / Behind</th>
                <th className="py-2 px-3">Issues / PRs</th>
                <th className="py-2 px-3">CI / Deploy</th>
                <th className="py-2 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200/60 dark:divide-zinc-800/60">
              {repos.map((r) => {
                const isSelected = selectedRepo?.id === r.id;
                return (
                  <tr
                    key={r.id}
                    onClick={() => {
                      setSelectedRepoId(r.id);
                      setDiffText(null);
                    }}
                    className={`cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-sky-500/10 dark:bg-sky-500/10'
                        : 'hover:bg-zinc-50 dark:hover:bg-zinc-900/60'
                    }`}
                  >
                    <td className="py-2.5 px-3">
                      <div className="font-medium text-zinc-900 dark:text-zinc-100">
                        {r.fullName}
                      </div>
                      <div className="font-mono text-[11px] text-zinc-500 truncate max-w-[260px]">
                        {r.localPath}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[11px]">
                      <span className="text-zinc-900 dark:text-zinc-100">{r.currentBranch}</span>
                      <span className="text-zinc-400 ml-1">({r.defaultBranch})</span>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[11px]">
                      {r.uncommittedCount > 0 ? (
                        <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400">
                          {r.uncommittedCount} uncommitted
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                          Clean
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[11px] text-zinc-500">
                      ↑{r.aheadCount} ↓{r.behindCount}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[11px]">
                      {r.openIssuesCount !== null ? (
                        <span>
                          {r.openIssuesCount} issues · {r.openPrsCount ?? 0} PRs
                        </span>
                      ) : (
                        <span className="text-zinc-400">Local only</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[11px]">
                      <span className="uppercase">{r.workflowStatus}</span>
                      {r.deploymentStatus !== 'none' && (
                        <span className="block text-[10px] text-emerald-500">
                          {r.deploymentStatus}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedRepoId(r.id);
                            void inspectDiff(r.id);
                          }}
                          className="px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 text-[11px] font-mono hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        >
                          Diff
                        </button>
                        {r.htmlUrl && (
                          <a
                            href={r.htmlUrl}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="p-1 text-zinc-500 hover:text-sky-500"
                            title="Open repository on GitHub"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Selected Repository Inspector */}
      {selectedRepo && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Left 6 cols: Changed Files & Sanitized Diff Viewer */}
          <div className="lg:col-span-6 rounded border border-zinc-200 dark:border-zinc-800/90 bg-white dark:bg-zinc-900/40 p-4 space-y-4 text-xs">
            <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-2">
              <div className="font-semibold uppercase tracking-wider flex items-center gap-1.5">
                <FileDiff className="w-4 h-4 text-amber-500" />
                Working Tree & Diff Inspector — {selectedRepo.name}
              </div>
              <button
                onClick={() => void inspectDiff(selectedRepo.id)}
                className="px-2 py-1 rounded bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950 font-mono text-[11px]"
              >
                View Full Diff
              </button>
            </div>

            {selectedRepo.changedFiles.length === 0 ? (
              <div className="text-zinc-500 py-4 font-mono text-[11px]">
                Working tree is clean (0 uncommitted files).
              </div>
            ) : (
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {selectedRepo.changedFiles.map((cf) => (
                  <div
                    key={cf.path}
                    className="flex items-center justify-between p-1.5 rounded hover:bg-zinc-50 dark:hover:bg-zinc-900 font-mono text-[11px]"
                  >
                    <span className="truncate">
                      <strong className="text-amber-500 mr-2">{cf.status}</strong>
                      {cf.path}
                    </span>
                    <button
                      onClick={() => void inspectDiff(selectedRepo.id, cf.path)}
                      className="text-sky-500 hover:underline shrink-0 ml-2"
                    >
                      Inspect diff
                    </button>
                  </div>
                ))}
              </div>
            )}

            {diffText !== null && (
              <div className="space-y-1.5">
                <div className="text-[11px] font-mono text-zinc-500">
                  Diff Output ({selectedFile}):
                </div>
                <pre className="p-3 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-950 text-zinc-200 font-mono text-[11px] overflow-x-auto max-h-80 overflow-y-auto whitespace-pre-wrap">
                  {loadingDiff ? 'Loading sanitized git diff...' : diffText}
                </pre>
              </div>
            )}
          </div>

          {/* Right 6 cols: Recent Commits, PRs, Issues, Workflows, Contributors */}
          <div className="lg:col-span-6 rounded border border-zinc-200 dark:border-zinc-800/90 bg-white dark:bg-zinc-900/40 p-4 space-y-4 text-xs">
            {/* Recent Commits */}
            <div>
              <div className="font-semibold uppercase tracking-wider text-zinc-500 mb-2 flex items-center gap-1.5">
                <GitCommit className="w-4 h-4 text-sky-500" /> Recent Commits (
                {selectedRepo.recentCommits.length})
              </div>
              <div className="space-y-1.5 max-h-56 overflow-y-auto">
                {selectedRepo.recentCommits.map((c) => (
                  <div
                    key={c.sha}
                    className="p-2 rounded border border-zinc-200/70 dark:border-zinc-800 bg-zinc-50/40 dark:bg-zinc-900/50 flex items-start justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
                        {c.message}
                      </div>
                      <div className="text-[11px] font-mono text-zinc-500 mt-0.5">
                        {c.shortSha} · {c.author} · {formatRelativeTime(c.date)}
                      </div>
                    </div>
                    {selectedRepo.htmlUrl && (
                      <a
                        href={`${selectedRepo.htmlUrl}/commit/${c.sha}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sky-500 hover:underline font-mono text-[11px] shrink-0"
                      >
                        View
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Open PRs & Issues */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-zinc-200 dark:border-zinc-800">
              <div>
                <div className="font-semibold uppercase tracking-wider text-zinc-500 mb-1.5 flex items-center gap-1.5">
                  <GitPullRequest className="w-3.5 h-3.5 text-emerald-500" /> Open Pull Requests (
                  {selectedRepo.openPrs.length})
                </div>
                {selectedRepo.openPrs.length === 0 ? (
                  <div className="text-[11px] text-zinc-500 font-mono">No open PRs</div>
                ) : (
                  <div className="space-y-1">
                    {selectedRepo.openPrs.map((pr) => (
                      <a
                        key={pr.number}
                        href={pr.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block p-1.5 rounded border border-zinc-200 dark:border-zinc-800 hover:border-sky-500/50 truncate"
                      >
                        <span className="font-mono text-zinc-500 mr-1">#{pr.number}</span>
                        {pr.title}
                      </a>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <div className="font-semibold uppercase tracking-wider text-zinc-500 mb-1.5 flex items-center gap-1.5">
                  <CircleDot className="w-3.5 h-3.5 text-amber-500" /> Open Issues (
                  {selectedRepo.openIssues.length})
                </div>
                {selectedRepo.openIssues.length === 0 ? (
                  <div className="text-[11px] text-zinc-500 font-mono">No open issues</div>
                ) : (
                  <div className="space-y-1">
                    {selectedRepo.openIssues.map((iss) => (
                      <a
                        key={iss.number}
                        href={iss.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block p-1.5 rounded border border-zinc-200 dark:border-zinc-800 hover:border-sky-500/50 truncate"
                      >
                        <span className="font-mono text-zinc-500 mr-1">#{iss.number}</span>
                        {iss.title}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* CI Workflows & Contributors */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-zinc-200 dark:border-zinc-800">
              <div>
                <div className="font-semibold uppercase tracking-wider text-zinc-500 mb-1.5 flex items-center gap-1.5">
                  <PlayCircle className="w-3.5 h-3.5 text-sky-500" /> Recent CI Runs (
                  {selectedRepo.workflows.length})
                </div>
                {selectedRepo.workflows.length === 0 ? (
                  <div className="text-[11px] text-zinc-500 font-mono">No recent workflow runs</div>
                ) : (
                  <div className="space-y-1">
                    {selectedRepo.workflows.map((wf) => (
                      <a
                        key={wf.id}
                        href={wf.url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center justify-between p-1.5 rounded border border-zinc-200 dark:border-zinc-800 font-mono text-[11px]"
                      >
                        <span className="truncate">{wf.name}</span>
                        <span className="uppercase text-[10px]">{wf.conclusion || wf.status}</span>
                      </a>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <div className="font-semibold uppercase tracking-wider text-zinc-500 mb-1.5 flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-zinc-400" /> Top Contributors
                </div>
                <div className="space-y-1 font-mono text-[11px]">
                  {selectedRepo.contributors.map((c) => (
                    <div key={c.name} className="flex justify-between">
                      <span>{c.name}</span>
                      <span className="text-zinc-500">{c.commits} recent commits</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
