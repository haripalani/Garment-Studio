import { createImageLayer } from '@gs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Db } from '../src/infra/prisma';
import { Storage } from '../src/infra/storage';
import { png, scanned, sha256, signUp, start, teeDoc, upload, type Client, type Running } from './helpers';

let s: Running;
let c: Client;
beforeAll(async () => {
  s = await start();
  c = (await signUp(s.base)).c;
});
afterAll(() => s.close());

const enc = (t: string) => new TextEncoder().encode(t);
// EICAR antivirus test file (harmless by design); the backslash is built from its code point.
const EICAR = enc(`X5O!P%@AP[4${String.fromCharCode(92)}PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*`);

describe('uploads', () => {
  it('uploads straight to storage with presigned parts, scans clean, then serves a short-lived download', async () => {
    const bytes = png(640, 480);
    const { ticket, asset } = await upload(c, bytes, 'image/png');
    expect(ticket.status).toBe(201);
    expect(ticket.body.parts).toHaveLength(1);
    expect(asset).toMatchObject({ completed: true, scanStatus: 'pending' });
    expect((await c.get(`/assets/${asset.id}`)).body.downloadUrl).toBeNull();

    const done = await scanned(c, asset.id);
    expect(done).toMatchObject({ scanStatus: 'clean', width: 640, height: 480, isVector: false });
    const dl = await fetch(done.downloadUrl);
    expect(dl.status).toBe(200);
    expect(dl.headers.get('content-disposition')).toMatch(/^attachment/);
    expect(sha256(new Uint8Array(await dl.arrayBuffer()))).toBe(sha256(bytes));
  });

  it('a multi-part upload (12 MB, 3 parts) completes and verifies', async () => {
    const big = new Uint8Array(12 * 1024 * 1024);
    big.set(png(64, 64));
    // Trailing bytes after IEND keep it a valid PNG for the sniffer and decoder.
    for (let i = 70_000; i < big.length; i += 4096) big[i] = i % 251;
    const { ticket, asset } = await upload(c, big, 'image/png');
    expect(ticket.body.parts).toHaveLength(3);
    expect(ticket.body.partSize).toBe(5 * 1024 * 1024);
    expect((await scanned(c, asset.id)).scanStatus).toBe('clean');
  });

  it('dedupes by content: the same file again returns the existing asset (200)', async () => {
    const bytes = png(10, 10, [1, 2, 3]);
    const first = await upload(c, bytes, 'image/png');
    const again = await c.post('/assets/uploads', { sha256: sha256(bytes), bytes: bytes.length, mime: 'image/png', kind: 'artwork' });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ deduped: true, asset: { id: first.asset.id } });
  });

  it('resumes an interrupted upload: lists finished parts and re-issues URLs for the same upload', async () => {
    const bytes = png(20, 20, [9, 9, 9]);
    const body = { sha256: sha256(bytes), bytes: bytes.length, mime: 'image/png', kind: 'artwork' };
    const t1 = await c.post('/assets/uploads', body);
    expect((await c.get(`/assets/${t1.body.asset.id}/parts`)).body.parts).toEqual([]);
    const put = await fetch(t1.body.parts[0].url, { method: 'PUT', body: bytes });
    const t2 = await c.post('/assets/uploads', body);
    expect(t2.status).toBe(201);
    expect(t2.body.asset.id).toBe(t1.body.asset.id);
    const parts = (await c.get(`/assets/${t1.body.asset.id}/parts`)).body.parts;
    expect(parts).toEqual([{ partNumber: 1, etag: put.headers.get('etag') }]);
    expect((await c.post(`/assets/${t1.body.asset.id}/complete`, { parts })).status).toBe(200);
    expect((await c.post(`/assets/${t1.body.asset.id}/complete`, { parts })).body.code).toBe('already_completed');
  });

  it('refuses unsupported types (415) and oversized files (413) before any upload', async () => {
    const r1 = await c.post('/assets/uploads', { sha256: 'a'.repeat(64), bytes: 10, mime: 'application/zip', kind: 'artwork' });
    expect(r1.status).toBe(415);
    const r2 = await c.post('/assets/uploads', { sha256: 'a'.repeat(64), bytes: 60 * 1024 * 1024, mime: 'image/png', kind: 'artwork' });
    expect(r2.status).toBe(413);
    const r3 = await c.post('/assets/uploads', { sha256: 'a'.repeat(64), bytes: 10, mime: 'image/svg+xml', kind: 'thumbnail' });
    expect(r3.status).toBe(415);
  });

  it('rejects content that is not what it claims, and deletes it from storage', async () => {
    const { asset } = await upload(c, enc('<html><body>not a png</body></html>'), 'image/png');
    const done = await scanned(c, asset.id);
    expect(done.scanStatus).toBe('rejected');
    expect(done.downloadUrl).toBeNull();
    const row = await s.app.get(Db).asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(row.scanNote).toBe('content is an unknown type, not image/png');
    const key = (await s.app.get(Storage).head(`u/${(await c.get('/me')).body.id}/artwork/${done.sha256}`)) ?? null;
    expect(key).toBeNull();
    // The same bytes again are refused up front.
    const again = await c.post('/assets/uploads', { sha256: done.sha256, bytes: done.bytes, mime: 'image/png', kind: 'artwork' });
    expect(again.body.code).toBe('asset_rejected');
  });

  it('rejects bytes that do not match the declared SHA-256 (uploader lied about the content)', async () => {
    const real = png(8, 8);
    const t = await c.post('/assets/uploads', { sha256: sha256(png(8, 8, [0, 0, 0])), bytes: real.length, mime: 'image/png', kind: 'artwork' });
    const put = await fetch(t.body.parts[0].url, { method: 'PUT', body: real });
    await c.post(`/assets/${t.body.asset.id}/complete`, { parts: [{ partNumber: 1, etag: put.headers.get('etag') }] });
    expect((await scanned(c, t.body.asset.id)).scanStatus).toBe('rejected');
    const row = await s.app.get(Db).asset.findUniqueOrThrow({ where: { id: t.body.asset.id } });
    expect(row.scanNote).toBe('content does not match the declared SHA-256');
  });

  it('rejects a size mismatch at completion', async () => {
    const t = await c.post('/assets/uploads', { sha256: 'b'.repeat(64), bytes: 1000, mime: 'image/png', kind: 'artwork' });
    const put = await fetch(t.body.parts[0].url, { method: 'PUT', body: png(4, 4) });
    const done = await c.post(`/assets/${t.body.asset.id}/complete`, { parts: [{ partNumber: 1, etag: put.headers.get('etag') }] });
    expect(done.status).toBe(422);
    expect((await c.get(`/assets/${t.body.asset.id}`)).status).toBe(404);
  });

  it('accepts a clean SVG (vector, size from viewBox) and rejects scripted ones', async () => {
    const good = await upload(c, enc('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 150"><rect width="10" height="10"/></svg>'), 'image/svg+xml');
    expect(await scanned(c, good.asset.id)).toMatchObject({ scanStatus: 'clean', isVector: true, width: 300, height: 150 });
    const bad = await upload(c, enc('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'image/svg+xml');
    expect(await scanned(c, bad.asset.id)).toMatchObject({ scanStatus: 'rejected' });
  });

  it('antivirus: ClamAV catches the EICAR test file', async () => {
    const { asset } = await upload(c, EICAR, 'application/pdf');
    const done = await scanned(c, asset.id);
    expect(done.scanStatus).toBe('rejected');
    const row = await s.app.get(Db).asset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(row.scanNote).toBe('malware detected (Eicar-Test-Signature)');
  });

  it("assets are private: another user's id is a 404 and storage refuses anonymous reads", async () => {
    const { asset } = await upload(c, png(5, 5, [5, 5, 5]), 'image/png');
    const other = (await signUp(s.base)).c;
    expect((await other.get(`/assets/${asset.id}`)).status).toBe(404);
    const me = (await c.get('/me')).body.id;
    const anon = await fetch(`${process.env.S3_ENDPOINT}/gs-test/u/${me}/artwork/${asset.sha256}`);
    expect(anon.status).toBe(403);
  });
});

