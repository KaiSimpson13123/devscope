import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  setDatabasePath,
  getDb,
  upsertProject,
  getProjects,
  getProjectByPath,
  insertActivityEvent,
  getActivityEvents,
  upsertUsageRecord,
  recordError,
  getErrors,
  updateErrorStatus,
  upsertTask,
  getTasks,
  upsertRepository,
  globalSearch,
} from '@/lib/db';
import {
  redactSecrets,
  redactObject,
  isSafeLocalPath,
  isSensitiveFilePath,
  isLocalhostOrigin,
  ProjectRegistrationSchema,
  ManualTaskSchema,
  ProcessTerminateSchema,
} from '@/lib/security';
import { eventBus, ingestActivityEvent } from '@/lib/events';
import { calculateEstimatedCostUsd, getUsageSummary } from '@/lib/usage';
import {
  discoverLocalGitDirectories,
  inspectLocalGitRepo,
  parseGitHubRemote,
  getRepositoryDiff,
} from '@/lib/github';
import {
  scanDevelopmentProcesses,
  getSystemPerformanceOverview,
  terminateProcessSafely,
} from '@/lib/processes';
import { monitoringEngine } from '@/lib/monitoring';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devscope-test-'));
const testDbFile = path.join(tempRoot, 'test-devscope.db');

