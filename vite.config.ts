import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';
// Quiet Command Center: stable ink/navy workspace with copper signal accents.
export default defineConfig({
  root: 'client',
  envDir: '..',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'client/src') } },
  server: { host: true, allowedHosts: true },
  build: { chunkSizeWarningLimit: 1500 },
});
