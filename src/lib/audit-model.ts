export type BlacklistStatus = 'blocked' | 'clear' | 'unknown';
export type AuditEvidence = { hash: string; at: number; direction: 'in' | 'out'; token: string; amount: string };
export type AuditPeer = {
  address: string; transfers: number; incomingUsdt: string; outgoingUsdt: string;
  incomingTrx: string; outgoingTrx: string; positiveTransfers: number;
  status: BlacklistStatus | null; checkedAt: string | null; sanctioned: boolean; flagged: boolean;
  evidence: AuditEvidence[];
};
export type FullAudit = {
  kind: 'full-audit'; version: 1; revision: number; address: string;
  phase: 'trc20' | 'native' | 'screen' | 'done';
  startedAt: string; updatedAt: string; before: number; since: number;
  cursor: string | null; seenCursors?: string[]; pages: number; trc20Rows: number; nativeRows: number;
  peers: AuditPeer[]; targetStatus: BlacklistStatus; targetSanctioned: boolean; targetFlagged: boolean;
  targetCheckedAt: string | null; balances: { usdt: string; trx: string } | null;
  sanctionsUpdatedAt: string | null; lastError: string | null; verificationPass: number; leaseUntil?: number;
};
export type AuditVerdict = 'BLOCKED' | 'NOT_OK' | 'INCOMPLETE' | 'OK';
export function auditVerdict(a: FullAudit): AuditVerdict {
  if (a.targetStatus === 'blocked' || a.targetSanctioned || a.targetFlagged) return 'BLOCKED';
  if (a.peers.some(p => p.status === 'blocked' || p.sanctioned || p.flagged)) return 'NOT_OK';
  if (a.phase !== 'done' || a.targetStatus === 'unknown' || a.balances === null ||
      a.peers.some(p => p.status === null || p.status === 'unknown')) return 'INCOMPLETE';
  return 'OK';
}
export function units(raw: string, decimals = 6): string {
  const n = BigInt(raw);
  const base = 10n ** BigInt(decimals);
  const f = (n % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return (n / base).toString() + (f ? '.' + f : '');
}
export function peerFor(a: FullAudit, address: string): AuditPeer {
  let peer = a.peers.find(p => p.address === address);
  if (!peer) {
    peer = { address, transfers: 0, incomingUsdt: '0', outgoingUsdt: '0', incomingTrx: '0', outgoingTrx: '0',
      positiveTransfers: 0, status: null, checkedAt: null, sanctioned: false, flagged: false, evidence: [] };
    a.peers.push(peer);
  }
  return peer;
}
export function recordTransfer(a: FullAudit, t: {
  from: string; to: string; raw: string; token: string; decimals: number; hash: string; at: number;
}) {
  if (t.from === t.to || (t.from !== a.address && t.to !== a.address)) return;
  if (!/^\d+$/.test(t.raw) || !Number.isInteger(t.decimals) || t.decimals < 0 || t.decimals > 36)
    throw new Error('Malformed transfer amount; history cannot be certified complete.');
  const direction = t.to === a.address ? 'in' : 'out';
  const p = peerFor(a, direction === 'in' ? t.from : t.to);
  p.transfers++;
  if (BigInt(t.raw) > 0n) p.positiveTransfers++;
  const key = t.token === 'USDT' ? (direction === 'in' ? 'incomingUsdt' : 'outgoingUsdt') :
    t.token === 'TRX' ? (direction === 'in' ? 'incomingTrx' : 'outgoingTrx') : null;
  if (key) p[key] = (BigInt(p[key]) + BigInt(t.raw)).toString();
  // Keep evidence bounded, preferring positive-value transfers over zero-value spam.
  const e: AuditEvidence = { hash: t.hash, at: t.at, direction, token: t.token, amount: units(t.raw, t.decimals) };
  if (p.evidence.length < 20) p.evidence.push(e);
  else if (BigInt(t.raw) > 0n) {
    const i = p.evidence.findIndex(x => x.amount === '0');
    if (i >= 0) p.evidence[i] = e;
  }
}
