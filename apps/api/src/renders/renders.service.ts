// Cloud catalogue renders (ADR-0013): validated and entitlement-checked here, executed by the render
// worker (headless Chromium running the same path tracer as the editor), charged only on success.
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, RenderJob } from '@prisma/client';
import { Queue } from 'bullmq';
import type { z } from 'zod';
import type { CreateRenderRequest } from '@gs/core';
import { newId } from '../common/crypto';
import { Problem, problems } from '../common/problem';
import { Entitlements, type Plan } from '../entitlements/entitlements';
import { Db } from '../infra/prisma';
import { RedisService } from '../infra/redis';
import { Storage } from '../infra/storage';
import { Events } from '../events/events';

export type RenderParams = z.infer<typeof CreateRenderRequest>;
export const RENDER_QUEUE = 'render';
export const cancelKey = (jobId: string) => `render:cancel:${jobId}`;
const OUTPUT_URL_TTL_S = 3600;

@Injectable()
export class RendersService {
  private queue: Queue | null = null;

  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(Entitlements) private readonly entitlements: Entitlements,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(Storage) private readonly storage: Storage,
    @Inject(Events) private readonly events: Events,
  ) {}

  private q(): Queue {
    this.queue ??= new Queue(RENDER_QUEUE, { connection: this.redis.connection(), prefix: 'gs' });
    return this.queue;
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }

  async dto(j: RenderJob) {
    const outputs = ((j.outputs ?? []) as { format: 'png' | 'webp'; assetId: string }[]).map((o) => ({ ...o, url: null as string | null }));
    if (j.status === 'succeeded' && outputs.length) {
      const assets = await this.db.asset.findMany({ where: { id: { in: outputs.map((o) => o.assetId) } } });
      for (const o of outputs) {
        const a = assets.find((x) => x.id === o.assetId);
        if (a) o.url = await this.storage.presignGet(a.storageKey, a.mime, `render-${j.id}.${o.format}`, OUTPUT_URL_TTL_S);
      }
    }
    const queuePosition =
      j.status === 'queued'
        ? await this.db.renderJob.count({ where: { status: 'queued', createdAt: { lt: j.createdAt } } })
        : null;
    return {
      id: j.id,
      projectId: j.projectId,
      revision: j.revision,
      status: j.status,
      progress: j.progress,
      samplesDone: j.samplesDone,
      params: j.params as RenderParams,
      queuePosition,
      error: j.errorCode ? { code: j.errorCode, message: j.errorMessage ?? '' } : null,
      outputs,
      createdAt: j.createdAt.toISOString(),
      startedAt: j.startedAt?.toISOString() ?? null,
      finishedAt: j.finishedAt?.toISOString() ?? null,
    };
  }

  async owned(userId: string, id: string): Promise<RenderJob> {
    const j = await this.db.renderJob.findFirst({ where: { id, userId } });
    if (!j) throw problems.notFound('Render');
    return j;
  }

  /** Plan checks: size, quality, and the monthly cloud quota (render credits cover the overflow). */
  private async checkPlan(userId: string, p: RenderParams): Promise<void> {
    const plan: Plan = await this.entitlements.plan(userId);
    const l = plan.limits;
    const deny = (action: string, limit: number | null, used: number, title: string) => {
      throw new Problem(402, 'entitlement_required', title, { action, limit, used, requiredPlan: null });
    };
    if (l.renderMaxPx !== null && Math.max(p.width, p.height) > l.renderMaxPx) {
      deny('render.size', l.renderMaxPx, Math.max(p.width, p.height), `Your plan renders up to ${l.renderMaxPx} px`);
    }
    if (l.renderQualities !== null && !l.renderQualities.includes(p.quality)) {
      deny('render.quality', null, 0, `Your plan does not include ${p.quality} quality`);
    }
    if (l.cloudRendersPerMonth !== null) {
      const usage = await this.entitlements.usage(userId, plan);
      const inFlight = await this.db.renderJob.count({ where: { userId, status: { in: ['queued', 'running'] } } });
      const credits = (await this.entitlements.credits(userId)).render;
      const used = usage.cloudRendersThisPeriod + inFlight;
      if (used >= l.cloudRendersPerMonth + credits) {
        deny('render.cloud', l.cloudRendersPerMonth, used, 'You have used all your cloud renders for this period');
      }
    }
  }

  async create(userId: string, p: RenderParams, idempotencyKey: string | undefined, retryOf?: string): Promise<RenderJob> {
    const project = await this.db.project.findFirst({ where: { id: p.projectId, ownerId: userId, deletedAt: null } });
    if (!project) throw problems.notFound('Project');
    const version = await this.db.projectVersion.findUnique({
      where: { projectId_revision: { projectId: p.projectId, revision: p.revision } },
      select: { id: true },
    });
    if (!version) throw problems.validation([{ path: 'revision', message: 'This revision does not exist' }]);
    await this.checkPlan(userId, p);
    const job = await this.db.renderJob.create({
      data: {
        id: newId(),
        userId,
        projectId: p.projectId,
        revision: p.revision,
        target: 'cloud',
        params: p as unknown as Prisma.InputJsonValue,
        idempotencyKey: idempotencyKey ?? null,
        retryOf: retryOf ?? null,
      },
    });
    await this.q().add('render', { jobId: job.id }, { jobId: job.id, attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 500, removeOnFail: 1000 });
    return job;
  }

  async cancel(userId: string, id: string): Promise<RenderJob> {
    const j = await this.owned(userId, id);
    if (j.status === 'queued') {
      // Not started: remove it from the queue (a worker that already took it sees the flag instead).
      await this.redis.client.set(cancelKey(id), '1', 'EX', 3600);
      await (await this.q().getJob(id))?.remove().catch(() => undefined);
      const done = await this.db.renderJob.update({
        where: { id },
        data: { status: 'cancelled', cancelRequested: true, finishedAt: new Date() },
      });
      await this.events.publish(userId, { type: 'render.finished', jobId: id, status: 'cancelled', outputAssetId: null });
      return done;
    }
    if (j.status === 'running') {
      await this.redis.client.set(cancelKey(id), '1', 'EX', 3600);
      return this.db.renderJob.update({ where: { id }, data: { cancelRequested: true } });
    }
    throw problems.conflict('not_cancellable', `A ${j.status} render can't be cancelled`);
  }

  async retry(userId: string, id: string, idempotencyKey: string | undefined): Promise<RenderJob> {
    const j = await this.owned(userId, id);
    if (j.status !== 'failed' && j.status !== 'cancelled') {
      throw problems.conflict('not_retryable', 'Only failed or cancelled renders can be retried');
    }
    return this.create(userId, j.params as RenderParams, idempotencyKey, j.id);
  }

  async list(userId: string, limit: number, before: { c: string; id: string } | undefined, projectId: string | undefined) {
    const where: Prisma.RenderJobWhereInput = { userId, ...(projectId ? { projectId } : {}) };
    if (before) {
      const c = new Date(before.c);
      where.OR = [{ createdAt: { lt: c } }, { createdAt: c, id: { lt: before.id } }];
    }
    const rows = await this.db.renderJob.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1 });
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: await Promise.all(page.map((j) => this.dto(j))),
      next: rows.length > limit && last ? { c: last.createdAt.toISOString(), id: last.id } : null,
    };
  }
}
