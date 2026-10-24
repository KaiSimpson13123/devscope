import { NextResponse } from 'next/server';
import { getProjects } from '@/lib/db';
import {
  scanDevelopmentProcesses,
  terminateProcessSafely,
  getSystemPerformanceOverview,
} from '@/lib/processes';
import { isLocalhostOrigin, ProcessTerminateSchema } from '@/lib/security';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!isLocalhostOrigin(request.headers.get('host'))) {
    return NextResponse.json({ error: 'Localhost access only' }, { status: 403 });
  }

  const processes = scanDevelopmentProcesses();
  const performance = getSystemPerformanceOverview();
  const projects = getProjects({ includeExcluded: true });

  return NextResponse.json({
    processes,
    performance,
    projects,
  });
}

export async function POST(request: Request) {
  if (!isLocalhostOrigin(request.headers.get('host'))) {
    return NextResponse.json({ error: 'Localhost access only' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = ProcessTerminateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Explicit confirmation PID required', issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const result = terminateProcessSafely(parsed.data);
    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: 400 });
    }

    const processes = scanDevelopmentProcesses();
    return NextResponse.json({ ok: true, message: result.message, processes });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Process action failed' },
      { status: 500 }
    );
  }
}
