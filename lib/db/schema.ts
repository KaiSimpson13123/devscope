import { sqliteTable, text, integer, real, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

export type DataOrigin = 'measured' | 'reported' | 'estimated' | 'inferred';

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    localPath: text('local_path').notNull().unique(),
    githubRepo: text('github_repo'),
    currentBranch: text('current_branch'),
    changedFileCount: integer('changed_file_count').notNull().default(0),
    uncommittedSummary: text('uncommitted_summary'),
    lastBuildStatus: text('last_build_status').notNull().default('unknown'),
    lastActivityAt: text('last_activity_at'),
    monitoringHealth: text('monitoring_health').notNull().default('healthy'),
    excluded: integer('excluded', { mode: 'boolean' }).notNull().default(false),
    pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
    isGitRepo: integer('is_git_repo', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_projects_local_path').on(table.localPath),
    index('idx_projects_last_activity').on(table.lastActivityAt),
  ]
);

export const repositories = sqliteTable(
  'repositories',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id'),
    name: text('name').notNull(),
    owner: text('owner').notNull(),
    fullName: text('full_name').notNull(),
    localPath: text('local_path').notNull(),
    remoteUrl: text('remote_url').notNull(),
    htmlUrl: text('html_url'),
    defaultBranch: text('default_branch').notNull().default('main'),
    currentBranch: text('current_branch').notNull().default('main'),
    workingTreeStatus: text('working_tree_status').notNull().default('clean'),
    aheadCount: integer('ahead_count').notNull().default(0),
    behindCount: integer('behind_count').notNull().default(0),
    uncommittedCount: integer('uncommitted_count').notNull().default(0),
    openIssuesCount: integer('open_issues_count'),
    openPrsCount: integer('open_prs_count'),
    workflowStatus: text('workflow_status').notNull().default('unknown'),
    deploymentStatus: text('deployment_status').notNull().default('none'),
    recentCommitsJson: text('recent_commits_json').notNull().default('[]'),
    contributorsJson: text('contributors_json').notNull().default('[]'),
    openIssuesJson: text('open_issues_json').notNull().default('[]'),
    openPrsJson: text('open_prs_json').notNull().default('[]'),
    workflowsJson: text('workflows_json').notNull().default('[]'),
    changedFilesJson: text('changed_files_json').notNull().default('[]'),
    lastSyncedAt: text('last_synced_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_repositories_local_path').on(table.localPath),
    index('idx_repositories_full_name').on(table.fullName),
  ]
);

export const agentSessions = sqliteTable(
  'agent_sessions',
  {
    id: text('id').primaryKey(),
    surface: text('surface').notNull(), // 'antigravity-cli' | 'antigravity-ide' | 'antigravity'
    projectId: text('project_id'),
    workspacePath: text('workspace_path'),
    title: text('title').notNull(),
    objective: text('objective'),
    status: text('status').notNull(), // 'active' | 'idle' | 'completed' | 'error' | 'unknown'
    model: text('model').notNull().default('Not exposed'),
    stepCount: integer('step_count').notNull().default(0),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cachedTokens: integer('cached_tokens').notNull().default(0),
    totalTokens: integer('total_tokens').notNull().default(0),
    estimatedCostUsd: real('estimated_cost_usd'),
    reportedCostUsd: real('reported_cost_usd'),
    startedAt: text('started_at').notNull(),
    lastActiveAt: text('last_active_at').notNull(),
    durationSeconds: integer('duration_seconds').notNull().default(0),
    isLockedPresence: integer('is_locked_presence', { mode: 'boolean' }).notNull().default(false),
    dataOrigin: text('data_origin').notNull().default('measured'),
    metadataJson: text('metadata_json').notNull().default('{}'),
  },
  (table) => [
    index('idx_agent_sessions_status').on(table.status),
    index('idx_agent_sessions_last_active').on(table.lastActiveAt),
    index('idx_agent_sessions_project').on(table.projectId),
  ]
);

