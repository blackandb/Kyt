import { NextResponse } from 'next/server';
import { authClient } from '@/lib/supabase/server';
import { env } from '@/lib/env';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  if (code) {
    const supabase = await authClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && (data.user?.email || '').toLowerCase() === env.ownerEmail()) {
      return NextResponse.redirect(new URL('/', url.origin));
    }
    await supabase.auth.signOut();
  }
  return NextResponse.redirect(new URL('/login?error=link', url.origin));
}
