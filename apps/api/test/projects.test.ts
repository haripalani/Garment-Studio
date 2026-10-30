import { canonicalJson, createTextLayer } from '@gs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Db } from '../src/infra/prisma';
import { signUp, sha, start, teeDoc, type Client, type Running } from './helpers';

let s: Running;
let c: Client;
beforeAll(async () => {
  s = await start();
  c = (await signUp(s.base)).c;
});
afterAll(() => s.close());

const create = (name: string, doc = teeDoc(), headers?: Record<string, string>) =>
  c.post('/projects', { name, doc }, headers ? { headers } : undefined);

describe('projects', () => {
  it('requires a confirmed email before saving to the cloud', async () => {
    const u = await signUp(s.base, { verified: false });
    const r = await u.c.post('/projects', { name: 'x', doc: teeDoc() });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('email_unverified');
  });

  it('creates revision 1 from a document and returns it as the head', async () => {
    const doc = teeDoc((d) => d.layers.push(createTextLayer({ pieceId: 'front', side: 'outside', x: 100, y: 120, w: 200, h: 60 }, 'Hello')));
    const r = await create('Summer tee', doc);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ name: 'Summer tee', garmentModelId: 'dev-tee', headRevision: 1, deleted: false });
    expect(r.body.head).toMatchObject({ revision: 1, baseRevision: null, schemaVersion: 2, platform: 'web' });
    expect(r.body.head.doc.layers[0].text).toBe('Hello');
    expect(r.body.head.docSha256).toBe(await sha(doc));
  });

  it('keeps a client-supplied id (offline-created projects) and refuses a duplicate id', async () => {
    const id = 'a'.repeat(4) + Math.random().toString(36).slice(2, 22).padEnd(20, 'x');
    const r = await c.post('/projects', { id, name: 'Offline', doc: teeDoc() });
    expect(r.body.id).toBe(id);
    expect((await c.post('/projects', { id, name: 'Again', doc: teeDoc() })).body.code).toBe('project_exists');
  });

  it('migrates a v1 document on the way in', async () => {
    const v1 = teeDoc() as Record<string, unknown>;
    delete v1.look;
    v1.schemaVersion = 1;
    const r = await create('Old file', v1 as never);
    expect(r.status).toBe(201);
    expect(r.body.head.schemaVersion).toBe(2);
    expect(r.body.head.doc.look.fabric).toBeDefined();
  });

  it('validates the document with the shared schema and reports paths', async () => {
    const bad = teeDoc((d) => d.layers.push({ ...createTextLayer({ pieceId: 'front', side: 'outside', x: 0, y: 0, w: -5, h: 10 }) }));
    const r = await create('Bad', bad);
    expect(r.status).toBe(422);
    expect(r.body.errors[0].path).toBe('doc.layers.0.w');
    const g = await create('Ghost garment', teeDoc((d) => (d.garment.modelId = 'no-such-garment')));
    expect(g.body.errors[0].path).toBe('doc.garment');
  });

  it('refuses documents over 2 MB with 413', async () => {
    const big = teeDoc((d) => {
      d.layers.push({ ...createTextLayer({ pieceId: 'front', side: 'outside', x: 0, y: 0, w: 10, h: 10 }), text: 'x'.repeat(2_200_000) } as never);
    });
    expect(canonicalJson(big).length).toBeGreaterThan(2 * 1024 * 1024);
    const r = await create('Huge', big);
    expect(r.status).toBe(413);
    expect(r.body.code).toBe('doc_too_large');
  });

  it('requires every referenced image to be uploaded first', async () => {
    const doc = teeDoc((d) => {
      d.assets.img1 = { sha256: 'f'.repeat(64), mime: 'image/png', bytes: 10, width: 1, height: 1, name: 'x.png' };
    });
    const r = await create('Missing art', doc);
    expect(r.status).toBe(422);
    expect(r.body).toMatchObject({ code: 'asset_missing', missing: ['img1'] });
  });

  it('serves the head with an ETag and answers 304 when unchanged', async () => {
    const p = (await create('Etag')).body;
    const r = await c.get(`/projects/${p.id}`);
    expect(r.headers.get('etag')).toBe('"r1"');
    expect((await c.get(`/projects/${p.id}`, { headers: { 'if-none-match': '"r1"' } })).status).toBe(304);
  });

  it('push: accepts the next revision only from the current head, 409 carries the head for merging', async () => {
    const p = (await create('Versioned')).body;
    const doc2 = teeDoc((d) => (d.name = 'second'));
    const push = (base: number, doc: unknown, extra: Record<string, unknown> = {}) =>
      sha(doc).then((h) => c.post(`/projects/${p.id}/versions`, { baseRevision: base, doc, docSha256: h, platform: 'web', deviceId: 'dev-1', ...extra }));
    const ok = await push(1, doc2);
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ revision: 2, baseRevision: 1, deviceId: 'dev-1' });

    const stale = await push(1, teeDoc((d) => (d.name = 'from another device')));
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('stale_revision');
    expect(stale.body.head).toMatchObject({ revision: 2 });
    expect(stale.body.head.doc.name).toBe('second');

    const tampered = await push(2, doc2, { docSha256: 'a'.repeat(64) });
    expect(tampered.status).toBe(422);
    expect(tampered.body.errors[0].path).toBe('docSha256');
    expect((await c.get(`/projects/${p.id}`)).body.headRevision).toBe(2);
  });

  it('concurrent pushes from the same base: exactly one wins', async () => {
    const p = (await create('Race')).body;
    const docs = [0, 1, 2, 3, 4].map((i) => teeDoc((d) => (d.name = `device ${i}`)));
    const results = await Promise.all(
      docs.map(async (doc) =>
        c.post(`/projects/${p.id}/versions`, { baseRevision: 1, doc, docSha256: await sha(doc), platform: 'web' }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(4);
    expect((await c.get(`/projects/${p.id}/versions`)).body.items.map((v: { revision: number }) => v.revision)).toEqual([2, 1]);
  });

  it('lists versions newest first with cursor pagination, and fetches any revision', async () => {
    const p = (await create('History')).body;
    for (let rev = 1; rev < 5; rev++) {
      const doc = teeDoc((d) => (d.name = `r${rev + 1}`));
      await c.post(`/projects/${p.id}/versions`, { baseRevision: rev, doc, docSha256: await sha(doc), platform: 'pwa' });
    }
    const page1 = await c.get(`/projects/${p.id}/versions?limit=2`);
    expect(page1.body.items.map((v: { revision: number }) => v.revision)).toEqual([5, 4]);
    const page2 = await c.get(`/projects/${p.id}/versions?limit=2&cursor=${page1.body.nextCursor}`);
    const page3 = await c.get(`/projects/${p.id}/versions?limit=2&cursor=${page2.body.nextCursor}`);
    expect(page2.body.items.map((v: { revision: number }) => v.revision)).toEqual([3, 2]);
    expect(page3.body).toMatchObject({ nextCursor: null });
    expect((await c.get(`/projects/${p.id}/versions/3`)).body.doc.name).toBe('r3');
    expect((await c.get(`/projects/${p.id}/versions/99`)).status).toBe(404);
    expect((await c.get(`/projects/${p.id}/versions?cursor=garbage`)).body.code).toBe('invalid_cursor');
  });

  it('idempotent create: same key + body replays, same key + different body is refused', async () => {
    const key = `create-${Date.now()}`;
    const doc = teeDoc();
    const a = await create('Once', doc, { 'idempotency-key': key });
    const b = await create('Once', doc, { 'idempotency-key': key });
    expect(b.status).toBe(201);
    expect(b.body.id).toBe(a.body.id);
    const list = await c.get(`/projects?q=Once`);
    expect(list.body.items.filter((p: { name: string }) => p.name === 'Once')).toHaveLength(1);
    expect((await create('Different', doc, { 'idempotency-key': key })).body.code).toBe('idempotency_key_reuse');
  });

  it('rename, trash, restore and tombstones for sync', async () => {
    const p = (await create('Trash me')).body;
    const since = new Date(Date.now() - 1000).toISOString();
    expect((await c.patch(`/projects/${p.id}`, { name: 'Renamed' })).body.name).toBe('Renamed');
    expect((await c.del(`/projects/${p.id}`)).status).toBe(204);
    expect((await c.get(`/projects/${p.id}`)).status).toBe(404);
    const live = await c.get('/projects?limit=100');
    expect(live.body.items.some((x: { id: string }) => x.id === p.id)).toBe(false);
    const trash = await c.get('/projects?trash=true');
    expect(trash.body.items.find((x: { id: string }) => x.id === p.id)).toMatchObject({ deleted: true });
    const sync = await c.get(`/projects?updatedSince=${encodeURIComponent(since)}`);
    expect(sync.body.items.find((x: { id: string }) => x.id === p.id)).toMatchObject({ deleted: true, name: 'Renamed' });
    expect((await c.post(`/projects/${p.id}/restore`)).body.deleted).toBe(false);
    expect((await c.post(`/projects/${p.id}/restore`)).status).toBe(404);
  });

  it('paginates the project list by last update, newest first, and searches by name', async () => {
    const u = (await signUp(s.base)).c;
    for (const n of ['Alpha', 'Beta', 'Gamma', 'Delta', 'alphabet soup']) await u.post('/projects', { name: n, doc: teeDoc() });
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: { body: { items: { name: string }[]; nextCursor: string | null } } = await u.get(
        `/projects?limit=2${cursor ? `&cursor=${cursor}` : ''}`,
      );
      seen.push(...page.body.items.map((p) => p.name));
      cursor = page.body.nextCursor;
    } while (cursor);
    expect(seen).toEqual(['alphabet soup', 'Delta', 'Gamma', 'Beta', 'Alpha']);
    expect((await u.get('/projects?q=ALPHA')).body.items.map((p: { name: string }) => p.name).sort()).toEqual(['Alpha', 'alphabet soup']);
  });

  it('duplicates the head as a new project', async () => {
    const p = (await create('Original', teeDoc((d) => (d.name = 'orig')))).body;
    const d = await c.post(`/projects/${p.id}/duplicate`, {});
    expect(d.status).toBe(201);
    expect(d.body).toMatchObject({ name: 'Original (copy)', headRevision: 1 });
    expect(d.body.id).not.toBe(p.id);
    expect(d.body.head.doc.name).toBe('orig');
  });

  it("never exposes another user's projects (404, not 403)", async () => {
    const p = (await create('Private')).body;
    const other = (await signUp(s.base)).c;
    expect((await other.get(`/projects/${p.id}`)).status).toBe(404);
    expect((await other.patch(`/projects/${p.id}`, { name: 'mine now' })).status).toBe(404);
    expect((await other.del(`/projects/${p.id}`)).status).toBe(404);
    const doc = teeDoc();
    expect(
      (await other.post(`/projects/${p.id}/versions`, { baseRevision: 1, doc, docSha256: await sha(doc), platform: 'web' })).status,
    ).toBe(404);
    expect((await other.get('/projects')).body.items).toEqual([]);
  });
});

