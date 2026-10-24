import { NextResponse } from 'next/server';
import {
  getAllSettings,
  setSetting,
  getIntegrationConnections,
  getDatabasePath,
  applyDataRetention,
  clearMonitoringHistory,
} from '@/lib/db';
import { monitoringEngine } from '@/lib/monitoring';
import { isLocalhostOrigin } from '@/lib/security';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!isLocalhostOrigin(request.headers.get('host'))) {
    return NextResponse.json({ error: 'Localhost access only' }, { status: 403 });
  }

  return NextResponse.json({
    settings: getAllSettings(),
    databasePath: getDatabasePath(),
    integrations: getIntegrationConnections(),
    monitoring: monitoringEngine.getStatus(),
  });
}

export async function POST(request: Request) {
  if (!isLocalhostOrigin(request.headers.get('host'))) {
    return NextResponse.json({ error: 'Localhost access only' }, { status: 403 });
  }

  try {
    const body = (await request.json()) as {
      action?: 'update_settings' | 'apply_retention' | 'clear_history';
      settings?: Record<string, unknown>;
      retentionDays?: number;
      clearScope?: 'events' | 'errors' | 'usage' | 'all';
      confirmClear?: boolean;
    };

    if (body.action === 'apply_retention') {
      const result = applyDataRetention(body.retentionDays);
      return NextResponse.json({ ok: true, result, settings: getAllSettings() });
    }

    if (body.action === 'clear_history') {
      if (!body.confirmClear) {
        return NextResponse.json(
          { error: 'Explicit confirmation required before deleting monitoring history' },
          { status: 400 }
        );
      }
      clearMonitoringHistory(body.clearScope || 'events');
      return NextResponse.json({ ok: true, settings: getAllSettings() });
    }

    if (body.settings && typeof body.settings === 'object') {
      const allowedKeys = [
        'workspaceRoots',
        'monitoringExclusions',
        'refreshIntervalSeconds',
        'retentionDays',
        'theme',
        'notificationsEnabled',
        'notificationCooldownSeconds',
        'costThresholdUsd',
      ];
      for (const [k, v] of Object.entries(body.settings)) {
        if (allowedKeys.includes(k)) {
          setSetting(k, v);
        }
      }
      if (Array.isArray(body.settings.workspaceRoots)) {
        await monitoringEngine.updateScope(body.settings.workspaceRoots as string[]);
      }
    }

    return NextResponse.json({
      ok: true,
      settings: getAllSettings(),
      monitoring: monitoringEngine.getStatus(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update settings' },
      { status: 500 }
    );
  }
}
