import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import {
  getSetting,
  upsertProject,
  getProjects,
  upsertRepository,
  getRepositories,
  getRepositoryById,
  upsertIntegrationConnection,
  recordError,
  type RepositoryRecord,
} from '@/lib/db';
import { ingestActivityEvent } from '@/lib/events';
import { isSafeLocalPath, isSensitiveFilePath, redactSecrets } from '@/lib/security';

export interface GitHubAuthInfo {
  authenticated: boolean;
  source: 'gh-cli' | 'env-token' | 'git-credential-manager' | 'none';
  username: string | null;
  token: string | null;
  rateLimitRemaining: number | null;
  error?: string;
}

let cachedAuthInfo: { info: GitHubAuthInfo; expiresAt: number } | null = null;
const remoteMetaCache = new Map<
  string,
  {
    expiresAt: number;
    defaultBranch?: string;
    openIssues: RepositoryRecord['openIssues'];
    openPrs: RepositoryRecord['openPrs'];
    workflows: RepositoryRecord['workflows'];
    workflowStatus: string;
    deploymentStatus: string;
  }
>();

let lastRateLimitRemaining: number | null = null;

/**
 * Resolves GitHub authentication in priority order:
 * 1. GitHub CLI (`gh auth token`) when installed and authenticated
 * 2. Local environment variable `GITHUB_TOKEN` (if not placeholder)
 * 3. Git Credential Manager (`git credential fill` for github.com)
 * Never hardcodes credentials.
 */
export async function resolveGitHubAuth(forceRefresh = false): Promise<GitHubAuthInfo> {
  if (!forceRefresh && cachedAuthInfo && Date.now() < cachedAuthInfo.expiresAt) {
    return cachedAuthInfo.info;
  }

  let token: string | null = null;
  let source: GitHubAuthInfo['source'] = 'none';

  // 1. Try GitHub CLI (`gh`)
  try {
    const ghToken = execFileSync('gh', ['auth', 'token'], {
      encoding: 'utf8',
      timeout: 2500,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (ghToken && ghToken.length > 10) {
      token = ghToken;
      source = 'gh-cli';
    }
  } catch {
    // gh not installed or not logged in
  }

  // 2. Try GITHUB_TOKEN environment variable
  if (!token && process.env.GITHUB_TOKEN) {
    const envTok = process.env.GITHUB_TOKEN.trim();
    if (envTok && !envTok.includes('placeholder') && envTok.length > 10) {
      token = envTok;
      source = 'env-token';
    }
  }

  // 3. Try Git Credential Manager (`git credential fill`)
  if (!token) {
    try {
      const credOut = execFileSync('git', ['credential', 'fill'], {
        input: 'protocol=https\nhost=github.com\n\n',
        encoding: 'utf8',
        timeout: 3000,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      const pwMatch = credOut.match(/password=([^\r\n]+)/);
      if (pwMatch && pwMatch[1]) {
        token = pwMatch[1].trim();
        source = 'git-credential-manager';
      }
    } catch {
      // git credential helper unavailable
    }
  }

  if (!token) {
    const info: GitHubAuthInfo = {
      authenticated: false,
      source: 'none',
      username: null,
      token: null,
      rateLimitRemaining: null,
      error: 'No GitHub CLI session, GITHUB_TOKEN, or Git Credential Manager token found.',
    };
    cachedAuthInfo = { info, expiresAt: Date.now() + 60_000 };
    return info;
  }

  // Verify token against https://api.github.com/user
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'DevScope-Local-Monitor/1.0',
      },
      signal: AbortSignal.timeout(4500),
    });

    const remHeader = res.headers.get('x-ratelimit-remaining');
    if (remHeader !== null) {
      lastRateLimitRemaining = Number(remHeader);
    }

    if (!res.ok) {
      const info: GitHubAuthInfo = {
        authenticated: false,
        source,
        username: null,
        token: null,
        rateLimitRemaining: lastRateLimitRemaining,
        error: `GitHub API returned HTTP ${res.status}`,
      };
      cachedAuthInfo = { info, expiresAt: Date.now() + 60_000 };
      return info;
    }

    const userJson = (await res.json()) as { login?: string };
    const info: GitHubAuthInfo = {
      authenticated: true,
      source,
      username: userJson.login || null,
      token,
      rateLimitRemaining: lastRateLimitRemaining,
    };
    cachedAuthInfo = { info, expiresAt: Date.now() + 5 * 60_000 };
    return info;
  } catch (err) {
    const info: GitHubAuthInfo = {
      authenticated: false,
      source,
      username: null,
      token: null,
      rateLimitRemaining: lastRateLimitRemaining,
      error: err instanceof Error ? err.message : 'GitHub API network error',
    };
    cachedAuthInfo = { info, expiresAt: Date.now() + 60_000 };
    return info;
  }
}

