import 'server-only';
import { db } from '@/lib/supabase/admin';
import { fetchAccount, fetchTrc20Count, isTetherBlacklisted, isTronAddress } from '@/lib/tron';
import { looksLike } from '@/lib/risk';
import { deepCheck } from '@/lib/amlbot';
import { traceFunds } from '@/lib/trace';
import type { AddressSignals, DeepResult, FlaggedAddress, Settings, StepEmitter, StepState } from '@/lib/types';

type CachedRow = {
  address: string;
  signals: Pick<AddressSignals, 'tetherBlacklisted' | 'createdAt' | 'activated' | 'trc20Count' | 'trace'>;
  deep: DeepResult | null;
  deep_checked_at: string | null;
  checked_at: string;
};

export async function getSettings(owner: string): Promise<Settings> {
  const { data } = await db().from('user_settings').select('*').eq('owner_id', owner).maybeSingle();
  if (data) return data as Settings;
  const { data: created } = await db().from('user_settings').upsert({ owner_id: owner }, { onConflict: 'owner_id' }).select('*').single();
  return created as Settings;
}

export async function getContext(owner: string) {
  const [wallets, sanctions, flags, senders] = await Promise.all([
    db().from('wallets').select('address').eq('owner_id', owner),
    db().from('flagged_addresses').select('*').eq('source', 'sanctions'),
    db().from('user_flags').select('*').eq('owner_id', owner),
    db()
      .from('transfers')
      .select('from_address')
      .eq('owner_id', owner)
      .eq('risk_level', 'low')
      .order('block_ts', { ascending: false })
      .limit(500)
  ]);
  const own = new Set((wallets.data || []).map((w) => w.address as string));
  const flagged = new Map<string, FlaggedAddress>();
  (sanctions.data || []).forEach((f) => flagged.set(f.address, f as FlaggedAddress));
  (flags.data || []).forEach((f) =>
    flagged.set(f.address, { address: f.address, network: 'TRON', source: 'manual', label: f.label, severity: f.severity, created_at: f.created_at })
  );
  const trusted = new Set<string>([...own, ...(senders.data || []).map((s) => s.from_address as string)]);
  return { owner, own, flagged, trusted };
}

export type Ctx = Awaited<ReturnType<typeof getContext>>;

export async function collectSignals(
  address: string,
  ctx: Ctx,
  opts: { cacheHours: number; deep: boolean; forceFresh?: boolean; emit?: StepEmitter; group?: string }
): Promise<{ signals: AddressSignals; deep: DeepResult | null }> {
  const step = (id: string, label: string, state: StepState, detail?: string) =>
    opts.emit?.({ id, label, state, detail, group: opts.group });
  const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
  const DAY = 86_400_000;

  const valid = isTronAddress(address);
  step('format', 'Address format & checksum', valid ? 'ok' : 'bad', valid ? 'Valid TRON address' : 'Not a valid TRON address');
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
    poisoningOf: null,
    trace: null
  };
  if (!valid) return { signals: base, deep: null };

  if (base.isOwnWallet) step('own', 'Your wallets', 'ok', 'This is one of your monitored wallets');

  const sanctionsCount = [...ctx.flagged.values()].filter((f) => f.source === 'sanctions').length;
  step(
    'sanctions',
    'OFAC sanctions list',
    base.sanctioned ? 'bad' : 'ok',
    base.sanctioned ? 'Match on the sanctions list' : `Not among ${sanctionsCount} sanctioned addresses`
  );
  step(
    'flags',
    'Your flagged addresses',
    base.flagged ? 'bad' : 'ok',
    base.flagged ? `Flagged by you${base.flagged.label ? ` — ${base.flagged.label}` : ''}` : 'Not flagged'
  );

  for (const t of ctx.trusted) {
    if (looksLike(address, t)) {
      base.poisoningOf = t;
      break;
    }
  }
  step(
    'poisoning',
    'Address-poisoning lookalikes',
    base.poisoningOf ? 'bad' : 'ok',
    base.poisoningOf ? `Mimics ${short(base.poisoningOf)}` : `Compared against ${ctx.trusted.size} trusted addresses`
  );

  const { data: cachedRaw } = await db().from('address_checks').select('*').eq('owner_id', ctx.owner).eq('address', address).maybeSingle();
  const cached = cachedRaw as CachedRow | null;
  const fresh =
    !opts.forceFresh && cached && Date.now() - new Date(cached.checked_at).getTime() < opts.cacheHours * 3_600_000;

  let live: CachedRow['signals'];
  if (fresh && cached) {
    live = cached.signals;
  } else {
    step('tether', 'Tether USDT blacklist', 'run', 'Querying the USDT contract on-chain');
    step('account', 'Account age', 'run', 'Reading account from TRON');
    step('activity', 'Transfer history', 'run', 'Counting token transfers');
    const [blacklisted, account, count, trace] = await Promise.all([
      isTetherBlacklisted(address).then((v) => {
        step('tether', 'Tether USDT blacklist', v === null ? 'info' : v ? 'bad' : 'ok', v === null ? 'Status unavailable' : v ? 'Address is frozen by Tether' : 'Not frozen');
        return v;
      }),
      fetchAccount(address)
        .catch(() => ({ activated: false, createdAt: null }))
        .then((a) => {
          const days = a.createdAt ? Math.floor((Date.now() - a.createdAt) / DAY) : null;
          step(
            'account',
            'Account age',
            days === null ? 'warn' : days < 30 ? 'warn' : 'ok',
            days === null ? 'Not activated or unknown' : `Created ${days} day${days === 1 ? '' : 's'} ago`
          );
          return a;
        }),
      fetchTrc20Count(address)
        .catch(() => null)
        .then((c) => {
          step(
            'activity',
            'Transfer history',
            c === null ? 'info' : c < 10 ? 'warn' : 'ok',
            c === null ? 'Unavailable' : c >= 50 ? '50+ token transfers' : `${c} token transfer${c === 1 ? '' : 's'}`
          );
          return c;
        }),
      base.isOwnWallet ? Promise.resolve(null) : traceFunds(address, ctx, opts.emit, opts.group).catch(() => null)
    ]);
    live = { tetherBlacklisted: blacklisted, createdAt: account.createdAt, activated: account.activated, trc20Count: count, trace };
  }

  let deep: DeepResult | null = cached?.deep ?? null;
  const deepFresh =
    cached?.deep_checked_at && Date.now() - new Date(cached.deep_checked_at).getTime() < 7 * 24 * 3_600_000;
  let deepRan = false;
  if (opts.deep && (!deepFresh || opts.forceFresh)) {
    step('deep', 'Deep screening', 'run', 'Querying screening provider');
    const result = await deepCheck(address);
    if (result) {
      deep = result;
      deepRan = true;
    }
    step('deep', 'Deep screening', result ? (result.score >= 70 ? 'bad' : result.score >= 30 ? 'warn' : 'ok') : 'info', result ? `Provider score ${result.score}` : 'Provider unavailable');
  }
  if (!opts.deep && !deepFresh) deep = null;

  if (!fresh || deepRan) {
    await db()
      .from('address_checks')
      .upsert({
        owner_id: ctx.owner,
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
