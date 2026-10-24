import fs from 'fs';
import path from 'path';
import chokidar, { type FSWatcher } from 'chokidar';
import {
  getSetting,
  setSetting,
  getProjects,
  upsertProject,
  insertFileChange,
  upsertIntegrationConnection,
  recordError,
} from '@/lib/db';
import { eventBus, ingestActivityEvent } from '@/lib/events';
import { antigravityConnector } from '@/lib/connectors';
import { syncAllRepositories } from '@/lib/github';
import { scanDevelopmentProcesses } from '@/lib/processes';

export interface MonitoringEngineStatus {
  running: boolean;
  paused: boolean;
  watchedPaths: string[];
  watchedProjectsCount: number;
  lastFullSyncAt: string | null;
  eventsIngestedSession: number;
  subscriberCount: number;
}

class MonitoringEngine {
  private watcher: FSWatcher | null = null;
  private watchedPaths = new Set<string>();
  private paused = false;
  private initialized = false;
  private isSyncing = false;
  private lastFullSyncAt: string | null = null;
  private eventsIngestedSession = 0;
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private backgroundInterval: NodeJS.Timeout | null = null;

  public async ensureStarted(): Promise<MonitoringEngineStatus> {
    this.paused = getSetting<boolean>('monitoringPaused', false);
    if (!this.initialized) {
      this.initialized = true;
      await this.runFullSync({ forceRemote: false });
      if (!this.paused) {
        this.startFilesystemWatchers();
      }
      this.startBackgroundLoop();
    }
    return this.getStatus();
  }

  public getStatus(): MonitoringEngineStatus {
    return {
      running: Boolean(this.watcher) && !this.paused,
      paused: this.paused,
      watchedPaths: Array.from(this.watchedPaths),
      watchedProjectsCount: this.watchedPaths.size,
      lastFullSyncAt: this.lastFullSyncAt,
      eventsIngestedSession: this.eventsIngestedSession,
      subscriberCount: eventBus.getSubscriberCount(),
    };
  }

  public async pause(): Promise<MonitoringEngineStatus> {
    this.paused = true;
    setSetting('monitoringPaused', true);
    await this.stopFilesystemWatchers();
    ingestActivityEvent({
      type: 'monitoring_paused',
      category: 'system',
      title: 'Live filesystem monitoring paused by user',
      source: 'devscope-monitor',
      dataOrigin: 'measured',
      severity: 'warning',
    });
    eventBus.broadcast('monitoring_status', this.getStatus());
    return this.getStatus();
  }

  public async resume(): Promise<MonitoringEngineStatus> {
    this.paused = false;
    setSetting('monitoringPaused', false);
    this.startFilesystemWatchers();
    ingestActivityEvent({
      type: 'monitoring_resumed',
      category: 'system',
      title: 'Live filesystem monitoring resumed',
      source: 'devscope-monitor',
      dataOrigin: 'measured',
      severity: 'info',
    });
    eventBus.broadcast('monitoring_status', this.getStatus());
    return this.getStatus();
  }

  public async updateScope(paths: string[]): Promise<MonitoringEngineStatus> {
    const validPaths = paths.map((p) => path.resolve(p.trim())).filter(Boolean);
    if (validPaths.length > 0) {
      setSetting('workspaceRoots', validPaths);
    }
    await this.runFullSync({ forceRemote: false });
    if (!this.paused) {
      await this.stopFilesystemWatchers();
      this.startFilesystemWatchers();
    }
    eventBus.broadcast('monitoring_status', this.getStatus());
    return this.getStatus();
  }

