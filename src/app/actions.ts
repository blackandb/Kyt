'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { currentCodeId, requireAdmin, requireOwner } from '@/lib/auth';
import { codeVersion, generateCode, hashCode, normalizeCode, verifyCode } from '@/lib/passcode';
import { SESSION_COOKIE, SESSION_MAX_AGE, createSession } from '@/lib/session';
import { db } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import { isTronAddress } from '@/lib/tron';
import { syncAll } from '@/lib/sync';
import { syncSanctions } from '@/lib/sanctions';
import { collectSignals, getContext, getSettings } from '@/lib/signals';
import { scoreAddress } from '@/lib/risk';
import { deepCheckConfigured } from '@/lib/amlbot';
import { renderAlert, sendEmail } from '@/lib/email';

export type ActionState = { ok?: boolean; message?: string } | null;

/* ---------- Access ---------- */

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

const sessionCookie = (value: string) =>
  ({ name: SESSION_COOKIE, value, httpOnly: true, secure: true, sameSite: 'lax' as const, path: '/', maxAge: SESSION_MAX_AGE });

export async function unlock(_: ActionState, form: FormData): Promise<ActionState> {
  const code = String(form.get('code') || '');
  if (!normalizeCode(code)) return { ok: false, message: 'Enter your access code.' };

  const { data: lock } = await db().from('settings').select('access_failed, access_locked_until').eq('id', 1).single();
  const l = lock as { access_failed: number; access_locked_until: string | null } | null;
  if (l?.access_locked_until && new Date(l.access_locked_until).getTime() > Date.now()) {
    const mins = Math.ceil((new Date(l.access_locked_until).getTime() - Date.now()) / 60_000);
    return { ok: false, message: `Too many attempts. Try again in ${mins} min.` };
  }

  const { data: codes, error } = await db().from('access_codes').select('id, code_hash').is('revoked_at', null);
  if (error) return { ok: false, message: 'Access codes could not be loaded. Try again.' };
  if (!codes?.length) return { ok: false, message: 'No active access code. Ask for a new one to be issued.' };
  const match = (codes as { id: string; code_hash: string }[]).find((c) => verifyCode(code, c.code_hash));

  if (!match) {
    const failed = (l?.access_failed || 0) + 1;
    await db()
      .from('settings')
      .update({
        access_failed: failed >= MAX_ATTEMPTS ? 0 : failed,
        access_locked_until: failed >= MAX_ATTEMPTS ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null
      })
      .eq('id', 1);
    await new Promise((r) => setTimeout(r, 700));
    return {
      ok: false,
      message: failed >= MAX_ATTEMPTS ? `Too many attempts. Locked for ${LOCK_MINUTES} min.` : `Incorrect access code. ${MAX_ATTEMPTS - failed} attempts left.`
    };
  }

  await Promise.all([
    db().from('settings').update({ access_failed: 0, access_locked_until: null }).eq('id', 1),
    db().from('access_codes').update({ last_used_at: new Date().toISOString() }).eq('id', match.id)
  ]);
  (await cookies()).set(sessionCookie(await createSession(codeVersion(match.id, match.code_hash))));
  redirect('/check');
}

export async function signOut() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect('/login');
}

export type NewCodeState = { ok?: boolean; message?: string; code?: string } | null;

export async function createAccessCode(_: NewCodeState, form: FormData): Promise<NewCodeState> {
  await requireAdmin();
  const label = String(form.get('label') || '').trim().slice(0, 40) || 'Access code';
  const code = generateCode();
  const { error } = await db().from('access_codes').insert({ label, code_hash: hashCode(code) });
  if (error) return { ok: false, message: error.message };
  revalidatePath('/settings');
  return { ok: true, message: `${label} created. Save it now — it will not be shown again.`, code };
}

export async function revokeAccessCode(form: FormData) {
  await requireAdmin();
  const id = String(form.get('id') || '');
  const current = await currentCodeId();
  if (!id || id === current) return;
  await db().from('access_codes').update({ revoked_at: new Date().toISOString() }).eq('id', id);
  revalidatePath('/settings');
}

/* ---------- Wallets ---------- */

export async function addWallet(_: ActionState, form: FormData): Promise<ActionState> {
  const owner = await requireOwner();
  const label = String(form.get('label') || '').trim();
  const address = String(form.get('address') || '').trim();
  const backfillDays = Math.min(30, Math.max(0, Number(form.get('backfill') || 7)));
  if (!label) return { ok: false, message: 'Add a label.' };
  if (!isTronAddress(address)) return { ok: false, message: 'This is not a valid TRON address.' };

  const { error } = await db()
    .from('wallets')
    .insert({ owner_id: owner, label, address, network: 'TRON', last_seen_ts: Date.now() - backfillDays * 86_400_000 });
  if (error) return { ok: false, message: error.message.includes('duplicate') ? 'This wallet is already monitored.' : error.message };

  revalidatePath('/wallets');
  revalidatePath('/transfers');
  return { ok: true, message: `${label} added. History from the last ${backfillDays} days will appear on the next sync.` };
}

export async function toggleWallet(form: FormData) {
  const owner = await requireOwner();
  const id = String(form.get('id'));
  const active = form.get('active') === 'true';
  await db().from('wallets').update({ active: !active }).eq('id', id).eq('owner_id', owner);
  revalidatePath('/wallets');
}

export async function renameWallet(form: FormData) {
  const owner = await requireOwner();
  const id = String(form.get('id'));
  const label = String(form.get('label') || '').trim();
  if (label) await db().from('wallets').update({ label }).eq('id', id).eq('owner_id', owner);
  revalidatePath('/wallets');
  revalidatePath('/transfers');
}

