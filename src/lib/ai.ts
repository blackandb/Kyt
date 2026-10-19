import 'server-only';
import { db } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import { runCheck, type CheckResult } from '@/lib/check';
import { deepCheckConfigured } from '@/lib/amlbot';
import type { RiskLevel } from '@/lib/types';

const API = 'https://api.anthropic.com/v1/messages';
const MAX_STEPS = 6;

type TextBlock = { type: 'text'; text: string };
type ToolUseBlock = { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };
type ToolResultBlock = { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };
type Block = TextBlock | ToolUseBlock | ToolResultBlock;
type Message = { role: 'user' | 'assistant'; content: string | Block[] };

export type ChatTurn = { role: 'user' | 'assistant'; content: string };
export type ChatResponse = { reply: string; checks: CheckResult[]; tools: string[] };

const LEVELS: RiskLevel[] = ['low', 'medium', 'high', 'severe'];

const TOOLS = [
  {
    name: 'check_address',
    description:
      'Screen a TRON address now: Tether blacklist, sanctions list, owner flags, address age, activity, address-poisoning resemblance. Returns score 0-100, level, KYT passed/failed and reasons.',
    input_schema: {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'TRON address starting with T' },
        deep: { type: 'boolean', description: 'Also run the paid deep screening. Only when the user explicitly asks.' }
      },
      required: ['address']
    }
  },
  {
    name: 'check_transaction',
    description: 'Look up a TRON transaction by hash, list its token transfers and screen each sender.',
    input_schema: {
      type: 'object',
      properties: {
        hash: { type: 'string', description: '64-char transaction hash, with or without 0x' },
        deep: { type: 'boolean', description: 'Also run the paid deep screening. Only when the user explicitly asks.' }
      },
      required: ['hash']
    }
  },
  {
    name: 'list_transfers',
    description: 'List incoming transfers already recorded on the monitored wallets, newest first.',
    input_schema: {
      type: 'object',
      properties: {
        level: { type: 'string', enum: LEVELS, description: 'Only this risk level' },
        min_level: { type: 'string', enum: LEVELS, description: 'This risk level or higher' },
        wallet_label: { type: 'string', description: 'Wallet label, e.g. "Wallet 4"' },
        sender: { type: 'string', description: 'Only transfers from this sender address' },
        since_hours: { type: 'number', description: 'Only the last N hours' },
        limit: { type: 'number', description: 'Max rows, default 20, max 50' }
      }
    }
  },
  {
    name: 'get_transfer',
    description: 'Full screening report of one recorded transfer, by transfer id or transaction hash.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string' }, tx_hash: { type: 'string' } }
    }
  },
  {
    name: 'summary',
    description: 'Totals for a period: received amounts by token, counts by risk level, per wallet.',
    input_schema: {
      type: 'object',
      properties: { since_hours: { type: 'number', description: 'Default 24' } }
    }
  },
  {
    name: 'list_wallets',
    description: 'Monitored wallets with label, address, status and last sync.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'list_flags',
    description: 'Addresses flagged by the owner, and the number of sanctioned addresses loaded.',
    input_schema: { type: 'object', properties: {} }
  }
];

function system() {
  const today = new Date().toISOString().slice(0, 10);
  return `You are the assistant inside KYT Monitor, a private dashboard where one owner monitors their own TRON wallets and screens incoming USDT/USDC transfers.

Today is ${today}. Display timezone: ${env.timezone()}.

Rules:
- Reply in the language the owner writes in (often Romanian or English).
- Every score, level, address fact and transfer must come from a tool result in this conversation. Never invent or estimate them.
- When the owner pastes a TRON address (starts with T) or a transaction hash, call the matching check tool first.
- Deep screening is a paid check: use deep=true only when the owner explicitly asks for it.${deepCheckConfigured() ? '' : ' It is not configured in this deployment.'}
- Scale: 0-29 low, 30-69 medium, 70-89 high, 90-100 severe. KYT passes below 70. Tether blacklist or sanctions match means 100.
- Be brief and executive: the verdict first, then the 2-4 reasons that drove it, then one practical recommendation. Use short bullets.
- The score is a risk indicator built from public signals, not a legal or compliance determination; say so only when the owner asks for certainty or a verdict on legality.
- The UI shows a card for each check, so do not repeat full addresses or hashes; shorten them like TEPKBV…GEQp.`;
}

