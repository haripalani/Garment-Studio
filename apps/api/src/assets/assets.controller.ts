import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { CompleteUploadRequest, CreateUploadRequest } from '@gs/core';
import { CurrentUser, type Principal } from '../common/http';
import { Idempotency } from '../common/idempotency';
import { parse } from '../common/zod';
import { Jobs } from '../jobs/jobs';
import { AssetsService, toAssetDto } from './assets.service';

@Controller('assets')
export class AssetsController {
  constructor(
    @Inject(AssetsService) private readonly assets: AssetsService,
    @Inject(Idempotency) private readonly idem: Idempotency,
    @Inject(Jobs) private readonly jobs: Jobs,
  ) {}

  @Post('uploads')
  async create(
    @CurrentUser() me: Principal,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const b = parse(CreateUploadRequest, body);
    const out = await this.idem.run(me.id, 'assets.upload', key, b, () => this.assets.createUpload(me.id, b));
    void reply.status(out.status);
    return out.body;
  }

  @Get(':assetId/parts')
  parts(@CurrentUser() me: Principal, @Param('assetId') id: string) {
    return this.assets.parts(me.id, id);
  }

  @Post(':assetId/complete')
  @HttpCode(200)
  async complete(@CurrentUser() me: Principal, @Param('assetId') id: string, @Body() body: unknown) {
    const b = parse(CompleteUploadRequest, body);
    const a = await this.assets.complete(me.id, id, b.parts);
    await this.jobs.enqueueScan(a.id);
    return toAssetDto(a);
  }

  @Get(':assetId')
  async get(@CurrentUser() me: Principal, @Param('assetId') id: string) {
    const a = await this.assets.owned(me.id, id);
    return { ...toAssetDto(a), ...(await this.assets.download(a)) };
  }
}
