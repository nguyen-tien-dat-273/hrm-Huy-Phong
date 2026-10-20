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
  // Dev: /api/* chạy ở server/index.mjs (cổng 8080); production dùng Vercel Functions.
  server: { host: true, allowedHosts: true, proxy: { '/api': 'http://localhost:8080' } },
  build: { chunkSizeWarningLimit: 1500 },
});
