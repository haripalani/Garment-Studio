// Access tokens (EdDSA JWT, 10 min) and signed entitlement snapshots (ADR-0011, ADR-0012).
import { Inject, Injectable } from '@nestjs/common';
import type { ClientPlatform, Role } from '@prisma/client';
import { SignJWT, importJWK, jwtVerify, type CryptoKey, type JWK, type KeyObject } from 'jose';
import { CONFIG, type Config } from '../config';
import type { Principal } from '../common/http';
import { problems } from '../common/problem';
import { RedisService } from '../infra/redis';

const ISSUER = 'garment-studio';
const API_AUDIENCE = 'gs-api';
const SNAPSHOT_AUDIENCE = 'gs-entitlements';
export const ACCESS_TTL_S = 600;
export const SNAPSHOT_TTL_S = 24 * 3600;

type Key = CryptoKey | KeyObject | Uint8Array;

@Injectable()
export class TokenService {
  private keys?: Promise<{ priv: Key; pub: Key }>;
  readonly publicJwk: JWK;

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {
    const { d: _d, ...pub } = config.JWT_PRIVATE_JWK;
    this.publicJwk = { ...pub, alg: 'EdDSA', use: 'sig' };
  }

  private load() {
    this.keys ??= Promise.all([
      importJWK({ ...this.config.JWT_PRIVATE_JWK }, 'EdDSA'),
      importJWK(this.publicJwk, 'EdDSA'),
    ]).then(([priv, pub]) => ({ priv, pub }));
    return this.keys;
  }

  async signAccess(p: Principal): Promise<string> {
    const { priv } = await this.load();
    return new SignJWT({ sid: p.sid, role: p.role, plt: p.platform })
      .setProtectedHeader({ alg: 'EdDSA', kid: this.config.JWT_PRIVATE_JWK.kid })
      .setIssuer(ISSUER)
      .setAudience(API_AUDIENCE)
      .setSubject(p.id)
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TTL_S}s`)
      .sign(priv);
  }

  async verifyAccess(token: string): Promise<Principal> {
    const { pub } = await this.load();
    let payload;
    try {
      ({ payload } = await jwtVerify(token, pub, { issuer: ISSUER, audience: API_AUDIENCE, algorithms: ['EdDSA'] }));
    } catch {
      throw problems.unauthorized('invalid_token', 'The access token is invalid or expired');
    }
    const sid = String(payload.sid);
    // Access tokens are short-lived; revoked sessions are blocked straight away through this deny-list.
    if (await this.redis.client.exists(`revoked:${sid}`)) {
      throw problems.unauthorized('session_revoked', 'This session was signed out');
    }
    return {
      id: String(payload.sub),
      sid,
      role: payload.role as Role,
      platform: payload.plt as ClientPlatform,
    };
  }

  /** Called whenever a session family is revoked, so its outstanding access tokens stop working. */
  async denyFamily(familyId: string): Promise<void> {
    await this.redis.client.set(`revoked:${familyId}`, '1', 'EX', ACCESS_TTL_S + 60);
  }

  async signSnapshot(userId: string, claims: Record<string, unknown>): Promise<string> {
    const { priv } = await this.load();
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'EdDSA', kid: this.config.JWT_PRIVATE_JWK.kid, typ: 'entitlements+jwt' })
      .setIssuer(ISSUER)
      .setAudience(SNAPSHOT_AUDIENCE)
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime(`${SNAPSHOT_TTL_S}s`)
      .sign(priv);
  }
}
