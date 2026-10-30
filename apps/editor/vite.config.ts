import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, strictPort: true },
  build: {
    // three.js alone is ~575 kB minified (lazy-loaded with the 3D view); everything else stays far below.
    chunkSizeWarningLimit: 600,
    rolldownOptions: {
      output: {
        // Stable vendor chunks cache well across releases (PWA precache, Stage 9).
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: 'radix', test: /node_modules[\\/](@radix-ui|radix-ui)[\\/]/ },
            { name: 'router', test: /node_modules[\\/]@tanstack[\\/]/ },
            { name: 'i18n', test: /node_modules[\\/](i18next|react-i18next)[\\/]/ },
            { name: 'icons', test: /node_modules[\\/]lucide-react[\\/]/ },
            { name: 'three', test: /node_modules[\\/]three[\\/]/ },
          ],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    // Playwright owns e2e/ (run with `pnpm e2e`).
    exclude: ['e2e/**', 'node_modules/**'],
  },
});
