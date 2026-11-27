import 'server-only';
import { env } from '@/lib/env';
import { base58Decode, hexToTron, isTronAddress, USDT_CONTRACT } from '@/lib/tron';
import { recordTransfer, type FullAudit, type BlacklistStatus } from '@/lib/audit-model';

const API = 'https://api.trongrid.io';
let nextRequest = 0;
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
async function rpc<T>(path: string, body?: unknown): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const key = env.trongridKey();
    const start = Math.max(Date.now(), nextRequest);
    nextRequest = start + (key ? 140 : 700);
    await delay(Math.max(0, start - Date.now()));
    const response = await fetch(API + path, {
      method: body ? 'POST' : 'GET', cache: 'no-store', signal: AbortSignal.timeout(10_000),
      headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}),
        ...(key ? { 'TRON-PRO-API-KEY': key } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    if ((response.status === 429 || response.status >= 500) && attempt === 0) {
      const retry = Number(response.headers.get('retry-after') || 1);
      await delay(Math.min(2000, Math.max(700, Number.isFinite(retry) ? retry * 1000 : 1000)));
      continue;
    }
    if (!response.ok) throw new Error('TRON provider unavailable (' + response.status + '). Resume to retry; no OK issued.');
    const data = await response.json();
    if (data.success === false || data.Error || data.error) throw new Error('TRON provider rejected the query. Resume to retry.');
    return data as T;
  }
  throw new Error('TRON provider rate limit. Resume to retry.');
}
export async function readBlacklist(address: string): Promise<BlacklistStatus> {
  if (!isTronAddress(address)) return 'unknown';
  const raw = base58Decode(address)!;
  const parameter = Buffer.from(raw.slice(1, 21)).toString('hex').padStart(64, '0');
  try {
    const r = await rpc<{ result?: { result?: boolean }; constant_result?: string[] }>('/wallet/triggerconstantcontract', {
      owner_address: USDT_CONTRACT, contract_address: USDT_CONTRACT,
      function_selector: 'isBlackListed(address)', parameter, visible: true
    });
    if (r.result?.result !== true || !r.constant_result || !/^[0-9a-fA-F]{64}$/.test(r.constant_result[0] || '')) return 'unknown';
    const n = BigInt('0x' + r.constant_result[0]);
    return n === 1n ? 'blocked' : n === 0n ? 'clear' : 'unknown';
  } catch { return 'unknown'; }
}
export async function readBalances(address: string) {
  const r = await rpc<{ data: { balance?: number; trc20?: Record<string, string>[] }[] }>('/v1/accounts/' + address);
  if (!Array.isArray(r.data)) throw new Error('Missing account data.');
  const account = r.data[0];
  // Empty account data is a valid, unactivated address with zero balance.
  const balance = account?.balance ?? 0;
  if (!Number.isSafeInteger(balance) || balance < 0) throw new Error('Invalid TRX balance.');
  const usdt = account?.trc20?.find(t => USDT_CONTRACT in t)?.[USDT_CONTRACT] ?? '0';
  if (!/^\d+$/.test(usdt)) throw new Error('Invalid USDT balance.');
  return { usdt, trx: String(balance) };
}
type TokenRecord = { type: string; from: string; to: string; value: string; block_timestamp: number; transaction_id: string;
  token_info: { address: string; symbol: string; decimals: number } };
type NativeRecord = { txID: string; block_timestamp: number; ret?: { contractRet: string }[];
  raw_data: { contract: { type: string; parameter: { value: { owner_address?: string; to_address?: string; amount?: number; asset_name?: string } } }[] } };
type Page<T> = { success: boolean; data: T[]; meta?: { links?: { next?: string }; fingerprint?: string } };
export async function readHistoryPage(a: FullAudit) {
  const native = a.phase === 'native';
  const params = new URLSearchParams({ limit: '200', only_confirmed: 'true', order_by: 'block_timestamp,asc',
    min_timestamp: String(a.since), max_timestamp: String(a.before) });
  if (a.cursor) params.set('fingerprint', a.cursor);
  const path = '/v1/accounts/' + a.address + '/transactions' + (native ? '' : '/trc20');
  const page = await rpc<Page<TokenRecord | NativeRecord>>(path + '?' + params);
  if (page.success !== true || !Array.isArray(page.data)) throw new Error('Incomplete history response.');
  for (const item of page.data) {
    if (native) {
      const t = item as NativeRecord;
      if (!Array.isArray(t.raw_data?.contract)) throw new Error('Malformed native transaction.');
      if (t.ret?.some(r => r.contractRet !== 'SUCCESS')) continue;
      for (const c of t.raw_data.contract) {
        if (!['TransferContract', 'TransferAssetContract'].includes(c.type)) continue;
        const v = c.parameter.value;
        if (!v.owner_address || !v.to_address || !Number.isSafeInteger(v.amount) || (v.amount ?? -1) < 0)
          throw new Error('Malformed native transfer.');
        const from = hexToTron(v.owner_address), to = hexToTron(v.to_address);
        if (!isTronAddress(from) || !isTronAddress(to)) throw new Error('Invalid native counterparty.');
        recordTransfer(a, { from, to, raw: String(v.amount), hash: t.txID, at: t.block_timestamp,
          token: c.type === 'TransferContract' ? 'TRX' : 'TRC10:' + (v.asset_name || 'unknown'), decimals: c.type === 'TransferContract' ? 6 : 0 });
      }
    } else {
      const t = item as TokenRecord;
      // Approvals and NFT records must not be represented as token payments.
      if (t.type !== 'Transfer') continue;
      if (!t.token_info || !isTronAddress(t.from) || !isTronAddress(t.to)) throw new Error('Malformed token transfer.');
      recordTransfer(a, { from: t.from, to: t.to, raw: t.value, hash: t.transaction_id, at: t.block_timestamp,
        token: t.token_info.address === USDT_CONTRACT ? 'USDT' : 'TOKEN:' + t.token_info.address,
        decimals: Number(t.token_info.decimals) });
    }
  }
  a.pages++;
  if (native) a.nativeRows += page.data.length; else a.trc20Rows += page.data.length;
  const next = page.meta?.links?.next;
  if (next) {
    const url = new URL(next, API);
    if (url.origin !== API || url.pathname !== path) throw new Error('Unexpected pagination origin or path.');
    const cursor = url.searchParams.get('fingerprint');
    if (!cursor || cursor === a.cursor) throw new Error('Pagination stopped advancing; scan is incomplete.');
    a.cursor = cursor;
  } else {
    a.cursor = null;
    a.phase = native ? 'screen' : 'native';
  }
}
