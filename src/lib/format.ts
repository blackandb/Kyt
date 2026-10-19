export function formatAmount(value: string | number, maxDecimals = 6): string {
  const str = typeof value === 'number' ? value.toString() : value;
  const [whole, frac = ''] = str.split('.');
  const grouped = BigInt(whole || '0').toLocaleString('en-US');
  const f = frac.slice(0, maxDecimals).replace(/0+$/, '');
  return f ? `${grouped}.${f}` : grouped;
}

export function formatCompact(value: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(value);
}

export function formatTime(iso: string | number | Date, timeZone: string): string {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat('en-US', { timeZone, month: '2-digit', day: '2-digit', year: 'numeric' }).format(d);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(d);
  return `${date}, ${time}`;
}

export function timeAgo(iso: string | null): string {
  if (!iso) return 'never';
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function shortHash(hash: string, head = 8, tail = 8): string {
  const h = hash.startsWith('0x') ? hash : `0x${hash}`;
  return h.length <= head + tail + 1 ? h : `${h.slice(0, head + 1)}…${h.slice(-tail)}`;
}

export function shortAddress(a: string, head = 6, tail = 6) {
  return a.length <= head + tail ? a : `${a.slice(0, head)}…${a.slice(-tail)}`;
}

export const LEVEL_LABEL = { low: 'Low', medium: 'Medium', high: 'High', severe: 'Severe' } as const;
export const LEVEL_DOT = { low: '🟢', medium: '🟡', high: '🟠', severe: '🔴' } as const;
