// Accounts, sessions and sign-in flows (ADR-0011).
import { Inject, Injectable } from '@nestjs/common';
import type { ClientPlatform, Session, TokenPurpose, User } from '@prisma/client';
import { CONFIG, type Config } from '../config';
import { newId, pkceChallenge, randomToken, safeEqual, sha256Hex } from '../common/crypto';
import { Problem, problems } from '../common/problem';
import { Audit } from '../audit/audit';
import { Db } from '../infra/prisma';
import { Mailer, type MailKind } from '../infra/mail';
import { RedisService } from '../infra/redis';
import { assertPasswordAllowed, hashPassword, verifyPassword } from './passwords';
import { ACCESS_TTL_S, TokenService } from './tokens';

const DAY = 24 * 3600 * 1000;
const REFRESH_TTL = 30 * DAY;
const SHORT_REFRESH_TTL = 12 * 3600 * 1000;
const LOCK_AFTER = 5;
const LOCK_MS = 15 * 60 * 1000;
const TOKEN_TTL: Record<TokenPurpose, number> = {
  email_verify: DAY,
  magic_link: 15 * 60 * 1000,
  password_reset: 30 * 60 * 1000,
  desktop_pkce: 2 * 60 * 1000,
};
/** Sensitive changes without a password need a sign-in this recent. */
export const RECENT_AUTH_MS = 10 * 60 * 1000;

export interface ClientInfo {
  ip: string;
  userAgent?: string | undefined;
}

export interface IssuedSession {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
  persistent: boolean;
  csrfToken: string;
  user: User & { identities: { provider: string }[] };
}

