// Entry point of the render worker process (a GPU node in production, ADR-0013):
//   node --env-file=.env dist/render-worker.js
import { Logger } from '@nestjs/common';
import { loadConfig } from './config';
import { Db } from './infra/prisma';
import { RedisService } from './infra/redis';
import { Storage } from './infra/storage';
import { RenderRunner } from './renders/runner';

const config = loadConfig();
const redis = new RedisService(config);
const db = new Db(config);
const runner = new RenderRunner(config, db, new Storage(config), redis.client, () => redis.connection());
await runner.start();
new Logger('RenderWorker').log('Waiting for render jobs');

const shutdown = async () => {
  await runner.stop();
  await db.$disconnect();
  redis.onModuleDestroy();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
