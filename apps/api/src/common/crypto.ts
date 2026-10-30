import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createId } from '@paralleldrive/cuid2';

/** cuid2, 24 chars, matches the API `Id` pattern. */
export const newId = (): string => createId();

/** 256-bit URL-safe random token (43 chars). */
export const randomToken = (): string => randomBytes(32).toString('base64url');

export const sha256Hex = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex');

export const hmacHex = (secret: string, data: string): string => createHmac('sha256', secret).update(data).digest('hex');

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** PKCE S256: BASE64URL(SHA256(verifier)). */
export const pkceChallenge = (verifier: string): string => createHash('sha256').update(verifier).digest('base64url');
