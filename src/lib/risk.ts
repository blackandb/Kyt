import type { AddressSignals, DeepResult, Reason, RiskLevel, RiskResult } from '@/lib/types';

const DAY = 86_400_000;

export function levelFor(score: number): RiskLevel {
  if (score >= 90) return 'severe';
  if (score >= 70) return 'high';
  if (score >= 30) return 'medium';
  return 'low';
}

export const LEVEL_ORDER: RiskLevel[] = ['low', 'medium', 'high', 'severe'];

export function levelAtLeast(level: RiskLevel, min: RiskLevel) {
  return LEVEL_ORDER.indexOf(level) >= LEVEL_ORDER.indexOf(min);
}

export function looksLike(a: string, b: string): boolean {
  if (!a || !b || a === b) return false;
  return a.slice(0, 5) === b.slice(0, 5) && a.slice(-4) === b.slice(-4);
}

export function scoreAddress(
  s: AddressSignals,
  ctx: { amount?: number; largeAmount?: number; deep?: DeepResult | null; now?: number } = {}
): RiskResult {
  const now = ctx.now ?? Date.now();
  const reasons: Reason[] = [];
  let score = 0;
  let floor = 0;

  const add = (code: string, label: string, weight: number, tone: Reason['tone']) => {
    reasons.push({ code, label, weight, tone });
    score += weight;
  };

  if (!s.valid) {
    return {
      score: 100,
      level: 'severe',
      passed: false,
      reasons: [{ code: 'invalid', label: 'Invalid address', weight: 100, tone: 'bad' }]
    };
  }

  if (s.isOwnWallet) {
    reasons.push({ code: 'own', label: 'Transfer from one of your own wallets', weight: 0, tone: 'ok' });
    return { score: 0, level: 'low', passed: true, reasons };
  }

  if (s.tetherBlacklisted) {
    reasons.push({ code: 'tether_blacklist', label: 'Address frozen by Tether (USDT blacklist)', weight: 100, tone: 'bad' });
    floor = Math.max(floor, 100);
  } else if (s.tetherBlacklisted === false) {
    reasons.push({ code: 'tether_clear', label: 'Not on the Tether blacklist', weight: 0, tone: 'ok' });
  } else {
    reasons.push({ code: 'tether_unknown', label: 'Tether blacklist status unavailable', weight: 0, tone: 'info' });
  }

  if (s.sanctioned) {
    reasons.push({ code: 'sanctioned', label: 'Address appears on a sanctions list', weight: 100, tone: 'bad' });
    floor = Math.max(floor, 100);
  } else {
    reasons.push({ code: 'sanctions_clear', label: 'Not on the sanctions list', weight: 0, tone: 'ok' });
  }

  if (s.flagged) {
    reasons.push({
      code: 'flagged',
      label: `Flagged by you${s.flagged.label ? `: ${s.flagged.label}` : ''}`,
      weight: s.flagged.severity,
      tone: 'bad'
    });
    floor = Math.max(floor, s.flagged.severity);
  }

  if (s.trace) {
    const reasonText = { tether_blacklist: 'an address frozen by Tether', sanctions: 'a sanctioned address', flagged: 'an address you flagged' } as const;
    const severe = (r: string) => r === 'tether_blacklist' || r === 'sanctions';
    const h1 = s.trace.hits.filter((h) => h.hop === 1);
    const h2 = s.trace.hits.filter((h) => h.hop === 2);
    const h1Severe = h1.find((h) => severe(h.reason));
    const h1Flag = h1.find((h) => h.reason === 'flagged');
    const h2Severe = h2.find((h) => severe(h.reason));
    const h2Flag = h2.find((h) => h.reason === 'flagged');

    if (h1Severe) {
      add('trace_hop1', `Sender received funds directly from ${reasonText[h1Severe.reason]} (${short(h1Severe.address)})`, 60, 'bad');
      floor = Math.max(floor, 75);
    } else if (h1Flag) {
      add('trace_hop1_flag', `Sender received funds directly from ${reasonText.flagged} (${short(h1Flag.address)})`, 35, 'bad');
    }
    if (h2Severe) {
      add('trace_hop2', `Funds trace back 2 steps to ${reasonText[h2Severe.reason]} (${short(h2Severe.address)})`, 30, 'warn');
    } else if (h2Flag) {
      add('trace_hop2_flag', `Funds trace back 2 steps to ${reasonText.flagged} (${short(h2Flag.address)})`, 15, 'warn');
    }
    if (!s.trace.hits.length && s.trace.scanned > 0) {
      reasons.push({
        code: 'trace_clear',
        label: `Fund sources clean — ${s.trace.scanned} upstream addresses checked over 2 steps`,
        weight: 0,
        tone: 'ok'
      });
    }
  }

  if (s.poisoningOf) {
    add('poisoning', `Looks like ${short(s.poisoningOf)} but is a different address (possible address poisoning)`, 45, 'bad');
  }

  if (!s.activated || s.createdAt === null) {
    add('age_unknown', 'Account age could not be determined', 20, 'warn');
  } else {
    const age = now - s.createdAt;
    if (age < 3 * DAY) add('age_new', 'Address created less than 3 days ago', 35, 'warn');
    else if (age < 30 * DAY) add('age_young', 'Address created less than 30 days ago', 15, 'warn');
    else reasons.push({ code: 'age_ok', label: `Address active for ${Math.floor(age / DAY)} days`, weight: 0, tone: 'ok' });
  }

  if (s.trc20Count !== null) {
    if (s.trc20Count < 3) add('activity_none', 'Almost no token transfer history', 20, 'warn');
    else if (s.trc20Count < 10) add('activity_low', 'Low token transfer history', 10, 'warn');
    else reasons.push({ code: 'activity_ok', label: 'Established transfer history', weight: 0, tone: 'ok' });
  }

  if (
    ctx.amount !== undefined &&
    ctx.largeAmount !== undefined &&
    ctx.amount >= ctx.largeAmount &&
    s.createdAt !== null &&
    now - s.createdAt < 30 * DAY
  ) {
    add('large_from_new', 'Large amount from a recently created address', 10, 'warn');
  }

  if (ctx.deep) {
    const deepScore = Math.round(ctx.deep.score);
    const top = ctx.deep.signals
      .filter((x) => x.share > 0)
      .sort((a, b) => b.share - a.share)
      .slice(0, 3)
      .map((x) => `${x.label} ${x.share.toFixed(1)}%`)
      .join(', ');
    reasons.push({
      code: 'deep',
      label: `Deep screening score ${deepScore}${top ? ` — ${top}` : ''}`,
      weight: deepScore,
      tone: deepScore >= 70 ? 'bad' : deepScore >= 30 ? 'warn' : 'ok'
    });
    score = Math.max(score, deepScore);
  }

  const final = Math.min(100, Math.max(score, floor));
  const level = levelFor(final);
  return { score: final, level, passed: final < 70, reasons };
}

function short(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
