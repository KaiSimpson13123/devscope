import { NextResponse } from 'next/server';
import { getErrors, updateErrorStatus, getProjects } from '@/lib/db';
import { isLocalhostOrigin, ErrorActionSchema } from '@/lib/security';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!isLocalhostOrigin(request.headers.get('host'))) {
    return NextResponse.json({ error: 'Localhost access only' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') || undefined;
  const severity = searchParams.get('severity') || undefined;
  const projectId = searchParams.get('projectId') || undefined;
  const search = searchParams.get('search') || undefined;

  const errors = getErrors({ status, severity, projectId, search });
  const projects = getProjects({ includeExcluded: true });
  return NextResponse.json({ errors, projects });
}

export async function PATCH(request: Request) {
  if (!isLocalhostOrigin(request.headers.get('host'))) {
    return NextResponse.json({ error: 'Localhost access only' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = ErrorActionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid error action payload', issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const updated = updateErrorStatus(
      parsed.data.id,
      parsed.data.action,
      parsed.data.resolutionNote
    );
    if (!updated) {
      return NextResponse.json({ error: 'Error record not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, error: updated });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update error status' },
      { status: 500 }
    );
  }
}
