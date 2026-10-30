// Opaque cursors: base64url JSON of the sort key of the last item returned.
import { z } from 'zod';
import { problems } from './problem';

export const LimitSchema = z.coerce.number().int().min(1).max(100).default(30);

export function encodeCursor(key: unknown): string {
  return Buffer.from(JSON.stringify(key)).toString('base64url');
}

export function decodeCursor<S extends z.ZodType>(schema: S, cursor: string | undefined): z.infer<S> | undefined {
  if (!cursor) return undefined;
  try {
    return schema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
  } catch {
    throw problems.badRequest('invalid_cursor', 'The cursor is invalid or expired');
  }
}
