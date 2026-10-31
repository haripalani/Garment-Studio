import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type { ExportRecord } from '@prisma/client';
import { z } from 'zod';
import { CreateExportRequest, CreateRenderRequest, IdSchema } from '@gs/core';
import { CurrentUser, type Principal } from '../common/http';
import { newId } from '../common/crypto';
import { Idempotency } from '../common/idempotency';
import { LimitSchema, decodeCursor, encodeCursor } from '../common/pagination';
import { Problem, problems } from '../common/problem';
import { parse } from '../common/zod';
import { Entitlements } from '../entitlements/entitlements';
import { Db } from '../infra/prisma';
import { RendersService } from './renders.service';

const ListQuery = z.object({ cursor: z.string().max(512).optional(), limit: LimitSchema, projectId: IdSchema.optional() });

@Controller('renders')
export class RendersController {
  constructor(
    @Inject(RendersService) private readonly renders: RendersService,
    @Inject(Idempotency) private readonly idem: Idempotency,
  ) {}

  @Get()
  async list(@CurrentUser() me: Principal, @Query() query: unknown) {
    const q = parse(ListQuery, query);
    const before = decodeCursor(z.object({ c: z.string(), id: z.string() }), q.cursor);
    const r = await this.renders.list(me.id, q.limit, before, q.projectId);
    return { items: r.items, nextCursor: r.next ? encodeCursor(r.next) : null };
  }

  @Post()
  async create(
    @CurrentUser() me: Principal,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const b = parse(CreateRenderRequest, body);
    const out = await this.idem.run(me.id, 'renders.create', key, b, async () => ({
      status: 202,
      body: await this.renders.dto(await this.renders.create(me.id, b, key)),
    }));
    void reply.status(out.status);
    return out.body;
  }

  @Get(':renderId')
  async get(@CurrentUser() me: Principal, @Param('renderId') id: string) {
    return this.renders.dto(await this.renders.owned(me.id, id));
  }

  @Post(':renderId/cancel')
  @HttpCode(202)
  async cancel(@CurrentUser() me: Principal, @Param('renderId') id: string) {
    return this.renders.dto(await this.renders.cancel(me.id, id));
  }

  @Post(':renderId/retry')
  async retry(
    @CurrentUser() me: Principal,
    @Param('renderId') id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const out = await this.idem.run(me.id, `renders.retry:${id}`, key, {}, async () => ({
      status: 202,
      body: await this.renders.dto(await this.renders.retry(me.id, id, key)),
    }));
    void reply.status(out.status);
    return out.body;
  }
}

function exportDto(e: ExportRecord) {
  return {
    id: e.id,
    projectId: e.projectId,
    revision: e.revision,
    kind: e.kind,
    ranOn: e.ranOn as 'client' | 'server',
    status: e.status,
    outputUrl: null,
    createdAt: e.createdAt.toISOString(),
  };
}

/**
 * Exports run in the browser (they work offline); this records them so the plan's monthly export
 * quota is counted. Server-side exports are not offered yet (ADR-0020).
 */
@Controller('exports')
export class ExportsController {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(Entitlements) private readonly entitlements: Entitlements,
    @Inject(Idempotency) private readonly idem: Idempotency,
  ) {}

  @Post()
  async create(
    @CurrentUser() me: Principal,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const b = parse(CreateExportRequest, body);
    if (b.ranOn === 'server') {
      throw new Problem(501, 'server_export_unavailable', 'Server-side exports are not available yet; export in the app');
    }
    const out = await this.idem.run(me.id, 'exports.create', key, b, async () => {
      const project = await this.db.project.findFirst({ where: { id: b.projectId, ownerId: me.id } });
      if (!project) throw problems.notFound('Project');
      const plan = await this.entitlements.plan(me.id);
      const limit = plan.limits.exportsPerMonth;
      const id = newId();
      let creditGrantId: string | null = null;
      if (limit !== null) {
        const used = (await this.entitlements.usage(me.id, plan)).exportsThisPeriod;
        if (used >= limit) {
          // Over the monthly quota: an export credit pays for it, if there is one.
          const grant = await this.db.creditGrant.findFirst({
            where: { userId: me.id, kind: 'export', remaining: { gt: 0 }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
            orderBy: { expiresAt: 'asc' },
          });
          if (!grant) {
            throw new Problem(402, 'entitlement_required', `Your plan includes ${limit} exports a month`, {
              action: 'export.create',
              limit,
              used,
              requiredPlan: null,
            });
          }
          creditGrantId = grant.id;
        }
      }
      const record = await this.db.$transaction(async (tx) => {
        if (creditGrantId) {
          const r = await tx.creditGrant.updateMany({ where: { id: creditGrantId, remaining: { gt: 0 } }, data: { remaining: { decrement: 1 } } });
          if (r.count !== 1) throw problems.conflict('credit_race', 'Please try again');
        }
        const e = await tx.exportRecord.create({
          data: {
            id,
            userId: me.id,
            projectId: b.projectId,
            revision: b.revision,
            kind: b.kind,
            params: b.params,
            ranOn: 'client',
            status: 'succeeded',
            ...(b.performedAt ? { createdAt: new Date(b.performedAt) } : {}),
          },
        });
        await tx.usageEvent.create({
          data: { id: newId(), userId: me.id, action: 'export.create', creditGrantId, key: `export:${id}` },
        });
        return e;
      });
      return { status: 201, body: exportDto(record) };
    });
    void reply.status(out.status);
    return out.body;
  }

  @Get(':exportId')
  async get(@CurrentUser() me: Principal, @Param('exportId') id: string) {
    const e = await this.db.exportRecord.findFirst({ where: { id, userId: me.id } });
    if (!e) throw problems.notFound('Export');
    return exportDto(e);
  }
}
