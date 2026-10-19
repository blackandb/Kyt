import 'server-only';
import { randomBytes, randomInt, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Case, spaces and dashes are ignored so mobile keyboards cannot break a code. */
export function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function generateCode(): string {
  const group = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  return `KYT-${group()}-${group()}-${group()}`;
}

export function hashCode(code: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(normalizeCode(code), salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyCode(code: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(normalizeCode(code), Buffer.from(saltHex, 'hex'), expected.length, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(actual, expected);
}

/** Session version: code id + fingerprint of its hash. Revoking a code invalidates its sessions. */
export function codeVersion(id: string, stored: string): string {
  return `${id}:${createHash('sha256').update(stored).digest('hex').slice(0, 12)}`;
}
