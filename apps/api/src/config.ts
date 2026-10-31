// Environment configuration, validated once at startup. A missing or malformed value stops the
// process with a message naming the variable (no silent defaults for secrets or endpoints).
import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
const list = z.string().transform((v) =>
  v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']),
    PORT: z.coerce.number().int().min(0).max(65535),
    DATABASE_URL: z.string().startsWith('postgresql://'),
    REDIS_URL: z.string().startsWith('redis://'),
    CORS_ORIGINS: list,
    APP_URL: z.url(),
    JWT_PRIVATE_JWK: z.string().transform((v, ctx) => {
      try {
        const jwk = JSON.parse(v) as Record<string, unknown>;
        if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || typeof jwk.d !== 'string' || typeof jwk.kid !== 'string') {
          throw new Error('expected an Ed25519 private JWK with a kid');
        }
        return jwk as { kty: 'OKP'; crv: 'Ed25519'; d: string; x: string; kid: string };
      } catch (e) {
        ctx.addIssue({ code: 'custom', message: (e as Error).message });
        return z.NEVER;
      }
    }),
    IP_HASH_SECRET: z.string().min(32),
    COOKIE_SECURE: bool,
    /** Parent domain for the readable CSRF cookie when the editor and API are on sibling subdomains
     * (e.g. ".garmentstudio.example"); unset = host-only (local development). */
    COOKIE_DOMAIN: z
      .string()
      .optional()
      .transform((v) => v || undefined),
    S3_ENDPOINT: z.url(),
    /** Address browsers use for presigned uploads/downloads when it differs from S3_ENDPOINT
     * (e.g. storage behind a reverse proxy or a custom domain). Defaults to S3_ENDPOINT. */
    S3_PUBLIC_ENDPOINT: z.url().optional(),
    S3_REGION: z.string().min(1),
    S3_BUCKET: z.string().min(3),
    S3_PUBLIC_BUCKET: z.string().min(3),
    S3_ACCESS_KEY: z.string().min(1),
    S3_SECRET_KEY: z.string().min(1),
    S3_FORCE_PATH_STYLE: bool,
    PUBLIC_ASSET_BASE: z.url(),
    SMTP_URL: z.string().regex(/^smtps?:\/\//),
    MAIL_FROM: z.string().min(3),
    ANTIVIRUS: z.enum(['clamav', 'off']),
    CLAMAV_HOST: z.string().optional(),
    CLAMAV_PORT: z.coerce.number().int().optional(),
    PASSWORD_BREACH_CHECK: bool,
    DEFAULT_PLAN: z.string().min(1),
    RUN_WORKERS: bool,
    TRUST_PROXY: bool,
    /** Sign-in attempts per minute per IP (ADR-0010: 10). Raised only for local development and tests. */
    RATE_AUTH_PER_MIN: z.coerce.number().int().min(1).max(10_000).default(10),
    /** Render worker only: the built editor (apps/editor/dist) that holds render.html. */
    RENDER_PAGE_DIR: z.string().optional(),
    /** Extra Chromium flags for the render worker's GPU (e.g. "--use-angle=vulkan" on Linux GPU nodes). */
    RENDER_CHROMIUM_ARGS: list.optional(),
    /** Render worker: Chromium profile folder (keeps the compiled-shader cache across restarts). */
    RENDER_PROFILE_DIR: z.string().optional(),
    /** Test environments only: fixed sample count instead of the quality's. */
    RENDER_SAMPLES_OVERRIDE: z.coerce.number().int().min(1).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.ANTIVIRUS === 'off') {
      ctx.addIssue({ code: 'custom', path: ['ANTIVIRUS'], message: 'antivirus scanning is required in production' });
    }
    if (env.NODE_ENV === 'production' && !env.COOKIE_SECURE) {
      ctx.addIssue({ code: 'custom', path: ['COOKIE_SECURE'], message: 'must be true in production' });
    }
    if (env.NODE_ENV === 'production' && env.RENDER_SAMPLES_OVERRIDE !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['RENDER_SAMPLES_OVERRIDE'], message: 'not allowed in production' });
    }
    if (env.ANTIVIRUS === 'clamav' && (!env.CLAMAV_HOST || !env.CLAMAV_PORT)) {
      ctx.addIssue({ code: 'custom', path: ['CLAMAV_HOST'], message: 'CLAMAV_HOST and CLAMAV_PORT are required' });
    }
  });

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.') || '(env)'}: ${i.message}`);
    throw new Error(`Invalid API configuration:\n${lines.join('\n')}`);
  }
  return parsed.data;
}

export const CONFIG = Symbol('CONFIG');
