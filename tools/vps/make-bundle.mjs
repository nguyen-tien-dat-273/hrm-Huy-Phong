#!/usr/bin/env node
// Đóng gói mã nguồn để chép lên VPS: chỉ những gì cần để build image + chạy + khôi phục.
// KHÔNG chứa .env*, bản sao lưu, tài liệu đặc tả (.docx/.pdf/.xlsx), node_modules, dist.
//   node tools/vps/make-bundle.mjs
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const out = `hrm-vps-bundle-${stamp}.tgz`;

const include = [
  'Dockerfile', 'compose.yaml', '.dockerignore', '.env.docker.example',
  'package.json', 'pnpm-lock.yaml', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json',
  'vite.config.ts', 'eslint.config.js',
  'api', 'client', 'server/index.mjs',
  'supabase/migrations', 'supabase/schema_baseline.sql', 'supabase/check_migrations.sql',
  'tools', 'deploy', 'docs',
].filter((p) => existsSync(p));

// Dạng --exclude=MẪU (một đối số): tar của Git Bash tự bung ký tự * khi đứng riêng thành tên file thật.
const exclude = [
  'client/dist', 'client/tmp', '**/node_modules', 'tools/staging-clone', 'tools/local-pg',
  'tools/bridge-pack', 'tools/attendance-*', '*.log', '.env*',
];
const args = ['-czf', out, ...exclude.map((e) => `--exclude=${e}`), ...include];
const result = spawnSync('tar', args, { stdio: 'inherit' });
if (result.status !== 0) {
  console.error('tar thất bại.');
  process.exit(1);
}

const list = spawnSync('tar', ['-tzf', out], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).stdout.split('\n').filter(Boolean);
const leaked = list.filter((f) => /(^|\/)\.env(\.|$)/.test(f) && !f.endsWith('.example'));
if (leaked.length) {
  console.error('CẢNH BÁO: gói chứa file môi trường:', leaked);
  process.exit(1);
}
const sha = createHash('sha256').update(readFileSync(out)).digest('hex');
console.log(`\n${out}  ${(statSync(out).size / 1048576).toFixed(1)} MiB, ${list.length} mục`);
console.log(`sha256 ${sha}`);
console.log('Gói chỉ có mã nguồn: image Docker được BUILD trên VPS (pnpm build chạy trong Dockerfile).');
