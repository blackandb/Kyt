import 'server-only';
import { env } from '@/lib/env';
import { formatAmount, formatTime, LEVEL_DOT, LEVEL_LABEL, shortHash } from '@/lib/format';
import type { RiskLevel } from '@/lib/types';

export type AlertPayload = {
  id: string;
  amount: string;
  token: string;
  from: string;
  walletLabel: string;
  walletAddress: string;
  network: string;
  txHash: string;
  passed: boolean;
  level: RiskLevel;
  score: number;
  time: string;
  reasons: string[];
};

const COLORS: Record<RiskLevel, string> = { low: '#46fea5', medium: '#ffca16', high: '#ff9f40', severe: '#ff9592' };

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function row(label: string, value: string, mono = true) {
  return `<tr><td style="padding:10px 0 2px;color:#74747f;font:500 11px/1.4 ui-monospace,Menlo,monospace;letter-spacing:.1em;text-transform:uppercase">${esc(label)}</td></tr>
<tr><td style="padding:0 0 8px;color:#f4f4f6;font:${mono ? '400 13px/1.5 ui-monospace,Menlo,monospace' : '500 14px/1.5 -apple-system,Segoe UI,Inter,sans-serif'};word-break:break-all">${value}</td></tr>`;
}

export function renderAlert(p: AlertPayload) {
  const tz = env.timezone();
  const color = COLORS[p.level];
  const url = env.appUrl() ? (p.id === 'test' ? env.appUrl() : `${env.appUrl()}/transfers/${p.id}`) : '';
  const amount = `${formatAmount(p.amount)} ${p.token}`;
  const subject = `You received ${amount} — ${LEVEL_LABEL[p.level]} risk (${p.score})`;

  const html = `<!doctype html><html><body style="margin:0;background:#000;padding:32px 16px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
<table role="presentation" width="100%" style="max-width:520px;background:#0c0c0f;border:1px solid #1f1f25;border-radius:20px" cellspacing="0" cellpadding="0">
<tr><td style="padding:28px 28px 8px">
<div style="color:#74747f;font:500 11px/1 ui-monospace,Menlo,monospace;letter-spacing:.12em;text-transform:uppercase">Incoming transfer</div>
<div style="margin-top:12px;color:#f4f4f6;font:600 24px/1.2 -apple-system,Segoe UI,Inter,sans-serif;letter-spacing:-.03em">You received ${esc(amount)}</div>
</td></tr>
<tr><td style="padding:8px 28px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0">
${row('Sender', esc(p.from))}
${row('Wallet', `${esc(p.walletLabel)} · ${esc(p.network)}<br>${esc(p.walletAddress)}`)}
${row('Tx', esc(shortHash(p.txHash)))}
</table></td></tr>
<tr><td style="padding:8px 28px 4px">
<table role="presentation" width="100%" style="background:#141418;border-radius:14px" cellspacing="0" cellpadding="0"><tr>
<td style="padding:14px 16px;color:#a8a8b3;font:500 13px/1.6 -apple-system,Segoe UI,Inter,sans-serif">
KYT: <b style="color:${p.passed ? '#46fea5' : '#ff9592'}">${p.passed ? 'Passed' : 'Failed'}</b><br>
Risk Level: <b style="color:${color}">${LEVEL_LABEL[p.level].toLowerCase()} ${LEVEL_DOT[p.level]}</b><br>
Score: <b style="color:#f4f4f6">${p.score}</b>
</td></tr></table>
</td></tr>
${
  p.reasons.length
    ? `<tr><td style="padding:12px 28px 0;color:#a8a8b3;font:400 13px/1.6 -apple-system,Segoe UI,Inter,sans-serif">${p.reasons
        .slice(0, 5)
        .map((r) => `• ${esc(r)}`)
        .join('<br>')}</td></tr>`
    : ''
}
<tr><td style="padding:16px 28px 0;color:#74747f;font:400 12px/1.5 ui-monospace,Menlo,monospace">Time: ${esc(formatTime(p.time, tz))}</td></tr>
${
  url
    ? `<tr><td style="padding:20px 28px 28px"><a href="${url}" style="display:inline-block;background:#f4f4f6;color:#000;text-decoration:none;font:600 13px/1 -apple-system,Segoe UI,Inter,sans-serif;padding:12px 18px;border-radius:999px">Open report</a></td></tr>`
    : '<tr><td style="padding:0 0 28px"></td></tr>'
}
</table></td></tr></table></body></html>`;

  const text = [
    `You received ${amount}!`,
    '',
    `Sender`,
    p.from,
    '',
    `${p.walletLabel} · ${p.network}`,
    p.walletAddress,
    '',
    `Tx: ${shortHash(p.txHash)}`,
    '',
    `KYT: ${p.passed ? 'Passed' : 'Failed'}`,
    `Risk Level: ${LEVEL_LABEL[p.level].toLowerCase()} ${LEVEL_DOT[p.level]}`,
    `Score: ${p.score}`,
    '',
    `Time: ${formatTime(p.time, tz)}`,
    url ? `\n${url}` : ''
  ].join('\n');

  return { subject, html, text };
}

export async function sendEmail(subject: string, html: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const key = env.resendKey();
  if (!key) return { ok: false, error: 'RESEND_API_KEY is not set' };
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env.alertFrom(), to: [env.ownerEmail()], subject, html, text }),
    cache: 'no-store'
  });
  if (!res.ok) return { ok: false, error: `Resend ${res.status}: ${(await res.text()).slice(0, 200)}` };
  return { ok: true };
}