function runGit(cwd: string, args: string[], timeout = 3000): string {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      timeout,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

export function parseGitHubRemote(remoteUrl: string): { owner: string; name: string; htmlUrl: string | null } {
  if (!remoteUrl) {
    return { owner: 'local', name: 'local', htmlUrl: null };
  }
  const httpsMatch = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?$/i);
  if (httpsMatch) {
    const owner = httpsMatch[1];
    const name = httpsMatch[2];
    return {
      owner,
      name,
      htmlUrl: `https://github.com/${owner}/${name}`,
    };
  }
  return { owner: 'local', name: path.basename(remoteUrl, '.git') || 'local', htmlUrl: null };
}

/**
 * Discovers local Git repositories inside configured workspace roots (depth 0 and depth 1)
 * without scanning the entire filesystem indiscriminately.
 */
export function discoverLocalGitDirectories(customRoots?: string[]): string[] {
  const roots = customRoots ?? getSetting<string[]>('workspaceRoots', [process.cwd()]);
  const exclusions = new Set(
    getSetting<string[]>('monitoringExclusions', []).map((e) => e.toLowerCase())
  );
  const skipDirs = new Set([
    ...exclusions,
    'appdata',
    '.gemini',
    '.vscode',
    '.cursor',
    'contacts',
    'favorites',
    'links',
    'music',
    'pictures',
    'videos',
    'saved games',
    'searches',
    'onedrive',
    'downloads',
    '3d objects',
  ]);

  const discovered = new Set<string>();

  for (const rawRoot of roots) {
    if (!rawRoot || !fs.existsSync(rawRoot) || !isSafeLocalPath(rawRoot)) continue;
    const rootPath = path.resolve(rawRoot);

    if (fs.existsSync(path.join(rootPath, '.git'))) {
      discovered.add(rootPath);
    }

    try {
      const entries = fs.readdirSync(rootPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.') || skipDirs.has(entry.name.toLowerCase())) continue;
        // Skip duplicate backup folders like " - Copy"
        if (entry.name.toLowerCase().endsWith(' - copy')) continue;

        const childPath = path.join(rootPath, entry.name);
        if (fs.existsSync(path.join(childPath, '.git'))) {
          discovered.add(childPath);
        }
      }
    } catch {
      // ignore permission errors on individual folders
    }
  }

  return Array.from(discovered);
}

