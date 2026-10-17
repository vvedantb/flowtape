import { defineConfig } from 'tsup';

export default defineConfig([
  // Browser-safe entry: overlay, recorder, schemas, prompt helpers. No Node imports.
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    target: 'es2020',
    external: ['react', 'react-dom'],
    clean: false,
  },
  // Node entry: Vite plugin and `/__flowtape/*` middleware.
  {
    entry: { vite: 'src/vite.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    target: 'node18',
    external: ['vite'],
    clean: false,
  },
  // Node entry: record and replay scripts. Playwright stays external.
  {
    entry: { node: 'src/node.ts' },
    format: ['esm'],
    dts: true,
    target: 'node18',
    external: ['playwright'],
    clean: false,
  },
  // Runs inside the recorded page, so it is self-contained. Written to dist/inject.global.js.
  {
    entry: { inject: 'src/script/inject.ts' },
    format: ['iife'],
    target: 'es2020',
    platform: 'browser',
    clean: false,
  },
  // `flowtape` bin. The source hashbang is kept.
  {
    entry: { cli: 'src/cli.ts' },
    format: ['esm'],
    target: 'node18',
    external: ['playwright'],
    clean: false,
  },
]);
