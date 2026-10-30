// Test client over real HTTP: tracks cookies like a browser, presents its own client IP, and checks
// every response against the OpenAPI contract.
import { createHash, randomBytes } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createDevTee, createDoc, docSha256, type ProjectDoc } from '@gs/core';
import { createApp } from '../src/app';
import { appendFileSync, mkdirSync } from 'node:fs';
import { checkContract, stats } from './contract';
import { MAILPIT, testConfig } from './env';

export interface Running {
  app: NestFastifyApplication;
  base: string;
  close: () => Promise<void>;
}

export async function start(): Promise<Running> {
  const app = await createApp(testConfig(), { logger: false });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.getHttpServer().address() as { port: number };
  return {
    app,
    base: `http://127.0.0.1:${addr.port}`,
    close: async () => {
      // Contract coverage across files: operation + status pairs this file exercised.
      mkdirSync('test-results', { recursive: true });
      appendFileSync('test-results/contract-ops.txt', [...stats.operations].map((o) => `${o}\n`).join(''));
      await app.close();
    },
  };
}

export interface Res<T = any> {
  status: number;
  headers: Headers;
  body: T;
}

/** Random per client: rate-limit buckets live in Redis across test files, so counters would collide. */
export const freshIp = () => `10.${[...randomBytes(3)].join('.')}`;

export class Client {
  token?: string;
  csrf?: string;
  refreshToken?: string;
  readonly cookies = new Map<string, string>();
  ip = freshIp();
  contract = true;

  constructor(readonly base: string) {}

