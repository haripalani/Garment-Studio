import { Body, Controller, Delete, Get, Headers, HttpCode, Inject, Param, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  CreateProjectRequest,
  DuplicateProjectRequest,
  PushVersionRequest,
  RenameProjectRequest,
  SetThumbnailRequest,
} from '@gs/core';
import { CurrentUser, type AppRequest, type Principal } from '../common/http';
import { Idempotency } from '../common/idempotency';
import { LimitSchema, decodeCursor, encodeCursor } from '../common/pagination';
import { parse } from '../common/zod';
import { ProjectsService } from './projects.service';

const ListQuery = z.object({
  cursor: z.string().max(512).optional(),
  limit: LimitSchema,
  q: z.string().max(120).optional(),
  updatedSince: z.iso.datetime({ offset: true }).optional(),
  trash: z.enum(['true', 'false']).optional(),
});
const VersionsQuery = z.object({ cursor: z.string().max(512).optional(), limit: LimitSchema });
const Revision = z.coerce.number().int().min(1);

@Controller('projects')
export class ProjectsController {
  constructor(
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(Idempotency) private readonly idem: Idempotency,
  ) {}

  @Get()
  async list(@CurrentUser() me: Principal, @Query() query: unknown) {
    const q = parse(ListQuery, query);
    const after = decodeCursor(z.object({ u: z.string(), id: z.string() }), q.cursor);
    const r = await this.projects.list(me.id, {
      limit: q.limit,
      after,
      q: q.q,
      updatedSince: q.updatedSince ? new Date(q.updatedSince) : undefined,
      trash: q.trash === 'true',
    });
    return { items: r.items, nextCursor: r.next ? encodeCursor(r.next) : null };
  }

  @Post()
  async create(
    @CurrentUser() me: Principal,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const b = parse(CreateProjectRequest, body);
    const out = await this.idem.run(me.id, 'projects.create', key, b, async () => ({
      status: 201,
      body: await this.projects.create(me.id, me.platform, b),
    }));
    void reply.status(out.status);
    return out.body;
  }

  @Get(':projectId')
  async get(
    @CurrentUser() me: Principal,
    @Param('projectId') id: string,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const p = await this.projects.full(me.id, id);
    const etag = `"r${p.headRevision}"`;
    void reply.header('ETag', etag);
    if (req.headers['if-none-match'] === etag) {
      void reply.status(304);
      return undefined;
    }
    return p;
  }

  @Patch(':projectId')
  rename(@CurrentUser() me: Principal, @Param('projectId') id: string, @Body() body: unknown) {
    return this.projects.rename(me.id, id, parse(RenameProjectRequest, body).name);
  }

  @Delete(':projectId')
  @HttpCode(204)
  async remove(@CurrentUser() me: Principal, @Param('projectId') id: string, @Req() req: AppRequest) {
    await this.projects.remove(me.id, id, req.ip);
  }

  @Post(':projectId/restore')
  @HttpCode(200)
  restore(@CurrentUser() me: Principal, @Param('projectId') id: string, @Req() req: AppRequest) {
    return this.projects.restore(me.id, id, req.ip);
  }

  @Post(':projectId/duplicate')
  async duplicate(
    @CurrentUser() me: Principal,
    @Param('projectId') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const b = parse(DuplicateProjectRequest, body ?? {});
    const out = await this.idem.run(me.id, `projects.duplicate:${id}`, key, b, async () => ({
      status: 201,
      body: await this.projects.duplicate(me.id, id, me.platform, b.name),
    }));
    void reply.status(out.status);
    return out.body;
  }

  @Get(':projectId/versions')
  async versions(@CurrentUser() me: Principal, @Param('projectId') id: string, @Query() query: unknown) {
    const q = parse(VersionsQuery, query);
    const before = decodeCursor(z.number().int().min(1), q.cursor);
    const r = await this.projects.versions(me.id, id, q.limit, before);
    return { items: r.items, nextCursor: r.next ? encodeCursor(r.next) : null };
  }

  @Post(':projectId/versions')
  async push(
    @CurrentUser() me: Principal,
    @Param('projectId') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const b = parse(PushVersionRequest, body);
    const out = await this.idem.run(me.id, `projects.push:${id}`, key, b, async () => ({
      status: 201,
      body: await this.projects.push(me.id, id, b),
    }));
    void reply.status(out.status);
    return out.body;
  }

  @Get(':projectId/versions/:revision')
  version(@CurrentUser() me: Principal, @Param('projectId') id: string, @Param('revision') rev: string) {
    return this.projects.version(me.id, id, parse(Revision, rev));
  }

  @Put(':projectId/thumbnail')
  @HttpCode(204)
  async thumbnail(@CurrentUser() me: Principal, @Param('projectId') id: string, @Body() body: unknown) {
    await this.projects.setThumbnail(me.id, id, parse(SetThumbnailRequest, body).assetId);
  }
}
