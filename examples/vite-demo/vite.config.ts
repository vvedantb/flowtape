import react from '@vitejs/plugin-react';
import { flowtape } from '@vvedantb/flowtape/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [flowtape(), react()],
  server: { port: 5180 },
});
