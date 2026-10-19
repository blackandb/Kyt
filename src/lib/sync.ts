import 'server-only';
import { db } from '@/lib/supabase/admin';
import { fetchIncomingTrc20, toUnits, TOKENS } from '@/lib/tron';
import { scoreAddress, levelAtLeast } from '@/lib/risk';
import { collectSignals, getContext, getSettings } from '@/lib/signals';
import { renderAlert, sendEmail } from '@/lib/email';
import type { Wallet } from '@/lib/types';

const MAX_PER_RUN = 120;

export type SyncSummary = { wallets: number; found: number; inserted: number; alerts: number; errors: string[] };

export async function syncAll(): Promise<SyncSummary> {
  const client = db();
  const settings = await getSettings();
  const ctx = await getContext();
  const { data: walletRows } = await client.from('wallets').select('*').eq('active', true).order('created_at');
  const wallets = (walletRows || []) as Wallet[];
  const summary: SyncSummary = { wallets: wallets.length, found: 0, inserted: 0, alerts: 0, errors: [] };
  const memo = new Map<string, Awaited<ReturnType<typeof collectSignals>>>();
  let budget = MAX_PER_RUN;

  for (const wallet of wallets) {
    if (budget <= 0) break;
    try {
      const items = await fetchIncomingTrc20(wallet.address, Number(wallet.last_seen_ts) + 1);
      summary.found += items.length;
      let lastSeen = Number(wallet.last_seen_ts);

      for (const t of items) {
        if (budget <= 0) break;
        budget--;
        lastSeen = Math.max(lastSeen, t.block_timestamp);

        const token = TOKENS[t.token_info.address];
        const amount = toUnits(t.value, token.decimals);
        const amountNum = Number(amount);
        if (amountNum < Number(settings.min_amount)) continue;

        const eventKey = `${t.transaction_id}:${t.from}:${t.to}:${t.value}`;
        const { data: exists } = await client.from('transfers').select('id').eq('event_key', eventKey).maybeSingle();
        if (exists) continue;

        const wantDeep = settings.deep_check_enabled && amountNum >= Number(settings.deep_check_threshold);
        const memoKey = `${t.from}:${wantDeep}`;
        let collected = memo.get(memoKey);
        if (!collected) {
          collected = await collectSignals(t.from, ctx, { cacheHours: settings.cache_hours, deep: wantDeep });
          memo.set(memoKey, collected);
        }

        const risk = scoreAddress(collected.signals, {
          amount: amountNum,
          largeAmount: Number(settings.deep_check_threshold),
          deep: collected.deep
        });

        const blockIso = new Date(t.block_timestamp).toISOString();
        const { data: inserted, error } = await client
          .from('transfers')
          .insert({
            wallet_id: wallet.id,
            network: 'TRON',
            event_key: eventKey,
            tx_hash: t.transaction_id,
            token: token.symbol,
            token_contract: t.token_info.address,
            amount,
            from_address: t.from,
            to_address: t.to,
            block_ts: blockIso,
            risk_score: risk.score,
            risk_level: risk.level,
            kyt_passed: risk.passed,
            reasons: risk.reasons,
            signals: { ...collected.signals, deep: collected.deep },
            deep_checked: !!collected.deep
          })
          .select('id')
          .single();

        if (error) {
          if (!error.message.includes('duplicate')) summary.errors.push(`${wallet.label}: ${error.message}`);
          continue;
        }
        summary.inserted++;

        const isNew = t.block_timestamp >= new Date(wallet.created_at).getTime();
        const shouldAlert =
          isNew &&
          (settings.alert_mode === 'all' ||
            (settings.alert_mode === 'risk' && levelAtLeast(risk.level, settings.alert_min_level)));

        if (shouldAlert && inserted) {
          const mail = renderAlert({
            id: inserted.id,
            amount,
            token: token.symbol,
            from: t.from,
            walletLabel: wallet.label,
            walletAddress: wallet.address,
            network: wallet.network,
            txHash: t.transaction_id,
            passed: risk.passed,
            level: risk.level,
            score: risk.score,
            time: blockIso,
            reasons: risk.reasons.filter((r) => r.tone === 'bad' || r.tone === 'warn').map((r) => r.label)
          });
          const sent = await sendEmail(mail.subject, mail.html, mail.text);
          if (sent.ok) {
            summary.alerts++;
            await client.from('transfers').update({ alerted: true }).eq('id', inserted.id);
          } else if (sent.error) {
            summary.errors.push(`Email: ${sent.error}`);
          }
        }
      }

      await client
        .from('wallets')
        .update({ last_seen_ts: lastSeen, last_synced_at: new Date().toISOString(), last_error: null })
        .eq('id', wallet.id);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      summary.errors.push(`${wallet.label}: ${message}`);
      await client.from('wallets').update({ last_error: message.slice(0, 300), last_synced_at: new Date().toISOString() }).eq('id', wallet.id);
    }
  }

  return summary;
}
