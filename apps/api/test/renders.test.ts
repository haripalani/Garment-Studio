import { createImageLayer, createTextLayer } from '@gs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inflateSync } from 'node:zlib';
import { WebSocket } from 'ws';
import { Db } from '../src/infra/prisma';
import { RedisService } from '../src/infra/redis';
import { Storage } from '../src/infra/storage';
import { RenderRunner } from '../src/renders/runner';
import { newId } from '../src/common/crypto';
import { testConfig } from './env';
import { png, scanned, sha, signUp, start, teeDoc, upload, waitFor, type Client, type Running } from './helpers';

let s: Running;
let runner: RenderRunner;
let c: Client;
let userId: string;
let projectId: string;

/** Live events for a signed-in client, collected as they arrive. */
async function listen(client: Client) {
  const ws = new WebSocket(`${s.base.replace('http', 'ws')}/v1/ws`);
  const events: { type: string; [k: string]: unknown }[] = [];
  await new Promise<void>((ok, fail) => {
    ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token: client.token })));
    ws.on('message', (m) => {
      const e = JSON.parse(String(m)) as { type: string };
      if (e.type === 'ready') ok();
      events.push(e);
    });
    ws.on('error', fail);
  });
  return { ws, events };
}

const until = (id: string, statuses: string[]) =>
  waitFor(() => c.get(`/renders/${id}`), (r) => statuses.includes(r.body.status), 120_000).then((r) => r.body);

const pngSize = (b: Buffer) => ({ width: b.readUInt32BE(16), height: b.readUInt32BE(20) });

