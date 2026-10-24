import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DatabaseSync } from 'node:sqlite';
import { redactObject, redactSecrets } from '@/lib/security';
import type { DataOrigin } from './schema';

export interface Migration {
  version: number;
  name: string;
  up: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: '001_initial_devscope_schema',
    up: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        local_path TEXT NOT NULL UNIQUE,
        github_repo TEXT,
        current_branch TEXT,
        changed_file_count INTEGER NOT NULL DEFAULT 0,
        uncommitted_summary TEXT,
        last_build_status TEXT NOT NULL DEFAULT 'unknown',
        last_activity_at TEXT,
        monitoring_health TEXT NOT NULL DEFAULT 'healthy',
        excluded INTEGER NOT NULL DEFAULT 0,
        pinned INTEGER NOT NULL DEFAULT 0,
        is_git_repo INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_local_path ON projects(local_path);
      CREATE INDEX IF NOT EXISTS idx_projects_last_activity ON projects(last_activity_at);

      CREATE TABLE IF NOT EXISTS repositories (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        name TEXT NOT NULL,
        owner TEXT NOT NULL,
        full_name TEXT NOT NULL,
        local_path TEXT NOT NULL UNIQUE,
        remote_url TEXT NOT NULL,
        html_url TEXT,
        default_branch TEXT NOT NULL DEFAULT 'main',
        current_branch TEXT NOT NULL DEFAULT 'main',
        working_tree_status TEXT NOT NULL DEFAULT 'clean',
        ahead_count INTEGER NOT NULL DEFAULT 0,
        behind_count INTEGER NOT NULL DEFAULT 0,
        uncommitted_count INTEGER NOT NULL DEFAULT 0,
        open_issues_count INTEGER,
        open_prs_count INTEGER,
        workflow_status TEXT NOT NULL DEFAULT 'unknown',
        deployment_status TEXT NOT NULL DEFAULT 'none',
        recent_commits_json TEXT NOT NULL DEFAULT '[]',
        contributors_json TEXT NOT NULL DEFAULT '[]',
        open_issues_json TEXT NOT NULL DEFAULT '[]',
        open_prs_json TEXT NOT NULL DEFAULT '[]',
        workflows_json TEXT NOT NULL DEFAULT '[]',
        changed_files_json TEXT NOT NULL DEFAULT '[]',
        last_synced_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_repositories_local_path ON repositories(local_path);
      CREATE INDEX IF NOT EXISTS idx_repositories_full_name ON repositories(full_name);

      CREATE TABLE IF NOT EXISTS agent_sessions (
        id TEXT PRIMARY KEY,
        surface TEXT NOT NULL,
        project_id TEXT,
        workspace_path TEXT,
        title TEXT NOT NULL,
        objective TEXT,
        status TEXT NOT NULL,
        model TEXT NOT NULL DEFAULT 'Not exposed',
        step_count INTEGER NOT NULL DEFAULT 0,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cached_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        estimated_cost_usd REAL,
        reported_cost_usd REAL,
        started_at TEXT NOT NULL,
        last_active_at TEXT NOT NULL,
        duration_seconds INTEGER NOT NULL DEFAULT 0,
        is_locked_presence INTEGER NOT NULL DEFAULT 0,
        data_origin TEXT NOT NULL DEFAULT 'measured',
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_agent_sessions_status ON agent_sessions(status);
      CREATE INDEX IF NOT EXISTS idx_agent_sessions_last_active ON agent_sessions(last_active_at);
      CREATE INDEX IF NOT EXISTS idx_agent_sessions_project ON agent_sessions(project_id);

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        project_id TEXT,
        session_id TEXT,
        source TEXT NOT NULL,
        status TEXT NOT NULL,
        progress_text TEXT NOT NULL DEFAULT 'Progress not exposed',
        start_time TEXT NOT NULL,
        end_time TEXT,
        duration_seconds INTEGER,
        relevant_files_json TEXT NOT NULL DEFAULT '[]',
        commands_json TEXT NOT NULL DEFAULT '[]',
        related_commits_json TEXT NOT NULL DEFAULT '[]',
        related_prs_json TEXT NOT NULL DEFAULT '[]',
        errors_json TEXT NOT NULL DEFAULT '[]',
        data_origin TEXT NOT NULL DEFAULT 'measured',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

      CREATE TABLE IF NOT EXISTS activity_events (
        id TEXT PRIMARY KEY,
        dedupe_key TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL,
        data_origin TEXT NOT NULL DEFAULT 'measured',
        severity TEXT NOT NULL DEFAULT 'info',
        project_id TEXT,
        session_id TEXT,
        task_id TEXT,
        file_path TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        timestamp TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_events_dedupe ON activity_events(dedupe_key);
      CREATE INDEX IF NOT EXISTS idx_activity_events_timestamp ON activity_events(timestamp);
      CREATE INDEX IF NOT EXISTS idx_activity_events_project ON activity_events(project_id);
      CREATE INDEX IF NOT EXISTS idx_activity_events_session ON activity_events(session_id);
      CREATE INDEX IF NOT EXISTS idx_activity_events_task ON activity_events(task_id);
      CREATE INDEX IF NOT EXISTS idx_activity_events_category ON activity_events(category);

      CREATE TABLE IF NOT EXISTS file_changes (
        id TEXT PRIMARY KEY,
        dedupe_key TEXT NOT NULL UNIQUE,
        project_id TEXT,
        session_id TEXT,
        file_path TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        change_type TEXT NOT NULL,
        source TEXT NOT NULL,
        timestamp TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_file_changes_dedupe ON file_changes(dedupe_key);
      CREATE INDEX IF NOT EXISTS idx_file_changes_project ON file_changes(project_id);
      CREATE INDEX IF NOT EXISTS idx_file_changes_timestamp ON file_changes(timestamp);

      CREATE TABLE IF NOT EXISTS process_observations (
        id TEXT PRIMARY KEY,
        pid INTEGER NOT NULL,
        name TEXT NOT NULL,
        executable TEXT NOT NULL DEFAULT '',
        command_line TEXT NOT NULL DEFAULT '',
        working_directory TEXT NOT NULL DEFAULT '',
        project_id TEXT,
        category TEXT NOT NULL DEFAULT 'other',
        cpu_percent REAL NOT NULL DEFAULT 0,
        memory_bytes INTEGER NOT NULL DEFAULT 0,
        parent_pid INTEGER,
        listening_ports_json TEXT NOT NULL DEFAULT '[]',
        start_time TEXT,
        uptime_seconds INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'running',
        observed_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_process_obs_pid ON process_observations(pid);
      CREATE INDEX IF NOT EXISTS idx_process_obs_project ON process_observations(project_id);

      CREATE TABLE IF NOT EXISTS usage_records (
        id TEXT PRIMARY KEY,
        dedupe_key TEXT NOT NULL UNIQUE,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        source TEXT NOT NULL,
        session_id TEXT,
        project_id TEXT,
        task_id TEXT,
        request_count INTEGER NOT NULL DEFAULT 1,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cached_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        estimated_cost_usd REAL,
        reported_cost_usd REAL,
        pricing_version TEXT NOT NULL DEFAULT 'v2026.10',
        data_origin TEXT NOT NULL DEFAULT 'measured',
        timestamp TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_records_dedupe ON usage_records(dedupe_key);
      CREATE INDEX IF NOT EXISTS idx_usage_records_timestamp ON usage_records(timestamp);
      CREATE INDEX IF NOT EXISTS idx_usage_records_session ON usage_records(session_id);
      CREATE INDEX IF NOT EXISTS idx_usage_records_project ON usage_records(project_id);
      CREATE INDEX IF NOT EXISTS idx_usage_records_model ON usage_records(model);

      CREATE TABLE IF NOT EXISTS errors (
        id TEXT PRIMARY KEY,
        dedupe_key TEXT NOT NULL UNIQUE,
        project_id TEXT,
        session_id TEXT,
        task_id TEXT,
        source TEXT NOT NULL,
        category TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'error',
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        diagnostics_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'open',
        acknowledged_at TEXT,
        resolved_at TEXT,
        resolution_note TEXT,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        occurrence_count INTEGER NOT NULL DEFAULT 1
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_errors_dedupe ON errors(dedupe_key);
      CREATE INDEX IF NOT EXISTS idx_errors_status ON errors(status);
      CREATE INDEX IF NOT EXISTS idx_errors_last_seen ON errors(last_seen_at);

      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        dedupe_key TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'info',
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        project_id TEXT,
        link TEXT,
        read INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedupe ON notifications(dedupe_key);
      CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);

      CREATE TABLE IF NOT EXISTS integration_connections (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        auth_source TEXT NOT NULL DEFAULT 'local',
        last_success_at TEXT,
        last_error_at TEXT,
        last_error TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0,
        capabilities_json TEXT NOT NULL DEFAULT '{}',
        diagnostics_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS application_settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
];

let dbInstance: DatabaseSync | null = null;
let customDbPath: string | null = null;

export function getDatabasePath(): string {
  if (customDbPath) return customDbPath;
  const envPath = process.env.DEVSCOPE_DB_PATH;
  if (envPath) {
    return envPath === ':memory:' ? ':memory:' : path.resolve(envPath);
  }
  return path.resolve(process.cwd(), '.devscope', 'devscope.db');
}

export function setDatabasePath(newPath: string | null): void {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {
      // ignore close errors
    }
    dbInstance = null;
  }
  customDbPath = newPath;
}

export function getDb(): DatabaseSync {
  if (dbInstance) return dbInstance;

  const dbPath = getDatabasePath();
  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new DatabaseSync(dbPath);
  if (dbPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
  }
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  runMigrations(db);
  ensureDefaultSettings(db);
  dbInstance = db;
  return db;
}

export function runMigrations(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedRows = db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>;
  const appliedVersions = new Set(appliedRows.map((r) => r.version));

  for (const migration of MIGRATIONS) {
    if (!appliedVersions.has(migration.version)) {
      db.exec('BEGIN');
      try {
        db.exec(migration.up);
        db.prepare(
          'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)'
        ).run(migration.version, migration.name, new Date().toISOString());
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    }
  }
}

export interface DefaultSettings {
  workspaceRoots: string[];
  monitoringExclusions: string[];
  refreshIntervalSeconds: number;
  retentionDays: number;
  theme: 'dark' | 'light' | 'system';
  monitoringPaused: boolean;
  notificationsEnabled: boolean;
  notificationCooldownSeconds: number;
  costThresholdUsd: number;
  pricingVersion: string;
}

export function getDefaultSettings(): DefaultSettings {
  const userHome = process.env.USERPROFILE || process.env.HOME || process.cwd();
  const currentCwd = process.cwd();
  const roots = Array.from(new Set([currentCwd, userHome]));
  return {
    workspaceRoots: roots,
    monitoringExclusions: [
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
      'venv',
      '.cache',
      '.turbo',
    ],
    refreshIntervalSeconds: 15,
    retentionDays: 30,
    theme: 'dark',
    monitoringPaused: false,
    notificationsEnabled: true,
    notificationCooldownSeconds: 120,
    costThresholdUsd: 25.0,
    pricingVersion: 'v2026.10',
  };
}

function ensureDefaultSettings(db: DatabaseSync): void {
  const defaults = getDefaultSettings();
  const now = new Date().toISOString();
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO application_settings (key, value_json, updated_at) VALUES (?, ?, ?)'
  );
  for (const [key, value] of Object.entries(defaults)) {
    stmt.run(key, JSON.stringify(value), now);
  }
}

export function getSetting<T>(key: keyof DefaultSettings, fallback?: T): T {
  const db = getDb();
  const row = db
    .prepare('SELECT value_json FROM application_settings WHERE key = ?')
    .get(key) as { value_json: string } | undefined;
  if (!row) {
    const defaults = getDefaultSettings();
    return (fallback !== undefined ? fallback : defaults[key]) as T;
  }
  try {
    return JSON.parse(row.value_json) as T;
  } catch {
    const defaults = getDefaultSettings();
    return (fallback !== undefined ? fallback : defaults[key]) as T;
  }
}

export function setSetting<T>(key: string, value: T): void {
  const db = getDb();
  const now = new Date().toISOString();
  const safeVal = redactObject(value);
  db.prepare(
    `INSERT INTO application_settings (key, value_json, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
  ).run(key, JSON.stringify(safeVal), now);
}

export function getAllSettings(): Record<string, unknown> {
  const db = getDb();
  const rows = db.prepare('SELECT key, value_json FROM application_settings').all() as Array<{
    key: string;
    value_json: string;
  }>;
  const out: Record<string, unknown> = { ...getDefaultSettings() };
  for (const r of rows) {
    try {
      out[r.key] = JSON.parse(r.value_json);
    } catch {
      out[r.key] = r.value_json;
    }
  }
  return out;
}

export function stableId(prefix: string, uniqueInput: string): string {
  const hash = crypto.createHash('sha1').update(uniqueInput).digest('hex').slice(0, 16);
  return `${prefix}_${hash}`;
}

export function normalizeLocalPath(inputPath: string): string {
  const resolved = path.resolve(inputPath);
  if (process.platform === 'win32' && /^[a-z]:\\/.test(resolved)) {
    return resolved[0].toUpperCase() + resolved.slice(1);
  }
  return resolved;
}

// ----------------- Projects -----------------

export interface ProjectRecord {
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
  createdAt: string;
  updatedAt: string;
}

export function upsertProject(input: {
  id?: string;
  name: string;
  localPath: string;
  githubRepo?: string | null;
  currentBranch?: string | null;
  changedFileCount?: number;
  uncommittedSummary?: string | null;
  lastBuildStatus?: string;
  lastActivityAt?: string | null;
  monitoringHealth?: string;
  excluded?: boolean;
  pinned?: boolean;
  isGitRepo?: boolean;
}): ProjectRecord {
  const db = getDb();
  const normalizedPath = normalizeLocalPath(input.localPath);
  const id = input.id || stableId('proj', normalizedPath.toLowerCase());
  const now = new Date().toISOString();

  const existing = db
    .prepare('SELECT * FROM projects WHERE LOWER(local_path) = LOWER(?) OR id = ?')
    .get(normalizedPath, id) as Record<string, unknown> | undefined;

  if (existing) {
    const updatedName = input.name || (existing.name as string);
    const githubRepo = input.githubRepo !== undefined ? input.githubRepo : (existing.github_repo as string | null);
    const currentBranch = input.currentBranch !== undefined ? input.currentBranch : (existing.current_branch as string | null);
    const changedFileCount =
      input.changedFileCount !== undefined ? input.changedFileCount : Number(existing.changed_file_count ?? 0);
    const uncommittedSummary =
      input.uncommittedSummary !== undefined ? input.uncommittedSummary : (existing.uncommitted_summary as string | null);
    const lastBuildStatus =
      input.lastBuildStatus !== undefined ? input.lastBuildStatus : (existing.last_build_status as string);
    const lastActivityAt =
      input.lastActivityAt !== undefined ? input.lastActivityAt : (existing.last_activity_at as string | null);
    const monitoringHealth =
      input.monitoringHealth !== undefined ? input.monitoringHealth : (existing.monitoring_health as string);
    const excluded = input.excluded !== undefined ? (input.excluded ? 1 : 0) : Number(existing.excluded ?? 0);
    const pinned = input.pinned !== undefined ? (input.pinned ? 1 : 0) : Number(existing.pinned ?? 0);
    const isGitRepo = input.isGitRepo !== undefined ? (input.isGitRepo ? 1 : 0) : Number(existing.is_git_repo ?? 0);

    db.prepare(
      `UPDATE projects SET
        name = ?, github_repo = ?, current_branch = ?, changed_file_count = ?,
        uncommitted_summary = ?, last_build_status = ?, last_activity_at = ?,
        monitoring_health = ?, excluded = ?, pinned = ?, is_git_repo = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      updatedName,
      githubRepo,
      currentBranch,
      changedFileCount,
      uncommittedSummary,
      lastBuildStatus,
      lastActivityAt,
      monitoringHealth,
      excluded,
      pinned,
      isGitRepo,
      now,
      existing.id as string
    );
    return getProjectById(existing.id as string)!;
  } else {
    db.prepare(
      `INSERT INTO projects (
        id, name, local_path, github_repo, current_branch, changed_file_count,
        uncommitted_summary, last_build_status, last_activity_at, monitoring_health,
        excluded, pinned, is_git_repo, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      input.name,
      normalizedPath,
      input.githubRepo ?? null,
      input.currentBranch ?? null,
      input.changedFileCount ?? 0,
      input.uncommittedSummary ?? null,
      input.lastBuildStatus ?? 'unknown',
      input.lastActivityAt ?? now,
      input.monitoringHealth ?? 'healthy',
      input.excluded ? 1 : 0,
      input.pinned ? 1 : 0,
      input.isGitRepo ? 1 : 0,
      now,
      now
    );
    return getProjectById(id)!;
  }
}

function mapProjectRow(row: Record<string, unknown>): ProjectRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    localPath: String(row.local_path),
    githubRepo: row.github_repo ? String(row.github_repo) : null,
    currentBranch: row.current_branch ? String(row.current_branch) : null,
    changedFileCount: Number(row.changed_file_count ?? 0),
    uncommittedSummary: row.uncommitted_summary ? String(row.uncommitted_summary) : null,
    lastBuildStatus: String(row.last_build_status ?? 'unknown'),
    lastActivityAt: row.last_activity_at ? String(row.last_activity_at) : null,
    monitoringHealth: String(row.monitoring_health ?? 'healthy'),
    excluded: Boolean(row.excluded),
    pinned: Boolean(row.pinned),
    isGitRepo: Boolean(row.is_git_repo),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function getProjectById(id: string): ProjectRecord | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? mapProjectRow(row) : null;
}

export function getProjectByPath(targetPath: string): ProjectRecord | null {
  const db = getDb();
  const resolved = path.resolve(targetPath).toLowerCase();
  const all = getProjects({ includeExcluded: true });
  // Match exact or longest parent workspace
  let bestMatch: ProjectRecord | null = null;
  for (const proj of all) {
    const pLower = proj.localPath.toLowerCase();
    if (resolved === pLower || resolved.startsWith(pLower + path.sep.toLowerCase())) {
      if (!bestMatch || pLower.length > bestMatch.localPath.length) {
        bestMatch = proj;
      }
    }
  }
  return bestMatch;
}

export function getProjects(opts?: { includeExcluded?: boolean }): ProjectRecord[] {
  const db = getDb();
  const sql = opts?.includeExcluded
    ? 'SELECT * FROM projects ORDER BY pinned DESC, last_activity_at DESC, name ASC'
    : 'SELECT * FROM projects WHERE excluded = 0 ORDER BY pinned DESC, last_activity_at DESC, name ASC';
  const rows = db.prepare(sql).all() as Array<Record<string, unknown>>;
  return rows.map(mapProjectRow);
}

// ----------------- Activity Events & Deduplication -----------------

export interface ActivityEventRecord {
  id: string;
  dedupeKey: string;
  type: string;
  category: 'agent' | 'filesystem' | 'git' | 'command' | 'build' | 'task' | 'process' | 'system';
  title: string;
  detail: string;
  source: string;
  dataOrigin: DataOrigin;
  severity: 'info' | 'warning' | 'error' | 'success';
  projectId: string | null;
  sessionId: string | null;
  taskId: string | null;
  filePath: string | null;
  metadata: Record<string, unknown>;
  timestamp: string;
}

export function insertActivityEvent(input: {
  dedupeKey?: string;
  type: string;
  category: ActivityEventRecord['category'];
  title: string;
  detail?: string;
  source: string;
  dataOrigin?: DataOrigin;
  severity?: ActivityEventRecord['severity'];
  projectId?: string | null;
  sessionId?: string | null;
  taskId?: string | null;
  filePath?: string | null;
  metadata?: Record<string, unknown>;
  timestamp?: string;
}): { inserted: boolean; event: ActivityEventRecord } {
  const db = getDb();
  const ts = input.timestamp || new Date().toISOString();
  const safeTitle = redactSecrets(input.title);
  const safeDetail = redactSecrets(input.detail ?? '');
  const safeMeta = redactObject(input.metadata ?? {});

  // Time-bucketed deduplication key if none explicitly provided (prevents duplicate watcher + polling events)
  const timeBucket = ts.slice(0, 16); // minute bucket
  const rawDedupe =
    input.dedupeKey ||
    `${input.source}:${input.type}:${input.projectId ?? ''}:${input.filePath ?? ''}:${safeTitle}:${timeBucket}`;
  const dedupeKey = crypto.createHash('sha1').update(rawDedupe).digest('hex');
  const id = `evt_${dedupeKey.slice(0, 18)}`;

  const existing = db
    .prepare('SELECT * FROM activity_events WHERE dedupe_key = ?')
    .get(dedupeKey) as Record<string, unknown> | undefined;

  if (existing) {
    return { inserted: false, event: mapActivityEventRow(existing) };
  }

  db.prepare(
    `INSERT INTO activity_events (
      id, dedupe_key, type, category, title, detail, source, data_origin,
      severity, project_id, session_id, task_id, file_path, metadata_json, timestamp
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    dedupeKey,
    input.type,
    input.category,
    safeTitle,
    safeDetail,
    input.source,
    input.dataOrigin ?? 'measured',
    input.severity ?? 'info',
    input.projectId ?? null,
    input.sessionId ?? null,
    input.taskId ?? null,
    input.filePath ?? null,
    JSON.stringify(safeMeta),
    ts
  );

  if (input.projectId) {
    db.prepare(
      'UPDATE projects SET last_activity_at = MAX(COALESCE(last_activity_at, ?), ?), updated_at = ? WHERE id = ?'
    ).run(ts, ts, new Date().toISOString(), input.projectId);
  }

  const row = db.prepare('SELECT * FROM activity_events WHERE id = ?').get(id) as Record<string, unknown>;
  return { inserted: true, event: mapActivityEventRow(row) };
}

function mapActivityEventRow(row: Record<string, unknown>): ActivityEventRecord {
  let metadata: Record<string, unknown> = {};
  try {
    metadata = JSON.parse(String(row.metadata_json || '{}'));
  } catch {
    metadata = {};
  }
  return {
    id: String(row.id),
    dedupeKey: String(row.dedupe_key),
    type: String(row.type),
    category: row.category as ActivityEventRecord['category'],
    title: String(row.title),
    detail: String(row.detail ?? ''),
    source: String(row.source),
    dataOrigin: (row.data_origin as DataOrigin) || 'measured',
    severity: (row.severity as ActivityEventRecord['severity']) || 'info',
    projectId: row.project_id ? String(row.project_id) : null,
    sessionId: row.session_id ? String(row.session_id) : null,
    taskId: row.task_id ? String(row.task_id) : null,
    filePath: row.file_path ? String(row.file_path) : null,
    metadata,
    timestamp: String(row.timestamp),
  };
}

export function getActivityEvents(filters?: {
  projectId?: string;
  sessionId?: string;
  taskId?: string;
  category?: string;
  severity?: string;
  search?: string;
  limit?: number;
}): ActivityEventRecord[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: Array<string | number> = [];

  if (filters?.projectId) {
    conditions.push('project_id = ?');
    params.push(filters.projectId);
  }
  if (filters?.sessionId) {
    conditions.push('session_id = ?');
    params.push(filters.sessionId);
  }
  if (filters?.taskId) {
    conditions.push('task_id = ?');
    params.push(filters.taskId);
  }
  if (filters?.category && filters.category !== 'all') {
    conditions.push('category = ?');
    params.push(filters.category);
  }
  if (filters?.severity && filters.severity !== 'all') {
    conditions.push('severity = ?');
    params.push(filters.severity);
  }
  if (filters?.search) {
    conditions.push('(title LIKE ? OR detail LIKE ? OR file_path LIKE ? OR source LIKE ?)');
    const q = `%${filters.search}%`;
    params.push(q, q, q, q);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(Math.max(filters?.limit ?? 150, 1), 1000);
  params.push(limit);

  const rows = db
    .prepare(`SELECT * FROM activity_events ${whereClause} ORDER BY timestamp DESC LIMIT ?`)
    .all(...params) as Array<Record<string, unknown>>;

  return rows.map(mapActivityEventRow);
}

// ----------------- File Changes -----------------

export interface FileChangeRecord {
  id: string;
  dedupeKey: string;
  projectId: string | null;
  sessionId: string | null;
  filePath: string;
  relativePath: string;
  changeType: 'created' | 'modified' | 'deleted' | 'renamed' | 'inspected';
  source: string;
  timestamp: string;
}

export function insertFileChange(input: {
  dedupeKey?: string;
  projectId?: string | null;
  sessionId?: string | null;
  filePath: string;
  relativePath?: string;
  changeType: FileChangeRecord['changeType'];
  source: string;
  timestamp?: string;
}): boolean {
  const db = getDb();
  const ts = input.timestamp || new Date().toISOString();
  const bucket = ts.slice(0, 16);
  const rawDedupe = input.dedupeKey || `${input.source}:${input.changeType}:${input.filePath}:${bucket}`;
  const dedupeKey = crypto.createHash('sha1').update(rawDedupe).digest('hex');
  const id = `fch_${dedupeKey.slice(0, 18)}`;

  const res = db
    .prepare(
      `INSERT OR IGNORE INTO file_changes (
        id, dedupe_key, project_id, session_id, file_path, relative_path, change_type, source, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      dedupeKey,
      input.projectId ?? null,
      input.sessionId ?? null,
      input.filePath,
      input.relativePath || path.basename(input.filePath),
      input.changeType,
      input.source,
      ts
    );
  return Number(res.changes) > 0;
}

export function getFileChanges(opts?: { projectId?: string; sessionId?: string; limit?: number }): FileChangeRecord[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: Array<string | number> = [];
  if (opts?.projectId) {
    conditions.push('project_id = ?');
    params.push(opts.projectId);
  }
  if (opts?.sessionId) {
    conditions.push('session_id = ?');
    params.push(opts.sessionId);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(opts?.limit ?? 100);
  const rows = db
    .prepare(`SELECT * FROM file_changes ${where} ORDER BY timestamp DESC LIMIT ?`)
    .all(...params) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    dedupeKey: String(r.dedupe_key),
    projectId: r.project_id ? String(r.project_id) : null,
    sessionId: r.session_id ? String(r.session_id) : null,
    filePath: String(r.file_path),
    relativePath: String(r.relative_path),
    changeType: r.change_type as FileChangeRecord['changeType'],
    source: String(r.source),
    timestamp: String(r.timestamp),
  }));
}

// ----------------- Agent Sessions -----------------

export interface AgentSessionRecord {
  id: string;
  surface: string;
  projectId: string | null;
  workspacePath: string | null;
  title: string;
  objective: string | null;
  status: 'active' | 'idle' | 'completed' | 'error' | 'unknown';
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
  dataOrigin: DataOrigin;
  metadata: Record<string, unknown>;
}

export function upsertAgentSession(input: {
  id: string;
  surface: string;
  projectId?: string | null;
  workspacePath?: string | null;
  title: string;
  objective?: string | null;
  status: AgentSessionRecord['status'];
  model?: string;
  stepCount?: number;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number | null;
  reportedCostUsd?: number | null;
  startedAt: string;
  lastActiveAt: string;
  durationSeconds?: number;
  isLockedPresence?: boolean;
  dataOrigin?: DataOrigin;
  metadata?: Record<string, unknown>;
}): void {
  const db = getDb();
  const safeMeta = redactObject(input.metadata ?? {});
  db.prepare(
    `INSERT INTO agent_sessions (
      id, surface, project_id, workspace_path, title, objective, status, model,
      step_count, input_tokens, output_tokens, cached_tokens, total_tokens,
      estimated_cost_usd, reported_cost_usd, started_at, last_active_at,
      duration_seconds, is_locked_presence, data_origin, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      surface = excluded.surface,
      project_id = COALESCE(excluded.project_id, agent_sessions.project_id),
      workspace_path = COALESCE(excluded.workspace_path, agent_sessions.workspace_path),
      title = excluded.title,
      objective = COALESCE(excluded.objective, agent_sessions.objective),
      status = excluded.status,
      model = excluded.model,
      step_count = excluded.step_count,
      input_tokens = excluded.input_tokens,
      output_tokens = excluded.output_tokens,
      cached_tokens = excluded.cached_tokens,
      total_tokens = excluded.total_tokens,
      estimated_cost_usd = excluded.estimated_cost_usd,
      reported_cost_usd = excluded.reported_cost_usd,
      last_active_at = excluded.last_active_at,
      duration_seconds = excluded.duration_seconds,
      is_locked_presence = excluded.is_locked_presence,
      data_origin = excluded.data_origin,
      metadata_json = excluded.metadata_json`
  ).run(
    input.id,
    input.surface,
    input.projectId ?? null,
    input.workspacePath ?? null,
    redactSecrets(input.title),
    input.objective ? redactSecrets(input.objective) : null,
    input.status,
    input.model || 'Not exposed',
    input.stepCount ?? 0,
    input.inputTokens ?? 0,
    input.outputTokens ?? 0,
    input.cachedTokens ?? 0,
    input.totalTokens ?? 0,
    input.estimatedCostUsd ?? null,
    input.reportedCostUsd ?? null,
    input.startedAt,
    input.lastActiveAt,
    input.durationSeconds ?? 0,
    input.isLockedPresence ? 1 : 0,
    input.dataOrigin ?? 'measured',
    JSON.stringify(safeMeta)
  );
}

function mapAgentSessionRow(row: Record<string, unknown>): AgentSessionRecord {
  let metadata: Record<string, unknown> = {};
  try {
    metadata = JSON.parse(String(row.metadata_json || '{}'));
  } catch {
    metadata = {};
  }
  return {
    id: String(row.id),
    surface: String(row.surface),
    projectId: row.project_id ? String(row.project_id) : null,
    workspacePath: row.workspace_path ? String(row.workspace_path) : null,
    title: String(row.title),
    objective: row.objective ? String(row.objective) : null,
    status: (row.status as AgentSessionRecord['status']) || 'unknown',
    model: String(row.model || 'Not exposed'),
    stepCount: Number(row.step_count ?? 0),
    inputTokens: Number(row.input_tokens ?? 0),
    outputTokens: Number(row.output_tokens ?? 0),
    cachedTokens: Number(row.cached_tokens ?? 0),
    totalTokens: Number(row.total_tokens ?? 0),
    estimatedCostUsd: row.estimated_cost_usd !== null && row.estimated_cost_usd !== undefined ? Number(row.estimated_cost_usd) : null,
    reportedCostUsd: row.reported_cost_usd !== null && row.reported_cost_usd !== undefined ? Number(row.reported_cost_usd) : null,
    startedAt: String(row.started_at),
    lastActiveAt: String(row.last_active_at),
    durationSeconds: Number(row.duration_seconds ?? 0),
    isLockedPresence: Boolean(row.is_locked_presence),
    dataOrigin: (row.data_origin as DataOrigin) || 'measured',
    metadata,
  };
}

export function getAgentSessions(opts?: { projectId?: string; status?: string; limit?: number }): AgentSessionRecord[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: Array<string | number> = [];
  if (opts?.projectId) {
    conditions.push('project_id = ?');
    params.push(opts.projectId);
  }
  if (opts?.status && opts.status !== 'all') {
    conditions.push('status = ?');
    params.push(opts.status);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(opts?.limit ?? 100);
  const rows = db
    .prepare(`SELECT * FROM agent_sessions ${where} ORDER BY is_locked_presence DESC, last_active_at DESC LIMIT ?`)
    .all(...params) as Array<Record<string, unknown>>;
  return rows.map(mapAgentSessionRow);
}

export function getAgentSessionById(id: string): AgentSessionRecord | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM agent_sessions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? mapAgentSessionRow(row) : null;
}

// ----------------- Tasks -----------------

export interface TaskRecord {
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
  relatedCommits: string[];
  relatedPrs: string[];
  errors: string[];
  dataOrigin: DataOrigin;
  createdAt: string;
  updatedAt: string;
}

export function upsertTask(input: {
  id: string;
  title: string;
  description?: string;
  projectId?: string | null;
  sessionId?: string | null;
  source: TaskRecord['source'];
  status: TaskRecord['status'];
  progressText?: string;
  startTime: string;
  endTime?: string | null;
  durationSeconds?: number | null;
  relevantFiles?: string[];
  commands?: TaskRecord['commands'];
  relatedCommits?: string[];
  relatedPrs?: string[];
  errors?: string[];
  dataOrigin?: DataOrigin;
}): TaskRecord {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO tasks (
      id, title, description, project_id, session_id, source, status, progress_text,
      start_time, end_time, duration_seconds, relevant_files_json, commands_json,
      related_commits_json, related_prs_json, errors_json, data_origin, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      description = excluded.description,
      project_id = COALESCE(excluded.project_id, tasks.project_id),
      status = excluded.status,
      progress_text = excluded.progress_text,
      end_time = excluded.end_time,
      duration_seconds = excluded.duration_seconds,
      relevant_files_json = excluded.relevant_files_json,
      commands_json = excluded.commands_json,
      related_commits_json = excluded.related_commits_json,
      related_prs_json = excluded.related_prs_json,
      errors_json = excluded.errors_json,
      updated_at = excluded.updated_at`
  ).run(
    input.id,
    redactSecrets(input.title),
    redactSecrets(input.description ?? ''),
    input.projectId ?? null,
    input.sessionId ?? null,
    input.source,
    input.status,
    input.progressText ?? 'Progress not exposed',
    input.startTime,
    input.endTime ?? null,
    input.durationSeconds ?? null,
    JSON.stringify(input.relevantFiles ?? []),
    JSON.stringify(redactObject(input.commands ?? [])),
    JSON.stringify(input.relatedCommits ?? []),
    JSON.stringify(input.relatedPrs ?? []),
    JSON.stringify(redactObject(input.errors ?? [])),
    input.dataOrigin ?? 'measured',
    now,
    now
  );
  return getTaskById(input.id)!;
}

function mapTaskRow(row: Record<string, unknown>): TaskRecord {
  const parseArr = <T>(val: unknown): T[] => {
    try {
      return JSON.parse(String(val || '[]')) as T[];
    } catch {
      return [];
    }
  };
  return {
    id: String(row.id),
    title: String(row.title),
    description: String(row.description ?? ''),
    projectId: row.project_id ? String(row.project_id) : null,
    sessionId: row.session_id ? String(row.session_id) : null,
    source: (row.source as TaskRecord['source']) || 'antigravity',
    status: (row.status as TaskRecord['status']) || 'unknown',
    progressText: String(row.progress_text || 'Progress not exposed'),
    startTime: String(row.start_time),
    endTime: row.end_time ? String(row.end_time) : null,
    durationSeconds: row.duration_seconds !== null && row.duration_seconds !== undefined ? Number(row.duration_seconds) : null,
    relevantFiles: parseArr<string>(row.relevant_files_json),
    commands: parseArr<TaskRecord['commands'][number]>(row.commands_json),
    relatedCommits: parseArr<string>(row.related_commits_json),
    relatedPrs: parseArr<string>(row.related_prs_json),
    errors: parseArr<string>(row.errors_json),
    dataOrigin: (row.data_origin as DataOrigin) || 'measured',
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function getTaskById(id: string): TaskRecord | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? mapTaskRow(row) : null;
}

export function getTasks(opts?: { projectId?: string; sessionId?: string; status?: string; source?: string }): TaskRecord[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: Array<string | number> = [];
  if (opts?.projectId) {
    conditions.push('project_id = ?');
    params.push(opts.projectId);
  }
  if (opts?.sessionId) {
    conditions.push('session_id = ?');
    params.push(opts.sessionId);
  }
  if (opts?.status && opts.status !== 'all') {
    conditions.push('status = ?');
    params.push(opts.status);
  }
  if (opts?.source && opts.source !== 'all') {
    conditions.push('source = ?');
    params.push(opts.source);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM tasks ${where} ORDER BY start_time DESC LIMIT 200`).all(...params) as Array<
    Record<string, unknown>
  >;
  return rows.map(mapTaskRow);
}

// ----------------- Repositories -----------------

export interface RepositoryRecord {
  id: string;
  projectId: string | null;
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
  openIssues: Array<{ number: number; title: string; state: string; author: string; updatedAt: string; url: string }>;
  openPrs: Array<{ number: number; title: string; state: string; author: string; branch?: string; updatedAt: string; url: string; draft?: boolean }>;
  workflows: Array<{ id: number; name: string; status: string; conclusion: string | null; branch: string; url: string; createdAt: string }>;
  changedFiles: Array<{ status: string; path: string }>;
  lastSyncedAt: string;
}

export function upsertRepository(input: Omit<RepositoryRecord, 'id' | 'lastSyncedAt'> & { id?: string }): RepositoryRecord {
  const db = getDb();
  const normalizedPath = normalizeLocalPath(input.localPath);
  const id = input.id || stableId('repo', normalizedPath.toLowerCase());
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO repositories (
      id, project_id, name, owner, full_name, local_path, remote_url, html_url,
      default_branch, current_branch, working_tree_status, ahead_count, behind_count,
      uncommitted_count, open_issues_count, open_prs_count, workflow_status,
      deployment_status, recent_commits_json, contributors_json, open_issues_json,
      open_prs_json, workflows_json, changed_files_json, last_synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      project_id = COALESCE(excluded.project_id, repositories.project_id),
      name = excluded.name,
      owner = excluded.owner,
      full_name = excluded.full_name,
      local_path = excluded.local_path,
      remote_url = excluded.remote_url,
      html_url = excluded.html_url,
      default_branch = excluded.default_branch,
      current_branch = excluded.current_branch,
      working_tree_status = excluded.working_tree_status,
      ahead_count = excluded.ahead_count,
      behind_count = excluded.behind_count,
      uncommitted_count = excluded.uncommitted_count,
      open_issues_count = excluded.open_issues_count,
      open_prs_count = excluded.open_prs_count,
      workflow_status = excluded.workflow_status,
      deployment_status = excluded.deployment_status,
      recent_commits_json = excluded.recent_commits_json,
      contributors_json = excluded.contributors_json,
      open_issues_json = excluded.open_issues_json,
      open_prs_json = excluded.open_prs_json,
      workflows_json = excluded.workflows_json,
      changed_files_json = excluded.changed_files_json,
      last_synced_at = excluded.last_synced_at`
  ).run(
    id,
    input.projectId ?? null,
    input.name,
    input.owner,
    input.fullName,
    normalizedPath,
    redactSecrets(input.remoteUrl),
    input.htmlUrl ?? null,
    input.defaultBranch,
    input.currentBranch,
    input.workingTreeStatus,
    input.aheadCount,
    input.behindCount,
    input.uncommittedCount,
    input.openIssuesCount ?? null,
    input.openPrsCount ?? null,
    input.workflowStatus,
    input.deploymentStatus,
    JSON.stringify(input.recentCommits ?? []),
    JSON.stringify(input.contributors ?? []),
    JSON.stringify(input.openIssues ?? []),
    JSON.stringify(input.openPrs ?? []),
    JSON.stringify(input.workflows ?? []),
    JSON.stringify(input.changedFiles ?? []),
    now
  );

  const row = db.prepare('SELECT * FROM repositories WHERE id = ?').get(id) as Record<string, unknown>;
  return mapRepositoryRow(row);
}

function mapRepositoryRow(row: Record<string, unknown>): RepositoryRecord {
  const parseJson = <T>(val: unknown): T[] => {
    try {
      return JSON.parse(String(val || '[]')) as T[];
    } catch {
      return [];
    }
  };
  return {
    id: String(row.id),
    projectId: row.project_id ? String(row.project_id) : null,
    name: String(row.name),
    owner: String(row.owner),
    fullName: String(row.full_name),
    localPath: String(row.local_path),
    remoteUrl: String(row.remote_url),
    htmlUrl: row.html_url ? String(row.html_url) : null,
    defaultBranch: String(row.default_branch),
    currentBranch: String(row.current_branch),
    workingTreeStatus: String(row.working_tree_status),
    aheadCount: Number(row.ahead_count ?? 0),
    behindCount: Number(row.behind_count ?? 0),
    uncommittedCount: Number(row.uncommitted_count ?? 0),
    openIssuesCount: row.open_issues_count !== null && row.open_issues_count !== undefined ? Number(row.open_issues_count) : null,
    openPrsCount: row.open_prs_count !== null && row.open_prs_count !== undefined ? Number(row.open_prs_count) : null,
    workflowStatus: String(row.workflow_status || 'unknown'),
    deploymentStatus: String(row.deployment_status || 'none'),
    recentCommits: parseJson(row.recent_commits_json),
    contributors: parseJson(row.contributors_json),
    openIssues: parseJson(row.open_issues_json),
    openPrs: parseJson(row.open_prs_json),
    workflows: parseJson(row.workflows_json),
    changedFiles: parseJson(row.changed_files_json),
    lastSyncedAt: String(row.last_synced_at),
  };
}

export function getRepositories(): RepositoryRecord[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM repositories ORDER BY uncommitted_count DESC, name ASC').all() as Array<
    Record<string, unknown>
  >;
  return rows.map(mapRepositoryRow);
}

export function getRepositoryById(id: string): RepositoryRecord | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM repositories WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? mapRepositoryRow(row) : null;
}

// ----------------- Usage Records -----------------

export interface UsageRecordItem {
  id: string;
  dedupeKey: string;
  provider: string;
  model: string;
  source: string;
  sessionId: string | null;
  projectId: string | null;
  taskId: string | null;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  totalTokens: number;
  estimatedCostUsd: number | null;
  reportedCostUsd: number | null;
  pricingVersion: string;
  dataOrigin: DataOrigin;
  timestamp: string;
}

export function upsertUsageRecord(input: {
  dedupeKey: string;
  provider: string;
  model: string;
  source: string;
  sessionId?: string | null;
  projectId?: string | null;
  taskId?: string | null;
  requestCount?: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
  totalTokens?: number;
  estimatedCostUsd: number | null;
  reportedCostUsd?: number | null;
  pricingVersion?: string;
  dataOrigin?: DataOrigin;
  timestamp: string;
}): void {
  const db = getDb();
  const id = stableId('usg', input.dedupeKey);
  const cached = input.cachedTokens ?? 0;
  const total = input.totalTokens ?? input.inputTokens + input.outputTokens + cached;

  db.prepare(
    `INSERT INTO usage_records (
      id, dedupe_key, provider, model, source, session_id, project_id, task_id,
      request_count, input_tokens, output_tokens, cached_tokens, total_tokens,
      estimated_cost_usd, reported_cost_usd, pricing_version, data_origin, timestamp
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(dedupe_key) DO UPDATE SET
      model = excluded.model,
      input_tokens = excluded.input_tokens,
      output_tokens = excluded.output_tokens,
      cached_tokens = excluded.cached_tokens,
      total_tokens = excluded.total_tokens,
      estimated_cost_usd = excluded.estimated_cost_usd,
      reported_cost_usd = excluded.reported_cost_usd,
      pricing_version = excluded.pricing_version`
  ).run(
    id,
    input.dedupeKey,
    input.provider,
    input.model,
    input.source,
    input.sessionId ?? null,
    input.projectId ?? null,
    input.taskId ?? null,
    input.requestCount ?? 1,
    input.inputTokens,
    input.outputTokens,
    cached,
    total,
    input.estimatedCostUsd,
    input.reportedCostUsd ?? null,
    input.pricingVersion ?? 'v2026.10',
    input.dataOrigin ?? 'measured',
    input.timestamp
  );
}

export function getUsageRecords(opts?: {
  sessionId?: string;
  projectId?: string;
  since?: string;
  until?: string;
}): UsageRecordItem[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: Array<string | number> = [];

  if (opts?.sessionId) {
    conditions.push('session_id = ?');
    params.push(opts.sessionId);
  }
  if (opts?.projectId) {
    conditions.push('project_id = ?');
    params.push(opts.projectId);
  }
  if (opts?.since) {
    conditions.push('timestamp >= ?');
    params.push(opts.since);
  }
  if (opts?.until) {
    conditions.push('timestamp <= ?');
    params.push(opts.until);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db
    .prepare(`SELECT * FROM usage_records ${where} ORDER BY timestamp DESC LIMIT 5000`)
    .all(...params) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: String(r.id),
    dedupeKey: String(r.dedupe_key),
    provider: String(r.provider),
    model: String(r.model),
    source: String(r.source),
    sessionId: r.session_id ? String(r.session_id) : null,
    projectId: r.project_id ? String(r.project_id) : null,
    taskId: r.task_id ? String(r.task_id) : null,
    requestCount: Number(r.request_count ?? 1),
    inputTokens: Number(r.input_tokens ?? 0),
    outputTokens: Number(r.output_tokens ?? 0),
    cachedTokens: Number(r.cached_tokens ?? 0),
    totalTokens: Number(r.total_tokens ?? 0),
    estimatedCostUsd: r.estimated_cost_usd !== null && r.estimated_cost_usd !== undefined ? Number(r.estimated_cost_usd) : null,
    reportedCostUsd: r.reported_cost_usd !== null && r.reported_cost_usd !== undefined ? Number(r.reported_cost_usd) : null,
    pricingVersion: String(r.pricing_version || 'v2026.10'),
    dataOrigin: (r.data_origin as DataOrigin) || 'measured',
    timestamp: String(r.timestamp),
  }));
}

// ----------------- Process Observations -----------------

export interface ProcessObservationRecord {
  id: string;
  pid: number;
  name: string;
  executable: string;
  commandLine: string;
  workingDirectory: string;
  projectId: string | null;
  category: 'node' | 'python' | 'git' | 'antigravity' | 'build' | 'server' | 'other';
  cpuPercent: number;
  memoryBytes: number;
  parentPid: number | null;
  listeningPorts: number[];
  startTime: string | null;
  uptimeSeconds: number;
  status: string;
  observedAt: string;
}

export function replaceProcessObservations(items: Omit<ProcessObservationRecord, 'id'>[]): void {
  const db = getDb();
  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM process_observations');
    const stmt = db.prepare(
      `INSERT INTO process_observations (
        id, pid, name, executable, command_line, working_directory, project_id,
        category, cpu_percent, memory_bytes, parent_pid, listening_ports_json,
        start_time, uptime_seconds, status, observed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const item of items) {
      const id = `proc_${item.pid}`;
      stmt.run(
        id,
        item.pid,
        item.name,
        item.executable,
        redactSecrets(item.commandLine),
        item.workingDirectory,
        item.projectId ?? null,
        item.category,
        item.cpuPercent,
        item.memoryBytes,
        item.parentPid ?? null,
        JSON.stringify(item.listeningPorts ?? []),
        item.startTime ?? null,
        item.uptimeSeconds,
        item.status,
        item.observedAt
      );
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function getProcessObservations(): ProcessObservationRecord[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM process_observations ORDER BY memory_bytes DESC, pid ASC')
    .all() as Array<Record<string, unknown>>;
  return rows.map((r) => {
    let ports: number[] = [];
    try {
      ports = JSON.parse(String(r.listening_ports_json || '[]'));
    } catch {
      ports = [];
    }
    return {
      id: String(r.id),
      pid: Number(r.pid),
      name: String(r.name),
      executable: String(r.executable ?? ''),
      commandLine: String(r.command_line ?? ''),
      workingDirectory: String(r.working_directory ?? ''),
      projectId: r.project_id ? String(r.project_id) : null,
      category: (r.category as ProcessObservationRecord['category']) || 'other',
      cpuPercent: Number(r.cpu_percent ?? 0),
      memoryBytes: Number(r.memory_bytes ?? 0),
      parentPid: r.parent_pid !== null && r.parent_pid !== undefined ? Number(r.parent_pid) : null,
      listeningPorts: ports,
      startTime: r.start_time ? String(r.start_time) : null,
      uptimeSeconds: Number(r.uptime_seconds ?? 0),
      status: String(r.status || 'running'),
      observedAt: String(r.observed_at),
    };
  });
}

// ----------------- Errors & Reliability -----------------

export interface ErrorRecord {
  id: string;
  dedupeKey: string;
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

export function recordError(input: {
  dedupeKey?: string;
  projectId?: string | null;
  sessionId?: string | null;
  taskId?: string | null;
  source: string;
  category: string;
  severity?: ErrorRecord['severity'];
  title: string;
  message: string;
  diagnostics?: Record<string, unknown>;
  timestamp?: string;
}): ErrorRecord {
  const db = getDb();
  const now = input.timestamp || new Date().toISOString();
  const safeTitle = redactSecrets(input.title);
  const safeMessage = redactSecrets(input.message);
  const safeDiag = redactObject(input.diagnostics ?? {});
  const rawDedupe = input.dedupeKey || `${input.source}:${input.category}:${input.projectId ?? ''}:${safeTitle}`;
  const dedupeKey = crypto.createHash('sha1').update(rawDedupe).digest('hex');
  const id = `err_${dedupeKey.slice(0, 16)}`;

  const existing = db.prepare('SELECT * FROM errors WHERE dedupe_key = ?').get(dedupeKey) as
    | Record<string, unknown>
    | undefined;

  if (existing) {
    db.prepare(
      `UPDATE errors SET
        last_seen_at = ?,
        occurrence_count = occurrence_count + 1,
        message = ?,
        diagnostics_json = ?
       WHERE dedupe_key = ?`
    ).run(now, safeMessage, JSON.stringify(safeDiag), dedupeKey);
  } else {
    db.prepare(
      `INSERT INTO errors (
        id, dedupe_key, project_id, session_id, task_id, source, category,
        severity, title, message, diagnostics_json, status, first_seen_at, last_seen_at, occurrence_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, 1)`
    ).run(
      id,
      dedupeKey,
      input.projectId ?? null,
      input.sessionId ?? null,
      input.taskId ?? null,
      input.source,
      input.category,
      input.severity ?? 'error',
      safeTitle,
      safeMessage,
      JSON.stringify(safeDiag),
      now,
      now
    );
  }

  const row = db.prepare('SELECT * FROM errors WHERE dedupe_key = ?').get(dedupeKey) as Record<string, unknown>;
  return mapErrorRow(row);
}

function mapErrorRow(row: Record<string, unknown>): ErrorRecord {
  let diagnostics: Record<string, unknown> = {};
  try {
    diagnostics = JSON.parse(String(row.diagnostics_json || '{}'));
  } catch {
    diagnostics = {};
  }
  return {
    id: String(row.id),
    dedupeKey: String(row.dedupe_key),
    projectId: row.project_id ? String(row.project_id) : null,
    sessionId: row.session_id ? String(row.session_id) : null,
    taskId: row.task_id ? String(row.task_id) : null,
    source: String(row.source),
    category: String(row.category),
    severity: (row.severity as ErrorRecord['severity']) || 'error',
    title: String(row.title),
    message: String(row.message),
    diagnostics,
    status: (row.status as ErrorRecord['status']) || 'open',
    acknowledgedAt: row.acknowledged_at ? String(row.acknowledged_at) : null,
    resolvedAt: row.resolved_at ? String(row.resolved_at) : null,
    resolutionNote: row.resolution_note ? String(row.resolution_note) : null,
    firstSeenAt: String(row.first_seen_at),
    lastSeenAt: String(row.last_seen_at),
    occurrenceCount: Number(row.occurrence_count ?? 1),
  };
}

export function getErrors(opts?: { status?: string; severity?: string; projectId?: string; search?: string }): ErrorRecord[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: Array<string | number> = [];

  if (opts?.status && opts.status !== 'all') {
    conditions.push('status = ?');
    params.push(opts.status);
  }
  if (opts?.severity && opts.severity !== 'all') {
    conditions.push('severity = ?');
    params.push(opts.severity);
  }
  if (opts?.projectId) {
    conditions.push('project_id = ?');
    params.push(opts.projectId);
  }
  if (opts?.search) {
    conditions.push('(title LIKE ? OR message LIKE ? OR source LIKE ?)');
    const q = `%${opts.search}%`;
    params.push(q, q, q);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db
    .prepare(`SELECT * FROM errors ${where} ORDER BY last_seen_at DESC LIMIT 300`)
    .all(...params) as Array<Record<string, unknown>>;
  return rows.map(mapErrorRow);
}

export function updateErrorStatus(
  id: string,
  action: 'acknowledge' | 'resolve' | 'reopen',
  resolutionNote?: string
): ErrorRecord | null {
  const db = getDb();
  const now = new Date().toISOString();
  if (action === 'acknowledge') {
    db.prepare('UPDATE errors SET status = ?, acknowledged_at = ? WHERE id = ?').run('acknowledged', now, id);
  } else if (action === 'resolve') {
    db.prepare('UPDATE errors SET status = ?, resolved_at = ?, resolution_note = ? WHERE id = ?').run(
      'resolved',
      now,
      resolutionNote ? redactSecrets(resolutionNote) : null,
      id
    );
  } else if (action === 'reopen') {
    db.prepare('UPDATE errors SET status = ?, resolved_at = NULL WHERE id = ?').run('open', id);
  }
  const row = db.prepare('SELECT * FROM errors WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? mapErrorRow(row) : null;
}

// ----------------- Notifications -----------------

export interface NotificationRecord {
  id: string;
  dedupeKey: string;
  type: string;
  severity: 'info' | 'warning' | 'error';
  title: string;
  message: string;
  projectId: string | null;
  link: string | null;
  read: boolean;
  createdAt: string;
}

export function createNotification(input: {
  dedupeKey?: string;
  type: string;
  severity?: 'info' | 'warning' | 'error';
  title: string;
  message: string;
  projectId?: string | null;
  link?: string | null;
}): NotificationRecord | null {
  const enabled = getSetting<boolean>('notificationsEnabled', true);
  if (!enabled) return null;

  const db = getDb();
  const now = new Date().toISOString();
  const cooldownSec = getSetting<number>('notificationCooldownSeconds', 120);
  const cooldownBucket = Math.floor(Date.now() / (Math.max(cooldownSec, 10) * 1000));
  const rawDedupe = input.dedupeKey || `${input.type}:${input.title}:${cooldownBucket}`;
  const dedupeKey = crypto.createHash('sha1').update(rawDedupe).digest('hex');
  const id = `ntf_${dedupeKey.slice(0, 16)}`;

  const res = db
    .prepare(
      `INSERT OR IGNORE INTO notifications (
        id, dedupe_key, type, severity, title, message, project_id, link, read, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
    )
    .run(
      id,
      dedupeKey,
      input.type,
      input.severity ?? 'info',
      redactSecrets(input.title),
      redactSecrets(input.message),
      input.projectId ?? null,
      input.link ?? null,
      now
    );

  if (Number(res.changes) === 0) return null;
  const row = db.prepare('SELECT * FROM notifications WHERE id = ?').get(id) as Record<string, unknown>;
  return {
    id: String(row.id),
    dedupeKey: String(row.dedupe_key),
    type: String(row.type),
    severity: (row.severity as NotificationRecord['severity']) || 'info',
    title: String(row.title),
    message: String(row.message),
    projectId: row.project_id ? String(row.project_id) : null,
    link: row.link ? String(row.link) : null,
    read: Boolean(row.read),
    createdAt: String(row.created_at),
  };
}

export function getNotifications(limit = 50): NotificationRecord[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?')
    .all(limit) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: String(row.id),
    dedupeKey: String(row.dedupe_key),
    type: String(row.type),
    severity: (row.severity as NotificationRecord['severity']) || 'info',
    title: String(row.title),
    message: String(row.message),
    projectId: row.project_id ? String(row.project_id) : null,
    link: row.link ? String(row.link) : null,
    read: Boolean(row.read),
    createdAt: String(row.created_at),
  }));
}

export function markAllNotificationsRead(): void {
  const db = getDb();
  db.exec('UPDATE notifications SET read = 1 WHERE read = 0');
}

// ----------------- Integration Connections -----------------

export interface IntegrationConnectionRecord {
  id: string;
  name: string;
  type: string;
  status: 'connected' | 'degraded' | 'disconnected' | 'unavailable';
  authSource: string;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  retryCount: number;
  capabilities: Record<string, string>;
  diagnostics: Record<string, unknown>;
  updatedAt: string;
}

export function upsertIntegrationConnection(input: {
  id: string;
  name: string;
  type: string;
  status: IntegrationConnectionRecord['status'];
  authSource: string;
  lastSuccessAt?: string | null;
  lastErrorAt?: string | null;
  lastError?: string | null;
  retryCount?: number;
  capabilities?: Record<string, string>;
  diagnostics?: Record<string, unknown>;
}): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO integration_connections (
      id, name, type, status, auth_source, last_success_at, last_error_at,
      last_error, retry_count, capabilities_json, diagnostics_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      status = excluded.status,
      auth_source = excluded.auth_source,
      last_success_at = COALESCE(excluded.last_success_at, integration_connections.last_success_at),
      last_error_at = excluded.last_error_at,
      last_error = excluded.last_error,
      retry_count = excluded.retry_count,
      capabilities_json = excluded.capabilities_json,
      diagnostics_json = excluded.diagnostics_json,
      updated_at = excluded.updated_at`
  ).run(
    input.id,
    input.name,
    input.type,
    input.status,
    input.authSource,
    input.lastSuccessAt ?? null,
    input.lastErrorAt ?? null,
    input.lastError ? redactSecrets(input.lastError) : null,
    input.retryCount ?? 0,
    JSON.stringify(input.capabilities ?? {}),
    JSON.stringify(redactObject(input.diagnostics ?? {})),
    now
  );
}

export function getIntegrationConnections(): IntegrationConnectionRecord[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM integration_connections ORDER BY id ASC').all() as Array<
    Record<string, unknown>
  >;
  return rows.map((r) => {
    let capabilities: Record<string, string> = {};
    let diagnostics: Record<string, unknown> = {};
    try {
      capabilities = JSON.parse(String(r.capabilities_json || '{}'));
    } catch {
      capabilities = {};
    }
    try {
      diagnostics = JSON.parse(String(r.diagnostics_json || '{}'));
    } catch {
      diagnostics = {};
    }
    return {
      id: String(r.id),
      name: String(r.name),
      type: String(r.type),
      status: (r.status as IntegrationConnectionRecord['status']) || 'unavailable',
      authSource: String(r.auth_source || 'local'),
      lastSuccessAt: r.last_success_at ? String(r.last_success_at) : null,
      lastErrorAt: r.last_error_at ? String(r.last_error_at) : null,
      lastError: r.last_error ? String(r.last_error) : null,
      retryCount: Number(r.retry_count ?? 0),
      capabilities,
      diagnostics,
      updatedAt: String(r.updated_at),
    };
  });
}

// ----------------- Data Retention & History Controls -----------------

export function applyDataRetention(days?: number): { deletedEvents: number; deletedFileChanges: number } {
  const db = getDb();
  const retentionDays = days ?? getSetting<number>('retentionDays', 30);
  const cutoff = new Date(Date.now() - retentionDays * 86400 * 1000).toISOString();

  const evtRes = db.prepare('DELETE FROM activity_events WHERE timestamp < ?').run(cutoff);
  const fcRes = db.prepare('DELETE FROM file_changes WHERE timestamp < ?').run(cutoff);
  return {
    deletedEvents: Number(evtRes.changes),
    deletedFileChanges: Number(fcRes.changes),
  };
}

export function clearMonitoringHistory(scope: 'events' | 'errors' | 'usage' | 'all'): void {
  const db = getDb();
  if (scope === 'events' || scope === 'all') {
    db.exec('DELETE FROM activity_events');
    db.exec('DELETE FROM file_changes');
    db.exec('DELETE FROM notifications');
  }
  if (scope === 'errors' || scope === 'all') {
    db.exec('DELETE FROM errors');
  }
  if (scope === 'usage' || scope === 'all') {
    db.exec('DELETE FROM usage_records');
  }
}

// ----------------- Global Search -----------------

export interface GlobalSearchResults {
  projects: ProjectRecord[];
  repositories: RepositoryRecord[];
  tasks: TaskRecord[];
  events: ActivityEventRecord[];
  errors: ErrorRecord[];
  fileChanges: FileChangeRecord[];
}

export function globalSearch(query: string): GlobalSearchResults {
  const trimmed = query.trim();
  if (!trimmed) {
    return { projects: [], repositories: [], tasks: [], events: [], errors: [], fileChanges: [] };
  }
  const db = getDb();
  const q = `%${trimmed}%`;

  const projRows = db
    .prepare('SELECT * FROM projects WHERE name LIKE ? OR local_path LIKE ? OR github_repo LIKE ? LIMIT 15')
    .all(q, q, q) as Array<Record<string, unknown>>;

  const repoRows = db
    .prepare('SELECT * FROM repositories WHERE full_name LIKE ? OR local_path LIKE ? OR current_branch LIKE ? LIMIT 15')
    .all(q, q, q) as Array<Record<string, unknown>>;

  const taskRows = db
    .prepare('SELECT * FROM tasks WHERE title LIKE ? OR description LIKE ? OR progress_text LIKE ? LIMIT 20')
    .all(q, q, q) as Array<Record<string, unknown>>;

  const events = getActivityEvents({ search: trimmed, limit: 30 });
  const errors = getErrors({ search: trimmed });

  const fcRows = db
    .prepare('SELECT * FROM file_changes WHERE file_path LIKE ? OR relative_path LIKE ? ORDER BY timestamp DESC LIMIT 20')
    .all(q, q) as Array<Record<string, unknown>>;

  return {
    projects: projRows.map(mapProjectRow),
    repositories: repoRows.map(mapRepositoryRow),
    tasks: taskRows.map(mapTaskRow),
    events,
    errors,
    fileChanges: fcRows.map((r) => ({
      id: String(r.id),
      dedupeKey: String(r.dedupe_key),
      projectId: r.project_id ? String(r.project_id) : null,
      sessionId: r.session_id ? String(r.session_id) : null,
      filePath: String(r.file_path),
      relativePath: String(r.relative_path),
      changeType: r.change_type as FileChangeRecord['changeType'],
      source: String(r.source),
      timestamp: String(r.timestamp),
    })),
  };
}
