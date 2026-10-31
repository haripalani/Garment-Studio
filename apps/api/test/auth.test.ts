import { createHash, randomBytes } from 'node:crypto';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Db } from '../src/infra/prisma';
import { Client, PASSWORD, freshIp, mailCount, mailText, mailToken, signUp, start, uniqueEmail, type Running } from './helpers';

let s: Running;
beforeAll(async () => {
  s = await start();
});
afterAll(() => s.close());

const cookieAttrs = (setCookies: string[], name: string) => setCookies.find((c) => c.startsWith(`${name}=`)) ?? '';

describe('registration and sign-in', () => {
  it('registers, sets a secure refresh cookie and a CSRF token, and emails a verification link', async () => {
    const c = new Client(s.base);
    const email = uniqueEmail('Reg').replace('reg', 'Reg');
    const r = await c.post('/auth/register', { email, password: PASSWORD, displayName: 'Ada' });
    expect(r.status).toBe(201);
    expect(r.body.user).toMatchObject({ email: email.toLowerCase(), emailVerified: false, hasPassword: true, displayName: 'Ada' });
    expect(r.body.expiresIn).toBe(600);
    const rt = cookieAttrs(r.headers.getSetCookie(), 'gs_rt');
    expect(rt).toMatch(/HttpOnly/i);
    expect(rt).toMatch(/Secure/i);
    expect(rt).toMatch(/SameSite=Lax/i);
    expect(rt).toMatch(/Path=\/v1\/auth/);
    expect(cookieAttrs(r.headers.getSetCookie(), 'gs_csrf')).not.toMatch(/HttpOnly/i);
    expect(await mailText(email.toLowerCase(), 'Confirm your email')).toMatch(/\/auth\/verify\?token=/);
  });

  it('rejects a duplicate email (case-insensitive), short passwords and malformed emails', async () => {
    const { email } = await signUp(s.base, { verified: false });
    const c = new Client(s.base);
    expect((await c.post('/auth/register', { email: email.toUpperCase(), password: PASSWORD })).body.code).toBe('email_taken');
    const weak = await c.post('/auth/register', { email: uniqueEmail(), password: 'short' });
    expect(weak.status).toBe(422);
    expect(weak.body.errors[0]).toMatchObject({ path: 'password' });
    expect((await c.post('/auth/register', { email: 'nope', password: PASSWORD })).status).toBe(422);
  });

  it('signs in with the right password and refuses the wrong one without revealing which part was wrong', async () => {
    const { email } = await signUp(s.base, { verified: false });
    const c = new Client(s.base);
    expect((await c.post('/auth/login', { email, password: PASSWORD })).status).toBe(200);
    const bad = await c.post('/auth/login', { email, password: 'wrong password!!' });
    const unknown = await c.post('/auth/login', { email: uniqueEmail(), password: PASSWORD });
    expect(bad.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(bad.body.code).toBe(unknown.body.code);
    expect(bad.body.title).toBe(unknown.body.title);
  });

  it('locks the account for 15 minutes after 5 failures, even for the right password', async () => {
    const { email } = await signUp(s.base, { verified: false });
    const c = new Client(s.base);
    for (let i = 0; i < 5; i++) expect((await c.post('/auth/login', { email, password: 'wrong password!!' })).status).toBe(401);
    c.ip = freshIp(); // a different IP doesn't help
    const locked = await c.post('/auth/login', { email, password: PASSWORD });
    expect(locked.status).toBe(423);
    expect(locked.body.code).toBe('account_locked');
    expect(Number(locked.headers.get('retry-after'))).toBeGreaterThan(800);
  });

  it('rate-limits the auth class per IP (10/min) with RateLimit headers and Retry-After', async () => {
    const c = new Client(s.base);
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await c.post('/auth/password/forgot', { email: uniqueEmail() })).status);
    expect(statuses.slice(0, 10).every((x) => x === 202)).toBe(true);
    const last = await c.post('/auth/password/forgot', { email: uniqueEmail() });
    expect(last.status).toBe(429);
    expect(last.body.code).toBe('rate_limited');
    expect(last.headers.get('ratelimit-limit')).toBe('10');
    expect(Number(last.headers.get('retry-after'))).toBeGreaterThan(0);
    c.ip = freshIp();
    expect((await c.post('/auth/password/forgot', { email: uniqueEmail() })).status).toBe(202);
  });
});

