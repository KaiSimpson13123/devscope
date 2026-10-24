import { NextResponse } from 'next/server';
import {
  getAgentSessions,
  getAgentSessionById,
  getActivityEvents,
  getTasks,
  getFileChanges,
  getUsageRecords,
} from '@/lib/db';
import { antigravityConnector } from '@/lib/connectors';
import { isLocalhostOrigin } from '@/lib/security';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!isLocalhostOrigin(request.headers.get('host'))) {
    return NextResponse.json({ error: 'Localhost access only' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('sessionId');

  const diagnostics = await antigravityConnector.discoverAndSync();

  if (sessionId) {
    const session = getAgentSessionById(sessionId);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    const events = getActivityEvents({ sessionId, limit: 200 });
    const tasks = getTasks({ sessionId });
    const fileChanges = getFileChanges({ sessionId, limit: 100 });
    const usage = getUsageRecords({ sessionId });
    return NextResponse.json({
      diagnostics,
      session,
      events,
      tasks,
      fileChanges,
      usage,
    });
  }

  const sessions = getAgentSessions({ limit: 50 });
  const recentAgentEvents = getActivityEvents({ limit: 80 }).filter(
    (e) => e.source.startsWith('antigravity') || e.category === 'agent' || e.category === 'command'
  );

  return NextResponse.json({
    diagnostics,
    sessions,
    recentAgentEvents,
  });
}

export async function POST(request: Request) {
  if (!isLocalhostOrigin(request.headers.get('host'))) {
    return NextResponse.json({ error: 'Localhost access only' }, { status: 403 });
  }

  const diagnostics = await antigravityConnector.discoverAndSync();
  const sessions = getAgentSessions({ limit: 50 });
  return NextResponse.json({ ok: true, diagnostics, sessions });
}
