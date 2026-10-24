import { NextResponse } from 'next/server';
import { getActivityEvents, getFileChanges } from '@/lib/db';
import { monitoringEngine } from '@/lib/monitoring';
import { isLocalhostOrigin, MonitoringControlSchema } from '@/lib/security';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!isLocalhostOrigin(request.headers.get('host'))) {
    return NextResponse.json({ error: 'Localhost access only' }, { status: 403 });
  }

  await monitoringEngine.ensureStarted();
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('projectId') || undefined;
  const sessionId = searchParams.get('sessionId') || undefined;
  const taskId = searchParams.get('taskId') || undefined;
  const category = searchParams.get('category') || undefined;
  const severity = searchParams.get('severity') || undefined;
  const search = searchParams.get('search') || undefined;
  const limit = Number(searchParams.get('limit') || 150);

  const events = getActivityEvents({
    projectId,
    sessionId,
    taskId,
    category,
    severity,
    search,
    limit,
  });

  const fileChanges = getFileChanges({ projectId, sessionId, limit: 60 });

  return NextResponse.json({
    monitoring: monitoringEngine.getStatus(),
    events,
    fileChanges,
  });
}

export async function POST(request: Request) {
  if (!isLocalhostOrigin(request.headers.get('host'))) {
    return NextResponse.json({ error: 'Localhost access only' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = MonitoringControlSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid monitoring control payload', issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const { action, scopePaths } = parsed.data;
    if (action === 'pause') {
      const status = await monitoringEngine.pause();
      return NextResponse.json({ ok: true, status });
    }
    if (action === 'resume') {
      const status = await monitoringEngine.resume();
      return NextResponse.json({ ok: true, status });
    }
    if (action === 'refresh') {
      await monitoringEngine.runFullSync({ forceRemote: false });
      return NextResponse.json({ ok: true, status: monitoringEngine.getStatus() });
    }
    if (action === 'set_scope' && scopePaths) {
      const status = await monitoringEngine.updateScope(scopePaths);
      return NextResponse.json({ ok: true, status });
    }

    return NextResponse.json({ ok: true, status: monitoringEngine.getStatus() });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to execute monitoring control' },
      { status: 500 }
    );
  }
}
