import { NextResponse } from 'next/server';
import {
  getUsageSummary,
  updatePricingTable,
  type UsageRangePreset,
  type PricingTable,
} from '@/lib/usage';
import { monitoringEngine } from '@/lib/monitoring';
import { isLocalhostOrigin } from '@/lib/security';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!isLocalhostOrigin(request.headers.get('host'))) {
    return NextResponse.json({ error: 'Localhost access only' }, { status: 403 });
  }

  await monitoringEngine.ensureStarted();
  const { searchParams } = new URL(request.url);
  const range = (searchParams.get('range') as UsageRangePreset) || '30d';
  const since = searchParams.get('since') || undefined;
  const until = searchParams.get('until') || undefined;
  const projectId = searchParams.get('projectId') || undefined;

  const summary = getUsageSummary({ range, since, until, projectId });
  return NextResponse.json(summary);
}

export async function POST(request: Request) {
  if (!isLocalhostOrigin(request.headers.get('host'))) {
    return NextResponse.json({ error: 'Localhost access only' }, { status: 403 });
  }

  try {
    const body = (await request.json()) as { pricingTable?: PricingTable };
    if (!body.pricingTable || !Array.isArray(body.pricingTable.models)) {
      return NextResponse.json({ error: 'Invalid pricing table format' }, { status: 400 });
    }
    updatePricingTable(body.pricingTable);
    await monitoringEngine.runFullSync({ forceRemote: false });
    return NextResponse.json({ ok: true, summary: getUsageSummary({ range: '30d' }) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update pricing table' },
      { status: 500 }
    );
  }
}
