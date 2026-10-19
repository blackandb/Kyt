export const SESSION_COOKIE = 'kyt_session';
export const SESSION_MAX_AGE = 30 * 24 * 60 * 60;

function secret(): string {
  const s = process.env.SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!s) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');
  return s;
}

function toB64Url(buf: ArrayBuffer): string {
  let bin = '';
  new Uint8Array(buf).forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sign(data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toB64Url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`kyt-session:${data}`)));
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createSession(version: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE;
  const payload = `${exp}.${version}`;
  return `${payload}.${await sign(payload)}`;
}

export async function readSession(value: string | undefined): Promise<{ version: string } | null> {
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 3) return null;
  const [exp, version, sig] = parts;
  if (!/^\d+$/.test(exp) || Number(exp) < Math.floor(Date.now() / 1000)) return null;
  try {
    return safeEqual(sig, await sign(`${exp}.${version}`)) ? { version } : null;
  } catch {
    return null;
  }
}
