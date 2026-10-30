import 'reflect-metadata';
import { Module, type DynamicModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { CONFIG, type Config } from './config';
import { AssetsController } from './assets/assets.controller';
import { AssetsService } from './assets/assets.service';
import { Audit } from './audit/audit';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { TokenService } from './auth/tokens';
import { AccountPlanController, GarmentsController, HealthController } from './catalogue/catalogue.controller';
import { AuthGuard, RateLimitGuard } from './common/guards';
import { Idempotency } from './common/idempotency';
import { ProblemFilter } from './common/problem';
import { Entitlements } from './entitlements/entitlements';
import { Mailer } from './infra/mail';
import { Db } from './infra/prisma';
import { RedisService } from './infra/redis';
import { Storage } from './infra/storage';
import { Jobs } from './jobs/jobs';
import { MeController } from './me/me.controller';
import { ProjectsController } from './projects/projects.controller';
import { ProjectsService } from './projects/projects.service';

/** Body limit: a 2 MB document plus JSON overhead. Files never pass through the API (presigned uploads). */
const BODY_LIMIT = 3 * 1024 * 1024;

@Module({})
class AppModule {
  static with(config: Config): DynamicModule {
    return {
      module: AppModule,
      controllers: [
        AuthController,
        MeController,
        ProjectsController,
        AssetsController,
        GarmentsController,
        AccountPlanController,
        HealthController,
      ],
      providers: [
        { provide: CONFIG, useValue: config },
        Db,
        RedisService,
        Storage,
        Mailer,
        Audit,
        TokenService,
        AuthService,
        Entitlements,
        Idempotency,
        AssetsService,
        ProjectsService,
        Jobs,
        // Guards run in this order: who is calling, then how often.
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: RateLimitGuard },
        { provide: APP_FILTER, useClass: ProblemFilter },
      ],
    };
  }
}

export async function createApp(config: Config, opts: { logger?: boolean } = {}): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    bodyLimit: BODY_LIMIT,
    trustProxy: config.TRUST_PROXY,
    genReqId: () => crypto.randomUUID(),
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule.with(config), adapter, {
    logger: opts.logger === false ? false : ['error', 'warn', 'log'],
  });
  await app.register(cookie);
  await app.register(helmet, { contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } } });
  await app.register(cors, {
    origin: config.CORS_ORIGINS,
    credentials: true,
    allowedHeaders: ['authorization', 'content-type', 'idempotency-key', 'x-csrf-token', 'if-none-match'],
    exposedHeaders: ['etag', 'ratelimit-limit', 'ratelimit-remaining', 'ratelimit-reset', 'retry-after'],
    maxAge: 600,
  });
  app.setGlobalPrefix('v1');
  app.enableShutdownHooks();
  await app.get(Storage).ensureBucket();
  return app;
}