describe('sessions and refresh tokens', () => {
  it('refreshes from the cookie only with the CSRF header and an allowed Origin, rotating the token', async () => {
    const { c } = await signUp(s.base, { verified: false });
    const first = c.cookies.get('gs_rt');
    expect((await c.post('/auth/refresh')).body.code).toBe('csrf_failed');
    expect(
      (await c.post('/auth/refresh', undefined, { headers: { 'x-csrf-token': c.csrf!, origin: 'https://evil.example' } })).body.code,
    ).toBe('origin_not_allowed');
    const ok = c.adopt(await c.post('/auth/refresh', undefined, { headers: { 'x-csrf-token': c.csrf!, origin: 'http://localhost:5173' } }));
    expect(ok.status).toBe(200);
    expect(c.cookies.get('gs_rt')).not.toBe(first);
    expect((await c.get('/me')).status).toBe(200);
  });

  it('detects refresh-token reuse and revokes the whole family, including live access tokens', async () => {
    const { c } = await signUp(s.base, { verified: false });
    const stolen = c.cookies.get('gs_rt')!;
    c.adopt(await c.post('/auth/refresh', undefined, { headers: { 'x-csrf-token': c.csrf! } }));
    expect((await c.get('/me')).status).toBe(200);
    // An attacker replays the old token
    const attacker = new Client(s.base);
    attacker.cookies.set('gs_rt', stolen);
    attacker.cookies.set('gs_csrf', 'x'.repeat(43));
    const replay = await attacker.post('/auth/refresh', undefined, { headers: { 'x-csrf-token': 'x'.repeat(43) } });
    expect(replay.status).toBe(401);
    // ...which signs the legitimate session out too
    expect((await c.get('/me')).body.code).toBe('session_revoked');
    expect((await c.post('/auth/refresh', undefined, { headers: { 'x-csrf-token': c.csrf! } })).status).toBe(401);
  });

  it('session refresh is not in the strict sign-in limit (page loads in many tabs share an IP)', async () => {
    const { c } = await signUp(s.base, { verified: false });
    for (let i = 0; i < 15; i++) {
      const r = c.adopt(await c.post('/auth/refresh', undefined, { headers: { 'x-csrf-token': c.csrf! } }));
      expect(r.status).toBe(200);
    }
  });

  it('only one of two concurrent refreshes with the same token succeeds', async () => {
    const { c } = await signUp(s.base, { verified: false });
    const h = { headers: { 'x-csrf-token': c.csrf! } };
    const [a, b] = await Promise.all([c.post('/auth/refresh', undefined, h), c.post('/auth/refresh', undefined, h)]);
    expect([a.status, b.status].sort()).toEqual([200, 401]);
  });

  it('logout revokes the session immediately and clears cookies', async () => {
    const { c } = await signUp(s.base, { verified: false });
    expect((await c.post('/auth/logout')).status).toBe(204);
    expect(c.cookies.has('gs_rt')).toBe(false);
    expect((await c.get('/me')).status).toBe(401);
  });

  it('remember=false gives a browser-session cookie (no Max-Age)', async () => {
    const { email } = await signUp(s.base, { verified: false });
    const r = await new Client(s.base).post('/auth/login', { email, password: PASSWORD, remember: false });
    expect(cookieAttrs(r.headers.getSetCookie(), 'gs_rt')).not.toMatch(/Max-Age/i);
  });

  it('lists sessions across devices and signs one out', async () => {
    const { c, email } = await signUp(s.base, { verified: false });
    const other = new Client(s.base);
    other.adopt(await other.post('/auth/login', { email, password: PASSWORD }));
    const list = await c.get('/me/sessions');
    expect(list.body.items).toHaveLength(2);
    const theirs = list.body.items.find((x: { current: boolean }) => !x.current);
    expect((await c.del(`/me/sessions/${theirs.id}`)).status).toBe(204);
    expect((await other.get('/me')).status).toBe(401);
    expect((await c.get('/me/sessions')).body.items).toHaveLength(1);
    expect((await c.del(`/me/sessions/${theirs.id}`)).status).toBe(404);
  });

  it('rejects tampered and foreign access tokens', async () => {
    const { c } = await signUp(s.base, { verified: false });
    const [h, p, sig] = c.token!.split('.');
    const forged = JSON.parse(Buffer.from(p!, 'base64url').toString());
    forged.role = 'admin';
    c.token = `${h}.${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${sig}`;
    expect((await c.get('/me')).body.code).toBe('invalid_token');
    c.token = 'not-a-jwt';
    expect((await c.get('/me')).status).toBe(401);
  });

  it('publishes the signing key; access tokens verify against it', async () => {
    const { c, userId } = await signUp(s.base, { verified: false });
    const jwks = await c.get('/auth/jwks');
    const { payload } = await jwtVerify(c.token!, createLocalJWKSet(jwks.body), { audience: 'gs-api' });
    expect(payload.sub).toBe(userId);
    expect(jwks.body.keys[0].d).toBeUndefined();
  });
});