export function toUserDto(u: User & { identities?: { provider: string }[] }) {
  return {
    id: u.id,
    email: u.email,
    emailVerified: u.emailVerifiedAt !== null,
    displayName: u.displayName,
    role: u.role,
    hasPassword: u.passwordHash !== null,
    identities: (u.identities ?? []).map((i) => i.provider),
    createdAt: u.createdAt.toISOString(),
  };
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(Mailer) private readonly mail: Mailer,
    @Inject(Audit) private readonly audit: Audit,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  // ───────────── sessions ─────────────

  async issue(
    userId: string,
    platform: ClientPlatform,
    client: ClientInfo,
    opts: { persistent?: boolean; deviceName?: string; authAt?: Date; familyId?: string } = {},
  ): Promise<IssuedSession> {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId }, include: { identities: true } });
    const persistent = opts.persistent ?? true;
    const refreshToken = randomToken();
    const familyId = opts.familyId ?? newId();
    const expiresAt = new Date(Date.now() + (persistent ? REFRESH_TTL : SHORT_REFRESH_TTL));
    await this.db.session.create({
      data: {
        id: newId(),
        userId,
        familyId,
        refreshHash: sha256Hex(refreshToken),
        platform,
        deviceName: opts.deviceName ?? null,
        ipHash: this.audit.ipHash(client.ip),
        userAgent: client.userAgent?.slice(0, 300) ?? null,
        expiresAt,
        authAt: opts.authAt ?? new Date(),
        persistent,
      },
    });
    const accessToken = await this.tokens.signAccess({ id: userId, sid: familyId, role: user.role, platform });
    return {
      accessToken,
      expiresIn: ACCESS_TTL_S,
      refreshToken,
      refreshExpiresAt: expiresAt,
      persistent,
      csrfToken: randomToken(),
      user,
    };
  }

  /** Rotate a refresh token. Presenting an already-rotated or revoked token revokes the whole family. */
  async rotate(refreshToken: string, client: ClientInfo): Promise<IssuedSession> {
    const s = await this.db.session.findUnique({ where: { refreshHash: sha256Hex(refreshToken) } });
    if (!s) throw problems.unauthorized('invalid_refresh', 'Please sign in again');
    if (s.rotatedAt || s.revokedAt) {
      if (!s.revokedAt) {
        await this.revokeFamily(s.familyId);
        await this.audit.record('auth.refresh_reuse', { actorId: s.userId, target: s.familyId, ip: client.ip });
      }
      throw problems.unauthorized('invalid_refresh', 'Please sign in again');
    }
    if (s.expiresAt <= new Date()) throw problems.unauthorized('session_expired', 'Your session expired, please sign in again');
    const user = await this.db.user.findUnique({ where: { id: s.userId } });
    if (!user || user.deletedAt) throw problems.unauthorized('invalid_refresh', 'Please sign in again');
    // Compare-and-set, so two concurrent refreshes with the same token can't both succeed.
    const claimed = await this.db.session.updateMany({
      where: { id: s.id, rotatedAt: null, revokedAt: null },
      data: { rotatedAt: new Date(), lastUsedAt: new Date() },
    });
    if (claimed.count !== 1) {
      await this.revokeFamily(s.familyId);
      throw problems.unauthorized('invalid_refresh', 'Please sign in again');
    }
    return this.issue(s.userId, s.platform, client, {
      persistent: s.persistent,
      ...(s.deviceName ? { deviceName: s.deviceName } : {}),
      authAt: s.authAt,
      familyId: s.familyId,
    });
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.db.session.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.tokens.denyFamily(familyId);
  }

  async revokeAll(userId: string, exceptFamily?: string): Promise<void> {
    const families = await this.db.session.findMany({
      where: { userId, revokedAt: null, ...(exceptFamily ? { familyId: { not: exceptFamily } } : {}) },
      select: { familyId: true },
      distinct: ['familyId'],
    });
    for (const f of families) await this.revokeFamily(f.familyId);
  }

  /** The live (not rotated, not revoked) row of a session family. */
  liveSession(familyId: string): Promise<Session | null> {
    return this.db.session.findFirst({ where: { familyId, rotatedAt: null, revokedAt: null } });
  }

  // ───────────── one-time tokens ─────────────

  private async createToken(
    purpose: TokenPurpose,
    email: string,
    userId: string | null,
    codeChallenge?: string,
  ): Promise<string> {
    const raw = randomToken();
    await this.db.verificationToken.create({
      data: {
        id: newId(),
        purpose,
        email,
        userId,
        tokenHash: sha256Hex(raw),
        codeChallenge: codeChallenge ?? null,
        expiresAt: new Date(Date.now() + TOKEN_TTL[purpose]),
      },
    });
    return raw;
  }

  /** Single use: the first caller wins, later callers get token_invalid. */
  private async consumeToken(purpose: TokenPurpose, raw: string) {
    const t = await this.db.verificationToken.findUnique({ where: { tokenHash: sha256Hex(raw) } });
    if (!t || t.purpose !== purpose || t.consumedAt) {
      throw problems.badRequest('token_invalid', 'This link is invalid or was already used');
    }
    if (t.expiresAt <= new Date()) throw problems.badRequest('token_expired', 'This link has expired');
    const r = await this.db.verificationToken.updateMany({
      where: { id: t.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (r.count !== 1) throw problems.badRequest('token_invalid', 'This link is invalid or was already used');
    return t;
  }

  private link(path: string, token: string, base = this.config.APP_URL): string {
    const u = new URL(path, base);
    u.searchParams.set('token', token);
    return u.toString();
  }

  private async sendTokenMail(kind: MailKind, to: string, link: string): Promise<void> {
    await this.mail.send(kind, to, link);
  }

  /** At most `max` emails of one kind per address per window; extra requests are silently dropped. */
  private async mailBudget(kind: string, email: string, max = 3, windowS = 900): Promise<boolean> {
    const k = `mailbudget:${kind}:${sha256Hex(email)}`;
    const n = await this.redis.client.incr(k);
    if (n === 1) await this.redis.client.expire(k, windowS);
    return n <= max;
  }

  // ───────────── flows ─────────────

  async register(
    body: { email: string; password: string; displayName?: string | undefined; platform?: ClientPlatform | undefined },
    client: ClientInfo,
  ): Promise<IssuedSession> {
    await assertPasswordAllowed(body.password, this.config.PASSWORD_BREACH_CHECK);
    if (await this.db.user.findUnique({ where: { email: body.email } })) {
      throw problems.conflict('email_taken', 'An account with this email already exists');
    }
    const id = newId();
    try {
      await this.db.user.create({
        data: {
          id,
          email: body.email,
          passwordHash: await hashPassword(body.password),
          displayName: body.displayName || null,
          settings: { create: {} },
        },
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') {
        throw problems.conflict('email_taken', 'An account with this email already exists');
      }
      throw e;
    }
    const token = await this.createToken('email_verify', body.email, id);
    await this.sendTokenMail('verify', body.email, this.link('/auth/verify', token));
    await this.audit.record('auth.register', { actorId: id, ip: client.ip });
    return this.issue(id, webPlatform(body.platform), client);
  }

  async login(
    body: { email: string; password: string; remember: boolean; platform?: ClientPlatform | undefined },
    client: ClientInfo,
  ): Promise<IssuedSession> {
    const user = await this.db.user.findUnique({ where: { email: body.email } });
    const live = user && !user.deletedAt ? user : null;
    if (live?.lockedUntil && live.lockedUntil > new Date()) {
      const retry = Math.ceil((live.lockedUntil.getTime() - Date.now()) / 1000);
      throw new Problem(423, 'account_locked', 'Too many failed attempts. Try again later or reset your password.', {}, {
        'Retry-After': String(retry),
      });
    }
    const ok = await verifyPassword(live?.passwordHash, body.password);
    if (!live || !ok) {
      if (live) {
        const failed = live.failedLogins + 1;
        const lock = failed >= LOCK_AFTER;
        await this.db.user.update({
          where: { id: live.id },
          data: lock ? { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MS) } : { failedLogins: failed },
        });
        await this.audit.record(lock ? 'auth.locked' : 'auth.login_failed', { actorId: live.id, ip: client.ip });
      }
      throw problems.unauthorized('invalid_credentials', 'Email or password is incorrect');
    }
    await this.db.user.update({ where: { id: live.id }, data: { failedLogins: 0, lockedUntil: null } });
    await this.audit.record('auth.login', { actorId: live.id, ip: client.ip });
    return this.issue(live.id, webPlatform(body.platform), client, { persistent: body.remember });
  }

  allowedRedirect(uri: string | undefined): string {
    if (!uri) return this.config.APP_URL;
    const origin = new URL(uri).origin;
    const allowed = [new URL(this.config.APP_URL).origin, ...this.config.CORS_ORIGINS];
    if (!allowed.includes(origin)) {
      throw problems.validation([{ path: 'redirectUri', message: 'This redirect address is not allowed' }]);
    }
    return origin;
  }

  async requestMagicLink(email: string, redirectUri: string | undefined): Promise<void> {
    const base = this.allowedRedirect(redirectUri);
    if (!(await this.mailBudget('magic', email))) return;
    const user = await this.db.user.findUnique({ where: { email } });
    if (user?.deletedAt) return;
    const token = await this.createToken('magic_link', email, user?.id ?? null);
    await this.sendTokenMail('magic', email, this.link('/auth/magic', token, base));
  }

  async verifyMagicLink(raw: string, platform: ClientPlatform | undefined, client: ClientInfo): Promise<IssuedSession> {
    const t = await this.consumeToken('magic_link', raw);
    let user = await this.db.user.findUnique({ where: { email: t.email } });
    if (user?.deletedAt) throw problems.badRequest('token_invalid', 'This link is invalid or was already used');
    if (!user) {
      // A magic link proves the inbox, so it can also create the account (verified, no password).
      user = await this.db.user.create({
        data: { id: newId(), email: t.email, emailVerifiedAt: new Date(), settings: { create: {} } },
      });
      await this.audit.record('auth.register', { actorId: user.id, ip: client.ip, meta: { via: 'magic_link' } });
    } else if (!user.emailVerifiedAt) {
      await this.db.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
    }
    await this.db.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
    await this.audit.record('auth.magic_link', { actorId: user.id, ip: client.ip });
    return this.issue(user.id, webPlatform(platform), client);
  }

  async verifyEmail(raw: string, client: ClientInfo): Promise<void> {
    const t = await this.consumeToken('email_verify', raw);
    const user = t.userId ? await this.db.user.findUnique({ where: { id: t.userId } }) : null;
    if (!user || user.deletedAt) throw problems.badRequest('token_invalid', 'This link is invalid or was already used');
    if (t.email.toLowerCase() === user.email.toLowerCase()) {
      await this.db.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
      await this.audit.record('auth.email_verified', { actorId: user.id, ip: client.ip });
      return;
    }
    // Email change confirmed from the new inbox.
    if (await this.db.user.findUnique({ where: { email: t.email } })) {
      throw problems.conflict('email_taken', 'An account with this email already exists');
    }
    await this.db.user.update({ where: { id: user.id }, data: { email: t.email, emailVerifiedAt: new Date() } });
    await this.audit.record('account.email_change', { actorId: user.id, ip: client.ip });
  }

  async sendEmailChange(userId: string, newEmail: string): Promise<void> {
    const token = await this.createToken('email_verify', newEmail, userId);
    await this.sendTokenMail('email-change', newEmail, this.link('/auth/verify', token));
  }

  async resendVerification(userId: string): Promise<void> {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.emailVerifiedAt || !(await this.mailBudget('verify', user.email))) return;
    const token = await this.createToken('email_verify', user.email, user.id);
    await this.sendTokenMail('verify', user.email, this.link('/auth/verify', token));
  }

  async forgotPassword(email: string): Promise<void> {
    if (!(await this.mailBudget('reset', email))) return;
    const user = await this.db.user.findUnique({ where: { email } });
    if (!user || user.deletedAt) return;
    const token = await this.createToken('password_reset', email, user.id);
    await this.sendTokenMail('reset', email, this.link('/auth/reset', token));
  }

  async resetPassword(raw: string, password: string, client: ClientInfo): Promise<void> {
    await assertPasswordAllowed(password, this.config.PASSWORD_BREACH_CHECK);
    const t = await this.consumeToken('password_reset', raw);
    const user = t.userId ? await this.db.user.findUnique({ where: { id: t.userId } }) : null;
    if (!user || user.deletedAt) throw problems.badRequest('token_invalid', 'This link is invalid or was already used');
    await this.db.user.update({
      where: { id: user.id },
      // Receiving the reset email also proves the address.
      data: {
        passwordHash: await hashPassword(password),
        failedLogins: 0,
        lockedUntil: null,
        emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
      },
    });
    await this.revokeAll(user.id);
    await this.audit.record('auth.password_reset', { actorId: user.id, ip: client.ip });
  }

  /** Step 1 of the desktop flow: a signed-in browser mints a one-time code bound to the PKCE challenge. */
  async desktopCode(userId: string, codeChallenge: string): Promise<string> {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    return this.createToken('desktop_pkce', user.email, userId, codeChallenge);
  }

  /** Step 2: the desktop app exchanges the code plus its verifier for tokens (refresh token in the body). */
  async desktopToken(code: string, verifier: string, deviceName: string, client: ClientInfo): Promise<IssuedSession> {
    const t = await this.consumeToken('desktop_pkce', code);
    if (!t.userId || !t.codeChallenge || !safeEqual(pkceChallenge(verifier), t.codeChallenge)) {
      throw problems.badRequest('pkce_mismatch', 'The code verifier does not match');
    }
    const user = await this.db.user.findUnique({ where: { id: t.userId } });
    if (!user || user.deletedAt) throw problems.badRequest('token_invalid', 'This link is invalid or was already used');
    await this.audit.record('auth.desktop', { actorId: user.id, ip: client.ip, meta: { deviceName } });
    return this.issue(user.id, 'desktop', client, { deviceName });
  }

  /** Password (when the account has one) or a recent sign-in, for sensitive account changes. */
  async assertReauth(user: User, sid: string, currentPassword: string | undefined): Promise<void> {
    if (user.passwordHash) {
      if (!currentPassword || !(await verifyPassword(user.passwordHash, currentPassword))) {
        throw problems.unauthorized('invalid_credentials', 'Your current password is incorrect');
      }
      return;
    }
    const s = await this.liveSession(sid);
    if (!s || Date.now() - s.authAt.getTime() > RECENT_AUTH_MS) {
      throw problems.unauthorized('reauth_required', 'Please sign in again to make this change');
    }
  }
}

/** Cookie sessions are for browsers; the desktop app must use the PKCE exchange. */
function webPlatform(p: ClientPlatform | undefined): ClientPlatform {
  if (p === 'desktop') throw problems.badRequest('use_pkce', 'The desktop app signs in through the browser (PKCE)');
  return p ?? 'web';
}
