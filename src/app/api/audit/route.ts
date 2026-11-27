import { currentCodeId } from '@/lib/auth';
import { db } from '@/lib/supabase/admin';
import { isTronAddress } from '@/lib/tron';
import { env } from '@/lib/env';
import { readBalances, readBlacklist, readHistoryPage } from '@/lib/audit';
import type { FullAudit } from '@/lib/audit-model';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function flags(owner: string) {
  const [sanctions, manual, settings] = await Promise.all([
    db().from('flagged_addresses').select('address').eq('source', 'sanctions'),
    db().from('user_flags').select('address').eq('owner_id', owner),
    db().from('settings').select('sanctions_synced_at').eq('id', 1).maybeSingle()
  ]);
  if (sanctions.error || manual.error || settings.error) throw new Error('Risk lists unavailable; no OK issued.');
  return {
    sanctioned: new Set((sanctions.data || []).map(r => String(r.address))),
    flagged: new Set((manual.data || []).map(r => String(r.address))),
    syncedAt: (settings.data?.sanctions_synced_at as string | null) ?? null
  };
}
const reply = (id: string, audit: FullAudit) => Response.json({ id, audit }, { headers: { 'cache-control': 'no-store' } });
export async function POST(request: Request) {
  const owner = await currentCodeId();
  if (!owner) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  let body: { id?: string; address?: string; months?: number; action?: string };
  try { body = await request.json(); } catch { return Response.json({ error: 'Invalid request' }, { status: 400 }); }
  if (!body || typeof body !== 'object') return Response.json({ error: 'Invalid request' }, { status: 400 });
  try {
    if (!body.id) {
      const address = typeof body.address === 'string' ? body.address.trim() : '';
      if (!isTronAddress(address)) return Response.json({ error: 'Enter a valid TRON address.' }, { status: 400 });
      const before = Date.now();
      const sinceDate = new Date(before);
      sinceDate.setUTCMonth(sinceDate.getUTCMonth() - 6);
      const a: FullAudit = {
        kind: 'full-audit', version: 1, revision: 0, address, phase: 'trc20',
        startedAt: new Date(before).toISOString(), updatedAt: new Date(before).toISOString(),
        before, since: body.months === 6 ? sinceDate.getTime() : 0,
        cursor: null, pages: 0, trc20Rows: 0, nativeRows: 0, peers: [], targetStatus: 'unknown',
        targetSanctioned: false, targetFlagged: false, targetCheckedAt: null, balances: null,
        sanctionsUpdatedAt: null, lastError: null, verificationPass: 0
      };
      const lists = await flags(owner);
      a.targetSanctioned = lists.sanctioned.has(address);
      a.targetFlagged = lists.flagged.has(address);
      a.sanctionsUpdatedAt = lists.syncedAt;
      const [status, balances] = await Promise.all([readBlacklist(address), readBalances(address).catch(() => null)]);
      a.targetStatus = status; a.balances = balances; a.targetCheckedAt = new Date().toISOString();
      const { data, error } = await db().from('manual_checks').insert({ owner_id: owner, query: address, kind: 'address', result: a }).select('id').single();
      if (error || !data) throw new Error('Could not save the scan. Please retry.');
      return reply(data.id, a);
    }
    if (typeof body.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.id))
      return Response.json({ error: 'Invalid scan ID' }, { status: 400 });
    const { data: row, error } = await db().from('manual_checks').select('id,result').eq('owner_id', owner).eq('id', body.id).maybeSingle();
    if (error) throw new Error('Could not load scan.');
    if (!row || row.result?.kind !== 'full-audit') return Response.json({ error: 'Scan not found' }, { status: 404 });
    const a = row.result as FullAudit;
    if (body.action === 'status' || a.phase === 'done') return reply(row.id, a);
    if ((a.leaseUntil || 0) > Date.now()) return Response.json({ error: 'This scan is already advancing. Retry shortly.' }, { status: 409 });
    const previous = a.revision;
    a.revision++; a.leaseUntil = Date.now() + 55_000;
    const { data: claimed, error: claimError } = await db().from('manual_checks').update({ result: a })
      .eq('owner_id', owner).eq('id', row.id).eq('result->>revision', String(previous)).select('id');
    if (claimError) throw new Error('Could not reserve scan.');
    if (!claimed?.length) return Response.json({ error: 'Scan changed. Retry shortly.' }, { status: 409 });
    const revision = a.revision;
    // Work on a copy so a failed page never persists partly aggregated transfers.
    let work = structuredClone(a);
    try {
      if (work.phase === 'trc20' || work.phase === 'native') {
        if (work.pages >= 20_000) throw new Error('Very large history exceeds this deployment budget. Scan incomplete; no OK issued.');
        await readHistoryPage(work);
        if (JSON.stringify(work).length > 8_000_000)
          throw new Error('Scan exceeds the storage budget. Scan incomplete; no OK issued.');
      } else {
        const pending = work.peers.filter(p => p.status === null);
        const batch = pending.slice(0, env.trongridKey() ? 8 : 4);
        if (batch.length) {
          const lists = await flags(owner);
          for (let i = 0; i < batch.length; i += 4) {
            await Promise.all(batch.slice(i, i + 4).map(async p => {
              p.status = await readBlacklist(p.address);
              p.checkedAt = new Date().toISOString();
              p.sanctioned = lists.sanctioned.has(p.address);
              p.flagged = lists.flagged.has(p.address);
            }));
          }
          // Every unknown gets one explicit retry; never treat a timeout as clear.
          if (work.verificationPass > 0) work.verificationPass = 2;
        } else if (work.verificationPass === 0 && work.peers.some(p => p.status === 'unknown')) {
          work.verificationPass = 1;
          work.peers.filter(p => p.status === 'unknown').forEach(p => { p.status = null; });
        } else {
          const lists = await flags(owner);
          work.targetSanctioned = lists.sanctioned.has(work.address);
          work.targetFlagged = lists.flagged.has(work.address);
          work.sanctionsUpdatedAt = lists.syncedAt;
          for (const p of work.peers) {
            p.sanctioned = lists.sanctioned.has(p.address); p.flagged = lists.flagged.has(p.address);
          }
          const [status, balances] = await Promise.all([readBlacklist(work.address), readBalances(work.address)]);
          work.targetStatus = status; work.targetCheckedAt = new Date().toISOString(); work.balances = balances;
          work.phase = 'done';
        }
      }
      work.lastError = null;
    } catch (e) {
      work = a;
      work.lastError = e instanceof Error ? e.message : 'Provider unavailable. Scan incomplete.';
    }
    work.updatedAt = new Date().toISOString(); work.leaseUntil = 0; work.revision++;
    const { data: saved, error: saveError } = await db().from('manual_checks').update({ result: work })
      .eq('owner_id', owner).eq('id', row.id).eq('result->>revision', String(revision)).select('id');
    if (saveError || !saved?.length) throw new Error('Progress could not be saved. Resume to retry.');
    return reply(row.id, work);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Scan unavailable' }, { status: 503 });
  }
}
