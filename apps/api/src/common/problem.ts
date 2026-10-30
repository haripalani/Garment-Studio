// RFC 9457 problem details with a stable machine `code` (ADR-0010).
import { Catch, HttpException, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

export class Problem extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly title: string,
    readonly extra: Record<string, unknown> = {},
    readonly headers: Record<string, string> = {},
  ) {
    super(title);
  }
}

export const problems = {
  badRequest: (code: string, title: string, extra?: Record<string, unknown>) => new Problem(400, code, title, extra),
  unauthorized: (code = 'unauthorized', title = 'Sign in required') => new Problem(401, code, title),
  forbidden: (code: string, title: string) => new Problem(403, code, title),
  notFound: (what = 'Resource') => new Problem(404, 'not_found', `${what} not found`),
  conflict: (code: string, title: string, extra?: Record<string, unknown>) => new Problem(409, code, title, extra),
  validation: (errors: { path: string; message: string }[], title = 'The request body is invalid') =>
    new Problem(422, 'validation_failed', title, { errors }),
};

const TITLES: Record<number, string> = {
  400: 'Bad request',
  401: 'Sign in required',
  403: 'Forbidden',
  404: 'Not found',
  405: 'Method not allowed',
  413: 'Payload too large',
  415: 'Unsupported media type',
  429: 'Too many requests',
};

@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly log = new Logger('Problem');

  catch(error: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const req = ctx.getRequest<FastifyRequest>();
    let p: Problem;
    if (error instanceof Problem) {
      p = error;
    } else if (error instanceof HttpException) {
      const status = error.getStatus();
      p = new Problem(status, status === 404 ? 'not_found' : `http_${status}`, TITLES[status] ?? error.message);
    } else if (isFastifyError(error)) {
      // Body parser / content-type errors raised by Fastify before the route runs
      const status = error.statusCode;
      const code = status === 413 ? 'payload_too_large' : status === 415 ? 'unsupported_media_type' : 'bad_request';
      p = new Problem(status, code, TITLES[status] ?? 'Bad request');
    } else {
      this.log.error(error instanceof Error ? (error.stack ?? error.message) : String(error), `req ${req.id}`);
      p = new Problem(500, 'internal', 'Something went wrong on our side');
    }
    for (const [k, v] of Object.entries(p.headers)) void reply.header(k, v);
    void reply
      .status(p.status)
      .type('application/problem+json')
      .send({
        type: `https://docs.garmentstudio.example/problems/${p.code}`,
        title: p.title,
        status: p.status,
        code: p.code,
        requestId: String(req.id),
        ...p.extra,
      });
  }
}

function isFastifyError(e: unknown): e is { statusCode: number; code: string } {
  return (
    typeof e === 'object' &&
    e !== null &&
    typeof (e as { statusCode?: unknown }).statusCode === 'number' &&
    typeof (e as { code?: unknown }).code === 'string' &&
    String((e as { code: string }).code).startsWith('FST_')
  );
}
