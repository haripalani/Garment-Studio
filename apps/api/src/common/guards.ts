// Global guards: authentication first, then rate limiting (which can key on the user).
import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyReply } from 'fastify';
import { TokenService } from '../auth/tokens';
import { RedisService } from '../infra/redis';
import { CONFIG, type Config } from '../config';
import { hmacHex } from './crypto';
import { PUBLIC, RATE, RATE_LIMITS, type AppRequest, type RateClass } from './http';
import { Problem, problems } from './problem';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(TokenService) private readonly tokens: TokenService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      // Public routes still pick up a valid token (e.g. to key rate limits per user), but never require one.
      const principal = await this.tokens.verifyAccess(header.slice(7)).catch((e: unknown) => {
        if (isPublic) return undefined;
        throw e;
      });
      if (principal) req.principal = principal;
    }
    if (!isPublic && !req.principal) throw problems.unauthorized();
    return true;
  }
}

/** Token bucket in Redis (atomic Lua), refilled continuously at limit/60 s. */
const BUCKET = `
local key, cap, now, cost = KEYS[1], tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3])
local rate = cap / 60000
local s = redis.call('HMGET', key, 't', 'ts')
local tokens = tonumber(s[1]) or cap
local ts = tonumber(s[2]) or now
tokens = math.min(cap, tokens + (now - ts) * rate)
local ok = 0
if tokens >= cost then tokens = tokens - cost; ok = 1 end
redis.call('HSET', key, 't', tokens, 'ts', now)
redis.call('PEXPIRE', key, 120000)
local wait = 0
if ok == 0 then wait = math.ceil((cost - tokens) / rate) end
return {ok, math.floor(tokens), wait}
`;

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const http = ctx.switchToHttp();
    const req = http.getRequest<AppRequest>();
    const reply = http.getResponse<FastifyReply>();
    const cls =
      this.reflector.getAllAndOverride<RateClass>(RATE, [ctx.getHandler(), ctx.getClass()]) ??
      (req.method === 'GET' || req.method === 'HEAD' ? 'read' : 'write');
    const limit = cls === 'auth' ? this.config.RATE_AUTH_PER_MIN : RATE_LIMITS[cls];
    // The auth class is always per IP (credential stuffing comes from anonymous clients).
    const who = cls !== 'auth' && req.principal ? `u:${req.principal.id}` : `ip:${hmacHex(this.config.IP_HASH_SECRET, req.ip)}`;
    const [ok, remaining, waitMs] = (await this.redis.client.eval(
      BUCKET,
      1,
      `rl:${cls}:${who}`,
      limit,
      Date.now(),
      1,
    )) as [number, number, number];
    void reply.header('RateLimit-Limit', String(limit));
    void reply.header('RateLimit-Remaining', String(Math.max(0, remaining)));
    if (!ok) {
      const retry = Math.max(1, Math.ceil(waitMs / 1000));
      void reply.header('RateLimit-Reset', String(retry));
      throw new Problem(429, 'rate_limited', 'Too many requests, please slow down', {}, { 'Retry-After': String(retry) });
    }
    return true;
  }
}
