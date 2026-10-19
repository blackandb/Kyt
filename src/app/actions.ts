'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { requireOwner } from '@/lib/auth';
import { codeVersion, hashCode, verifyCode } from '@/lib/passcode';
import { SESSION_COOKIE, SESSION_MAX_AGE, createSession } from '@/lib/session';
import { db } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import { isTronAddress } from '@/lib/tron';
import { syncAll } from '@/lib/sync';
import { syncSanctions } from '@/lib/sanctions';
import { runCheck, type CheckResult } from '@/lib/check';
import { collectSignals, getContext, getSettings } from '@/lib/signals';
import { scoreAddress } from '@/lib/risk';
import { deepCheckConfigured } from '@/lib/amlbot';
import { renderAlert, sendEmail } from '@/lib/email';

export type ActionState = { ok?: boolean; message?: string } | null;

/* ---------- Access ---------- */

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

export async function unlock(_: ActionState, form: FormData): Promise<ActionState> {
  const code = String(form.get('code') || '');
  if (!code) return { ok: false, message: 'Enter your access code.' };

  const { data } = await db().from('settings').select('access_code_hash, access_failed, access_locked_until').eq('id', 1).single();
  const row = data as { access_code_hash: string | null; access_failed: number; access_locked_until: string | null } | null;
  if (!row?.access_code_hash) return { ok: false, message: 'Access is not configured yet.' };

  if (row.access_locked_until && new Date(row.access_locked_until).getTime() > Date.now()) {
    const mins = Math.ceil((new Date(row.access_locked_until).getTime() - Date.now()) / 60_000);
    return { ok: false, message: `Too many attempts. Try again in ${mins} min.` };
  }

  if (!verifyCode(code, row.access_code_hash)) {
    const failed = (row.access_failed || 0) + 1;
    await db()
      .from('settings')
      .update({
        access_failed: failed >= MAX_ATTEMPTS ? 0 : failed,
        access_locked_until: failed >= MAX_ATTEMPTS ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null
      })
      .eq('id', 1);
    await new Promise((r) => setTimeout(r, 700));
    return { ok: false, message: failed >= MAX_ATTEMPTS ? `Too many attempts. Locked for ${LOCK_MINUTES} min.` : 'Incorrect access code.' };
  }

  await db().from('settings').update({ access_failed: 0, access_locked_until: null }).eq('id', 1);
  (await cookies()).set(SESSION_COOKIE, await createSession(codeVersion(row.access_code_hash)), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE
  });
  redirect('/check');
}

export async function signOut() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect('/login');
}

export async function changeAccessCode(_: ActionState, form: FormData): Promise<ActionState> {
  await requireOwner();
  const current = String(form.get('current') || '');
  const next = String(form.get('next') || '');
  const confirm = String(form.get('confirm') || '');
  if (next.length < 8) return { ok: false, message: 'The new code needs at least 8 characters.' };
  if (next !== confirm) return { ok: false, message: 'The new codes do not match.' };

  const { data } = await db().from('settings').select('access_code_hash').eq('id', 1).single();
  const stored = (data as { access_code_hash: string | null } | null)?.access_code_hash;
  if (!verifyCode(current, stored)) return { ok: false, message: 'Current code is incorrect.' };

  const hash = hashCode(next);
  const { error } = await db().from('settings').update({ access_code_hash: hash, access_failed: 0, access_locked_until: null }).eq('id', 1);
  if (error) return { ok: false, message: error.message };
  (await cookies()).set(SESSION_COOKIE, await createSession(codeVersion(hash)), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE
  });
  return { ok: true, message: 'Access code changed. Other devices are signed out.' };
}

/* ---------- Wallets ---------- */

export async function addWallet(_: ActionState, form: FormData): Promise<ActionState> {
  await requireOwner();
  const label = String(form.get('label') || '').trim();
  const address = String(form.get('address') || '').trim();
  const backfillDays = Math.min(30, Math.max(0, Number(form.get('backfill') || 7)));
  if (!label) return { ok: false, message: 'Add a label.' };
  if (!isTronAddress(address)) return { ok: false, message: 'This is not a valid TRON address.' };

  const { error } = await db()
    .from('wallets')
    .insert({ label, address, network: 'TRON', last_seen_ts: Date.now() - backfillDays * 86_400_000 });
  if (error) return { ok: false, message: error.message.includes('duplicate') ? 'This wallet is already monitored.' : error.message };

  revalidatePath('/wallets');
  revalidatePath('/transfers');
  return { ok: true, message: `${label} added. History from the last ${backfillDays} days will appear on the next sync.` };
}

export async function toggleWallet(form: FormData) {
  await requireOwner();
  const id = String(form.get('id'));
  const active = form.get('active') === 'true';
  await db().from('wallets').update({ active: !active }).eq('id', id);
  revalidatePath('/wallets');
}

export async function renameWallet(form: FormData) {
  await requireOwner();
  const id = String(form.get('id'));
  const label = String(form.get('label') || '').trim();
  if (label) await db().from('wallets').update({ label }).eq('id', id);
  revalidatePath('/wallets');
  revalidatePath('/transfers');
}

export async function deleteWallet(form: FormData) {
  await requireOwner();
  await db().from('wallets').delete().eq('id', String(form.get('id')));
  revalidatePath('/wallets');
  revalidatePath('/transfers');
}

/* ---------- Sync ---------- */

export async function syncNow(_: ActionState): Promise<ActionState> {
  await requireOwner();
  const s = await syncAll();
  revalidatePath('/transfers');
  revalidatePath('/wallets');
  const base = s.inserted === 0 ? 'No new transfers.' : `${s.inserted} new transfer${s.inserted === 1 ? '' : 's'}.`;
  return { ok: s.errors.length === 0, message: s.errors.length ? `${base} ${s.errors[0]}` : base };
}

