import 'server-only';
import { db } from '@/lib/supabase/admin';
import { fetchTransactionTransfers, isTronAddress, isTxHash, toUnits } from '@/lib/tron';
import { scoreAddress } from '@/lib/risk';
import { collectSignals, getContext, getSettings } from '@/lib/signals';
import { deepCheckConfigured } from '@/lib/amlbot';
import type { AddressSignals, DeepResult, RiskResult, StepEmitter } from '@/lib/types';

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

export async function runCheck(owner: string, query: string, deep: boolean, emit?: StepEmitter): Promise<CheckResult> {
  const q = query.trim();
  const settings = await getSettings(owner);
  const ctx = await getContext(owner);
  const useDeep = deep && deepCheckConfigured();

  const reportFor = async (address: string, amount?: number, group?: string): Promise<AddressReport> => {
    const { signals, deep: d } = await collectSignals(address, ctx, {
      cacheHours: settings.cache_hours,
      deep: useDeep,
      forceFresh: true,
      emit,
      group
    });
    const risk = scoreAddress(signals, { amount, largeAmount: Number(settings.deep_check_threshold), deep: d });
    emit?.({
      id: 'score',
      label: 'Risk score',
      state: risk.level === 'low' ? 'ok' : risk.level === 'medium' ? 'warn' : 'bad',
      detail: `${risk.score} · ${risk.level[0].toUpperCase() + risk.level.slice(1)} · KYT ${risk.passed ? 'passed' : 'failed'}`,
      group
    });
    return { kind: 'address', address, risk, signals, deep: d, checkedAt: new Date().toISOString() };
  };

  let result: CheckResult;

  if (isTronAddress(q)) {
    result = await reportFor(q);
  } else if (isTxHash(q)) {
    emit?.({ id: 'tx', label: 'Transaction lookup', state: 'run', detail: 'Fetching events from TRON' });
    const events = await fetchTransactionTransfers(q).catch(() => []);
    emit?.({
      id: 'tx',
      label: 'Transaction lookup',
      state: events.length ? 'ok' : 'bad',
      detail: events.length ? `${events.length} token transfer${events.length === 1 ? '' : 's'} found` : 'No token transfers found'
    });
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
          sender: await reportFor(e.from, Number(amount), `Sender ${e.from.slice(0, 6)}…${e.from.slice(-4)}`)
        });
      }
      result = { kind: 'transaction', hash: q.replace(/^0x/, '').toLowerCase(), transfers, checkedAt: new Date().toISOString() };
    }
  } else {
    result = { kind: 'error', message: 'Enter a valid TRON address (T…) or a transaction hash.' };
  }

  if (result.kind !== 'error') {
    await db().from('manual_checks').insert({ owner_id: owner, query: q, kind: result.kind, result });
  }
  return result;
}