export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    projectId: text('project_id'),
    sessionId: text('session_id'),
    source: text('source').notNull(), // 'antigravity' | 'manual' | 'integration'
    status: text('status').notNull(), // 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'unknown'
    progressText: text('progress_text').notNull().default('Progress not exposed'),
    startTime: text('start_time').notNull(),
    endTime: text('end_time'),
    durationSeconds: integer('duration_seconds'),
    relevantFilesJson: text('relevant_files_json').notNull().default('[]'),
    commandsJson: text('commands_json').notNull().default('[]'),
    relatedCommitsJson: text('related_commits_json').notNull().default('[]'),
    relatedPrsJson: text('related_prs_json').notNull().default('[]'),
    errorsJson: text('errors_json').notNull().default('[]'),
    dataOrigin: text('data_origin').notNull().default('measured'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_tasks_project').on(table.projectId),
    index('idx_tasks_session').on(table.sessionId),
    index('idx_tasks_status').on(table.status),
  ]
);

export const activityEvents = sqliteTable(
  'activity_events',
  {
    id: text('id').primaryKey(),
    dedupeKey: text('dedupe_key').notNull().unique(),
    type: text('type').notNull(),
    category: text('category').notNull(), // 'agent' | 'filesystem' | 'git' | 'command' | 'build' | 'task' | 'process' | 'system'
    title: text('title').notNull(),
    detail: text('detail').notNull().default(''),
    source: text('source').notNull(), // e.g., 'antigravity-transcript', 'fs-watcher', 'git-observer', 'process-monitor'
    dataOrigin: text('data_origin').notNull().default('measured'), // 'measured' | 'reported' | 'estimated' | 'inferred'
    severity: text('severity').notNull().default('info'), // 'info' | 'warning' | 'error' | 'success'
    projectId: text('project_id'),
    sessionId: text('session_id'),
    taskId: text('task_id'),
    filePath: text('file_path'),
    metadataJson: text('metadata_json').notNull().default('{}'),
    timestamp: text('timestamp').notNull(),
  },
  (table) => [
    uniqueIndex('idx_activity_events_dedupe').on(table.dedupeKey),
    index('idx_activity_events_timestamp').on(table.timestamp),
    index('idx_activity_events_project').on(table.projectId),
    index('idx_activity_events_session').on(table.sessionId),
    index('idx_activity_events_task').on(table.taskId),
    index('idx_activity_events_category').on(table.category),
  ]
);

export const fileChanges = sqliteTable(
  'file_changes',
  {
    id: text('id').primaryKey(),
    dedupeKey: text('dedupe_key').notNull().unique(),
    projectId: text('project_id'),
    sessionId: text('session_id'),
    filePath: text('file_path').notNull(),
    relativePath: text('relative_path').notNull(),
    changeType: text('change_type').notNull(), // 'created' | 'modified' | 'deleted' | 'renamed' | 'inspected'
    source: text('source').notNull(), // 'fs-watcher' | 'antigravity-tool' | 'git-status'
    timestamp: text('timestamp').notNull(),
  },
  (table) => [
    uniqueIndex('idx_file_changes_dedupe').on(table.dedupeKey),
    index('idx_file_changes_project').on(table.projectId),
    index('idx_file_changes_timestamp').on(table.timestamp),
  ]
);

export const processObservations = sqliteTable(
  'process_observations',
  {
    id: text('id').primaryKey(),
    pid: integer('pid').notNull(),
    name: text('name').notNull(),
    executable: text('executable').notNull().default(''),
    commandLine: text('command_line').notNull().default(''),
    workingDirectory: text('working_directory').notNull().default(''),
    projectId: text('project_id'),
    category: text('category').notNull().default('other'), // 'node' | 'python' | 'git' | 'antigravity' | 'build' | 'server' | 'other'
    cpuPercent: real('cpu_percent').notNull().default(0),
    memoryBytes: integer('memory_bytes').notNull().default(0),
    parentPid: integer('parent_pid'),
    listeningPortsJson: text('listening_ports_json').notNull().default('[]'),
    startTime: text('start_time'),
    uptimeSeconds: integer('uptime_seconds').notNull().default(0),
    status: text('status').notNull().default('running'),
    observedAt: text('observed_at').notNull(),
  },
  (table) => [
    index('idx_process_obs_pid').on(table.pid),
    index('idx_process_obs_project').on(table.projectId),
  ]
);

