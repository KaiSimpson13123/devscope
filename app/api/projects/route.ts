import fs from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import {
  getProjects,
  getProjectById,
  upsertProject,
  getRepositories,
  getAgentSessions,
  getProcessObservations,
  getActivityEvents,
  getUsageRecords,
} from '@/lib/db';
import { monitoringEngine } from '@/lib/monitoring';
import {
  isLocalhostOrigin,
  isSafeLocalPath,
  ProjectRegistrationSchema,
  ProjectUpdateSchema,
} from '@/lib/security';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!isLocalhostOrigin(request.headers.get('host'))) {
    return NextResponse.json({ error: 'Localhost access only' }, { status: 403 });
  }

  await monitoringEngine.ensureStarted();
  const { searchParams } = new URL(request.url);
  const includeExcluded = searchParams.get('includeExcluded') === 'true';

  const projects = getProjects({ includeExcluded });
  const repositories = getRepositories();
  const sessions = getAgentSessions({ limit: 100 });
  const processes = getProcessObservations();
  const usageRecords = getUsageRecords();

  const enriched = projects.map((proj) => {
    const repo = repositories.find(
      (r) => r.projectId === proj.id || r.localPath.toLowerCase() === proj.localPath.toLowerCase()
    );
    const projSessions = sessions.filter((s) => s.projectId === proj.id);
    const projProcesses = processes.filter((p) => p.projectId === proj.id);
    const projUsage = usageRecords.filter((u) => u.projectId === proj.id);
    const totalTokens = projUsage.reduce((acc, u) => acc + u.totalTokens, 0);
    const estimatedCost = projUsage.reduce((acc, u) => acc + (u.estimatedCostUsd ?? 0), 0);
    const recentEvents = getActivityEvents({ projectId: proj.id, limit: 15 });

    return {
      ...proj,
      repository: repo ?? null,
      activeSessionsCount: projSessions.filter((s) => s.status === 'active').length,
      sessionsCount: projSessions.length,
      runningProcessesCount: projProcesses.length,
      processes: projProcesses,
      totalTokens,
      estimatedCostUsd: projUsage.some((u) => u.estimatedCostUsd !== null)
        ? Number(estimatedCost.toFixed(4))
        : null,
      recentCommits: repo?.recentCommits?.slice(0, 5) ?? [],
      recentEvents,
    };
  });

  return NextResponse.json({ projects: enriched });
}

export async function POST(request: Request) {
  if (!isLocalhostOrigin(request.headers.get('host'))) {
    return NextResponse.json({ error: 'Localhost access only' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = ProjectRegistrationSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid project registration input', issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const resolvedPath = path.resolve(parsed.data.localPath);
    if (!isSafeLocalPath(resolvedPath)) {
      return NextResponse.json(
        { error: 'Path is restricted by local security policy' },
        { status: 400 }
      );
    }

    const exists = fs.existsSync(resolvedPath);
    const isGitRepo = exists && fs.existsSync(path.join(resolvedPath, '.git'));

    const project = upsertProject({
      name: parsed.data.name,
      localPath: resolvedPath,
      githubRepo: parsed.data.githubRepo ?? null,
      monitoringHealth: exists ? 'healthy' : 'missing_workspace',
      isGitRepo,
    });

    await monitoringEngine.runFullSync({ forceRemote: false });
    return NextResponse.json({ ok: true, project }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to register project' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  if (!isLocalhostOrigin(request.headers.get('host'))) {
    return NextResponse.json({ error: 'Localhost access only' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = ProjectUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid project update payload', issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const existing = getProjectById(parsed.data.id);
    if (!existing) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const updated = upsertProject({
      id: existing.id,
      name: parsed.data.name ?? existing.name,
      localPath: existing.localPath,
      excluded: parsed.data.excluded ?? existing.excluded,
      pinned: parsed.data.pinned ?? existing.pinned,
      githubRepo: parsed.data.githubRepo !== undefined ? parsed.data.githubRepo : existing.githubRepo,
    });

    return NextResponse.json({ ok: true, project: updated });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update project' },
      { status: 500 }
    );
  }
}