export async function deleteWallet(form: FormData) {
  const owner = await requireOwner();
  await db().from('wallets').delete().eq('id', String(form.get('id'))).eq('owner_id', owner);
  revalidatePath('/wallets');
  revalidatePath('/transfers');
}

/* ---------- Sync ---------- */

export async function syncNow(_: ActionState): Promise<ActionState> {
  const owner = await requireOwner();
  const s = await syncAll(owner);
  revalidatePath('/transfers');
  revalidatePath('/wallets');
  const base = s.inserted === 0 ? 'No new transfers.' : `${s.inserted} new transfer${s.inserted === 1 ? '' : 's'}.`;
  return { ok: s.errors.length === 0, message: s.errors.length ? `${base} ${s.errors[0]}` : base };
}

/* ---------- Flags ---------- */

export async function flagAddress(_: ActionState, form: FormData): Promise<ActionState> {
  const owner = await requireOwner();
  const address = String(form.get('address') || '').trim();
  const label = String(form.get('label') || '').trim() || null;
  const severity = Math.min(100, Math.max(1, Number(form.get('severity') || 80)));
  if (!isTronAddress(address)) return { ok: false, message: 'This is not a valid TRON address.' };
  const { error } = await db().from('user_flags').upsert({ owner_id: owner, address, label, severity }, { onConflict: 'owner_id,address' });
  if (error) return { ok: false, message: error.message };
  revalidatePath('/flags');
  return { ok: true, message: 'Address flagged.' };
}

export async function quickFlag(form: FormData) {
  const owner = await requireOwner();
  const address = String(form.get('address') || '');
  const id = String(form.get('transferId') || '');
  if (!isTronAddress(address)) return;
  await db()
    .from('user_flags')
    .upsert({ owner_id: owner, address, label: 'Flagged from transfer', severity: 80 }, { onConflict: 'owner_id,address' });
  if (id) await rescoreTransfer(owner, id, false);
  revalidatePath('/flags');
  if (id) revalidatePath(`/transfers/${id}`);
}

export async function unflag(form: FormData) {
  const owner = await requireOwner();
  await db().from('user_flags').delete().eq('owner_id', owner).eq('address', String(form.get('address')));
  revalidatePath('/flags');
}

export async function syncSanctionsAction(_: ActionState): Promise<ActionState> {
  await requireOwner();
  const r = await syncSanctions();
  revalidatePath('/flags');
  return r.ok ? { ok: true, message: `Sanctions list updated: ${r.count} TRON addresses.` } : { ok: false, message: r.error };
}

/* ---------- Transfers ---------- */

async function rescoreTransfer(owner: string, id: string, deep: boolean) {
  const { data: t } = await db().from('transfers').select('*').eq('id', id).eq('owner_id', owner).maybeSingle();
  if (!t) return;
  const settings = await getSettings(owner);
  const ctx = await getContext(owner);
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
    .eq('id', id)
    .eq('owner_id', owner);
}

export async function recheckTransfer(form: FormData) {
  const owner = await requireOwner();
  const id = String(form.get('id'));
  await rescoreTransfer(owner, id, form.get('deep') === 'true');
  revalidatePath(`/transfers/${id}`);
  revalidatePath('/transfers');
}

/* ---------- History ---------- */

export async function clearHistory(_: ActionState): Promise<ActionState> {
  const owner = await requireOwner();
  const results = await Promise.all([
    db().from('manual_checks').delete().eq('owner_id', owner),
    db().from('transfers').delete().eq('owner_id', owner),
    db().from('address_checks').delete().eq('owner_id', owner)
  ]);
  const failed = results.find((r) => r.error);
  if (failed?.error) return { ok: false, message: failed.error.message };
  revalidatePath('/check');
  revalidatePath('/transfers');
  revalidatePath('/settings');
  return { ok: true, message: 'History cleared: checks, transfers and screened addresses.' };
}

/* ---------- Settings ---------- */

export async function saveSettings(_: ActionState, form: FormData): Promise<ActionState> {
  const owner = await requireOwner();
  const mode = String(form.get('alert_mode'));
  const level = String(form.get('alert_min_level'));
  const email = String(form.get('alert_email') || '').trim().toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, message: 'Alert email is not valid.' };
  const update = {
    owner_id: owner,
    alert_mode: ['all', 'risk', 'off'].includes(mode) ? mode : 'all',
    alert_min_level: ['low', 'medium', 'high', 'severe'].includes(level) ? level : 'medium',
    deep_check_enabled: form.get('deep_check_enabled') === 'on',
    deep_check_threshold: Math.max(0, Number(form.get('deep_check_threshold') || 1000)),
    min_amount: Math.max(0, Number(form.get('min_amount') || 0)),
    cache_hours: Math.min(168, Math.max(1, Number(form.get('cache_hours') || 24))),
    alert_email: email || null,
    updated_at: new Date().toISOString()
  };
  const { error } = await db().from('user_settings').upsert(update, { onConflict: 'owner_id' });
  if (error) return { ok: false, message: error.message };
  revalidatePath('/settings');
  return { ok: true, message: 'Settings saved.' };
}

export async function sendTestEmail(_: ActionState): Promise<ActionState> {
  const owner = await requireOwner();
  const settings = await getSettings(owner);
  if (!settings.alert_email) return { ok: false, message: 'Set an alert email above and save first.' };
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
  const r = await sendEmail(settings.alert_email, `[Test] ${mail.subject}`, mail.html, mail.text);
  return r.ok ? { ok: true, message: `Test email sent to ${settings.alert_email}.` } : { ok: false, message: r.error };
}
