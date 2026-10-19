import { NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth';
import { db } from '@/lib/supabase/admin';
import type { Transfer } from '@/lib/types';

export const dynamic = 'force-dynamic';

function cell(v: unknown) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET() {
  await requireOwner();
  const rows: Transfer[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await db()
      .from('transfers')
      .select('*, wallets(label, address, network)')
      .order('block_ts', { ascending: false })
      .range(from, from + 999);
    rows.push(...((data || []) as Transfer[]));
    if (!data || data.length < 1000) break;
  }

  const header = ['time_utc', 'wallet', 'wallet_address', 'network', 'token', 'amount', 'sender', 'tx_hash', 'kyt', 'risk_level', 'risk_score', 'reasons'];
  const lines = rows.map((t) =>
    [
      t.block_ts,
      t.wallets?.label,
      t.to_address,
      t.network,
      t.token,
      t.amount,
      t.from_address,
      t.tx_hash,
      t.kyt_passed ? 'passed' : 'failed',
      t.risk_level,
      t.risk_score,
      (t.reasons || []).filter((r) => r.tone === 'bad' || r.tone === 'warn').map((r) => r.label).join(' | ')
    ]
      .map(cell)
      .join(',')
  );

  const csv = [header.join(','), ...lines].join('\n');
  return new NextResponse(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="kyt-transfers-${new Date().toISOString().slice(0, 10)}.csv"`
    }
  });
}
