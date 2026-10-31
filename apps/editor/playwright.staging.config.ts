// Smoke tests against a deployed stack: the local staging replica by default (infra/staging),
// or real staging with STAGING_URL / STAGING_MAILPIT set.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e-staging',
  timeout: 120_000,
  workers: 2,
  reporter: [['list']],
  use: {
    baseURL: process.env.STAGING_URL ?? 'https://gs.localhost:8443',
    // The replica uses Caddy's local CA.
    ignoreHTTPSErrors: !process.env.STAGING_URL,
    viewport: { width: 1440, height: 900 },
    locale: 'en-GB',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 900 } } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } } },
  ],
});
