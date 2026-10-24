import { NextResponse } from 'next/server';
import { getRepositories } from '@/lib/db';
import { syncAllRepositories, resolveGitHubAuth, getRepositoryDiff } from '@/lib/github';
import { isLocalhostOrigin } from '@/lib/security';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!isLocalhostOrigin(request.headers.get('host'))) {
    return NextResponse.json({ error: 'Localhost access only' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  if (action === 'diff') {
    const repoId = searchParams.get('repoId') || '';
    const file = searchParams.get('file') || undefined;
    const diffResult = getRepositoryDiff(repoId, file);
    return NextResponse.json(diffResult);
  }

  let repositories = getRepositories();
  if (repositories.length === 0) {
    const synced = await syncAllRepositories({ forceRemote: false });
    repositories = synced.repositories;
  }
  const auth = await resolveGitHubAuth(false);

  return NextResponse.json({
    auth: {
      authenticated: auth.authenticated,
      source: auth.source,
      username: auth.username,
      rateLimitRemaining: auth.rateLimitRemaining,
      error: auth.error ?? null,
    },
    repositories,
  });
}

export async function POST(request: Request) {
  if (!isLocalhostOrigin(request.headers.get('host'))) {
    return NextResponse.json({ error: 'Localhost access only' }, { status: 403 });
  }

  const { repositories, auth } = await syncAllRepositories({ forceRemote: true });
  return NextResponse.json({
    ok: true,
    auth: {
      authenticated: auth.authenticated,
      source: auth.source,
      username: auth.username,
      rateLimitRemaining: auth.rateLimitRemaining,
      error: auth.error ?? null,
    },
    repositories,
  });
}