/** RGBA of the top-left pixel (row filters don't change the first pixel of the first row). */
function firstPixel(b: Buffer): { colourType: number; rgba: number[] } {
  const idat: Buffer[] = [];
  for (let off = 8; off < b.length; ) {
    const len = b.readUInt32BE(off);
    if (b.toString('ascii', off + 4, off + 8) === 'IDAT') idat.push(b.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const colourType = b[25]!;
  const channels = colourType === 6 ? 4 : 3;
  return { colourType, rgba: [...raw.subarray(1, 1 + channels)] };
}

/** Machines without a GPU (CI runners) skip the render worker: software WebGL compiles too slowly. */
const GPU = process.env.SKIP_GPU_TESTS !== '1';

beforeAll(async () => {
  s = await start();
  const config = testConfig();
  const redis = s.app.get(RedisService);
  runner = new RenderRunner(config, s.app.get(Db), s.app.get(Storage), redis.client, () => redis.connection());
  if (GPU) await runner.start();
  const u = await signUp(s.base);
  c = u.c;
  userId = u.userId;
  // A design with an uploaded image and text, saved as revision 1.
  const bytes = png(64, 64, [30, 90, 200]);
  const { asset } = await upload(c, bytes, 'image/png');
  await scanned(c, asset.id);
  const doc = teeDoc((d) => {
    d.assets.art = { sha256: asset.sha256, mime: 'image/png', bytes: bytes.length, width: 64, height: 64, name: 'art.png' };
    d.layers.push(createImageLayer({ pieceId: 'front', side: 'outside', x: 260, y: 300, w: 200, h: 200 }, 'art', 'art.png'));
    d.layers.push(createTextLayer({ pieceId: 'back', side: 'outside', x: 260, y: 200, w: 300, h: 80 }, 'Studio'));
  });
  projectId = (await c.post('/projects', { name: 'Render me', doc })).body.id;
}, 120_000);

afterAll(async () => {
  await runner?.stop();
  await s?.close();
});

const body = (extra: Record<string, unknown> = {}) => ({
  projectId,
  revision: 1,
  width: 320,
  height: 400,
  quality: 'draft',
  frame: 'front',
  ...extra,
});

describe.skipIf(!GPU)('cloud renders', () => {
  it('renders in headless Chromium with the editor path tracer, streams progress, stores PNG and WebP, charges once', async () => {
    const { ws, events } = await listen(c);
    const r = await c.post('/renders', body());
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({ status: 'queued', progress: 0, outputs: [], params: { formats: ['png', 'webp'], transparent: false } });
    const done = await until(r.body.id, ['succeeded', 'failed']);
    expect(done.error).toBeNull();
    expect(done).toMatchObject({ status: 'succeeded', progress: 1, samplesDone: 4 });
    expect(done.outputs.map((o: { format: string }) => o.format)).toEqual(['png', 'webp']);
    const pngBytes = Buffer.from(await (await fetch(done.outputs[0].url)).arrayBuffer());
    expect(pngSize(pngBytes)).toEqual({ width: 320, height: 400 });
    expect(pngBytes.length).toBeGreaterThan(20_000); // a real image, not a blank frame
    const corner = firstPixel(pngBytes);
    expect(corner.rgba[3] ?? 255).toBe(255); // opaque: backdrop
    const webp = Buffer.from(await (await fetch(done.outputs[1].url)).arrayBuffer());
    expect(webp.subarray(8, 12).toString()).toBe('WEBP');

    await waitFor(async () => events.length, () => events.some((e) => e.type === 'render.finished'), 10_000);
    expect(events.some((e) => e.type === 'render.progress' && e.jobId === r.body.id)).toBe(true);
    expect(events.find((e) => e.type === 'render.finished')).toMatchObject({ jobId: r.body.id, status: 'succeeded' });
    ws.close();

    expect((await c.get('/entitlements')).body.usage.cloudRendersThisPeriod).toBe(1);
    const assets = await s.app.get(Db).asset.findMany({ where: { ownerId: userId, kind: 'render' } });
    expect(assets).toHaveLength(2);
  });

  it('renders the exact view of a "preview" frame from its camera, and transparent backgrounds', async () => {
    expect((await c.post('/renders', body({ frame: 'preview' }))).body.errors[0].path).toBe('camera');
    const r = await c.post('/renders', body({ frame: 'preview', camera: { azimuth: 0.6, polar: 1.4, distance: 2.4, target: [0, 0.04, 0] }, transparent: true, formats: ['png'] }));
    const done = await until(r.body.id, ['succeeded', 'failed']);
    expect(done.status).toBe('succeeded');
    expect(done.outputs).toHaveLength(1);
    const corner = firstPixel(Buffer.from(await (await fetch(done.outputs[0].url)).arrayBuffer()));
    expect(corner.colourType).toBe(6);
    expect(corner.rgba[3]).toBe(0); // transparent background: no backdrop in the corner
  });

  it('cancels a queued render (never charged) and retries it as a new job', async () => {
    await runner.pause();
    const before = (await c.get('/entitlements')).body.usage.cloudRendersThisPeriod;
    const r = await c.post('/renders', body());
    expect(r.body.queuePosition).toBe(0);
    const cancelled = await c.post(`/renders/${r.body.id}/cancel`);
    expect(cancelled.status).toBe(202);
    expect(cancelled.body.status).toBe('cancelled');
    expect((await c.post(`/renders/${r.body.id}/cancel`)).body.code).toBe('not_cancellable');
    runner.resume();
    const retried = await c.post(`/renders/${r.body.id}/retry`);
    expect(retried.status).toBe(202);
    expect(retried.body.id).not.toBe(r.body.id);
    expect((await until(retried.body.id, ['succeeded', 'failed'])).status).toBe('succeeded');
    expect((await c.get('/entitlements')).body.usage.cloudRendersThisPeriod).toBe(before + 1);
    expect((await c.post(`/renders/${retried.body.id}/retry`)).body.code).toBe('not_retryable');
  });

  it('cancels a running render between samples', async () => {
    runner.samplesOverride = 100_000;
    try {
      const r = await c.post('/renders', body({ width: 256, height: 256 }));
      await waitFor(() => c.get(`/renders/${r.body.id}`), (x) => x.body.status === 'running' && x.body.samplesDone > 0, 120_000);
      expect((await c.post(`/renders/${r.body.id}/cancel`)).status).toBe(202);
      const done = await until(r.body.id, ['cancelled', 'succeeded', 'failed']);
      expect(done.status).toBe('cancelled');
      expect(done.samplesDone).toBeLessThan(100_000);
    } finally {
      runner.samplesOverride = 4;
    }
  });

  it('lists renders newest first, filtered by project, with cursor pagination', async () => {
    const page1 = await c.get(`/renders?limit=2&projectId=${projectId}`);
    expect(page1.body.items).toHaveLength(2);
    const page2 = await c.get(`/renders?limit=2&projectId=${projectId}&cursor=${page1.body.nextCursor}`);
    expect(page2.body.items[0].createdAt <= page1.body.items[1].createdAt).toBe(true);
    const other = (await signUp(s.base)).c;
    expect((await other.get(`/renders/${page1.body.items[0].id}`)).status).toBe(404);
  });

  it('enforces plan limits: size, quality and the monthly quota, with render credits covering overflow', async () => {
    const u = await signUp(s.base);
    const db = s.app.get(Db);
    const now = new Date();
    await db.subscription.create({
      data: { id: newId(), userId: u.userId, planId: 'free', status: 'active', provider: 'manual', currentPeriodStart: now, currentPeriodEnd: new Date(now.getTime() + 30 * 86400_000) },
    });
    const p = (await u.c.post('/projects', { name: 'Free plan', doc: teeDoc() })).body.id;
    const req = (extra: Record<string, unknown>) => u.c.post('/renders', { ...body(), projectId: p, ...extra });
    expect((await req({ width: 2000, height: 2000 })).body).toMatchObject({ code: 'entitlement_required', action: 'render.size', limit: 1080 });
    expect((await req({ quality: 'good' })).body).toMatchObject({ action: 'render.quality' });
    expect((await req({})).body).toMatchObject({ action: 'render.cloud', limit: 0, used: 0 });
    // One render credit (e.g. a credit pack) allows one render, consumed on success.
    await db.creditGrant.create({ data: { id: newId(), userId: u.userId, kind: 'render', amount: 1, remaining: 1, source: 'admin' } });
    const r = await req({});
    expect(r.status).toBe(202);
    expect((await req({})).status).toBe(402); // the credit is reserved by the job in flight
    const done = await waitFor(() => u.c.get(`/renders/${r.body.id}`), (x) => ['succeeded', 'failed'].includes(x.body.status), 120_000);
    expect(done.body.status).toBe('succeeded');
    expect((await u.c.get('/entitlements')).body.credits.render).toBe(0);
  });

  it('refuses renders of missing projects or revisions', async () => {
    expect((await c.post('/renders', body({ projectId: newId() }))).status).toBe(404);
    expect((await c.post('/renders', body({ revision: 9 }))).body.errors[0].path).toBe('revision');
  });
});

describe('export records', () => {
  it('counts client-side exports against the monthly quota; credits cover overflow; idempotent', async () => {
    const u = await signUp(s.base);
    const db = s.app.get(Db);
    const now = new Date();
    await db.subscription.create({
      data: { id: newId(), userId: u.userId, planId: 'free', status: 'active', provider: 'manual', currentPeriodStart: now, currentPeriodEnd: new Date(now.getTime() + 30 * 86400_000) },
    });
    const p = (await u.c.post('/projects', { name: 'Exports', doc: teeDoc() })).body.id;
    const rec = { projectId: p, revision: 1, kind: 'print_zip', ranOn: 'client', params: { dpi: 300, bleedMm: 5 } };
    const first = await u.c.post('/exports', rec, { headers: { 'idempotency-key': 'export-key-1' } });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ kind: 'print_zip', ranOn: 'client', status: 'succeeded' });
    expect((await u.c.post('/exports', rec, { headers: { 'idempotency-key': 'export-key-1' } })).body.id).toBe(first.body.id);
    expect((await u.c.get(`/exports/${first.body.id}`)).body.id).toBe(first.body.id);
    for (let i = 1; i < 10; i++) expect((await u.c.post('/exports', rec)).status).toBe(201);
    const over = await u.c.post('/exports', rec);
    expect(over.body).toMatchObject({ code: 'entitlement_required', action: 'export.create', limit: 10, used: 10 });
    await db.creditGrant.create({ data: { id: newId(), userId: u.userId, kind: 'export', amount: 2, remaining: 2, source: 'admin' } });
    expect((await u.c.post('/exports', rec)).status).toBe(201);
    expect((await u.c.get('/entitlements')).body).toMatchObject({ usage: { exportsThisPeriod: 11 }, credits: { export: 1 } });
    expect((await u.c.post('/exports', { ...rec, ranOn: 'server' })).status).toBe(501);
    expect((await u.c.post('/exports', { ...rec, projectId: newId() })).status).toBe(404);
  });
});

