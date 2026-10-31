import { defineConfig, devices } from '@playwright/test';

const PORT = 5174;
const BROWSERS = [
  ['chromium', 'Desktop Chrome'],
  ['firefox', 'Desktop Firefox'],
  ['webkit', 'Desktop Safari'],
] as const;
/** Minutes-long or multi-context specs (exports, GPU render, cloud sync with two devices). */
const HEAVY = /(exports|render|cloud)\.spec\.ts/;

export default defineConfig({
  testDir: './e2e',
  // The live 3D preview renders with software WebGL in headless browsers, which is slow under load.
  timeout: 60_000,
  expect: {
    timeout: 5_000,
    // Canvas anti-aliasing differs slightly between runs and GPUs.
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled' },
  },
  fullyParallel: true,
  // Software WebGL (headless 3D) is CPU-heavy: more than 2 workers starves Chromium's 3D tests on a laptop.
  workers: 2,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e-report' }]],
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{testFilePath}/{arg}{ext}',
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    locale: 'en-GB',
  },
  projects: [
    ...BROWSERS.map(([name, device]) => ({
      name,
      testIgnore: HEAVY,
      use: { ...devices[device], viewport: { width: 1440, height: 900 } },
    })),
    // Exports and path-traced renders take minutes of CPU/GPU each. They run after everything else, one
    // browser at a time with two workers, so they never starve other tests (or each other) on a laptop.
    ...BROWSERS.map(([name, device], i) => ({
      name: `${name}-exports`,
      testMatch: HEAVY,
      workers: 2,
      dependencies: i === 0 ? BROWSERS.map(([n]) => n) : [`${BROWSERS[i - 1]![0]}-exports`],
      use: { ...devices[device], viewport: { width: 1440, height: 900 } },
    })),
  ],
  webServer: [
    {
      command: `vite --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    // The API for the cloud tests (sign-in, sync). Needs the local services: infra/dev/compose.yaml.
    {
      command: 'npx tsx --env-file=.env src/main.ts',
      cwd: '../api',
      url: 'http://localhost:4000/v1/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
