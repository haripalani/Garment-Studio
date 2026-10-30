// Route metadata (public routes, rate classes) and the request principal.
import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { ClientPlatform, Role } from '@prisma/client';
import { problems } from './problem';

export interface Principal {
  id: string;
  /** Refresh-token family of the session that issued the access token. */
  sid: string;
  role: Role;
  platform: ClientPlatform;
}

export type AppRequest = FastifyRequest & { principal?: Principal };

export const PUBLIC = 'gs:public';
/** No access token required. */
export const Public = () => SetMetadata(PUBLIC, true);

/** Rate classes from ADR-0010; requests per minute. */
export const RATE_LIMITS = { auth: 10, write: 120, read: 600 } as const;
export type RateClass = keyof typeof RATE_LIMITS;
export const RATE = 'gs:rate';
export const Rate = (c: RateClass) => SetMetadata(RATE, c);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): Principal => {
  const req = ctx.switchToHttp().getRequest<AppRequest>();
  if (!req.principal) throw problems.unauthorized();
  return req.principal;
});

export const Req_ = createParamDecorator((_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<AppRequest>());
