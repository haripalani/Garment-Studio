// Test configuration: the developer's .env with an isolated database, Redis db, buckets and
// proxy trust (so each test can present its own client IP to the rate limiter).
import { loadConfig, type Config } from '../src/config';

export function testEnv(): Record<string, string | undefined> {
  process.loadEnvFile(new URL('../.env', import.meta.url));
  const base = new URL(process.env.DATABASE_URL!);
  base.pathname = '/gs_test';
  const redis = new URL(process.env.REDIS_URL!);
  redis.pathname = '/1';
  return {
    ...process.env,
    NODE_ENV: 'test',
    PORT: '0',
    DATABASE_URL: base.toString(),
    REDIS_URL: redis.toString(),
    S3_BUCKET: 'gs-test',
    S3_PUBLIC_BUCKET: 'gs-test-public',
    PUBLIC_ASSET_BASE: `${process.env.S3_ENDPOINT}/gs-test-public`,
    TRUST_PROXY: 'true',
    DEFAULT_PLAN: 'dev',
    PASSWORD_BREACH_CHECK: 'false',
    RUN_WORKERS: 'true',
    ANTIVIRUS: 'clamav',
  };
}

export const testConfig = (): Config => loadConfig(testEnv());

export const MAILPIT = 'http://127.0.0.1:58025';