describe('lookup by content hash (sync on another device)', () => {
  it("finds my clean uploads by SHA-256 with download links, never other users' files", async () => {
    const a = png(9, 9, [1, 1, 1]);
    const b = png(9, 9, [2, 2, 2]);
    const ua = (await upload(c, a, 'image/png')).asset;
    const ub = (await upload(c, b, 'image/png')).asset;
    await scanned(c, ua.id);
    await scanned(c, ub.id);
    const found = await c.get(`/assets?sha256=${sha256(a)}&sha256=${sha256(b)}&sha256=${'0'.repeat(64)}`);
    expect(found.body.items.map((x: { id: string }) => x.id).sort()).toEqual([ua.id, ub.id].sort());
    expect(found.body.items.every((x: { downloadUrl: string | null }) => x.downloadUrl)).toBe(true);
    const other = (await signUp(s.base)).c;
    expect((await other.get(`/assets?sha256=${sha256(a)}`)).body.items).toEqual([]);
    expect((await c.get('/assets?sha256=nothex')).status).toBe(422);
  });
});

describe('assets in projects', () => {
  it('a document may reference an uploaded image; thumbnails attach to projects', async () => {
    const bytes = png(32, 32, [0, 128, 255]);
    const { asset } = await upload(c, bytes, 'image/png');
    const doc = teeDoc((d) => {
      d.assets.art = { sha256: asset.sha256, mime: 'image/png', bytes: bytes.length, width: 32, height: 32, name: 'art.png' };
      d.layers.push(createImageLayer({ pieceId: 'front', side: 'outside', x: 50, y: 50, w: 100, h: 100 }, 'art', 'art.png'));
    });
    const p = await c.post('/projects', { name: 'With art', doc });
    expect(p.status).toBe(201);

    const thumb = await upload(c, png(64, 64, [20, 20, 20]), 'image/png', 'thumbnail');
    expect((await c.put(`/projects/${p.body.id}/thumbnail`, { assetId: asset.id })).status).toBe(422); // wrong kind
    expect((await c.put(`/projects/${p.body.id}/thumbnail`, { assetId: thumb.asset.id })).status).toBe(204);
    await scanned(c, thumb.asset.id);
    const summary = (await c.get('/projects?q=With art')).body.items[0];
    expect(summary.thumbnailUrl).toMatch(/^http/);
    expect((await fetch(summary.thumbnailUrl)).status).toBe(200);
  });
});
