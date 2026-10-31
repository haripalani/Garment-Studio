// The cloud render worker (ADR-0013): takes render jobs from the queue, runs the editor's render page in
// headless Chromium on the GPU, uploads the images as render assets and charges the user on success.
import { createReadStream, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { Logger } from '@nestjs/common';
import { Prisma, type RenderJob } from '@prisma/client';
import { Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { createDevTee, createDoc, type GarmentModel, type RenderPageInput, type RenderPageOutput } from '@gs/core';
import type { Config } from '../config';
import { newId, sha256Hex } from '../common/crypto';
import { LimitsSchema } from '../entitlements/entitlements';
import { publishEvent } from '../events/events';
import type { Db } from '../infra/prisma';
import type { Storage } from '../infra/storage';
import { RENDER_QUEUE, cancelKey, type RenderParams } from './renders.service';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};
const PROGRESS_EVERY_MS = 1000;
/** Generous ceiling: ~0.5 µs per pixel-sample on a mid-range GPU, plus start-up, capped at 2 h. */
export const renderTimeoutMs = (p: { width: number; height: number }, samples: number) =>
  Math.min(2 * 3600_000, 120_000 + p.width * p.height * samples * 0.0005);

class Cancelled extends Error {}

export class RenderRunner {
  private readonly log = new Logger('RenderWorker');
  private browser: BrowserContext | null = null;
  private server: Server | null = null;
  private pageUrl = '';
  private worker: Worker | null = null;
  gpu = 'unknown';
  /** Test environments: fixed sample count (from RENDER_SAMPLES_OVERRIDE, adjustable per test). */
  samplesOverride: number | undefined;

  constructor(
    private readonly config: Config,
    private readonly db: Db,
    private readonly storage: Storage,
    private readonly redis: Redis,
    private readonly connection: () => Redis,
  ) {
    this.samplesOverride = config.RENDER_SAMPLES_OVERRIDE;
  }

  /** Stop taking new jobs (running ones finish); used by maintenance and tests. */
  pause(): Promise<void> {
    return this.worker?.pause() ?? Promise.resolve();
  }

  resume(): void {
    this.worker?.resume();
  }

  /** Serves the built editor (render.html and its chunks) to the local browser only. */
  private async serve(dir: string): Promise<string> {
    const root = resolve(dir);
    statSync(join(root, 'render.html')); // fail fast when the editor isn't built
    this.server = createServer((req, res) => {
      const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
      const file = resolve(root, `.${path}`);
      if (req.method !== 'GET' || (file !== root && !file.startsWith(root + sep))) {
        res.writeHead(404).end();
        return;
      }
      try {
        if (!statSync(file).isFile()) throw new Error('not a file');
      } catch {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
      createReadStream(file).pipe(res);
    });
    await new Promise<void>((ok) => this.server!.listen(0, '127.0.0.1', ok));
    const { port } = this.server.address() as { port: number };
    return `http://127.0.0.1:${port}/render.html`;
  }

  async start(): Promise<void> {
    if (!this.config.RENDER_PAGE_DIR) throw new Error('RENDER_PAGE_DIR is required for the render worker');
    this.pageUrl = await this.serve(this.config.RENDER_PAGE_DIR);
    // A persistent profile keeps Chromium's GPU program cache: the path tracer's shader compiles once
    // (tens of seconds on some drivers) instead of on every worker start.
    this.browser = await chromium.launchPersistentContext(this.config.RENDER_PROFILE_DIR ?? join(tmpdir(), 'gs-render-profile'), {
      headless: true,
      args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', ...(this.config.RENDER_CHROMIUM_ARGS ?? [])],
    });
    const probe = await this.browser.newPage();
    this.gpu = await probe.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return 'no WebGL 2';
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    });
    await probe.close();
    this.log.log(`GPU: ${this.gpu}`);
    await this.warmUp();
    // One render at a time per worker: a render uses the whole GPU.
    this.worker = new Worker(RENDER_QUEUE, (job) => this.process(job), {
      connection: this.connection(),
      prefix: 'gs',
      concurrency: 1,
      lockDuration: 120_000,
    });
    this.worker.on('failed', (job, err) => this.log.warn(`render ${job?.id} failed: ${err.message}`));
  }

  /** A 1-sample thumbnail render before taking jobs, so no customer job waits for shader compilation. */
  private async warmUp(): Promise<void> {
    const started = Date.now();
    const page = await this.browser!.newPage();
    try {
      await page.goto(this.pageUrl);
      await page.waitForFunction(() => window.gsReady === true, null, { timeout: 30_000 });
      const garment = createDevTee();
      const input: RenderPageInput = {
        doc: createDoc(garment.id, garment.version),
        garment,
        assets: {},
        width: 64,
        height: 64,
        quality: 'draft',
        frame: 'front',
        transparent: false,
        formats: ['png'],
        samplesOverride: 1,
      };
      await page.evaluate((i) => window.gsRender(i), input);
      this.log.log(`Renderer warmed up in ${Math.round((Date.now() - started) / 1000)} s`);
    } finally {
      await page.close();
    }
  }

  async stop(): Promise<void> {
    await this.worker?.close();
    await this.browser?.close();
    await new Promise<void>((ok) => (this.server ? this.server.close(() => ok()) : ok()));
  }

  private async emit(j: RenderJob, event: Parameters<typeof publishEvent>[2]) {
    await publishEvent(this.redis, j.userId, event);
  }

  async process(job: Job): Promise<string> {
    const id = String(job.data.jobId);
    const j = await this.db.renderJob.findUnique({ where: { id } });
    if (!j || j.status === 'succeeded' || j.status === 'cancelled') return 'skipped';
    if (j.cancelRequested || (await this.redis.exists(cancelKey(id)))) {
      await this.finish(j, 'cancelled');
      return 'cancelled';
    }
    const params = j.params as RenderParams;
    const samples = this.samplesOverride ?? { draft: 150, good: 500, high: 1000, max: 1500 }[params.quality];
    await this.db.renderJob.update({
      where: { id },
      data: { status: 'running', startedAt: new Date(), attempts: { increment: 1 }, workerId: `pid-${process.pid}`, heartbeatAt: new Date() },
    });
    let page: Page | null = null;
    try {
      const input = await this.input(j, params);
      page = await this.browser!.newPage();
      let last = 0;
      let cancelling = false;
      await page.exposeFunction('gsProgress', async (done: number, total: number) => {
        const now = Date.now();
        if (now - last < PROGRESS_EVERY_MS && done < total) return;
        last = now;
        const progress = Math.min(1, done / total);
        await this.db.renderJob.update({ where: { id }, data: { progress, samplesDone: done, heartbeatAt: new Date() } });
        await this.emit(j, { type: 'render.progress', jobId: id, progress, samplesDone: done });
        if (!cancelling && (await this.redis.exists(cancelKey(id)))) {
          cancelling = true;
          await page?.evaluate(() => window.gsCancel()).catch(() => undefined);
        }
      });
      page.on('pageerror', (e) => this.log.warn(`render page error (${id}): ${e.message}`));
      await page.goto(this.pageUrl);
      await page.waitForFunction(() => window.gsReady === true, null, { timeout: 30_000 });
      const timeout = renderTimeoutMs(params, samples);
      const run = page.evaluate((i) => window.gsRender(i), { ...input, samplesOverride: this.samplesOverride });
      let timer: NodeJS.Timeout | undefined;
      const result = (await Promise.race([
        run,
        new Promise((_, rej) => (timer = setTimeout(() => rej(new Error(`render timed out after ${Math.round(timeout / 1000)} s`)), timeout))),
      ]).finally(() => clearTimeout(timer))) as RenderPageOutput;
      await this.complete(j, params, result);
      return 'succeeded';
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      if (e instanceof Cancelled || /AbortError|Render cancelled/.test(msg)) {
        await this.finish(j, 'cancelled');
        return 'cancelled';
      }
      const final = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      if (final) {
        await this.finish(j, 'failed', { code: 'render_failed', message: msg.slice(0, 500) });
      } else {
        await this.db.renderJob.update({ where: { id }, data: { status: 'queued', progress: 0, samplesDone: 0 } });
      }
      throw e;
    } finally {
      await page?.close().catch(() => undefined);
    }
  }

  /** Everything the render page needs: the revision's document, the garment and the image bytes. */
  private async input(j: RenderJob, p: RenderParams): Promise<RenderPageInput> {
    const v = await this.db.projectVersion.findUniqueOrThrow({
      where: { projectId_revision: { projectId: j.projectId, revision: j.revision } },
    });
    const doc = v.doc as { garment: { modelId: string; modelVersion: string }; assets: Record<string, { sha256: string }> };
    const g = await this.db.garmentModel.findUniqueOrThrow({
      where: { id_version: { id: doc.garment.modelId, version: doc.garment.modelVersion } },
    });
    const { thumbKey: _t, meshUrl: _m, ...manifest } = g.manifest as Record<string, unknown>;
    const garment = { ...manifest, id: g.id, version: g.version, category: g.category } as unknown as GarmentModel;
    const assets: RenderPageInput['assets'] = {};
    for (const [key, ref] of Object.entries(doc.assets ?? {})) {
      const a = await this.db.asset.findFirst({
        where: { ownerId: j.userId, sha256: ref.sha256, kind: 'artwork', completed: true, scanStatus: 'clean' },
      });
      if (!a) throw new Error(`asset ${key} is not available (not uploaded or not yet scanned)`);
      assets[key] = { mime: a.mime, base64: Buffer.from(await this.storage.getBytes(a.storageKey)).toString('base64') };
    }
    return {
      doc: v.doc,
      garment,
      assets,
      width: p.width,
      height: p.height,
      quality: p.quality,
      frame: p.frame,
      camera: p.camera,
      transparent: p.transparent,
      formats: p.formats,
      watermark: (await this.planOf(j.userId)).limits?.watermark === true,
    };
  }

  /** The user's current plan (subscription, else the default plan) and the start of its period. */
  private async planOf(userId: string) {
    const now = new Date();
    const sub = await this.db.subscription.findUnique({ where: { userId }, include: { plan: true } });
    const active = sub && sub.currentPeriodEnd > now ? sub : null;
    const row = active ? active.plan : await this.db.plan.findUnique({ where: { id: this.config.DEFAULT_PLAN } });
    return {
      limits: row ? LimitsSchema.parse(row.limits) : null,
      periodStart: active ? active.currentPeriodStart : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    };
  }

  private async complete(j: RenderJob, p: RenderParams, r: RenderPageOutput): Promise<void> {
    const outputs: { format: 'png' | 'webp'; assetId: string }[] = [];
    for (const o of r.outputs) {
      const bytes = Buffer.from(o.base64, 'base64');
      const sha = sha256Hex(bytes);
      const storageKey = `u/${j.userId}/render/${sha}`;
      await this.storage.put(storageKey, bytes, o.mime);
      // Our own output: no upload scan needed. Same bytes again (a retry) reuse the asset.
      const asset = await this.db.asset.upsert({
        where: { ownerId_sha256_kind: { ownerId: j.userId, sha256: sha, kind: 'render' } },
        create: {
          id: newId(),
          ownerId: j.userId,
          kind: 'render',
          sha256: sha,
          mime: o.mime,
          bytes: BigInt(bytes.length),
          width: p.width,
          height: p.height,
          storageKey,
          scanStatus: 'clean',
          scanNote: 'generated by the render worker',
          completed: true,
        },
        update: { lastRefAt: new Date() },
      });
      outputs.push({ format: o.format, assetId: asset.id });
    }
    await this.charge(j);
    const primary = outputs.find((o) => o.format === 'png') ?? outputs[0];
    const done = await this.db.renderJob.update({
      where: { id: j.id },
      data: {
        status: 'succeeded',
        progress: 1,
        samplesDone: r.samples,
        outputs: outputs as unknown as Prisma.InputJsonValue,
        outputAssetId: primary?.assetId ?? null,
        gpuSeconds: r.ms / 1000,
        finishedAt: new Date(),
      },
    });
    await this.emit(done, { type: 'render.finished', jobId: j.id, status: 'succeeded', outputAssetId: done.outputAssetId });
  }

  /** Exactly once per job (unique ledger key); a render credit pays when the monthly quota is used up. */
  private async charge(j: RenderJob): Promise<void> {
    const plan = await this.planOf(j.userId);
    const limit = plan.limits ? plan.limits.cloudRendersPerMonth : null;
    let creditGrantId: string | null = null;
    if (limit !== null) {
      const start = plan.periodStart;
      const used = await this.db.usageEvent.count({ where: { userId: j.userId, action: 'render.cloud', createdAt: { gte: start } } });
      if (used >= limit) {
        const grant = await this.db.creditGrant.findFirst({
          where: { userId: j.userId, kind: 'render', remaining: { gt: 0 }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
          orderBy: { expiresAt: 'asc' },
        });
        creditGrantId = grant?.id ?? null;
      }
    }
    try {
      await this.db.$transaction(async (tx) => {
        await tx.usageEvent.create({ data: { id: newId(), userId: j.userId, action: 'render.cloud', creditGrantId, key: `render:${j.id}` } });
        if (creditGrantId) await tx.creditGrant.update({ where: { id: creditGrantId }, data: { remaining: { decrement: 1 } } });
      });
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e; // already charged
    }
  }

  private async finish(j: RenderJob, status: 'cancelled' | 'failed', error?: { code: string; message: string }) {
    const done = await this.db.renderJob.update({
      where: { id: j.id },
      data: { status, finishedAt: new Date(), ...(error ? { errorCode: error.code, errorMessage: error.message } : {}) },
    });
    await this.emit(done, { type: 'render.finished', jobId: j.id, status, outputAssetId: null });
  }
}

// Code passed to page.evaluate runs in the render page; these are the browser globals it touches,
// typed minimally because this package compiles without the DOM library.
declare const window: {
  gsRender(input: RenderPageInput): Promise<RenderPageOutput>;
  gsCancel(): void;
  gsReady: boolean;
};
declare const document: {
  createElement(tag: 'canvas'): {
    getContext(kind: 'webgl2'): {
      RENDERER: number;
      getExtension(name: string): { UNMASKED_RENDERER_WEBGL: number } | null;
      getParameter(p: number): unknown;
    } | null;
  };
};
