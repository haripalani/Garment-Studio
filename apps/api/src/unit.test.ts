import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { inspect, sniff, svgProblems, svgSize } from './assets/inspect';
import { partSizeFor } from './assets/assets.service';
import { assertPasswordAllowed, breachCount } from './auth/passwords';
import { loadConfig } from './config';
import { png } from '../test/helpers';

const enc = (t: string) => new TextEncoder().encode(t);

describe('content inspection', () => {
  it('sniffs types by magic bytes, not by name or declared type', () => {
    expect(sniff(png(2, 2))).toBe('image/png');
    expect(sniff(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('image/jpeg');
    expect(sniff(enc('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(sniff(enc('\0\0\0\x1cftypavif\0\0'))).toBe('image/avif');
    expect(sniff(enc('%PDF-1.7\n'))).toBe('application/pdf');
    expect(sniff(enc('%!PS-Adobe-3.0\n%%AI8\n%PDF-1.5'))).toBe('application/pdf'); // Illustrator preamble
    expect(sniff(enc('﻿<?xml version="1.0"?>\n<!-- made by hand -->\n<!DOCTYPE svg>\n<svg viewBox="0 0 1 1"/>'))).toBe('image/svg+xml');
    expect(sniff(enc('<html><svg/></html>'))).toBeNull();
    expect(sniff(enc('GIF89a'))).toBeNull();
  });

  it('flags unsafe SVG features', () => {
    expect(svgProblems('<svg><rect/></svg>')).toEqual([]);
    expect(svgProblems('<svg><script>x</script></svg>')).toContain('contains a script');
    expect(svgProblems('<svg onload="x()"/>')).toContain('has event-handler attributes');
    expect(svgProblems('<svg><foreignObject/></svg>')).toContain('contains foreignObject');
    expect(svgProblems('<svg><script/></svg>')).toContain('contains a script');
    expect(svgProblems('<svg><iframe/></svg>')).toContain('embeds other documents or media');
    expect(svgProblems('<svg><a href="javascript:alert(1)"/></svg>')).toContain('has script links');
    expect(svgProblems('<svg><image href="https://tracker.example/p.png"/></svg>')).toContain('references external files');
    expect(svgProblems('<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><svg/>')).toContain('declares XML entities');
    expect(svgProblems('<svg><style>@import url(//x.example/a.css)</style></svg>')).toContain('loads external styles');
    expect(svgProblems('<svg><image href="data:image/png;base64,AAAA"/></svg>')).toEqual([]);
  });

  it('reads SVG size from attributes or the viewBox', () => {
    expect(svgSize('<svg width="120px" height="80" viewBox="0 0 10 10">')).toEqual({ width: 120, height: 80 });
    expect(svgSize('<svg viewBox="0 0 300.4 150">')).toEqual({ width: 300, height: 150 });
    expect(svgSize('<svg width="100%">')).toEqual({ width: null, height: null });
  });

  it('enforces declared type and the raster size limit', () => {
    expect(inspect(png(30, 20), 'image/png')).toEqual({ ok: true, width: 30, height: 20, isVector: false });
    expect(inspect(png(30, 20), 'image/jpeg')).toMatchObject({ ok: false, reason: 'content is image/png, not image/jpeg' });
    const huge = png(1, 1);
    const dv = new DataView(huge.buffer, huge.byteOffset);
    dv.setUint32(16, 13_000); // IHDR width
    expect(inspect(huge, 'image/png')).toMatchObject({ ok: false, reason: expect.stringContaining('12000') });
  });

  it('part size: 5 MiB minimum, grows so no upload needs more than 10 000 parts', () => {
    expect(partSizeFor(100)).toBe(5 * 1024 * 1024);
    expect(partSizeFor(50 * 1024 * 1024)).toBe(5 * 1024 * 1024);
    expect(Math.ceil(100e9 / partSizeFor(100e9))).toBeLessThanOrEqual(10_000);
  });
});

describe('breached passwords (k-anonymity)', () => {
  const sha1 = (s: string) => createHash('sha1').update(s).digest('hex').toUpperCase();
  const fake = (body: string, seen: string[] = []) =>
    (async (url: string | URL) => {
      seen.push(String(url));
      return new Response(body);
    }) as typeof fetch;

  it('sends only the 5-character hash prefix and matches the suffix', async () => {
    const h = sha1('password123');
    const seen: string[] = [];
    const n = await breachCount('password123', fake(`0000000000000000000000000000000000A:1\n${h.slice(5)}:2413\n`, seen));
    expect(n).toBe(2413);
    expect(seen).toEqual([`https://api.pwnedpasswords.com/range/${h.slice(0, 5)}`]);
  });

  it('blocks breached passwords with a 422 and fails open when the service is down', async () => {
    const h = sha1('hunter2hunter2');
    await expect(assertPasswordAllowed('hunter2hunter2', true, fake(`${h.slice(5)}:9`))).rejects.toMatchObject({ status: 422 });
    await expect(assertPasswordAllowed('hunter2hunter2', true, (async () => new Response('', { status: 503 })) as typeof fetch)).resolves.toBeUndefined();
    await expect(assertPasswordAllowed('hunter2hunter2', false, fake(`${h.slice(5)}:9`))).resolves.toBeUndefined();
  });
});

describe('configuration', () => {
  const base = {
    NODE_ENV: 'development',
    PORT: '4000',
    DATABASE_URL: 'postgresql://u:p@h/db',
    REDIS_URL: 'redis://h:1/0',
    CORS_ORIGINS: 'http://a.example, http://b.example',
    APP_URL: 'http://a.example',
    JWT_PRIVATE_JWK: JSON.stringify({ kty: 'OKP', crv: 'Ed25519', d: 'x', x: 'y', kid: 'k1' }),
    IP_HASH_SECRET: 'z'.repeat(32),
    COOKIE_SECURE: 'true',
    S3_ENDPOINT: 'http://s3.example',
    S3_REGION: 'auto',
    S3_BUCKET: 'bkt',
    S3_PUBLIC_BUCKET: 'pub',
    S3_ACCESS_KEY: 'a',
    S3_SECRET_KEY: 'b',
    S3_FORCE_PATH_STYLE: 'true',
    PUBLIC_ASSET_BASE: 'https://cdn.example',
    SMTP_URL: 'smtp://mail:25',
    MAIL_FROM: 'GS <a@b.c>',
    ANTIVIRUS: 'off',
    PASSWORD_BREACH_CHECK: 'false',
    DEFAULT_PLAN: 'dev',
    RUN_WORKERS: 'false',
    TRUST_PROXY: 'false',
  };

  it('parses a valid environment', () => {
    const c = loadConfig(base);
    expect(c.CORS_ORIGINS).toEqual(['http://a.example', 'http://b.example']);
    expect(c.COOKIE_SECURE).toBe(true);
  });

  it('fails fast, naming every bad variable', () => {
    expect(() => loadConfig({ ...base, DATABASE_URL: undefined, JWT_PRIVATE_JWK: '{"kty":"RSA"}' })).toThrow(
      /DATABASE_URL[\s\S]*JWT_PRIVATE_JWK: expected an Ed25519 private JWK/,
    );
  });

  it('refuses unsafe production settings', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production' })).toThrow(/ANTIVIRUS: antivirus scanning is required in production/);
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', ANTIVIRUS: 'clamav', CLAMAV_HOST: 'h', CLAMAV_PORT: '1', COOKIE_SECURE: 'false' })).toThrow(/COOKIE_SECURE/);
  });
});