  async req<T = any>(
    method: string,
    path: string,
    opts: { body?: unknown; headers?: Record<string, string>; auth?: boolean; raw?: string } = {},
  ): Promise<Res<T>> {
    const headers: Record<string, string> = { 'x-forwarded-for': this.ip, ...opts.headers };
    if (opts.body !== undefined || opts.raw !== undefined) headers['content-type'] ??= 'application/json';
    if (opts.auth !== false && this.token) headers.authorization = `Bearer ${this.token}`;
    if (this.cookies.size) headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const url = `${this.base}/v1${path}`;
    const r = await fetch(url, {
      method,
      headers,
      ...(opts.raw !== undefined ? { body: opts.raw } : opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
    for (const c of r.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const [k, ...v] = pair!.split('=');
      const value = v.join('=');
      if (!value || /max-age=0|expires=thu, 01 jan 1970/i.test(c)) this.cookies.delete(k!);
      else this.cookies.set(k!, value);
    }
    const text = await r.text();
    const ct = r.headers.get('content-type');
    const body = text && ct?.includes('json') ? JSON.parse(text) : text || undefined;
    if (this.contract) checkContract(method, url, r.status, ct, body);
    return { status: r.status, headers: r.headers, body };
  }

  get = <T = any>(p: string, o?: Parameters<Client['req']>[2]) => this.req<T>('GET', p, o);
  post = <T = any>(p: string, body?: unknown, o?: Parameters<Client['req']>[2]) => this.req<T>('POST', p, { ...o, body });
  put = <T = any>(p: string, body?: unknown, o?: Parameters<Client['req']>[2]) => this.req<T>('PUT', p, { ...o, body });
  patch = <T = any>(p: string, body?: unknown, o?: Parameters<Client['req']>[2]) => this.req<T>('PATCH', p, { ...o, body });
  del = <T = any>(p: string, body?: unknown, o?: Parameters<Client['req']>[2]) => this.req<T>('DELETE', p, { ...o, body });

  /** Keeps the tokens of a successful sign-in. */
  adopt(r: Res): Res {
    if (r.body?.accessToken) this.token = r.body.accessToken;
    if (r.body?.csrfToken) this.csrf = r.body.csrfToken;
    if (r.body?.refreshToken) this.refreshToken = r.body.refreshToken;
    return r;
  }
}

export const PASSWORD = 'correct horse battery staple';
export const uniqueEmail = (tag = 'u') => `${tag}-${randomBytes(5).toString('hex')}@example.test`;

export async function signUp(base: string, opts: { verified?: boolean; email?: string } = {}) {
  const c = new Client(base);
  const email = opts.email ?? uniqueEmail();
  const r = c.adopt(await c.post('/auth/register', { email, password: PASSWORD }));
  if (r.status !== 201) throw new Error(`register failed ${r.status} ${JSON.stringify(r.body)}`);
  if (opts.verified !== false) {
    const token = await mailToken(email, 'Confirm your email');
    const v = await c.post('/auth/email/verify', { token });
    if (v.status !== 204) throw new Error(`verify failed ${v.status}`);
  }
  return { c, email, userId: r.body.user.id as string };
}

/** Waits for an email to `to` whose subject contains `subject`, returns the token in its link. */
export async function mailToken(to: string, subject: string, after = 0): Promise<string> {
  const text = await mailText(to, subject, after);
  const m = /token=([A-Za-z0-9_-]+)/.exec(text);
  if (!m?.[1]) throw new Error(`no token in mail: ${text}`);
  return m[1];
}

export async function mailText(to: string, subject: string, after = 0): Promise<string> {
  for (let i = 0; i < 60; i++) {
    const r = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}" subject:"${subject}"`)}`);
    const d = (await r.json()) as { messages: { ID: string; Created: string }[] };
    const msg = d.messages.find((m) => Date.parse(m.Created) >= after);
    if (msg) {
      const full = (await (await fetch(`${MAILPIT}/api/v1/message/${msg.ID}`)).json()) as { Text: string };
      return full.Text;
    }
    await new Promise((res) => setTimeout(res, 250));
  }
  throw new Error(`no "${subject}" mail for ${to}`);
}

export async function mailCount(to: string, subject: string): Promise<number> {
  const r = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}" subject:"${subject}"`)}`);
  return ((await r.json()) as { messages_count: number }).messages_count;
}

export async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 30_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (ok(v)) return v;
    if (Date.now() > end) throw new Error(`timed out waiting: ${JSON.stringify(v).slice(0, 300)}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

const TEE = createDevTee();
export function teeDoc(mut?: (d: ProjectDoc) => void): ProjectDoc {
  const d = createDoc(TEE.id, TEE.version);
  mut?.(d);
  return d;
}
export const sha = (d: unknown) => docSha256(d);

/** A real PNG (RGB, solid colour) built without image libraries. */
export function png(w: number, h: number, rgb: [number, number, number] = [200, 40, 40]): Uint8Array {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => rgb).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

/** Full browser-style upload: ticket → presigned PUTs straight to storage → complete. */
export async function upload(c: Client, bytes: Uint8Array, mime: string, kind: 'artwork' | 'thumbnail' = 'artwork') {
  const t = await c.post('/assets/uploads', { sha256: sha256(bytes), bytes: bytes.length, mime, kind });
  if (t.status === 200) return { ticket: t, asset: t.body.asset };
  if (t.status !== 201) return { ticket: t, asset: null };
  const parts: { partNumber: number; etag: string }[] = [];
  for (const p of t.body.parts as { partNumber: number; url: string }[]) {
    const slice = bytes.subarray((p.partNumber - 1) * t.body.partSize, p.partNumber * t.body.partSize);
    const put = await fetch(p.url, { method: 'PUT', body: slice });
    if (!put.ok) throw new Error(`part PUT ${put.status} ${await put.text()}`);
    parts.push({ partNumber: p.partNumber, etag: put.headers.get('etag')! });
  }
  const done = await c.post(`/assets/${t.body.asset.id}/complete`, { parts });
  return { ticket: t, complete: done, asset: done.body };
}

export async function scanned(c: Client, id: string) {
  return (await waitFor(() => c.get(`/assets/${id}`), (r) => r.body.scanStatus !== 'pending')).body;
}