export const usageRecords = sqliteTable(
  'usage_records',
  {
    id: text('id').primaryKey(),
    dedupeKey: text('dedupe_key').notNull().unique(),
    provider: text('provider').notNull(), // 'Google Antigravity' | 'Anthropic (via AGY)' | 'OpenAI' | etc.
    model: text('model').notNull(),
    source: text('source').notNull(), // 'antigravity-transcript' | 'provider-api'
    sessionId: text('session_id'),
    projectId: text('project_id'),
    taskId: text('task_id'),
    requestCount: integer('request_count').notNull().default(1),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cachedTokens: integer('cached_tokens').notNull().default(0),
    totalTokens: integer('total_tokens').notNull().default(0),
    estimatedCostUsd: real('estimated_cost_usd'), // Calculated from configurable pricing table
    reportedCostUsd: real('reported_cost_usd'), // Strictly null unless reported by a billing API
    pricingVersion: text('pricing_version').notNull().default('v2026.10'),
    dataOrigin: text('data_origin').notNull().default('measured'),
    timestamp: text('timestamp').notNull(),
  },
  (table) => [
    uniqueIndex('idx_usage_records_dedupe').on(table.dedupeKey),
    index('idx_usage_records_timestamp').on(table.timestamp),
    index('idx_usage_records_session').on(table.sessionId),
    index('idx_usage_records_project').on(table.projectId),
    index('idx_usage_records_model').on(table.model),
  ]
);

export const errors = sqliteTable(
  'errors',
  {
    id: text('id').primaryKey(),
    dedupeKey: text('dedupe_key').notNull().unique(),
    projectId: text('project_id'),
    sessionId: text('session_id'),
    taskId: text('task_id'),
    source: text('source').notNull(),
    category: text('category').notNull(), // 'command_failed' | 'build_failed' | 'test_failed' | 'integration_disconnected' | 'github_api_error' | 'permission_error' | 'monitoring_gap' | 'connector_crash'
    severity: text('severity').notNull().default('error'), // 'warning' | 'error' | 'critical'
    title: text('title').notNull(),
    message: text('message').notNull(),
    diagnosticsJson: text('diagnostics_json').notNull().default('{}'),
    status: text('status').notNull().default('open'), // 'open' | 'acknowledged' | 'resolved'
    acknowledgedAt: text('acknowledged_at'),
    resolvedAt: text('resolved_at'),
    resolutionNote: text('resolution_note'),
    firstSeenAt: text('first_seen_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
    occurrenceCount: integer('occurrence_count').notNull().default(1),
  },
  (table) => [
    uniqueIndex('idx_errors_dedupe').on(table.dedupeKey),
    index('idx_errors_status').on(table.status),
    index('idx_errors_last_seen').on(table.lastSeenAt),
  ]
);

export const notifications = sqliteTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    dedupeKey: text('dedupe_key').notNull().unique(),
    type: text('type').notNull(),
    severity: text('severity').notNull().default('info'),
    title: text('title').notNull(),
    message: text('message').notNull(),
    projectId: text('project_id'),
    link: text('link'),
    read: integer('read', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_notifications_dedupe').on(table.dedupeKey),
    index('idx_notifications_created').on(table.createdAt),
  ]
);

export const integrationConnections = sqliteTable('integration_connections', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull(), // 'antigravity' | 'github' | 'filesystem' | 'processes' | 'usage-pricing'
  status: text('status').notNull(), // 'connected' | 'degraded' | 'disconnected' | 'unavailable'
  authSource: text('auth_source').notNull().default('local'),
  lastSuccessAt: text('last_success_at'),
  lastErrorAt: text('last_error_at'),
  lastError: text('last_error'),
  retryCount: integer('retry_count').notNull().default(0),
  capabilitiesJson: text('capabilities_json').notNull().default('{}'),
  diagnosticsJson: text('diagnostics_json').notNull().default('{}'),
  updatedAt: text('updated_at').notNull(),
});

export const applicationSettings = sqliteTable('application_settings', {
  key: text('key').primaryKey(),
  valueJson: text('value_json').notNull(),
  updatedAt: text('updated_at').notNull(),
});
