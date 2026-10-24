import { NextResponse } from 'next/server';
import { globalSearch, getNotifications, markAllNotificationsRead } from '@/lib/db';
import { isLocalhostOrigin } from '@/lib/security';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!isLocalhostOrigin(request.headers.get('host'))) {
    return NextResponse.json({ error: 'Localhost access only' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q') || '';
  const results = globalSearch(query);
  const notifications = getNotifications(30);

  return NextResponse.json({
    query,
    results,
    notifications,
  });
}

export async function POST(request: Request) {
  if (!isLocalhostOrigin(request.headers.get('host'))) {
    return NextResponse.json({ error: 'Localhost access only' }, { status: 403 });
  }

  markAllNotificationsRead();
  return NextResponse.json({ ok: true, notifications: getNotifications(30) });
}
