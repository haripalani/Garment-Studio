import { createDevTee } from '@gs/core';
import { unzipSync, strFromU8 } from 'fflate';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Db } from '../src/infra/prisma';
import { Storage } from '../src/infra/storage';
import { Jobs } from '../src/jobs/jobs';
import { Client, PASSWORD, mailText, png, scanned, signUp, start, teeDoc, upload, type Running } from './helpers';

let s: Running;
beforeAll(async () => {
  s = await start();
});
afterAll(() => s.close());

describe('system', () => {
  it('health checks database, Redis, storage and antivirus', async () => {
    const r = await new Client(s.base).get('/health');
    expect(r.body).toEqual({ status: 'ok', checks: { database: 'ok', redis: 'ok', storage: 'ok', antivirus: 'ok' } });
  });

  it('errors are RFC 9457 problem+json with a stable code and request id', async () => {
    const c = new Client(s.base);
    c.contract = false; // unknown route: not in the contract by definition
    const r = await c.get('/nope');
    expect(r.status).toBe(404);
    expect(r.headers.get('content-type')).toMatch(/application\/problem\+json/);
    expect(r.body).toMatchObject({ status: 404, code: 'not_found' });
    expect(r.body.requestId).toMatch(/^[0-9a-f-]{36}$/);
    const malformed = await new Client(s.base).req('POST', '/auth/login', { raw: '{"email": ' });
    expect(malformed.status).toBe(400);
  });

  it('sends security headers and answers CORS only for allowed origins', async () => {
    const ok = await fetch(`${s.base}/v1/health`, { headers: { origin: 'http://localhost:5173' } });
    expect(ok.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect(ok.headers.get('access-control-allow-credentials')).toBe('true');
    expect(ok.headers.get('x-content-type-options')).toBe('nosniff');
    expect(ok.headers.get('content-security-policy')).toMatch(/default-src 'none'/);
    const evil = await fetch(`${s.base}/v1/health`, { headers: { origin: 'https://evil.example' } });
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('garment catalogue is public and cacheable; the thumbnail is on the public bucket', async () => {
    const c = new Client(s.base);
    const list = await c.get('/garments');
    expect(list.headers.get('cache-control')).toBe('public, max-age=300');
    expect(list.body.items).toEqual([expect.objectContaining({ id: 'dev-tee', version: '0.1.0', tier: 'free', name: 'Development tee' })]);
    expect((await fetch(list.body.items[0].thumbUrl)).headers.get('content-type')).toBe('image/svg+xml');
    const g = await c.get('/garments/dev-tee?version=0.1.0');
    expect(g.headers.get('cache-control')).toMatch(/immutable/);
    expect(g.body.pieces).toHaveLength(createDevTee().pieces.length);
    expect(g.body.meshUrl).toBeNull();
    expect((await c.get('/garments/unknown-garment')).status).toBe(404);
  });

  it('entitlement snapshots verify offline against the published key', async () => {
    const { c, userId } = await signUp(s.base, { verified: false });
    const e = await c.get('/entitlements');
    const jwks = await c.get('/auth/jwks');
    const { payload, protectedHeader } = await jwtVerify(e.body.snapshot, createLocalJWKSet(jwks.body), { audience: 'gs-entitlements' });
    expect(protectedHeader.typ).toBe('entitlements+jwt');
    expect(payload).toMatchObject({ sub: userId, planId: 'dev' });
    expect((payload.exp as number) - (payload.iat as number)).toBe(86400);
  });

  it('billing is disabled until a provider is chosen', async () => {
    const { c } = await signUp(s.base, { verified: false });
    expect((await c.get('/billing/plans')).body).toEqual({ items: [] });
    expect((await c.post('/billing/checkout', { planId: 'free', period: 'monthly' })).status).toBe(501);
    expect((await c.post('/billing/portal')).status).toBe(501);
    expect((await new Client(s.base).post('/billing/webhooks/stripe', { id: 'evt_1' })).body.code).toBe('billing_disabled');
  });

  it('data export: a ZIP of account, projects (all revisions) and files, emailed as a link; once per hour', async () => {
    const { c, email } = await signUp(s.base);
    const { asset } = await upload(c, png(12, 12), 'image/png');
    await scanned(c, asset.id);
    const p = await c.post('/projects', { name: 'Exported', doc: teeDoc() });
    const r = await c.post('/me/export');
    expect(r.status).toBe(202);
    expect((await c.post('/me/export')).status).toBe(429);
    const link = /Download export: (\S+)/.exec(await mailText(email, 'Your data export is ready'))![1]!;
    const zip = unzipSync(new Uint8Array(await (await fetch(link)).arrayBuffer()));
    expect(JSON.parse(strFromU8(zip['account.json']!)).email).toBe(email);
    expect(Object.keys(zip)).toContain(`projects/${p.body.id}/versions/1.json`);
    expect(Object.keys(zip).some((k) => k.startsWith('files/artwork/'))).toBe(true);
  });

  it('maintenance purges accounts deleted over 30 days ago (rows and files), trash, orphans and stale uploads', async () => {
    const db = s.app.get(Db);
    const storage = s.app.get(Storage);
    const gone = await signUp(s.base);
    const { asset } = await upload(gone.c, png(6, 6, [7, 7, 7]), 'image/png');
    await scanned(gone.c, asset.id);
    await gone.c.del('/me', { confirm: 'DELETE', currentPassword: PASSWORD });
    const key = `u/${gone.userId}/artwork/${asset.sha256}`;
    expect(await storage.head(key)).not.toBeNull();

    const keeper = await signUp(s.base);
    const trashed = await keeper.c.post('/projects', { name: 'Old trash', doc: teeDoc() });
    await keeper.c.del(`/projects/${trashed.body.id}`);
    const stale = await keeper.c.post('/assets/uploads', { sha256: 'c'.repeat(64), bytes: 100, mime: 'image/png', kind: 'artwork' });

    const jobs = s.app.get(Jobs);
    const before = await jobs.maintenance();
    expect(before.accounts).toBe(0); // only 0 days old
    const later = new Date(Date.now() + 31 * 86400_000);
    const out = await jobs.maintenance(later);
    expect(out.accounts).toBeGreaterThanOrEqual(1);
    expect(await db.user.findUnique({ where: { id: gone.userId } })).toBeNull();
    expect(await storage.head(key)).toBeNull();
    expect(await db.project.findUnique({ where: { id: trashed.body.id } })).toBeNull();
    expect(await db.asset.findUnique({ where: { id: stale.body.asset.id } })).toBeNull();
    expect((await keeper.c.get('/me')).status).toBe(200);
  });
});