function clampLimit(v: unknown, def = 20) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(50, Math.max(1, Math.floor(n))) : def;
}

async function execTool(name: string, input: Record<string, unknown>, checks: CheckResult[]): Promise<unknown> {
  const client = db();
  switch (name) {
    case 'check_address':
    case 'check_transaction': {
      const q = String(input.address ?? input.hash ?? '');
      const result = await runCheck(q, input.deep === true);
      checks.push(result);
      if (result.kind === 'address') {
        return {
          address: result.address,
          score: result.risk.score,
          level: result.risk.level,
          kyt: result.risk.passed ? 'passed' : 'failed',
          reasons: result.risk.reasons.map((r) => `${r.tone}: ${r.label}${r.weight ? ` (+${r.weight})` : ''}`),
          address_created_at: result.signals.createdAt ? new Date(result.signals.createdAt).toISOString() : null,
          token_transfers_seen: result.signals.trc20Count,
          own_wallet: result.signals.isOwnWallet,
          deep: result.deep ? { provider: result.deep.provider, score: result.deep.score } : null
        };
      }
      if (result.kind === 'transaction') {
        return {
          hash: result.hash,
          transfers: result.transfers.map((t) => ({
            token: t.token,
            known_token: t.known,
            amount: t.amount,
            from: t.from,
            to: t.to,
            to_own_wallet: t.toOwnWallet,
            time: new Date(t.timestamp).toISOString(),
            sender_score: t.sender.risk.score,
            sender_level: t.sender.risk.level,
            kyt: t.sender.risk.passed ? 'passed' : 'failed',
            sender_reasons: t.sender.risk.reasons.filter((r) => r.tone !== 'ok').map((r) => r.label)
          }))
        };
      }
      return { error: result.message };
    }

    case 'list_transfers': {
      let q = client
        .from('transfers')
        .select('id, tx_hash, token, amount, from_address, to_address, block_ts, risk_score, risk_level, kyt_passed, wallets(label)')
        .order('block_ts', { ascending: false })
        .limit(clampLimit(input.limit));
      if (typeof input.level === 'string' && LEVELS.includes(input.level as RiskLevel)) q = q.eq('risk_level', input.level);
      if (typeof input.min_level === 'string' && LEVELS.includes(input.min_level as RiskLevel)) {
        q = q.in('risk_level', LEVELS.slice(LEVELS.indexOf(input.min_level as RiskLevel)));
      }
      if (typeof input.sender === 'string' && input.sender) q = q.eq('from_address', input.sender.trim());
      if (typeof input.since_hours === 'number' && input.since_hours > 0) {
        q = q.gte('block_ts', new Date(Date.now() - input.since_hours * 3_600_000).toISOString());
      }
      if (typeof input.wallet_label === 'string' && input.wallet_label) {
        const { data: w } = await client.from('wallets').select('id').ilike('label', input.wallet_label.trim());
        q = q.in('wallet_id', (w || []).map((x) => x.id));
      }
      const { data, error } = await q;
      if (error) return { error: error.message };
      return { count: data?.length ?? 0, transfers: data };
    }

    case 'get_transfer': {
      let q = client.from('transfers').select('*, wallets(label, address)');
      if (typeof input.id === 'string' && /^[0-9a-f-]{36}$/i.test(input.id)) q = q.eq('id', input.id);
      else if (typeof input.tx_hash === 'string') q = q.eq('tx_hash', input.tx_hash.replace(/^0x/, '').toLowerCase());
      else return { error: 'Provide id or tx_hash' };
      const { data } = await q.limit(1).maybeSingle();
      if (!data) return { error: 'Transfer not found among recorded transfers' };
      const { signals, ...rest } = data as Record<string, unknown> & { signals?: Record<string, unknown> };
      return { ...rest, sender_created_at: signals?.createdAt ?? null, deep: signals?.deep ?? null };
    }

    case 'summary': {
      const hours = typeof input.since_hours === 'number' && input.since_hours > 0 ? input.since_hours : 24;
      const { data } = await client
        .from('transfers')
        .select('token, amount, risk_level, kyt_passed, wallets(label)')
        .gte('block_ts', new Date(Date.now() - hours * 3_600_000).toISOString())
        .limit(5000);
      const rows = (data || []) as unknown as { token: string; amount: string; risk_level: RiskLevel; kyt_passed: boolean; wallets: { label: string } | null }[];
      const byToken: Record<string, number> = {};
      const byLevel: Record<string, number> = { low: 0, medium: 0, high: 0, severe: 0 };
      const byWallet: Record<string, { count: number; amount: number }> = {};
      let failed = 0;
      for (const r of rows) {
        byToken[r.token] = (byToken[r.token] || 0) + Number(r.amount);
        byLevel[r.risk_level]++;
        if (!r.kyt_passed) failed++;
        const w = r.wallets?.label ?? 'Unknown';
        byWallet[w] = byWallet[w] || { count: 0, amount: 0 };
        byWallet[w].count++;
        byWallet[w].amount += Number(r.amount);
      }
      return { period_hours: hours, transfers: rows.length, kyt_failed: failed, received_by_token: byToken, by_level: byLevel, by_wallet: byWallet };
    }

    case 'list_wallets': {
      const { data } = await client.from('wallets').select('label, address, network, active, last_synced_at, last_error').order('created_at');
      return { wallets: data };
    }

    case 'list_flags': {
      const [{ data }, { count }] = await Promise.all([
        client.from('flagged_addresses').select('address, label, severity, created_at').eq('source', 'manual').limit(100),
        client.from('flagged_addresses').select('address', { count: 'exact', head: true }).eq('source', 'sanctions')
      ]);
      return { owner_flags: data, sanctioned_addresses_loaded: count ?? 0 };
    }

    default:
      return { error: `Unknown tool ${name}` };
  }
}

