#!/usr/bin/env node
// ============================================================================
// Sao lưu ĐẦY ĐỦ một project Supabase Cloud (chỉ ĐỌC, không ghi gì lên Supabase).
//
//   node --env-file=.env.backup tools/backup/supabase-cloud-backup.mjs [thư-mục-đầu-ra]
//
// Cần trong .env.backup (file này đã nằm trong .gitignore):
//   SUPABASE_DB_URL            chuỗi "Session pooler" (cổng 5432) ở Dashboard > Connect.
//                              Không dùng "Transaction pooler" (6543) — pg_dump không chạy qua đó.
//   SUPABASE_URL               https://<ref>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY  để tải file Storage (không có khoá này thì bỏ qua Storage)
//
// Cần có pg_dump (PostgreSQL client) từ bản 15 trở lên trong PATH, hoặc đặt PG_DUMP=<đường dẫn>.
//
// Kết quả: <đầu-ra>/<UTC>/
//   db-full.dump         pg_dump -Fc toàn bộ database (lưu trữ / khôi phục nguyên trạng)
//   db-public.dump       chỉ schema public (cấu trúc + dữ liệu)
//   db-auth-data.dump    chỉ dữ liệu schema auth (tài khoản, mật khẩu băm, identities)
//   db-storage-data.dump chỉ dữ liệu schema storage (danh sách bucket + object)
//   db-schema.sql        cấu trúc thuần (đọc bằng mắt được, so sánh được)
//   migration-history.json  supabase_migrations.schema_migrations (nếu có)
//   storage/<bucket>/…   mọi file đã tải về + storage-index.json (tên gốc, kích thước, sha256)
//   inventory.json       số dòng từng bảng, bucket, extension, phiên bản Postgres
//   SHA256SUMS, COMPLETE (COMPLETE chỉ có khi mọi bước đều thành công)
//
// Không in chuỗi kết nối hay khoá ra màn hình/log.
// ============================================================================
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import pg from 'pg';

const dbUrl = process.env.SUPABASE_DB_URL;
const apiUrl = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const pgDump = process.env.PG_DUMP || 'pg_dump';

if (!dbUrl) fail('Thiếu SUPABASE_DB_URL (chuỗi Session pooler, cổng 5432).');
if (/:6543\b/.test(dbUrl)) fail('SUPABASE_DB_URL đang là Transaction pooler (6543). Dùng Session pooler (5432).');

