import { NextResponse } from 'next/server';
import {
  getProjects,
  getRepositories,
  getAgentSessions,
  getTasks,
  getActivityEvents,
  getProcessObservations,
  getErrors,
  getNotifications,
  getIntegrationConnections,
  getDatabasePath,
} from '@/lib/db';
import { monitoringEngine } from '@/lib/monitoring';
import { getUsageSummary } from '@/lib/usage';
import { getSystemPerformanceOverview } from '@/lib/processes';
import { isLocalhostOrigin } from '@/lib/security';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!isLocalhostOrigin(request.headers.get('host'))) {
    return NextResponse.json({ error: 'Localhost access only' }, { status: 403 });
  }

  const monitoring = await monitoringEngine.ensureStarted();
  const projects = getProjects({ includeExcluded: false });
  const repositories = getRepositories();
  const sessions = getAgentSessions({ limit: 25 });
  const tasks = getTasks();
  const recentEvents = getActivityEvents({ limit: 40 });
  const processes = getProcessObservations();
  const openErrors = getErrors({ status: 'open' });
  const notifications = getNotifications(25);
  const integrations = getIntegrationConnections();
  const usage = getUsageSummary({ range: '30d' });
  const performance = getSystemPerformanceOverview();

  return NextResponse.json({
    monitoring,
    databasePath: getDatabasePath(),
    projects,
    repositories,
    sessions,
    tasks: tasks.slice(0, 25),
    recentEvents,
    processes,
    openErrorsCount: openErrors.length,
    openErrors: openErrors.slice(0, 10),
    notifications,
    integrations,
    usage,
    performance,
    timestamp: new Date().toISOString(),
  });
}