describe('email flows', () => {
  it('verifies the email once; the link is single-use', async () => {
    const { c, email } = await signUp(s.base, { verified: false });
    const token = await mailToken(email, 'Confirm your email');
    expect((await c.post('/auth/email/verify', { token })).status).toBe(204);
    expect((await c.get('/me')).body.emailVerified).toBe(true);
    expect((await c.post('/auth/email/verify', { token })).body.code).toBe('token_invalid');
  });

  it('magic link: always 202, creates a verified account on first use, single-use', async () => {
    const c = new Client(s.base);
    const email = uniqueEmail('magic');
    expect((await c.post('/auth/magic-link', { email })).status).toBe(202);
    const token = await mailToken(email, 'Your sign-in link');
    const r = c.adopt(await c.post('/auth/magic-link/verify', { token }));
    expect(r.status).toBe(200);
    expect(r.body.user).toMatchObject({ email, emailVerified: true, hasPassword: false });
    expect((await c.post('/auth/magic-link/verify', { token })).status).toBe(400);
    expect(
      (await c.post('/auth/magic-link', { email, redirectUri: 'https://phish.example/x' })).status,
    ).toBe(422);
  });

  it('password reset: no account enumeration, sets the password and revokes every session', async () => {
    const { c, email } = await signUp(s.base, { verified: false });
    const anon = new Client(s.base);
    expect((await anon.post('/auth/password/forgot', { email: uniqueEmail() })).status).toBe(202);
    expect((await anon.post('/auth/password/forgot', { email })).status).toBe(202);
    const token = await mailToken(email, 'Reset your password');
    expect((await anon.post('/auth/password/reset', { token, password: 'a brand new passphrase' })).status).toBe(204);
    expect((await c.get('/me')).status).toBe(401);
    expect((await anon.post('/auth/login', { email, password: PASSWORD })).status).toBe(401);
    expect((await anon.post('/auth/login', { email, password: 'a brand new passphrase' })).status).toBe(200);
    expect((await anon.post('/auth/password/reset', { token, password: 'another passphrase!' })).status).toBe(400);
  });

  it('limits sign-in and reset emails to 3 per address per 15 minutes', async () => {
    const email = (await signUp(s.base, { verified: false })).email;
    for (let i = 0; i < 5; i++) {
      const c = new Client(s.base);
      expect((await c.post('/auth/password/forgot', { email })).status).toBe(202);
    }
    await mailText(email, 'Reset your password');
    expect(await mailCount(email, 'Reset your password')).toBe(3);
  });

  it('resends the verification email (unverified accounts only)', async () => {
    const { c, email } = await signUp(s.base, { verified: false });
    await mailText(email, 'Confirm your email');
    expect((await c.post('/auth/email/resend')).status).toBe(202);
    await new Promise((r) => setTimeout(r, 500));
    expect(await mailCount(email, 'Confirm your email')).toBe(2);
    await c.post('/auth/email/verify', { token: await mailToken(email, 'Confirm your email') });
    expect((await c.post('/auth/email/resend')).status).toBe(202);
    await new Promise((r) => setTimeout(r, 500));
    expect(await mailCount(email, 'Confirm your email')).toBe(2);
  });

  it('expired tokens are refused', async () => {
    const { c, email } = await signUp(s.base, { verified: false });
    const db = s.app.get(Db);
    await db.verificationToken.updateMany({ where: { email }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const token = await mailToken(email, 'Confirm your email');
    expect((await c.post('/auth/email/verify', { token })).body.code).toBe('token_expired');
  });
});

describe('desktop sign-in (PKCE)', () => {
  it('exchanges a browser-minted code plus the verifier for tokens kept by the app', async () => {
    const { c, userId } = await signUp(s.base, { verified: false });
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const code = await c.post('/auth/desktop/code', { codeChallenge: challenge, redirectUri: 'garmentstudio://auth/callback' });
    expect(code.status).toBe(201);
    expect(code.body.redirectUri).toMatch(/^garmentstudio:\/\/auth\/callback\?code=/);

    const app = new Client(s.base);
    const wrong = await app.post('/auth/desktop/token', {
      code: code.body.code,
      codeVerifier: randomBytes(32).toString('base64url'),
      deviceName: 'Studio PC',
    });
    expect(wrong.body.code).toBe('pkce_mismatch');
    // The code is single-use even after a failed attempt; mint another.
    const code2 = await c.post('/auth/desktop/code', { codeChallenge: challenge, redirectUri: 'garmentstudio://auth/callback' });
    const ok = app.adopt(await app.post('/auth/desktop/token', { code: code2.body.code, codeVerifier: verifier, deviceName: 'Studio PC' }));
    expect(ok.status).toBe(200);
    expect(ok.headers.getSetCookie()).toHaveLength(0);
    expect(ok.body.user.id).toBe(userId);
    const old = app.refreshToken!;
    const rotated = await app.post('/auth/refresh', { refreshToken: old });
    expect(rotated.status).toBe(200);
    expect(rotated.body.refreshToken).not.toBe(old);
    const sessions = await c.get('/me/sessions');
    expect(sessions.body.items.find((x: { platform: string }) => x.platform === 'desktop')).toMatchObject({ deviceName: 'Studio PC' });
  });

  it('browser sign-in flows refuse the desktop platform', async () => {
    const { email } = await signUp(s.base, { verified: false });
    const r = await new Client(s.base).post('/auth/login', { email, password: PASSWORD, platform: 'desktop' });
    expect(r.body.code).toBe('use_pkce');
  });

  it('OAuth providers answer 501 until credentials are configured', async () => {
    const r = await new Client(s.base).get('/auth/oauth/google/start?redirect_uri=http://localhost:5173&state=x');
    expect(r.status).toBe(501);
    expect(r.body.code).toBe('oauth_not_configured');
  });
});

describe('account', () => {
  it('changes the display name freely, but email and password only with the current password', async () => {
    const { c, email } = await signUp(s.base);
    expect((await c.patch('/me', { displayName: 'Grace' })).body.displayName).toBe('Grace');
    expect((await c.patch('/me', { newPassword: 'new passphrase here' })).body.code).toBe('invalid_credentials');
    const other = new Client(s.base);
    other.adopt(await other.post('/auth/login', { email, password: PASSWORD }));
    expect((await c.patch('/me', { newPassword: 'new passphrase here', currentPassword: PASSWORD })).status).toBe(200);
    expect((await other.get('/me')).status).toBe(401); // other devices signed out
    expect((await c.get('/me')).status).toBe(200); // this one stays

    const next = uniqueEmail('moved');
    const r = await c.patch('/me', { email: next, currentPassword: 'new passphrase here' });
    expect(r.body.email).toBe(email); // unchanged until confirmed
    const token = await mailToken(next, 'Confirm your new email');
    expect((await c.post('/auth/email/verify', { token })).status).toBe(204);
    expect((await c.get('/me')).body).toMatchObject({ email: next, emailVerified: true });
  });

  it('refuses an email change to an address already in use', async () => {
    const a = await signUp(s.base);
    const b = await signUp(s.base);
    expect((await a.c.patch('/me', { email: b.email, currentPassword: PASSWORD })).body.code).toBe('email_taken');
  });

  it('settings round-trip and validate (look defaults use the document schema)', async () => {
    const { c } = await signUp(s.base, { verified: false });
    expect((await c.get('/me/settings')).body).toEqual({ theme: 'dark', unit: 'cm', locale: 'en', lookDefaults: null, hints: null });
    const put = await c.put('/me/settings', { theme: 'light', unit: 'in', locale: 'en', hints: { tour: true } });
    expect(put.body).toMatchObject({ theme: 'light', unit: 'in', hints: { tour: true } });
    expect((await c.put('/me/settings', { theme: 'neon', unit: 'cm', locale: 'en' })).status).toBe(422);
    expect((await c.put('/me/settings', { theme: 'dark', unit: 'cm', locale: 'en', lookDefaults: { fabric: 1 } })).status).toBe(422);
  });

  it('deletes the account: confirmation and password required, signs out everywhere, frees the email', async () => {
    const { c, email, userId } = await signUp(s.base);
    expect((await c.del('/me', { confirm: 'yes' })).status).toBe(422);
    expect((await c.del('/me', { confirm: 'DELETE', currentPassword: 'nope nope nope' })).status).toBe(401);
    expect((await c.del('/me', { confirm: 'DELETE', currentPassword: PASSWORD })).status).toBe(202);
    expect((await c.get('/me')).status).toBe(401);
    expect(await mailText(email, 'scheduled for deletion')).toMatch(/30 days/);
    expect((await new Client(s.base).post('/auth/login', { email, password: PASSWORD })).status).toBe(401);
    const again = await new Client(s.base).post('/auth/register', { email, password: PASSWORD });
    expect(again.status).toBe(201);
    expect(again.body.user.id).not.toBe(userId);
  });

  it('a magic-link-only account needs a recent sign-in for sensitive changes', async () => {
    const c = new Client(s.base);
    const email = uniqueEmail('nopw');
    await c.post('/auth/magic-link', { email });
    c.adopt(await c.post('/auth/magic-link/verify', { token: await mailToken(email, 'Your sign-in link') }));
    expect((await c.patch('/me', { newPassword: 'first password ever' })).status).toBe(200);
    expect((await c.get('/me')).body.hasPassword).toBe(true);
    const db = s.app.get(Db);
    await db.session.updateMany({ where: { user: { email } }, data: { authAt: new Date(Date.now() - 3600_000) } });
    await db.user.update({ where: { email }, data: { passwordHash: null } });
    expect((await c.patch('/me', { newPassword: 'second password ever' })).body.code).toBe('reauth_required');
  });
});
