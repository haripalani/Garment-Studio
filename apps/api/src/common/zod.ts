// Request validation with the shared zod schemas. Failures become 422 ValidationProblem.
import type { z } from 'zod';
import { problems } from './problem';

export function parse<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const r = schema.safeParse(value);
  if (!r.success) {
    throw problems.validation(
      r.error.issues.map((i) => ({ path: i.path.length ? i.path.join('.') : '(body)', message: i.message })),
    );
  }
  return r.data;
}
