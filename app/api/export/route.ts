import { NextResponse } from 'next/server';
import { getActivityEvents, getUsageRecords } from '@/lib/db';
import { isLocalhostOrigin } from '@/lib/security';

export const dynamic = 'force-dynamic';

function escapeCsvCell(val: unknown): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function GET(request: Request) {
  if (!isLocalhostOrigin(request.headers.get('host'))) {
    return NextResponse.json({ error: 'Localhost access only' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') === 'usage' ? 'usage' : 'activity';
  const format = searchParams.get('format') === 'csv' ? 'csv' : 'json';

  if (type === 'usage') {
    const records = getUsageRecords();
    if (format === 'json') {
      return new Response(JSON.stringify(records, null, 2), {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': 'attachment; filename="devscope-usage-export.json"',
        },
      });
    }
    const headers = [
      'id',
      'timestamp',
      'provider',
      'model',
      'source',
      'sessionId',
      'projectId',
      'inputTokens',
      'outputTokens',
      'cachedTokens',
      'totalTokens',
      'estimatedCostUsd',
      'reportedCostUsd',
      'pricingVersion',
      'dataOrigin',
    ];
    const lines = [headers.join(',')];
    for (const r of records) {
      lines.push(
        [
          r.id,
          r.timestamp,
          r.provider,
          r.model,
          r.source,
          r.sessionId,
          r.projectId,
          r.inputTokens,
          r.outputTokens,
          r.cachedTokens,
          r.totalTokens,
          r.estimatedCostUsd,
          r.reportedCostUsd,
          r.pricingVersion,
          r.dataOrigin,
        ]
          .map(escapeCsvCell)
          .join(',')
      );
    }
    return new Response(lines.join('\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="devscope-usage-export.csv"',
      },
    });
  }

  // Activity export
  const events = getActivityEvents({ limit: 1000 });
  if (format === 'json') {
    return new Response(JSON.stringify(events, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': 'attachment; filename="devscope-activity-export.json"',
      },
    });
  }

  const headers = [
    'id',
    'timestamp',
    'type',
    'category',
    'severity',
    'title',
    'detail',
    'source',
    'dataOrigin',
    'projectId',
    'sessionId',
    'taskId',
    'filePath',
  ];
  const lines = [headers.join(',')];
  for (const e of events) {
    lines.push(
      [
        e.id,
        e.timestamp,
        e.type,
        e.category,
        e.severity,
        e.title,
        e.detail,
        e.source,
        e.dataOrigin,
        e.projectId,
        e.sessionId,
        e.taskId,
        e.filePath,
      ]
        .map(escapeCsvCell)
        .join(',')
    );
  }
  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="devscope-activity-export.csv"',
    },
  });
}
