import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import {
  DesktopCodeRequest,
  DesktopTokenRequest,
  ForgotPasswordRequest,
  LoginRequest,
  MagicLinkRequest,
  MagicLinkVerifyRequest,
  RefreshRequest,
  RegisterRequest,
  ResetPasswordRequest,
  TokenRequest,
} from '@gs/core';
import { CONFIG, type Config } from '../config';
import { CurrentUser, Public, Rate, type AppRequest, type Principal } from '../common/http';
import { safeEqual } from '../common/crypto';
import { Problem, problems } from '../common/problem';
import { parse } from '../common/zod';
import { Audit } from '../audit/audit';
import { AuthService, toUserDto, type ClientInfo, type IssuedSession } from './auth.service';
import { TokenService } from './tokens';

export const REFRESH_COOKIE = 'gs_rt';
export const CSRF_COOKIE = 'gs_csrf';

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(Audit) private readonly audit: Audit,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  private client(req: AppRequest): ClientInfo {
    return { ip: req.ip, userAgent: req.headers['user-agent'] };
  }

  /** Web/PWA: refresh token in an HttpOnly cookie scoped to /v1/auth, plus a readable CSRF cookie. */
  private respond(reply: FastifyReply, s: IssuedSession) {
    const maxAge = s.persistent ? Math.floor((s.refreshExpiresAt.getTime() - Date.now()) / 1000) : undefined;
    const base = { secure: this.config.COOKIE_SECURE, sameSite: 'lax' as const, ...(maxAge ? { maxAge } : {}) };
    void reply.setCookie(REFRESH_COOKIE, s.refreshToken, { ...base, httpOnly: true, path: '/v1/auth' });
    void reply.setCookie(CSRF_COOKIE, s.csrfToken, {
      ...base,
      httpOnly: false,
      path: '/',
      ...(this.config.COOKIE_DOMAIN ? { domain: this.config.COOKIE_DOMAIN } : {}),
    });
    return { accessToken: s.accessToken, expiresIn: s.expiresIn, csrfToken: s.csrfToken, user: toUserDto(s.user) };
  }

  private clearCookies(reply: FastifyReply) {
    void reply.clearCookie(REFRESH_COOKIE, { path: '/v1/auth' });
    void reply.clearCookie(CSRF_COOKIE, { path: '/', ...(this.config.COOKIE_DOMAIN ? { domain: this.config.COOKIE_DOMAIN } : {}) });
  }

  /** Double-submit CSRF check plus an Origin allow-list, for requests authenticated by cookie. */
  private assertCsrf(req: AppRequest) {
    const origin = req.headers.origin;
    if (origin && !this.config.CORS_ORIGINS.includes(origin)) {
      throw problems.forbidden('origin_not_allowed', 'This origin may not use cookie sessions');
    }
    const header = req.headers['x-csrf-token'];
    const cookie = req.cookies[CSRF_COOKIE];
    if (typeof header !== 'string' || !cookie || !safeEqual(header, cookie)) {
      throw problems.forbidden('csrf_failed', 'Missing or invalid CSRF token');
    }
  }

  @Public()
  @Rate('auth')
  @Post('register')
  @HttpCode(201)
  async register(@Body() body: unknown, @Req() req: AppRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    return this.respond(reply, await this.auth.register(parse(RegisterRequest, body), this.client(req)));
  }

  @Public()
  @Rate('auth')
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Req() req: AppRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    return this.respond(reply, await this.auth.login(parse(LoginRequest, body), this.client(req)));
  }

  @Public()
  @Rate('auth')
  @Post('magic-link')
  @HttpCode(202)
  async magicLink(@Body() body: unknown) {
    const b = parse(MagicLinkRequest, body);
    await this.auth.requestMagicLink(b.email, b.redirectUri);
  }

  @Public()
  @Rate('auth')
  @Post('magic-link/verify')
  @HttpCode(200)
  async magicVerify(@Body() body: unknown, @Req() req: AppRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const b = parse(MagicLinkVerifyRequest, body);
    return this.respond(reply, await this.auth.verifyMagicLink(b.token, b.platform, this.client(req)));
  }

  @Public()
  @Rate('auth')
  @Post('email/verify')
  @HttpCode(204)
  async verifyEmail(@Body() body: unknown, @Req() req: AppRequest) {
    await this.auth.verifyEmail(parse(TokenRequest, body).token, this.client(req));
  }

  @Rate('auth')
  @Post('email/resend')
  @HttpCode(202)
  async resend(@CurrentUser() me: Principal) {
    await this.auth.resendVerification(me.id);
  }

  @Public()
  @Rate('auth')
  @Post('password/forgot')
  @HttpCode(202)
  async forgot(@Body() body: unknown) {
    await this.auth.forgotPassword(parse(ForgotPasswordRequest, body).email);
  }

  @Public()
  @Rate('auth')
  @Post('password/reset')
  @HttpCode(204)
  async reset(@Body() body: unknown, @Req() req: AppRequest) {
    const b = parse(ResetPasswordRequest, body);
    await this.auth.resetPassword(b.token, b.password, this.client(req));
  }

  // Not the strict sign-in class: a refresh needs an unguessable token, and every page load in every
  // tab refreshes (a shared office IP would otherwise hit the limit).
  @Public()
  @Rate('write')
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body() body: unknown, @Req() req: AppRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const b = parse(RefreshRequest, body ?? {});
    if (b.refreshToken) {
      // Desktop: token in the body, new token back in the body (it lives in the OS keychain).
      const s = await this.auth.rotate(b.refreshToken, this.client(req));
      return {
        accessToken: s.accessToken,
        expiresIn: s.expiresIn,
        user: toUserDto(s.user),
        refreshToken: s.refreshToken,
        refreshExpiresAt: s.refreshExpiresAt.toISOString(),
      };
    }
    const cookie = req.cookies[REFRESH_COOKIE];
    if (!cookie) throw problems.unauthorized('invalid_refresh', 'Please sign in again');
    this.assertCsrf(req);
    try {
      return this.respond(reply, await this.auth.rotate(cookie, this.client(req)));
    } catch (e) {
      this.clearCookies(reply);
      throw e;
    }
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentUser() me: Principal, @Req() req: AppRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    await this.auth.revokeFamily(me.sid);
    this.clearCookies(reply);
    await this.audit.record('auth.logout', { actorId: me.id, ip: req.ip });
  }

  @Rate('auth')
  @Post('desktop/code')
  @HttpCode(201)
  async desktopCode(@CurrentUser() me: Principal, @Body() body: unknown) {
    const b = parse(DesktopCodeRequest, body);
    const code = await this.auth.desktopCode(me.id, b.codeChallenge);
    const redirect = new URL(b.redirectUri);
    redirect.searchParams.set('code', code);
    return { code, redirectUri: redirect.toString(), expiresIn: 120 };
  }

  @Public()
  @Rate('auth')
  @Post('desktop/token')
  @HttpCode(200)
  async desktopToken(@Body() body: unknown, @Req() req: AppRequest) {
    const b = parse(DesktopTokenRequest, body);
    const s = await this.auth.desktopToken(b.code, b.codeVerifier, b.deviceName, this.client(req));
    return {
      accessToken: s.accessToken,
      expiresIn: s.expiresIn,
      user: toUserDto(s.user),
      refreshToken: s.refreshToken,
      refreshExpiresAt: s.refreshExpiresAt.toISOString(),
    };
  }

  @Public()
  @Rate('auth')
  @Get('oauth/:provider/start')
  oauthStart(@Param('provider') provider: string) {
    if (provider !== 'google' && provider !== 'apple') throw problems.notFound('Provider');
    // Needs client credentials from Google/Apple developer accounts (an owner action), see STAGE6_REPORT.
    throw new Problem(501, 'oauth_not_configured', `${provider === 'google' ? 'Google' : 'Apple'} sign-in is not configured`);
  }

  @Public()
  @Get('jwks')
  jwks() {
    return { keys: [this.tokens.publicJwk] };
  }
}
