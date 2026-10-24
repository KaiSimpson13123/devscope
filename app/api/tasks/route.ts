import { NextResponse } from 'next/server';
import {
  getTasks,
  getTaskById,
  upsertTask,
  getActivityEvents,
  getUsageRecords,
  getProjects,
  stableId,
} from '@/lib/db';
import { ingestActivityEvent } from '@/lib/events';
import { isLocalhostOrigin, ManualTaskSchema, TaskUpdateSchema } from '@/lib/security';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!isLocalhostOrigin(request.headers.get('host'))) {
    return NextResponse.json({ error: 'Localhost access only' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const taskId = searchParams.get('taskId');
  const projectId = searchParams.get('projectId') || undefined;
  const status = searchParams.get('status') || undefined;
  const source = searchParams.get('source') || undefined;

  if (taskId) {
    const task = getTaskById(taskId);
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }
    const events = getActivityEvents({
      taskId: task.id,
      sessionId: task.sessionId ?? undefined,
      limit: 200,
    });
    const usage = task.sessionId ? getUsageRecords({ sessionId: task.sessionId }) : [];
    return NextResponse.json({ task, events, usage });
  }

  const tasks = getTasks({ projectId, status, source });
  const projects = getProjects({ includeExcluded: true });
  return NextResponse.json({ tasks, projects });
}

export async function POST(request: Request) {
  if (!isLocalhostOrigin(request.headers.get('host'))) {
    return NextResponse.json({ error: 'Localhost access only' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = ManualTaskSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid manual task input', issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const id = stableId('task_manual', `${parsed.data.title}_${now}`);
    const task = upsertTask({
      id,
      title: parsed.data.title,
      description: parsed.data.description,
      projectId: parsed.data.projectId ?? null,
      source: 'manual',
      status: parsed.data.status,
      progressText: 'Manually tracked task',
      startTime: now,
      endTime: parsed.data.status === 'completed' ? now : null,
      durationSeconds: 0,
      relevantFiles: parsed.data.relevantFiles,
      dataOrigin: 'measured',
    });

    ingestActivityEvent({
      type: 'task_started',
      category: 'task',
      title: `Manual Task Created: ${task.title}`,
      detail: task.description,
      source: 'manual-task-tracker',
      dataOrigin: 'measured',
      severity: 'info',
      projectId: task.projectId,
      taskId: task.id,
    });

    return NextResponse.json({ ok: true, task }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create task' },
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
    const parsed = TaskUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid task update input', issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const existing = getTaskById(parsed.data.id);
    if (!existing) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const now = new Date().toISOString();
    const newStatus = parsed.data.status ?? existing.status;
    const isFinished = newStatus === 'completed' || newStatus === 'failed' || newStatus === 'cancelled';
    const endTime = isFinished ? existing.endTime || now : null;
    const durationSeconds = endTime
      ? Math.max(0, Math.round((new Date(endTime).getTime() - new Date(existing.startTime).getTime()) / 1000))
      : existing.durationSeconds;

    const updated = upsertTask({
      ...existing,
      title: parsed.data.title ?? existing.title,
      description: parsed.data.description ?? existing.description,
      status: newStatus,
      endTime,
      durationSeconds,
    });

    ingestActivityEvent({
      type: newStatus === 'completed' ? 'task_completed' : newStatus === 'failed' ? 'task_failed' : 'task_updated',
      category: 'task',
      title: `Task ${updated.title} marked as ${newStatus}`,
      source: 'task-tracker',
      dataOrigin: 'measured',
      severity: newStatus === 'failed' ? 'error' : 'info',
      projectId: updated.projectId,
      taskId: updated.id,
    });

    return NextResponse.json({ ok: true, task: updated });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update task' },
      { status: 500 }
    );
  }
}
