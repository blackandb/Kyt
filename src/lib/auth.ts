import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { env } from '@/lib/env';
import { db } from '@/lib/supabase/admin';
import { codeVersion } from '@/lib/passcode';
import { SESSION_COOKIE, readSession } from '@/lib/session';

export async function currentCodeId(): Promise<string | null> {
  const session = await readSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) return null;
  const id = session.version.split(':')[0];
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await db().from('access_codes').select('id, code_hash, revoked_at').eq('id', id).maybeSingle();
  const row = data as { id: string; code_hash: string; revoked_at: string | null } | null;
  if (!row || row.revoked_at) return null;
  return session.version === codeVersion(row.id, row.code_hash) ? row.id : null;
}

export async function isAuthed(): Promise<boolean> {
  return (await currentCodeId()) !== null;
}

export async function requireOwner() {
  if (!(await isAuthed())) redirect('/login');
}

export function isCronAuthorized(request: Request): boolean {
  const header = request.headers.get('authorization') || '';
  return header === `Bearer ${env.cronSecret()}`;
}
