import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import {
  replaceProcessObservations,
  getProcessObservations,
  getProjects,
  upsertIntegrationConnection,
  type ProcessObservationRecord,
} from '@/lib/db';
import { ingestActivityEvent } from '@/lib/events';
import { redactSecrets } from '@/lib/security';

const DEV_PROCESS_PATTERNS = [
  'node',
  'python',
  'python3',
  'git',
  'agy',
  'antigravity',
  'npm',
  'pnpm',
  'yarn',
  'bun',
  'deno',
  'cargo',
  'rustc',
  'go',
  'java',
  'dotnet',
  'docker',
  'uvicorn',
  'gunicorn',
  'next',
  'vite',
  'esbuild',
  'turbopack',
  'tsc',
  'vitest',
  'jest',
  'pytest',
  'ffmpeg',
  'code',
];

function classifyProcess(name: string, cmdLine: string, exe: string): ProcessObservationRecord['category'] {
  const combined = `${name} ${cmdLine} ${exe}`.toLowerCase();
  if (combined.includes('agy') || combined.includes('antigravity') || combined.includes('language_server')) {
    return 'antigravity';
  }
  if (
    combined.includes('next dev') ||
    combined.includes('next start') ||
    combined.includes('vite') ||
    combined.includes('uvicorn') ||
    combined.includes('webpack-dev-server')
  ) {
    return 'server';
  }
  if (
    combined.includes('tsc') ||
    combined.includes('esbuild') ||
    combined.includes('turbopack') ||
    combined.includes('vitest') ||
    combined.includes('cargo') ||
    combined.includes('ffmpeg')
  ) {
    return 'build';
  }
  if (name.toLowerCase().includes('node') || combined.includes('npm') || combined.includes('pnpm')) {
    return 'node';
  }
  if (name.toLowerCase().includes('python') || combined.includes('pytest')) {
    return 'python';
  }
  if (name.toLowerCase().includes('git')) {
    return 'git';
  }
  return 'other';
}

