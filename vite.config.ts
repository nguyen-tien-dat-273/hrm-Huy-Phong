import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig, loadEnv, type Plugin } from 'vite';

// Dev: `vite` không có route /api/*, nên chuyển /api/chatbot sang handler trong api/.
function devChatbotApi(): Plugin {
  return {
    name: 'dev-chatbot-api',
    apply: 'serve',
    configureServer(server) {
      for (const [k, v] of Object.entries(loadEnv(server.config.mode, import.meta.dirname, ''))) {
        process.env[k] ??= v;
      }
      server.middlewares.use('/api/chatbot', async (req, res) => {
        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const raw = Buffer.concat(chunks).toString('utf8');
          const mod = await server.ssrLoadModule(path.resolve(import.meta.dirname, 'api/chatbot.ts'));
          const handler = mod.default as (rq: unknown, rs: unknown) => Promise<void>;
          await handler(
            { method: req.method, headers: req.headers, body: raw ? JSON.parse(raw) : undefined },
            {
              status(code: number) { res.statusCode = code; return this; },
              setHeader(name: string, value: string) { res.setHeader(name, value); },
              json(body: unknown) {
                if (!res.hasHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify(body));
              },
            },
          );
          if (!res.writableEnded) res.end();
        } catch (error) {
          console.error('[dev api] /api/chatbot failed', error);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
          }
          res.end(JSON.stringify({ error: `Lỗi trợ lý (dev): ${error instanceof Error ? error.message : String(error)}` }));
        }
      });
    },
  };
}

// Quiet Command Center: stable ink/navy workspace with copper signal accents.
export default defineConfig({
  root: 'client',
  envDir: '..',
  plugins: [react(), tailwindcss(), devChatbotApi()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'client/src') } },
  // Dev: /api/* chạy ở server/index.mjs (cổng 8080); production dùng Vercel Functions.
  server: { host: true, allowedHosts: true, proxy: { '/api': 'http://localhost:8080' } },
  build: { chunkSizeWarningLimit: 1500 },
});
