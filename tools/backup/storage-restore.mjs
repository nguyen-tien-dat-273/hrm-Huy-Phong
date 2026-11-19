#!/usr/bin/env node
// ============================================================================
// Nạp lại file Storage từ một bản sao lưu vào một Supabase (thường là bản tự host trên VPS).
//
//   node tools/backup/storage-restore.mjs <thư-mục-sao-lưu> --url https://api.ten-mien.vn
//   (đặt SUPABASE_SERVICE_ROLE_KEY của máy ĐÍCH trong môi trường)
//
// Điều kiện: bucket đã tồn tại ở đích (restore-db.sh đã nạp bảng storage.buckets).
// Không ghi đè file đã có (upsert=false) nên chạy lại an toàn; file đã tồn tại được tính là "đã có".
// Mỗi file được kiểm sha256 theo storage-index.json trước khi gửi.
// ============================================================================
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const dir = resolve(args.find((a) => !a.startsWith('--')) || '');
const urlIndex = args.indexOf('--url');
const target = (urlIndex >= 0 ? args[urlIndex + 1] : process.env.TARGET_SUPABASE_URL || '').replace(/\/+$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!args.find((a) => !a.startsWith('--')) || !target || !key) {
  console.error('Cách dùng: SUPABASE_SERVICE_ROLE_KEY=<khoá máy đích> node tools/backup/storage-restore.mjs <thư-mục-sao-lưu> --url <URL máy đích>');
  process.exit(1);
}

const index = JSON.parse(await readFile(join(dir, 'storage-index.json'), 'utf8'));

// Bucket có thể giới hạn loại file (allowed_mime_types): phải gửi ĐÚNG kiểu, không gửi
// application/octet-stream. Ưu tiên kiểu ghi trong bản sao lưu, không có thì đoán theo đuôi.
const MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  heic: 'image/heic', heif: 'image/heif', avif: 'image/avif', svg: 'image/svg+xml', bmp: 'image/bmp',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  csv: 'text/csv', txt: 'text/plain', zip: 'application/zip', rar: 'application/vnd.rar',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', avi: 'video/x-msvideo', mkv: 'video/x-matroska',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav',
};
const contentTypeOf = (item) =>
  item.mimetype || MIME[(item.name.split('.').pop() || '').toLowerCase()] || 'application/octet-stream';
let uploaded = 0;
let existed = 0;
const failures = [];

const queue = [...index];
const worker = async () => {
  for (let item = queue.shift(); item; item = queue.shift()) {
    try {
      const buffer = await readFile(join(dir, ...item.local.split('/')));
      if (createHash('sha256').update(buffer).digest('hex') !== item.sha256) throw new Error('sha256 không khớp với bản sao lưu');
      const path = item.name.split('/').map(encodeURIComponent).join('/');
      const response = await fetch(`${target}/storage/v1/object/${encodeURIComponent(item.bucket)}/${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': contentTypeOf(item), 'x-upsert': 'false' },
        body: buffer,
      });
      if (response.ok) {
        uploaded += 1;
      } else {
        const text = await response.text();
        if (response.status === 409 || (response.status === 400 && /already exists|Duplicate/i.test(text))) existed += 1;
        else throw new Error(`HTTP ${response.status} (${contentTypeOf(item)}): ${text.slice(0, 160)}`);
      }
    } catch (error) {
      failures.push({ bucket: item.bucket, name: item.name, error: String(error.message || error) });
    }
  }
};
await Promise.all(Array.from({ length: 4 }, worker));

console.log(`Storage: ${index.length} file trong bản sao lưu → tải lên ${uploaded}, đã có sẵn ${existed}, lỗi ${failures.length}.`);
if (failures.length) {
  console.error(JSON.stringify(failures.slice(0, 20), null, 2));
  process.exit(1);
}