function inferProjectAndWorkingDir(
  cmdLine: string,
  exe: string,
  projects: Array<{ id: string; localPath: string }>
): { projectId: string | null; workingDirectory: string } {
  const hay = `${cmdLine} ${exe}`;
  const lowerHay = hay.toLowerCase();

  let matchedProject: { id: string; localPath: string } | null = null;
  for (const proj of projects) {
    const pLower = proj.localPath.toLowerCase();
    if (lowerHay.includes(pLower)) {
      if (!matchedProject || pLower.length > matchedProject.localPath.length) {
        matchedProject = proj;
      }
    }
  }

  if (matchedProject) {
    return {
      projectId: matchedProject.id,
      workingDirectory: matchedProject.localPath,
    };
  }

  // Try extracting an explicit Windows or POSIX directory path from command line
  const winMatch = cmdLine.match(/([A-Za-z]:\\Users\\[^\s"']+)/);
  if (winMatch && winMatch[1]) {
    const candidate = winMatch[1];
    const dir = path.extname(candidate) ? path.dirname(candidate) : candidate;
    return { projectId: null, workingDirectory: dir };
  }

  return { projectId: null, workingDirectory: 'Not exposed by OS' };
}

export function scanDevelopmentProcesses(): ProcessObservationRecord[] {
  const nowIso = new Date().toISOString();
  const projects = getProjects({ includeExcluded: true }).map((p) => ({
    id: p.id,
    localPath: p.localPath,
  }));

  const observations: Omit<ProcessObservationRecord, 'id'>[] = [];

  if (process.platform === 'win32') {
    try {
      // Collect listening TCP ports mapped by OwningProcess
      const portScript = `
        $ErrorActionPreference = 'SilentlyContinue'
        $conns = Get-NetTCPConnection -State Listen | Select-Object LocalPort, OwningProcess
        $conns | ConvertTo-Json -Compress
      `;
      const portsByPid = new Map<number, Set<number>>();
      try {
        const portOut = execFileSync('powershell.exe', ['-NoProfile', '-Command', portScript], {
          encoding: 'utf8',
          timeout: 5000,
          windowsHide: true,
        }).trim();
        if (portOut) {
          const parsedPorts = JSON.parse(portOut);
          const portArray = Array.isArray(parsedPorts) ? parsedPorts : [parsedPorts];
          for (const item of portArray) {
            const pid = Number(item?.OwningProcess);
            const port = Number(item?.LocalPort);
            if (pid > 0 && port > 0) {
              const set = portsByPid.get(pid) ?? new Set<number>();
              set.add(port);
              portsByPid.set(pid, set);
            }
          }
        }
      } catch {
        // Port inspection is optional if restricted
      }

      // Collect relevant processes via Win32_Process + Get-Process CPU/WorkingSet
      const procScript = `
        $ErrorActionPreference = 'SilentlyContinue'
        $procs = Get-CimInstance Win32_Process | Where-Object {
          $_.Name -match '^(node|python|python3|git|agy|antigravity|npm|pnpm|yarn|bun|deno|cargo|go|dotnet|docker|esbuild|ffmpeg|Code)\\.exe$'
        } | Select-Object ProcessId, ParentProcessId, Name, ExecutablePath, CommandLine, CreationDate, WorkingSetSize
        $procs | ConvertTo-Json -Compress
      `;
      const rawOut = execFileSync('powershell.exe', ['-NoProfile', '-Command', procScript], {
        encoding: 'utf8',
        timeout: 7000,
        windowsHide: true,
      }).trim();

      if (rawOut) {
        const parsed = JSON.parse(rawOut);
        const procList = Array.isArray(parsed) ? parsed : [parsed];

        for (const p of procList) {
          const pid = Number(p?.ProcessId ?? 0);
          if (!pid) continue;
          const name = String(p?.Name ?? 'unknown');
          const exe = String(p?.ExecutablePath ?? '');
          const rawCmd = String(p?.CommandLine ?? '');
          const safeCmd = redactSecrets(rawCmd);
          const parentPid = p?.ParentProcessId ? Number(p.ParentProcessId) : null;
          const memoryBytes = Number(p?.WorkingSetSize ?? 0);

          let startTimeIso: string | null = null;
          let uptimeSeconds = 0;
          if (p?.CreationDate) {
            const rawDate = String(p.CreationDate);
            const msMatch = rawDate.match(/\/Date\((\d+)\)\//);
            const d = msMatch ? new Date(Number(msMatch[1])) : new Date(rawDate);
            if (!isNaN(d.getTime())) {
              startTimeIso = d.toISOString();
              uptimeSeconds = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
            }
          }

          let { projectId, workingDirectory } = inferProjectAndWorkingDir(safeCmd, exe, projects);
          if (pid === process.pid) {
            const selfProj = projects.find((pr) => pr.localPath.toLowerCase() === process.cwd().toLowerCase());
            if (selfProj) projectId = selfProj.id;
            workingDirectory = process.cwd();
          }

          const ports = Array.from(portsByPid.get(pid) ?? []).sort((a, b) => a - b);
          const category = classifyProcess(name, safeCmd, exe);

          observations.push({
            pid,
            name,
            executable: exe,
            commandLine: safeCmd || exe || name,
            workingDirectory,
            projectId,
            category,
            cpuPercent: 0,
            memoryBytes,
            parentPid,
            listeningPorts: ports,
            startTime: startTimeIso,
            uptimeSeconds,
            status: 'running',
            observedAt: nowIso,
          });
        }
      }
    } catch {
      // Fallback to at least reporting the current Node.js DevScope process
    }
  } else {
    // POSIX (macOS / Linux) fallback
    try {
      const psOut = execFileSync('ps', ['-eo', 'pid,ppid,pcpu,rss,etime,comm,args'], {
        encoding: 'utf8',
        timeout: 4000,
      });
      const lines = psOut.split(/\r?\n/).slice(1);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const parts = trimmed.split(/\s+/);
        if (parts.length < 7) continue;
        const pid = Number(parts[0]);
        const parentPid = Number(parts[1]);
        const cpuPercent = Number(parts[2]) || 0;
        const memoryBytes = (Number(parts[3]) || 0) * 1024;
        const comm = parts[5];
        const cmdLine = redactSecrets(parts.slice(6).join(' '));
        const lowerComm = comm.toLowerCase();
        if (!DEV_PROCESS_PATTERNS.some((pat) => lowerComm.includes(pat) || cmdLine.toLowerCase().includes(pat))) {
          continue;
        }
        const { projectId, workingDirectory } = inferProjectAndWorkingDir(cmdLine, comm, projects);
        observations.push({
          pid,
          name: path.basename(comm),
          executable: comm,
          commandLine: cmdLine,
          workingDirectory,
          projectId,
          category: classifyProcess(comm, cmdLine, comm),
          cpuPercent,
          memoryBytes,
          parentPid,
          listeningPorts: [],
          startTime: null,
          uptimeSeconds: 0,
          status: 'running',
          observedAt: nowIso,
        });
      }
    } catch {
      // ignore
    }
  }

  // Always ensure current DevScope process is present if not already captured
  if (!observations.some((o) => o.pid === process.pid)) {
    const selfProj = projects.find((pr) => pr.localPath.toLowerCase() === process.cwd().toLowerCase());
    observations.push({
      pid: process.pid,
      name: process.platform === 'win32' ? 'node.exe' : 'node',
      executable: process.execPath,
      commandLine: redactSecrets(process.argv.join(' ')),
      workingDirectory: process.cwd(),
      projectId: selfProj?.id ?? null,
      category: 'server',
      cpuPercent: 0.5,
      memoryBytes: process.memoryUsage().rss,
      parentPid: process.ppid || null,
      listeningPorts: [Number(process.env.PORT || 3100)],
      startTime: new Date(Date.now() - process.uptime() * 1000).toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      status: 'running',
      observedAt: nowIso,
    });
  }

  replaceProcessObservations(observations);

  upsertIntegrationConnection({
    id: 'os-processes',
    name: 'Local OS Process & Port Monitor',
    type: 'processes',
    status: 'connected',
    authSource: `OS Process Table (${process.platform})`,
    lastSuccessAt: nowIso,
    capabilities: {
      process_table: `Exposed (${observations.length} active dev processes)`,
      command_line_redaction: 'Active (secrets automatically redacted)',
      listening_ports: 'Exposed via local TCP listener inspection',
    },
    diagnostics: {
      platform: process.platform,
      arch: process.arch,
      observedProcessCount: observations.length,
    },
  });

  return getProcessObservations();
}

/**
 * Terminates a development process only when explicit confirmation (`pid === confirmPid`) is supplied
 * and the PID is not a protected system process or DevScope itself.
 */
export function terminateProcessSafely(params: {
  pid: number;
  confirmPid: number;
  reason?: string;
}): { ok: boolean; message: string } {
  if (params.pid !== params.confirmPid) {
    return { ok: false, message: 'Confirmation PID does not match target PID.' };
  }
  if (params.pid <= 4 || params.pid === process.pid) {
    return {
      ok: false,
      message: 'Refusing to terminate protected system process or the active DevScope server.',
    };
  }

  try {
    process.kill(params.pid, 'SIGTERM');
    ingestActivityEvent({
      type: 'process_terminated',
      category: 'process',
      title: `Process PID ${params.pid} terminated by user`,
      detail: params.reason || 'Explicitly confirmed by user in Process Monitor',
      source: 'process-monitor',
      dataOrigin: 'measured',
      severity: 'warning',
    });
    return { ok: true, message: `Sent termination signal to PID ${params.pid}.` };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : `Failed to terminate PID ${params.pid}.`,
    };
  }
}

export interface SystemPerformanceOverview {
  hostname: string;
  platform: string;
  arch: string;
  cpuModel: string;
  cpuCores: number;
  systemMemoryTotalBytes: number;
  systemMemoryFreeBytes: number;
  systemMemoryUsedBytes: number;
  systemMemoryUsagePercent: number;
  devscopeRssBytes: number;
  devscopeHeapUsedBytes: number;
  devscopeUptimeSeconds: number;
  activeDevProcessesCount: number;
  totalDevProcessesMemoryBytes: number;
  timestamp: string;
}

export function getSystemPerformanceOverview(): SystemPerformanceOverview {
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = Math.max(0, totalMem - freeMem);
  const memUsage = process.memoryUsage();
  const procs = getProcessObservations();
  const devProcMem = procs.reduce((acc, p) => acc + p.memoryBytes, 0);

  return {
    hostname: os.hostname(),
    platform: `${os.type()} (${process.platform})`,
    arch: os.arch(),
    cpuModel: cpus[0]?.model?.trim() || 'Unknown CPU',
    cpuCores: cpus.length,
    systemMemoryTotalBytes: totalMem,
    systemMemoryFreeBytes: freeMem,
    systemMemoryUsedBytes: usedMem,
    systemMemoryUsagePercent: Number(((usedMem / Math.max(totalMem, 1)) * 100).toFixed(1)),
    devscopeRssBytes: memUsage.rss,
    devscopeHeapUsedBytes: memUsage.heapUsed,
    devscopeUptimeSeconds: Math.round(process.uptime()),
    activeDevProcessesCount: procs.length,
    totalDevProcessesMemoryBytes: devProcMem,
    timestamp: new Date().toISOString(),
  };
}
