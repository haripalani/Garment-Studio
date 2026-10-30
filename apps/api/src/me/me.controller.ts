import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Put, Req, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { Prisma } from '@prisma/client';
import { DeleteMeRequest, UpdateMeRequest, UserSettingsSchema } from '@gs/core';
import { CurrentUser, type AppRequest, type Principal } from '../common/http';
import { newId } from '../common/crypto';
import { Problem, problems } from '../common/problem';
import { parse } from '../common/zod';
import { Audit } from '../audit/audit';
import { AuthService, toUserDto } from '../auth/auth.service';
import { CSRF_COOKIE, REFRESH_COOKIE } from '../auth/auth.controller';
import { hashPassword, assertPasswordAllowed } from '../auth/passwords';
import { CONFIG, type Config } from '../config';
import { Db } from '../infra/prisma';
import { Mailer } from '../infra/mail';
import { RedisService } from '../infra/redis';
import { Jobs } from '../jobs/jobs';

@Controller('me')
export class MeController {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(Audit) private readonly audit: Audit,
    @Inject(Mailer) private readonly mail: Mailer,
    @Inject(Jobs) private readonly jobs: Jobs,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  private async user(id: string) {
    const u = await this.db.user.findUnique({ where: { id }, include: { identities: true } });
    if (!u || u.deletedAt) throw problems.unauthorized();
    return u;
  }

  @Get()
  async get(@CurrentUser() me: Principal) {
    return toUserDto(await this.user(me.id));
  }

  @Patch()
  async update(@CurrentUser() me: Principal, @Body() body: unknown, @Req() req: AppRequest) {
    const b = parse(UpdateMeRequest, body);
    const u = await this.user(me.id);
    const data: Prisma.UserUpdateInput = {};
    if (b.displayName !== undefined) data.displayName = b.displayName || null;
    const sensitive = b.newPassword !== undefined || (b.email !== undefined && b.email !== u.email);
    if (sensitive) await this.auth.assertReauth(u, me.sid, b.currentPassword);
    if (b.email !== undefined && b.email !== u.email) {
      if (await this.db.user.findUnique({ where: { email: b.email } })) {
        throw problems.conflict('email_taken', 'An account with this email already exists');
      }
      // The address changes only once the new inbox confirms it.
      await this.auth.sendEmailChange(u.id, b.email);
    }
    if (b.newPassword !== undefined) {
      await assertPasswordAllowed(b.newPassword, this.config.PASSWORD_BREACH_CHECK);
      data.passwordHash = await hashPassword(b.newPassword);
    }
    const updated = await this.db.user.update({ where: { id: u.id }, data, include: { identities: true } });
    if (b.newPassword !== undefined) {
      await this.auth.revokeAll(u.id, me.sid);
      await this.audit.record('account.password_change', { actorId: u.id, ip: req.ip });
    }
    return toUserDto(updated);
  }

  @Delete()
  @HttpCode(202)
  async remove(
    @CurrentUser() me: Principal,
    @Body() body: unknown,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const b = parse(DeleteMeRequest, body);
    const u = await this.user(me.id);
    await this.auth.assertReauth(u, me.sid, b.currentPassword);
    const originalEmail = u.email;
    const now = new Date();
    // Free the address straight away (the person may sign up again); data is purged after 30 days.
    await this.db.$transaction([
      this.db.user.update({
        where: { id: u.id },
        data: { deletedAt: now, email: `deleted-${u.id}@deleted.invalid`, passwordHash: null },
      }),
      this.db.authIdentity.deleteMany({ where: { userId: u.id } }),
      this.db.project.updateMany({ where: { ownerId: u.id, deletedAt: null }, data: { deletedAt: now } }),
    ]);
    await this.auth.revokeAll(u.id);
    await this.audit.record('account.delete', { actorId: u.id, ip: req.ip });
    await this.mail.send('account-deleted', originalEmail).catch(() => undefined);
    void reply.clearCookie(REFRESH_COOKIE, { path: '/v1/auth' });
    void reply.clearCookie(CSRF_COOKIE, { path: '/' });
  }

  @Get('settings')
  async settings(@CurrentUser() me: Principal) {
    const s = await this.db.userSettings.upsert({ where: { userId: me.id }, create: { userId: me.id }, update: {} });
    return {
      theme: s.theme,
      unit: s.unit,
      locale: s.locale,
      lookDefaults: s.lookDefaults ?? null,
      hints: s.hints ?? null,
    };
  }

  @Put('settings')
  async putSettings(@CurrentUser() me: Principal, @Body() body: unknown) {
    const b = parse(UserSettingsSchema, body);
    const fields = {
      theme: b.theme,
      unit: b.unit,
      locale: b.locale,
      lookDefaults: b.lookDefaults == null ? Prisma.DbNull : (b.lookDefaults as Prisma.InputJsonValue),
      hints: b.hints == null ? Prisma.DbNull : (b.hints as Prisma.InputJsonValue),
    };
    await this.db.userSettings.upsert({ where: { userId: me.id }, create: { userId: me.id, ...fields }, update: fields });
    return this.settings(me);
  }

  @Get('sessions')
  async sessions(@CurrentUser() me: Principal) {
    const rows = await this.db.session.findMany({
      where: { userId: me.id, rotatedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
    });
    return {
      items: rows.map((s) => ({
        id: s.id,
        platform: s.platform,
        deviceName: s.deviceName,
        createdAt: s.createdAt.toISOString(),
        lastUsedAt: s.lastUsedAt.toISOString(),
        current: s.familyId === me.sid,
      })),
    };
  }

  @Delete('sessions/:sessionId')
  @HttpCode(204)
  async revoke(@CurrentUser() me: Principal, @Param('sessionId') id: string, @Req() req: AppRequest) {
    const s = await this.db.session.findFirst({ where: { id, userId: me.id, revokedAt: null } });
    if (!s) throw problems.notFound('Session');
    await this.auth.revokeFamily(s.familyId);
    await this.audit.record('session.revoke', { actorId: me.id, target: s.familyId, ip: req.ip });
  }

  @Post('export')
  @HttpCode(202)
  async exportData(@CurrentUser() me: Principal, @Req() req: AppRequest) {
    const gate = await this.redis.client.set(`export-gate:${me.id}`, '1', 'EX', 3600, 'NX');
    if (!gate) {
      throw new Problem(429, 'rate_limited', 'You can request one export per hour', {}, { 'Retry-After': '3600' });
    }
    const id = newId();
    await this.jobs.enqueueExport(id, me.id);
    await this.audit.record('account.export', { actorId: me.id, target: id, ip: req.ip });
    return { id, status: 'queued' as const };
  }
}
