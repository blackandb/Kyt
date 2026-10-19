import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { env } from '@/lib/env';
import { db } from '@/lib/supabase/admin';
import { codeVersion } from '@/lib/passcode';
import { SESSION_COOKIE, readSession } from '@/lib/session';

export async function isAuthed(): Promise<boolean> {
  const session = await readSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) return false;
  const { data } = await db().from('settings').select('access_code_hash').eq('id', 1).single();
  const stored = (data as { access_code_hash: string | null } | null)?.access_code_hash;
  return !!stored && session.version === codeVersion(stored);
}

export async function requireOwner() {
  if (!(await isAuthed())) redirect('/login');
}

export function isCronAuthorized(request: Request): boolean {
  const header = request.headers.get('authorization') || '';
  return header === `Bearer ${env.cronSecret()}`;
}