describe('entitlements', () => {
  it('reports plan, limits, usage and a signed offline snapshot', async () => {
    const r = await c.get('/entitlements');
    expect(r.body.planId).toBe('dev');
    expect(r.body.limits.projects).toBeNull();
    expect(r.body.usage.projects).toBeGreaterThan(0);
    expect(r.body.snapshot.split('.')).toHaveLength(3);
  });

  it('enforces plan limits with 402 (manual plan assignment by an admin)', async () => {
    const admin = await signUp(s.base);
    const user = await signUp(s.base);
    expect((await user.c.put(`/admin/users/${user.userId}/plan`, { planId: 'free' })).body.code).toBe('admin_only');
    await s.app.get(Db).user.update({ where: { id: admin.userId }, data: { role: 'admin' } });
    admin.c.adopt(await admin.c.post('/auth/refresh', undefined, { headers: { 'x-csrf-token': admin.c.csrf! } }));
    const assigned = await admin.c.put(`/admin/users/${user.userId}/plan`, { planId: 'free' });
    expect(assigned.status).toBe(200);
    expect(assigned.body).toMatchObject({ planId: 'free', limits: { projects: 3 } });

    for (let i = 0; i < 3; i++) expect((await user.c.post('/projects', { name: `p${i}`, doc: teeDoc() })).status).toBe(201);
    const fourth = await user.c.post('/projects', { name: 'p3', doc: teeDoc() });
    expect(fourth.status).toBe(402);
    expect(fourth.body).toMatchObject({ code: 'entitlement_required', action: 'project.create', limit: 3, used: 3 });
    expect((await user.c.get('/entitlements')).body.usage.projects).toBe(3);
    // Deleting one frees a slot; restoring it over the limit is refused.
    const list = (await user.c.get('/projects')).body.items;
    await user.c.del(`/projects/${list[0].id}`);
    expect((await user.c.post('/projects', { name: 'p4', doc: teeDoc() })).status).toBe(201);
    expect((await user.c.post(`/projects/${list[0].id}/restore`)).status).toBe(402);
  });
});