const parsed = new URL(dbUrl);
const pgEnv = {
  ...process.env,
  PGHOST: parsed.hostname,
  PGPORT: parsed.port || '5432',
  PGUSER: decodeURIComponent(parsed.username),
  PGPASSWORD: decodeURIComponent(parsed.password),
  PGDATABASE: parsed.pathname.replace(/^\//, '') || 'postgres',
  PGSSLMODE: process.env.BACKUP_DB_SSL === 'disable' ? 'disable' : 'require',
};

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const outRoot = resolve(process.argv[2] || 'backups');
const work = join(outRoot, `.incomplete-${stamp}`);
const finalDir = join(outRoot, stamp);

function fail(message) {
  console.error(`LỖI: ${message}`);
  process.exit(1);
}
const log = (message) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${message}`);

function run(command, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { env: pgEnv, stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('error', (error) => reject(new Error(`Không chạy được ${command}: ${error.message}`)));
    child.on('close', (code) => (code === 0 ? resolveRun() : reject(new Error(`${command} thoát với mã ${code}`))));
  });
}

async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function walk(dir, base = dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full, base)));
    else out.push(full.slice(base.length + 1).split(sep).join('/'));
  }
  return out;
}

// Tên file hợp lệ trên Windows; tên gốc vẫn nằm trong storage-index.json.
// eslint-disable-next-line no-control-regex
const safeSegment = (segment) => segment.replace(/[<>:"|?*\\\u0000-\u001f]/g, '_').replace(/[. ]+$/, '_') || '_';

async function main() {
  await mkdir(work, { recursive: true });
  const client = new pg.Client({ connectionString: dbUrl, ssl: process.env.BACKUP_DB_SSL === 'disable' ? false : { rejectUnauthorized: false } });
  await client.connect();

  const version = (await client.query('show server_version')).rows[0].server_version;
  log(`Đã kết nối. PostgreSQL ${version}.`);

  // 1. Kiểm kê — làm trước để sau này đối chiếu được với bản khôi phục.
  const inventory = { startedAt: new Date().toISOString(), postgres: version, tables: {}, buckets: [], extensions: [] };
  const tables = (
    await client.query(`
      select table_schema, table_name from information_schema.tables
      where table_type = 'BASE TABLE' and table_schema in ('public','auth','storage')
      order by 1, 2`)
  ).rows;
  for (const { table_schema: schema, table_name: name } of tables) {
    const count = (await client.query(`select count(*)::bigint as n from "${schema}"."${name}"`)).rows[0].n;
    inventory.tables[`${schema}.${name}`] = Number(count);
  }
  inventory.extensions = (await client.query('select extname, extversion from pg_extension order by 1')).rows;
  inventory.buckets = (
    await client.query(`
      select b.id, b.public, count(o.id)::int as objects,
             coalesce(sum((o.metadata->>'size')::bigint), 0)::bigint as bytes
      from storage.buckets b left join storage.objects o on o.bucket_id = b.id
      group by b.id, b.public order by b.id`)
  ).rows.map((row) => ({ ...row, bytes: Number(row.bytes) }));
  log(`Kiểm kê: ${tables.length} bảng, ${inventory.buckets.length} bucket.`);

  try {
    const history = await client.query('select * from supabase_migrations.schema_migrations order by version');
    await writeFile(join(work, 'migration-history.json'), JSON.stringify(history.rows, null, 2));
    inventory.migrationsApplied = history.rowCount;
  } catch {
    inventory.migrationsApplied = null; // project không dùng Supabase CLI migrations
  }

  const objects = (
    await client.query(`select bucket_id, name, (metadata->>'size')::bigint as size from storage.objects order by 1, 2`)
  ).rows;
  await client.end();

  // 2. Dump database.
  const common = ['--no-owner', '--no-privileges', '--no-comments'];
  log('pg_dump: toàn bộ database…');
  await run(pgDump, ['-Fc', ...common, '-f', join(work, 'db-full.dump')]);
  log('pg_dump: schema public…');
  // Giữ GRANT (anon/authenticated/service_role) để PostgREST trên máy mới truy cập được.
  await run(pgDump, ['-Fc', '--no-owner', '--no-comments', '-n', 'public', '-f', join(work, 'db-public.dump')]);
  log('pg_dump: dữ liệu auth…');
  await run(pgDump, ['-Fc', '--data-only', '--no-owner', '--no-privileges', '-n', 'auth', '-f', join(work, 'db-auth-data.dump')]);
  log('pg_dump: dữ liệu storage…');
  await run(pgDump, ['-Fc', '--data-only', '--no-owner', '--no-privileges', '-n', 'storage', '-f', join(work, 'db-storage-data.dump')]);
  log('pg_dump: cấu trúc thuần (SQL)…');
  await run(pgDump, ['--schema-only', ...common, '-n', 'public', '-f', join(work, 'db-schema.sql')]);

  // 3. Storage.
  const storageIndex = [];
  const storageFailures = [];
  if (!objects.length) {
    log('Storage: không có object nào.');
  } else if (!apiUrl || !serviceKey) {
    fail(`Storage có ${objects.length} file nhưng thiếu SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY để tải về.`);
  } else {
    log(`Storage: tải ${objects.length} file…`);
    let done = 0;
    const queue = [...objects];
    const worker = async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        const rel = ['storage', safeSegment(item.bucket_id), ...item.name.split('/').map(safeSegment)].join('/');
        const dest = join(work, ...rel.split('/'));
        try {
          const url = `${apiUrl}/storage/v1/object/${encodeURIComponent(item.bucket_id)}/${item.name.split('/').map(encodeURIComponent).join('/')}`;
          let response;
          for (let attempt = 1; attempt <= 3; attempt += 1) {
            response = await fetch(url, { headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey } });
            if (response.ok || response.status < 500) break;
            await new Promise((r) => setTimeout(r, 1000 * attempt));
          }
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const buffer = Buffer.from(await response.arrayBuffer());
          if (item.size != null && Number(item.size) !== buffer.length) {
            throw new Error(`lệch kích thước (${buffer.length} ≠ ${item.size})`);
          }
          await mkdir(dirname(dest), { recursive: true });
          await writeFile(dest, buffer);
          storageIndex.push({
            bucket: item.bucket_id,
            name: item.name,
            local: rel,
            size: buffer.length,
            sha256: createHash('sha256').update(buffer).digest('hex'),
          });
        } catch (error) {
          storageFailures.push({ bucket: item.bucket_id, name: item.name, error: String(error.message || error) });
        }
        done += 1;
        if (done % 50 === 0 || done === objects.length) log(`  Storage ${done}/${objects.length}`);
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
    storageIndex.sort((a, b) => (a.bucket + a.name).localeCompare(b.bucket + b.name));
    await writeFile(join(work, 'storage-index.json'), JSON.stringify(storageIndex, null, 2));
    if (storageFailures.length) {
      await writeFile(join(work, 'storage-FAILURES.json'), JSON.stringify(storageFailures, null, 2));
      throw new Error(`${storageFailures.length}/${objects.length} file Storage tải lỗi (xem storage-FAILURES.json).`);
    }
  }

  // 4. Kiểm tra dump đọc lại được.
  log('Kiểm tra các file dump đọc lại được (pg_restore --list)…');
  for (const name of ['db-full.dump', 'db-public.dump', 'db-auth-data.dump', 'db-storage-data.dump']) {
    await new Promise((resolveCheck, reject) => {
      const child = spawn(process.env.PG_RESTORE || 'pg_restore', ['--list', join(work, name)], { stdio: ['ignore', 'ignore', 'inherit'] });
      child.on('error', (error) => reject(new Error(`Không chạy được pg_restore: ${error.message}`)));
      child.on('close', (code) => (code === 0 ? resolveCheck() : reject(new Error(`${name} không đọc được`))));
    });
  }

  inventory.storageFilesDownloaded = storageIndex.length;
  inventory.finishedAt = new Date().toISOString();
  await writeFile(join(work, 'inventory.json'), JSON.stringify(inventory, null, 2));

  // 5. Checksum + đánh dấu hoàn tất.
  const files = (await walk(work)).filter((f) => f !== 'SHA256SUMS' && f !== 'COMPLETE').sort();
  const sums = [];
  for (const file of files) sums.push(`${await sha256(join(work, ...file.split('/')))}  ${file}`);
  await writeFile(join(work, 'SHA256SUMS'), `${sums.join('\n')}\n`);
  await writeFile(join(work, 'COMPLETE'), `completed_at=${stamp}\n`);
  await rename(work, finalDir);

  const total = (await Promise.all(files.map((f) => stat(join(finalDir, ...f.split('/'))).then((s) => s.size)))).reduce((a, b) => a + b, 0);
  log(`XONG: ${finalDir}`);
  log(`  ${files.length} file, ${(total / 1048576).toFixed(1)} MiB, ${storageIndex.length} file Storage.`);
  log('  Nhắc: cấu hình Auth (SMTP, URL chuyển hướng, mẫu email), JWT secret và biến môi trường Vercel/Cloudflare');
  log('  KHÔNG nằm trong database — phải ghi lại thủ công (xem docs/trien-khai-vps-mat-bao.md, mục 2).');
}

main().catch((error) => {
  console.error(`\nSAO LƯU THẤT BẠI: ${error.message}`);
  console.error(`Thư mục dở dang (có thể xoá): ${work}`);
  process.exit(1);
});
