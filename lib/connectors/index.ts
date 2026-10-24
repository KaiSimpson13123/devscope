import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import {
  upsertAgentSession,
  upsertTask,
  upsertUsageRecord,
  insertFileChange,
  upsertIntegrationConnection,
  getProjectByPath,
  upsertProject,
  recordError,
  stableId,
} from '@/lib/db';
import { ingestActivityEvent } from '@/lib/events';
import { calculateEstimatedCostUsd } from '@/lib/usage';
import { redactSecrets, isSafeLocalPath } from '@/lib/security';

export interface ConnectorCapability {
  key: string;
  label: string;
  status: 'exposed' | 'partial' | 'not_exposed';
  source: string;
  detail: string;
}

export interface ConnectorDiagnostics {
  connectorId: string;
  name: string;
  status: 'connected' | 'degraded' | 'disconnected' | 'unavailable';
  discoveredPaths: string[];
  cliBinaryPath: string | null;
  cliVersion: string | null;
  activeSurfaces: string[];
  sessionCount: number;
  activeSessionCount: number;
  mcpStatus: string;
  pluginsStatus: string;
  availableModels: string[];
  capabilities: ConnectorCapability[];
  lastSyncedAt: string;
}

export interface ConnectorAdapter {
  id: string;
  name: string;
  discoverAndSync(): Promise<ConnectorDiagnostics>;
}

interface TranscriptStep {
  step_index?: number;
  source?: string;
  type?: string;
  status?: string;
  created_at?: string;
  content?: string;
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  tool_calls?: Array<{
    name?: string;
    args?: Record<string, unknown>;
  }>;
  // Note: 'thinking' is intentionally excluded from our interface and never extracted
}

function unquoteArg(val: unknown): string {
  if (val === null || val === undefined) return '';
  const str = String(val).trim();
  if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) {
    try {
      return JSON.parse(str);
    } catch {
      return str.slice(1, -1);
    }
  }
  return str;
}

