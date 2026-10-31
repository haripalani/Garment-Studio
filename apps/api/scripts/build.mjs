// Production bundles: the API (dist/main.js) and the render worker (dist/render-worker.js), each one ESM
// file with workspace packages (@gs/*) inlined and npm dependencies left external (installed in the
// image). Decorators come from tsconfig (experimentalDecorators).
import { build } from 'esbuild';

await build({
  entryPoints: { main: 'src/main.ts', 'render-worker': 'src/render-worker.ts', seed: 'scripts/seed.ts' },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  packages: 'external',
  alias: { '@gs/core': '../../packages/core/src/index.ts' },
  tsconfig: 'tsconfig.json',
  logLevel: 'info',
});
