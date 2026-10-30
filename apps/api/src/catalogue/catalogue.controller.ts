// Garments (public catalogue), entitlements, billing stubs, admin plan assignment and health.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AssignPlanRequest } from '@gs/core';
import { CONFIG, type Config } from '../config';
import { CurrentUser, Public, type AppRequest, type Principal } from '../common/http';
import { newId } from '../common/crypto';
import { Problem, problems } from '../common/problem';
import { parse } from '../common/zod';
import { Audit } from '../audit/audit';
import { Entitlements, LimitsSchema } from '../entitlements/entitlements';
import { clamdCommand } from '../infra/clamav';
import { Db } from '../infra/prisma';
import { RedisService } from '../infra/redis';
import { Storage } from '../infra/storage';

const GarmentId = z.string().regex(/^[a-z0-9-]{2,64}$/);

type Manifest = Record<string, unknown> & { name?: Record<string, string>; cut?: Record<string, string>; thumbKey?: string };

@Controller('garments')
export class GarmentsController {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(Storage) private readonly storage: Storage,
  ) {}

  private latest(where: Prisma.GarmentModelWhereInput) {
    return this.db.garmentModel.findMany({
      where: { publishedAt: { not: null }, retiredAt: null, ...where },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }, { publishedAt: 'desc' }],
      distinct: ['id'],
    });
  }

  @Public()
  @Get()
  async list(@Query() query: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    const q = parse(z.object({ category: z.string().max(40).optional(), locale: z.string().max(10).default('en') }), query);
    const rows = await this.latest(q.category ? { category: q.category } : {});
    void reply.header('Cache-Control', 'public, max-age=300');
    const pick = (m: Record<string, string> | undefined) => m?.[q.locale] ?? m?.en ?? '';
    return {
      items: rows.map((g) => {
        const m = g.manifest as Manifest;
        return {
          id: g.id,
          version: g.version,
          category: g.category,
          name: pick(m.name),
          cut: pick(m.cut),
          tier: g.tier,
          thumbUrl: this.storage.publicUrl(String(m.thumbKey)),
          isNew: g.publishedAt !== null && Date.now() - g.publishedAt.getTime() < 30 * 86400_000,
        };
      }),
    };
  }

  @Public()
  @Get(':garmentId')
  async get(@Param('garmentId') id: string, @Query() query: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    const gid = parse(GarmentId, id);
    const q = parse(z.object({ version: z.string().max(40).optional() }), query);
    const g = q.version
      ? await this.db.garmentModel.findFirst({ where: { id: gid, version: q.version, publishedAt: { not: null } } })
      : (await this.latest({ id: gid }))[0];
    if (!g) throw problems.notFound('Garment');
    // A specific version never changes; "latest" may.
    void reply.header('Cache-Control', q.version ? 'public, max-age=31536000, immutable' : 'public, max-age=300');
    const { thumbKey, ...manifest } = g.manifest as Manifest;
    return { ...manifest, id: g.id, version: g.version, category: g.category, tier: g.tier, thumbUrl: this.storage.publicUrl(String(thumbKey)) };
  }
}

@Controller()
export class AccountPlanController {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(Entitlements) private readonly entitlements: Entitlements,
    @Inject(Audit) private readonly audit: Audit,
  ) {}

  @Get('entitlements')
  get(@CurrentUser() me: Principal) {
    return this.entitlements.snapshot(me.id);
  }

  @Public()
  @Get('billing/plans')
  async plans() {
    const rows = await this.db.plan.findMany({ where: { isPublic: true }, orderBy: { createdAt: 'asc' } });
    return { items: rows.map((p) => ({ id: p.id, name: p.name, limits: LimitsSchema.parse(p.limits), prices: [] })) };
  }

  @Post('billing/checkout')
  checkout() {
    throw new Problem(501, 'billing_disabled', 'Billing is not enabled yet');
  }

  @Post('billing/portal')
  portal() {
    throw new Problem(501, 'billing_disabled', 'Billing is not enabled yet');
  }

  @Public()
  @Post('billing/webhooks/:provider')
  webhook() {
    throw new Problem(501, 'billing_disabled', 'Billing is not enabled yet');
  }

  /** ManualProvider (ADR-0012): support staff assign a plan until a billing provider is chosen. */
  @Put('admin/users/:userId/plan')
  async assign(@CurrentUser() me: Principal, @Param('userId') userId: string, @Body() body: unknown, @Req() req: AppRequest) {
    if (me.role !== 'admin') throw problems.forbidden('admin_only', 'Administrators only');
    const b = parse(AssignPlanRequest, body);
    const [user, plan] = await Promise.all([
      this.db.user.findFirst({ where: { id: userId, deletedAt: null } }),
      this.db.plan.findUnique({ where: { id: b.planId } }),
    ]);
    if (!user) throw problems.notFound('User');
    if (!plan) throw problems.validation([{ path: 'planId', message: 'Unknown plan' }]);
    const start = new Date();
    const end = new Date(start.getTime() + b.days * 86400_000);
    const data = { planId: plan.id, status: 'active' as const, provider: 'manual', currentPeriodStart: start, currentPeriodEnd: end };
    await this.db.subscription.upsert({ where: { userId }, create: { id: newId(), userId, ...data }, update: data });
    await this.audit.record('admin.plan.assign', { actorId: me.id, target: userId, ip: req.ip, meta: { planId: plan.id, days: b.days } });
    return this.entitlements.snapshot(userId);
  }
}

@Controller('health')
export class HealthController {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(Storage) private readonly storage: Storage,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  @Public()
  @Get()
  @HttpCode(200)
  async check(@Res({ passthrough: true }) reply: FastifyReply) {
    const run = async (fn: () => Promise<unknown>) => {
      try {
        await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000))]);
        return 'ok' as const;
      } catch {
        return 'fail' as const;
      }
    };
    const checks: Record<string, 'ok' | 'fail'> = {
      database: await run(() => this.db.$queryRaw`SELECT 1`),
      redis: await run(() => this.redis.client.ping()),
      storage: await run(() => this.storage.ping()),
    };
    if (this.config.ANTIVIRUS === 'clamav') {
      checks.antivirus = await run(async () => {
        if ((await clamdCommand(this.config.CLAMAV_HOST!, this.config.CLAMAV_PORT!, 'PING')) !== 'PONG') throw new Error('no pong');
      });
    }
    const core = checks.database === 'ok' && checks.redis === 'ok' && checks.storage === 'ok';
    if (!core) void reply.status(503);
    // Uploads wait in the scan queue while antivirus is down, so it degrades rather than fails.
    return { status: core && checks.antivirus !== 'fail' ? 'ok' : 'degraded', checks };
  }
}
