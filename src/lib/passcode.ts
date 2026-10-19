import 'server-only';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

export function hashCode(code: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(code, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyCode(code: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(code, Buffer.from(saltHex, 'hex'), expected.length, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(actual, expected);
}

/** Short fingerprint of the stored hash; changing the code invalidates every open session. */
export function codeVersion(stored: string): string {
  return createHash('sha256').update(stored).digest('hex').slice(0, 12);
}
