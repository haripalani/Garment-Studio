// Password hashing (argon2id, ADR-0011) and the optional breached-password check.
import { hash, verify } from '@node-rs/argon2';
import { createHash } from 'node:crypto';
import { problems } from '../common/problem';

const OPTIONS = { algorithm: 2 /* Argon2id */, memoryCost: 65536, timeCost: 3, parallelism: 1 } as const;

export const hashPassword = (password: string): Promise<string> => hash(password, OPTIONS);

/** Verifies against a fixed dummy hash when the account doesn't exist, so timing doesn't reveal it. */
let dummy: Promise<string> | undefined;
export async function verifyPassword(stored: string | null | undefined, password: string): Promise<boolean> {
  if (!stored) {
    dummy ??= hash('timing-equaliser-not-a-password', OPTIONS);
    await verify(await dummy, password).catch(() => false);
    return false;
  }
  return verify(stored, password).catch(() => false);
}

/**
 * Have I Been Pwned range API (k-anonymity): only the first 5 hex chars of the SHA-1 leave the server.
 * Returns how many breaches contain the password.
 */
export async function breachCount(password: string, fetchImpl: typeof fetch = fetch): Promise<number> {
  const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);
  const res = await fetchImpl(`https://api.pwnedpasswords.com/range/${prefix}`, {
    headers: { 'Add-Padding': 'true', 'User-Agent': 'garment-studio-api' },
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) throw new Error(`pwnedpasswords ${res.status}`);
  for (const line of (await res.text()).split('\n')) {
    const [s, n] = line.trim().split(':');
    if (s === suffix) return Number(n) || 0;
  }
  return 0;
}

export async function assertPasswordAllowed(
  password: string,
  enabled: boolean,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (!enabled) return;
  let n: number;
  try {
    n = await breachCount(password, fetchImpl);
  } catch {
    // The check is advisory hardening; an outage of the external service must not block sign-up.
    return;
  }
  if (n > 0) {
    throw problems.validation(
      [{ path: 'password', message: 'This password has appeared in a data breach. Please choose another.' }],
      'Choose a different password',
    );
  }
}
