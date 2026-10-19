import 'server-only';
import { createHash } from 'node:crypto';
import { env } from '@/lib/env';

const API = 'https://api.trongrid.io';

export const TOKENS: Record<string, { symbol: string; decimals: number }> = {
  TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t: { symbol: 'USDT', decimals: 6 },
  TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8: { symbol: 'USDC', decimals: 6 }
};

export const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function sha256(data: Uint8Array): Uint8Array {
  return new Uint8Array(createHash('sha256').update(data).digest());
}

export function base58Decode(input: string): Uint8Array | null {
  let num = 0n;
  for (const ch of input) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) return null;
    num = num * 58n + BigInt(idx);
  }
  const bytes: number[] = [];
  while (num > 0n) {
    bytes.unshift(Number(num % 256n));
    num /= 256n;
  }
  for (const ch of input) {
    if (ch !== '1') break;
    bytes.unshift(0);
  }
  return new Uint8Array(bytes);
}

export function base58Encode(bytes: Uint8Array): string {
  let num = 0n;
  for (const b of bytes) num = num * 256n + BigInt(b);
  let out = '';
  while (num > 0n) {
    out = ALPHABET[Number(num % 58n)] + out;
    num /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = '1' + out;
  }
  return out;
}

export function isTronAddress(address: string): boolean {
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) return false;
  const raw = base58Decode(address);
  if (!raw || raw.length !== 25 || raw[0] !== 0x41) return false;
  const payload = raw.slice(0, 21);
  const checksum = sha256(sha256(payload)).slice(0, 4);
  return checksum.every((b, i) => b === raw[21 + i]);
}

export function isTxHash(value: string): boolean {
  return /^(0x)?[0-9a-fA-F]{64}$/.test(value);
}

export function hexToTron(hex: string): string {
  let clean = hex.toLowerCase().replace(/^0x/, '');
  if (clean.length === 40) clean = `41${clean}`;
  if (clean.length !== 42) return hex;
  const payload = new Uint8Array(clean.match(/../g)!.map((h) => parseInt(h, 16)));
  const checksum = sha256(sha256(payload)).slice(0, 4);
  const full = new Uint8Array(25);
  full.set(payload, 0);
  full.set(checksum, 21);
  return base58Encode(full);
}

function tronToAbiParam(address: string): string {
  const raw = base58Decode(address)!;
  const hex = Array.from(raw.slice(1, 21))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return hex.padStart(64, '0');
}

async function call<T>(path: string, init?: RequestInit, attempt = 0): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  const key = env.trongridKey();
  if (key) headers['TRON-PRO-API-KEY'] = key;
  if (init?.body) headers['content-type'] = 'application/json';

  const res = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
    ...init,
    headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) },
    cache: 'no-store'
  });

  if ((res.status === 429 || res.status >= 500) && attempt < 3) {
    await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    return call<T>(path, init, attempt + 1);
  }
  if (!res.ok) throw new Error(`TronGrid ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

export type Trc20Transfer = {
  transaction_id: string;
  token_info: { symbol: string; address: string; decimals: number; name: string };
  block_timestamp: number;
  from: string;
  to: string;
  type: string;
  value: string;
};

type Trc20Page = {
  data: Trc20Transfer[];
  success: boolean;
  meta?: { fingerprint?: string; links?: { next?: string } };
};

export async function fetchIncomingTrc20(address: string, minTimestamp: number, maxPages = 5) {
  const out: Trc20Transfer[] = [];
  const params = new URLSearchParams({
    only_to: 'true',
    only_confirmed: 'true',
    limit: '200',
    order_by: 'block_timestamp,asc',
    min_timestamp: String(minTimestamp)
  });
  let url: string | undefined = `/v1/accounts/${address}/transactions/trc20?${params}`;
  for (let page = 0; url && page < maxPages; page++) {
    const res: Trc20Page = await call<Trc20Page>(url);
    out.push(...(res.data || []));
    url = res.meta?.links?.next;
  }
  return out.filter((t) => t.to === address && TOKENS[t.token_info?.address]);
}

export async function fetchAccount(address: string) {
  const res = await call<{ data: { create_time?: number; address?: string }[] }>(`/v1/accounts/${address}`);
  const acc = res.data?.[0];
  return { activated: !!acc, createdAt: acc?.create_time ?? null };
}

export async function fetchTrc20Count(address: string): Promise<number> {
  const res = await call<Trc20Page>(`/v1/accounts/${address}/transactions/trc20?limit=50&only_confirmed=true`);
  return res.data?.length ?? 0;
}

export async function isTetherBlacklisted(address: string): Promise<boolean | null> {
  try {
    const res = await call<{ constant_result?: string[]; result?: { result?: boolean } }>(
      '/wallet/triggerconstantcontract',
      {
        method: 'POST',
        body: JSON.stringify({
          owner_address: USDT_CONTRACT,
          contract_address: USDT_CONTRACT,
          function_selector: 'isBlackListed(address)',
          parameter: tronToAbiParam(address),
          visible: true
        })
      }
    );
    const value = res.constant_result?.[0];
    if (!value) return null;
    return BigInt(`0x${value}`) === 1n;
  } catch {
    return null;
  }
}

type TxEvent = {
  event_name: string;
  contract_address: string;
  block_timestamp: number;
  result: Record<string, string>;
};

export async function fetchTransactionTransfers(hash: string) {
  const id = hash.replace(/^0x/, '').toLowerCase();
  const res = await call<{ data: TxEvent[] }>(`/v1/transactions/${id}/events`);
  return (res.data || [])
    .filter((e) => e.event_name === 'Transfer')
    .map((e) => {
      const contract = e.contract_address.startsWith('T') ? e.contract_address : hexToTron(e.contract_address);
      const token = TOKENS[contract];
      const from = e.result.from || e.result['0'];
      const to = e.result.to || e.result['1'];
      const value = e.result.value || e.result['2'] || '0';
      return {
        txHash: id,
        contract,
        token: token?.symbol ?? 'UNKNOWN',
        decimals: token?.decimals ?? 0,
        known: !!token,
        from: from?.startsWith('T') ? from : hexToTron(from || ''),
        to: to?.startsWith('T') ? to : hexToTron(to || ''),
        value,
        timestamp: e.block_timestamp
      };
    });
}

export function toUnits(value: string, decimals: number): string {
  const v = BigInt(value || '0');
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = (v % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole.toString();
}

export const explorer = {
  tx: (hash: string) => `https://tronscan.org/#/transaction/${hash.replace(/^0x/, '')}`,
  address: (address: string) => `https://tronscan.org/#/address/${address}`
};
