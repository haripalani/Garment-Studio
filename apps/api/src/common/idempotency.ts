// Idempotency-Key support for POSTs that create things (ADR-0010). A repeated key with the same
// body replays the stored response; the same key with a different body is rejected.
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { RedisService } from '../infra/redis';
import { sha256Hex } from './crypto';
import { Problem, problems } from './problem';

export interface Outcome<T> {
  status: number;
  body: T;
}

const KeySchema = z.string().min(8).max(128).regex(/^[\x21-\x7e]+$/);
const TTL_S = 24 * 3600;

@Injectable()
export class Idempotency {
  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  async run<T>(
    userId: string,
    scope: string,
    key: string | undefined,
    request: unknown,
    fn: () => Promise<Outcome<T>>,
  ): Promise<Outcome<T> & { replayed: boolean }> {
    if (key === undefined) return { ...(await fn()), replayed: false };
    if (!KeySchema.safeParse(key).success) {
      throw problems.badRequest('invalid_idempotency_key', 'Idempotency-Key must be 8–128 visible ASCII characters');
    }
    const hash = sha256Hex(JSON.stringify(request ?? null));
    const k = `idem:${userId}:${scope}:${key}`;
    const claimed = await this.redis.client.set(k, JSON.stringify({ state: 'running', hash }), 'EX', 120, 'NX');
    if (!claimed) {
      const prev = JSON.parse((await this.redis.client.get(k)) ?? '{}') as {
        state?: string;
        hash?: string;
        status?: number;
        body?: T;
      };
      if (prev.hash !== hash) {
        throw new Problem(422, 'idempotency_key_reuse', 'This Idempotency-Key was used with a different request', {
          errors: [{ path: 'Idempotency-Key', message: 'Already used with a different request body' }],
        });
      }
      if (prev.state !== 'done' || prev.status === undefined) {
        throw problems.conflict('idempotency_in_progress', 'A request with this Idempotency-Key is still running');
      }
      return { status: prev.status, body: prev.body as T, replayed: true };
    }
    try {
      const out = await fn();
      await this.redis.client.set(k, JSON.stringify({ state: 'done', hash, ...out }), 'EX', TTL_S);
      return { ...out, replayed: false };
    } catch (e) {
      // Failed requests may be retried with the same key.
      await this.redis.client.del(k);
      throw e;
    }
  }
}
