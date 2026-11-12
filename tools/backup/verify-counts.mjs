#!/usr/bin/env node
// ============================================================================
// Đối chiếu số dòng từng bảng của một database với inventory.json của bản sao lưu.
//
//   DB_URL=postgresql://... node tools/backup/verify-counts.mjs <thư-mục-sao-lưu>
//
// Dùng sau khi khôi phục lên VPS: mọi bảng phải KHỚP (ngoại lệ hợp lý: auth.sessions,
// auth.refresh_tokens, auth.audit_log_entries, auth.schema_migrations, storage.objects,
// storage.migrations — được liệt kê riêng, không tính là lỗi).
// ============================================================================
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import pg from 'pg';

const dir = resolve(process.argv[2] || '');
if (!process.argv[2] || !process.env.DB_URL) {
  console.error('Cách dùng: DB_URL=<chuỗi kết nối> node tools/backup/verify-counts.mjs <thư-mục-sao-lưu>');
  process.exit(1);
}
const inventory = JSON.parse(await readFile(join(dir, 'inventory.json'), 'utf8'));
const tolerated = new Set([
  'auth.sessions', 'auth.refresh_tokens', 'auth.audit_log_entries', 'auth.schema_migrations',
  'auth.flow_state', 'auth.one_time_tokens', 'storage.objects', 'storage.migrations',
  'storage.prefixes', 'storage.s3_multipart_uploads', 'storage.s3_multipart_uploads_parts',
]);

const client = new pg.Client({ connectionString: process.env.DB_URL });
await client.connect();
let bad = 0;
let ok = 0;
const notes = [];
for (const [table, expected] of Object.entries(inventory.tables)) {
  const [schema, name] = table.split('.');
  let actual = null;
  try {
    actual = Number((await client.query(`select count(*)::bigint as n from "${schema}"."${name}"`)).rows[0].n);
  } catch {
    actual = null; // bảng không tồn tại ở đích
  }
  if (actual === expected) ok += 1;
  else if (tolerated.has(table)) notes.push(`  ~ ${table}: nguồn ${expected}, đích ${actual ?? 'không có'} (bỏ qua có chủ đích)`);
  else {
    bad += 1;
    console.log(`  ✗ ${table}: nguồn ${expected}, đích ${actual ?? 'KHÔNG CÓ BẢNG'}`);
  }
}
const objects = Number((await client.query('select count(*)::int as n from storage.objects')).rows[0].n);
const expectedObjects = inventory.buckets.reduce((sum, b) => sum + b.objects, 0);
if (objects !== expectedObjects) {
  bad += 1;
  console.log(`  ✗ storage.objects: nguồn ${expectedObjects}, đích ${objects}`);
}
await client.end();
if (notes.length) console.log(notes.join('\n'));
console.log(bad ? `\nCÓ ${bad} MỤC LỆCH — chưa được chuyển sang production.` : `\nKHỚP: ${ok} bảng + storage.objects đều đúng với bản sao lưu.`);
process.exit(bad ? 1 : 0);