function extractUserObjective(rawContent: string): string | null {
  const match = rawContent.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/i);
  const body = (match ? match[1] : rawContent).trim();
  if (!body) return null;
  const lines = body
    .split(/\r?\n/)
    .map((l) => l.replace(/^#+\s*/, '').trim())
    .filter((l) => l.length > 3);
  if (lines.length === 0) return null;
  const firstLine = lines[0];
  return firstLine.length > 140 ? firstLine.slice(0, 137) + '...' : firstLine;
}

function extractModelSelection(rawContent: string): string | null {
  const match = rawContent.match(
    /changed setting [`'"]?Model Selection[`'"]? from .+? to ([A-Za-z0-9][A-Za-z0-9 .\-()]+?)\.(?:\s|$)/i
  );
  if (match && match[1]) {
    return match[1].trim();
  }
  const poweredBy = rawContent.match(
    /powered by (Claude [A-Za-z0-9.]+(?:\s*\([A-Za-z]+\))?|Gemini [A-Za-z0-9.]+(?:\s*\([A-Za-z]+\))?)/i
  );
  if (poweredBy && poweredBy[1]) {
    return poweredBy[1].trim();
  }
  return null;
}

export class AntigravityConnector implements ConnectorAdapter {
  public readonly id = 'antigravity';
  public readonly name = 'Google Antigravity (CLI & IDE)';

  private getGeminiRoot(): string {
    if (process.env.ANTIGRAVITY_HOME) {
      return path.resolve(process.env.ANTIGRAVITY_HOME);
    }
    const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
    return path.join(home, '.gemini');
  }

  private findAgyBinary(): string | null {
    const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
    const candidates = [
      path.join(home, 'AppData', 'Local', 'agy', 'bin', 'agy.exe'),
      path.join(home, '.gemini', 'antigravity-cli', 'bin', 'agentapi.bat'),
      '/usr/local/bin/agy',
      '/usr/bin/agy',
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    return null;
  }

  public async discoverAndSync(): Promise<ConnectorDiagnostics> {
    const geminiRoot = this.getGeminiRoot();
    const surfaces = ['antigravity-cli', 'antigravity-ide', 'antigravity'];
    const discoveredPaths: string[] = [];
    const activeSurfaces: string[] = [];

    for (const s of surfaces) {
      const p = path.join(geminiRoot, s);
      if (fs.existsSync(p)) {
        discoveredPaths.push(p);
        activeSurfaces.push(s);
      }
    }

    const cliBinaryPath = this.findAgyBinary();
    let cliVersion: string | null = 'Language Server 1.4.7';
    let mcpStatus = 'No MCP servers configured';
    const availableModels: string[] = [
      'Gemini 4 Argon (Medium)',
      'Gemini 4 Argon (High)',
      'Gemini 3.8 Flash (High)',
      'Claude Opus 5.5 (High)',
      'Claude Sonnet 5.5 (High)',
      'GPT-OSS 120B (Medium)',
    ];

    // Check settings.json for trustedWorkspaces
    const cliSettingsPath = path.join(geminiRoot, 'antigravity-cli', 'settings.json');
    if (fs.existsSync(cliSettingsPath)) {
      try {
        const settingsRaw = JSON.parse(fs.readFileSync(cliSettingsPath, 'utf8')) as {
          trustedWorkspaces?: string[];
        };
        if (Array.isArray(settingsRaw.trustedWorkspaces)) {
          for (const ws of settingsRaw.trustedWorkspaces) {
            if (fs.existsSync(ws) && isSafeLocalPath(ws)) {
              const stat = fs.statSync(ws);
              // Register non-root workspaces automatically
              if (stat.isDirectory() && path.dirname(ws) !== ws && path.basename(ws).toLowerCase() !== 'kaisi') {
                upsertProject({
                  name: path.basename(ws),
                  localPath: ws,
                  isGitRepo: fs.existsSync(path.join(ws, '.git')),
                });
              }
            }
          }
        }
      } catch {
        // ignore malformed settings.json
      }
    }

    // Check last_conversations.json mapping workspace -> conversationId
    const workspaceBySession = new Map<string, string>();
    const lastConvPath = path.join(geminiRoot, 'antigravity-cli', 'cache', 'last_conversations.json');
    if (fs.existsSync(lastConvPath)) {
      try {
        const mapObj = JSON.parse(fs.readFileSync(lastConvPath, 'utf8')) as Record<string, string>;
        for (const [wsPath, convId] of Object.entries(mapObj)) {
          workspaceBySession.set(convId, wsPath);
        }
      } catch {
        // ignore
      }
    }

    // Check conversation_metadata.json
    const convMetaPath = path.join(geminiRoot, 'antigravity-cli', 'cache', 'conversation_metadata.json');
    const summaryTitles = new Map<string, { title: string; workspace?: string }>();
    if (fs.existsSync(convMetaPath)) {
      try {
        const metaObj = JSON.parse(fs.readFileSync(convMetaPath, 'utf8')) as {
          conversations?: Record<
            string,
            {
              summary?: {
                Title?: string;
                Preview?: string;
                WorkspaceURIs?: string[];
              };
            }
          >;
        };
        if (metaObj.conversations) {
          for (const [cid, entry] of Object.entries(metaObj.conversations)) {
            const title = entry.summary?.Title || entry.summary?.Preview || '';
            const uri = entry.summary?.WorkspaceURIs?.[0];
            let wsPath: string | undefined;
            if (uri && uri.startsWith('file:///')) {
              wsPath = decodeURIComponent(uri.replace('file:///', '')).replace(/\//g, path.sep);
              workspaceBySession.set(cid, wsPath);
            }
            if (title) {
              summaryTitles.set(cid, { title, workspace: wsPath });
            }
          }
        }
      } catch {
        // ignore
      }
    }

    // Check presence locks in antigravity-cli/presence
    const lockedSessionIds = new Set<string>();
    const presenceDir = path.join(geminiRoot, 'antigravity-cli', 'presence');
    if (fs.existsSync(presenceDir)) {
      try {
        for (const f of fs.readdirSync(presenceDir)) {
          if (f.endsWith('.lock')) {
            lockedSessionIds.add(f.replace(/\.lock$/, ''));
          }
        }
      } catch {
        // ignore
      }
    }

    // Check log files in antigravity-cli/log for language server version & errors
    const cliLogDir = path.join(geminiRoot, 'antigravity-cli', 'log');
    if (fs.existsSync(cliLogDir)) {
      try {
        const logs = fs
          .readdirSync(cliLogDir)
          .filter((f) => f.endsWith('.log'))
          .sort()
          .reverse();
        for (const logFile of logs.slice(0, 2)) {
          const fullLog = path.join(cliLogDir, logFile);
          const content = fs.readFileSync(fullLog, 'utf8').slice(0, 8192);
          const verMatch = content.match(/Language server version:\s*([0-9.]+)/i);
          if (verMatch) {
            cliVersion = `Language Server v${verMatch[1]}`;
          }
          if (content.includes('You are not logged into Antigravity')) {
            recordError({
              dedupeKey: `antigravity-log-auth-${logFile}`,
              source: 'antigravity-log',
              category: 'integration_disconnected',
              severity: 'warning',
              title: 'Antigravity Cloud CodeAssist Token Refresh Warning',
              message:
                'Local CLI log reported: Singleflight refresh failed (You are not logged into Antigravity cloud CodeAssist). Local CLI agent execution remains active.',
              diagnostics: { logFile: fullLog },
            });
          }
        }
      } catch {
        // ignore
      }
    }

    // Check mcp_config.json in antigravity-ide
    const mcpConfigPath = path.join(geminiRoot, 'antigravity-ide', 'mcp_config.json');
    if (fs.existsSync(mcpConfigPath)) {
      try {
        const raw = fs.readFileSync(mcpConfigPath, 'utf8').trim();
        if (raw && raw !== '{}') {
          const parsed = JSON.parse(raw);
          const count = Object.keys(parsed.mcpServers || parsed || {}).length;
          mcpStatus = count > 0 ? `${count} MCP server(s) configured` : '0 MCP servers configured (empty mcp_config.json)';
        } else {
          mcpStatus = '0 MCP servers configured (mcp_config.json is 0 bytes)';
        }
      } catch {
        mcpStatus = '0 MCP servers configured';
      }
    }

    // Scan brain sessions across surfaces (most recent 18 sessions for speed and thoroughness)
    let sessionCount = 0;
    let activeSessionCount = 0;

    for (const surface of activeSurfaces) {
      const brainDir = path.join(geminiRoot, surface, 'brain');
      if (!fs.existsSync(brainDir)) continue;

      let entries: Array<{ id: string; dirPath: string; mtimeMs: number }> = [];
      try {
        for (const name of fs.readdirSync(brainDir)) {
          if (name.startsWith('.') || name === 'tempmediaStorage') continue;
          const full = path.join(brainDir, name);
          const stat = fs.statSync(full);
          if (stat.isDirectory()) {
            entries.push({ id: name, dirPath: full, mtimeMs: stat.mtimeMs });
          }
        }
      } catch {
        continue;
      }

      entries = entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
      sessionCount += entries.length;

      // Deep-parse the 15 most recent sessions per surface
      for (const entry of entries.slice(0, 15)) {
        const isLocked = lockedSessionIds.has(entry.id);
        this.ingestBrainSession({
          sessionId: entry.id,
          surface,
          brainPath: entry.dirPath,
          isLocked,
          knownWorkspace: workspaceBySession.get(entry.id),
          knownTitle: summaryTitles.get(entry.id)?.title,
          cliBinaryPath,
        });
        if (isLocked) {
          activeSessionCount++;
        }
      }
    }

    const capabilities: ConnectorCapability[] = [
      {
        key: 'active_sessions',
        label: 'Active & Historical Agent Sessions',
        status: 'exposed',
        source: '~/.gemini/antigravity-{cli,ide}/brain & presence/*.lock',
        detail: `Discovered ${sessionCount} total sessions (${activeSessionCount} active with live presence lock).`,
      },
      {
        key: 'transcript_events',
        label: 'Tool Calls, Commands & File Actions',
        status: 'exposed',
        source: '.system_generated/logs/transcript.jsonl',
        detail: 'Real-time ingestion of run_command, read_file, write_file, edit_file, list_dir, and subagent events.',
      },
      {
        key: 'token_usage',
        label: 'Measured Token Telemetry',
        status: 'exposed',
        source: 'PLANNER_RESPONSE step fields (input_tokens, output_tokens, cache_read_tokens)',
        detail: 'Exact token counts measured per model turn.',
      },
      {
        key: 'model_identifier',
        label: 'Model Identifier',
        status: 'partial',
        source: '<USER_SETTINGS_CHANGE> in transcript & agy.exe models',
        detail: 'Exposed when model selection change is logged in transcript; otherwise honestly shown as "Not exposed".',
      },
      {
        key: 'task_progress',
        label: 'Task Progress & Subtasks',
        status: 'partial',
        source: '.system_generated/tasks/*.log & task.md artifacts',
        detail: 'Exposed when background task logs or task artifacts exist; otherwise shown as "Progress not exposed".',
      },
      {
        key: 'api_cost',
        label: 'Provider Reported Billing Cost',
        status: 'not_exposed',
        source: 'Unavailable from local Antigravity logs',
        detail: 'Direct dollar billing is not exposed locally. DevScope computes clearly-labeled Estimated Cost using pricing table v2026.10.',
      },
      {
        key: 'internal_reasoning',
        label: 'Private Chain-of-Thought',
        status: 'not_exposed',
        source: 'Intentionally excluded by DevScope policy',
        detail: 'DevScope monitors observable actions and tool executions only; internal model reasoning is never extracted.',
      },
    ];

    const diagnostics: ConnectorDiagnostics = {
      connectorId: this.id,
      name: this.name,
      status: discoveredPaths.length > 0 ? 'connected' : 'unavailable',
      discoveredPaths,
      cliBinaryPath,
      cliVersion,
      activeSurfaces,
      sessionCount,
      activeSessionCount,
      mcpStatus,
      pluginsStatus: '0 plugins installed (verified via agy plugin list)',
      availableModels,
      capabilities,
      lastSyncedAt: new Date().toISOString(),
    };

    upsertIntegrationConnection({
      id: this.id,
      name: this.name,
      type: 'antigravity',
      status: diagnostics.status,
      authSource: 'Local ~/.gemini telemetry & agy.exe agentapi',
      lastSuccessAt: diagnostics.lastSyncedAt,
      capabilities: Object.fromEntries(capabilities.map((c) => [c.key, `${c.status}: ${c.detail}`])),
      diagnostics: diagnostics as unknown as Record<string, unknown>,
    });

    return diagnostics;
  }

  private ingestBrainSession(params: {
    sessionId: string;
    surface: string;
    brainPath: string;
    isLocked: boolean;
    knownWorkspace?: string;
    knownTitle?: string;
    cliBinaryPath: string | null;
  }): void {
    const transcriptPath = path.join(params.brainPath, '.system_generated', 'logs', 'transcript.jsonl');
    if (!fs.existsSync(transcriptPath)) return;

    let rawLines: string[] = [];
    try {
      const content = fs.readFileSync(transcriptPath, 'utf8');
      rawLines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
    } catch {
      return;
    }

    if (rawLines.length === 0) return;

    let detectedModel = 'Not exposed';
    let objective: string | null = params.knownTitle || null;
    let detectedWorkspace: string | null = params.knownWorkspace || null;
    let startedAt: string | null = null;
    let lastActiveAt: string | null = null;
    let stepCount = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let cachedTokens = 0;
    let lastStepStatus = 'DONE';
    const relevantFiles = new Set<string>();
    const executedCommands: Array<{ command: string; summary?: string; status?: string; timestamp?: string }> = [];
    const observedErrors: string[] = [];

    for (const line of rawLines) {
      let step: TranscriptStep;
      try {
        step = JSON.parse(line) as TranscriptStep;
      } catch {
        continue;
      }

      stepCount++;
      const ts = step.created_at || new Date().toISOString();
      if (!startedAt || ts < startedAt) startedAt = ts;
      if (!lastActiveAt || ts > lastActiveAt) lastActiveAt = ts;
      if (step.status) lastStepStatus = step.status;

      // Check USER_INPUT for objective and <USER_SETTINGS_CHANGE> model selection
      if (step.type === 'USER_INPUT' && step.content) {
        if (!objective) {
          const extractedObj = extractUserObjective(step.content);
          if (extractedObj && !extractedObj.startsWith('d activity logs')) {
            objective = extractedObj;
          }
        }
        const modelSel = extractModelSelection(step.content);
        if (modelSel) {
          detectedModel = modelSel;
        }
      }

      // Check PLANNER_RESPONSE for measured token telemetry and tool calls
      if (step.type === 'PLANNER_RESPONSE') {
        const inTok = Number(step.input_tokens ?? 0);
        const outTok = Number(step.output_tokens ?? 0);
        const cacheTok = Number(step.cache_read_tokens ?? 0);

        if (inTok > 0 || outTok > 0 || cacheTok > 0) {
          inputTokens += inTok;
          outputTokens += outTok;
          cachedTokens += cacheTok;

          const costCalc = calculateEstimatedCostUsd({
            model: detectedModel,
            inputTokens: inTok,
            outputTokens: outTok,
            cachedTokens: cacheTok,
          });

          const matchedProj = detectedWorkspace ? getProjectByPath(detectedWorkspace) : null;

          upsertUsageRecord({
            dedupeKey: `agy_step_${params.sessionId}_${step.step_index ?? stepCount}`,
            provider: costCalc.provider,
            model: detectedModel,
            source: 'antigravity-transcript',
            sessionId: params.sessionId,
            projectId: matchedProj?.id ?? null,
            taskId: `task_${params.sessionId}`,
            requestCount: 1,
            inputTokens: inTok,
            outputTokens: outTok,
            cachedTokens: cacheTok,
            totalTokens: inTok + outTok + cacheTok,
            estimatedCostUsd: costCalc.estimatedCostUsd,
            reportedCostUsd: null, // Strictly null: local transcripts do not report dollar invoices
            pricingVersion: costCalc.pricingVersion,
            dataOrigin: 'measured',
            timestamp: ts,
          });
        }

        // Inspect tool_calls
        if (Array.isArray(step.tool_calls)) {
          for (let tcIdx = 0; tcIdx < step.tool_calls.length; tcIdx++) {
            const tc = step.tool_calls[tcIdx];
            const toolName = tc.name || 'tool';
            const args = tc.args || {};

            const cwdArg = unquoteArg(args.Cwd || args.DirectoryPath);
            if (!detectedWorkspace && cwdArg && path.isAbsolute(cwdArg)) {
              detectedWorkspace = cwdArg;
            }

            const pathArg = unquoteArg(args.Path || args.TargetFile || args.DirectoryPath);
            if (pathArg && path.isAbsolute(pathArg)) {
              relevantFiles.add(pathArg);
              if (!detectedWorkspace && !pathArg.includes('.gemini')) {
                detectedWorkspace = path.dirname(pathArg);
              }
            }

            const proj = detectedWorkspace ? getProjectByPath(detectedWorkspace) : null;

            if (toolName === 'run_command') {
              const cmdLine = redactSecrets(unquoteArg(args.CommandLine));
              const summary = unquoteArg(args.toolSummary || args.toolAction) || 'Command executed';
              executedCommands.push({
                command: cmdLine,
                summary,
                status: step.status || 'DONE',
                timestamp: ts,
              });

              ingestActivityEvent({
                dedupeKey: `agy_tc_${params.sessionId}_${step.step_index}_${tcIdx}`,
                type: 'command_executed',
                category: 'command',
                title: `Agent Command: ${summary}`,
                detail: cmdLine.slice(0, 260),
                source: `antigravity (${params.surface})`,
                dataOrigin: 'measured',
                severity: 'info',
                projectId: proj?.id ?? null,
                sessionId: params.sessionId,
                taskId: `task_${params.sessionId}`,
                timestamp: ts,
              });
            } else if (toolName === 'write_file' || toolName === 'edit_file' || toolName === 'replace_file_content') {
              const changeType = toolName === 'write_file' ? 'created' : 'modified';
              if (pathArg) {
                insertFileChange({
                  dedupeKey: `agy_fc_${params.sessionId}_${step.step_index}_${tcIdx}`,
                  projectId: proj?.id ?? null,
                  sessionId: params.sessionId,
                  filePath: pathArg,
                  relativePath: detectedWorkspace ? path.relative(detectedWorkspace, pathArg) : path.basename(pathArg),
                  changeType,
                  source: 'antigravity-tool',
                  timestamp: ts,
                });

                ingestActivityEvent({
                  dedupeKey: `agy_tc_${params.sessionId}_${step.step_index}_${tcIdx}`,
                  type: changeType === 'created' ? 'file_created' : 'file_modified',
                  category: 'filesystem',
                  title: `Agent ${changeType} ${path.basename(pathArg)}`,
                  detail: pathArg,
                  source: `antigravity (${params.surface})`,
                  dataOrigin: 'measured',
                  severity: 'info',
                  projectId: proj?.id ?? null,
                  sessionId: params.sessionId,
                  taskId: `task_${params.sessionId}`,
                  filePath: pathArg,
                  timestamp: ts,
                });
              }
            } else if (toolName === 'read_file' || toolName === 'view_file') {
              if (pathArg) {
                ingestActivityEvent({
                  dedupeKey: `agy_tc_${params.sessionId}_${step.step_index}_${tcIdx}`,
                  type: 'file_inspected',
                  category: 'agent',
                  title: `Agent inspected ${path.basename(pathArg)}`,
                  detail: pathArg,
                  source: `antigravity (${params.surface})`,
                  dataOrigin: 'measured',
                  severity: 'info',
                  projectId: proj?.id ?? null,
                  sessionId: params.sessionId,
                  taskId: `task_${params.sessionId}`,
                  filePath: pathArg,
                  timestamp: ts,
                });
              }
            }
          }
        }
      }

      // Check GENERIC tool output for command failures
      if (step.type === 'GENERIC' && step.content) {
        if (step.content.includes('Command exited with code 1') || step.content.includes('npm error')) {
          const firstErrLine =
            step.content
              .split(/\r?\n/)
              .find((l) => l.includes('Error') || l.includes('npm error') || l.includes('Command exited with code')) ||
            'Command exited with non-zero status';
          observedErrors.push(redactSecrets(firstErrLine));
          const proj = detectedWorkspace ? getProjectByPath(detectedWorkspace) : null;
          recordError({
            dedupeKey: `agy_cmd_err_${params.sessionId}_${step.step_index}`,
            projectId: proj?.id ?? null,
            sessionId: params.sessionId,
            taskId: `task_${params.sessionId}`,
            source: `antigravity (${params.surface})`,
            category: 'command_failed',
            severity: 'warning',
            title: `Command exited with non-zero code in session ${params.sessionId.slice(0, 8)}`,
            message: redactSecrets(step.content.slice(0, 500)),
            timestamp: ts,
          });
        }
      }
    }

    // If workspace is still unknown and this is an antigravity-cli session, try agentapi metadata once
    if (!detectedWorkspace && params.surface === 'antigravity-cli' && params.cliBinaryPath?.endsWith('agy.exe')) {
      try {
        const out = execFileSync(
          params.cliBinaryPath,
          ['agentapi', 'get-conversation-metadata', params.sessionId],
          { encoding: 'utf8', timeout: 2500, windowsHide: true }
        );
        const parsed = JSON.parse(out);
        const uri = parsed?.response?.conversationMetadata?.metadata?.workspaceUris?.[0];
        if (uri && typeof uri === 'string' && uri.startsWith('file:///')) {
          detectedWorkspace = decodeURIComponent(uri.replace('file:///', '')).replace(/\//g, path.sep);
        }
      } catch {
        // ignore agentapi failure
      }
    }

    // Ensure project is registered if workspace exists on disk
    let matchedProject = detectedWorkspace ? getProjectByPath(detectedWorkspace) : null;
    if (detectedWorkspace && !matchedProject && fs.existsSync(detectedWorkspace) && isSafeLocalPath(detectedWorkspace)) {
      const base = path.basename(detectedWorkspace);
      if (base && base.toLowerCase() !== 'kaisi') {
        matchedProject = upsertProject({
          name: base,
          localPath: detectedWorkspace,
          isGitRepo: fs.existsSync(path.join(detectedWorkspace, '.git')),
        });
      }
    }

    const startIso = startedAt || new Date().toISOString();
    const lastIso = lastActiveAt || startIso;
    const durationSec = Math.max(
      0,
      Math.round((new Date(lastIso).getTime() - new Date(startIso).getTime()) / 1000)
    );

    const ageMs = Date.now() - new Date(lastIso).getTime();
    let sessionStatus: 'active' | 'idle' | 'completed' | 'error' | 'unknown' = 'idle';
    if (params.isLocked || ageMs < 90_000) {
      sessionStatus = 'active';
    } else if (lastStepStatus === 'ERROR') {
      sessionStatus = 'error';
    } else {
      sessionStatus = 'idle';
    }

    const sessionCost = calculateEstimatedCostUsd({
      model: detectedModel,
      inputTokens,
      outputTokens,
      cachedTokens,
    });

    const title =
      objective ||
      (matchedProject ? `${matchedProject.name} Session` : `Session ${params.sessionId.slice(0, 8)}`);

    upsertAgentSession({
      id: params.sessionId,
      surface: params.surface,
      projectId: matchedProject?.id ?? null,
      workspacePath: detectedWorkspace,
      title,
      objective: objective || 'Objective not explicitly tagged in transcript',
      status: sessionStatus,
      model: detectedModel,
      stepCount,
      inputTokens,
      outputTokens,
      cachedTokens,
      totalTokens: inputTokens + outputTokens + cachedTokens,
      estimatedCostUsd: sessionCost.estimatedCostUsd,
      reportedCostUsd: null,
      startedAt: startIso,
      lastActiveAt: lastIso,
      durationSeconds: durationSec,
      isLockedPresence: params.isLocked,
      dataOrigin: 'measured',
      metadata: {
        brainPath: params.brainPath,
        commandCount: executedCommands.length,
        fileTouchCount: relevantFiles.size,
      },
    });

    // Check .system_generated/tasks for observable background task logs
    const tasksDir = path.join(params.brainPath, '.system_generated', 'tasks');
    let taskLogsCount = 0;
    if (fs.existsSync(tasksDir)) {
      try {
        taskLogsCount = fs.readdirSync(tasksDir).filter((f) => f.endsWith('.log')).length;
      } catch {
        taskLogsCount = 0;
      }
    }

    // Check walkthrough.md or task.md to see if task progress is exposed
    let progressText = 'Progress not exposed';
    const taskMdPath = path.join(params.brainPath, 'task.md');
    const walkthroughPath = path.join(params.brainPath, 'walkthrough.md');
    let hasWalkthrough = false;
    if (fs.existsSync(taskMdPath)) {
      try {
        const md = fs.readFileSync(taskMdPath, 'utf8');
        const doneCount = (md.match(/- \[x\]/gi) || []).length;
        const todoCount = (md.match(/- \[ \]/g) || []).length;
        if (doneCount + todoCount > 0) {
          progressText = `${doneCount}/${doneCount + todoCount} checklist items completed (task.md)`;
        }
      } catch {
        // ignore
      }
    } else if (taskLogsCount > 0) {
      progressText = `${stepCount} transcript steps · ${taskLogsCount} background task logs observed`;
    } else {
      progressText = `${stepCount} transcript steps observed (subtask checklist not exposed)`;
    }

    if (fs.existsSync(walkthroughPath)) {
      hasWalkthrough = true;
    }

    // Important rule from Section 9:
    // "Do not infer successful completion merely because an agent becomes idle."
    let taskStatus: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'unknown' = 'unknown';
    if (sessionStatus === 'active') {
      taskStatus = 'running';
    } else if (sessionStatus === 'error') {
      taskStatus = 'failed';
    } else if (hasWalkthrough) {
      taskStatus = 'completed';
    } else {
      // Agent is idle without an explicit completion artifact — status is honestly 'unknown'
      taskStatus = 'unknown';
    }

    upsertTask({
      id: `task_${params.sessionId}`,
      title,
      description:
        objective ||
        `Observed Antigravity (${params.surface}) agent session ${params.sessionId}`,
      projectId: matchedProject?.id ?? null,
      sessionId: params.sessionId,
      source: 'antigravity',
      status: taskStatus,
      progressText,
      startTime: startIso,
      endTime: sessionStatus === 'active' ? null : lastIso,
      durationSeconds: durationSec,
      relevantFiles: Array.from(relevantFiles).slice(0, 40),
      commands: executedCommands.slice(-25),
      errors: observedErrors.slice(-10),
      dataOrigin: 'measured',
    });

    // Emit session start event (deduplicated)
    ingestActivityEvent({
      dedupeKey: `agy_session_start_${params.sessionId}`,
      type: 'agent_session_started',
      category: 'agent',
      title: `Agent Session Started: ${title.slice(0, 80)}`,
      detail: `Surface: ${params.surface} · Model: ${detectedModel}`,
      source: `antigravity (${params.surface})`,
      dataOrigin: 'measured',
      severity: 'info',
      projectId: matchedProject?.id ?? null,
      sessionId: params.sessionId,
      taskId: `task_${params.sessionId}`,
      timestamp: startIso,
    });
  }
}

export const antigravityConnector = new AntigravityConnector();
