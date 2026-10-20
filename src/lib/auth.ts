import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { env } from '@/lib/env';
import { db } from '@/lib/supabase/admin';
import { codeVersion } from '@/lib/passcode';
import { SESSION_COOKIE, readSession } from '@/lib/session';

export type CodeUser = { id: string; label: string; isAdmin: boolean };

export const currentUser = cache(async (): Promise<CodeUser | null> => {
  const session = await readSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) return null;
  const id = session.version.split(':')[0];
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await db().from('access_codes').select('id, label, code_hash, is_admin, revoked_at').eq('id', id).maybeSingle();
  const row = data as { id: string; label: string; code_hash: string; is_admin: boolean; revoked_at: string | null } | null;
  if (!row || row.revoked_at) return null;
  if (session.version !== codeVersion(row.id, row.code_hash)) return null;
  return { id: row.id, label: row.label, isAdmin: !!row.is_admin };
});

export async function currentCodeId(): Promise<string | null> {
  return (await currentUser())?.id ?? null;
}

export async function isAuthed(): Promise<boolean> {
  return (await currentUser()) !== null;
}

/** Returns the signed-in code id (the user); redirects to /login otherwise. */
export async function requireOwner(): Promise<string> {
  const user = await currentUser();
  if (!user) redirect('/login');
  return user.id;
}

export async function requireAdmin(): Promise<string> {
  const user = await currentUser();
  if (!user) redirect('/login');
  if (!user.isAdmin) throw new Error('Not allowed');
  return user.id;
}

export function isCronAuthorized(request: Request): boolean {
  const header = request.headers.get('authorization') || '';
  return header === `Bearer ${env.cronSecret()}`;
}
