import { NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/auth';
import { syncSanctions } from '@/lib/sanctions';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function handle(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json(await syncSanctions());
}

export const GET = handle;
export const POST = handle;
