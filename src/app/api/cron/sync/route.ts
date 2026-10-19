import { NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/auth';
import { syncAll } from '@/lib/sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function handle(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const summary = await syncAll();
  return NextResponse.json(summary);
}

export const GET = handle;
export const POST = handle;
