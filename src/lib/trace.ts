import 'server-only';
import { fetchRecentIncoming, isTetherBlacklisted, toUnits, TOKENS } from '@/lib/tron';
import type { Ctx } from '@/lib/signals';
import type { StepEmitter, TraceHit, TraceResult } from '@/lib/types';

const HOP1_SOURCES = 6;
const HOP2_SOURCES = 3;

type Source = { address: string; amount: number; token: string; raw: string };

async function topSources(address: string, limit: number, exclude: Set<string>): Promise<Source[]> {
  const items = await fetchRecentIncoming(address, 50).catch(() => []);
  const totals = new Map<string, Source>();
  for (const t of items) {
    if (exclude.has(t.from) || t.from === address) continue;
    const token = TOKENS[t.token_info.address];
    const amount = Number(toUnits(t.value, token.decimals));
    const prev = totals.get(t.from);
    if (prev) {
      prev.amount += amount;
      prev.raw = String(prev.amount);
    } else {
      totals.set(t.from, { address: t.from, amount, token: token.symbol, raw: String(amount) });
    }
  }
  return [...totals.values()].sort((a, b) => b.amount - a.amount).slice(0, limit);
}

async function classify(
  address: string,
  ctx: Ctx,
  blacklistMemo: Map<string, boolean | null>
): Promise<{ reason: TraceHit['reason']; label: string | null } | null> {
  const flag = ctx.flagged.get(address);
  if (flag?.source === 'sanctions') return { reason: 'sanctions', label: flag.label };
  let frozen = blacklistMemo.get(address);
  if (frozen === undefined) {
    frozen = await isTetherBlacklisted(address);
    blacklistMemo.set(address, frozen);
  }
  if (frozen) return { reason: 'tether_blacklist', label: 'Frozen by Tether' };
  if (flag?.source === 'manual') return { reason: 'flagged', label: flag.label };
  return null;
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export async function traceFunds(address: string, ctx: Ctx, emit?: StepEmitter, group?: string): Promise<TraceResult> {
  const step = (id: string, label: string, state: Parameters<StepEmitter>[0]['state'], detail?: string) =>
    emit?.({ id, label, state, detail, group });
  const memo = new Map<string, boolean | null>();
  const seen = new Set<string>([address, ...ctx.own]);
  const hits: TraceHit[] = [];
  let scanned = 0;

  step('trace1', 'Fund trace · direct sources', 'run', 'Reading incoming transfers of the sender');
  const hop1 = await topSources(address, HOP1_SOURCES, ctx.own);
  hop1.forEach((s) => seen.add(s.address));
  if (hop1.length) step('trace1', 'Fund trace · direct sources', 'run', `Screening ${hop1.length} sources`);

  let done1 = 0;
  const hop1Results = await Promise.all(
    hop1.map(async (s) => {
      const r = await classify(s.address, ctx, memo);
      done1++;
      step('trace1', 'Fund trace · direct sources', 'run', `${done1}/${hop1.length} · ${short(s.address)}`);
      return r;
    })
  );
  scanned += hop1.length;
  hop1.forEach((s, i) => {
    const r = hop1Results[i];
    if (r) hits.push({ address: s.address, hop: 1, via: null, reason: r.reason, label: r.label, amount: s.raw, token: s.token });
  });

  const hop1Hits = hits.length;
  step(
    'trace1',
    'Fund trace · direct sources',
    hop1Hits ? 'bad' : 'ok',
    hop1.length === 0
      ? 'No incoming token transfers to trace'
      : hop1Hits
        ? `${hop1Hits} of ${hop1.length} sources frozen, sanctioned or flagged`
        : `${hop1.length} sources clean`
  );

  const clean = hop1.filter((_, i) => !hop1Results[i]);
  if (clean.length) step('trace2', 'Fund trace · second step', 'run', `Following ${clean.length} sources upstream`);
  const hop2Lists = await Promise.all(clean.map((s) => topSources(s.address, HOP2_SOURCES, seen)));
  for (let i = 0; i < clean.length; i++) {
    const list = hop2Lists[i].filter((s) => !seen.has(s.address));
    list.forEach((s) => seen.add(s.address));
    const results = await Promise.all(list.map((s) => classify(s.address, ctx, memo)));
    scanned += list.length;
    step('trace2', 'Fund trace · second step', 'run', `${i + 1}/${clean.length} · ${list.length} upstream of ${short(clean[i].address)}`);
    list.forEach((s, j) => {
      const r = results[j];
      if (r) hits.push({ address: s.address, hop: 2, via: clean[i].address, reason: r.reason, label: r.label, amount: s.raw, token: s.token });
    });
  }

  if (clean.length) {
    const hop2Hits = hits.length - hop1Hits;
    step(
      'trace2',
      'Fund trace · second step',
      hop2Hits ? 'warn' : 'ok',
      hop2Hits ? `${hop2Hits} tainted source${hop2Hits === 1 ? '' : 's'} two steps back` : `${scanned - hop1.length} upstream addresses clean`
    );
  }

  return { scanned, sources: hop1.length, hits, tracedAt: new Date().toISOString() };
}
