import 'server-only';
import { db } from '@/lib/supabase/admin';
import { fetchTransactionTransfers, isTronAddress, isTxHash, toUnits } from '@/lib/tron';
import { scoreAddress } from '@/lib/risk';
import { collectSignals, getContext, getSettings } from '@/lib/signals';
import { deepCheckConfigured } from '@/lib/amlbot';
import type { AddressSignals, DeepResult, RiskResult } from '@/lib/types';

export type AddressReport = {
  kind: 'address';
  address: string;
  risk: RiskResult;
  signals: AddressSignals;
  deep: DeepResult | null;
  checkedAt: string;
};

export type TxReport = {
  kind: 'transaction';
  hash: string;
  transfers: {
    token: string;
    known: boolean;
    amount: string;
    from: string;
    to: string;
    timestamp: number;
    toOwnWallet: boolean;
    sender: AddressReport;
  }[];
  checkedAt: string;
};

export type CheckResult = AddressReport | TxReport | { kind: 'error'; message: string };

export async function runCheck(query: string, deep: boolean): Promise<CheckResult> {
  const q = query.trim();
  const settings = await getSettings();
  const ctx = await getContext();
  const useDeep = deep && deepCheckConfigured();

  const reportFor = async (address: string, amount?: number): Promise<AddressReport> => {
    const { signals, deep: d } = await collectSignals(address, ctx, {
      cacheHours: settings.cache_hours,
      deep: useDeep,
      forceFresh: true
    });
    const risk = scoreAddress(signals, { amount, largeAmount: Number(settings.deep_check_threshold), deep: d });
    return { kind: 'address', address, risk, signals, deep: d, checkedAt: new Date().toISOString() };
  };

  let result: CheckResult;

  if (isTronAddress(q)) {
    result = await reportFor(q);
  } else if (isTxHash(q)) {
    const events = await fetchTransactionTransfers(q).catch(() => []);
    if (events.length === 0) {
      result = { kind: 'error', message: 'No token transfers found for this transaction on TRON.' };
    } else {
      const transfers = [];
      for (const e of events.slice(0, 10)) {
        const amount = e.known ? toUnits(e.value, e.decimals) : e.value;
        transfers.push({
          token: e.token,
          known: e.known,
          amount,
          from: e.from,
          to: e.to,
          timestamp: e.timestamp,
          toOwnWallet: ctx.own.has(e.to),
          sender: await reportFor(e.from, Number(amount))
        });
      }
      result = { kind: 'transaction', hash: q.replace(/^0x/, '').toLowerCase(), transfers, checkedAt: new Date().toISOString() };
    }
  } else {
    result = { kind: 'error', message: 'Enter a valid TRON address (T…) or a transaction hash.' };
  }

  if (result.kind !== 'error') {
    await db().from('manual_checks').insert({ query: q, kind: result.kind, result });
  }
  return result;
}
