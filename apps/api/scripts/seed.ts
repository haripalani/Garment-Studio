// Seeds plans and the development garment, idempotently. Usage: pnpm --filter @gs/api db:seed
//   SEED_ADMIN_EMAIL=you@example.com  also promotes that (existing) account to admin.
import { PrismaClient, type Prisma } from '@prisma/client';
import { createDevTee, type GarmentModel } from '@gs/core';
import { loadConfig } from '../src/config';
import { Storage } from '../src/infra/storage';
import type { Limits } from '../src/entitlements/entitlements';

/** Plan numbers are a business decision (ADR-0012); "free" exists so limits can be exercised. */
export const PLANS: { id: string; name: string; limits: Limits }[] = [
  {
    id: 'dev',
    name: 'Development (no limits)',
    limits: {
      projects: null,
      images: null,
      storageBytes: null,
      exportsPerMonth: null,
      cloudRendersPerMonth: null,
      renderMaxPx: null,
      renderQualities: null,
      localRender: true,
      watermark: false,
      garmentTiers: null,
    },
  },
  {
    id: 'free',
    name: 'Free (test limits)',
    limits: {
      projects: 3,
      images: 20,
      storageBytes: 200 * 1024 * 1024,
      exportsPerMonth: 10,
      cloudRendersPerMonth: 0,
      renderMaxPx: 1080,
      renderQualities: ['draft'],
      localRender: true,
      watermark: true,
      garmentTiers: ['free'],
    },
  },
];

/** A pattern-outline thumbnail drawn from the garment's own pieces (no third-party artwork). */
export function garmentThumbSvg(g: GarmentModel): string {
  const side = 'outside';
  const shapes = g.pieces
    .filter((p) => p.layoutMm[side])
    .map((p) => {
      const [ox, oy] = p.layoutMm[side]!;
      const d = p.outlineMm.map(([x, y], i) => `${i ? 'L' : 'M'}${(x + ox).toFixed(1)} ${(y + oy).toFixed(1)}`).join('');
      return `<path d="${d}Z"/>`;
    });
  const xs = g.pieces.flatMap((p) => (p.layoutMm[side] ? p.outlineMm.map(([x]) => x + p.layoutMm[side]![0]) : []));
  const ys = g.pieces.flatMap((p) => (p.layoutMm[side] ? p.outlineMm.map(([, y]) => y + p.layoutMm[side]![1]) : []));
  const [x0, y0, x1, y1] = [Math.min(...xs) - 20, Math.min(...ys) - 20, Math.max(...xs) + 20, Math.max(...ys) + 20];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${y0} ${x1 - x0} ${y1 - y0}" width="320" height="${Math.round((320 * (y1 - y0)) / (x1 - x0))}"><rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="#1b1d22"/><g fill="#2c3040" stroke="#8f9bf2" stroke-width="4">${shapes.join('')}</g></svg>`;
}

export async function seed(db: PrismaClient, storage: Storage, opts: { publishDev: boolean }) {
  for (const p of PLANS) {
    await db.plan.upsert({
      where: { id: p.id },
      create: { id: p.id, name: p.name, limits: p.limits as unknown as Prisma.InputJsonValue },
      update: { name: p.name, limits: p.limits as unknown as Prisma.InputJsonValue },
    });
  }
  const tee = createDevTee();
  const thumbKey = `g/${tee.id}/${tee.version}/thumb.svg`;
  await storage.ensureBucket();
  await storage.putPublic(thumbKey, garmentThumbSvg(tee), 'image/svg+xml');
  const { id, version, category, ...rest } = tee;
  const manifest = { ...rest, meshUrl: null, thumbKey } as unknown as Prisma.InputJsonValue;
  await db.garmentModel.upsert({
    where: { id_version: { id, version } },
    create: { id, version, category, tier: 'free', manifest, publishedAt: opts.publishDev ? new Date() : null },
    update: { manifest, tier: 'free' },
  });
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('seed.ts')) {
  const config = loadConfig();
  const db = new PrismaClient({ datasourceUrl: config.DATABASE_URL });
  await seed(db, new Storage(config), { publishDev: config.NODE_ENV !== 'production' });
  const admin = process.env.SEED_ADMIN_EMAIL;
  if (admin) {
    const r = await db.user.updateMany({ where: { email: admin.toLowerCase() }, data: { role: 'admin' } });
    console.log(r.count ? `${admin} is now an admin` : `No account for ${admin} (sign up first)`);
  }
  console.log(`Seeded ${PLANS.length} plans and garment dev-tee.`);
  await db.$disconnect();
}
