import react from '@vitejs/plugin-react';
import { flowtape } from '@vedantb/flowtape/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [flowtape(), react()],
  server: { port: 5180 },
});