/* ---------- Flags ---------- */

export async function flagAddress(_: ActionState, form: FormData): Promise<ActionState> {
  await requireOwner();
  const address = String(form.get('address') || '').trim();
  const label = String(form.get('label') || '').trim() || null;
  const severity = Math.min(100, Math.max(1, Number(form.get('severity') || 80)));
  if (!isTronAddress(address)) return { ok: false, message: 'This is not a valid TRON address.' };
  const { error } = await db()
    .from('flagged_addresses')
    .upsert({ address, network: 'TRON', source: 'manual', label, severity }, { onConflict: 'address' });
  if (error) return { ok: false, message: error.message };
  revalidatePath('/flags');
  return { ok: true, message: 'Address flagged.' };
}

export async function quickFlag(form: FormData) {
  await requireOwner();
  const address = String(form.get('address') || '');
  const id = String(form.get('transferId') || '');
  if (!isTronAddress(address)) return;
  await db()
    .from('flagged_addresses')
    .upsert({ address, network: 'TRON', source: 'manual', label: 'Flagged from transfer', severity: 80 }, { onConflict: 'address' });
  if (id) await rescoreTransfer(id, false);
  revalidatePath('/flags');
  if (id) revalidatePath(`/transfers/${id}`);
}

export async function unflag(form: FormData) {
  await requireOwner();
  await db().from('flagged_addresses').delete().eq('address', String(form.get('address'))).eq('source', 'manual');
  revalidatePath('/flags');
}

export async function syncSanctionsAction(_: ActionState): Promise<ActionState> {
  await requireOwner();
  const r = await syncSanctions();
  revalidatePath('/flags');
  return r.ok ? { ok: true, message: `Sanctions list updated: ${r.count} TRON addresses.` } : { ok: false, message: r.error };
}

/* ---------- Transfers ---------- */

async function rescoreTransfer(id: string, deep: boolean) {
  const { data: t } = await db().from('transfers').select('*').eq('id', id).single();
  if (!t) return;
  const settings = await getSettings();
  const ctx = await getContext();
  const { signals, deep: d } = await collectSignals(t.from_address, ctx, {
    cacheHours: settings.cache_hours,
    deep: deep && deepCheckConfigured(),
    forceFresh: true
  });
  const risk = scoreAddress(signals, { amount: Number(t.amount), largeAmount: Number(settings.deep_check_threshold), deep: d });
  await db()
    .from('transfers')
    .update({
      risk_score: risk.score,
      risk_level: risk.level,
      kyt_passed: risk.passed,
      reasons: risk.reasons,
      signals: { ...signals, deep: d },
      deep_checked: !!d
    })
    .eq('id', id);
}

export async function recheckTransfer(form: FormData) {
  await requireOwner();
  const id = String(form.get('id'));
  await rescoreTransfer(id, form.get('deep') === 'true');
  revalidatePath(`/transfers/${id}`);
  revalidatePath('/transfers');
}

/* ---------- Manual check ---------- */

export type CheckState = { result?: CheckResult; query?: string } | null;

export async function checkAction(_: CheckState, form: FormData): Promise<CheckState> {
  await requireOwner();
  const query = String(form.get('query') || '').trim();
  const deep = form.get('deep') === 'on';
  if (!query) return { result: { kind: 'error', message: 'Paste an address or a transaction hash.' }, query };
  try {
    return { result: await runCheck(query, deep), query };
  } catch (e) {
    return { result: { kind: 'error', message: e instanceof Error ? e.message : 'Check failed.' }, query };
  }
}

/* ---------- Settings ---------- */

export async function saveSettings(_: ActionState, form: FormData): Promise<ActionState> {
  await requireOwner();
  const mode = String(form.get('alert_mode'));
  const level = String(form.get('alert_min_level'));
  const update = {
    alert_mode: ['all', 'risk', 'off'].includes(mode) ? mode : 'all',
    alert_min_level: ['low', 'medium', 'high', 'severe'].includes(level) ? level : 'medium',
    deep_check_enabled: form.get('deep_check_enabled') === 'on',
    deep_check_threshold: Math.max(0, Number(form.get('deep_check_threshold') || 1000)),
    min_amount: Math.max(0, Number(form.get('min_amount') || 0)),
    cache_hours: Math.min(168, Math.max(1, Number(form.get('cache_hours') || 24))),
    updated_at: new Date().toISOString()
  };
  const { error } = await db().from('settings').update(update).eq('id', 1);
  if (error) return { ok: false, message: error.message };
  revalidatePath('/settings');
  return { ok: true, message: 'Settings saved.' };
}

export async function sendTestEmail(_: ActionState): Promise<ActionState> {
  await requireOwner();
  const mail = renderAlert({
    id: 'test',
    amount: '2246.660553',
    token: 'USDT',
    from: 'TEPKBVgweaxWWcKV7d9qVSqFdztiQfGEQp',
    walletLabel: 'Test wallet',
    walletAddress: 'TR31rLFF7NBBPGZBv9eRMp4VUki34piK5S',
    network: 'TRON',
    txHash: '11ba484000000000000000000000000000000000000000000000000008b9ca383',
    passed: true,
    level: 'medium',
    score: 54,
    time: new Date().toISOString(),
    reasons: ['Test alert — sample data, not a real transfer']
  });
  const r = await sendEmail(`[Test] ${mail.subject}`, mail.html, mail.text);
  return r.ok ? { ok: true, message: `Test email sent to ${env.ownerEmail()}.` } : { ok: false, message: r.error };
}
