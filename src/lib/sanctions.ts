import 'server-only';
import { db } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import { isTronAddress } from '@/lib/tron';

export async function syncSanctions(): Promise<{ ok: boolean; count: number; error?: string }> {
  try {
    const res = await fetch(env.sanctionsUrl(), { cache: 'no-store' });
    if (!res.ok) return { ok: false, count: 0, error: `List download failed (${res.status})` };
    const text = await res.text();
    const addresses = Array.from(
      new Set(
        text
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => isTronAddress(l))
      )
    );
    if (addresses.length === 0) return { ok: false, count: 0, error: 'List contained no valid TRON addresses' };

    const client = db();
    await client.from('flagged_addresses').delete().eq('source', 'sanctions');
    for (let i = 0; i < addresses.length; i += 500) {
      const chunk = addresses.slice(i, i + 500).map((address) => ({
        address,
        network: 'TRON',
        source: 'sanctions',
        label: 'OFAC sanctions list',
        severity: 100
      }));
      const { error } = await client.from('flagged_addresses').upsert(chunk, { onConflict: 'address', ignoreDuplicates: true });
      if (error) return { ok: false, count: i, error: error.message };
    }
    await client.from('settings').update({ sanctions_synced_at: new Date().toISOString() }).eq('id', 1);
    return { ok: true, count: addresses.length };
  } catch (e) {
    return { ok: false, count: 0, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}
