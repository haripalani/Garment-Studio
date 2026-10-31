// Fresh test database (migrated from prisma/migrations), empty Redis db, buckets, seed data, empty inbox.
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { seed } from '../scripts/seed';
import { Storage } from '../src/infra/storage';
import { MAILPIT, testConfig } from './env';

export default async function setup() {
  const config = testConfig();
  const admin = new URL(config.DATABASE_URL);
  admin.pathname = '/gs';
  const root = new PrismaClient({ datasourceUrl: admin.toString() });
  // Check first: a Prisma error object raised inside Vite's module runner trips a source-map bug.
  const exists = await root.$queryRaw<unknown[]>`SELECT 1 FROM pg_database WHERE datname = 'gs_test'`;
  if (!exists.length) await root.$executeRawUnsafe('CREATE DATABASE gs_test');
  await root.$disconnect();

  const db = new PrismaClient({ datasourceUrl: config.DATABASE_URL });
  await db.$executeRawUnsafe('DROP SCHEMA IF EXISTS public CASCADE');
  await db.$disconnect();
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: config.DATABASE_URL },
    stdio: 'pipe',
  });

  const redis = new Redis(config.REDIS_URL);
  await redis.flushdb();
  redis.disconnect();

  const storage = new Storage(config);
  await storage.ensureBucket();
  await storage.deletePrefix('u/');
  await storage.deletePrefix('x/');
  const seeded = new PrismaClient({ datasourceUrl: config.DATABASE_URL });
  await seed(seeded, storage, { publishDev: true });
  await seeded.$disconnect();

  await fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE' });

  // The render worker serves the built editor's render page.
  execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--logLevel', 'error'], {
    cwd: new URL('../../editor/', import.meta.url),
    stdio: 'pipe',
  });
}