  public async runFullSync(opts?: { forceRemote?: boolean }): Promise<void> {
    if (this.isSyncing) return;
    this.isSyncing = true;
    try {
      // Ensure current workspace (DevScope itself) is registered first
      const cwd = process.cwd();
      upsertProject({
        name: path.basename(cwd) || 'code-monitor',
        localPath: cwd,
        pinned: true,
        isGitRepo: fs.existsSync(path.join(cwd, '.git')),
      });

      // 1. Discover & sync local Git repositories and GitHub metadata
      await syncAllRepositories({ forceRemote: opts?.forceRemote });

      // 2. Discover & sync Antigravity sessions, transcripts, tasks, and token telemetry
      await antigravityConnector.discoverAndSync();

      // 3. Scan OS development processes and listening ports
      scanDevelopmentProcesses();

      // 4. Verify workspace existence & health for all registered projects
      for (const proj of getProjects({ includeExcluded: true })) {
        if (!fs.existsSync(proj.localPath)) {
          upsertProject({
            id: proj.id,
            name: proj.name,
            localPath: proj.localPath,
            monitoringHealth: 'missing_workspace',
          });
          recordError({
            dedupeKey: `missing_workspace_${proj.id}`,
            projectId: proj.id,
            source: 'filesystem-watcher',
            category: 'monitoring_gap',
            severity: 'warning',
            title: `Workspace directory missing: ${proj.name}`,
            message: `Registered workspace path "${proj.localPath}" no longer exists on disk. Monitoring degraded gracefully.`,
          });
        } else if (proj.monitoringHealth === 'missing_workspace') {
          upsertProject({
            id: proj.id,
            name: proj.name,
            localPath: proj.localPath,
            monitoringHealth: 'healthy',
          });
        }
      }

      this.lastFullSyncAt = new Date().toISOString();

      upsertIntegrationConnection({
        id: 'filesystem-watcher',
        name: 'Chokidar Live Filesystem Watcher',
        type: 'filesystem',
        status: this.paused ? 'degraded' : 'connected',
        authSource: 'Local OS Filesystem Events',
        lastSuccessAt: this.lastFullSyncAt,
        capabilities: {
          live_file_events: this.paused
            ? 'Paused by user'
            : `Active (${this.watchedPaths.size} workspaces watched with debouncing & exclusions)`,
          exclusions: 'Active (.git, node_modules, .next, .devscope, build, caches)',
          deduplication: 'Active (2.5s debounce + SHA-1 event deduplication)',
        },
        diagnostics: {
          watchedPaths: Array.from(this.watchedPaths),
          paused: this.paused,
          eventsIngestedSession: this.eventsIngestedSession,
        },
      });

      eventBus.broadcast('refresh', { lastFullSyncAt: this.lastFullSyncAt });
    } catch (err) {
      recordError({
        source: 'monitoring-orchestrator',
        category: 'connector_crash',
        severity: 'error',
        title: 'Monitoring sync cycle encountered an error',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      this.isSyncing = false;
    }
  }

  public startFilesystemWatchers(): void {
    if (this.paused) return;
    if (this.watcher) return;

    const projects = getProjects({ includeExcluded: false }).filter((p) => fs.existsSync(p.localPath));
    // Watch up to 8 most recently active project workspaces to keep resource overhead minimal
    const targets = projects.slice(0, 8).map((p) => p.localPath);
    this.watchedPaths = new Set(targets);

    if (targets.length === 0) return;

    const exclusions = getSetting<string[]>('monitoringExclusions', [
      '.git',
      'node_modules',
      '.next',
      '.devscope',
      'dist',
      'build',
      'out',
      'coverage',
      '__pycache__',
      '.venv',
      '.cache',
    ]);

    const shouldIgnore = (filePath: string): boolean => {
      const normalized = filePath.replace(/\\/g, '/');
      if (
        normalized.endsWith('.db') ||
        normalized.endsWith('.db-wal') ||
        normalized.endsWith('.db-shm') ||
        normalized.endsWith('.tmp') ||
        normalized.endsWith('.log')
      ) {
        return true;
      }
      const segments = normalized.split('/');
      return segments.some((seg) => exclusions.includes(seg));
    };

    try {
      this.watcher = chokidar.watch(targets, {
        ignored: shouldIgnore,
        ignoreInitial: true,
        persistent: true,
        depth: 4,
        awaitWriteFinish: {
          stabilityThreshold: 250,
          pollInterval: 100,
        },
      });

      const handleFsEvent = (changeType: 'created' | 'modified' | 'deleted', targetPath: string) => {
        if (this.paused || shouldIgnore(targetPath)) return;
        const resolved = path.resolve(targetPath);
        const timerKey = `${changeType}:${resolved}`;

        const existingTimer = this.debounceTimers.get(timerKey);
        if (existingTimer) clearTimeout(existingTimer);

        const timer = setTimeout(() => {
          this.debounceTimers.delete(timerKey);
          this.ingestFilesystemEvent(changeType, resolved);
        }, 300);

        this.debounceTimers.set(timerKey, timer);
      };

      this.watcher
        .on('add', (p) => handleFsEvent('created', p))
        .on('change', (p) => handleFsEvent('modified', p))
        .on('unlink', (p) => handleFsEvent('deleted', p))
        .on('error', (err) => {
          recordError({
            source: 'filesystem-watcher',
            category: 'permission_error',
            severity: 'warning',
            title: 'Filesystem watcher warning',
            message: err instanceof Error ? err.message : String(err),
          });
        });
    } catch (err) {
      recordError({
        source: 'filesystem-watcher',
        category: 'connector_crash',
        severity: 'error',
        title: 'Failed to initialize Chokidar watcher',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  public ingestFilesystemEvent(
    changeType: 'created' | 'modified' | 'deleted' | 'renamed',
    filePath: string
  ): boolean {
    const resolved = path.resolve(filePath);
    const sig = `fs:${changeType}:${resolved}`;
    if (!eventBus.shouldIngest(sig, 2000)) {
      return false;
    }

    const projects = getProjects({ includeExcluded: true });
    let matchedProj = projects.find(
      (p) =>
        resolved.toLowerCase() === p.localPath.toLowerCase() ||
        resolved.toLowerCase().startsWith(p.localPath.toLowerCase() + path.sep)
    );

    if (!matchedProj && fs.existsSync(path.dirname(resolved))) {
      matchedProj = projects[0];
    }

    const relPath = matchedProj ? path.relative(matchedProj.localPath, resolved) : path.basename(resolved);

    insertFileChange({
      projectId: matchedProj?.id ?? null,
      filePath: resolved,
      relativePath: relPath,
      changeType,
      source: 'fs-watcher',
    });

    const { inserted } = ingestActivityEvent({
      type: `file_${changeType}`,
      category: 'filesystem',
      title: `File ${changeType}: ${relPath}`,
      detail: resolved,
      source: 'fs-watcher',
      dataOrigin: 'measured',
      severity: changeType === 'deleted' ? 'warning' : 'info',
      projectId: matchedProj?.id ?? null,
      filePath: resolved,
    });

    if (inserted) {
      this.eventsIngestedSession++;
    }
    return inserted;
  }

  public async stopFilesystemWatchers(): Promise<void> {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    if (this.watcher) {
      try {
        await this.watcher.close();
      } catch {
        // ignore close error
      }
      this.watcher = null;
    }
  }

  private startBackgroundLoop(): void {
    if (this.backgroundInterval) return;
    const intervalSec = Math.max(10, getSetting<number>('refreshIntervalSeconds', 15));
    this.backgroundInterval = setInterval(() => {
      if (!this.paused) {
        void this.runFullSync({ forceRemote: false });
      }
    }, intervalSec * 1000);
    if (this.backgroundInterval.unref) {
      this.backgroundInterval.unref();
    }
  }
}

const globalForMonitor = globalThis as unknown as {
  __devscopeMonitoringEngine?: MonitoringEngine;
};

export const monitoringEngine =
  globalForMonitor.__devscopeMonitoringEngine ??
  (globalForMonitor.__devscopeMonitoringEngine = new MonitoringEngine());