export function inspectLocalGitRepo(repoPath: string): {
  currentBranch: string;
  defaultBranch: string;
  remoteUrl: string;
  owner: string;
  name: string;
  fullName: string;
  htmlUrl: string | null;
  workingTreeStatus: 'clean' | 'dirty';
  uncommittedCount: number;
  changedFiles: Array<{ status: string; path: string }>;
  aheadCount: number;
  behindCount: number;
  recentCommits: RepositoryRecord['recentCommits'];
  contributors: RepositoryRecord['contributors'];
} {
  const currentBranch =
    runGit(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']) ||
    runGit(repoPath, ['symbolic-ref', '--short', 'HEAD']) ||
    'main';

  const remoteUrl = runGit(repoPath, ['remote', 'get-url', 'origin']);
  const parsedRemote = parseGitHubRemote(remoteUrl);
  const repoName = parsedRemote.owner !== 'local' ? parsedRemote.name : path.basename(repoPath);
  const fullName = `${parsedRemote.owner}/${repoName}`;

  const defaultRef = runGit(repoPath, ['symbolic-ref', 'refs/remotes/origin/HEAD']);
  const defaultBranch = defaultRef ? defaultRef.replace('refs/remotes/origin/', '') : currentBranch || 'main';

  const porcelain = runGit(repoPath, ['status', '--porcelain']);
  const changedFiles: Array<{ status: string; path: string }> = [];
  if (porcelain) {
    for (const line of porcelain.split(/\r?\n/)) {
      if (line.trim().length < 3) continue;
      const status = line.slice(0, 2).trim() || 'M';
      const filePath = line.slice(3).trim();
      changedFiles.push({ status, path: filePath });
    }
  }

  let aheadCount = 0;
  let behindCount = 0;
  const revList = runGit(repoPath, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}']);
  if (revList) {
    const parts = revList.split(/\s+/);
    if (parts.length === 2) {
      aheadCount = Number(parts[0]) || 0;
      behindCount = Number(parts[1]) || 0;
    }
  }

  const logOut = runGit(repoPath, [
    'log',
    '-n',
    '8',
    '--pretty=format:%H%x09%h%x09%s%x09%an%x09%aI',
  ]);
  const recentCommits: RepositoryRecord['recentCommits'] = [];
  const authorCounts = new Map<string, number>();

  if (logOut) {
    for (const line of logOut.split(/\r?\n/)) {
      const [sha, shortSha, message, author, date] = line.split('\t');
      if (sha && shortSha) {
        recentCommits.push({
          sha,
          shortSha,
          message: redactSecrets(message || ''),
          author: author || 'Unknown',
          date: date || new Date().toISOString(),
        });
        const aName = author || 'Unknown';
        authorCounts.set(aName, (authorCounts.get(aName) ?? 0) + 1);
      }
    }
  }

  const contributors = Array.from(authorCounts.entries()).map(([name, commits]) => ({
    name,
    commits,
  }));

  return {
    currentBranch,
    defaultBranch,
    remoteUrl,
    owner: parsedRemote.owner,
    name: repoName,
    fullName,
    htmlUrl: parsedRemote.htmlUrl,
    workingTreeStatus: changedFiles.length > 0 ? 'dirty' : 'clean',
    uncommittedCount: changedFiles.length,
    changedFiles: changedFiles.slice(0, 100),
    aheadCount,
    behindCount,
    recentCommits,
    contributors,
  };
}

async function fetchGitHubRemoteDetails(
  owner: string,
  repo: string,
  token: string,
  forceRefresh = false
): Promise<{
  defaultBranch?: string;
  openIssues: RepositoryRecord['openIssues'];
  openPrs: RepositoryRecord['openPrs'];
  workflows: RepositoryRecord['workflows'];
  workflowStatus: string;
  deploymentStatus: string;
}> {
  const cacheKey = `${owner}/${repo}`.toLowerCase();
  const cached = remoteMetaCache.get(cacheKey);
  if (!forceRefresh && cached && Date.now() < cached.expiresAt) {
    return cached;
  }

  // Respect GitHub API rate limits
  if (lastRateLimitRemaining !== null && lastRateLimitRemaining < 15) {
    return (
      cached ?? {
        openIssues: [],
        openPrs: [],
        workflows: [],
        workflowStatus: 'rate_limited',
        deploymentStatus: 'none',
      }
    );
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'DevScope-Local-Monitor/1.0',
  };

  let defaultBranch: string | undefined;
  const openIssues: RepositoryRecord['openIssues'] = [];
  const openPrs: RepositoryRecord['openPrs'] = [];
  const workflows: RepositoryRecord['workflows'] = [];
  let workflowStatus = 'none';
  let deploymentStatus = 'none';

  try {
    const [repoRes, pullsRes, issuesRes, actionsRes, deploysRes] = await Promise.all([
      fetch(`https://api.github.com/repos/${owner}/${repo}`, {
        headers,
        signal: AbortSignal.timeout(4000),
      }),
      fetch(`https://api.github.com/repos/${owner}/${repo}/pulls?state=open&per_page=10`, {
        headers,
        signal: AbortSignal.timeout(4000),
      }),
      fetch(`https://api.github.com/repos/${owner}/${repo}/issues?state=open&per_page=15`, {
        headers,
        signal: AbortSignal.timeout(4000),
      }),
      fetch(`https://api.github.com/repos/${owner}/${repo}/actions/runs?per_page=5`, {
        headers,
        signal: AbortSignal.timeout(4000),
      }),
      fetch(`https://api.github.com/repos/${owner}/${repo}/deployments?per_page=3`, {
        headers,
        signal: AbortSignal.timeout(4000),
      }),
    ]);

    const rem = repoRes.headers.get('x-ratelimit-remaining');
    if (rem !== null) lastRateLimitRemaining = Number(rem);

    if (repoRes.ok) {
      const rData = (await repoRes.json()) as { default_branch?: string };
      if (rData.default_branch) defaultBranch = rData.default_branch;
    }

    if (pullsRes.ok) {
      const prs = (await pullsRes.json()) as Array<{
        number: number;
        title: string;
        state: string;
        user?: { login?: string };
        head?: { ref?: string };
        updated_at: string;
        html_url: string;
        draft?: boolean;
      }>;
      for (const pr of prs) {
        openPrs.push({
          number: pr.number,
          title: pr.title,
          state: pr.state,
          author: pr.user?.login || 'unknown',
          branch: pr.head?.ref,
          updatedAt: pr.updated_at,
          url: pr.html_url,
          draft: pr.draft,
        });
      }
    }

    if (issuesRes.ok) {
      const rawIssues = (await issuesRes.json()) as Array<{
        number: number;
        title: string;
        state: string;
        user?: { login?: string };
        updated_at: string;
        html_url: string;
        pull_request?: unknown;
      }>;
      for (const iss of rawIssues) {
        if (iss.pull_request) continue; // GitHub issues endpoint includes PRs; filter them out
        openIssues.push({
          number: iss.number,
          title: iss.title,
          state: iss.state,
          author: iss.user?.login || 'unknown',
          updatedAt: iss.updated_at,
          url: iss.html_url,
        });
      }
    }

    if (actionsRes.ok) {
      const actJson = (await actionsRes.json()) as {
        workflow_runs?: Array<{
          id: number;
          name?: string;
          status: string;
          conclusion: string | null;
          head_branch?: string;
          html_url: string;
          created_at: string;
        }>;
      };
      const runs = actJson.workflow_runs ?? [];
      for (const run of runs) {
        workflows.push({
          id: run.id,
          name: run.name || 'Workflow',
          status: run.status,
          conclusion: run.conclusion,
          branch: run.head_branch || 'main',
          url: run.html_url,
          createdAt: run.created_at,
        });
      }
      if (runs.length > 0) {
        workflowStatus = runs[0].conclusion || runs[0].status || 'unknown';
      }
    }

    if (deploysRes.ok) {
      const deps = (await deploysRes.json()) as Array<{ environment?: string }>;
      if (Array.isArray(deps) && deps.length > 0) {
        deploymentStatus = `active (${deps[0].environment || 'production'})`;
      }
    }
  } catch (err) {
    recordError({
      dedupeKey: `github_api_${owner}_${repo}`,
      source: 'github-integration',
      category: 'github_api_error',
      severity: 'warning',
      title: `GitHub API query error for ${owner}/${repo}`,
      message: err instanceof Error ? err.message : 'Request timeout or network failure',
    });
  }

  const result = {
    defaultBranch,
    openIssues,
    openPrs,
    workflows,
    workflowStatus,
    deploymentStatus,
  };
  remoteMetaCache.set(cacheKey, { ...result, expiresAt: Date.now() + 3 * 60_000 });
  return result;
}

export async function syncAllRepositories(opts?: {
  forceRemote?: boolean;
  customRoots?: string[];
}): Promise<{ repositories: RepositoryRecord[]; auth: GitHubAuthInfo }> {
  const gitDirs = discoverLocalGitDirectories(opts?.customRoots);
  const auth = await resolveGitHubAuth(opts?.forceRemote);

  // Also include any manually registered projects that have a .git directory
  for (const proj of getProjects({ includeExcluded: false })) {
    if (fs.existsSync(path.join(proj.localPath, '.git')) && !gitDirs.includes(proj.localPath)) {
      gitDirs.push(proj.localPath);
    }
  }

  // Enrich up to 6 GitHub-linked repos per cycle with remote GitHub API calls for fast responsiveness
  let remoteCallsMade = 0;

  for (const dir of gitDirs) {
    if (!fs.existsSync(dir)) continue;
    const localInfo = inspectLocalGitRepo(dir);

    const lastCommitTs = localInfo.recentCommits[0]?.date || new Date().toISOString();
    const project = upsertProject({
      name: path.basename(dir),
      localPath: dir,
      githubRepo: localInfo.owner !== 'local' ? localInfo.fullName : null,
      currentBranch: localInfo.currentBranch,
      changedFileCount: localInfo.uncommittedCount,
      uncommittedSummary:
        localInfo.uncommittedCount > 0 ? `${localInfo.uncommittedCount} uncommitted file(s)` : 'Working tree clean',
      lastActivityAt: lastCommitTs,
      monitoringHealth: 'healthy',
      isGitRepo: true,
    });

    let openIssues: RepositoryRecord['openIssues'] = [];
    let openPrs: RepositoryRecord['openPrs'] = [];
    let workflows: RepositoryRecord['workflows'] = [];
    let workflowStatus = 'none';
    let deploymentStatus = 'none';
    let defaultBranch = localInfo.defaultBranch;

    if (auth.authenticated && auth.token && localInfo.owner !== 'local' && remoteCallsMade < 8) {
      remoteCallsMade++;
      const remoteData = await fetchGitHubRemoteDetails(
        localInfo.owner,
        localInfo.name,
        auth.token,
        opts?.forceRemote
      );
      openIssues = remoteData.openIssues;
      openPrs = remoteData.openPrs;
      workflows = remoteData.workflows;
      workflowStatus = remoteData.workflowStatus;
      deploymentStatus = remoteData.deploymentStatus;
      if (remoteData.defaultBranch) defaultBranch = remoteData.defaultBranch;
    }

    upsertRepository({
      projectId: project.id,
      name: localInfo.name,
      owner: localInfo.owner,
      fullName: localInfo.fullName,
      localPath: dir,
      remoteUrl: localInfo.remoteUrl || 'local-only',
      htmlUrl: localInfo.htmlUrl,
      defaultBranch,
      currentBranch: localInfo.currentBranch,
      workingTreeStatus: localInfo.workingTreeStatus,
      aheadCount: localInfo.aheadCount,
      behindCount: localInfo.behindCount,
      uncommittedCount: localInfo.uncommittedCount,
      openIssuesCount: auth.authenticated && localInfo.owner !== 'local' ? openIssues.length : null,
      openPrsCount: auth.authenticated && localInfo.owner !== 'local' ? openPrs.length : null,
      workflowStatus,
      deploymentStatus,
      recentCommits: localInfo.recentCommits,
      contributors: localInfo.contributors,
      openIssues,
      openPrs,
      workflows,
      changedFiles: localInfo.changedFiles,
    });

    // Ingest latest commit into the activity timeline (deduplicated by commit SHA)
    const latestCommit = localInfo.recentCommits[0];
    if (latestCommit) {
      ingestActivityEvent({
        dedupeKey: `git_commit_${dir}_${latestCommit.sha}`,
        type: 'git_commit_created',
        category: 'git',
        title: `Commit ${latestCommit.shortSha} in ${localInfo.name}: ${latestCommit.message.slice(0, 72)}`,
        detail: `Author: ${latestCommit.author} · Branch: ${localInfo.currentBranch}`,
        source: 'git-observer',
        dataOrigin: 'measured',
        severity: 'info',
        projectId: project.id,
        timestamp: latestCommit.date,
      });
    }
  }

  const nowIso = new Date().toISOString();
  upsertIntegrationConnection({
    id: 'github',
    name: 'GitHub & Local Git Integration',
    type: 'github',
    status: auth.authenticated ? 'connected' : 'degraded',
    authSource:
      auth.source === 'gh-cli'
        ? `GitHub CLI (${auth.username})`
        : auth.source === 'env-token'
        ? `GITHUB_TOKEN env (${auth.username})`
        : auth.source === 'git-credential-manager'
        ? `Git Credential Manager (${auth.username})`
        : 'Local Git only (Unauthenticated remote API)',
    lastSuccessAt: nowIso,
    lastError: auth.error ?? null,
    capabilities: {
      local_git_discovery: `Exposed (${gitDirs.length} local repositories discovered)`,
      working_tree_and_diffs: 'Exposed (branches, uncommitted files, ahead/behind, diffs)',
      github_remote_metadata: auth.authenticated
        ? `Connected as @${auth.username} (PRs, issues, CI workflows, deployments)`
        : 'Unavailable until authenticated via gh CLI or GITHUB_TOKEN',
    },
    diagnostics: {
      authenticated: auth.authenticated,
      authSource: auth.source,
      username: auth.username,
      rateLimitRemaining: auth.rateLimitRemaining,
      discoveredRepositories: gitDirs.length,
    },
  });

  return {
    repositories: getRepositories(),
    auth,
  };
}

/**
 * Returns a sanitized working-tree diff for a repository or specific file.
 */
export function getRepositoryDiff(repoId: string, targetFile?: string): { diff: string; truncated: boolean } {
  const repo = getRepositoryById(repoId);
  if (!repo || !fs.existsSync(repo.localPath)) {
    return { diff: 'Repository path not found on disk.', truncated: false };
  }

  if (targetFile && isSensitiveFilePath(targetFile)) {
    return {
      diff: `[SECURITY REDACTED] Diff preview for sensitive configuration/credential file "${targetFile}" is blocked by DevScope security policy.`,
      truncated: false,
    };
  }

  const args = targetFile ? ['diff', 'HEAD', '--', targetFile] : ['diff', 'HEAD'];
  let rawDiff = runGit(repo.localPath, args, 4000);
  if (!rawDiff && targetFile) {
    // Check if untracked file
    const fullTarget = path.resolve(repo.localPath, targetFile);
    if (
      fullTarget.startsWith(path.resolve(repo.localPath)) &&
      fs.existsSync(fullTarget) &&
      !isSensitiveFilePath(fullTarget)
    ) {
      try {
        const stat = fs.statSync(fullTarget);
        if (stat.isFile() && stat.size < 32768) {
          rawDiff = `--- /dev/null\n+++ b/${targetFile}\n` + fs.readFileSync(fullTarget, 'utf8');
        }
      } catch {
        // ignore
      }
    }
  }

  const safeDiff = redactSecrets(rawDiff || 'No uncommitted diff changes against HEAD.');
  const maxLen = 24_000;
  if (safeDiff.length > maxLen) {
    return {
      diff: safeDiff.slice(0, maxLen) + '\n\n... [Diff truncated at 24 KB]',
      truncated: true,
    };
  }
  return { diff: safeDiff, truncated: false };
}
