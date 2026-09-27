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
]);
