import 'server-only';
import { redirect } from 'next/navigation';
import { authClient } from '@/lib/supabase/server';
import { env } from '@/lib/env';

export async function requireOwner() {
  const supabase = await authClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user || (user.email || '').toLowerCase() !== env.ownerEmail()) {
    redirect('/login');
  }
  return user;
}

export function isCronAuthorized(request: Request): boolean {
  const header = request.headers.get('authorization') || '';
  return header === `Bearer ${env.cronSecret()}`;
}
