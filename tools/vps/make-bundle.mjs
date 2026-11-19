#!/usr/bin/env node
// ============================================================================
// Đóng gói triển khai HRM lên VPS (deploy/vps). Chạy trên máy dev:
//
//   node tools/vps/make-bundle.mjs --scripts-only
//       Gói chỉ có script cài đặt — dùng lần đầu, khi Supabase trên VPS chưa có khoá.
//
//   node tools/vps/make-bundle.mjs --domain hrm.congty.vn --anon-key eyJ...
//       Dựng giao diện (pnpm build) với URL https://<domain> và khoá anon của Supabase
//       TRÊN VPS, kiểm tra kết quả, rồi đóng gói. VPS không phải build (RAM nhỏ).
//
// Kết quả: hrm-vps-bundle-<UTC>.tgz ở thư mục gốc repo. Gói không chứa .env/khoá bí mật
// (khoá anon vốn công khai, nằm sẵn trong mã giao diện).
// ============================================================================
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const scriptsOnly = args.includes('--scripts-only');
const domain = (arg('--domain') || '').trim().toLowerCase();
const anonKey = (arg('--anon-key') || '').trim();
const fail = (message) => {
  console.error(`\nLỖI: ${message}`);
  process.exit(1);
};

if (!scriptsOnly) {
  if (!domain || !anonKey) {
    fail('Cần --domain <ten-mien> --anon-key <khoá anon>, hoặc --scripts-only cho gói chỉ có script.');
  }
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)) {
    fail(`Tên miền không hợp lệ: ${domain} (không kèm https://, không kèm /).`);
  }
  // Chặn nhầm khoá service_role vào giao diện — lộ khoá đó là lộ toàn bộ dữ liệu.
  let role;
  try {
    role = JSON.parse(Buffer.from(anonKey.split('.')[1], 'base64url').toString('utf8')).role;
  } catch {
    fail('Khoá anon không đúng dạng JWT (eyJ….eyJ….…).');
  }
  if (role !== 'anon') fail(`Khoá đưa vào có role "${role}", không phải "anon". KHÔNG dùng SERVICE_ROLE_KEY cho giao diện.`);
}

const sh = (command, commandArgs, options = {}) => {
  // pnpm trên Windows là pnpm.cmd → cần shell; các lệnh khác gọi thẳng.
  const useShell = process.platform === 'win32' && command === 'pnpm';
  const result = useShell
    ? spawnSync([command, ...commandArgs].join(' '), { stdio: 'inherit', shell: true, ...options })
    : spawnSync(command, commandArgs, { stdio: 'inherit', ...options });
  if (result.status !== 0) fail(`${command} ${commandArgs.join(' ')} thất bại.`);
  return result;
};
const out = (command, commandArgs) => (spawnSync(command, commandArgs, { encoding: 'utf8' }).stdout || '').trim();

const commit = out('git', ['rev-parse', '--short', 'HEAD']) || 'unknown';
const dirty = out('git', ['status', '--porcelain', '--untracked-files=no']) !== '';
if (dirty) console.warn('CẢNH BÁO: có thay đổi chưa commit — gói sẽ chứa cả những thay đổi đó (ghi dirty=true).');

// ---------------------------------------------------------------------------
if (!scriptsOnly) {
  console.log(`\n==> Dựng giao diện cho https://${domain}`);
  rmSync('client/dist', { recursive: true, force: true });
  rmSync('server/dist', { recursive: true, force: true });
  sh('pnpm', ['build'], {
    env: {
      ...process.env,
      // Biến môi trường của tiến trình thắng giá trị trong các file .env của Vite.
      VITE_SUPABASE_URL: `https://${domain}`,
      VITE_SUPABASE_ANON_KEY: anonKey,
      VITE_ATTENDANCE_ADMS_HOST: '', // trống = dùng chính tên miền đang mở HRM
      VITE_ADMIN_API_BASE: '', // trống = /api cùng tên miền
    },
  });

  console.log('\n==> Kiểm tra bản dựng');
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|html|json|webmanifest)$/.test(entry.name)) files.push(full);
    }
  };
  walk('client/dist');
  const text = files.map((f) => readFileSync(f, 'utf8')).join('\n');
  if (!text.includes(`https://${domain}`)) fail(`Bản dựng không chứa https://${domain} — biến VITE_SUPABASE_URL không vào được.`);
  if (!text.includes(anonKey)) fail('Bản dựng không chứa khoá anon vừa đưa vào.');
  for (const [pattern, why] of [
    [/[a-z0-9]{20}\.supabase\.co/, 'URL Supabase Cloud'],
    [/\.workers\.dev/, 'địa chỉ Cloudflare Worker'],
    [/\.vercel\.app/, 'địa chỉ Vercel'],
  ]) {
    const hit = text.match(pattern);
    if (hit) fail(`Bản dựng còn ${why}: "${hit[0]}". Kiểm tra file .env* có VITE_… cũ.`);
  }
  for (const jwt of text.match(/eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/g) || []) {
    try {
      const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));
      if (payload.role && payload.role !== 'anon') fail(`Bản dựng chứa JWT role "${payload.role}" — KHÔNG được phát hành.`);
    } catch {
      /* không phải JWT thật */
    }
  }
  for (const required of ['client/dist/index.html', 'server/dist/api/iclock/cdata.js', 'client/dist/email-templates/ma-xac-minh.html']) {
    if (!existsSync(required)) fail(`Thiếu ${required} sau khi build.`);
  }
  console.log(`  ✓ ${files.length} file, đúng tên miền, đúng khoá anon, không lẫn URL cũ hay khoá service.`);
}

