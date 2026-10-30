// Production bundle: one ESM file with workspace packages (@gs/*) inlined and npm dependencies
// left external (installed in the image). Decorators come from tsconfig (experimentalDecorators).
import { build } from 'esbuild';

await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.js',
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
