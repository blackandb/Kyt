import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/session';

const PUBLIC_PATHS = ['/login', '/api/cron'];

/** Fast gate only: the session is fully verified on the server (requireOwner / isAuthed). */
export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
  const hasSession = /^\d+\.[^.]+\.[^.]+$/.test(request.cookies.get(SESSION_COOKIE)?.value || '');

  if (!isPublic && !hasSession) {
    if (path.startsWith('/api/')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)']
};