describe('DevScope Core Test Suite', () => {
  beforeEach(() => {
    if (fs.existsSync(testDbFile)) {
      try {
        fs.unlinkSync(testDbFile);
      } catch {
        // ignore
      }
    }
    setDatabasePath(testDbFile);
  });

  afterAll(async () => {
    await monitoringEngine.stopFilesystemWatchers();
    setDatabasePath(null);
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // ignore cleanup error on Windows
    }
  });

  it('1. initializes SQLite database, applies migrations, and persists across reopen', () => {
    const db = getDb();
    const migrations = db.prepare('SELECT * FROM schema_migrations').all() as Array<{
      version: number;
      name: string;
    }>;
    expect(migrations.length).toBeGreaterThanOrEqual(1);
    expect(migrations[0].name).toBe('001_initial_devscope_schema');

    upsertProject({
      name: 'persistence-check',
      localPath: path.join(tempRoot, 'persistence-check'),
    });

    // Reopen the same SQLite database file to verify persistence across restarts
    setDatabasePath(testDbFile);
    const projectsAfterRestart = getProjects({ includeExcluded: true });
    expect(projectsAfterRestart.some((p) => p.name === 'persistence-check')).toBe(true);
  });

  it('2. discovers and matches registered projects by path', () => {
    const wsPath = path.join(tempRoot, 'workspace-alpha');
    fs.mkdirSync(wsPath, { recursive: true });

    const created = upsertProject({
      name: 'workspace-alpha',
      localPath: wsPath,
      githubRepo: 'KaiSimpson13123/workspace-alpha',
      isGitRepo: true,
    });

    expect(created.name).toBe('workspace-alpha');
    const nestedFile = path.join(wsPath, 'src', 'index.ts');
    const matched = getProjectByPath(nestedFile);
    expect(matched?.id).toBe(created.id);
  });

  it('3. detects local Git repositories, inspects commits/dirty files, and generates sanitized diffs', () => {
    const repoDir = path.join(tempRoot, 'temp-git-repo');
    fs.mkdirSync(repoDir, { recursive: true });

    execFileSync('git', ['init'], { cwd: repoDir });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoDir });
    execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: repoDir });
    execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/KaiSimpson13123/devscope-test.git'], {
      cwd: repoDir,
    });

    const appFile = path.join(repoDir, 'index.ts');
    fs.writeFileSync(appFile, 'export const version = 1;\n', 'utf8');
    execFileSync('git', ['add', '.'], { cwd: repoDir });
    execFileSync('git', ['commit', '-m', 'Initial commit'], { cwd: repoDir });

    // Modify file to make working tree dirty
    fs.writeFileSync(appFile, 'export const version = 2;\n', 'utf8');

    const discovered = discoverLocalGitDirectories([tempRoot]);
    expect(discovered).toContain(path.resolve(repoDir));

    const info = inspectLocalGitRepo(repoDir);
    expect(info.owner).toBe('KaiSimpson13123');
    expect(info.name).toBe('devscope-test');
    expect(info.workingTreeStatus).toBe('dirty');
    expect(info.uncommittedCount).toBe(1);
    expect(info.recentCommits.length).toBe(1);
    expect(info.recentCommits[0].message).toBe('Initial commit');

    const repoRecord = upsertRepository({
      projectId: null,
      name: info.name,
      owner: info.owner,
      fullName: info.fullName,
      localPath: repoDir,
      remoteUrl: info.remoteUrl,
      htmlUrl: info.htmlUrl,
      defaultBranch: info.defaultBranch,
      currentBranch: info.currentBranch,
      workingTreeStatus: info.workingTreeStatus,
      aheadCount: 0,
      behindCount: 0,
      uncommittedCount: info.uncommittedCount,
      openIssuesCount: 0,
      openPrsCount: 0,
      workflowStatus: 'none',
      deploymentStatus: 'none',
      recentCommits: info.recentCommits,
      contributors: info.contributors,
      openIssues: [],
      openPrs: [],
      workflows: [],
      changedFiles: info.changedFiles,
    });

    const diffRes = getRepositoryDiff(repoRecord.id, 'index.ts');
    expect(diffRes.diff).toContain('+export const version = 2;');

    // Verify sensitive file diff is blocked
    const envDiff = getRepositoryDiff(repoRecord.id, '.env.local');
    expect(envDiff.diff).toContain('[SECURITY REDACTED]');
  });

  it('4. ingests filesystem events and deduplicates identical events', () => {
    const wsDir = path.join(tempRoot, 'watched-proj');
    fs.mkdirSync(wsDir, { recursive: true });
    const proj = upsertProject({ name: 'watched-proj', localPath: wsDir });

    const targetFile = path.join(wsDir, 'server.ts');
    fs.writeFileSync(targetFile, 'console.log("ok");');

    const first = monitoringEngine.ingestFilesystemEvent('created', targetFile);
    const second = monitoringEngine.ingestFilesystemEvent('created', targetFile);

    expect(first).toBe(true);
    expect(second).toBe(false); // Deduplicated within debounce window

    const events = getActivityEvents({ projectId: proj.id });
    expect(events.length).toBe(1);
    expect(events[0].type).toBe('file_created');
  });

  it('5. prevents duplicate activity events in SQLite and filters timeline accurately', () => {
    const r1 = insertActivityEvent({
      dedupeKey: 'fixed_dedupe_key_1',
      type: 'command_executed',
      category: 'command',
      title: 'Run unit tests',
      detail: 'npm test',
      source: 'test-runner',
      severity: 'info',
    });
    const r2 = insertActivityEvent({
      dedupeKey: 'fixed_dedupe_key_1',
      type: 'command_executed',
      category: 'command',
      title: 'Run unit tests',
      detail: 'npm test',
      source: 'test-runner',
      severity: 'info',
    });

    expect(r1.inserted).toBe(true);
    expect(r2.inserted).toBe(false);

    const commandEvents = getActivityEvents({ category: 'command', search: 'unit tests' });
    expect(commandEvents.length).toBe(1);
  });

  it('6. validates API payloads, local paths, and localhost origins', () => {
    expect(ProjectRegistrationSchema.safeParse({ name: '', localPath: '' }).success).toBe(false);
    expect(
      ProjectRegistrationSchema.safeParse({ name: 'Valid', localPath: 'C:\\Users\\KaiSi\\proj' }).success
    ).toBe(true);

    expect(ManualTaskSchema.safeParse({ title: 'Test task', status: 'running' }).success).toBe(true);
    expect(ProcessTerminateSchema.safeParse({ pid: 123, confirmPid: 123 }).success).toBe(true);

    expect(isSafeLocalPath('C:\\Users\\KaiSi\\.ssh\\id_rsa')).toBe(false);
    expect(isSafeLocalPath('C:\\Users\\KaiSi\\code-monitor')).toBe(true);
    expect(isSensitiveFilePath('.env.local')).toBe(true);
    expect(isSensitiveFilePath('.env.example')).toBe(false);

    expect(isLocalhostOrigin('127.0.0.1:3100')).toBe(true);
    expect(isLocalhostOrigin('localhost:3100')).toBe(true);
    expect(isLocalhostOrigin('192.168.1.50:3100')).toBe(false);
  });

  it('7. calculates estimated AI usage costs honestly without fabricating unexposed model prices', () => {
    // Known model from pricing table v2026.10
    const known = calculateEstimatedCostUsd({
      model: 'Gemini 4 Argon (Medium)',
      inputTokens: 1_000_000,
      outputTokens: 200_000,
      cachedTokens: 0,
    });
    expect(known.estimatedCostUsd).toBeCloseTo(2.25, 2);

    // Unexposed model must return null estimatedCostUsd
    const unexposed = calculateEstimatedCostUsd({
      model: 'Not exposed',
      inputTokens: 50_000,
      outputTokens: 10_000,
    });
    expect(unexposed.estimatedCostUsd).toBeNull();

    upsertUsageRecord({
      dedupeKey: 'usage_1',
      provider: known.provider,
      model: 'Gemini 4 Argon (Medium)',
      source: 'antigravity-transcript',
      inputTokens: 10000,
      outputTokens: 2000,
      cachedTokens: 5000,
      estimatedCostUsd: 0.024,
      reportedCostUsd: null,
      timestamp: new Date().toISOString(),
    });

    const summary = getUsageSummary({ range: 'all' });
    expect(summary.totals.totalTokens).toBe(17000);
    expect(summary.totals.estimatedCostUsd).toBeCloseTo(0.024, 4);
    expect(summary.totals.reportedCostUsd).toBeNull();
  });

  it('8. redacts secrets from command lines, URLs, and nested objects', () => {
    const raw =
      'curl -H "Authorization: Bearer ghp_1234567890abcdefghijklmnopqrstuv" https://user:mySecretPass@api.example.com --api-key=sk-proj-1234567890abcdefghijklmnop';
    const sanitized = redactSecrets(raw);

    expect(sanitized).not.toContain('ghp_1234567890abcdefghijklmnopqrstuv');
    expect(sanitized).not.toContain('mySecretPass');
    expect(sanitized).not.toContain('sk-proj-1234567890abcdefghijklmnop');
    expect(sanitized).toContain('[REDACTED');

    const obj = redactObject({
      command: 'node server.js',
      apiKey: 'secret-value',
      nested: { token: 'gho_abcdefghijklmnopqrstuvwx123456' },
    });
    expect(obj.apiKey).toBe('[REDACTED]');
    expect(obj.nested.token).toBe('[REDACTED]');
  });

  it('9. monitors OS development processes and enforces explicit termination safety', () => {
    const procs = scanDevelopmentProcesses();
    expect(procs.length).toBeGreaterThanOrEqual(1);
    expect(procs.some((p) => p.pid === process.pid)).toBe(true);

    const perf = getSystemPerformanceOverview();
    expect(perf.cpuCores).toBeGreaterThan(0);
    expect(perf.devscopeRssBytes).toBeGreaterThan(0);

    // Reject termination if confirmation PID does not match
    const mismatch = terminateProcessSafely({ pid: 99999, confirmPid: 11111 });
    expect(mismatch.ok).toBe(false);

    // Reject terminating the active DevScope process itself
    const selfKill = terminateProcessSafely({ pid: process.pid, confirmPid: process.pid });
    expect(selfKill.ok).toBe(false);
  });

  it('10. delivers real-time events over the SSE eventBus and tracks errors/tasks/search', async () => {
    const received: unknown[] = [];
    const unsubscribe = eventBus.subscribe((packet) => {
      if (packet.event === 'activity') {
        received.push(packet.data);
      }
    });

    ingestActivityEvent({
      dedupeKey: 'realtime_evt_1',
      type: 'test_completed',
      category: 'build',
      title: 'Automated test suite passed',
      source: 'vitest',
      severity: 'info',
    });

    unsubscribe();
    expect(received.length).toBe(1);

    // Error centre lifecycle
    const err = recordError({
      dedupeKey: 'err_build_1',
      source: 'compiler',
      category: 'build_failed',
      severity: 'error',
      title: 'TypeScript build failed',
      message: 'TS2322: Type string is not assignable to number',
    });
    expect(err.status).toBe('open');

    const ack = updateErrorStatus(err.id, 'acknowledge');
    expect(ack?.status).toBe('acknowledged');

    const resolved = updateErrorStatus(err.id, 'resolve', 'Fixed type annotation');
    expect(resolved?.status).toBe('resolved');
    expect(getErrors({ status: 'resolved' }).length).toBe(1);

    // Task & Global Search check
    upsertTask({
      id: 'task_search_1',
      title: 'Implement Chokidar Debounce',
      source: 'manual',
      status: 'completed',
      startTime: new Date().toISOString(),
    });
    expect(getTasks().length).toBe(1);

    const searchRes = globalSearch('Chokidar');
    expect(searchRes.tasks.length).toBe(1);

    // Pause / Resume lifecycle
    const pausedStatus = await monitoringEngine.pause();
    expect(pausedStatus.paused).toBe(true);
    const resumedStatus = await monitoringEngine.resume();
    expect(resumedStatus.paused).toBe(false);

    // Remote URL parser check
    const parsedRemote = parseGitHubRemote('https://github.com/KaiSimpson13123/devscope.git');
    expect(parsedRemote.owner).toBe('KaiSimpson13123');
    expect(parsedRemote.name).toBe('devscope');
  });
});