// ---------------------------------------------------------------------------
console.log('\n==> Đóng gói');
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const stage = join('tmp', 'vps-bundle', stamp);
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

// File văn bản: ép xuống dòng LF (Windows có thể đổi thành CRLF → sh trên Linux lỗi).
const textExt = /\.(sh|ya?ml|example|md|mjs|conf|txt)$|(^|[\\/])(Caddyfile|Dockerfile)$/;
const copy = (from, to) => {
  const dest = join(stage, to);
  if (statSync(from).isDirectory()) {
    cpSync(from, dest, { recursive: true });
    return;
  }
  mkdirSync(join(dest, '..'), { recursive: true });
  if (textExt.test(from)) writeFileSync(dest, readFileSync(from, 'utf8').replace(/\r\n/g, '\n'));
  else cpSync(from, dest);
};

// Bộ cài + vận hành (gốc gói = /opt/hrm trên VPS).
for (const f of ['compose.yaml', 'Caddyfile', '.env.example', 'hrm.sh', 'setup-server.sh', 'install-supabase.sh']) {
  copy(join('deploy/vps', f), f);
}
copy('deploy/vps/supabase/docker-compose.hrm-lean.yml', 'supabase/docker-compose.hrm-lean.yml');
copy('deploy/vps/backup/Dockerfile', 'backup/Dockerfile');
copy('deploy/vps/backup/backup-loop.sh', 'backup/backup-loop.sh');
for (const f of ['supabase-cloud-backup.mjs', 'storage-restore.mjs', 'verify-counts.mjs']) {
  copy(join('tools/backup', f), join('backup/tools', f));
}
copy('tools/vps/restore-db.sh', 'restore/restore-db.sh');
copy('supabase/check_migrations.sql', 'restore/check_migrations.sql');
copy('tools/vps/prune-keep.sql', 'restore/prune-keep.sql');
copy('deploy/vps/README.md', 'README.md');
mkdirSync(join(stage, 'secrets'), { recursive: true });
writeFileSync(join(stage, 'secrets', 'README.txt'), 'Đặt rclone.conf ở đây (chmod 600). Thư mục này không bị ghi đè khi deploy.\n');

if (!scriptsOnly) {
  copy('deploy/vps/app/Dockerfile', 'app/Dockerfile');
  copy('package.json', 'app/package.json');
  copy('pnpm-lock.yaml', 'app/pnpm-lock.yaml');
  copy('server/index.mjs', 'app/server/index.mjs');
  copy('server/dist/api', 'app/server/dist/api');
  copy('client/dist', 'app/client/dist');
}

const keyFingerprint = scriptsOnly ? '' : createHash('sha256').update(anonKey).digest('hex').slice(0, 8);
writeFileSync(
  join(stage, 'BUNDLE-INFO.txt'),
  [
    `created=${new Date().toISOString()}`,
    `commit=${commit}`,
    `dirty=${dirty}`,
    `kind=${scriptsOnly ? 'scripts-only' : 'full'}`,
    `domain=${scriptsOnly ? '' : domain}`,
    `anon_key_sha256_8=${keyFingerprint}`,
    '',
  ].join('\n'),
);

const outFile = `hrm-vps-bundle-${stamp}${scriptsOnly ? '-scripts' : ''}.tgz`;
// Đường dẫn tương đối (tar của Git Bash hiểu "C:" là máy từ xa).
sh('tar', ['-czf', outFile, '-C', relative(process.cwd(), stage).split('\\').join('/'), '.']);

const listing = spawnSync('tar', ['-tzf', outFile], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).stdout.split(/\r?\n/).filter(Boolean);
const leaked = listing.filter((f) => /(^|\/)\.env(\.|$)/.test(f) && !f.endsWith('.env.example'));
if (leaked.length) {
  rmSync(outFile, { force: true });
  fail(`gói chứa file môi trường: ${leaked.join(', ')}`);
}
rmSync(join('tmp', 'vps-bundle'), { recursive: true, force: true });

const sha = createHash('sha256').update(readFileSync(outFile)).digest('hex');
console.log(`\n${outFile}  ${(statSync(outFile).size / 1048576).toFixed(1)} MiB, ${listing.length} mục, commit ${commit}${dirty ? ' (dirty)' : ''}`);
console.log(`sha256 ${sha}`);
console.log('\nChép lên VPS:');
if (scriptsOnly) {
  console.log(`  scp ${outFile} root@<IP-VPS>:/root/`);
  console.log(`  ssh root@<IP-VPS> "mkdir -p /root/hrm && tar -xzf /root/${outFile} -C /root/hrm && sh /root/hrm/setup-server.sh"`);
} else {
  console.log(`  scp ${outFile} deploy@<IP-VPS>:/tmp/`);
  // `sh ./hrm.sh`: tar của Windows không giữ quyền thực thi; deploy tự chmod cho lần sau.
  console.log(`  ssh deploy@<IP-VPS> "cd /opt/hrm && sh ./hrm.sh deploy /tmp/${outFile}"`);
}