describe('live events', () => {
  it('requires auth within 5 s, answers pings, and pushes project.updated on a new revision', async () => {
    const silent = new WebSocket(`${s.base.replace('http', 'ws')}/v1/ws`);
    const code = await new Promise<number>((ok) => silent.on('close', (c2) => ok(c2)));
    expect(code).toBe(4401);
    const bad = new WebSocket(`${s.base.replace('http', 'ws')}/v1/ws`);
    bad.on('open', () => bad.send(JSON.stringify({ type: 'auth', token: 'nope' })));
    expect(await new Promise<number>((ok) => bad.on('close', (c2) => ok(c2)))).toBe(4401);

    const { ws, events } = await listen(c);
    ws.send(JSON.stringify({ type: 'ping' }));
    const doc = teeDoc((d) => (d.name = 'v2'));
    await c.post(`/projects/${projectId}/versions`, { baseRevision: 1, doc, docSha256: await sha(doc), platform: 'web', deviceId: 'tablet' });
    await waitFor(async () => events, (e) => e.some((x) => x.type === 'project.updated'), 10_000);
    expect(events.find((e) => e.type === 'project.updated')).toEqual({ type: 'project.updated', projectId, headRevision: 2, deviceId: 'tablet' });
    expect(events.some((e) => e.type === 'pong')).toBe(true);
    ws.close();
  });
});
