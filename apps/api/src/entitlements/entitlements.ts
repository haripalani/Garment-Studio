// Entitlements engine (ADR-0012): plans are data, usage comes from live counts and the usage ledger.
import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { CONFIG, type Config } from '../config';
import { Problem } from '../common/problem';
import { Db } from '../infra/prisma';
import { TokenService } from '../auth/tokens';

/** null = unlimited. */
export const LimitsSchema = z.object({
  projects: z.number().int().nonnegative().nullable(),
  images: z.number().int().nonnegative().nullable(),
  storageBytes: z.number().int().nonnegative().nullable(),
  exportsPerMonth: z.number().int().nonnegative().nullable(),
  cloudRendersPerMonth: z.number().int().nonnegative().nullable(),
  renderMaxPx: z.number().int().positive().nullable(),
  renderQualities: z.array(z.string()).nullable(),
  localRender: z.boolean(),
  watermark: z.boolean(),
  garmentTiers: z.array(z.string()).nullable(),
});
export type Limits = z.infer<typeof LimitsSchema>;

export type Action = 'project.create' | 'asset.upload' | 'garment.use';

export interface Usage {
  projects: number;
  images: number;
  storageBytes: number;
  exportsThisPeriod: number;
  cloudRendersThisPeriod: number;
}

export interface Plan {
  planId: string;
  limits: Limits;
  periodStart: Date;
  periodEnd: Date;
}

function calendarMonth(now: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end };
}

@Injectable()
export class Entitlements {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(TokenService) private readonly tokens: TokenService,
  ) {}

  async plan(userId: string, now = new Date()): Promise<Plan> {
    const sub = await this.db.subscription.findUnique({ where: { userId }, include: { plan: true } });
    if (sub && (sub.status === 'active' || sub.status === 'trialing' || sub.status === 'past_due') && sub.currentPeriodEnd > now) {
      return {
        planId: sub.planId,
        limits: LimitsSchema.parse(sub.plan.limits),
        periodStart: sub.currentPeriodStart,
        periodEnd: sub.currentPeriodEnd,
      };
    }
    const plan = await this.db.plan.findUnique({ where: { id: this.config.DEFAULT_PLAN } });
    if (!plan) throw new Error(`DEFAULT_PLAN "${this.config.DEFAULT_PLAN}" is not seeded`);
    const { start, end } = calendarMonth(now);
    return { planId: plan.id, limits: LimitsSchema.parse(plan.limits), periodStart: start, periodEnd: end };
  }

  async usage(userId: string, plan: Plan): Promise<Usage> {
    const [projects, images, bytes, ledger] = await Promise.all([
      this.db.project.count({ where: { ownerId: userId, deletedAt: null } }),
      this.db.asset.count({ where: { ownerId: userId, kind: 'artwork', completed: true, scanStatus: { not: 'rejected' } } }),
      this.db.asset.aggregate({ where: { ownerId: userId, completed: true, scanStatus: { not: 'rejected' } }, _sum: { bytes: true } }),
      this.db.usageEvent.groupBy({
        by: ['action'],
        where: { userId, createdAt: { gte: plan.periodStart, lt: plan.periodEnd } },
        _sum: { quantity: true },
      }),
    ]);
    const used = (a: string) => ledger.find((r) => r.action === a)?._sum.quantity ?? 0;
    return {
      projects,
      images,
      storageBytes: Number(bytes._sum.bytes ?? 0n),
      exportsThisPeriod: used('export.create'),
      cloudRendersThisPeriod: used('render.cloud'),
    };
  }

  async credits(userId: string, now = new Date()): Promise<{ render: number; export: number }> {
    const rows = await this.db.creditGrant.groupBy({
      by: ['kind'],
      where: { userId, remaining: { gt: 0 }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      _sum: { remaining: true },
    });
    const of = (k: string) => rows.find((r) => r.kind === k)?._sum.remaining ?? 0;
    return { render: of('render'), export: of('export') };
  }

  /** Throws 402 EntitlementProblem when the action would exceed the plan. */
  async check(
    userId: string,
    action: Action,
    opts: { qty?: number; bytes?: number; kind?: 'artwork' | 'thumbnail'; tier?: string } = {},
  ): Promise<void> {
    const plan = await this.plan(userId);
    const l = plan.limits;
    const deny = (limit: number | null, used: number, title: string) => {
      throw new Problem(402, 'entitlement_required', title, { action, limit, used, requiredPlan: null });
    };
    if (action === 'garment.use') {
      if (l.garmentTiers && opts.tier !== undefined && !l.garmentTiers.includes(opts.tier)) {
        deny(null, 0, 'Your plan does not include this garment');
      }
      return;
    }
    const u = await this.usage(userId, plan);
    if (action === 'project.create' && l.projects !== null && u.projects + (opts.qty ?? 1) > l.projects) {
      deny(l.projects, u.projects, `Your plan allows ${l.projects} projects`);
    }
    if (action === 'asset.upload') {
      if (opts.kind === 'artwork' && l.images !== null && u.images + 1 > l.images) {
        deny(l.images, u.images, `Your plan allows ${l.images} uploaded images`);
      }
      if (l.storageBytes !== null && u.storageBytes + (opts.bytes ?? 0) > l.storageBytes) {
        deny(l.storageBytes, u.storageBytes, 'Your storage is full');
      }
    }
  }

  async snapshot(userId: string) {
    const plan = await this.plan(userId);
    const [usage, credits] = await Promise.all([this.usage(userId, plan), this.credits(userId)]);
    const periodEnd = plan.periodEnd.toISOString();
    const body = { planId: plan.planId, limits: plan.limits, usage, credits, periodEnd };
    return { ...body, snapshot: await this.tokens.signSnapshot(userId, body) };
  }
}
