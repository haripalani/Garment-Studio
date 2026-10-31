import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    // Integration files share one database and job queues; run them one after another.
    fileParallelism: false,
    testTimeout: 60_000,
    // Render tests start a GPU worker whose first shader compile can take a minute on Windows (ANGLE/D3D11).
    hookTimeout: 240_000,
  },
});
