import 'server-only';
import { createHash } from 'node:crypto';
import { env } from '@/lib/env';
import type { DeepResult } from '@/lib/types';

export function deepCheckConfigured() {
  const c = env.amlbot();
  return !!(c.accessId && c.accessKey);
}

export async function deepCheck(address: string, asset = 'TRX'): Promise<DeepResult | null> {
  const c = env.amlbot();
  if (!c.accessId || !c.accessKey) return null;

  const token = createHash('md5').update(`${address}:${c.accessKey}:${c.accessId}`).digest('hex');
  const body = new URLSearchParams({ hash: address, asset, accessId: c.accessId, token, locale: 'en_US' });

  try {
    const res = await fetch(c.url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      cache: 'no-store'
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      result?: boolean;
      data?: { riskscore?: number; signals?: Record<string, number> };
    };
    if (!json.result || !json.data || typeof json.data.riskscore !== 'number') return null;

    const raw = json.data.riskscore;
    const score = raw <= 1 ? raw * 100 : raw;
    const signals = Object.entries(json.data.signals || {}).map(([key, share]) => ({
      label: key.replace(/_/g, ' '),
      share: share <= 1 ? share * 100 : share
    }));
    return { provider: 'AMLBot', score: Math.round(score), signals, raw: json.data };
  } catch {
    return null;
  }
}
