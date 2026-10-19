import 'server-only';
import { db } from '@/lib/supabase/admin';
import { fetchAccount, fetchTrc20Count, isTetherBlacklisted, isTronAddress } from '@/lib/tron';
import { looksLike } from '@/lib/risk';
import { deepCheck } from '@/lib/amlbot';
import type { AddressSignals, DeepResult, FlaggedAddress, Settings } from '@/lib/types';

type CachedRow = {
  address: string;
  signals: Pick<AddressSignals, 'tetherBlacklisted' | 'createdAt' | 'activated' | 'trc20Count'>;
  deep: DeepResult | null;
  deep_checked_at: string | null;
  checked_at: string;
};

export async function getSettings(): Promise<Settings> {
  const { data } = await db().from('settings').select('*').eq('id', 1).single();
  return data as Settings;
}

export async function getContext() {
  const [wallets, flags, senders] = await Promise.all([
    db().from('wallets').select('address'),
    db().from('flagged_addresses').select('*'),
    db().from('transfers').select('from_address').eq('risk_level', 'low').order('block_ts', { ascending: false }).limit(500)
  ]);
  const own = new Set((wallets.data || []).map((w) => w.address as string));
  const flagged = new Map<string, FlaggedAddress>();
  (flags.data || []).forEach((f) => flagged.set(f.address, f as FlaggedAddress));
  const trusted = new Set<string>([...own, ...(senders.data || []).map((s) => s.from_address as string)]);
  return { own, flagged, trusted };
}

export type Ctx = Awaited<ReturnType<typeof getContext>>;

export async function collectSignals(
  address: string,
  ctx: Ctx,
  opts: { cacheHours: number; deep: boolean; forceFresh?: boolean }
): Promise<{ signals: AddressSignals; deep: DeepResult | null }> {
  const valid = isTronAddress(address);
  const flag = ctx.flagged.get(address);
  const base: AddressSignals = {
    address,
    valid,
    tetherBlacklisted: null,
    sanctioned: flag?.source === 'sanctions',
    flagged: flag && flag.source === 'manual' ? { label: flag.label, severity: flag.severity, source: flag.source } : null,
    createdAt: null,
    activated: false,
    trc20Count: null,
    isOwnWallet: ctx.own.has(address),
    poisoningOf: null
  };
  if (!valid) return { signals: base, deep: null };

  for (const t of ctx.trusted) {
    if (looksLike(address, t)) {
      base.poisoningOf = t;
      break;
    }
  }

  const { data: cachedRaw } = await db().from('address_checks').select('*').eq('address', address).maybeSingle();
  const cached = cachedRaw as CachedRow | null;
  const fresh =
    !opts.forceFresh && cached && Date.now() - new Date(cached.checked_at).getTime() < opts.cacheHours * 3_600_000;

  let live: CachedRow['signals'];
  if (fresh && cached) {
    live = cached.signals;
  } else {
    const [blacklisted, account, count] = await Promise.all([
      isTetherBlacklisted(address),
      fetchAccount(address).catch(() => ({ activated: false, createdAt: null })),
      fetchTrc20Count(address).catch(() => null)
    ]);
    live = { tetherBlacklisted: blacklisted, createdAt: account.createdAt, activated: account.activated, trc20Count: count };
  }

  let deep: DeepResult | null = cached?.deep ?? null;
  const deepFresh =
    cached?.deep_checked_at && Date.now() - new Date(cached.deep_checked_at).getTime() < 7 * 24 * 3_600_000;
  let deepRan = false;
  if (opts.deep && (!deepFresh || opts.forceFresh)) {
    const result = await deepCheck(address);
    if (result) {
      deep = result;
      deepRan = true;
    }
  }
  if (!opts.deep && !deepFresh) deep = null;

  if (!fresh || deepRan) {
    await db()
      .from('address_checks')
      .upsert({
        address,
        network: 'TRON',
        signals: live,
        deep: deep ?? cached?.deep ?? null,
        deep_checked_at: deepRan ? new Date().toISOString() : cached?.deep_checked_at ?? null,
        checked_at: fresh && cached ? cached.checked_at : new Date().toISOString()
      });
  }

  return { signals: { ...base, ...live }, deep };
}