async function callClaude(messages: Message[]) {
  const res = await fetch(API, {
    method: 'POST',
    headers: {
      'x-api-key': env.anthropicKey(),
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({ model: env.anthropicModel(), max_tokens: 1500, system: system(), tools: TOOLS, messages }),
    cache: 'no-store'
  });
  if (!res.ok) throw new Error(`AI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as { content: Block[]; stop_reason: string };
}

export async function chat(history: ChatTurn[]): Promise<ChatResponse> {
  const messages: Message[] = history
    .filter((m) => m.content.trim())
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
  while (messages.length && messages[0].role !== 'user') messages.shift();

  const checks: CheckResult[] = [];
  const tools: string[] = [];

  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await callClaude(messages);
    messages.push({ role: 'assistant', content: res.content });

    const uses = res.content.filter((b): b is ToolUseBlock => b.type === 'tool_use');
    if (res.stop_reason !== 'tool_use' || uses.length === 0) {
      const reply = res.content
        .filter((b): b is TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      return { reply, checks, tools };
    }

    const results: ToolResultBlock[] = [];
    for (const u of uses) {
      tools.push(u.name);
      try {
        const out = await execTool(u.name, u.input || {}, checks);
        results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out).slice(0, 20000) });
      } catch (e) {
        results.push({ type: 'tool_result', tool_use_id: u.id, content: e instanceof Error ? e.message : 'Tool failed', is_error: true });
      }
    }
    messages.push({ role: 'user', content: results });
  }

  return { reply: 'The request needed too many steps. Ask a narrower question.', checks, tools };
}
